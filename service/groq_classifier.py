"""
Groq-based Ticket Classifier using LangChain and Meta Llama 3.3 70B
Provides ticket classification with confidence scoring
"""

import os
from typing import Dict, List, Optional
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser, PydanticOutputParser
from pydantic import BaseModel, Field
import json
from .logger import setup_logger

load_dotenv()

# Initialize logger
logger = setup_logger(__name__)


class TicketClassification(BaseModel):
    """Structured output for ticket classification"""
    category: str = Field(description="The predicted category")
    confidence: float = Field(description="Confidence score between 0 and 1")
    reasoning: str = Field(description="Brief explanation for the classification")
    all_scores: Dict[str, float] = Field(description="Confidence scores for all categories")


class GroqTicketClassifier:
    """
    LangChain-based ticket classifier using Groq's Meta Llama 3.3 70B model
    """
    
    CATEGORIES = [
        "Infrastructure",
        "Application",
        "Security", 
        "Database",
        "Network",
        "Access Management"
    ]
    
    def __init__(self, model_name: Optional[str] = None):
        """
        Initialize Groq classifier with LangChain
        
        Args:
            model_name: Groq model to use (default: from GROQ_MODEL env variable or llama-3.3-70b-versatile)
        """
        # Use environment variable or provided model_name or default
        self.model_name = model_name or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        api_key = os.getenv("GROQ_API_KEY")
        
        if not api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
        
        # Initialize Groq LLM with LangChain
        self.llm = ChatGroq(
            model=self.model_name,
            temperature=0.1,
            api_key=api_key,
            max_tokens=1000
        )
        
        # Setup output parser
        self.parser = PydanticOutputParser(pydantic_object=TicketClassification)
        
        # Create classification prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert IT support ticket classifier. 
Classify tickets into these categories:
- Infrastructure: Servers, hardware, VMs, CPU, memory, disk, power
- Database: SQL, queries, backups, deadlocks, connections
- Security: Breaches, malware, phishing, SSL, firewall
- Network: Connectivity, routers, switches, DNS, DHCP, bandwidth
- Access Management: Passwords, login, permissions, authentication, MFA
- Application: Software issues, bugs, features, APIs

Provide confidence scores for all categories and select the best match.

{format_instructions}"""),
            ("user", """Ticket Title: {title}
Ticket Description: {description}
Priority: {priority}

Classify this ticket.""")
        ])
        
    def predict(
        self, 
        title: str, 
        description: str, 
        priority: str = "Medium"
    ) -> Dict:
        """
        Classify a single ticket
        
        Args:
            title: Ticket title
            description: Ticket description
            priority: Ticket priority level
            
        Returns:
            dict: Classification results with category, confidence, reasoning
        """
        try:
            # Format prompt with parser instructions
            formatted_prompt = self.prompt.format_messages(
                title=title,
                description=description,
                priority=priority,
                format_instructions=self.parser.get_format_instructions()
            )
            
            # Get LLM response
            response = self.llm.invoke(formatted_prompt)
            
            # Debug: Log raw response
            logger.debug("GroqTicketClassifier | predict | Raw LLM Response")
            logger.debug(f"GroqTicketClassifier | predict | Response content: {response.content[:500]}...")
            
            # Parse structured output
            try:
                result = self.parser.parse(response.content)
                
                logger.debug("GroqTicketClassifier | predict | Parsed successfully!")
                logger.debug(f"GroqTicketClassifier | predict | Category: {result.category}")
                logger.debug(f"GroqTicketClassifier | predict | Confidence: {result.confidence}")
                
                return {
                    "category": result.category,
                    "confidence": result.confidence,
                    "reasoning": result.reasoning,
                    "all_scores": result.all_scores
                }
            except Exception as parse_error:
                # Fallback: Extract category from text response
                logger.error(f"GroqTicketClassifier | predict | Parse error: {parse_error}")
                logger.warning("GroqTicketClassifier | predict | Attempting fallback classification...")
                return self._fallback_classification(response.content, title, description)
                
        except Exception as e:
            error_msg = str(e).lower()
            logger.error(f"GroqTicketClassifier | predict | Classification error: {e}")
            
            # Detect specific error types
            is_api_key_error = ("invalid api key" in error_msg or 
                               "401" in error_msg or 
                               "unauthorized" in error_msg or
                               "authentication" in error_msg or
                               "invalid_api_key" in error_msg)
            is_rate_limit = ("rate_limit_exceeded" in error_msg or 
                            "429" in error_msg or 
                            "rate limit" in error_msg or
                            "too many requests" in error_msg)
            is_model_error = ("model" in error_msg and 
                             ("not found" in error_msg or "invalid" in error_msg))
            
            # Log appropriate warning
            if is_api_key_error:
                logger.warning("GroqTicketClassifier | predict | Groq API Key Error - Using keyword-based classification")
            elif is_rate_limit:
                logger.warning("GroqTicketClassifier | predict | Groq API Rate Limit - Using keyword-based classification")
            elif is_model_error:
                logger.warning("GroqTicketClassifier | predict | Groq Model Error - Using keyword-based classification")
            else:
                logger.warning("GroqTicketClassifier | predict | Groq API Error - Using keyword-based classification")
            
            # Add warning to result
            result = self._fallback_classification("", title, description)
            
            # Determine error type and message
            if is_api_key_error:
                error_type = "api_key"
                error_message = "Invalid or expired Groq API key. Using keyword-based classification."
            elif is_rate_limit:
                error_type = "rate_limit"
                error_message = "Groq API rate limit reached. Using keyword-based classification."
            elif is_model_error:
                error_type = "model_error"
                error_message = "Invalid Groq model specified. Using keyword-based classification."
            else:
                error_type = "api_error"
                error_message = "Groq API error occurred. Using keyword-based classification."
            
            result["api_warning"] = {
                "type": error_type,
                "message": error_message
            }
            return result
    
    def predict_batch(
        self,
        tickets: List[Dict[str, str]]
    ) -> List[Dict]:
        """
        Classify multiple tickets
        
        Args:
            tickets: List of dicts with 'title', 'description', 'priority'
            
        Returns:
            list: Classification results for each ticket
        """
        results = []
        for ticket in tickets:
            result = self.predict(
                title=ticket.get('title', ''),
                description=ticket.get('description', ''),
                priority=ticket.get('priority', 'Medium')
            )
            results.append(result)
        return results
    
    def _fallback_classification(
        self, 
        response_text: str, 
        title: str, 
        description: str
    ) -> Dict:
        """Fallback classification using keyword matching"""
        text = f"{title} {description}".lower()
        
        scores = {}
        for category in self.CATEGORIES:
            scores[category] = 0.0
        
        # Keyword matching
        if any(word in text for word in ['server', 'infrastructure', 'hardware', 'cpu', 'memory']):
            scores['Infrastructure'] = 0.8
        elif any(word in text for word in ['database', 'query', 'sql', 'backup']):
            scores['Database'] = 0.8
        elif any(word in text for word in ['security', 'breach', 'malware', 'firewall']):
            scores['Security'] = 0.8
        elif any(word in text for word in ['network', 'connectivity', 'router', 'dns']):
            scores['Network'] = 0.8
        elif any(word in text for word in ['access', 'password', 'login', 'permission']):
            scores['Access Management'] = 0.8
        else:
            scores['Application'] = 0.7
        
        best_category = max(scores, key=scores.get)
        
        return {
            "category": best_category,
            "confidence": scores[best_category],
            "reasoning": f"Classified based on keyword matching (fallback)",
            "all_scores": scores
        }
    
    def _get_default_classification(self) -> Dict:
        """Return default classification on error"""
        return {
            "category": "Application",
            "confidence": 0.5,
            "reasoning": "Error occurred, using default classification",
            "all_scores": {cat: 0.1 for cat in self.CATEGORIES}
        }

