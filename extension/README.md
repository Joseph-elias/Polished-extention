# Polished Chrome Extension

## Features
- Instantly rewrite and polish text in any input, textarea, or contenteditable field
- Choose rewrite mode: Grammar Only, Natural, Professional, Concise
- Copy or replace text in-place with one click
- Works on any website

## Local Development

1. Build the backend first (see backend/README.md)
2. In `extension/`, run:
   - `npm install` (if you add build tooling)
   - Compile TypeScript to JavaScript (e.g., `tsc` or use a bundler)
3. Load the extension in Chrome:
   - Go to chrome://extensions
   - Enable Developer Mode
   - Click "Load unpacked" and select the `extension/` folder
4. Make sure the backend is running at `http://localhost:8000/`

## File Overview
- `manifest.json` — Chrome extension manifest (MV3)
- `popup.html`, `popup.ts`, `popup.css` — Popup UI and logic
- `content.ts` — Content script for grabbing and replacing text
- `background.ts` — Service worker (for future use)
- `utils/` — Helper functions
- `assets/` — Icons

## Notes
- No secrets or API keys are ever exposed to the extension
- All LLM calls go through your backend
- Minimal, clean UI for best UX

## Future Improvements
- Keyboard shortcut for rewrite
- Rewrite history/favorites
- Options/settings page
- Website allow/block list
- Analytics/logging
- Web Store packaging
