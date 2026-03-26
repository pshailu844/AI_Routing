# AI Powered Intelligent Ticket Routing & Resolution Agent

A comprehensive AI system for automated ticket classification, intelligent routing, and resolution suggestions using machine learning, RAG (Retrieval-Augmented Generation), and agentic escalation systems.

using  sample data  for run this application 
path -D:\AI_project\AI_Ticket_Routing\data\sample
and wecan intregate this to real DB or external resource 

printing log  file path -D:\AI_project\AI_Ticket_Routing\logs\ai_ticket_routing_2026-03-23.log
using 
Project Dependencies & Technologies

Core Technologies:

Flask - Lightweight web framework that runs our backend server and serves the frontend  
Python 3 - Programming language that powers the entire backend system

AI & Machine Learning:

Groq API - Fast AI inference service that classifies tickets and generates responses  
  - Model: `llama-3.3-70b-versatile` (Meta's Llama 3.3 70B parameter model)
  - Used for: Ticket classification, response generation, and LLM judge evaluation
  
LangChain - Framework that helps us chain AI prompts and manage conversations  

Sentence Transformers - Converts ticket text into numerical vectors for similarity search  
  - Model: `sentence-transformers/all-MiniLM-L6-v2` 
  - Embedding dimension: 384
  - Used for: Creating semantic embeddings of tickets for similarity matching
  
FAISS - Facebook's library for ultra-fast similarity search across thousands of tickets  
  - Index: L2 distance metric
  - Stores: 1000 ticket embeddings from historical dataset
  
scikit-learn - Provides machine learning utilities for evaluation metrics

Data Processing:

Pandas - Handles CSV files and ticket data manipulation  
NumPy - Powers numerical computations and array operations  
Joblib - Saves and loads trained models efficiently
Agentic ai for aouting :
Web & API:
Flask-CORS - Allows frontend to communicate with backend from different ports  
python-dotenv - Loads API keys and secrets from .env file safely

Validation:

Pydantic - Validates data structures and ensures type safety

How They Work Together

1. User submits a ticket → Frontend (HTML/CSS/JS) sends to Flask backend
2. Flask receives request → Passes ticket text to Groq classifier
3. Sentence Transformers → Converts ticket into vector embedding
4. FAISS searches → Finds similar tickets from 1000+ historical tickets in milliseconds
5. LangChain + Groq → Generates intelligent response using similar tickets as context
6. Flask returns → Sends classification, similar tickets, and AI response to frontend
7. Frontend displays → Shows results with nice UI including metrics and routing info


 Components
 Automated New Ticket Classification**: Multi-model approach using TF-IDF and Random Forest for accurate categorization
RAG Resolution Insights**: Semantic similarity search for historical resolution retrieval
Agentic Routing Logic**: Priority-aware team assignment with confidence tracking

Supported Categories
- Infrastructure
- Application
- Security
- Database
- Network
- Access Management
- unknown(if new category ticket come)


Installation
1. Install dependencies:
   
   pip install -r requirements.txt

Requirment break Down 
2 to run the service
use D:\AI_project\AI_Ticket_Routing\start_chatbot.bat  



Application Context
This AI system is designed to enhance the efficiency and accuracy of handling support or service tickets within an organization. It automates the classification, routing, and resolution suggestion process, reducing manual effort and improving response times. The system is particularly useful in environments with high ticket volumes, such as IT support, customer service, or technical operations.

Requirements Breakdown
Functional Requirements
Ticket Classification:
Automatically analyze incoming tickets to determine their category (e.g., Infrastructure, Application, Security, Database, Network, Access Management).

Routing:
Direct tickets to the appropriate department or team based on classification results.

Resolution Suggestion:
Provide recommended solutions or troubleshooting steps based on historical data.

Escalation:
When the system's confidence in its classification or resolution suggestion is low, escalate the ticket to a human agent.

Confidence Tracking:
Monitor and record the confidence level of the system's predictions to inform escalation and automation decisions.

Technical Requirements
Classification Layer:

Use embeddings models to understand ticket content.
Categorize tickets into predefined categories (Infrastructure, Application, Security, Database, Network, Access Management).
RAG (Retrieval-Augmented Generation) Layer:

Retrieve similar past tickets from a database or knowledge base.
Suggest resolution steps based on retrieved tickets and their solutions.
Agentic Layer (added):

Escalate tickets automatically if confidence falls below a threshold.
Detect repeated issues and suggest automation or self-healing solutions.
Evaluation Metrics
Accuracy:
Measure the correctness of classification and routing.

F1 Score:
Balance precision and recall for classification performance.

Semantic Similarity Scoring:
Evaluate how closely suggested resolutions match actual solutions.

LLM-as-judge Evaluation:
Use large language models to assess the quality and appropriateness of the system's suggestions and classifications.

Summary
This system aims to web  ticket management by automating classification, routing, and resolution suggestions, while intelligently handling uncertain cases through escalation. It leverages advanced NLP techniques and retrieval methods to improve support efficiency and accuracy, with optional automation features for repeated issues.