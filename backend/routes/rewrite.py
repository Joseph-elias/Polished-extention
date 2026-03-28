from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.llm_service import GeminiLLMService

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "rewrite_prompt.txt"
TRANSLATE_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "translate_prompt.txt"
VALID_MODES = ["grammar_only", "natural", "professional", "concise"]

class RewriteRequest(BaseModel):
    text: str
    mode: str  # grammar_only | natural | professional | concise

class RewriteResponse(BaseModel):
    original_text: str
    detected_language: str  # Gemini does not return this, so we echo '' for now
    mode: str
    rewritten_text: str

class TranslateRequest(BaseModel):
    text: str
    target_language: str

class TranslateResponse(BaseModel):
    original_text: str
    target_language: str
    translated_text: str

router = APIRouter()
llm_service = GeminiLLMService()

@router.post("/rewrite", response_model=RewriteResponse)
def rewrite_text(request: RewriteRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required.")
    if request.mode not in VALID_MODES:
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

@router.post("/translate", response_model=TranslateResponse)
def translate_text(request: TranslateRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required.")
    if not request.target_language.strip():
        raise HTTPException(status_code=400, detail="Target language is required.")

    try:
        prompt_template = TRANSLATE_PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Translate prompt template file not found.") from exc

    prompt = prompt_template.format(
        text=request.text,
        target_language=request.target_language.strip()
    )

    try:
        translated = llm_service.rewrite(prompt)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to get translation from Gemini API.") from exc

    return TranslateResponse(
        original_text=request.text,
        target_language=request.target_language.strip(),
        translated_text=translated.strip()
    )
