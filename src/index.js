// AI Helper Functions
async function classifyActionable(env, feedbackText) {
  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{
      role: 'system',
      content: `You are a feedback filter for a product management tool. Your job is to determine if customer feedback is actionable.

ACTIONABLE feedback (return "1"):
- Bug reports or issues with the product
- Feature requests or suggestions
- Performance complaints
- Usability problems
- Pricing concerns or objections
- Integration or compatibility issues
- Any feedback that a product team could act upon

NOT ACTIONABLE - noise (return "0"):
- Generic thank-yous or praise without specifics (e.g., "Great product!", "Thanks!")
- Very short messages with no substance (less than 20 characters)
- Messages that are just pleasantries
- Spam or irrelevant content

Return ONLY "1" for actionable or "0" for noise. No explanation.`
    }, {
      role: 'user',
      content: `Classify this feedback:\n\n"${feedbackText}"`
    }]
  });

  const result = response.response.trim();
  return result.includes('1') ? 1 : 0;
}

async function classifyAggregatedFeedback(env, feedbackText, existingAggregatedFeedbacks) {
  // First, try semantic similarity search using Vectorize
  let similarAggregatedFeedbacks = [];

  if (existingAggregatedFeedbacks.length > 0) {
    // Generate embedding for the feedback text
    const embeddingResponse = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: feedbackText
    });

    const feedbackEmbedding = embeddingResponse.data[0];

    // Search for similar aggregated feedbacks in Vectorize
    const vectorResults = await env.VECTORIZE.query(feedbackEmbedding, {
      topK: 5,
      returnMetadata: true
    });

    // Filter aggregated feedbacks with similarity > 0.85 (very similar)
    similarAggregatedFeedbacks = vectorResults.matches
      .filter(match => match.score > 0.85)
      .map(match => ({
        aggregate_id: match.id,
        aggregate_text: match.metadata.text,
        similarity: match.score
      }));
  }

  const aggregatedListText = existingAggregatedFeedbacks.length > 0
    ? existingAggregatedFeedbacks.map(af =>
        `ID: ${af.aggregate_id} | Aggregated Feedback: "${af.aggregate_text}"`
      ).join('\n')
    : 'No existing aggregated feedbacks yet.';

  // Prepare similar aggregated feedbacks hint for AI
  const similarAggregatedFeedbacksHint = similarAggregatedFeedbacks.length > 0
    ? `\n\nSEMANTICALLY SIMILAR AGGREGATED FEEDBACKS (use these if they match):\n` +
      similarAggregatedFeedbacks.map(af => `ID: ${af.aggregate_id} | "${af.aggregate_text}" (similarity: ${(af.similarity * 100).toFixed(1)}%)`).join('\n')
    : '';

  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{
      role: 'system',
      content: `You are a product feedback aggregator. Your job is to group similar customer feedback into clear, actionable aggregated feedback items for product managers.

IMPORTANT: A single feedback can relate to MULTIPLE aggregated feedbacks if it mentions multiple issues/requests.

AGGREGATED FEEDBACK should be:
- A concise statement of the product issue or request (max 12 words)
- Clear and specific enough for a PM to understand the problem
- Focused on ONE core issue
- Written from the product perspective (e.g., "Export functionality fails with large datasets" not "Users complaining about exports")

EXISTING AGGREGATED FEEDBACKS:
${aggregatedListText}${similarAggregatedFeedbacksHint}

YOUR TASK:
1. Read the new feedback carefully
2. Identify ALL relevant aggregated feedbacks that this feedback relates to
3. For each match, include its ID number
4. If the feedback mentions issues not covered by existing aggregated feedbacks, create NEW ones

RETURN FORMAT:
- If matching existing: List the IDs separated by commas (e.g., "3,7,12")
- If creating new: Use "NEW: <text>" for each new one, separated by semicolons
- You can mix both: "3,7;NEW: Mobile app crashes on login"

MATCHING GUIDELINES:
- Match if the core issue/request is the same, even if wording differs
- Don't match if it's a different feature, different bug, or different concern
- A feedback about "slow performance and crashes" should match BOTH performance AND crash aggregated feedbacks
- When in doubt about creating new, create it

Examples:
- "The app is slow and crashes frequently" → might return "5,8" (if 5=performance, 8=crashes)
- "Need dark mode" → might return "NEW: Add dark mode feature"
- "Export fails and UI is confusing" → might return "3;NEW: Improve UI clarity" (if 3=export issues exists)

Return ONLY the IDs and/or NEW items. No explanations.`
    }, {
      role: 'user',
      content: `New feedback to classify:\n\n"${feedbackText}"`
    }]
  });

  const result = response.response.trim();
  const classifications = [];

  // Parse the response - could be mixed format like "3,7;NEW: Something"
  const parts = result.split(';');

  for (const part of parts) {
    const trimmedPart = part.trim();

    if (trimmedPart.startsWith('NEW:')) {
      // Extract new aggregated feedback text
      const aggregatedText = trimmedPart.replace('NEW:', '').trim();
      const wordCount = aggregatedText.split(/\s+/).length;

      classifications.push({
        isNew: true,
        aggregatedText: wordCount > 12
          ? aggregatedText.split(/\s+/).slice(0, 12).join(' ')
          : aggregatedText
      });
    } else {
      // Parse existing IDs (could be comma-separated like "3,7,12")
      const ids = trimmedPart.split(',').map(id => id.trim()).filter(id => id);
      for (const idStr of ids) {
        const idMatch = idStr.match(/\d+/);
        if (idMatch) {
          classifications.push({
            isNew: false,
            aggregateId: parseInt(idMatch[0])
          });
        }
      }
    }
  }

  // Fallback if AI returns nothing useful
  if (classifications.length === 0) {
    classifications.push({
      isNew: true,
      aggregatedText: 'Uncategorized feedback'
    });
  }

  return classifications;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API: Ingest new feedback
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));

      const { text, source, contract_value } = body;

      if (!text || !source) {
        return new Response(JSON.stringify({ error: "Missing required fields: text, source" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      const validSources = ['CS', 'GitHub', 'X', 'Discord', 'Email'];
      if (!validSources.includes(source)) {
        return new Response(JSON.stringify({ error: "Invalid source. Must be: " + validSources.join(', ') }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      const timestamp = new Date().toISOString();

      const result = await env.db_binding
        .prepare(
          `INSERT INTO feedback_events (text, timestamp, source, contract_value, is_actionable)
           VALUES (?, ?, ?, ?, NULL)`
        )
        .bind(text, timestamp, source, contract_value || null)
        .run();

      return new Response(JSON.stringify({
        success: true,
        id: result.meta.last_row_id,
        timestamp
      }), {
        headers: { "content-type": "application/json" }
      });
    }

    // API: Return aggregated table
    if (url.pathname === "/api/table") {
      const start = url.searchParams.get("start") || "2026-01-01";
      const end = url.searchParams.get("end") || "2026-01-16";

      // Get aggregated feedbacks with their matched feedback (filtered by timeframe and actionable)
      // Also calculate impact score based on contract value tiers
      const aggregates = await env.db_binding
        .prepare(
          `SELECT
            fa.aggregate_id,
            fa.aggregate_text,
            COUNT(DISTINCT fe.id) as reach_total,
            SUM(COALESCE(fe.contract_value, 0)) as total_contract_value,
            MAX(
              CASE
                WHEN fe.contract_value >= 100000 THEN 5.0
                WHEN fe.contract_value >= 50000 THEN 4.0
                WHEN fe.contract_value >= 10000 THEN 3.0
                WHEN fe.contract_value >= 2500 THEN 2.0
                ELSE 1.0
              END
            ) as impact_score
           FROM feedback_aggregated fa
           INNER JOIN feedback_match fm ON fa.aggregate_id = fm.aggregate_id
           INNER JOIN feedback_events fe ON fm.feedback_id = fe.id
           WHERE fe.timestamp >= ?
             AND fe.timestamp <= ?
             AND fe.is_actionable = 1
           GROUP BY fa.aggregate_id, fa.aggregate_text
           ORDER BY impact_score DESC, reach_total DESC`
        )
        .bind(start, end + 'T23:59:59Z')
        .all();

      // Get reach breakdown by source and distinct feedbacks for each aggregate
      const aggregatesWithSources = [];
      for (const agg of aggregates.results || []) {
        const sourceBreakdown = await env.db_binding
          .prepare(
            `SELECT
              fe.source,
              COUNT(DISTINCT fe.id) as count
             FROM feedback_match fm
             INNER JOIN feedback_events fe ON fm.feedback_id = fe.id
             WHERE fm.aggregate_id = ?
               AND fe.timestamp >= ?
               AND fe.timestamp <= ?
               AND fe.is_actionable = 1
             GROUP BY fe.source`
          )
          .bind(agg.aggregate_id, start, end + 'T23:59:59Z')
          .all();

        const reach_by_source = {};
        for (const src of sourceBreakdown.results || []) {
          reach_by_source[src.source] = src.count;
        }

        // Get distinct feedbacks for this aggregate
        const distinctFeedbacks = await env.db_binding
          .prepare(
            `SELECT
              fe.id,
              fe.text,
              fe.source,
              fe.contract_value,
              fe.timestamp
             FROM feedback_match fm
             INNER JOIN feedback_events fe ON fm.feedback_id = fe.id
             WHERE fm.aggregate_id = ?
               AND fe.timestamp >= ?
               AND fe.timestamp <= ?
               AND fe.is_actionable = 1
             ORDER BY fe.timestamp DESC`
          )
          .bind(agg.aggregate_id, start, end + 'T23:59:59Z')
          .all();

        aggregatesWithSources.push({
          aggregate_id: agg.aggregate_id,
          aggregate_text: agg.aggregate_text,
          reach_total: agg.reach_total,
          reach_by_source: reach_by_source,
          impact_score: agg.impact_score,
          total_contract_value: agg.total_contract_value,
          distinct_feedbacks: distinctFeedbacks.results || []
        });
      }

      // Get excluded count for the timeframe
      const excludedResult = await env.db_binding
        .prepare(
          `SELECT COUNT(*) as excluded_count
           FROM feedback_events
           WHERE timestamp >= ?
             AND timestamp <= ?
             AND is_actionable = 0`
        )
        .bind(start, end + 'T23:59:59Z')
        .first();

      return new Response(JSON.stringify({
        start,
        end,
        excluded_count: excludedResult.excluded_count || 0,
        table: aggregatesWithSources
      }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // API: Get processing status
    if (url.pathname === "/api/status") {
      // Check if there are any unprocessed items
      const unprocessed = await env.db_binding
        .prepare(`SELECT COUNT(*) as count FROM feedback_events WHERE is_actionable IS NULL`)
        .first();

      // Get last processed time from KV (we'll store this during processing)
      const lastProcessed = await env.db_binding
        .prepare(`SELECT MAX(timestamp) as last_time FROM feedback_events WHERE is_actionable IS NOT NULL`)
        .first();

      return new Response(JSON.stringify({
        unprocessed_count: unprocessed.count || 0,
        last_processed: lastProcessed.last_time || null
      }), {
        headers: { "content-type": "application/json" }
      });
    }

    // API: Process with AI
    if (url.pathname === "/api/process" && request.method === "POST") {
      console.log('[PROCESS] Starting AI processing');
      const body = await request.json().catch(() => ({}));
      const start = body.start || "2026-01-01";
      const end = body.end || "2026-01-16";
      const batchSize = body.batch_size || 10; // Process max 10 items per request to avoid timeout

      console.log(`[PROCESS] Date range: ${start} to ${end}, batch size: ${batchSize}`);

      // Check if there are any new feedbacks first
      const countResult = await env.db_binding
        .prepare(
          `SELECT COUNT(*) as count
           FROM feedback_events
           WHERE timestamp >= ? AND timestamp <= ?
           AND is_actionable IS NULL`
        )
        .bind(start, end + 'T23:59:59Z')
        .first();

      console.log(`[PROCESS] Found ${countResult.count} unprocessed feedbacks`);

      if (countResult.count === 0) {
        return new Response(JSON.stringify({
          start,
          end,
          processed: 0,
          excluded: 0,
          new_aggregated_feedbacks: 0,
          matched_aggregated_feedbacks: 0,
          message: 'No new feedbacks to process'
        }), {
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }

      // Get unprocessed feedback (limited by batch size)
      const rows = await env.db_binding
        .prepare(
          `SELECT id, text
           FROM feedback_events
           WHERE timestamp >= ? AND timestamp <= ?
           AND is_actionable IS NULL
           LIMIT ?`
        )
        .bind(start, end + 'T23:59:59Z', batchSize)
        .all();

      const items = rows.results || [];
      console.log(`[PROCESS] Processing batch of ${items.length} items`);

      let processed = 0;
      let excluded = 0;
      let newAggregatedFeedbacks = 0;
      let matchedAggregatedFeedbacks = 0;

      // Get all existing aggregated feedbacks for matching
      const existingAggregatedFeedbacks = await env.db_binding
        .prepare(`SELECT aggregate_id, aggregate_text FROM feedback_aggregated`)
        .all();

      console.log(`[PROCESS] Found ${existingAggregatedFeedbacks.results?.length || 0} existing aggregated feedbacks`);

      const aggregatedFeedbackMap = new Map();
      for (const af of existingAggregatedFeedbacks.results || []) {
        aggregatedFeedbackMap.set(af.aggregate_text.toLowerCase(), af.aggregate_id);
      }

      // Process each feedback item
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`[PROCESS] Processing feedback ${i + 1}/${items.length} (ID: ${item.id})`);
        const text = String(item.text || "");

        // STEP A: Determine if actionable using AI
        console.log(`[PROCESS] Classifying actionability for feedback ${item.id}`);
        const is_actionable = await classifyActionable(env, text);
        console.log(`[PROCESS] Feedback ${item.id} is_actionable: ${is_actionable}`);

        if (is_actionable === 0) {
          excluded += 1;
        }

        // Update is_actionable flag
        await env.db_binding
          .prepare(`UPDATE feedback_events SET is_actionable = ? WHERE id = ?`)
          .bind(is_actionable, item.id)
          .run();

        // STEP B: Classify into aggregated feedback(s) - can be multiple!
        if (is_actionable === 1) {
          console.log(`[PROCESS] Classifying aggregated feedback for feedback ${item.id}`);
          const classifications = await classifyAggregatedFeedback(
            env,
            text,
            existingAggregatedFeedbacks.results || []
          );
          console.log(`[PROCESS] Got ${classifications.length} classifications for feedback ${item.id}`);

          // Process EACH classification (many-to-many support)
          for (const classification of classifications) {
            let aggregateId;

            if (classification.isNew) {
              // Check if we already created this in current batch
              const existingMatch = aggregatedFeedbackMap.get(
                classification.aggregatedText.toLowerCase()
              );

              if (existingMatch) {
                console.log(`[PROCESS] Matched existing aggregated feedback: "${classification.aggregatedText}"`);
                aggregateId = existingMatch;
                matchedAggregatedFeedbacks += 1;
              } else {
                console.log(`[PROCESS] Creating new aggregated feedback: "${classification.aggregatedText}"`);
                // Create new aggregated feedback
                const insertResult = await env.db_binding
                  .prepare(`INSERT INTO feedback_aggregated (aggregate_text) VALUES (?)`)
                  .bind(classification.aggregatedText)
                  .run();

                aggregateId = insertResult.meta.last_row_id;
                console.log(`[PROCESS] Created new aggregated feedback with ID: ${aggregateId}`);
                aggregatedFeedbackMap.set(classification.aggregatedText.toLowerCase(), aggregateId);

                // Generate and store embedding in Vectorize for semantic search
                console.log(`[PROCESS] Generating embedding for aggregated feedback ${aggregateId}`);
                const embeddingResponse = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
                  text: classification.aggregatedText
                });

                const embedding = embeddingResponse.data[0];

                console.log(`[PROCESS] Storing embedding in Vectorize for aggregated feedback ${aggregateId}`);
                await env.VECTORIZE.upsert([{
                  id: String(aggregateId),
                  values: embedding,
                  metadata: {
                    text: classification.aggregatedText,
                    created_at: new Date().toISOString()
                  }
                }]);

                // Add to existing list for subsequent classifications
                existingAggregatedFeedbacks.results.push({
                  aggregate_id: aggregateId,
                  aggregate_text: classification.aggregatedText
                });

                newAggregatedFeedbacks += 1;
              }
            } else {
              // Validate that the aggregate_id exists
              const validId = existingAggregatedFeedbacks.results.find(
                af => af.aggregate_id === classification.aggregateId
              );

              if (validId) {
                console.log(`[PROCESS] Using existing aggregated feedback ID: ${classification.aggregateId}`);
                aggregateId = classification.aggregateId;
                matchedAggregatedFeedbacks += 1;
              } else {
                console.log(`[PROCESS] AI returned invalid aggregated feedback ID ${classification.aggregateId} - skipping this classification`);
                continue; // Skip this invalid classification
              }
            }

            // Create match in feedback_match table (many-to-many!)
            console.log(`[PROCESS] Creating match: feedback ${item.id} -> aggregated feedback ${aggregateId}`);
            await env.db_binding
              .prepare(`INSERT OR IGNORE INTO feedback_match (aggregate_id, feedback_id) VALUES (?, ?)`)
              .bind(aggregateId, item.id)
              .run();
          }

          processed += 1;
        }
      }

      console.log(`[PROCESS] Batch complete. Processed: ${processed}, Excluded: ${excluded}, New aggregated feedbacks: ${newAggregatedFeedbacks}, Matched aggregated feedbacks: ${matchedAggregatedFeedbacks}`);

      const remainingCount = countResult.count - items.length;
      const message = remainingCount > 0
        ? `Processed ${items.length} items. ${remainingCount} items remaining. Click "Process with AI" again to continue.`
        : 'All feedbacks processed successfully!';

      // Store last processing time
      const processingTime = new Date().toISOString();

      return new Response(JSON.stringify({
        start,
        end,
        processed,
        excluded,
        new_aggregated_feedbacks: newAggregatedFeedbacks,
        matched_aggregated_feedbacks: matchedAggregatedFeedbacks,
        remaining: remainingCount,
        message,
        last_processed: processingTime
      }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // UI page
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Feedback Consolidation</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 40px 24px;
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header h1 {
      color: #fff;
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0 0 12px 0;
      text-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header p {
      color: rgba(255,255,255,0.85);
      font-size: 1.1rem;
      margin: 0;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      padding: 28px;
      margin-bottom: 24px;
      overflow: visible;
    }
    .controls {
      display: flex;
      gap: 16px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .input-group {
      flex: 1;
      min-width: 140px;
    }
    .input-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .input-group input {
      width: 100%;
      padding: 12px 14px;
      font-size: 15px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      transition: all 0.2s ease;
      background: #f8fafc;
    }
    .input-group input:focus {
      outline: none;
      border-color: #667eea;
      background: #fff;
      box-shadow: 0 0 0 4px rgba(102,126,234,0.1);
    }
    .btn-group {
      display: flex;
      gap: 12px;
    }
    button {
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-secondary {
      background: #f1f5f9;
      color: #475569;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
      transform: translateY(-1px);
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      box-shadow: 0 4px 14px rgba(102,126,234,0.4);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102,126,234,0.5);
    }
    .btn-primary:active {
      transform: translateY(0);
    }
    .last-processed {
      margin-top: 16px;
      padding: 12px 0;
      font-size: 13px;
      color: #64748b;
      border-top: 1px solid #f1f5f9;
    }
    .last-processed span {
      font-weight: 600;
      color: #334155;
    }
    .status {
      margin-top: 16px;
      padding: 14px 18px;
      border-radius: 10px;
      font-size: 14px;
      display: none;
    }
    .status.visible {
      display: block;
    }
    .status.loading {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    .status.success {
      background: #d1fae5;
      color: #065f46;
      border: 1px solid #6ee7b7;
    }
    .table-wrapper {
      overflow-x: auto;
      overflow-y: visible;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      position: relative;
    }
    thead th {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #64748b;
      padding: 16px 12px;
      text-align: left;
      border-bottom: 2px solid #e2e8f0;
      background: #f8fafc;
      position: relative;
      white-space: nowrap;
    }
    thead th:first-child {
      border-radius: 10px 0 0 0;
      width: 40%;
    }
    thead th:last-child { border-radius: 0 10px 0 0; }
    tbody tr {
      transition: background 0.15s ease;
    }
    tbody tr:hover {
      background: #f8fafc;
    }
    tbody td {
      padding: 18px 12px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
      font-size: 15px;
      vertical-align: middle;
    }
    tbody td:first-child {
      width: 40%;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .aggregated-feedback-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      background: #ede9fe;
      color: #5b21b6;
      vertical-align: middle;
    }
    .right { text-align: right; }
    .number {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .impact {
      color: #059669;
      font-weight: 700;
    }
    .sources {
      font-size: 13px;
      color: #64748b;
    }
    .row-select {
      padding: 6px 8px;
      font-size: 13px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 90px;
    }
    .row-select:hover {
      border-color: #cbd5e1;
      background: #f8fafc;
    }
    .row-select:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
    }
    .rice-score {
      color: #7c3aed;
      font-weight: 700;
      font-size: 16px;
    }
    .expand-btn {
      padding: 2px 8px;
      font-size: 14px;
      font-weight: 700;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      background: #fff;
      color: #475569;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-right: 8px;
      vertical-align: middle;
      min-width: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .expand-btn:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }
    .detail-row {
      background: #f8fafc;
    }
    .detail-row:hover {
      background: #f1f5f9;
    }
    .detail-cell {
      padding: 12px 12px;
      font-size: 13px;
      color: #64748b;
      border-bottom: 1px solid #e2e8f0;
    }
    .detail-feedback {
      font-style: italic;
      padding-left: 28px;
      max-width: 600px;
      line-height: 1.5;
    }
    .detail-source {
      font-weight: 600;
      color: #475569;
    }
    .detail-impact {
      font-weight: 600;
      color: #059669;
    }
    .tooltip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #cbd5e1;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .tooltip:hover {
      background: #94a3b8;
    }
    .tooltip.active {
      background: #667eea;
      color: #fff;
    }
    #tooltipPopup {
      display: none;
      position: fixed;
      width: 320px;
      background-color: #1e293b;
      color: #fff;
      text-align: left;
      border-radius: 12px;
      padding: 16px;
      z-index: 10000;
      font-size: 13px;
      font-weight: 400;
      line-height: 1.6;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      white-space: normal;
      pointer-events: auto;
    }
    #tooltipPopup.visible {
      display: block;
    }
    #tooltipPopup::before {
      content: "";
      position: absolute;
      width: 12px;
      height: 12px;
      background-color: #1e293b;
      transform: rotate(45deg);
    }
    #tooltipPopup.below::before {
      top: -6px;
      left: 50%;
      margin-left: -6px;
    }
    #tooltipPopup.above::before {
      bottom: -6px;
      left: 50%;
      margin-left: -6px;
    }
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: #94a3b8;
    }
    .empty-state p {
      margin: 0;
      font-size: 15px;
    }
    .progress-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 32px 24px;
    }
    .progress-dots {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .progress-dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      animation: dotPulse 1.4s ease-in-out infinite;
    }
    .progress-dot:nth-child(2) {
      animation-delay: 0.2s;
    }
    .progress-dot:nth-child(3) {
      animation-delay: 0.4s;
    }
    .progress-dot:nth-child(4) {
      animation-delay: 0.6s;
    }
    .progress-dot:nth-child(5) {
      animation-delay: 0.8s;
    }
    @keyframes dotPulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.4;
      }
      50% {
        transform: scale(1.3);
        opacity: 1;
      }
    }
    .progress-text {
      font-size: 15px;
      color: #475569;
      font-weight: 500;
    }
    .progress-subtext {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .th-content {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .right .th-content {
      justify-content: flex-end;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>RICE Prioritization for Product Managers</h1>
      <p>AI-powered feedback aggregation with RICE scoring framework</p>
    </div>

    <div class="card">
      <div class="controls">
        <div class="input-group">
          <label>Start Date</label>
          <input id="start" type="date" value="2026-01-01" />
        </div>
        <div class="input-group">
          <label>End Date</label>
          <input id="end" type="date" value="2026-01-16" />
        </div>
        <div class="btn-group">
          <button id="process" class="btn-primary">
            Process with AI
          </button>
        </div>
      </div>
      <div class="last-processed" id="lastProcessed">
        Last processed: <span id="lastProcessedTime">Not yet</span>
      </div>
      <div class="status" id="status"></div>
    </div>

    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>
                <span class="th-content">
                  <span>Aggregated Feedback</span>
                  <span class="tooltip" data-tip="AI-generated aggregation of feedbacks summarizing multiple related feedback items">?</span>
                </span>
              </th>
              <th class="right">
                <span class="th-content">
                  <span>Reach</span>
                  <span class="tooltip" data-tip="Number of distinct feedback events in this aggregated line within the selected date range">?</span>
                </span>
              </th>
              <th class="right">
                <span class="th-content">
                  <span>Impact</span>
                  <span class="tooltip" data-tip="Sum of contract values tied to distinct feedbacks in this aggregated line (weights: 5=$100K+, 4=$50–99K, 3=$10–49K, 2=$2.5–9K, 1=<$2.5K) within the selected date range">?</span>
                </span>
              </th>
              <th>
                <span class="th-content">
                  <span>Sources</span>
                  <span class="tooltip" data-tip="Breakdown of feedback by source: CS (customer support), GitHub, X (Twitter), Discord, Email">?</span>
                </span>
              </th>
              <th>
                <span class="th-content">
                  <span>Confidence</span>
                  <span class="tooltip" data-tip="How confident are you this is truly a priority now? (50%, 80%, or 100%)">?</span>
                </span>
              </th>
              <th>
                <span class="th-content">
                  <span>Effort</span>
                  <span class="tooltip" data-tip="Estimated effort of handling this aggregated feedback on a scale of 1 (least effort) to 5 (most effort)">?</span>
                </span>
              </th>
              <th class="right">
                <span class="th-content">
                  <span>RICE Score</span>
                  <span class="tooltip" data-tip="Priority score = (Reach × Impact × Confidence) / Effort. Higher scores = higher priority.">?</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="7">
              <div class="empty-state">
                <p>Loading feedback data...</p>
              </div>
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div id="tooltipPopup"></div>

<script>
  const $ = (id) => document.getElementById(id);

  function fmtMoney(n){
    return (Number(n)||0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});
  }

  function setStatus(msg, type){
    const el = $('status');
    el.textContent = msg;
    el.className = 'status visible ' + type;
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return 'Not yet';

    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return diffMins + ' minutes ago';
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return diffHours + ' hours ago';
    if (diffDays === 1) return '1 day ago';
    return diffDays + ' days ago';
  }

  async function updateStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();
    $('lastProcessedTime').textContent = formatTimeAgo(data.last_processed);
  }

  let cachedData = null; // Store data for re-sorting without fetching
  let rowSettings = {}; // Store per-row confidence/effort settings

  function calculateRICE(reach, impact, confidence, effort) {
    return (reach * impact * confidence) / effort;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function toggleDetails(aggregateId, button) {
    const detailRows = document.querySelectorAll('.detail-row[data-aggregate-id="' + aggregateId + '"]');
    const isExpanded = button.textContent === '-';

    detailRows.forEach(row => {
      row.style.display = isExpanded ? 'none' : 'table-row';
    });

    button.textContent = isExpanded ? '+' : '-';
  }

  function updateRICEScore(aggregateId) {
    const confidenceSelect = document.querySelector('select[data-id="' + aggregateId + '"][data-type="confidence"]');
    const effortSelect = document.querySelector('select[data-id="' + aggregateId + '"][data-type="effort"]');
    const riceCell = document.querySelector('td[data-rice-id="' + aggregateId + '"]');

    if (!confidenceSelect || !effortSelect || !riceCell) return;

    const confidence = parseFloat(confidenceSelect.value);
    const effort = parseFloat(effortSelect.value);

    // Store settings
    rowSettings[aggregateId] = { confidence, effort };

    // Find the row data
    const row = cachedData.table.find(r => r.aggregate_id === aggregateId);
    if (!row) return;

    const rice = calculateRICE(row.reach_total, row.impact_score, confidence, effort);
    riceCell.textContent = rice.toFixed(1);

    // Re-sort table
    renderTable();
  }

  function renderTable() {
    if (!cachedData) return;

    const rows = cachedData.table || [];
    const tbody = $('tbody');
    tbody.innerHTML = '';

    if(rows.length === 0){
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><p>No processed data yet. Click "Process with AI" to classify feedback.</p></div></td></tr>';
      return;
    }

    // Calculate RICE for each row and sort
    const rowsWithRICE = rows
      .filter(r => r.reach_total > 0)
      .map(r => {
        const settings = rowSettings[r.aggregate_id] || { confidence: 1.0, effort: 1 };
        return {
          ...r,
          confidence: settings.confidence,
          effort: settings.effort,
          rice_score: calculateRICE(r.reach_total, r.impact_score, settings.confidence, settings.effort)
        };
      })
      .sort((a, b) => b.rice_score - a.rice_score);

    for(const r of rowsWithRICE){
      // Format source badges
      const sourcesList = Object.entries(r.reach_by_source || {})
        .map(([source, count]) => source + ' (' + count + ')')
        .join(', ');

      const tr = document.createElement('tr');
      tr.className = 'aggregate-row';
      tr.dataset.aggregateId = r.aggregate_id;
      tr.innerHTML =
        '<td>' +
          '<button class="expand-btn" data-aggregate-id="' + r.aggregate_id + '">+</button> ' +
          '<span class="aggregated-feedback-badge">' + r.aggregate_text + '</span>' +
        '</td>' +
        '<td class="right number">' + r.reach_total + '</td>' +
        '<td class="right number impact">' + r.impact_score.toFixed(1) + '</td>' +
        '<td class="sources">' + (sourcesList || 'N/A') + '</td>' +
        '<td><select class="row-select" data-id="' + r.aggregate_id + '" data-type="confidence">' +
          '<option value="0.5"' + (r.confidence === 0.5 ? ' selected' : '') + '>50%</option>' +
          '<option value="0.8"' + (r.confidence === 0.8 ? ' selected' : '') + '>80%</option>' +
          '<option value="1.0"' + (r.confidence === 1.0 ? ' selected' : '') + '>100%</option>' +
        '</select></td>' +
        '<td><select class="row-select" data-id="' + r.aggregate_id + '" data-type="effort">' +
          '<option value="1"' + (r.effort === 1 ? ' selected' : '') + '>1</option>' +
          '<option value="2"' + (r.effort === 2 ? ' selected' : '') + '>2</option>' +
          '<option value="3"' + (r.effort === 3 ? ' selected' : '') + '>3</option>' +
          '<option value="4"' + (r.effort === 4 ? ' selected' : '') + '>4</option>' +
          '<option value="5"' + (r.effort === 5 ? ' selected' : '') + '>5</option>' +
        '</select></td>' +
        '<td class="right number rice-score" data-rice-id="' + r.aggregate_id + '">' + r.rice_score.toFixed(1) + '</td>';
      tbody.appendChild(tr);

      // Create detail rows for distinct feedbacks (initially hidden)
      if (r.distinct_feedbacks && r.distinct_feedbacks.length > 0) {
        for (const feedback of r.distinct_feedbacks) {
          const detailTr = document.createElement('tr');
          detailTr.className = 'detail-row';
          detailTr.dataset.aggregateId = r.aggregate_id;
          detailTr.style.display = 'none';

          const contractValueFormatted = feedback.contract_value
            ? fmtMoney(feedback.contract_value)
            : '$0';

          detailTr.innerHTML =
            '<td class="detail-cell" colspan="1">' +
              '<div class="detail-feedback">' + escapeHtml(feedback.text) + '</div>' +
            '</td>' +
            '<td class="right detail-cell"></td>' +
            '<td class="right detail-cell detail-impact">' + contractValueFormatted + '</td>' +
            '<td class="detail-cell detail-source">' + feedback.source + '</td>' +
            '<td class="detail-cell"></td>' +
            '<td class="detail-cell"></td>' +
            '<td class="detail-cell"></td>';
          tbody.appendChild(detailTr);
        }
      }
    }

    // Add expand/collapse event listeners
    document.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const aggregateId = e.target.dataset.aggregateId;
        toggleDetails(aggregateId, e.target);
      });
    });

    // Add event listeners to all dropdowns
    document.querySelectorAll('.row-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.id);
        updateRICEScore(id);
      });
    });

    // Show excluded count if available
    if (cachedData.excluded_count > 0) {
      setStatus('Showing ' + rowsWithRICE.length + ' aggregated feedbacks. ' + cachedData.excluded_count + ' distinct feedback items excluded as noise.', 'success');
    }
  }

  async function loadTable(){
    const start = $('start').value;
    const end = $('end').value;

    const res = await fetch('/api/table?start=' + start + '&end=' + end);
    cachedData = await res.json();

    renderTable();
  }

  async function processAI(){
    const start = $('start').value;
    const end = $('end').value;
    setStatus('Processing feedback with AI...', 'loading');
    $('process').disabled = true;

    // Show animated progress in the table
    const tbody = $('tbody');
    tbody.innerHTML = '<tr><td colspan="7">' +
      '<div class="progress-container">' +
        '<div class="progress-dots">' +
          '<div class="progress-dot"></div>' +
          '<div class="progress-dot"></div>' +
          '<div class="progress-dot"></div>' +
          '<div class="progress-dot"></div>' +
          '<div class="progress-dot"></div>' +
        '</div>' +
        '<div>' +
          '<div class="progress-text">AI is analyzing your feedback...</div>' +
          '<div class="progress-subtext">Classifying actionability and aggregating themes</div>' +
        '</div>' +
      '</div>' +
    '</td></tr>';

    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start, end })
    });
    const data = await res.json();

    const msg = 'Processed ' + data.processed + ' items\\n' +
                'Excluded as noise: ' + data.excluded + '\\n' +
                'Aggregated feedbacks updated: ' + data.new_aggregated_feedbacks + ' new, ' + data.matched_aggregated_feedbacks + ' matched';

    setStatus(msg, 'success');
    $('process').disabled = false;

    // Update last processed time immediately
    if (data.last_processed) {
      $('lastProcessedTime').textContent = formatTimeAgo(data.last_processed);
    }

    // Wait 5 seconds before updating the table so user can see the results
    await new Promise(resolve => setTimeout(resolve, 5000));

    await loadTable();
  }

  $('process').addEventListener('click', processAI);

  // Tooltip handling
  const tooltipPopup = $('tooltipPopup');
  let currentTooltip = null;

  function showTooltip(element, text) {
    const rect = element.getBoundingClientRect();
    const popupWidth = 320;
    const popupHeight = 100; // Approximate height
    const spacing = 12;

    // Remove active class from previous tooltip
    if (currentTooltip) {
      currentTooltip.classList.remove('active');
    }

    // Add active class to current tooltip
    element.classList.add('active');
    currentTooltip = element;

    // Set content
    tooltipPopup.textContent = text;
    tooltipPopup.classList.add('visible');

    // Calculate position - prefer below, but show above if not enough space
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let top, left;
    if (spaceBelow >= popupHeight + spacing) {
      // Show below
      top = rect.bottom + spacing;
      tooltipPopup.classList.remove('above');
      tooltipPopup.classList.add('below');
    } else if (spaceAbove >= popupHeight + spacing) {
      // Show above
      top = rect.top - popupHeight - spacing;
      tooltipPopup.classList.remove('below');
      tooltipPopup.classList.add('above');
    } else {
      // Not enough space either way, show below anyway
      top = rect.bottom + spacing;
      tooltipPopup.classList.remove('above');
      tooltipPopup.classList.add('below');
    }

    // Center horizontally relative to the tooltip icon
    left = rect.left + (rect.width / 2) - (popupWidth / 2);

    // Keep within viewport bounds
    const padding = 16;
    if (left < padding) left = padding;
    if (left + popupWidth > window.innerWidth - padding) {
      left = window.innerWidth - popupWidth - padding;
    }

    tooltipPopup.style.top = top + 'px';
    tooltipPopup.style.left = left + 'px';
  }

  function hideTooltip() {
    tooltipPopup.classList.remove('visible');
    if (currentTooltip) {
      currentTooltip.classList.remove('active');
      currentTooltip = null;
    }
  }

  // Event delegation for tooltip clicks
  document.addEventListener('click', (e) => {
    const tooltip = e.target.closest('.tooltip');
    if (tooltip) {
      e.stopPropagation();
      const text = tooltip.getAttribute('data-tip');
      if (currentTooltip === tooltip) {
        // Clicking the same tooltip again closes it
        hideTooltip();
      } else {
        showTooltip(tooltip, text);
      }
    } else {
      // Click outside closes tooltip
      hideTooltip();
    }
  });

  // Close tooltip on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideTooltip();
    }
  });

  // Initial load
  updateStatus();
  loadTable();
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
};
