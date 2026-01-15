export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API: return aggregated themes table
    if (url.pathname === "/api/table") {
      const start = url.searchParams.get("start") || "2026-01-10";
      const end = url.searchParams.get("end") || "2026-01-14";

      // Aggregate by theme by reading feedback rows and their themes_json
      const rows = await env.db_binding
        .prepare(
          `SELECT id, created_at, source, text, is_actionable, themes_json, reach, impact_usd
           FROM feedback
           WHERE created_at >= ? AND created_at <= ?`
        )
        .bind(start, end)
        .all();

      const feedbackItems = rows.results || [];

      // Build theme aggregates in JS (simple + transparent for demo)
      const agg = {};

      for (const item of feedbackItems) {
        const isActionable = Number(item.is_actionable ?? 1) === 1;
        if (!isActionable) continue;

        let themes = [];
        try {
          themes = JSON.parse(item.themes_json || "[]");
        } catch {
          themes = [];
        }

        if (themes.length === 0) themes = ["Uncategorized"];

        for (const t of themes) {
          if (!agg[t]) agg[t] = { theme: t, items: 0, reach: 0, impact_usd: 0 };
          agg[t].items += 1;
          agg[t].reach += Number(item.reach || 0);
          agg[t].impact_usd += Number(item.impact_usd || 0);
        }
      }

      const table = Object.values(agg).sort((a, b) => b.impact_usd - a.impact_usd);

      return new Response(JSON.stringify({ start, end, total_items: feedbackItems.length, table }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // API: "Process with AI" (for now: simulated classification)
    if (url.pathname === "/api/process" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const start = body.start || "2026-01-10";
      const end = body.end || "2026-01-14";

      const rows = await env.db_binding
        .prepare(
          `SELECT id, text
           FROM feedback
           WHERE created_at >= ? AND created_at <= ?`
        )
        .bind(start, end)
        .all();

      const items = rows.results || [];

      let processed = 0;
      let excluded = 0;

      // Simple rules to simulate AI: noise vs themes
      for (const item of items) {
        const text = String(item.text || "").toLowerCase();

        let is_actionable = 1;
        let themes = [];

        // noise examples
        if (text.includes("thanks") || text.includes("great") || text.length < 12) {
          is_actionable = 0;
        }

        if (is_actionable === 0) {
          excluded += 1;
        } else {
          if (text.includes("crash") || text.includes("bug") || text.includes("does not work")) themes.push("Bug");
          if (text.includes("slow") || text.includes("performance")) themes.push("Performance");
          if (text.includes("expensive") || text.includes("price") || text.includes("pricing")) themes.push("Pricing");
          if (text.includes("signup") || text.includes("onboarding")) themes.push("Onboarding");
          if (text.includes("add") || text.includes("feature") || text.includes("export")) themes.push("Feature request");
          if (themes.length === 0) themes.push("Uncategorized");

          processed += 1;
        }

        await env.db_binding
          .prepare(`UPDATE feedback SET is_actionable = ?, themes_json = ? WHERE id = ?`)
          .bind(is_actionable, JSON.stringify(themes), item.id)
          .run();
      }

      return new Response(JSON.stringify({ start, end, processed, excluded }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // UI page
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Feedback Demo</title>
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
      max-width: 900px;
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
    .status {
      margin-top: 20px;
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
    }
    table {
      width: 100%;
      border-collapse: collapse;
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
    }
    thead th:first-child { border-radius: 10px 0 0 0; }
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
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .theme-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .theme-bug { background: #fee2e2; color: #991b1b; }
    .theme-performance { background: #fef3c7; color: #92400e; }
    .theme-pricing { background: #dbeafe; color: #1e40af; }
    .theme-onboarding { background: #d1fae5; color: #065f46; }
    .theme-feature { background: #ede9fe; color: #5b21b6; }
    .theme-uncategorized { background: #f1f5f9; color: #475569; }
    .right { text-align: right; }
    .number {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .impact {
      color: #059669;
      font-weight: 700;
    }
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: #94a3b8;
    }
    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .empty-state p {
      margin: 0;
      font-size: 15px;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .loading-indicator {
      animation: pulse 1.5s ease-in-out infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Feedback Consolidation</h1>
      <p>Classify and analyze customer feedback with AI-powered insights</p>
    </div>

    <div class="card">
      <div class="controls">
        <div class="input-group">
          <label>Start Date</label>
          <input id="start" type="date" value="2026-01-10" />
        </div>
        <div class="input-group">
          <label>End Date</label>
          <input id="end" type="date" value="2026-01-14" />
        </div>
        <div class="btn-group">
          <button id="refresh" class="btn-secondary">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v5h5M20 20v-5h-5"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L4 7m16 10l-1.64 1.36A9 9 0 0 1 3.51 15"/></svg>
            Load Table
          </button>
          <button id="process" class="btn-primary">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg>
            Process with AI
          </button>
        </div>
      </div>
      <div class="status" id="status"></div>
    </div>

    <div class="card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Theme</th>
              <th class="right">Items</th>
              <th class="right">Reach</th>
              <th class="right">Impact (USD)</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="4">
              <div class="empty-state">
                <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"/></svg>
                <p>Loading feedback data...</p>
              </div>
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);

  function fmtMoney(n){
    return (Number(n)||0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});
  }

  function getThemeClass(theme){
    const t = theme.toLowerCase();
    if(t.includes('bug')) return 'theme-bug';
    if(t.includes('performance')) return 'theme-performance';
    if(t.includes('pricing')) return 'theme-pricing';
    if(t.includes('onboarding')) return 'theme-onboarding';
    if(t.includes('feature')) return 'theme-feature';
    return 'theme-uncategorized';
  }

  function setStatus(msg, type){
    const el = $('status');
    el.textContent = msg;
    el.className = 'status visible ' + type;
  }

  async function loadTable(){
    const start = $('start').value;
    const end = $('end').value;
    setStatus('Loading feedback data...', 'loading');

    const res = await fetch('/api/table?start=' + start + '&end=' + end);
    const data = await res.json();

    setStatus('Loaded ' + data.total_items + ' feedback items from ' + data.start + ' to ' + data.end, 'success');

    const rows = data.table || [];
    const tbody = $('tbody');
    tbody.innerHTML = '';

    if(rows.length === 0){
      tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg><p>No actionable items yet. Click "Process with AI" to classify feedback.</p></div></td></tr>';
      return;
    }

    for(const r of rows){
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="theme-badge ' + getThemeClass(r.theme) + '">' + r.theme + '</span></td>' +
        '<td class="right number">' + r.items + '</td>' +
        '<td class="right number">' + r.reach.toLocaleString() + '</td>' +
        '<td class="right number impact">' + fmtMoney(r.impact_usd) + '</td>';
      tbody.appendChild(tr);
    }
  }

  async function processAI(){
    const start = $('start').value;
    const end = $('end').value;
    setStatus('Processing feedback with AI...', 'loading');
    $('process').disabled = true;

    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start, end })
    });
    const data = await res.json();

    setStatus('Processed ' + data.processed + ' items (' + data.excluded + ' excluded as noise). Refreshing...', 'success');
    $('process').disabled = false;

    await loadTable();
  }

  $('refresh').addEventListener('click', loadTable);
  $('process').addEventListener('click', processAI);

  // auto-load on first open
  loadTable();
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};