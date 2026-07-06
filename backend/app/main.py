from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import text
from app.api.routes import router
from app.core.config import settings
from app.database.session import Base, engine

PANEL_DIR = Path(__file__).resolve().parents[2] / "panel"
cors_origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
db_startup_error: str | None = None

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
    global db_startup_error
    try:
        Base.metadata.create_all(bind=engine)
        db_startup_error = None
    except SQLAlchemyError as exc:
        db_startup_error = str(exc)
        print(f"Database startup failed: {db_startup_error}")


@app.get("/health")
def health():
    return {"status": "ok", "database_ready": db_startup_error is None}


@app.get("/health/db")
def health_db():
    if db_startup_error:
        return {"status": "error", "detail": db_startup_error}
    with engine.connect() as conn:
        conn.execute(text("select 1"))
    return {"status": "ok"}
