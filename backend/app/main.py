from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import text
from app.api.routes import router
from app.auth.security import hash_password
from app.core.config import settings
from app.database.session import Base, SessionLocal, engine
from app.models.entities import Category, User

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
        ensure_bootstrap_admin()
        db_startup_error = None
    except SQLAlchemyError as exc:
        db_startup_error = str(exc)
        print(f"Database startup failed: {db_startup_error}")
    except Exception as exc:
        db_startup_error = f"{type(exc).__name__}: {exc}"
        print(f"Application startup failed: {db_startup_error}")


def ensure_bootstrap_admin():
    password = settings.bootstrap_admin_password or settings.setup_token
    if not password:
        return

    db = SessionLocal()
    try:
        if db.query(User).filter(User.role == "admin", User.is_active.is_(True)).first():
            return

        admin = db.query(User).filter(User.email == settings.bootstrap_admin_email).first()
        if admin:
            admin.name = settings.bootstrap_admin_name
            admin.password_hash = hash_password(password)
            admin.role = "admin"
            admin.is_active = True
        else:
            admin = User(
                name=settings.bootstrap_admin_name,
                email=settings.bootstrap_admin_email,
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
            db.add(admin)

        if not db.query(Category).filter(Category.scope == "company").first():
            db.add(Category(name="Geral", icon="chat", scope="company"))
        db.commit()
        print(f"Bootstrap admin created: {settings.bootstrap_admin_email}")
    finally:
        db.close()


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
