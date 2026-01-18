# Feedback Processing Flow Diagram

This diagram shows the complete end-to-end flow from feedback sources to the RICE prioritization table.

```mermaid
flowchart TD
    subgraph Sources[Feedback Sources]
        CS[Customer Support<br/>Tickets & Calls]
        GitHub[GitHub<br/>Issues & PRs]
        X[X / Twitter<br/>Mentions & DMs]
        Discord[Discord<br/>Messages]
        Email[Email<br/>Support Requests]
    end

    subgraph Ingestion[Step 1: Feedback Ingestion]
        API[POST /api/ingest<br/>Ingest Endpoint]
        Validate{Validate<br/>Source & Text}
        Store[(D1 Database<br/>feedback_events<br/>is_actionable = NULL)]
    end

    subgraph Processing[Step 2: AI Processing Pipeline]
        direction TB
        Trigger[User clicks<br/>Process with AI]
        Fetch[Fetch unprocessed<br/>feedbacks<br/>batch of 10]

        subgraph Loop[For each feedback]
            direction TB
            ClassifyAction[AI Step 1:<br/>Classify Actionability<br/>Llama 3.1 8B]
            DecideAction{Is Actionable?}
            MarkNoise[Mark as noise<br/>is_actionable = 0]

            GenEmbed[AI Step 2:<br/>Generate Embedding<br/>BGE Base EN v1.5]
            SearchSimilar[AI Step 3:<br/>Semantic Search<br/>Vectorize Query<br/>Top 5 similar]
            ClassifyAgg[AI Step 4:<br/>Classify Aggregation<br/>Llama 3.1 8B<br/>With similar themes hint]
            DecideNew{New or<br/>Existing?}

            CreateNew[Create new<br/>aggregated feedback]
            StoreEmbed[AI Step 5:<br/>Store Embedding<br/>Vectorize Upsert]
            UseExisting[Use existing<br/>aggregated feedback ID]

            CreateMatch[Create match in<br/>feedback_match table]
        end

        UpdateStatus[Update processing<br/>timestamp]
    end

    subgraph Enhancement[Step 2 Enhancement: Workflows Future]
        WorkflowTrigger[Cloudflare Workflows<br/>Long-running processing]
        Note1[Allows processing over 30s<br/>No batch limitations<br/>Process all feedbacks<br/>in single execution]
    end

    subgraph Display[Step 3: RICE Table Display]
        direction TB
        UserView[User views<br/>web interface]
        TableAPI[GET /api/table<br/>Query aggregated data]
        Calculate[Calculate RICE Metrics<br/>Reach: Count feedbacks<br/>Impact: Max contract tier<br/>Confidence: User input<br/>Effort: User input]
        Sort[Sort by<br/>Impact DESC<br/>Reach DESC]
        Render[Render RICE Table<br/>Expandable rows<br/>Source breakdown<br/>Editable C & E]
    end

    subgraph Storage[Data Storage Layer]
        direction LR
        FeedbackEventsDB[(feedback_events<br/>Raw feedback data)]
        FeedbackAggDB[(feedback_aggregated<br/>AI-generated themes)]
        FeedbackMatchDB[(feedback_match<br/>Many-to-many links)]
        VectorizeDB[(Vectorize Index<br/>Theme embeddings<br/>768 dimensions)]
    end

    CS --> API
    GitHub --> API
    X --> API
    Discord --> API
    Email --> API

    API --> Validate
    Validate -->|Valid| Store
    Validate -->|Invalid| Reject[Reject with error]

    Trigger --> Fetch
    Fetch --> ClassifyAction
    ClassifyAction --> DecideAction
    DecideAction -->|0 = Noise| MarkNoise
    DecideAction -->|1 = Actionable| GenEmbed

    GenEmbed --> SearchSimilar
    SearchSimilar --> ClassifyAgg
    ClassifyAgg --> DecideNew

    DecideNew -->|New Theme| CreateNew
    CreateNew --> StoreEmbed
    StoreEmbed --> CreateMatch

    DecideNew -->|Existing Theme| UseExisting
    UseExisting --> CreateMatch

    CreateMatch --> UpdateStatus

    UserView --> TableAPI
    TableAPI --> Calculate
    Calculate --> Sort
    Sort --> Render

    Store -.Stores to.-> FeedbackEventsDB
    CreateNew -.Stores to.-> FeedbackAggDB
    CreateMatch -.Stores to.-> FeedbackMatchDB
    StoreEmbed -.Stores to.-> VectorizeDB
    SearchSimilar -.Queries.-> VectorizeDB

    TableAPI -.Reads from.-> FeedbackEventsDB
    TableAPI -.Reads from.-> FeedbackAggDB
    TableAPI -.Reads from.-> FeedbackMatchDB

    Processing -.Future Enhancement.-> WorkflowTrigger
    WorkflowTrigger -.Replaces batch.-> Fetch

    style Sources fill:#e0f2fe,stroke:#0284c7
    style Ingestion fill:#dcfce7,stroke:#16a34a
    style Processing fill:#f3e8ff,stroke:#9333ea
    style Enhancement fill:#fff4e6,stroke:#f59e0b
    style Display fill:#fce7f3,stroke:#ec4899
    style Storage fill:#fef3c7,stroke:#ca8a04

    style ClassifyAction fill:#e9d5ff
    style GenEmbed fill:#e9d5ff
    style SearchSimilar fill:#e9d5ff
    style ClassifyAgg fill:#e9d5ff
    style StoreEmbed fill:#e9d5ff
    style WorkflowTrigger fill:#fff4e6,stroke:#f59e0b
    style Note1 fill:#fef3c7,stroke:#f59e0b
```

## Flow Description

### Step 1: Feedback Ingestion
1. **Feedback Sources** send data via POST request to `/api/ingest`
2. System validates source type (CS, GitHub, X, Discord, Email) and text content
3. Valid feedback stored in `feedback_events` table with `is_actionable = NULL`

### Step 2: AI Processing Pipeline (Current Implementation)
**User triggers processing** by clicking "Process with AI" button:

1. **Fetch Batch**: Query up to 10 unprocessed feedbacks from date range
2. **For Each Feedback:**
   - **AI Step 1**: Classify actionability (0=noise, 1=actionable)
   - **If Noise**: Mark `is_actionable = 0`, exclude from aggregation
   - **If Actionable**:
     - **AI Step 2**: Generate 768-dimensional embedding
     - **AI Step 3**: Search Vectorize for similar themes (>85% similarity)
     - **AI Step 4**: Classify aggregation (with similar themes as hints)
     - **If New Theme**: Create aggregated feedback entry
     - **AI Step 5**: Store embedding in Vectorize
     - **If Existing Theme**: Validate ID exists
     - **Create Match**: Link feedback to theme(s) in junction table
3. **Update Status**: Record processing timestamp

**Limitation**: 30-second Worker timeout requires batch processing (max 10 items)

### Step 2 Enhancement: Cloudflare Workflows (Future)
**Purpose**: Remove batch limitations for seamless processing

**Benefits**:
- **No timeout constraints**: Process hundreds of feedbacks in single execution
- **No manual clicking**: Automatic processing of all unprocessed items
- **Better UX**: Users don't need to click "Process with AI" multiple times
- **Scalability**: Handle large feedback volumes automatically

**Implementation**: Replace batch-based processing with Workflows for long-running AI classification

### Step 3: RICE Table Display
1. **User views interface** at deployed Worker URL
2. **GET /api/table** queries aggregated data filtered by date range
3. **Calculate RICE Metrics**:
   - **Reach**: Count distinct feedback events per theme
   - **Impact**: Maximum contract value tier (1.0-5.0)
   - **Confidence**: User-editable dropdown (50%, 80%, 100%)
   - **Effort**: User-editable dropdown (1-5)
   - **RICE Score**: `(Reach × Impact × Confidence) / Effort`
4. **Sort Results**: By Impact DESC, then Reach DESC
5. **Render Table**: Interactive UI with expandable rows, source breakdown, editable scores

## Data Flow Through Storage
- **Ingestion** → `feedback_events` (raw feedback)
- **AI Processing** → `feedback_aggregated` (themes) + `feedback_match` (links)
- **Embedding Storage** → `Vectorize` (semantic search index)
- **Display** → Reads all three tables + calculates RICE scores in real-time

## Key Features
- **Many-to-Many**: Single feedback can relate to multiple themes
- **Semantic Similarity**: Vectorize reduces duplicate theme creation
- **Incremental Processing**: Feedbacks never reprocessed once classified
- **AI Hallucination Prevention**: Validates aggregate IDs before creating matches
- **Date Range Filtering**: All queries filtered by user-selected timeframe
