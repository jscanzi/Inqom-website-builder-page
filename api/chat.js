export const config = { runtime: 'edge' };

// ── Security configuration ──────────────────────────────────────────
// Allowed models (whitelist) — prevents callers forcing an expensive model
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// Hard cap on tokens per request — prevents runaway cost
const MAX_TOKENS_CAP = 4000;

// Allowed origins: this project's Vercel domains + localhost for dev.
// Matches any *.vercel.app subdomain of the project (production + previews).
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return (
      host.endsWith('.vercel.app') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

// Best-effort in-memory rate limit (per edge instance).
// Not bulletproof across regions, but stops trivial abuse loops.
const RATE_LIMIT = 30;          // requests
const RATE_WINDOW_MS = 60_000;  // per minute
const hits = new Map();         // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── Origin check ──────────────────────────────────────────────────
  // Blocks cross-site browser abuse. (Server-to-server callers can spoof
  // this, but combined with model/token caps the cost surface stays small.)
  if (!isAllowedOrigin(origin)) {
    return new Response(
      JSON.stringify({ error: { message: 'Origin not allowed' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Rate limit ────────────────────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: { message: 'Trop de requêtes — réessayez dans une minute.' } }),
      { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'API key not configured' } }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  }

  try {
    const body = await req.json();

    // ── Sanitize the request: only forward known-safe fields, with caps ──
    const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
    const max_tokens = Math.min(
      typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : 1000,
      MAX_TOKENS_CAP
    );
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({ error: { message: 'messages[] requis' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
      );
    }

    const safeBody = { model, max_tokens, messages: body.messages };
    if (typeof body.system === 'string') safeBody.system = body.system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: err.message } }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  }
}
