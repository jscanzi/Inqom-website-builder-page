export const config = { runtime: 'edge' };

// ── Vercel KV state store ────────────────────────────────────────────
// Shared project state for multi-user collaboration.
// GET  /api/state?project=KEY        → returns stored state (or {})
// POST /api/state?project=KEY  {...}  → saves state
//
// Requires env vars KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV / Upstash).

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith('.vercel.app') || host === 'localhost' || host === '127.0.0.1';
  } catch { return false; }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// Sanitize the project key — only allow safe characters, prevents key injection
function safeProjectKey(raw) {
  const key = (raw || 'default').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  return 'briefstate:' + (key || 'default');
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  return r.ok;
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }
  if (!isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (!KV_URL || !KV_TOKEN) {
    return new Response(JSON.stringify({ error: 'KV not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
  }

  const url = new URL(req.url);
  const key = safeProjectKey(url.searchParams.get('project'));

  try {
    if (req.method === 'GET') {
      const state = await kvGet(key);
      return new Response(JSON.stringify({ state: state || null }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      // Basic size guard — KV values should stay reasonable (< 1MB)
      const serialized = JSON.stringify(body);
      if (serialized.length > 1_000_000) {
        return new Response(JSON.stringify({ error: 'State too large' }),
          { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
      }
      const ok = await kvSet(key, body);
      return new Response(JSON.stringify({ ok }),
        { status: ok ? 200 : 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
  }
}
