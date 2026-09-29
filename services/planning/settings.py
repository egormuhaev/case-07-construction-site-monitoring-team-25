from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PLANNING_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8001
    data_dir: Path = Path("/data")
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    max_concurrent_jobs: int = Field(default=1, ge=1)
    queue_limit: int = Field(default=8, ge=1)
    job_ttl_seconds: int = 604800
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "monitoring_db"
    postgres_user: str = "admin"
    postgres_password: str = "admin_password"
    normalize_enabled: bool = False
    llm_url: str = "https://polza.ai/api/v1/chat/completions"
    llm_token: str | None = None
    llm_model: str = "openai/gpt-4.1-nano"
    cache_dir: Path = Path("/cache")
    log_level: str = "INFO"
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    rerank_enabled: bool = True
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    top_k: int = 50


@lru_cache
def get_settings() -> Settings:
    return Settings()
