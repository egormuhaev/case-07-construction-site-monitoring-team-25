from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ANALYSIS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8002
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    max_concurrent_jobs: int = Field(default=2, ge=1)
    queue_limit: int = Field(default=16, ge=1)
    job_ttl_seconds: int = 604800
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "monitoring_db"
    postgres_user: str = "admin"
    postgres_password: str = "admin_password"
    log_level: str = "INFO"

    min_frames_good: int = Field(default=8, ge=1)
    min_cameras_good: int = Field(default=2, ge=1)
    min_hour_span_good: int = Field(default=2, ge=1)
    min_frames_partial: int = Field(default=1, ge=1)
    gap_days_threshold: int = Field(default=2, ge=1)
    person_gap_enabled: bool = False
    low_confidence_threshold: float = Field(default=0.4, ge=0.0, le=1.0)
    # Слабая видимость при наличии суточной нормы (LOW_INTENSITY).
    weak_presence_max_hours: int = Field(default=1, ge=0)
    weak_presence_max_objects: int = Field(default=2, ge=0)
    # GAP считается «заметным» по суточному объёму, если daily > 0.
    notable_daily_volume: float = Field(default=0.0, ge=0.0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
