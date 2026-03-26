"""
Groq-based Agentic AI Router using LangChain and Meta Llama 3.3 70B
Provides intelligent ticket routing decisions using AI reasoning
"""

import os
from typing import Dict, Optional, List
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field
from .logger import setup_logger

load_dotenv()

# Initialize logger
logger = setup_logger(__name__)


class RoutingDecision(BaseModel):
    """Structured output for agentic routing decision"""
    routing_level: str = Field(description="L1 Support, L2 Support, or Manual Review Required")
    team: str = Field(description="The assigned support team")
    priority_adjustment: str = Field(description="Keep, Escalate, or De-escalate priority")
    confidence: float = Field(description="Confidence in routing decision (0-1)")
    reasoning: str = Field(description="Detailed explanation for the routing decision")
    estimated_resolution_time: float = Field(description="Estimated hours to resolve")
    recommended_actions: List[str] = Field(description="List of recommended actions for the support team")
    requires_escalation: bool = Field(description="Whether this needs immediate escalation")


class GroqAgenticRouter:
    """
    AI-powered ticket router using Groq's LLM for intelligent routing decisions.
    
    This agentic router uses AI reasoning to:
    - Analyze all available metrics (confidence, quality, similarity, F1 score)
    - Consider ticket context (category, priority, description)
    - Make nuanced routing decisions with explanations
    - Provide actionable recommendations for support teams
    - Adjust priorities based on severity and complexity
    """
    
    TEAM_MAPPING = {
        'Infrastructure': 'Infrastructure Team',
        'Database': 'Database Admin Team',
        'Security': 'Security Operations Center',
        'Network': 'Network Operations Team',
        'Access Management': 'IAM Team',
        'Application': 'Application Support Team',
        'Unknown': 'General Support Team'
    }
    
    def __init__(self, model_name: Optional[str] = None):
        """
        Initialize Groq Agentic Router
        
        Args:
            model_name: Groq model to use (default: from GROQ_MODEL env or llama-3.3-70b-versatile)
        """
        self.model_name = model_name or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        api_key = os.getenv("GROQ_API_KEY")
        
        if not api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
        
        # Initialize Groq LLM with higher temperature for more nuanced reasoning
        self.llm = ChatGroq(
            model=self.model_name,
            temperature=0.3,  # Slightly higher for more creative routing decisions
            api_key=api_key,
            max_tokens=1500
        )
        
        # Setup output parser
        self.parser = PydanticOutputParser(pydantic_object=RoutingDecision)
        
        # Create routing prompt with detailed instructions
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert IT support routing agent with deep knowledge of ticket escalation best practices.

Your role is to analyze tickets and make intelligent routing decisions based on:
1. Classification metrics (category, confidence)
2. Quality scores (LLM Judge grade A/B/C/D)
3. Similarity to historical tickets
4. F1 score (balance of precision and recall)
5. Ticket context (priority, description, category)

ROUTING LEVELS:
- L1 Support: Simple, well-understood issues with high confidence. Can be auto-resolved or handled by junior staff.
- L2 Support: Moderate complexity requiring experienced engineers. Medium confidence or unique variations.
- Manual Review Required: Complex, novel, or critical issues requiring senior expert review.

TEAM ASSIGNMENTS:
- Infrastructure Team: Servers, hardware, VMs, CPU, memory, disk, power
- Database Admin Team: SQL, queries, backups, deadlocks, connections
- Security Operations Center: Breaches, malware, phishing, SSL, firewall
- Network Operations Team: Connectivity, routers, switches, DNS, DHCP
- IAM Team: Passwords, login, permissions, authentication, MFA
- Application Support Team: Software issues, bugs, features, APIs
- General Support Team: Unclear or multi-domain issues

PRIORITY ADJUSTMENTS:
- Escalate: Security breaches, production outages, data loss risks
- Keep: Normal operational issues matching current priority
- De-escalate: Non-urgent, informational, or duplicate tickets

DECISION CRITERIA:
- Quality Grade D or F1 < 0.5 → Manual Review (poor confidence)
- New category with no similar tickets → Manual Review (novel issue)
- High confidence (>0.75) + Good quality (A/B) + Good F1 (>0.7) → L1 Support
- Security category with any concern → Consider Manual Review or priority escalation
- Production-impacting keywords → Consider priority escalation
- Medium metrics → L2 Support

Provide detailed reasoning and actionable recommendations.

{format_instructions}"""),
            ("user", """Analyze this ticket and provide routing decision:

**Ticket Information:**
Title: {title}
Description: {description}
Category: {category}
Current Priority: {priority}

**AI Metrics:**
Classification Confidence: {confidence:.3f}
LLM Judge Quality Grade: {quality_grade}
F1 Score: {f1_score:.3f}
Max Similarity to Historical Tickets: {max_similarity:.3f}
Is New Category: {is_new_category}

**Similar Tickets Found:**
{similar_tickets_summary}

**Additional Context:**
{additional_context}

Based on all this information, provide your routing decision with detailed reasoning.""")
        ])
    
    def route_ticket(
        self,
        title: str,
        description: str,
        category: str,
        priority: str,
        confidence: float,
        quality_grade: str,
        f1_score: float,
        max_similarity: float,
        is_new_category: bool,
        similar_tickets: Optional[List[Dict]] = None,
        additional_context: Optional[str] = None
    ) -> Dict:
        """
        Make an AI-powered routing decision for a ticket
        
        Args:
            title: Ticket title
            description: Ticket description
            category: Predicted category
            priority: Current priority level
            confidence: Classification confidence (0-1)
            quality_grade: LLM Judge quality grade (A/B/C/D)
            f1_score: F1 score (0-1)
            max_similarity: Maximum similarity to historical tickets (0-1)
            is_new_category: Whether this is a new category
            similar_tickets: List of similar tickets found
            additional_context: Any additional context for routing
            
        Returns:
            dict: Routing decision with level, team, reasoning, and recommendations
        """
        try:
            # Prepare similar tickets summary
            if similar_tickets and len(similar_tickets) > 0:
                tickets_summary = "\n".join([
                    f"- Ticket {t.get('ticket_id', 'N/A')}: {t.get('title', 'No title')[:60]}... "
                    f"(Similarity: {t.get('similarity', 0):.2%})"
                    for t in similar_tickets[:3]
                ])
            else:
                tickets_summary = "No similar tickets found in historical database"
            
            # Add default context if none provided
            if not additional_context:
                additional_context = "No additional context provided"
            
            # Format prompt
            formatted_prompt = self.prompt.format_messages(
                title=title,
                description=description,
                category=category,
                priority=priority,
                confidence=confidence,
                quality_grade=quality_grade,
                f1_score=f1_score,
                max_similarity=max_similarity,
                is_new_category=is_new_category,
                similar_tickets_summary=tickets_summary,
                additional_context=additional_context,
                format_instructions=self.parser.get_format_instructions()
            )
            
            logger.info(f"[Agentic Router] Analyzing ticket: {title[:50]}...")
            
            # Get LLM routing decision
            response = self.llm.invoke(formatted_prompt)
            
            # Parse structured output
            try:
                result = self.parser.parse(response.content)
                
                logger.info(f"[Agentic Router] Decision: {result.routing_level}")
                logger.info(f"[Agentic Router] Team: {result.team}")
                logger.info(f"[Agentic Router] Confidence: {result.confidence:.3f}")
                
                # Get base team from category
                base_team = self.TEAM_MAPPING.get(category, 'General Support Team')
                
                # Format team with routing level
                full_team_assignment = f"{base_team} ({result.routing_level})"
                
                return {
                    'routing_level': result.routing_level,
                    'team': result.team,
                    'full_team_assignment': full_team_assignment,
                    'priority_adjustment': result.priority_adjustment,
                    'confidence': result.confidence,
                    'reasoning': result.reasoning,
                    'estimated_resolution_time': result.estimated_resolution_time,
                    'recommended_actions': result.recommended_actions,
                    'requires_escalation': result.requires_escalation,
                    'is_agentic': True  # Flag to indicate this used agentic routing
                }
                
            except Exception as parse_error:
                logger.error(f"[Agentic Router] Parse error: {parse_error}")
                logger.warning("[Agentic Router] Falling back to rule-based routing")
                return self._fallback_routing(
                    category, confidence, quality_grade, f1_score, 
                    is_new_category, max_similarity
                )
                
        except Exception as e:
            logger.error(f"[Agentic Router] Error: {e}")
            return self._fallback_routing(
                category, confidence, quality_grade, f1_score, 
                is_new_category, max_similarity
            )
    
    def _fallback_routing(
        self,
        category: str,
        confidence: float,
        quality_grade: str,
        f1_score: float,
        is_new_category: bool,
        max_similarity: float
    ) -> Dict:
        """
        Fallback to rule-based routing if AI fails
        
        This ensures the system always provides a routing decision
        even if the AI agent encounters errors.
        Uses actual dynamic values from classifier, judge, and RAG system.
        """
        logger.info("[Agentic Router] Using fallback rule-based routing")
        
        base_team = self.TEAM_MAPPING.get(category, 'General Support Team')
        
        # Rule-based logic (same as original system)
        if quality_grade == 'D' or f1_score < 0.5:
            level = "Manual Review Required"
        elif is_new_category:
            level = "Manual Review Required"
        elif confidence >= 0.75 and quality_grade in ['A', 'B'] and f1_score >= 0.7:
            level = "L1 Support"
        elif confidence >= 0.6 and f1_score >= 0.6:
            level = "L2 Support"
        else:
            level = "L2 Support"
        
        full_team = f"{base_team} ({level})"
        
        # Estimate resolution time based on routing level and similarity
        # Use dynamic calculation based on similarity score
        if level == "L1 Support":
            # L1 issues with high similarity resolve faster
            estimated_time = 1.0 + (1.0 - max_similarity) * 2.0  # 1-3 hours
        elif level == "L2 Support":
            # L2 issues take longer, less similarity = more time
            estimated_time = 2.0 + (1.0 - max_similarity) * 4.0  # 2-6 hours
        else:  # Manual Review
            # Complex issues require more investigation
            estimated_time = 4.0 + (1.0 - max_similarity) * 8.0  # 4-12 hours
        
        # Priority adjustment based on category and confidence
        if category == 'Security' and confidence > 0.7:
            priority_adj = 'Escalate'
        elif category in ['Database', 'Network'] and confidence > 0.8:
            priority_adj = 'Escalate'
        elif confidence < 0.5 or quality_grade == 'D':
            priority_adj = 'Keep'  # Don't escalate uncertain tickets
        else:
            priority_adj = 'Keep'
        
        return {
            'routing_level': level,
            'team': base_team,
            'full_team_assignment': full_team,
            'priority_adjustment': priority_adj,  # Dynamic based on category and confidence
            'confidence': confidence,  # Use actual confidence from classifier (not hardcoded)
            'reasoning': f'Fallback rule-based routing due to AI error. Category: {category}, Confidence: {confidence:.2f}, Quality: {quality_grade}, F1: {f1_score:.2f}, Similarity: {max_similarity:.2f}',
            'estimated_resolution_time': round(estimated_time, 1),  # Dynamic calculation
            'recommended_actions': self._get_fallback_actions(level, category, is_new_category),
            'requires_escalation': level == "Manual Review Required",
            'is_agentic': False  # Flag to indicate fallback was used
        }
    
    def _get_fallback_actions(self, level: str, category: str, is_new_category: bool) -> List[str]:
        """
        Generate dynamic recommended actions based on routing level and category
        
        Args:
            level: Routing level (L1, L2, Manual Review)
            category: Ticket category
            is_new_category: Whether this is a new category
            
        Returns:
            List of recommended actions
        """
        actions = []
        
        # Common first action
        if level == "Manual Review Required":
            actions.append("Escalate to senior support team immediately")
        else:
            actions.append("Review ticket details and context")
        
        # Category-specific actions
        if category == 'Security':
            actions.append("Check security logs and access patterns")
            actions.append("Verify no unauthorized access occurred")
        elif category == 'Database':
            actions.append("Check database server health and performance metrics")
            actions.append("Review recent queries and connection logs")
        elif category == 'Network':
            actions.append("Verify network connectivity and routing tables")
            actions.append("Check switch/router status and configurations")
        elif category == 'Infrastructure':
            actions.append("Monitor server resources (CPU, memory, disk)")
            actions.append("Check system logs for errors or warnings")
        elif category == 'Access Management':
            actions.append("Verify user identity and authentication status")
            actions.append("Review access permissions and group memberships")
        else:  # Application or Unknown
            actions.append("Gather application logs and error details")
            actions.append("Check recent deployments or configuration changes")
        
        # New category handling
        if is_new_category:
            actions.append("Document this as a new issue type for knowledge base")
            actions.append("Consult with domain experts for specialized guidance")
        
        return actions
    
    def batch_route_tickets(
        self,
        tickets: List[Dict]
    ) -> List[Dict]:
        """
        Route multiple tickets using agentic AI
        
        Args:
            tickets: List of ticket dicts with all required fields
            
        Returns:
            list: Routing decisions for each ticket
        """
        results = []
        for ticket in tickets:
            result = self.route_ticket(
                title=ticket.get('title', ''),
                description=ticket.get('description', ''),
                category=ticket.get('category', 'Unknown'),
                priority=ticket.get('priority', 'Medium'),
                confidence=ticket.get('confidence', 0.5),
                quality_grade=ticket.get('quality_grade', 'C'),
                f1_score=ticket.get('f1_score', 0.5),
                max_similarity=ticket.get('max_similarity', 0.0),
                is_new_category=ticket.get('is_new_category', False),
                similar_tickets=ticket.get('similar_tickets', []),
                additional_context=ticket.get('additional_context', None)
            )
            results.append(result)
        return results
