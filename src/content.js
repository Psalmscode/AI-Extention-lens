// content.js — Lens Content Script
// Extracts readable text from the page and injects highlights.
// Has ZERO access to the API key.

(function () {
  "use strict";

  if (window.__lensInjected) return;
  window.__lensInjected = true;

  const HL_CLASS = "lens-hl";
  const STYLE_ID = "lens-hl-style";

  // ── Message listener ─────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;

    switch (msg.type) {
      case "EXTRACT_CONTENT":
        try   { respond({ ok: true,  data: extractContent() }); }
        catch (e) { respond({ ok: false, error: e.message }); }
        return true;

      case "HIGHLIGHT":
        try   { applyHighlights(msg.payload.phrases); respond({ ok: true }); }
        catch (e) { respond({ ok: false, error: e.message }); }
        return true;

      case "CLEAR_HIGHLIGHTS":
        removeHighlights();
        respond({ ok: true });
        return true;
    }
  });

  // ── Content extractor ────────────────────────────────────────────
  function extractContent() {
    return {
      title:     document.title || "",
      url:       location.href,
      content:   extractText(findMainContent()),
      wordCount: extractText(findMainContent()).split(/\s+/).filter(Boolean).length,
    };
  }

  function findMainContent() {
    const selectors = [
      "article", '[role="article"]', "main", '[role="main"]',
      "#main-content", "#content", "#article",
      ".article__body", ".article-body", ".article-content",
      ".post-content", ".post-body", ".entry-content",
      ".story-body", ".story-content",
      '[itemprop="articleBody"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && textLen(el) > 250) return el;
    }
    return scoredCandidates()[0]?.el || document.body;
  }

  function scoredCandidates() {
    const results = [];
    for (const el of document.querySelectorAll("div, section, article")) {
      const score = scoreEl(el);
      if (score > 15) results.push({ el, score });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  function scoreEl(el) {
    const len = textLen(el);
    if (len < 100) return 0;
    let s = Math.min(len / 80, 35) + el.querySelectorAll("p").length * 2.5;
    const sig = `${el.className} ${el.id}`.toLowerCase();
    if (/article|content|story|post|entry|body|main/.test(sig)) s += 20;
    if (/nav|sidebar|footer|header|comment|ad|social|share/.test(sig)) s -= 30;
    const ld = el.querySelectorAll("a").length / Math.max(len / 120, 1);
    if (ld > 2.5) s -= 15;
    return s;
  }

  function textLen(el) {
    return (el.innerText || el.textContent || "").trim().length;
  }

  const STRIP = new Set(["script","style","noscript","iframe","svg","nav","header","footer","aside"]);
  const STRIP_ROLE = new Set(["navigation","banner","contentinfo","complementary"]);
  const STRIP_CLS = /\b(nav|menu|sidebar|footer|header|widget|ad|promo|social|share|comment|newsletter)\b/i;
  const BLOCKS = new Set(["p","h1","h2","h3","h4","h5","h6","li","blockquote","tr","dt","dd"]);

  function extractText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("*").forEach(n => {
      const tag  = n.tagName?.toLowerCase();
      const role = n.getAttribute("role") || "";
      const cls  = `${n.className || ""} ${n.id || ""}`;
      if (STRIP.has(tag) || STRIP_ROLE.has(role) || STRIP_CLS.test(cls)) n.remove();
    });
    let out = "";
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (BLOCKS.has(node.tagName.toLowerCase())) out += "\n";
      } else {
        const t = node.textContent.trim();
        if (t) out += t + " ";
      }
    }
    return out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  // ── Highlight engine ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      .${HL_CLASS} {
        background: linear-gradient(120deg, rgba(245,166,35,0.55) 0%, rgba(245,166,35,0.35) 100%);
        border-radius: 3px; padding: 1px 2px;
        box-decoration-break: clone; -webkit-box-decoration-break: clone;
        cursor: default; transition: background 0.2s;
      }
      .${HL_CLASS}:hover {
        background: linear-gradient(120deg, rgba(245,166,35,0.82) 0%, rgba(245,166,35,0.65) 100%);
      }`;
    document.head.appendChild(s);
  }

  function applyHighlights(rawPhrases) {
    removeHighlights();
    if (!rawPhrases?.length) return;
    injectStyles();
    const phrases = rawPhrases.map(decodeEnt).filter(p => p && p.length >= 4);
    if (!phrases.length) return;
    const pattern = new RegExp(`(${phrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})`, "gi");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const tag = n.parentNode?.tagName?.toLowerCase();
        if (!tag || ["script","style","noscript"].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (n.parentNode.classList?.contains(HL_CLASS)) return NodeFilter.FILTER_REJECT;
        pattern.lastIndex = 0;
        return pattern.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const tn of nodes) wrapNode(tn, pattern);
  }

  function wrapNode(textNode, pattern) {
    const text = textNode.textContent;
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      const mark = document.createElement("mark");
      mark.className = HL_CLASS;
      mark.textContent = match[0];
      frag.appendChild(mark);
      last = match.index + match[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  function removeHighlights() {
    document.querySelectorAll(`.${HL_CLASS}`).forEach(mark => {
      const p = mark.parentNode;
      if (p) { p.replaceChild(document.createTextNode(mark.textContent), mark); p.normalize(); }
    });
  }

  function decodeEnt(str) {
    const el = document.createElement("textarea");
    el.innerHTML = str;
    return el.value;
  }
})();
