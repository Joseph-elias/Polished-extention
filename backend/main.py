from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import rewrite

app = FastAPI(title="Polished Rewrite API")

# Allow extension to call API from localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rewrite.router)

@app.get("/")
def root():
    return {"message": "Polished backend is running."}
