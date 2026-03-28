# Polished (Full Project)

Polished is an AI writing assistant made of:

- a **Chrome Extension (MV3)** for capture/rewrite/translate/notes in the browser
- a **FastAPI backend** that calls Gemini to rewrite and translate text

This README is the single entry point for running and understanding the full project.

## What It Does

Polished helps you:

- capture highlighted text from webpages and editable fields
- rewrite text with multiple modes:
  - `grammar_only`
  - `natural`
  - `professional`
  - `concise`
- translate text to selected target languages
- replace rewritten/translated text back into the page
- save notes tied to the current page URL (persistent)
- view notes in popup and in-page sticky notes widget
- edit/delete notes from popup or directly from sticky notes UI
- export all notes as:
  - JSON
  - Markdown

## Project Structure

```text
polished-extension/
  backend/      # FastAPI + Gemini integration
  extension/    # Chrome extension (popup/content/background)
```

## Architecture Overview

### Extension side

- `extension/popup.*`
  - main user UI (rewrite, translate, notes, export)
- `extension/content.ts`
  - text selection capture
  - inline floating toolbar near selected text
  - replace text in page
  - sticky notes overlay on page
- `extension/utils/notesStorage.ts`
  - URL normalization
  - CRUD for notes in `chrome.storage.local`
- `extension/utils/exportNotes.ts`
  - export all notes to downloadable JSON/Markdown

### Backend side

- `backend/main.py`
  - FastAPI app + CORS
- `backend/routes/rewrite.py`
  - `POST /rewrite`
  - `POST /translate`
- `backend/services/llm_service.py`
  - Gemini API call logic
- `backend/prompts/*.txt`
  - prompt templates for rewrite/translate

## Notes Storage Model

Notes are stored in `chrome.storage.local` under `pageNotes`, grouped by normalized URL.

Normalization removes:

- hash fragments (`#...`)
- common tracking params (`utm_*`, `fbclid`, `gclid`, etc.)

This keeps notes tied to the same page across revisits while avoiding tracking-noise duplicates.

## Requirements

- Python 3.10+
- Node.js + npm
- Chrome (Developer Mode for loading unpacked extension)
- Gemini API key

## 1) Backend Setup

From `polished-extension/backend`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create `backend/.env`:

```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash-lite
# Optional override:
# GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent
```

Run backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Backend URLs:

- Home: `http://localhost:8000/`
- Health: `http://localhost:8000/health`

## 2) Extension Setup

From `polished-extension/extension`:

```powershell
npm.cmd install
npm.cmd run build
```

Load extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `polished-extension/extension`

After code changes:

1. Run `npm.cmd run build`
2. Click **Reload** on extension card
3. Refresh target webpage

## API Endpoints

### `POST /rewrite`

Request:

```json
{
  "text": "Hello i need help",
  "mode": "grammar_only"
}
```

Response:

```json
{
  "original_text": "Hello i need help",
  "detected_language": "",
  "mode": "grammar_only",
  "rewritten_text": "Hello, I need help."
}
```

### `POST /translate`

Request:

```json
{
  "text": "Bonjour",
  "target_language": "English"
}
```

Response:

```json
{
  "original_text": "Bonjour",
  "target_language": "English",
  "translated_text": "Hello"
}
```

## Typical User Flow

1. Highlight text on a page
2. Open popup or use inline toolbar
3. Rewrite or translate
4. Optionally replace text in page
5. Save important information + personal comment as page note
6. Revisit same page later and see notes restored
7. Export knowledge as JSON or Markdown

## Security Notes

- Keep `backend/.env` private
- Never expose Gemini key in extension frontend
- If key leaks, rotate immediately

## Troubleshooting

- Popup not seeing selected text:
  - Reload extension
  - Refresh page
  - Reselect text and reopen popup
- Restricted pages (like `chrome://*`) block scripts by design
- Backend 502 errors:
  - check API key/model/quota
  - inspect backend error detail

## Existing Component READMEs

- Backend details: `backend/README.md`
- Extension details: `extension/README.md`

This root README is the high-level universal guide; sub-readmes keep component-specific details.
