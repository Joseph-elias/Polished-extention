# Polished Chrome Extension (MV3)

Chrome extension popup that rewrites selected text through your FastAPI backend and replaces it back in the page.

## Current Features
- Capture highlighted text from `input`, `textarea`, and `contenteditable` fields (including Gmail compose)
- Rewrite modes:
  - `grammar_only`
  - `natural`
  - `professional`
  - `concise`
- One-click actions:
  - `Rewrite`
  - `Copy`
  - `Replace in Page`
- Error handling for unavailable tabs/content script injection
- Footer credit links (GitHub + LinkedIn)

## Project Structure
- `manifest.json`: Extension manifest (MV3)
- `popup.html`, `popup.css`, `popup.ts`: Popup UI and logic
- `content.ts`: Page text capture and replacement logic
- `background.ts`: Service worker scaffold
- `assets/`: Icons
- `scripts/copy-js.js`: Copies compiled JS from `dist/` to extension root

## Local Development

### 1) Build the extension
From `polished-extension/extension`:

```powershell
npm.cmd install
npm.cmd run build
```

This compiles TypeScript and copies:
- `popup.js`
- `content.js`
- `background.js`

### 2) Load in Chrome
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `polished-extension/extension` folder

### 3) Connect to backend
The popup calls:
- `http://localhost:8000/rewrite`

Make sure backend is running first (see `backend/README.md`).

## Test Flow
1. Open a page with editable text (Gmail compose is supported)
2. Highlight text
3. Open the extension popup
4. Confirm text appears in `Selected Text`
5. Click `Rewrite`
6. Click `Replace in Page` (or `Copy`)

## Important Notes
- After extension changes:
  - Run `npm.cmd run build`
  - Click `Reload` in `chrome://extensions`
  - Refresh the target tab (especially Gmail) so latest content script is injected
- For production publish, switch popup API URL from localhost to your deployed backend URL.

## Troubleshooting
- `Could not establish connection. Receiving end does not exist.`:
  - Reload extension and refresh tab
  - Avoid restricted pages like `chrome://*`
- `Failed to rewrite` with backend `502`:
  - Check backend error detail (invalid key/model/quota/access)
- Selection not detected:
  - Reselect text and reopen popup
  - Ensure cursor is in an editable field
