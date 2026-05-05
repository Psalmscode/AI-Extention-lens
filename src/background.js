// background.js — Lens Service Worker
// ─────────────────────────────────────────────────────────────────
// ★  STEP 1: Paste your free Groq key below
//    Get one at: https://console.groq.com/keys (free, no card)
// ─────────────────────────────────────────────────────────────────

import { CONFIG } from './config.js';

const GROQ_API_KEY = CONFIG.GROQ_API_KEY;
const GROQ_MODEL   = CONFIG.MODEL;
const MAX_TOKENS   = CONFIG.MAX_TOKENS;
const CACHE_TTL    = 30 * 60 * 1000; // 
const CACHE_TTL    = 30 * 60 * 1000; // 30 minutes

// ══════════════════════════════════════════════════════════════════
//  MESSAGE ROUTER
// ══════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg.type) {

    case "SUMMARIZE":
      handleSummarize(msg.payload)
        .then(data => respond({ ok: true, data }))
        .catch(err  => respond({ ok: false, error: err.message }));
      return true;

    case "CLEAR_CACHE":
      clearCache(msg.payload.url)
        .then(()  => respond({ ok: true }))
        .catch(err => respond({ ok: false, error: err.message }));
      return true;
  }
});

// ══════════════════════════════════════════════════════════════════
//  SUMMARIZE HANDLER
// ══════════════════════════════════════════════════════════════════
async function handleSummarize({ url, content, title, wordCount, forceRefresh = false }) {
  const cacheKey = `cache:${hashUrl(url)}`;

  if (!forceRefresh) {
    const hit = await getCache(cacheKey);
    if (hit) return { summary: hit.summary, fromCache: true };
  }

  const summary = await callGroq({ content, title, url, wordCount });

  await chrome.storage.local.set({
    [cacheKey]: { summary, url, title, ts: Date.now() },
  });

  return { summary, fromCache: false };
}

// ══════════════════════════════════════════════════════════════════
//  GROQ API CALL
// ══════════════════════════════════════════════════════════════════
async function callGroq({ content, title, url, wordCount }) {
  if (!GROQ_API_KEY || GROQ_API_KEY === "YOUR_GROQ_API_KEY_HERE") {
    throw new Error(
      "No API key found.\nOpen src/background.js and paste your Groq key.\nGet one free at: https://console.groq.com/keys"
    );
  }

  const prompt = buildPrompt({ content, title, url, wordCount });

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      max_tokens:  MAX_TOKENS,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "You are a content analyst. Always respond with valid JSON only — no markdown, no explanation, no code fences.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return parseResponse(data.choices[0].message.content);
}

// ══════════════════════════════════════════════════════════════════
//  PROMPT
// ══════════════════════════════════════════════════════════════════
function buildPrompt({ content, title, url, wordCount }) {
  return `Analyze this webpage and return a JSON summary.

Title: ${title}
URL: ${url}
Word count: ${wordCount || "unknown"}

--- PAGE CONTENT ---
${content.slice(0, 12000)}
--- END ---

Return ONLY this JSON object, nothing else:
{
  "summary": "<2-3 sentence overview>",
  "bullets": ["<point 1>", "<point 2>", "<point 3>", "<point 4>", "<point 5>"],
  "keyInsights": ["<insight 1>", "<insight 2>", "<insight 3>"],
  "highlightPhrases": ["<3-6 word phrase from text>", "<phrase 2>", "<phrase 3>", "<phrase 4>"],
  "readingTimeMinutes": <integer>,
  "wordCount": <integer>,
  "sentiment": "<positive|neutral|negative|mixed>",
  "category": "<article|documentation|news|tutorial|product|other>"
}`;
}

// ══════════════════════════════════════════════════════════════════
//  RESPONSE PARSER
// ══════════════════════════════════════════════════════════════════
function parseResponse(raw) {
  try {
    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i,     "")
      .replace(/```\s*$/,      "")
      .trim();

    const obj = JSON.parse(clean);
    if (!obj.summary || !Array.isArray(obj.bullets)) throw new Error("Invalid structure");

    return {
      summary:            sanitize(obj.summary),
      bullets:            toArr(obj.bullets).map(sanitize),
      keyInsights:        toArr(obj.keyInsights).map(sanitize),
      highlightPhrases:   toArr(obj.highlightPhrases).map(sanitize),
      readingTimeMinutes: Math.max(1, parseInt(obj.readingTimeMinutes) || 1),
      wordCount:          parseInt(obj.wordCount) || 0,
      sentiment:          sanitize(obj.sentiment || "neutral"),
      category:           sanitize(obj.category  || "article"),
    };
  } catch {
    throw new Error("Could not parse AI response — please try again.");
  }
}

function sanitize(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;")
    .trim();
}

function toArr(v) { return Array.isArray(v) ? v : []; }

// ══════════════════════════════════════════════════════════════════
//  CACHE
// ══════════════════════════════════════════════════════════════════
async function getCache(key) {
  const res   = await chrome.storage.local.get(key);
  const entry = res[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry;
}

async function clearCache(url) {
  await chrome.storage.local.remove(`cache:${hashUrl(url)}`);
}

// ══════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════
function hashUrl(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h) ^ url.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36);
}
