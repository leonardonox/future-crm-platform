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
from app.models.entities import Category, Magazine, QuickMessage, User

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
        seed_magazines_from_existing_messages()
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


def seed_magazines_from_existing_messages():
    db = SessionLocal()
    try:
        if db.query(Magazine).first():
            return

        names: dict[str, str] = {}
        rows = db.query(QuickMessage.title).filter(QuickMessage.is_active.is_(True)).all()
        for (title,) in rows:
            prefix = extract_magazine_prefix(title)
            if not prefix:
                continue
            key = normalize_key(prefix)
            if key and key not in names:
                names[key] = prefix

        for key, name in sorted(names.items(), key=lambda item: item[1].lower()):
            db.add(Magazine(key=key, name=name))

        if names:
            db.commit()
            print(f"Seeded {len(names)} magazines from existing messages")
    finally:
        db.close()


def extract_magazine_prefix(title: str | None) -> str | None:
    value = str(title or "").strip()
    if " - " not in value:
        return None
    prefix = value.split(" - ", 1)[0].strip()
    if len(prefix) < 2 or len(prefix) > 120:
        return None
    return prefix


def normalize_key(value: str) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    while "--" in normalized:
        normalized = normalized.replace("--", "-")
    return normalized.strip("-")


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
