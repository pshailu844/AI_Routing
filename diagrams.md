# AI Ticket Routing & Resolution - System Diagrams

This document provides the technical diagrams for the AI Powered Intelligent Ticket Routing & Resolution Agent.

## 1. Flow Diagram
The flow diagram illustrates the end-to-end process from user input to the final response and routing decision.

```mermaid
graph TD
    A[User Input/Ticket] --> B{Is Greeting/Help?}
    B -- Yes --> C[Return Preset Response]
    B -- No --> D[Initialize AI Services]
    D --> E[Groq Classifier: Predict Category]
    E --> F[RAG System: FAISS Vector Search]
    F --> G[Generate Resolution with LLM]
    G --> H[LLM Judge: Evaluate Quality]
    H --> I[Agentic Router: Decision & Escalation]
    I --> J[Format JSON Response]
    J --> K[Display Results to User]

    style E fill:#f9f,stroke:#333,stroke-width:2px
    style F fill:#bbf,stroke:#333,stroke-width:2px
    style I fill:#bfb,stroke:#333,stroke-width:2px
```

---

## 2. Component Diagram
This diagram shows the major components and their interactions within the application.

```mermaid
graph LR
    subgraph Frontend
        UI[Web UI: HTML/CSS/JS]
    end
    
    subgraph "Backend (Flask)"
        API[Flask Endpoints]
        Svc[Service Layer]
        Log[File Logger]
    end
    
    subgraph "AI Services Layer"
        CL[Groq Classifier]
        RAG[Groq RAG System]
        Judge[Groq LLM Judge]
        AR[Groq Agentic Router]
        ST[Sentence Transformers]
    end
    
    subgraph "Data & Storage"
        CSV[CSV Datasets]
        FAISS[FAISS Vector Index]
    end
    
    UI <--> API
    API --> Svc
    Svc --> CL
    Svc --> RAG
    Svc --> Judge
    Svc --> AR
    RAG --> ST
    RAG --> FAISS
    RAG --> CSV
    API --> Log
```

---

## 3. App Architecture
The architecture is based on a layered model, separating presentation, processing, and data.

```mermaid
graph TB
    subgraph "Presentation Layer"
        Web[Web Browser / Client]
    end
    
    subgraph "API & Application Layer"
        Flask[Flask Web Server]
        Env[Configuration & Environment]
    end
    
    subgraph "Intelligence & Logic Layer"
        LLM[Groq Llama 3.3 70B]
        Embed[Sentence Transformers]
        Router[Agentic Routing Logic]
    end
    
    subgraph "Data Layer"
        Index[FAISS Vector Store]
        Data[(CSV Knowledge Base)]
    end
    
    Web <--> Flask
    Flask <--> LLM
    Flask --> Embed
    Embed --> Index
    Index --> Data
    Flask --> Router
```

---

## 4. Overall System Integration
This diagram explains how the app works by integrating with various internal and external systems.

```mermaid
graph LR
    User([User]) <--> Web[Chatbot Interface]
    Web <--> API[Flask Backend]
    
    subgraph "Local Resources"
        API --> V[Vector Search]
        V --> F[FAISS Index]
        API --> CSV[(Data CSVs)]
        API --> L[File Logger]
    end
    
    subgraph "Cloud Integrations"
        API -- "REST API" --> Groq[Groq AI Inference]
        Groq -- "Llama 3.3" --> API
    end
    
    subgraph "Potential Future Integrations"
        API -.-> DB[(Production DB)]
        API -.-> CRM[(Ticketing Systems)]
    end
```
