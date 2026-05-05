// popup.js — Lens UI Controller
// No settings panel. No API key input. Just click and summarize.

(function () {
  "use strict";

  let currentTab     = null;
  let currentSummary = null;
  let highlightsActive = false;
  let toastTimer     = null;

  const $ = id => document.getElementById(id);

  const el = {
    pageTitle:    $("pageTitle"),
    pageDomain:   $("pageDomain"),
    favicon:      $("favicon"),
    panelIdle:    $("panelIdle"),
    panelLoading: $("panelLoading"),
    panelError:   $("panelError"),
    panelSummary: $("panelSummary"),
    loadingStep:  $("loadingStep"),
    errorMsg:     $("errorMsg"),
    overview:     $("overview"),
    statRow:      $("statRow"),
    bullets:      $("bullets"),
    insights:     $("insights"),
    cacheNotice:  $("cacheNotice"),
    rowPrimary:   $("rowPrimary"),
    rowActions:   $("rowActions"),
    summarizeBtn: $("summarizeBtn"),
    highlightBtn: $("highlightBtn"),
    copyBtn:      $("copyBtn"),
    clearBtn:     $("clearBtn"),
    refreshBtn:   $("refreshBtn"),
    toast:        $("toast"),
  };

  // ── Init ─────────────────────────────────────────────────────────
  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tab;
      if (tab) {
        el.pageTitle.textContent = tab.title || "Untitled Page";
        try {
          const url = new URL(tab.url);
          el.pageDomain.textContent = url.hostname;
          el.favicon.src = `https://www.google.com/s2/favicons?sz=14&domain=${url.hostname}`;
          el.favicon.onerror = () => { el.favicon.style.display = "none"; };
        } catch (_) {
          el.pageDomain.textContent = tab.url || "";
        }
      }
      bindEvents();
    } catch (err) {
      console.error("[Lens] init error:", err);
    }
  }

  // ── Events ───────────────────────────────────────────────────────
  function bindEvents() {
    el.summarizeBtn.addEventListener("click", () => onSummarize(false));
    el.refreshBtn.addEventListener("click",   () => onSummarize(true));
    el.highlightBtn.addEventListener("click", onToggleHighlight);
    el.copyBtn.addEventListener("click",      onCopy);
    el.clearBtn.addEventListener("click",     onClear);
  }

  // ── Summarize ────────────────────────────────────────────────────
  async function onSummarize(forceRefresh = false) {
    if (!currentTab) return;

    showPanel("loading");
    setStep("Extracting page content…");

    try {
      // Extract content from the page
      let extracted;
      try {
        extracted = await chrome.tabs.sendMessage(currentTab.id, { type: "EXTRACT_CONTENT" });
      } catch (_) {
        await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ["src/content.js"] });
        extracted = await chrome.tabs.sendMessage(currentTab.id, { type: "EXTRACT_CONTENT" });
      }

      if (!extracted?.ok) throw new Error(extracted?.error || "Failed to read page content.");
      if (!extracted.data.content || extracted.data.content.length < 60) {
        throw new Error("Not enough readable text on this page.\nTry an article, blog post, or Wikipedia page.");
      }

      setStep("Sending to AI…");

      // Send to background for AI call
      const res = await bgMsg({
        type: "SUMMARIZE",
        payload: {
          url:          extracted.data.url,
          content:      extracted.data.content,
          title:        extracted.data.title,
          wordCount:    extracted.data.wordCount,
          forceRefresh,
        },
      });

      currentSummary = res.data.summary;
      renderSummary(currentSummary, res.data.fromCache);
      showPanel("summary");

    } catch (err) {
      showError(err.message || "An unexpected error occurred.");
    }
  }

  // ── Render ───────────────────────────────────────────────────────
  function renderSummary(s, fromCache) {
    el.cacheNotice.classList.toggle("show", !!fromCache);
    el.overview.textContent = decode(s.summary || "");

    // Stat chips
    el.statRow.innerHTML = "";
    [
      { icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`, text: `${s.readingTimeMinutes || 1} min read` },
      { icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`, text: `${(s.wordCount||0).toLocaleString()} words` },
      { dot: s.sentiment || "neutral", text: cap(s.sentiment || "neutral") },
      { icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`, text: cap(s.category || "article") },
    ].forEach(c => el.statRow.appendChild(makeChip(c)));

    // Bullets
    el.bullets.innerHTML = "";
    (s.bullets || []).forEach((text, i) => {
      const li = document.createElement("li");
      li.className = "b-row";
      li.style.animationDelay = `${i * 0.05}s`;
      li.innerHTML = `<span class="b-num">0${i+1}</span><span class="b-text">${esc(decode(text))}</span>`;
      el.bullets.appendChild(li);
    });

    // Insights
    el.insights.innerHTML = "";
    (s.keyInsights || []).forEach(text => {
      const div = document.createElement("div");
      div.className = "i-row";
      div.innerHTML = `
        <span class="i-icon">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </span>
        <span class="i-text">${esc(decode(text))}</span>`;
      el.insights.appendChild(div);
    });

    el.rowPrimary.style.display = "none";
    el.rowActions.style.display = "flex";
    el.refreshBtn.style.display = "flex";
    highlightsActive = false;
    el.highlightBtn.classList.remove("active");
  }

  function makeChip({ dot, icon, text }) {
    const div = document.createElement("div");
    div.className = "chip";
    if (dot) {
      const map = { positive:"pos", negative:"neg", neutral:"neu", mixed:"mix" };
      const sp = document.createElement("span");
      sp.className = `dot ${map[dot] || "neu"}`;
      div.appendChild(sp);
    } else if (icon) {
      const w = document.createElement("span");
      w.innerHTML = icon;
      div.appendChild(w.firstChild);
    }
    const t = document.createElement("span");
    t.textContent = text;
    div.appendChild(t);
    return div;
  }

  // ── Highlight ────────────────────────────────────────────────────
  async function onToggleHighlight() {
    if (!currentTab || !currentSummary) return;
    if (highlightsActive) {
      await chrome.tabs.sendMessage(currentTab.id, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
      highlightsActive = false;
      el.highlightBtn.classList.remove("active");
      showToast("Highlights cleared", "ok");
    } else {
      const phrases = (currentSummary.highlightPhrases || []);
      if (!phrases.length) { showToast("No phrases to highlight", "err"); return; }
      try {
        await chrome.tabs.sendMessage(currentTab.id, { type: "HIGHLIGHT", payload: { phrases: phrases.map(decode) } });
        highlightsActive = true;
        el.highlightBtn.classList.add("active");
        showToast(`${phrases.length} phrases highlighted`, "ok");
      } catch (_) {
        showToast("Highlight unavailable on this page", "err");
      }
    }
  }

  // ── Copy ─────────────────────────────────────────────────────────
  async function onCopy() {
    if (!currentSummary) return;
    const s = currentSummary;
    const text = [
      "SUMMARY", decode(s.summary || ""), "",
      "KEY POINTS", (s.bullets || []).map((b,i) => `${i+1}. ${decode(b)}`).join("\n"), "",
      "INSIGHTS",   (s.keyInsights || []).map(i => `• ${decode(i)}`).join("\n"), "",
      `${s.readingTimeMinutes||1} min · ${(s.wordCount||0).toLocaleString()} words · ${cap(s.sentiment||"")} · ${cap(s.category||"")}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard", "ok");
    } catch (_) {
      showToast("Copy failed", "err");
    }
  }

  // ── Clear ────────────────────────────────────────────────────────
  async function onClear() {
    if (currentTab && highlightsActive) {
      await chrome.tabs.sendMessage(currentTab.id, { type: "CLEAR_HIGHLIGHTS" }).catch(() => {});
    }
    if (currentTab?.url) {
      await bgMsg({ type: "CLEAR_CACHE", payload: { url: currentTab.url } }).catch(() => {});
    }
    currentSummary = null;
    highlightsActive = false;
    el.highlightBtn.classList.remove("active");
    el.rowPrimary.style.display = "";
    el.rowActions.style.display = "none";
    el.refreshBtn.style.display = "none";
    showPanel("idle");
  }

  // ── UI helpers ───────────────────────────────────────────────────
  function showPanel(name) {
    ["idle","loading","error","summary"].forEach(p => {
      document.getElementById(`panel${cap(p)}`)?.classList.toggle("active", p === name);
    });
  }

  function showError(msg) {
    el.errorMsg.textContent = msg;
    showPanel("error");
    el.rowPrimary.style.display = "";
    el.rowActions.style.display = "none";
    el.refreshBtn.style.display = "none";
  }

  function setStep(t) { el.loadingStep.textContent = t; }

  function showToast(text, type = "ok") {
    clearTimeout(toastTimer);
    el.toast.textContent = text;
    el.toast.className   = `toast show ${type}`;
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2600);
  }

  // ── Messaging ────────────────────────────────────────────────────
  function bgMsg(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res)      return reject(new Error("No response from background."));
        if (!res.ok)   return reject(new Error(res.error || "Unknown error."));
        resolve(res);
      });
    });
  }

  // ── Utilities ────────────────────────────────────────────────────
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function decode(s) {
    if (typeof s !== "string") return "";
    return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#039;/g,"'");
  }
  function esc(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
