# AI-Powered Feedback Consolidation System

A serverless feedback aggregation system built on Cloudflare Workers that automatically classifies, groups, and prioritizes customer feedback using AI and the RICE scoring framework.

![Architecture](./architecture-diagram.md)

## 🌟 Features

- **AI-Powered Classification**: Automatically filters noise and aggregates similar feedback using Llama 3.1 8B
- **Semantic Similarity Search**: Uses vector embeddings (BGE Base EN v1.5) to prevent duplicate themes
- **RICE Prioritization**: Calculate priority scores based on Reach, Impact, Confidence, and Effort
- **Multi-Source Support**: Aggregate feedback from CS, GitHub, X (Twitter), Discord, and Email
- **Many-to-Many Relationships**: Single feedback can relate to multiple themes
- **Real-Time UI**: Interactive web interface with expandable rows and editable metrics
- **Date Range Filtering**: Focus on specific time periods for analysis

## 🏗️ Architecture

### Tech Stack

**Cloudflare Platform:**
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

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd feedback-demo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Authenticate with Cloudflare**
   ```bash
   wrangler login
   ```

4. **Create D1 Database**
   ```bash
   npx wrangler d1 create feedback-db
   ```

   Update `wrangler.toml` with the database ID returned.

5. **Create Vectorize Index**
   ```bash
   npx wrangler vectorize create feedback-themes --dimensions=768 --metric=cosine
   ```

6. **Run Database Migrations**
   ```bash
   npx wrangler d1 execute feedback-db --local --file=./schema.sql
   npx wrangler d1 execute feedback-db --remote --file=./schema.sql
   ```

7. **Seed Sample Data** (optional)
   ```bash
   npx wrangler d1 execute feedback-db --local --file=./seed.sql
   npx wrangler d1 execute feedback-db --remote --file=./seed.sql
   ```

### Development

```bash
# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy

# Tail logs
npx wrangler tail feedback-demo
```

## 📊 Usage

### 1. Ingest Feedback

Submit feedback via POST request:

```bash
curl -X POST https://feedback-demo.your-domain.workers.dev/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The export feature fails with large datasets",
    "source": "CS",
    "contract_value": 50000
  }'
```

**Supported Sources:** `CS`, `GitHub`, `X`, `Discord`, `Email`

### 2. Process with AI

Visit the web interface and click **"Process with AI"** to:
1. Classify actionability (filter noise)
2. Generate embeddings
3. Search for similar themes
4. Aggregate into themes
5. Store embeddings in Vectorize

**Batch Processing:** Processes 10 items at a time to avoid Worker timeout (30s limit)

### 3. View RICE Table

The interactive table displays:
- **Aggregated Feedback**: AI-generated themes
- **Reach**: Count of distinct feedbacks
- **Impact**: Maximum contract value tier (1.0-5.0 scale)
- **Sources**: Breakdown by CS, GitHub, X, Discord, Email
- **Confidence**: User-editable (50%, 80%, 100%)
- **Effort**: User-editable (1-5 scale)
- **RICE Score**: `(Reach × Impact × Confidence) / Effort`

Click the **+** button to expand and see individual feedbacks.

## 🔄 AI Processing Pipeline

### Step 1: Classify Actionability
Uses Llama 3.1 8B to determine if feedback is actionable or noise.

**Actionable:**
- Bug reports
- Feature requests
- Performance complaints
- Usability issues
- Pricing concerns

**Noise:**
- Generic praise ("Great product!")
- Very short messages (<20 chars)
- Spam

### Step 2: Generate Embedding
Creates 768-dimensional vector using BGE Base EN v1.5 model.

### Step 3: Semantic Search
Queries Vectorize for top 5 similar themes with >85% similarity.

### Step 4: Classify Aggregation
AI decides whether to:
- Match existing theme(s)
- Create new theme(s)
- Match multiple themes (many-to-many)

Similar themes are passed as hints to improve accuracy.

### Step 5: Store Embedding
New themes get embeddings stored in Vectorize for future similarity searches.

## 📈 Impact Scoring Tiers

Contract value is mapped to impact scores:

| Contract Value | Impact Score |
|---------------|--------------|
| $100,000+     | 5.0          |
| $50,000-99,999| 4.0          |
| $10,000-49,999| 3.0          |
| $2,500-9,999  | 2.0          |
| <$2,500       | 1.0          |

## 🔧 API Endpoints

### POST `/api/ingest`
Ingest new feedback.

**Request:**
```json
{
  "text": "Feedback text",
  "source": "CS|GitHub|X|Discord|Email",
  "contract_value": 50000
}
```

### POST `/api/process`
Trigger AI processing.

**Request:**
```json
{
  "start": "2026-01-01",
  "end": "2026-01-16",
  "batch_size": 10
}
```

**Response:**
```json
{
  "processed": 9,
  "excluded": 1,
  "new_aggregated_feedbacks": 14,
  "matched_aggregated_feedbacks": 15,
  "remaining": 20,
  "last_processed": "2026-01-17T15:29:11.000Z"
}
```

### GET `/api/table`
Get aggregated feedback with RICE metrics.

**Query Parameters:**
- `start`: Start date (YYYY-MM-DD)
- `end`: End date (YYYY-MM-DD)

**Response:**
```json
{
  "table": [
    {
      "aggregate_id": 3,
      "aggregate_text": "Handle session management issues",
      "reach_total": 7,
      "reach_by_source": {"CS": 3, "Discord": 1, "Email": 1},
      "impact_score": 5.0,
      "total_contract_value": 125000,
      "distinct_feedbacks": [...]
    }
  ],
  "excluded_count": 1
}
```

### GET `/api/status`
Get processing status.

**Response:**
```json
{
  "unprocessed_count": 0,
  "last_processed": "2026-01-17T15:29:11.000Z"
}
```

## 🛠️ Key Design Decisions

### 1. Incremental Processing Only
- Feedbacks are **never reprocessed** once classified
- `is_actionable IS NULL` → unprocessed
- `is_actionable = 0 or 1` → processed, ignored in future runs
- Ensures idempotency and efficiency

### 2. Many-to-Many Relationships
- Single feedback can relate to multiple themes
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
- Applies to processing, table view, distinct feedbacks, and excluded count

## 🔮 Future Enhancements

### Cloudflare Workflows (Step 2 Enhancement)
**Current Limitation:** 30-second Worker timeout requires batch processing

**Proposed Solution:** Use Cloudflare Workflows for long-running AI classification

**Benefits:**
- ✅ No timeout constraints (process hundreds of feedbacks)
- ✅ No manual clicking required
- ✅ Better UX (automatic processing)
- ✅ Scalability (handle large feedback volumes)

See [data-flow-diagram.md](./data-flow-diagram.md) for details.

## 🧪 Testing & Debugging

### Reset Classifications
To clear all AI classifications and start fresh:

```bash
npx wrangler d1 execute feedback-db --local --file=./reset_classifications.sql
```

**Note:** Also manually reset Vectorize index:
```bash
npx wrangler vectorize delete feedback-themes
npx wrangler vectorize create feedback-themes --dimensions=768 --metric=cosine
```

### Tail Logs
Stream real-time logs to debug AI processing:

```bash
npx wrangler tail feedback-demo
```

All processing steps are logged with `[PROCESS]` prefix.

## 📝 Project Structure

```
feedback-demo/
├── src/
│   └── index.js              # Main Worker code (AI + API + UI)
├── schema.sql                # D1 database schema
├── seed.sql                  # Sample data
├── reset_classifications.sql # Reset script
├── wrangler.toml            # Cloudflare configuration
├── ARCHITECTURE.md          # System architecture documentation
├── architecture-diagram.md  # Architecture diagram (Mermaid)
├── data-flow-diagram.md     # Data flow diagram (Mermaid)
├── package.json
└── README.md
```

## 🔐 Security

- All queries use prepared statements with `.bind()`
- No string concatenation in SQL (prevents SQL injection)
- Source validation via CHECK constraint
- Foreign key constraints enforce referential integrity
- UNIQUE constraint on aggregate_text prevents duplicates
- INSERT OR IGNORE prevents duplicate matches

## 📊 Observability

Configured in `wrangler.toml`:

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

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is part of a Cloudflare PM home assignment demonstration for AI-powered feedback aggregation systems.

## 🙏 Acknowledgments

- Built with [Cloudflare Workers](https://workers.cloudflare.com/)
- AI models provided by [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- Inspired by the [RICE prioritization framework](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/)

## 📞 Support

For issues or questions, please open an issue in the GitHub repository.

---

**Built with ❤️ using Cloudflare Workers and AI**
