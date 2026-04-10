from pydantic_settings import BaseSettings
from functools import lru_cache


_RENDER_DB = (
    "postgresql://niyo_user:Vq5K3V0pd2XVuA16GORBfBkkmLmxbua3"
    "@dpg-d6rpna450q8c73f6qbq0-a.oregon-postgres.render.com/openclaw-medical"
)
_RENDER_DB_ASYNC = _RENDER_DB.replace("postgresql://", "postgresql+asyncpg://", 1)


class Settings(BaseSettings):
    database_url: str = _RENDER_DB_ASYNC
    sync_database_url: str = _RENDER_DB
    fhir_base_url: str = "http://localhost:8080/fhir"
    run_host: str = "0.0.0.0"
    run_port: int = 8000
    anthropic_api_key: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
