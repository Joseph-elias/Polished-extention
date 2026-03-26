from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.llm_service import GeminiLLMService

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "rewrite_prompt.txt"

class RewriteRequest(BaseModel):
    text: str
    mode: str  # grammar_only | natural | professional | concise

class RewriteResponse(BaseModel):
    original_text: str
    detected_language: str  # Gemini does not return this, so we echo '' for now
    mode: str
    rewritten_text: str

router = APIRouter()
llm_service = GeminiLLMService()

@router.post("/rewrite", response_model=RewriteResponse)
def rewrite_text(request: RewriteRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required.")
    if request.mode not in ["grammar_only", "natural", "professional", "concise"]:
        raise HTTPException(status_code=400, detail="Invalid mode.")

    # Load prompt template using a path that is safe across working directories.
    try:
        prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Prompt template file not found.") from exc

    prompt = prompt_template.format(text=request.text, mode=request.mode)

    try:
        rewritten = llm_service.rewrite(prompt)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to get rewrite from Gemini API.") from exc

    return RewriteResponse(
        original_text=request.text,
        detected_language="",  # Could add language detection in future
        mode=request.mode,
        rewritten_text=rewritten.strip()
    )
