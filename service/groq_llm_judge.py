"""
LLM-as-Judge Evaluation using Groq Meta Llama 3.3 70B
Evaluates classification quality and resolution suggestions
"""

import os
from typing import Dict, List, Optional
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
import numpy as np
from .logger import setup_logger

load_dotenv()

# Initialize logger
logger = setup_logger(__name__)


class JudgementResult(BaseModel):
    """Structured judgement output"""
    relevance_score: float = Field(description="How relevant is the classification (0-1)")
    accuracy_score: float = Field(description="How accurate is the prediction (0-1)")
    completeness_score: float = Field(description="How complete is the resolution (0-1)")
    overall_score: float = Field(description="Overall quality score (0-1)")
    feedback: str = Field(description="Brief feedback on the evaluation")


class GroqLLMJudge:
    """
    LLM-as-Judge evaluator using Groq's Meta Llama model
    """
    
    def __init__(self, model_name: Optional[str] = None):
        """
        Initialize LLM Judge
        
        Args:
            model_name: Groq model to use for evaluation (default: from GROQ_MODEL env or llama-3.3-70b-versatile)
        """
        # Use environment variable or provided model_name or default
        self.model_name = model_name or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
        
        self.llm = ChatGroq(
            model=self.model_name,
            temperature=0.2,
            api_key=api_key,
            max_tokens=800
        )
        
        # Classification evaluation prompt
        self.classification_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert IT support quality evaluator. 
Evaluate ticket classification quality based on:
1. Relevance: Does the predicted category match the ticket content?
2. Accuracy: Is the confidence score appropriate?
3. Completeness: Does the reasoning make sense?

Provide scores from 0.0 to 1.0 for each aspect."""),
            ("user", """Ticket:
Title: {title}
Description: {description}

Predicted Category: {predicted_category}
Confidence: {confidence}
Reasoning: {reasoning}

Ground Truth Category (if available): {ground_truth}

Evaluate this classification and provide scores.""")
        ])
        
        # Resolution evaluation prompt
        self.resolution_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert IT support quality evaluator.
Evaluate resolution quality based on:
1. Relevance: Does it address the ticket issue?
2. Accuracy: Are the suggested steps technically correct?
3. Completeness: Are all necessary steps included?

Provide scores from 0.0 to 1.0 for each aspect."""),
            ("user", """Ticket:
Title: {title}
Description: {description}
Category: {category}

Suggested Resolution:
{resolution}

Similar Past Resolutions:
{past_resolutions}

Evaluate this resolution suggestion and provide scores.""")
        ])
    
    def evaluate_classification(
        self,
        title: str,
        description: str,
        predicted_category: str,
        confidence: float,
        reasoning: str,
        ground_truth: str = None
    ) -> Dict:
        """
        Evaluate classification quality
        
        Args:
            title: Ticket title
            description: Ticket description
            predicted_category: Predicted category
            confidence: Confidence score
            reasoning: Classification reasoning
            ground_truth: Optional ground truth category
            
        Returns:
            dict: Evaluation scores
        """
        try:
            formatted_prompt = self.classification_prompt.format_messages(
                title=title,
                description=description,
                predicted_category=predicted_category,
                confidence=confidence,
                reasoning=reasoning,
                ground_truth=ground_truth or "Not provided"
            )
            
            response = self.llm.invoke(formatted_prompt)
            
            # Parse scores from response
            scores = self._parse_scores(response.content)
            
            # If ground truth provided, check category match
            if ground_truth:
                category_match = 1.0 if predicted_category == ground_truth else 0.0
                scores['category_match'] = category_match
                # Adjust accuracy based on match
                scores['accuracy_score'] = (scores['accuracy_score'] + category_match) / 2
            
            return scores
            
        except Exception as e:
            logger.error(f"GroqLLMJudge | evaluate_classification | LLM Judge error: {e}")
            return self._get_default_scores()
    
    def evaluate_resolution(
        self,
        title: str,
        description: str,
        category: str,
        resolution: str,
        past_resolutions: List[str] = None
    ) -> Dict:
        """
        Evaluate resolution quality
        
        Args:
            title: Ticket title
            description: Ticket description
            category: Ticket category
            resolution: Suggested resolution
            past_resolutions: Similar past resolutions for context
            
        Returns:
            dict: Evaluation scores
        """
        try:
            past_res_text = "\n".join(past_resolutions) if past_resolutions else "None available"
            
            formatted_prompt = self.resolution_prompt.format_messages(
                title=title,
                description=description,
                category=category,
                resolution=resolution,
                past_resolutions=past_res_text
            )
            
            response = self.llm.invoke(formatted_prompt)
            
            scores = self._parse_scores(response.content)
            
            return scores
            
        except Exception as e:
            logger.error(f"GroqLLMJudge | evaluate_resolution | Resolution evaluation error: {e}")
            return self._get_default_scores()
    
    def evaluate_batch(
        self,
        predictions: List[Dict],
        ground_truths: List[Dict] = None
    ) -> Dict:
        """
        Evaluate multiple predictions
        
        Args:
            predictions: List of prediction dicts
            ground_truths: Optional list of ground truth dicts
            
        Returns:
            dict: Aggregated evaluation metrics
        """
        all_scores = {
            'relevance': [],
            'accuracy': [],
            'completeness': [],
            'overall': []
        }
        
        for i, pred in enumerate(predictions):
            gt = ground_truths[i] if ground_truths and i < len(ground_truths) else None
            
            scores = self.evaluate_classification(
                title=pred.get('title', ''),
                description=pred.get('description', ''),
                predicted_category=pred.get('category', ''),
                confidence=pred.get('confidence', 0.5),
                reasoning=pred.get('reasoning', ''),
                ground_truth=gt.get('category') if gt else None
            )
            
            all_scores['relevance'].append(scores['relevance_score'])
            all_scores['accuracy'].append(scores['accuracy_score'])
            all_scores['completeness'].append(scores['completeness_score'])
            all_scores['overall'].append(scores['overall_score'])
        
        # Calculate aggregated metrics
        return {
            'avg_relevance': float(np.mean(all_scores['relevance'])),
            'avg_accuracy': float(np.mean(all_scores['accuracy'])),
            'avg_completeness': float(np.mean(all_scores['completeness'])),
            'avg_overall': float(np.mean(all_scores['overall'])),
            'num_evaluated': len(predictions)
        }
    
    def _parse_scores(self, response_text: str) -> Dict:
        """Parse scores from LLM response"""
        scores = {
            'relevance_score': 0.7,
            'accuracy_score': 0.7,
            'completeness_score': 0.7,
            'overall_score': 0.7,
            'feedback': response_text[:200]
        }
        
        # Try to extract scores from response
        lines = response_text.lower().split('\n')
        for line in lines:
            if 'relevance' in line:
                scores['relevance_score'] = self._extract_score(line)
            elif 'accuracy' in line:
                scores['accuracy_score'] = self._extract_score(line)
            elif 'completeness' in line or 'complete' in line:
                scores['completeness_score'] = self._extract_score(line)
            elif 'overall' in line:
                scores['overall_score'] = self._extract_score(line)
        
        # Calculate overall if not found
        if scores['overall_score'] == 0.7:
            scores['overall_score'] = (
                scores['relevance_score'] + 
                scores['accuracy_score'] + 
                scores['completeness_score']
            ) / 3
        
        return scores
    
    def _extract_score(self, text: str) -> float:
        """Extract numeric score from text"""
        import re
        
        # Look for decimal numbers between 0 and 1
        matches = re.findall(r'0\.\d+|1\.0|1', text)
        if matches:
            try:
                score = float(matches[0])
                return min(max(score, 0.0), 1.0)
            except:
                pass
        
        # Look for percentages
        matches = re.findall(r'(\d+)%', text)
        if matches:
            try:
                score = float(matches[0]) / 100
                return min(max(score, 0.0), 1.0)
            except:
                pass
        
        return 0.7  # Default
    
    def _get_default_scores(self) -> Dict:
        """Return default scores on error"""
        return {
            'relevance_score': 0.5,
            'accuracy_score': 0.5,
            'completeness_score': 0.5,
            'overall_score': 0.5,
            'feedback': 'Error during evaluation'
        }


# Test
if __name__ == "__main__":
    judge = GroqLLMJudge()
    
    result = judge.evaluate_classification(
        title="Database slow queries",
        description="Queries taking too long to execute, application timeout",
        predicted_category="Database",
        confidence=0.92,
        reasoning="Keywords indicate database performance issue",
        ground_truth="Database"
    )
    
    logger.info("GroqLLMJudge | __main__ | LLM Judge Evaluation:")
    logger.info(f"GroqLLMJudge | __main__ | Relevance: {result['relevance_score']:.3f}")
    logger.info(f"GroqLLMJudge | __main__ | Accuracy: {result['accuracy_score']:.3f}")
    logger.info(f"GroqLLMJudge | __main__ | Completeness: {result['completeness_score']:.3f}")
    logger.info(f"GroqLLMJudge | __main__ | Overall: {result['overall_score']:.3f}")
    logger.info(f"GroqLLMJudge | __main__ | Feedback: {result['feedback']}")
