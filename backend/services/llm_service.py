import requests
from config import config


class GeminiLLMService:
    def __init__(self):
        self.api_key = config.GEMINI_API_KEY
        self.api_url = config.GEMINI_API_URL

    def rewrite(self, prompt: str) -> str:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is not configured.")

        headers = {"Content-Type": "application/json"}
        params = {"key": self.api_key}
        data = {
            "contents": [
                {"parts": [{"text": prompt}]}
            ]
        }
        try:
            response = requests.post(self.api_url, headers=headers, params=params, json=data, timeout=30)
            response.raise_for_status()
        except requests.RequestException as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            body = exc.response.text if exc.response is not None else str(exc)
            body_preview = body[:350].replace("\n", " ")
            raise RuntimeError(f"Gemini API request failed (status {status}): {body_preview}") from exc

        result = response.json()
        # Gemini returns candidates[0].content.parts[0].text
        try:
            return result["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as exc:
            raise RuntimeError("Gemini response parsing failed: missing candidates/content/parts/text.") from exc
