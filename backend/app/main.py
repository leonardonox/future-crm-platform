from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from app.api.routes import router
from app.core.config import settings
from app.database.session import Base, engine

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


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/db")
def health_db():
    with engine.connect() as conn:
        conn.execute(text("select 1"))
    return {"status": "ok"}
