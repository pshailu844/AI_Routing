from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider
import sys
import os
import traceback
from dotenv import load_dotenv
import numpy as np


# Load environment variables
load_dotenv()

# Import from service package
from service import GroqTicketClassifier, GroqRAGSystem, GroqLLMJudge, GroqAgenticRouter
from service.logger import setup_file_logger

# Initialize logger (logs to logs/ai_ticket_routing_YYYY-MM-DD.log)
logger = setup_file_logger(__name__)

# Custom JSON encoder to handle numpy types
class NumpyJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

# Configure Flask app with new folder structure
app = Flask(__name__,
            static_folder='static',
            template_folder='templates/html')
app.json = NumpyJSONProvider(app)
CORS(app)  # Enable CORS for frontend requests

# Global instances
classifier = None
rag_system = None
judge = None
agentic_router = None
is_initialized = False

def convert_to_serializable(obj):
    """Convert numpy types to native Python types for JSON serialization"""
    if isinstance(obj, dict):
        return {key: convert_to_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_serializable(item) for item in obj]
    elif isinstance(obj, (np.integer, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    else:
        return obj

def calculate_f1_score(confidence, category, similar_tickets):
    """
    Calculate F1 score from confidence and retrieval metrics
    
    F1 = 2 * (precision * recall) / (precision + recall)
    
    Args:
        confidence: Classification confidence score (0-1)
        category: Predicted category
        similar_tickets: List of similar tickets retrieved
    
    Returns:
        float: F1 score (0-1)
    """
    # Precision: Use classification confidence as precision estimate
    # High confidence = high precision (correct when we predict)
    precision = confidence
    
    # Recall: Estimate from retrieval quality
    # If we found relevant similar tickets with high similarity, recall is high
    if similar_tickets and len(similar_tickets) > 0:
        # Average similarity of top-3 tickets as recall estimate
        avg_similarity = sum(t.get('similarity', 0) for t in similar_tickets[:3]) / min(3, len(similar_tickets))
        recall = avg_similarity
    else:
        # No similar tickets found - low recall
        recall = 0.3
    
    # Calculate F1 Score
    if precision + recall > 0:
        f1_score = 2 * (precision * recall) / (precision + recall)
    else:
        f1_score = 0.0
    
    return f1_score

def initialize_system():
    """Initialize Groq classifier, RAG system, LLM Judge, and Agentic Router"""
    global classifier, rag_system, judge, agentic_router, is_initialized
    
    if is_initialized:
        return True
    
    try:
        logger.info("app | initialize_system | Initializing System...")
        
        # Initialize classifier
        logger.info("app | initialize_system | 1. Loading Groq Classifier...")
        classifier = GroqTicketClassifier()
        logger.info("app | initialize_system |   Classifier ready")
        
        # Initialize RAG system
        logger.info("app | initialize_system | 2. Loading Groq RAG System...")
        rag_system = GroqRAGSystem()
        logger.info("app | initialize_system |   RAG system ready")
        
        # Initialize LLM Judge
        logger.info("app | initialize_system | 3. Loading Groq LLM Judge...")
        judge = GroqLLMJudge()
        logger.info("app | initialize_system |   LLM Judge ready")
        
        # Initialize Agentic Router
        logger.info("app | initialize_system | 4. Loading Groq Agentic Router...")
        agentic_router = GroqAgenticRouter()
        logger.info("app | initialize_system |   Agentic Router ready")
        
        # Build FAISS index - NEW PATH
        logger.info("app | initialize_system | 5. Building FAISS index from dataset...")
        csv_path = os.path.join(os.path.dirname(__file__), 'data', 'sample', 'synthetic_tickets_dataset.csv')
        
        if not os.path.exists(csv_path):
            logger.error(f"app | initialize_system | Dataset not found at {csv_path}")
            return False
        
        stats = rag_system.build_index(csv_path)
        logger.info(f"app | initialize_system |   Indexed {stats['num_tickets']} tickets")
        logger.info(f"app | initialize_system |   Embedding dimension: {stats['embedding_dim']}")
        
        is_initialized = True
        logger.info("app | initialize_system | System initialization complete!")
        return True
        
    except Exception as e:
        logger.error(f"app | initialize_system | Initialization error: {e}")
        import traceback
        traceback.print_exc()
        return False

@app.route('/')
def serve_chatbot():
    """Serve the main chatbot HTML page"""
    return send_from_directory('templates/html', 'chatbot.html')

@app.route('/css/<path:filename>')
def serve_css(filename):
    """Serve CSS files"""
    return send_from_directory('templates/css', filename)

@app.route('/js/<path:filename>')
def serve_js(filename):
    """Serve JavaScript files"""
    return send_from_directory('templates/js', filename)

@app.route('/static/<path:filename>')
def serve_static_files(filename):
    """Serve static files (icons, images, etc.)"""
    return send_from_directory('static', filename)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy' if is_initialized else 'initializing',
        'classifier_ready': classifier is not None,
        'rag_ready': rag_system is not None and rag_system.is_built
    })

@app.route('/chat', methods=['POST'])
def chat():
    """Main chat endpoint - handles user messages"""
    try:
        if not is_initialized:
            return jsonify({
                'error': 'System not initialized',
                'message': 'Please wait for system initialization to complete',
                'error_type': 'system_error'
            }), 503
        
        data = request.json
        message = data.get('message', '').strip()
        
        if not message:
            return jsonify({'error': 'No message provided'}), 400
        
        # Detect greetings and casual messages
        message_lower = message.lower()
        
        # Phrases that indicate actual IT issues (not just greetings)
        issue_indicators = [
            'help me', 'help with', 'help to', 'how do i', 'how can i', 'how to',
            'can you help', 'cannot', "can't", 'unable to', 'not working', 'error',
            'issue with', 'problem with', 'trouble with', 'having issues',
            'fix', 'solve', 'resolve', 'access', 'connect', 'login', 'reset',
            'install', 'configure', 'setup', 'crashed', 'slow', 'timeout'
        ]
        
        # Check if message contains IT issue indicators - if so, it's NOT a greeting
        has_issue_content = any(indicator in message_lower for indicator in issue_indicators)
        
        # Pure greeting phrases (standalone only)
        pure_greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 
                         'good evening', 'greetings', 'howdy', 'sup', 'yo', 'hiya', 'hola']
        
        # Pure help requests (asking ABOUT the system, not asking for help WITH an issue)
        system_help_phrases = ['what can you do', 'how to use this', 'what are your features', 
                              'show me features', 'what is this', 'explain this system']
        
        # Greeting detection: SHORT message with ONLY greeting words, NO issue content
        is_greeting = (len(message.split()) <= 4 and 
                      any(phrase in message_lower for phrase in pure_greetings) and
                      not has_issue_content)
        
        # Help request: Asking about the SYSTEM itself, not about fixing an issue
        is_help_request = (any(phrase in message_lower for phrase in system_help_phrases) and 
                          not has_issue_content)
        
        # Handle greetings without running full pipeline
        if is_greeting:
            logger.info(f"app | chat | Detected greeting: {message}")
            greeting_response = """Hello! 👋 Welcome to AI Ticket Support!

I'm here to help you with IT support issues. Here's how I can assist you:

**What I Can Do:**
• **Classify Issues** - Automatically categorize your IT problems
• **Find Solutions** - Retrieve similar past tickets and resolutions
• **Suggest Routing** - Recommend the right support team
• **Provide Estimates** - Give resolution time predictions
**How to Get Started:**
1. **Describe Your Issue** 
   Example: "My database connection keeps timing out"
2. **Browse Tickets** 
   Click the "Browse Tickets" button to explore 1000+ historical tickets
3. **Review New Tickets**
   Click "New Tickets" to see unresolved issues with AI analysis
4. **Get Statistics**
   Click "Database Stats" for insights and trends
**Try asking me something like:**
• "I can't access the VPN"
• "Email server is down"
• "Need password reset"
• "Application error 500"
What issue can I help you with today?"""
            
            return jsonify({
                'response': greeting_response,
                'is_greeting': True,
                'metadata': {
                    'message_type': 'greeting'
                }
            })
        
        # Handle help requests
        if is_help_request:
            logger.info(f"app | chat | Detected help request: {message}")
            help_response = """**How to Use AI Ticket Support**

**Quick Guide:**

1. **For Specific Issues:**
   - Type your IT problem in plain English
   - Example: "Cannot connect to database"
   - I'll classify it, find similar tickets, and suggest solutions

2. **Browse Historical Data:**
   - **Browse Tickets** - Explore 1000+ resolved tickets by category
   - **New Tickets** - Review unprocessed tickets with AI analysis
   - **Database Stats** - View system statistics and insights

3. **Interactive Features:**
   - Click on any ticket to discuss it
   - Ask follow-up questions about solutions
   - Get routing and escalation recommendations

**Sample Questions:**
• "My application keeps crashing"
• "VPN connection failed"
• "Database performance is slow"
• "Need admin access to the system"

**What would you like help with?**"""
            
            return jsonify({
                'response': help_response,
                'is_help': True,
                'metadata': {
                    'message_type': 'help'
                }
            })
        
        # Step 1: Classify the ticket/query (for actual issues)
        logger.info(f"app | chat | Classifying query: {message[:50]}...")
        classification = classifier.predict(
            title=message,
            description=message,
            priority="Medium"
        )
        
        # Check if API error occurred in classification
        if 'api_warning' in classification:
            warning = classification['api_warning']
            warning_type = warning.get('type', 'api_error')
            
            # Map warning types to error responses with detailed explanations
            if 'rate_limit' in warning_type:
                return jsonify({
                    'error': 'Rate Limit Exceeded',
                    'message': 'Too Many Requests: You have exceeded Groq API rate limits.',
                    'error_type': 'rate_limit_error',
                    'action': 'Groq\'s free tier limits requests per minute. Wait 2-3 minutes before trying again, or upgrade your Groq account for higher limits at https://console.groq.com'
                }), 429
            elif 'api_key' in warning_type or 'unauthorized' in warning_type or 'authentication' in warning_type:
                # Get current API key (mask it for security)
                current_key = os.getenv('GROQ_API_KEY', 'not set')
                masked_key = current_key[:8] + '...' if len(current_key) > 8 else 'not set'
                
                return jsonify({
                    'error': 'Invalid API Key',
                    'message': f'Authentication Failed: The API key "{masked_key}" is invalid or expired.',
                    'error_type': 'api_key_error',
                    'action': 'Your Groq API key is wrong or expired. Fix this: 1) Go to https://console.groq.com/keys 2) Create a new API key 3) Open your .env file 4) Update the line: GROQ_API_KEY=your_new_key_here 5) Restart the server'
                }), 401
            elif 'model' in warning_type:
                current_model = os.getenv('GROQ_MODEL', 'not set')
                return jsonify({
                    'error': 'Invalid Model',
                    'message': f'Model Error: The model "{current_model}" does not exist or is unavailable.',
                    'error_type': 'model_error',
                    'action': f'The model name "{current_model}" in your .env file is incorrect. Fix this: 1) Open your .env file 2) Change GROQ_MODEL to: llama-3.3-70b-versatile 3) Restart the server. Available models: llama-3.3-70b-versatile, mixtral-8x7b-32768, gemma2-9b-it'
                }), 400
            else:
                return jsonify({
                    'error': 'API Error',
                    'message': 'Groq API Error: Something went wrong connecting to Groq servers.',
                    'error_type': 'api_error',
                    'action': 'Groq service may be temporarily down. Check: 1) Your internet connection 2) Groq status at https://status.groq.com 3) Try again in a few minutes'
                }), 500
        
        category = classification['category']
        confidence = classification['confidence']
        
        logger.info(f"app | chat | Category: {category} (confidence: {confidence:.3f})")
        
        # Check if this is a NEW category
        existing_categories = set(rag_system.tickets_data['category'].unique())
        is_new_category = category not in existing_categories
        
        # Step 2: Get resolution from RAG system
        logger.info("app | chat | Searching for similar tickets...")
        
        # Detect if this is a generic query (asking to see tickets) vs. a specific issue
        is_generic_query = any(phrase in message.lower() for phrase in [
            'show me', 'can you provide', 'list', 'give me examples',
            'what are', 'tell me about', 'provide', 'similar issue'
        ])
        
        # For generic queries, search without strict category filter for better results
        if is_generic_query:
            logger.info("app | chat | Detected generic query - broader search without category filter")
            resolution_data = rag_system.get_resolution_with_llm(
                title=message,
                description=message,
                category=None,  # Don't filter by category for generic queries
                priority="Medium",
                top_k=5  # Get more results for browsing
            )
        else:
            resolution_data = rag_system.get_resolution_with_llm(
                title=message,
                description=message,
                category=category,
                priority="Medium",
                top_k=3
            )
        
        # Step 3: Evaluate with LLM Judge
        logger.info("app | chat | Evaluating with LLM Judge...")
        
        # Evaluate classification quality
        classification_eval = judge.evaluate_classification(
            title=message,
            description=message,
            predicted_category=category,
            confidence=confidence,
            reasoning=classification.get('reasoning', '')
        )
        
        # Prepare response
        ai_response = resolution_data['resolution']
        similar_tickets = resolution_data.get('similar_tickets', [])
        
        # Evaluate resolution quality
        past_resolutions = [t.get('resolution', '') for t in similar_tickets[:3]]
        resolution_eval = judge.evaluate_resolution(
            title=message,
            description=message,
            category=category,
            resolution=ai_response,
            past_resolutions=past_resolutions
        )
        
        # Step 4: Calculate F1 Score
        f1_score = calculate_f1_score(confidence, category, similar_tickets)
        
        logger.info(f"app | chat | F1 Score: {f1_score:.3f} (Precision: {confidence:.3f}, Recall: based on similarity)")
        
        # Calculate overall quality grade
        overall_score = (classification_eval['overall_score'] + resolution_eval['overall_score']) / 2
        quality_grade = 'A' if overall_score >= 0.9 else \
                       'B' if overall_score >= 0.75 else \
                       'C' if overall_score >= 0.6 else 'D'
        
        logger.info(f"app | chat | LLM Judge - Classification: {classification_eval['overall_score']:.3f}, "
                   f"Resolution: {resolution_eval['overall_score']:.3f}, Grade: {quality_grade}")
        
        # Calculate max similarity
        max_similarity = 0.0
        if similar_tickets and len(similar_tickets) > 0:
            max_similarity = max(t.get('similarity', 0) for t in similar_tickets)
        
        # Step 5: Use Agentic Router for intelligent routing decision
        logger.info("app | chat | Getting routing decision from Agentic Router...")
        routing_decision = agentic_router.route_ticket(
            title=message,
            description=message,
            category=category,
            priority="Medium",
            confidence=confidence,
            quality_grade=quality_grade,
            f1_score=f1_score,
            max_similarity=max_similarity,
            is_new_category=is_new_category,
            similar_tickets=similar_tickets[:3],
            additional_context=f"Similar tickets found: {len(similar_tickets)}, Generic query: {is_generic_query}"
        )
        
        escalation_team = routing_decision['full_team_assignment']
        team_level = routing_decision['routing_level']
        
        logger.info(f"app | chat | Agentic Routing: {escalation_team}")
        logger.info(f"app | chat | Priority Adjustment: {routing_decision['priority_adjustment']}")
        logger.info(f"app | chat | Estimated Time: {routing_decision['estimated_resolution_time']} hours")
        logger.info(f"app | chat | Routing Confidence: {routing_decision['confidence']:.3f}")
        
        # If NEW category detected, add warning message
        if is_new_category and (not similar_tickets or resolution_data.get('confidence', 0) < 0.4):
            # Calculate actual max similarity from similar tickets
            max_similarity = 0.0
            if similar_tickets and len(similar_tickets) > 0:
                max_similarity = max(t.get('similarity', 0) for t in similar_tickets)
            
            new_category_warning = f"\n\n**NEW CATEGORY DETECTED: {category}**\n\n"
            new_category_warning += "**Important Notice:**\n"
            new_category_warning += "- This appears to be a NEW type of issue not in our existing knowledge base\n"
            new_category_warning += f"- No similar historical tickets found in category: {category}\n"
            new_category_warning += f"- Similarity with existing tickets: {max_similarity:.1%}\n"
            new_category_warning += "- **Recommendation:** Escalate to senior support team for manual review\n"
            new_category_warning += "- This ticket requires specialized expertise outside standard procedures\n\n"
            new_category_warning += "**Suggested Actions:**\n"
            new_category_warning += "1. Document this as a new category for future reference\n"
            new_category_warning += "2. Consult with domain experts in this area\n"
            new_category_warning += "3. Create new resolution procedures\n"
            new_category_warning += "4. Update knowledge base after resolution\n\n"
            new_category_warning += "---\n\n"
            ai_response = new_category_warning + ai_response
        
        logger.info(f"app | chat | Found {len(similar_tickets)} similar tickets")
        logger.info(f"app | chat | Generated response (length: {len(ai_response)} chars)")
        logger.info(f"app | chat | Is new category: {is_new_category}")
        
        # Convert numpy types to native Python types for JSON serialization
        response_data = {
            'response': ai_response,
            'classification': {
                'category': category,
                'confidence': float(confidence),
                'reasoning': classification.get('reasoning', ''),
                'is_new_category': is_new_category
            },
            'similar_tickets': convert_to_serializable(similar_tickets[:3]),
            'llm_judge': {
                'classification_score': float(classification_eval['overall_score']),
                'resolution_score': float(resolution_eval['overall_score']),
                'overall_score': float(overall_score),
                'quality_grade': quality_grade,
                'relevance': float(classification_eval['relevance_score']),
                'accuracy': float(classification_eval['accuracy_score']),
                'completeness': float(resolution_eval['completeness_score']),
                'f1_score': float(f1_score)
            },
            'routing': {
                'team': escalation_team,
                'base_team': routing_decision['team'],
                'level': team_level,
                'priority_adjustment': routing_decision['priority_adjustment'],
                'routing_confidence': float(routing_decision['confidence']),
                'reasoning': routing_decision['reasoning'],
                'estimated_resolution_time': float(routing_decision['estimated_resolution_time']),
                'recommended_actions': routing_decision['recommended_actions'],
                'requires_escalation': routing_decision['requires_escalation'],
                'is_agentic': routing_decision['is_agentic']
            },
            'metadata': {
                'priority': 'Medium',  # Default priority for user queries
                'estimated_time': float(routing_decision['estimated_resolution_time']),
                'num_similar_found': len(similar_tickets),
                'is_new_category': is_new_category
            }
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"app | chat | Chat endpoint error: {e}")
        import traceback
        traceback.print_exc()
        
        # Detect specific API errors
        error_message = str(e).lower()
        
        if 'api key' in error_message or 'authentication' in error_message or 'unauthorized' in error_message:
            return jsonify({
                'error': str(e),
                'message': 'API Key Error: Your Groq API key is invalid or expired. Please check your .env file.',
                'error_type': 'api_key_error',
                'action': 'Update GROQ_API_KEY in .env file'
            }), 401
        elif 'rate limit' in error_message or 'too many requests' in error_message or 'quota' in error_message:
            return jsonify({
                'error': str(e),
                'message': 'Rate Limit Exceeded: Groq API rate limit reached. Please try again in a few moments.',
                'error_type': 'rate_limit_error',
                'action': 'Wait a few minutes before sending more requests'
            }), 429
        elif 'model' in error_message and ('not found' in error_message or 'invalid' in error_message):
            return jsonify({
                'error': str(e),
                'message': 'Model Error: The specified Groq model is not available or invalid.',
                'error_type': 'model_error',
                'action': 'Check GROQ_MODEL in .env file (should be llama-3.3-70b-versatile)'
            }), 400
        else:
            return jsonify({
                'error': str(e),
                'message': 'An error occurred while processing your request. Please try again.',
                'error_type': 'general_error'
            }), 500

@app.route('/classify', methods=['POST'])
def classify_only():
    """Classification-only endpoint"""
    try:
        if not is_initialized:
            return jsonify({'error': 'System not initialized'}), 503
        
        data = request.json
        message = data.get('message', '').strip()
        
        if not message:
            return jsonify({'error': 'No message provided'}), 400
        
        classification = classifier.predict(
            title=message,
            description=message,
            priority=data.get('priority', 'Medium')
        )
        
        return jsonify(classification)
        
    except Exception as e:
        logger.error(f"app | classify_only | Classification error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/similar', methods=['POST'])
def find_similar():
    """Find similar tickets endpoint"""
    try:
        if not is_initialized:
            return jsonify({'error': 'System not initialized'}), 503
        
        data = request.json
        query = data.get('query', '').strip()
        top_k = data.get('top_k', 5)
        category = data.get('category')
        
        if not query:
            return jsonify({'error': 'No query provided'}), 400
        
        similar = rag_system.search_similar(
            query=query,
            top_k=top_k,
            category_filter=category
        )
        
        return jsonify({
            'similar_tickets': similar,
            'total_found': len(similar)
        })
        
    except Exception as e:
        logger.error(f"app | find_similar | Similar search error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get database statistics"""
    try:
        if not is_initialized or not rag_system.is_built:
            return jsonify({'error': 'System not ready'}), 503
        
        stats = rag_system.get_category_statistics()
        return jsonify(stats)
        
    except Exception as e:
        logger.error(f"app | get_stats | Stats error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/all_tickets', methods=['GET'])
def get_all_tickets():
    """Get all tickets from the database"""
    try:
        if not is_initialized or not rag_system.is_built:
            return jsonify({'error': 'System not ready'}), 503
        
        # Get tickets from RAG system's database
        tickets_data = rag_system.tickets_data.to_dict('records')
        
        # Convert to serializable format
        tickets = convert_to_serializable(tickets_data)
        
        return jsonify({
            'tickets': tickets,
            'total': len(tickets)
        })
        
    except Exception as e:
        logger.error(f"app | get_all_tickets | All tickets error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/new_tickets', methods=['GET'])
def get_new_tickets():
    """Get new tickets with similarity analysis and escalation recommendation"""
    try:
        logger.info("app | get_new_tickets | Request received")
        
        if not is_initialized or not rag_system.is_built:
            logger.error("app | get_new_tickets | System not ready")
            return jsonify({'error': 'System not ready'}), 503
        
        import pandas as pd
        
        # Load new tickets from separate dataset - NEW PATH
        new_tickets_path = os.path.join(os.path.dirname(__file__), 'data', 'sample', 'new_tickets_dataset.csv')
        
        logger.info(f"app | get_new_tickets | Loading from: {new_tickets_path}")
        
        if os.path.exists(new_tickets_path):
            new_tickets_df = pd.read_csv(new_tickets_path)
            # Limit to 50 tickets for performance
            new_tickets = new_tickets_df.head(50).to_dict('records')
            logger.info(f"app | get_new_tickets | Loaded {len(new_tickets)} tickets from CSV")
        else:
            logger.warning("app | get_new_tickets | CSV not found, using fallback")
            # Fallback: use last 20 tickets
            all_tickets = rag_system.tickets_data.to_dict('records')
            new_tickets = all_tickets[-20:]
        
        # Get existing categories from the original dataset
        existing_categories = set(rag_system.tickets_data['category'].unique())
        logger.info(f"app | get_new_tickets | Existing categories: {existing_categories}")
        
        # Analyze each new ticket (SIMPLIFIED - no heavy encoding)
        analyzed_tickets = []
        for idx, ticket in enumerate(new_tickets):
            try:
                # Use FAISS search instead of manual similarity calculation
                # This is MUCH faster!
                search_results = rag_system.search_similar(
                    query=ticket['description'],
                    top_k=1,
                    category_filter=None
                )
                
                if search_results and len(search_results) > 0:
                    max_similarity = search_results[0].get('similarity', 0.0)
                    most_similar_ticket_id = search_results[0].get('ticket_id', 'N/A')
                else:
                    max_similarity = 0.0
                    most_similar_ticket_id = None
                
                # Get category from ticket data or use Unknown
                actual_category = ticket.get('category', 'Unknown')
                is_new_category = actual_category not in existing_categories
                
                # Base team assignment
                team_mapping = {
                    'Infrastructure': 'Infrastructure Team',
                    'Database': 'Database Admin Team',
                    'Security': 'Security Operations Center',
                    'Network': 'Network Operations Team',
                    'Access Management': 'IAM Team',
                    'Application': 'Application Support Team',
                    'Unknown': 'General Support Team'
                }
                base_team = team_mapping.get(actual_category, 'General Support Team')
                
                # SIMPLIFIED escalation logic (no classification call)
                if is_new_category or max_similarity < 0.4:
                    escalation_team = f"{base_team} (Manual Review Required)"
                elif max_similarity >= 0.7:
                    escalation_team = f"{base_team} (L1 Support)"
                elif max_similarity >= 0.5:
                    escalation_team = f"{base_team} (L2 Support)"
                else:
                    escalation_team = f"{base_team} (L2 Support)"
                
                analyzed_tickets.append({
                    'ticket_id': ticket.get('ticket_id', f'TKT-NEW-{idx+1:03d}'),
                    'title': ticket.get('title', 'No title'),
                    'description': ticket.get('description', 'No description')[:200],  # Limit description
                    'category': actual_category,
                    'priority': ticket.get('priority', 'Medium'),
                    'confidence': 0.85 if not is_new_category else 0.50,  # Static confidence
                    'max_similarity': float(max_similarity),
                    'similar_ticket_id': most_similar_ticket_id,
                    'escalation_team': escalation_team,
                    'resolution_time': float(ticket.get('resolution_time_hours', 4.0)),
                    'is_new_category': is_new_category
                })
                
            except Exception as ticket_error:
                logger.error(f"app | get_new_tickets | Error processing ticket {idx}: {ticket_error}")
                continue
        
        logger.info(f"app | get_new_tickets | Analyzed {len(analyzed_tickets)} tickets successfully")
        
        # Sort by priority
        priority_order = {'High': 3, 'Medium': 2, 'Low': 1}
        analyzed_tickets.sort(
            key=lambda x: (priority_order.get(x['priority'], 0), -x['max_similarity']),
            reverse=True
        )
        
        return jsonify({
            'tickets': analyzed_tickets,
            'total': len(analyzed_tickets)
        })
        
    except Exception as e:
        logger.error(f"app | get_new_tickets | Critical error: {e}")
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'message': 'Failed to load new tickets. Please try again.'
        }), 500

if __name__ == '__main__':
    # Initialize system on startup
    logger.info("app | __main__ | " + "="*60)
    logger.info("app | __main__ | AI Ticket Support Chatbot - Backend Server")
    logger.info("app | __main__ | " + "="*60)
    
    if initialize_system():
        logger.info("app | __main__ | Starting Flask server...")
        logger.info("app | __main__ | Endpoints:")
        logger.info("app | __main__ |   - POST /chat      : Send chat messages")
        logger.info("app | __main__ |   - POST /classify  : Classify tickets only")
        logger.info("app | __main__ |   - POST /similar   : Find similar tickets")
        logger.info("app | __main__ |   - GET  /stats     : Get database statistics")
        logger.info("app | __main__ |   - GET  /health    : Health check")
        logger.info("app | __main__ | " + "="*60)
        
        app.run(debug=True, host='0.0.0.0', port=5000)
    else:
        logger.error("app | __main__ | Failed to initialize system. Please check errors above.")
