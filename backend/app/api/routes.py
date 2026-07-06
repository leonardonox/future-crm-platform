from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.core.config import settings
from app.database.session import get_db
from app.models.entities import Category, Favorite, QuickMessage, UsageLog, User
from app.schemas.dto import (
    CategoryIn,
    CategoryOut,
    LoginIn,
    MessageIn,
    MessageOut,
    PasswordChangeIn,
    SetupAdminIn,
    TokenOut,
    UsageIn,
    UsageOut,
    UserIn,
    UserOut,
    UserUpdate,
)

router = APIRouter(prefix="/api")
VALID_SCOPES = {"user", "company"}
VALID_ROLES = {"agent", "admin"}


def is_admin(user: User) -> bool:
    return user.role == "admin"


def require_admin(user: User):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Apenas administradores podem acessar este recurso")


def validate_scope(scope: str):
    if scope not in VALID_SCOPES:
        raise HTTPException(status_code=422, detail="Escopo inválido")


def validate_role(role: str):
    if role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Perfil inválido")


def ensure_company_scope_allowed(scope: str, user: User):
    validate_scope(scope)
    if scope == "company" and not is_admin(user):
        raise HTTPException(status_code=403, detail="Apenas administradores podem gerenciar itens da empresa")


def can_manage_message(message: QuickMessage, user: User) -> bool:
    if message.scope == "company":
        return is_admin(user)
    return message.owner_user_id == user.id


def get_visible_message(message_id: int, user: User, db: Session) -> QuickMessage:
    message = db.get(QuickMessage, message_id)
    if not message or not message.is_active:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada")
    if message.scope != "company" and message.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada")
    return message


def get_visible_category(category_id: int, scope: str, user: User, db: Session) -> Category:
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    if category.scope == "company":
        return category
    if category.owner_user_id == user.id and scope == "user":
        return category
    raise HTTPException(status_code=403, detail="Categoria não permitida para este item")


def bootstrap_admin_password() -> str | None:
    return settings.bootstrap_admin_password or settings.setup_token


def upsert_bootstrap_admin(db: Session) -> User | None:
    password = bootstrap_admin_password()
    if not password:
        return None

    user = db.query(User).filter(User.email == settings.bootstrap_admin_email).first()
    if user:
        user.name = settings.bootstrap_admin_name
        user.password_hash = hash_password(password)
        user.role = "admin"
        user.is_active = True
    else:
        user = User(
            name=settings.bootstrap_admin_name,
            email=settings.bootstrap_admin_email,
            password_hash=hash_password(password),
            role="admin",
            is_active=True,
        )
        db.add(user)
        db.flush()

    if not db.query(Category).filter(Category.scope == "company").first():
        db.add(Category(name="Geral", icon="chat", scope="company"))

    db.commit()
    db.refresh(user)
    return user


@router.post("/auth/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if (
        payload.email == settings.bootstrap_admin_email
        and payload.password == bootstrap_admin_password()
        and (not user or not user.is_active or not verify_password(payload.password, user.password_hash))
    ):
        user = upsert_bootstrap_admin(db)
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")
    return TokenOut(access_token=create_access_token(user.email))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.put("/me/password")
def change_password(payload: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Senha atual inválida")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}


@router.get("/admin/users", response_model=list[UserOut])
def list_users(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    return db.query(User).order_by(User.name.asc()).all()


@router.post("/admin/users", response_model=UserOut)
def create_user(payload: UserIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    validate_role(payload.role)
    exists = db.query(User).filter(User.email == payload.email).first()
    if exists:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado")
    row = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/admin/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    validate_role(payload.role)
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    exists = db.query(User).filter(User.email == payload.email, User.id != user_id).first()
    if exists:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado")
    row.name = payload.name
    row.email = payload.email
    row.role = payload.role
    row.is_active = payload.is_active
    if payload.password:
        row.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/admin/users/{user_id}")
def deactivate_user(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    row.is_active = False
    db.commit()
    return {"ok": True}


@router.get("/admin/usage", response_model=list[UsageOut])
def list_usage(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(user)
    return db.query(UsageLog).order_by(UsageLog.created_at.desc()).limit(200).all()


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Category).filter((Category.scope == "company") | (Category.owner_user_id == user.id)).order_by(Category.name.asc()).all()


@router.post("/categories", response_model=CategoryOut)
def create_category(payload: CategoryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_company_scope_allowed(payload.scope, user)
    category = Category(
        name=payload.name,
        icon=payload.icon[:20],
        scope=payload.scope,
        owner_user_id=None if payload.scope == "company" else user.id,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.get("/messages", response_model=list[MessageOut])
def list_messages(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(QuickMessage).filter(
        QuickMessage.is_active.is_(True),
        ((QuickMessage.scope == "company") | (QuickMessage.owner_user_id == user.id)),
    ).all()
    category_ids = {row.category_id for row in rows}
    categories = {row.id: row for row in db.query(Category).filter(Category.id.in_(category_ids)).all()} if category_ids else {}
    favorite_ids = {fav.message_id for fav in db.query(Favorite).filter(Favorite.user_id == user.id).all()}
    return [
        MessageOut.model_validate(row, from_attributes=True).model_copy(update={
            "category": categories.get(row.category_id),
            "is_favorite": row.id in favorite_ids,
        })
        for row in rows
    ]


@router.post("/messages", response_model=MessageOut)
def create_message(payload: MessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_company_scope_allowed(payload.scope, user)
    get_visible_category(payload.category_id, payload.scope, user, db)
    message = QuickMessage(
        title=payload.title,
        content=payload.content,
        category_id=payload.category_id,
        scope=payload.scope,
        owner_user_id=None if payload.scope == "company" else user.id,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


@router.put("/messages/{message_id}", response_model=MessageOut)
def update_message(message_id: int, payload: MessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.get(QuickMessage, message_id)
    if not message or not message.is_active or not can_manage_message(message, user):
        raise HTTPException(status_code=404, detail="Mensagem não encontrada")
    ensure_company_scope_allowed(payload.scope, user)
    get_visible_category(payload.category_id, payload.scope, user, db)
    message.title = payload.title
    message.content = payload.content
    message.category_id = payload.category_id
    message.scope = payload.scope
    message.owner_user_id = None if payload.scope == "company" else user.id
    db.commit()
    db.refresh(message)
    return message


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = db.get(QuickMessage, message_id)
    if not message or not message.is_active or not can_manage_message(message, user):
        raise HTTPException(status_code=404, detail="Mensagem não encontrada")
    message.is_active = False
    db.commit()
    return {"ok": True}


@router.post("/messages/{message_id}/favorite")
def favorite_message(message_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_visible_message(message_id, user, db)
    exists = db.query(Favorite).filter(Favorite.user_id == user.id, Favorite.message_id == message_id).first()
    if not exists:
        db.add(Favorite(user_id=user.id, message_id=message_id))
        db.commit()
    return {"ok": True}


@router.delete("/messages/{message_id}/favorite")
def unfavorite_message(message_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_visible_message(message_id, user, db)
    db.query(Favorite).filter(Favorite.user_id == user.id, Favorite.message_id == message_id).delete()
    db.commit()
    return {"ok": True}


@router.post("/messages/{message_id}/usage")
def log_message_usage(message_id: int, payload: UsageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_visible_message(message_id, user, db)
    db.add(UsageLog(user_id=user.id, message_id=message_id, source=payload.source[:40]))
    db.commit()
    return {"ok": True}


@router.post("/setup/dev")
def setup_dev(db: Session = Depends(get_db)):
    if settings.env != "dev":
        raise HTTPException(status_code=404, detail="Setup disponível apenas em ambiente dev")
    if db.query(User).filter(User.email == "admin@futurecrm.com").first():
        return {"ok": True, "email": "admin@futurecrm.com", "password": "123456"}
    user = User(name="Admin Future", email="admin@futurecrm.com", password_hash=hash_password("123456"), role="admin")
    db.add(user)
    db.flush()
    cat = Category(name="Editorial", icon="books", scope="company")
    db.add(cat)
    db.flush()
    db.add(QuickMessage(
        title="Solicitar ORCID",
        content="Olá, {{nome}}. Para prosseguirmos, precisamos do seu ORCID. Você pode criar gratuitamente em: https://orcid.org/register",
        category_id=cat.id,
        scope="company",
    ))
    db.commit()
    return {"ok": True, "email": "admin@futurecrm.com", "password": "123456"}


@router.post("/setup/first-admin", response_model=UserOut)
def setup_first_admin(payload: SetupAdminIn, db: Session = Depends(get_db)):
    if not settings.setup_token or payload.setup_token != settings.setup_token:
        raise HTTPException(status_code=403, detail="Token de setup inválido")

    try:
        user = db.query(User).filter(User.email == payload.email).first()
        if user:
            user.name = payload.name
            user.password_hash = hash_password(payload.password)
            user.role = "admin"
            user.is_active = True
        else:
            user = User(
                name=payload.name,
                email=payload.email,
                password_hash=hash_password(payload.password),
                role="admin",
                is_active=True,
            )
            db.add(user)
            db.flush()

        if not db.query(Category).filter(Category.scope == "company").first():
            db.add(Category(name="Geral", icon="chat", scope="company"))

        db.commit()
        db.refresh(user)
        return user
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
