from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .config import CACHE_DIR, REPORT_DIR, WEIGHTS_DIR


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DETECTING_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8000
    data_dir: Path = Path("/data")
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    max_concurrent_jobs: int = Field(default=1, ge=1)
    queue_limit: int = Field(default=32, ge=1)
    job_ttl_seconds: int = 604800
    save_reports: bool = False
    report_dir: Path = REPORT_DIR
    weights_dir: Path = WEIGHTS_DIR
    cache_dir: Path = CACHE_DIR
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
