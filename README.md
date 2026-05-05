# Lens — AI Page Summarizer

A Manifest V3 Chrome Extension that summarizes any webpage instantly.
Powered by Groq (free, no credit card required).

---

## Setup (one-time, 3 minutes)

### 1. Get a free Groq API key
- Go to **https://console.groq.com/keys**
- Sign in with Google → Create API Key → copy the `gsk_...` key

### 2. Add your key to the extension
Open `src/config.js` and replace `YOUR_GROQ_API_KEY_HERE` with your key:

```js
export const CONFIG = {
  GROQ_API_KEY: "gsk_your_actual_key_here",
  ...
};
```

### 3. Load into Chrome
- Go to `chrome://extensions/`
- Enable **Developer mode**
- Click **Load unpacked** → select this folder
- Done — click any article and hit **Summarize Page**

---

## Security

- `src/config.js` is listed in `.gitignore` — it is **never committed to GitHub**
- API key only lives on your machine
- All AI calls made from the background service worker only
- Content scripts have zero access to the key

---

## File Structure

```
lens/
├── manifest.json
├── popup.html
├── .gitignore          ← keeps config.js off GitHub
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── config.js       ← YOUR KEY GOES HERE (gitignored)
    ├── background.js   ← AI calls, caching
    ├── content.js      ← DOM extraction, highlights
    └── popup.js        ← UI controller
```

---

## License
MIT
