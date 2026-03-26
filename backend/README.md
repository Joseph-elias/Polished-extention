# Polished Backend - FastAPI + Gemini

## Setup

1. Clone the repo and navigate to `backend/`:

```
cd polished-extension/backend
```

2. Create a `.env` file in `backend/`:

```
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-1.5-flash
# Optional:
# GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
```

3. Install dependencies:

```
pip install -r requirements.txt
```

4. Run the server:

```
uvicorn main:app --reload
```

- The API will be available at `http://localhost:8000/`
- The rewrite endpoint: `POST /rewrite`

## Endpoint

- **POST** `/rewrite`
- **Body:**
  ```json
  {
    "text": "...",
    "mode": "grammar_only | natural | professional | concise"
  }
  ```
- **Response:**
  ```json
  {
    "original_text": "...",
    "detected_language": "",
    "mode": "...",
    "rewritten_text": "..."
  }
  ```

## Notes
- The backend is ready for local development and can be deployed anywhere FastAPI runs.
- The Gemini API key is never exposed to the frontend/extension.
- `backend/.env` is loaded automatically by the backend config.
- Prompt logic is in `prompts/rewrite_prompt.txt` for easy editing.
- You can swap out Gemini for another LLM by updating `services/llm_service.py`.
