# Feedback Consolidation System - Architecture Diagram

```mermaid
graph TB
    subgraph "Frontend UI"
        UI[Web Interface<br/>HTML/CSS/JS]
        UI --> Controls[Date Range Controls<br/>Start/End Date]
        UI --> ProcessBtn[Process with AI Button]
        UI --> RICETable[RICE Prioritization Table]
    end

    subgraph "Cloudflare Workers API"
        IngestAPI[POST /api/ingest<br/>Ingest new feedback]
        ProcessAPI[POST /api/process<br/>AI processing batch]
        TableAPI[GET /api/table<br/>Return aggregated data]
        StatusAPI[GET /api/status<br/>Processing status]
    end

    subgraph "AI Classification Pipeline"
        Step1[Step 1: Classify Actionability<br/>Llama 3.1 8B Instruct<br/>Returns 0=noise or 1=actionable]
        Step2[Step 2: Generate Embedding<br/>BGE Base EN v1.5<br/>768-dimensional vector]
        Step3[Step 3: Semantic Search<br/>Query Vectorize<br/>Top 5 similar themes >85%]
        Step4[Step 4: Classify Aggregation<br/>Llama 3.1 8B Instruct<br/>Match existing or create new]
        Step5[Step 5: Store Embedding<br/>Upsert to Vectorize<br/>For new themes only]

        Step1 -->|is_actionable=1| Step2
        Step1 -->|is_actionable=0| Excluded[Mark as noise]
        Step2 --> Step3
        Step3 --> Step4
        Step4 -->|New theme| Step5
        Step4 -->|Existing theme| MatchTable
    end

    subgraph "Cloudflare D1 Database"
        FeedbackEvents[(feedback_events<br/>---<br/>id, text, timestamp<br/>source, contract_value<br/>is_actionable)]
        FeedbackAggregated[(feedback_aggregated<br/>---<br/>aggregate_id<br/>aggregate_text)]
        FeedbackMatch[(feedback_match<br/>---<br/>aggregate_id<br/>feedback_id)]

        FeedbackEvents -.Many-to-Many.-> FeedbackMatch
        FeedbackAggregated -.Many-to-Many.-> FeedbackMatch
    end

    subgraph "Cloudflare Vectorize"
        VectorIndex[Vectorize Index<br/>feedback-themes<br/>---<br/>768 dimensions<br/>Cosine similarity<br/>Threshold: 0.85]
    end

    subgraph "Workers AI"
        LlamaModel[Llama 3.1 8B Instruct<br/>Text classification]
        BGEModel[BGE Base EN v1.5<br/>Text embeddings]
    end

    UI --> IngestAPI
    UI --> ProcessAPI
    UI --> TableAPI
    UI --> StatusAPI

    IngestAPI --> FeedbackEvents

    ProcessAPI --> FeedbackEvents
    ProcessAPI --> Step1

    Step1 --> LlamaModel
    Step2 --> BGEModel
    Step3 --> VectorIndex
    Step4 --> LlamaModel
    Step5 --> VectorIndex

    Step4 --> FeedbackAggregated
    Step4 --> MatchTable[Create Match]
    MatchTable --> FeedbackMatch

    TableAPI --> FeedbackEvents
    TableAPI --> FeedbackAggregated
    TableAPI --> FeedbackMatch
    TableAPI --> RICETable

    StatusAPI --> FeedbackEvents

    style Step1 fill:#e1d5e7
    style Step2 fill:#e1d5e7
    style Step3 fill:#e1d5e7
    style Step4 fill:#e1d5e7
    style Step5 fill:#e1d5e7
    style LlamaModel fill:#dae8fc
    style BGEModel fill:#dae8fc
    style VectorIndex fill:#fff2cc
    style FeedbackEvents fill:#d5e8d4
    style FeedbackAggregated fill:#d5e8d4
    style FeedbackMatch fill:#d5e8d4
```

## System Architecture Overview

### Components

**Frontend Layer**
- Single-page web application with date range controls and RICE prioritization table
- Real-time status updates and AI processing progress indicators

**API Layer (Cloudflare Workers)**
- `/api/ingest` - Accepts new customer feedback from multiple sources
- `/api/process` - Triggers AI batch processing (max 10 items to avoid 30s timeout)
- `/api/table` - Returns aggregated feedback with RICE metrics
- `/api/status` - Returns processing status and unprocessed count

**AI Processing Pipeline**
1. **Actionability Classification** - Filters out noise using Llama 3.1 8B
2. **Embedding Generation** - Creates 768-dimensional vectors using BGE model
3. **Semantic Search** - Queries Vectorize for similar existing themes (>85% similarity)
4. **Aggregation Classification** - Groups feedback into themes (supports many-to-many)
5. **Embedding Storage** - Stores new theme embeddings in Vectorize for future matching

**Data Layer**
- **D1 Database** - Three tables with many-to-many relationships via junction table
- **Vectorize** - Vector database for semantic similarity search of aggregated themes

**AI Models (Workers AI)**
- **Llama 3.1 8B Instruct** - Text classification and aggregation
- **BGE Base EN v1.5** - 768-dimensional text embeddings

### Data Flow

1. **Ingestion**: Customer feedback → `feedback_events` table (is_actionable=NULL)
2. **Processing**: Batch processing classifies actionability and aggregates similar feedback
3. **Aggregation**: Creates or matches aggregated themes with semantic search assistance
4. **Storage**: Stores matches in junction table and embeddings in Vectorize
5. **Display**: UI queries aggregated data with RICE scoring for prioritization

### Key Design Features

- **Incremental Processing**: Feedbacks processed once, never reprocessed
- **Many-to-Many Relationships**: Single feedback can relate to multiple themes
- **Semantic Similarity**: Vectorize reduces duplicate theme creation
- **AI Hallucination Prevention**: Validates aggregate_ids before creating matches
- **Batch Processing**: Max 10 items per request to avoid Worker timeouts
- **Date Range Filtering**: All queries filtered by user-selected timeframe
