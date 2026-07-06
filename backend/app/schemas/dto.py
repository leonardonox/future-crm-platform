from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UserIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=120)
    role: str = "agent"
    is_active: bool = True


class UserUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: str = "agent"
    is_active: bool = True
    password: str | None = Field(default=None, min_length=6, max_length=120)


class SetupAdminIn(BaseModel):
    setup_token: str
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=120)


class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    icon: str = "💬"
    scope: str = "user"


class CategoryOut(CategoryIn):
    id: int

    class Config:
        from_attributes = True


class MessageIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    content: str = Field(min_length=1)
    category_id: int
    scope: str = "user"


class MessageOut(MessageIn):
    id: int
    category: CategoryOut | None = None
    is_favorite: bool = False

    class Config:
        from_attributes = True


class UsageIn(BaseModel):
    source: str = "extension"


class UsageOut(BaseModel):
    id: int
    user_id: int
    message_id: int
    source: str
    created_at: datetime
    message: MessageOut | None = None
    user: UserOut | None = None

    class Config:
        from_attributes = True
