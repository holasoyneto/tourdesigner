"""Repository factory selecting Firestore (prod) or normalized local SQLite (dev/test)."""

from __future__ import annotations

from app.config import Settings
from app.repo.firestore import FirestoreRepo
from app.repo.protocol import TourRepo
from app.repo.sqlite_local import LocalSqliteRepo


def build_repo(settings: Settings) -> TourRepo:
    if settings.repo_backend == "firestore":
        return FirestoreRepo(
            project=settings.firestore_project,
            database=settings.firestore_database,
            prefix=settings.firestore_prefix,
        )
    return LocalSqliteRepo(settings.local_db_path)
