# Feedback Consolidation Architecture

## Overview
AI-powered feedback aggregation system built on Cloudflare Workers that automatically classifies, groups, and prioritizes customer feedback using RICE scoring framework.

## Tech Stack

### Cloudflare Products
- **Workers**: Serverless JavaScript runtime (30-second timeout limit)
- **D1**: SQLite-based serverless database
- **Workers AI**: On-demand AI inference
  - `@cf/meta/llama-3.1-8b-instruct`: Classification and aggregation
  - `@cf/baai/bge-base-en-v1.5`: Text embeddings (768 dimensions)
- **Vectorize**: Vector database for semantic similarity search
  - Index: `feedback-themes`
  - Dimensions: 768
  - Metric: Cosine similarity
  - Threshold: 0.85 (85% similarity)

### Database Schema

```sql
-- Raw feedback from customers
CREATE TABLE feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT CHECK(source IN ('CS','GitHub','X','Discord','Email')),
  contract_value REAL,
  is_actionable INTEGER  -- NULL=unprocessed, 0=noise, 1=actionable
);

-- AI-generated aggregated feedback themes
CREATE TABLE feedback_aggregated (
  aggregate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  aggregate_text TEXT UNIQUE NOT NULL
);

-- Many-to-many relationship (one feedback can map to multiple themes)
CREATE TABLE feedback_match (
  aggregate_id INTEGER,
  feedback_id INTEGER,
  PRIMARY KEY (aggregate_id, feedback_id),
  FOREIGN KEY (aggregate_id) REFERENCES feedback_aggregated(aggregate_id),
  FOREIGN KEY (feedback_id) REFERENCES feedback_events(id)
);
```

## Data Flow

### 1. Ingestion (`POST /api/ingest`)
```
Customer Feedback → Validation → Insert into feedback_events
                                  (is_actionable = NULL)
```

**Input:**
- `text`: Feedback content
- `source`: One of: CS, GitHub, X, Discord, Email
- `contract_value`: Optional customer contract value

**Output:**
- New feedback_events row with `is_actionable = NULL`

### 2. AI Processing (`POST /api/process`)

**Input:**
- `start`: Start date (YYYY-MM-DD)
- `end`: End date (YYYY-MM-DD)
- `batch_size`: Max items per request (default: 10)

**Process Flow:**

```
1. Query unprocessed feedbacks (is_actionable IS NULL)
   ↓
2. For each feedback in batch:
   ↓
   a) Classify Actionability (AI Step 1)
      - Uses Llama 3.1 8B Instruct
      - Returns 0 (noise) or 1 (actionable)
      - Updates is_actionable flag
      ↓
   b) If actionable (1):
      - Generate embedding with BGE model
      - Query Vectorize for similar themes (top 5, >85% similarity)
      ↓
   c) Classify Aggregated Feedback (AI Step 2)
      - Uses Llama 3.1 8B Instruct
      - Receives: feedback text, existing aggregated feedbacks, similar themes
      - Returns: List of existing IDs and/or new theme texts
      - Can return MULTIPLE classifications (many-to-many)
      ↓
   d) For each classification:
      - If NEW: Create feedback_aggregated row
                Generate + store embedding in Vectorize
      - If EXISTING: Validate ID exists (prevent AI hallucination)
      - Create feedback_match entry
```

**Output:**
- `processed`: Number of feedbacks processed
- `excluded`: Number marked as noise (0)
- `new_aggregated_feedbacks`: New themes created
- `matched_aggregated_feedbacks`: Existing themes matched
- `remaining`: Unprocessed count
- `last_processed`: ISO timestamp of processing completion

### 3. Table View (`GET /api/table`)

**Input:**
- `start`: Start date filter
- `end`: End date filter

**Process:**
```
1. Get aggregated feedbacks with metrics (filtered by date range)
   - Reach: COUNT(DISTINCT feedback_events)
   - Impact: MAX(contract_value tier) where tiers are:
     * 5.0: $100K+
     * 4.0: $50K-99K
     * 3.0: $10K-49K
     * 2.0: $2.5K-9K
     * 1.0: <$2.5K
   ↓
2. For each aggregated feedback:
   - Get reach breakdown by source (CS, GitHub, X, etc.)
   - Get distinct feedbacks (filtered by date range)
   ↓
3. Sort by: impact_score DESC, reach_total DESC
```

**Output:**
```json
{
  "table": [
    {
      "aggregate_id": 3,
      "aggregate_text": "Handle session management issues",
      "reach_total": 7,
      "reach_by_source": {"CS": 3, "Discord": 1, "Email": 1, "GitHub": 1, "X": 1},
      "impact_score": 5.0,
      "total_contract_value": 125000,
      "distinct_feedbacks": [...]
    }
  ],
  "excluded_count": 1
}
```

### 4. Status Check (`GET /api/status`)

**Output:**
```json
{
  "unprocessed_count": 0,
  "last_processed": "2026-01-17T15:29:11.000Z"
}
```

## Key Design Decisions

### 1. Incremental Processing Only
- **Feedbacks are NEVER reprocessed** once classified
- `is_actionable IS NULL` → unprocessed
- `is_actionable = 0 or 1` → processed, ignored in future runs
- Ensures idempotency and efficiency

### 2. Many-to-Many Relationships
- Single feedback can relate to multiple aggregated themes
- Example: "The app is slow and crashes" → maps to both "Performance" and "Crashes"
- Implemented via `feedback_match` junction table

### 3. Semantic Similarity Search
- Vectorize index stores embeddings of aggregated feedback texts
- Before classifying, query similar themes (top 5, >85% similarity)
- Pass similar themes to AI as hints to improve matching accuracy
- Reduces duplicate theme creation

### 4. AI Hallucination Prevention
- AI sometimes returns non-existent aggregate_ids
- Validation step: Check if returned ID exists before using
- Skip invalid classifications with logging
- Prevents FOREIGN KEY constraint errors

### 5. Batch Processing
- Max 10 items per request to avoid Worker 30s timeout
- Returns `remaining` count to user
- User clicks "Process with AI" multiple times for large datasets

### 6. Date Range Filtering
- All queries filter by `timestamp >= start AND timestamp <= end`
- Applies to:
  - Processing: Only process feedbacks in date range
  - Table view: Only show aggregated feedbacks with matches in date range
  - Distinct feedbacks: Only show feedbacks within date range
  - Excluded count: Only count noise within date range

## UI Components

### Controls
- **Start Date** / **End Date**: Filter feedback by timestamp
- **Process with AI**: Triggers batch processing of unprocessed feedbacks
- **Last processed**: Shows actual processing time (not feedback timestamp)

### Status Messages
- **Loading**: Animated 5-dot pulse with purple gradient
- **Success**: Shows for 5 seconds with processing summary
- **Info**: Excluded count, unprocessed count

### RICE Prioritization Table

**Columns:**
1. **Aggregated Feedback**: AI-generated theme (expandable for details)
2. **Reach**: Number of distinct feedbacks (filtered by date)
3. **Impact**: Highest contract value tier (1.0-5.0)
4. **Sources**: Breakdown by CS, GitHub, X, Discord, Email
5. **Confidence**: User-editable dropdown (50%, 80%, 100%)
6. **Effort**: User-editable dropdown (1-5)
7. **RICE Score**: Auto-calculated: (Reach × Impact × Confidence) / Effort

**Features:**
- Click "+" to expand and see individual feedbacks
- Edit Confidence/Effort to recalculate RICE scores
- Auto-sorts by RICE score (highest first)
- Tooltips on all headers explaining metrics

## Processing Example

**Input Feedback:**
```
"The export feature keeps failing when I try to download large datasets.
Also, it would be great to have dark mode!"
```

**AI Classification Step 1 (Actionability):**
```
Result: is_actionable = 1 (actionable)
```

**AI Classification Step 2 (Aggregation):**
```
Vectorize finds similar theme: "Export failures" (92% similarity)
AI returns: "5;NEW: Add dark mode feature"

Creates 2 matches:
- feedback → aggregated_feedback #5 ("Export functionality fails with large datasets")
- feedback → aggregated_feedback #36 ("Add dark mode feature") [NEW]
```

**Result:**
- Feedback marked as actionable
- Linked to 2 aggregated themes
- New dark mode theme created with embedding stored in Vectorize
- Both matches recorded in feedback_match table

## Reset Mechanism

**Script:** `reset_classifications.sql`

```sql
DELETE FROM feedback_match;
DELETE FROM feedback_aggregated;
UPDATE feedback_events SET is_actionable = NULL;
DELETE FROM sqlite_sequence WHERE name IN ('feedback_aggregated', 'feedback_match');
```

**Purpose:**
- Clear all AI classifications for testing
- Preserve original feedback_events
- Reset AUTOINCREMENT sequences (cosmetic)
- Must also reset Vectorize index manually

## Performance Considerations

### Timeouts
- Worker limit: 30 seconds wall clock
- Batch size: 10 items per request
- Each feedback requires 2-3 AI calls (~1-2s each)
- Total: ~20-30s for batch of 10

### AI Calls Per Feedback
1. **Always**: Actionability classification (1 call)
2. **If actionable**: Embedding generation (1 call)
3. **If actionable**: Aggregation classification (1 call)
4. **If new theme**: Embedding for theme (1 call per new theme)

**Worst case**: 1 feedback creating 5 new themes = 8 AI calls

### Optimization Strategies
- Semantic similarity reduces duplicate theme creation
- Batch processing prevents timeouts
- is_actionable flag prevents reprocessing
- Incremental updates (only new feedbacks)

## Error Handling

### Foreign Key Constraint Errors
- **Cause**: AI returns non-existent aggregate_id
- **Solution**: Validation before INSERT, skip invalid IDs
- **Logging**: `AI returned invalid aggregated feedback ID X - skipping`

### Empty Results
- Returns `processed: 0` if no unprocessed feedbacks
- UI shows success message for 5 seconds

### Date Range Edge Cases
- If no feedbacks in date range: Empty table
- If aggregated feedback has no matches in date range: Not shown

## Security & Validation

### Input Validation
- Source must be in: CS, GitHub, X, Discord, Email
- Text and source are required fields
- Contract value is optional, validated as REAL

### SQL Injection Prevention
- All queries use prepared statements with `.bind()`
- No string concatenation in SQL

### Data Integrity
- Foreign key constraints enforce referential integrity
- UNIQUE constraint on aggregate_text prevents duplicates
- INSERT OR IGNORE prevents duplicate matches

## Observability

**Enabled in wrangler.toml:**
```toml
[observability]
enabled = true

[observability.logs]
enabled = true
invocation_logs = true
```

**Monitoring:**
- Use `npx wrangler tail feedback-demo` to stream logs
- All processing steps logged with `[PROCESS]` prefix
- Tracks: Batch progress, AI decisions, new themes, matches, errors

## Future Enhancements (Not Implemented)

1. **Cloudflare Workflows**: Long-running batch processing (>30s)
2. **KV Storage**: Cache processed results, store last_processed timestamp
3. **Analytics**: Track AI accuracy, processing metrics over time
4. **Manual Overrides**: PM can merge/split aggregated feedbacks
5. **Historical Trending**: Track theme popularity over time
