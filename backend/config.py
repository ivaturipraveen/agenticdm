from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://localhost/openclaw-medical"
    sync_database_url: str = "postgresql://localhost/openclaw-medical"
    fhir_base_url: str = "http://localhost:8080/fhir"
    run_host: str = "0.0.0.0"
    run_port: int = 8000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
