"""
Groq-powered RAG System using LangChain
Combines FAISS retrieval with Groq LLM for resolution suggestions
"""

import os
from typing import Dict, List, Optional
import pandas as pd
import numpy as np
import pickle
from pathlib import Path
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
import faiss
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from .logger import setup_logger
import time
load_dotenv()

# Initialize logger
logger = setup_logger(__name__)


# RAG system using FAISS for retrieval and Groq LLM for answer generation
class GroqRAGSystem:
    
    def __init__(
        self, 
        embedding_model: Optional[str] = None,
        llm_model: Optional[str] = None
    ):
        """
        Initialize Groq RAG system
        
        Args:
            embedding_model: Sentence transformer model for embeddings (default: from EMBEDDING_MODEL env or all-MiniLM-L6-v2)
            llm_model: Groq model for answer generation (default: from GROQ_MODEL env or llama-3.3-70b-versatile)
        """
        # Use environment variables or provided parameters or defaults
        self.embedding_model_name = embedding_model or os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
        self.llm_model_name = llm_model or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
                      
        # Set up caching for models
        cache_dir = Path('models_cache')
        cache_dir.mkdir(exist_ok=True)
        
        # Initialize embedding model with caching
        logger.info(f"GroqRAGSystem | __init__ | Loading embedding model: {self.embedding_model_name}")
        logger.info("GroqRAGSystem | __init__ | (Using local cache if available)")
        
       
        start_time = time.time()
        
        self.embedding_model = SentenceTransformer(
            self.embedding_model_name,
            cache_folder=str(cache_dir),
            device='cpu'  # Explicitly set device for consistency
        )
        
        load_time = time.time() - start_time
        logger.info(f"GroqRAGSystem | __init__ | Embedding model loaded in {load_time:.2f}s")
        
        # Initialize Groq LLM
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
        
        self.llm = ChatGroq(
            model=self.llm_model_name,
            temperature=0.3,
            api_key=api_key,
            max_tokens=1500
        )
        
        # FAISS index
        self.index = None
        self.tickets_data = None
        self.embeddings = None
        self.is_built = False
        
        # FAISS persistence paths
        self.faiss_dir = Path('data/faiss')
        self.index_path = self.faiss_dir / 'ticket_embeddings.index'
        self.data_path = self.faiss_dir / 'ticket_data.pkl'
        self.embeddings_path = self.faiss_dir / 'embeddings.npy'
        
        # Create RAG prompt
        self.rag_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert IT support resolution specialist. 
Based on similar past tickets, provide a clear, actionable resolution for the current issue.
Similar Past Tickets and Resolutions:
{similar_tickets}
Guidelines:
- Be specific and technical
- Provide step-by-step instructions when applicable
- Estimate resolution time based on similar tickets
- Reference similar ticket patterns when relevant"""),
            ("user", """Current Ticket:
Title: {title}
Description: {description}
Category: {category}
Priority: {priority}
Provide a comprehensive resolution suggestion for the current ticket.""")
        ])
    
    def save_index(self) -> None:
        """Save FAISS index and metadata to disk"""
        if not self.is_built:
            raise ValueError("No index to save. Build index first.")
        
        # Ensure directory exists
        self.faiss_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info("GroqRAGSystem | save_index | Saving FAISS index to disk...")
        
        # Save FAISS index
        faiss.write_index(self.index, str(self.index_path))
        logger.info(f"GroqRAGSystem | save_index | Saved FAISS index: {self.index_path}")
        
        # Save embeddings
        np.save(str(self.embeddings_path), self.embeddings)
        logger.info(f"GroqRAGSystem | save_index | Saved embeddings: {self.embeddings_path}")
        
        # Save ticket data
        with open(self.data_path, 'wb') as f:
            pickle.dump(self.tickets_data, f)
        logger.info(f"GroqRAGSystem | save_index | Saved ticket data: {self.data_path}")
        
        logger.info("GroqRAGSystem | save_index | FAISS index saved successfully")
    
    def load_index(self) -> bool:
        """
        Load FAISS index from disk if available
        
        Returns:
            bool: True if loaded successfully, False otherwise
        """
        # Check if all files exist
        if not (self.index_path.exists() and self.data_path.exists() and self.embeddings_path.exists()):
            logger.info("GroqRAGSystem | load_index | No saved index found, will build from scratch")
            return False
        
        try:
            logger.info("GroqRAGSystem | load_index | Loading FAISS index from disk...")
            
            # Load FAISS index
            self.index = faiss.read_index(str(self.index_path))
            logger.info(f"GroqRAGSystem | load_index | Loaded FAISS index: {self.index_path}")
            
            # Load embeddings
            self.embeddings = np.load(str(self.embeddings_path))
            logger.info(f"GroqRAGSystem | load_index | Loaded embeddings: {self.embeddings_path}")
            
            # Load ticket data
            with open(self.data_path, 'rb') as f:
                self.tickets_data = pickle.load(f)
            logger.info(f"GroqRAGSystem | load_index | Loaded ticket data: {self.data_path}")
            
            self.is_built = True
            logger.info(f"GroqRAGSystem | load_index | FAISS index loaded successfully ({len(self.tickets_data)} tickets)")
            return True
            
        except Exception as e:
            logger.error(f"GroqRAGSystem | load_index | Failed to load index: {e}")
            logger.info("GroqRAGSystem | load_index | Will rebuild index from scratch")
            return False
    
    def build_index(self, csv_path: str, force_rebuild: bool = False) -> Dict:
      
        # Try loading existing index first (unless force_rebuild)
        if not force_rebuild and self.load_index():
            logger.info("GroqRAGSystem | build_index | Using existing FAISS index from disk")
            return {
                'num_tickets': len(self.tickets_data),
                'embedding_dim': self.embeddings.shape[1],
                'loaded_from_disk': True
            }
        
        logger.info(f"GroqRAGSystem | build_index | Building RAG index from {csv_path}...")
        
        # Load data
        self.tickets_data = pd.read_csv(csv_path)
        logger.info(f"GroqRAGSystem | build_index | Loaded {len(self.tickets_data)} tickets")
        
        # Prepare texts
        texts = (
            self.tickets_data['title'].fillna('') + ' ' + 
            self.tickets_data['description'].fillna('')
        ).tolist()
        
        # Generate embeddings
        logger.info("GroqRAGSystem | build_index | Generating embeddings...")
        self.embeddings = self.embedding_model.encode(
            texts,
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True
        )
        
        # Build FAISS index
        logger.info("GroqRAGSystem | build_index | Building FAISS index...")
        embedding_dim = self.embeddings.shape[1]
        self.index = faiss.IndexFlatIP(embedding_dim)
        self.index.add(self.embeddings.astype('float32'))
        
        self.is_built = True
        
        logger.info(f"GroqRAGSystem | build_index | RAG index built: {len(self.tickets_data)} tickets indexed")
        
        # Save index to disk
        self.save_index()
        
        return {
            'num_tickets': len(self.tickets_data),
            'embedding_dim': embedding_dim,
            'loaded_from_disk': False
        }
    
    def search_similar(
        self,
        query: str,
        top_k: int = 5,
        category_filter: Optional[str] = None,
        exclude_ticket_id: Optional[str] = None
    ) -> List[Dict]:
        """
        Search for similar tickets
        
        Args:
            query: Query text
            top_k: Number of results
            category_filter: Optional category filter
            exclude_ticket_id: Optional ticket ID to exclude from results (to avoid showing the same ticket)
            
        Returns:
            list: Similar tickets with metadata
        """
        if not self.is_built:
            raise ValueError("RAG system not built. Call build_index() first.")
        
        # Extract ticket ID from query if present (e.g., "TKT-000719" or "ticket TKT-000719")
        import re
        ticket_id_pattern = r'TKT-\d{6}'
        ticket_id_match = re.search(ticket_id_pattern, query.upper())
        
        # If no explicit exclude_ticket_id but query contains a ticket ID, exclude it
        if not exclude_ticket_id and ticket_id_match:
            exclude_ticket_id = ticket_id_match.group(0)
        
        # Generate query embedding
        query_embedding = self.embedding_model.encode(
            [query],
            convert_to_numpy=True,
            normalize_embeddings=True
        )
        
        # Search - get more results to account for exclusions
        search_k = min(top_k * 3, len(self.tickets_data))
        similarities, indices = self.index.search(
            query_embedding.astype('float32'),
            search_k
        )
        
        # Process results
        results = []
        for idx, similarity in zip(indices[0], similarities[0]):
            if idx == -1:
                continue
            
            ticket = self.tickets_data.iloc[idx]
            
            # Exclude the specified ticket ID (avoid showing same ticket in similar results)
            if exclude_ticket_id and ticket['ticket_id'] == exclude_ticket_id:
                continue
            
            # Apply category filter
            if category_filter and ticket['category'] != category_filter:
                continue
            
            results.append({
                'ticket_id': ticket['ticket_id'],
                'title': ticket['title'],
                'description': ticket['description'],
                'category': ticket['category'],
                'priority': ticket['priority'],
                'resolution': ticket['resolution'],
                'similarity': float(similarity),
                'resolution_time_hours': ticket.get('resolution_time_hours', 0)
            })
            
            if len(results) >= top_k:
                break
        
        return results
    
    def get_resolution_with_llm(
        self,
        title: str,
        description: str,
        category: Optional[str] = None,
        priority: str = "Medium",
        top_k: int = 3
    ) -> Dict:
        """
        Get AI-generated resolution using RAG + Groq LLM
        
        Args:
            title: Ticket title
            description: Ticket description
            category: Ticket category (optional - if None, searches all categories)
            priority: Ticket priority
            top_k: Number of similar tickets to retrieve
            
        Returns:
            dict: Resolution suggestion with metadata
        """
        # Get similar tickets
        query = f"{title} {description}"
        similar_tickets = self.search_similar(query, top_k=top_k, category_filter=category)
        
        if not similar_tickets:
            return {
                'found_similar': False,
                'resolution': "No similar tickets found. Manual investigation required.",
                'confidence': 0.3,
                'estimated_time': 0,
                'similar_tickets': []
            }
        
        # Format similar tickets for LLM
        similar_tickets_text = ""
        for i, ticket in enumerate(similar_tickets, 1):
            similar_tickets_text += f"\n{i}. [{ticket['ticket_id']}] (Similarity: {ticket['similarity']:.2f})\n"
            similar_tickets_text += f"   Title: {ticket['title']}\n"
            similar_tickets_text += f"   Resolution: {ticket['resolution']}\n"
            similar_tickets_text += f"   Time: {ticket['resolution_time_hours']}h\n"
        
        # Generate resolution with LLM
        try:
            formatted_prompt = self.rag_prompt.format_messages(
                title=title,
                description=description,
                category=category,
                priority=priority,
                similar_tickets=similar_tickets_text
            )
            
            response = self.llm.invoke(formatted_prompt)
            
            # Calculate metrics
            avg_similarity = np.mean([t['similarity'] for t in similar_tickets])
            avg_time = np.mean([t['resolution_time_hours'] for t in similar_tickets])
            
            return {
                'found_similar': True,
                'resolution': response.content,
                'confidence': float(avg_similarity),
                'estimated_time': float(avg_time),
                'similar_tickets': similar_tickets,
                'num_similar': len(similar_tickets)
            }
            
        except Exception as e:
            logger.error(f"GroqRAGSystem | get_resolution_with_llm | LLM generation error: {e}")
            # Fallback to most similar ticket's resolution
            best_ticket = similar_tickets[0]
            return {
                'found_similar': True,
                'resolution': best_ticket['resolution'],
                'confidence': best_ticket['similarity'],
                'estimated_time': best_ticket['resolution_time_hours'],
                'similar_tickets': similar_tickets,
                'num_similar': len(similar_tickets)
            }
    
    def get_category_statistics(self) -> Dict:
        """Get statistics about the ticket database"""
        if not self.is_built:
            raise ValueError("RAG system not built")
        
        stats = {
            'total_tickets': len(self.tickets_data),
            'categories': {},
            'priorities': {},
            'avg_resolution_time': 0.0
        }
        
        # Category distribution
        for category in self.tickets_data['category'].unique():
            stats['categories'][category] = int(
                (self.tickets_data['category'] == category).sum()
            )
        
        # Priority distribution
        for priority in self.tickets_data['priority'].unique():
            stats['priorities'][priority] = int(
                (self.tickets_data['priority'] == priority).sum()
            )
        
        # Average resolution time
        if 'resolution_time_hours' in self.tickets_data.columns:
            stats['avg_resolution_time'] = float(
                self.tickets_data['resolution_time_hours'].mean()
            )
        
        return stats

class ResolutionSuggestion(BaseModel):
    """Structured resolution suggestion"""
    suggested_resolution: str = Field(description="The recommended resolution steps")
    confidence: float = Field(description="Confidence in the suggestion (0-1)")
    estimated_time: float = Field(description="Estimated resolution time in hours")
