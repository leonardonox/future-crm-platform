from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Future CRM Platform"
    env: str = "dev"
    secret_key: str
    database_url: str
    access_token_expire_minutes: int = 1440
    cors_origins: str = "*"
    setup_token: str | None = None
    bootstrap_admin_email: str = "admin@future.local"
    bootstrap_admin_name: str = "Admin Future"
    bootstrap_admin_password: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
