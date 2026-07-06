from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.routes import router
from app.core.config import settings
from app.database.session import Base, engine

Base.metadata.create_all(bind=engine)
PANEL_DIR = Path(__file__).resolve().parents[2] / "panel"
cors_origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
if PANEL_DIR.exists():
    app.mount("/panel", StaticFiles(directory=PANEL_DIR, html=True), name="panel")


@app.get("/health")
def health():
    return {"status": "ok"}
