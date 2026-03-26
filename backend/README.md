# Polished Backend (FastAPI + Gemini)

FastAPI service used by the Chrome extension to rewrite text with Gemini.

## Current Behavior
- Endpoint: `POST /rewrite`
- Valid modes:
  - `grammar_only`
  - `natural`
  - `professional`
  - `concise`
- Loads `.env` automatically from `backend/.env`
- Uses Gemini `generateContent` REST API
- Returns detailed provider errors when Gemini request fails

## Setup

### 1) Go to backend directory
```powershell
cd polished-extension/backend
```

### 2) Create virtual environment (recommended)
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 3) Configure environment
Create `backend/.env`:

```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash-lite
# Optional explicit endpoint override:
# GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent
```

## Run
From `polished-extension/backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Server:
- `http://localhost:8000/`

Health check:
- `GET /` returns `{"message":"Polished backend is running."}`

## API Contract

### Request
`POST /rewrite`

```json
{
  "text": "Hello i need help",
  "mode": "grammar_only"
}
```

### Response
```json
{
  "original_text": "Hello i need help",
  "detected_language": "",
  "mode": "grammar_only",
  "rewritten_text": "Hello, I need help."
}
```

## Error Handling
- `400`: missing text or invalid mode
- `500`: server configuration issue (for example missing `GEMINI_API_KEY`)
- `502`: upstream Gemini error (status and provider message included in `detail`)

Example:
- `Gemini API request failed (status 404): ... model not found ...`

## Security Notes
- Do not expose Gemini key in frontend/extension
- Keep `backend/.env` private (`backend/.gitignore` ignores it)
- If key is ever exposed, rotate it immediately

## Deploy Notes
- Deploy this backend before publishing extension
- Update extension `API_URL` in `extension/popup.ts` to your production backend
- Ensure CORS remains enabled for extension calls
