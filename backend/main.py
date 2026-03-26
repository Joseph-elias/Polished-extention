from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import rewrite

app = FastAPI(title="Polished Rewrite API")

@app.get("/")
def home():
    return {"message": "Polished API is running"}

@app.get("/health")
def health():
    return {"status": "ok"}

# Allow extension to call API from localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rewrite.router)

