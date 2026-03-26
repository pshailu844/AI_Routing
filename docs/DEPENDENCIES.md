# Project Dependencies & Technologies

## Core Technologies

**Flask** - Lightweight web framework that runs our backend server and serves the frontend  
**Python 3** - Programming language that powers the entire backend system

## AI & Machine Learning

**Groq API** - Fast AI inference service that classifies tickets and generates responses  
  - Model: `llama-3.3-70b-versatile` (Meta's Llama 3.3 70B parameter model)
  - Used for: Ticket classification, response generation, LLM judge evaluation, and agentic routing
  
**LangChain** - Framework that helps us chain AI prompts and manage conversations  

**Sentence Transformers** - Converts ticket text into numerical vectors for similarity search  
  - Model: `sentence-transformers/all-MiniLM-L6-v2` 
  - Embedding dimension: 384
  - Used for: Creating semantic embeddings of tickets for similarity matching
  
**FAISS** - Facebook's library for ultra-fast similarity search across thousands of tickets  
  - Index: L2 distance metric
  - Stores: 1000 ticket embeddings from historical dataset
  
**scikit-learn** - Provides machine learning utilities for evaluation metrics

## Data Processing

**Pandas** - Handles CSV files and ticket data manipulation  
**NumPy** - Powers numerical computations and array operations  
**Joblib** - Saves and loads trained models efficiently

## Web & API

**Flask-CORS** - Allows frontend to communicate with backend from different ports  
**python-dotenv** - Loads API keys and secrets from .env file safely

## Validation

**Pydantic** - Validates data structures and ensures type safety

## Smart Routing System (Rule-Based, Not Agentic AI)

**Important:** Routing is done through **intelligent rule-based logic**, not a separate AI agent.

**Routing Decision Inputs:**
- **Classification Confidence** from Groq classifier (0-1 score)
- **Quality Grade** from LLM Judge (A, B, C, D grade)
- **F1 Score** calculated from precision (confidence) and recall (similarity)
- **Similarity Score** from FAISS search with historical tickets

**Routing Logic:**
```
IF quality_grade == 'D' OR f1_score < 0.5:
    → Manual Review Required (poor quality/low confidence)
ELIF is_new_category:
    → Manual Review Required (unknown issue type)
ELIF confidence >= 0.75 AND quality_grade in ['A','B'] AND f1_score >= 0.7:
    → L1 Support (auto-resolve with high confidence)
ELIF confidence >= 0.6 AND f1_score >= 0.6:
    → L2 Support (medium complexity)
ELSE:
    → L2 Support (default escalation)
```

**No Agentic AI Router in Default System Because:**
- Rule-based logic is faster (no extra API calls)
- More predictable and explainable decisions
- Lower cost (no additional AI inference)
- Easier to debug and adjust thresholds

## Optional: Agentic AI Router (Advanced Feature)

**NEW:** An optional `GroqAgenticRouter` is now available for advanced routing needs!

**What It Does:**
- Uses Groq's Llama 3.3 70B to make AI-powered routing decisions
- Provides detailed reasoning for each routing decision
- Adjusts priorities based on severity (Escalate, Keep, De-escalate)
- Gives actionable recommendations for support teams
- Handles edge cases with nuanced judgment

**When to Use:**
- ✅ Security incidents requiring judgment
- ✅ Production outages with cascading effects
- ✅ Novel issues not in knowledge base
- ✅ Conflicting signals (high confidence but low similarity)

**Trade-offs:**
- ⏱️ Adds 200-500ms per request
- 💰 Costs ~$0.0001-0.0003 per routing decision
- 🎯 More nuanced, context-aware decisions

**Integration:** See `docs/AGENTIC_ROUTER_INTEGRATION.md` for detailed setup guide

**Recommendation:** Use **Hybrid Approach**
- Agentic AI for complex/critical cases (10-20% of tickets)
- Rule-based for simple/routine cases (80-90% of tickets)
- Best balance of performance, cost, and intelligence

## How They Work Together

1. **User submits a ticket** → Frontend (HTML/CSS/JS) sends to Flask backend
2. **Flask receives request** → Passes ticket text to Groq classifier
3. **Sentence Transformers** → Converts ticket into vector embedding
4. **FAISS searches** → Finds similar tickets from 1000+ historical tickets in milliseconds
5. **LangChain + Groq** → Generates intelligent response using similar tickets as context
6. **LLM Judge evaluates** → Scores classification and resolution quality
7. **Rule-based router** → Uses all metrics to determine L1/L2/Manual Review
8. **Flask returns** → Sends classification, routing, similar tickets, and AI response
9. **Frontend displays** → Shows results with nice UI including metrics and routing info

## Why These Choices?

- **Groq** - 10x faster than standard AI APIs for real-time responses
- **FAISS** - Can search millions of vectors in milliseconds
- **Flask** - Simple, lightweight, perfect for prototypes and small apps
- **Sentence Transformers** - Open source, runs locally, no API costs for embeddings
- **LangChain** - Makes AI prompt engineering much easier

## Installation Size

Total download size: ~2GB (mostly AI models)  
Installed size: ~3GB (includes model cache)