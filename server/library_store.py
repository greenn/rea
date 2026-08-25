from __future__ import annotations

from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
from typing import Any, Iterator


SCHEMA_VERSION = 1


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_data_dir(project_root: Path) -> Path:
    configured = os.getenv("REA_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if os.name == "nt" and os.getenv("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "REA" / "data"
    if os.getenv("XDG_DATA_HOME"):
        return Path(os.environ["XDG_DATA_HOME"]) / "rea"
    try:
        return Path.home() / ".local" / "share" / "rea"
    except RuntimeError:
        return project_root / ".rea-data"


class LibraryStore:
    """Durable local REA library backed by SQLite and ordinary audio files."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.expanduser().resolve()
        self.audio_dir = self.data_dir / "audio"
        self.backup_dir = self.data_dir / "backups"
        self.db_path = self.data_dir / "rea-library.sqlite3"
        self._lock = threading.RLock()
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._lock, self._connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = FULL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    assigned_date TEXT NOT NULL DEFAULT '',
                    purpose TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS recordings (
                    id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    uploaded_at TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    audio_key TEXT,
                    audio_size INTEGER NOT NULL DEFAULT 0,
                    audio_type TEXT NOT NULL DEFAULT ''
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_recordings_group_name ON recordings(group_id, name)"
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            connection.execute("PRAGMA optimize")
        self.backup_if_due()

    @staticmethod
    def _payload(row: sqlite3.Row) -> dict[str, Any]:
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, json.JSONDecodeError):
            payload = {}
        return payload if isinstance(payload, dict) else {}

    def snapshot(self) -> dict[str, Any]:
        with self._lock, self._connection() as connection:
            group_rows = connection.execute(
                "SELECT * FROM groups ORDER BY name COLLATE NOCASE, id"
            ).fetchall()
            recording_rows = connection.execute(
                "SELECT * FROM recordings ORDER BY group_id, name COLLATE NOCASE, id"
            ).fetchall()

        groups: list[dict[str, Any]] = []
        for row in group_rows:
            payload = self._payload(row)
            payload.update({
                "id": row["id"],
                "name": row["name"],
                "assignedDate": row["assigned_date"],
                "purpose": row["purpose"],
                "createdAt": payload.get("createdAt") or row["created_at"],
                "updatedAt": row["updated_at"],
            })
            payload.pop("files", None)
            groups.append(payload)

        recordings: list[dict[str, Any]] = []
        for row in recording_rows:
            payload = self._payload(row)
            audio_path = self.audio_dir / row["audio_key"] if row["audio_key"] else None
            payload.update({
                "id": row["id"],
                "groupId": row["group_id"],
                "name": row["name"],
                "uploadedAt": payload.get("uploadedAt") or row["uploaded_at"],
                "updatedAt": row["updated_at"],
                "audioAvailable": bool(audio_path and audio_path.is_file()),
                "audioSize": int(row["audio_size"] or 0),
            })
            recordings.append(payload)

        return {
            "ok": True,
            "schemaVersion": SCHEMA_VERSION,
            "groups": groups,
            "recordings": recordings,
        }

    def put_group(self, payload: dict[str, Any]) -> dict[str, Any]:
        group_id = str(payload.get("id") or "").strip()
        name = str(payload.get("name") or "").strip()
        if not group_id or not name:
            raise ValueError("Group id and name are required")
        now = utc_now()
        stored = dict(payload)
        stored["id"] = group_id
        stored["name"] = name
        stored["createdAt"] = str(stored.get("createdAt") or now)
        stored["updatedAt"] = str(stored.get("updatedAt") or now)
        stored.pop("files", None)
        with self._lock, self._connection() as connection:
            connection.execute(
                """
                INSERT INTO groups(id, name, assigned_date, purpose, created_at, updated_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    assigned_date = excluded.assigned_date,
                    purpose = excluded.purpose,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    group_id,
                    name,
                    str(stored.get("assignedDate") or ""),
                    str(stored.get("purpose") or ""),
                    stored["createdAt"],
                    stored["updatedAt"],
                    json.dumps(stored, ensure_ascii=False, separators=(",", ":")),
                ),
            )
        return stored

    def put_recording(self, payload: dict[str, Any]) -> dict[str, Any]:
        recording_id = str(payload.get("id") or "").strip()
        group_id = str(payload.get("groupId") or "").strip()
        name = str(payload.get("name") or "").strip()
        if not recording_id or not group_id or not name:
            raise ValueError("Recording id, groupId and name are required")
        now = utc_now()
        stored = dict(payload)
        stored["id"] = recording_id
        stored["groupId"] = group_id
        stored["name"] = name
        stored["updatedAt"] = str(stored.get("updatedAt") or now)
        stored.pop("audioAvailable", None)
        stored.pop("audioSize", None)
        with self._lock, self._connection() as connection:
            group_exists = connection.execute("SELECT 1 FROM groups WHERE id = ?", (group_id,)).fetchone()
            if not group_exists:
                raise ValueError(f"Recording group does not exist: {group_id}")
            connection.execute(
                """
                INSERT INTO recordings(id, group_id, name, uploaded_at, created_at, updated_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    group_id = excluded.group_id,
                    name = excluded.name,
                    uploaded_at = excluded.uploaded_at,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    recording_id,
                    group_id,
                    name,
                    str(stored.get("uploadedAt") or ""),
                    str(stored.get("createdAt") or stored.get("uploadedAt") or now),
                    stored["updatedAt"],
                    json.dumps(stored, ensure_ascii=False, separators=(",", ":")),
                ),
            )
        return stored

    def save_audio_file(
        self,
        recording_id: str,
        source_path: Path,
        original_name: str,
        content_type: str,
        size: int,
    ) -> Path:
        suffix = Path(original_name).suffix.lower()
        if not suffix or len(suffix) > 12 or not suffix[1:].isalnum():
            suffix = ".bin"
        audio_key = f"{hashlib.sha256(recording_id.encode('utf-8')).hexdigest()}{suffix}"
        destination = self.audio_dir / audio_key
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT audio_key FROM recordings WHERE id = ?", (recording_id,)
            ).fetchone()
            if not row:
                raise ValueError("Recording metadata must be saved before its audio")
            previous_key = row["audio_key"]
            os.replace(source_path, destination)
            connection.execute(
                "UPDATE recordings SET audio_key = ?, audio_size = ?, audio_type = ? WHERE id = ?",
                (audio_key, int(size), str(content_type or ""), recording_id),
            )
        if previous_key and previous_key != audio_key:
            (self.audio_dir / previous_key).unlink(missing_ok=True)
        return destination

    def audio(self, recording_id: str) -> tuple[Path, str, str] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT name, audio_key, audio_type FROM recordings WHERE id = ?", (recording_id,)
            ).fetchone()
        if not row or not row["audio_key"]:
            return None
        path = self.audio_dir / row["audio_key"]
        if not path.is_file():
            return None
        return path, str(row["audio_type"] or "application/octet-stream"), str(row["name"])

    def delete_recording(self, recording_id: str) -> bool:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT audio_key FROM recordings WHERE id = ?", (recording_id,)
            ).fetchone()
            connection.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
        if row and row["audio_key"]:
            (self.audio_dir / row["audio_key"]).unlink(missing_ok=True)
        return bool(row)

    def delete_group(self, group_id: str) -> bool:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT audio_key FROM recordings WHERE group_id = ?", (group_id,)
            ).fetchall()
            result = connection.execute("DELETE FROM groups WHERE id = ?", (group_id,))
        for row in rows:
            if row["audio_key"]:
                (self.audio_dir / row["audio_key"]).unlink(missing_ok=True)
        return result.rowcount > 0

    def backup_if_due(self, minimum_interval_seconds: int = 21600) -> Path | None:
        if not self.db_path.exists() or self.db_path.stat().st_size == 0:
            return None
        backups = sorted(self.backup_dir.glob("rea-library-*.sqlite3"), key=lambda path: path.stat().st_mtime)
        now = datetime.now(timezone.utc).timestamp()
        if backups and now - backups[-1].stat().st_mtime < minimum_interval_seconds:
            return backups[-1]
        target = self.backup_dir / datetime.now().strftime("rea-library-%Y%m%d-%H%M%S.sqlite3")
        with self._lock, closing(self._connect()) as source, closing(sqlite3.connect(target)) as destination:
            source.backup(destination)
        for old_backup in backups[:-9]:
            old_backup.unlink(missing_ok=True)
        return target

    def health(self) -> dict[str, Any]:
        try:
            with self._lock, self._connection() as connection:
                integrity = str(connection.execute("PRAGMA quick_check").fetchone()[0])
                groups = int(connection.execute("SELECT COUNT(*) FROM groups").fetchone()[0])
                recordings = int(connection.execute("SELECT COUNT(*) FROM recordings").fetchone()[0])
                with_audio = int(connection.execute(
                    "SELECT COUNT(*) FROM recordings WHERE audio_key IS NOT NULL"
                ).fetchone()[0])
            audio_bytes = sum(path.stat().st_size for path in self.audio_dir.iterdir() if path.is_file())
            return {
                "ok": integrity == "ok",
                "integrity": integrity,
                "schemaVersion": SCHEMA_VERSION,
                "groups": groups,
                "recordings": recordings,
                "recordingsWithAudio": with_audio,
                "databaseBytes": self.db_path.stat().st_size if self.db_path.exists() else 0,
                "audioBytes": audio_bytes,
                "dataDirectory": str(self.data_dir),
                "databasePath": str(self.db_path),
            }
        except (OSError, sqlite3.Error) as error:
            return {
                "ok": False,
                "integrity": "error",
                "schemaVersion": SCHEMA_VERSION,
                "detail": str(error),
                "dataDirectory": str(self.data_dir),
                "databasePath": str(self.db_path),
            }
