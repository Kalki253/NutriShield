"""SQLite persistence for NutriShield screening records."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get(
    "NUTRISHIELD_DATABASE",
    str(BASE_DIR / "data" / "nutrishield.sqlite3"),
)).expanduser().resolve()
CHILD_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def configure_database(path: Path) -> None:
    """Set a database path, primarily for isolated tests and deployments."""
    global DATABASE_PATH
    DATABASE_PATH = Path(path).expanduser().resolve()


@contextmanager
def _connect():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _create_screenings_table(connection: sqlite3.Connection, table_name: str = "screenings") -> None:
    connection.execute(
        f"""
        CREATE TABLE {table_name} (
            id TEXT PRIMARY KEY,
            child_code TEXT,
            sex TEXT NOT NULL CHECK (sex IN ('Male', 'Female')),
            age INTEGER NOT NULL CHECK (age BETWEEN 1 AND 21),
            height REAL NOT NULL CHECK (height > 20 AND height <= 250),
            weight REAL NOT NULL CHECK (weight > 1 AND weight <= 150),
            bmi REAL NOT NULL,
            predicted_status TEXT NOT NULL,
            model_version TEXT NOT NULL,
            explainability_json TEXT,
            screened_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )


def initialize_database() -> None:
    with _connect() as connection:
        table_definition = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'screenings'"
        ).fetchone()
        if not table_definition:
            _create_screenings_table(connection)
        else:
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(screenings)").fetchall()
            }
            age_constraint = (table_definition["sql"] or "").upper()
            requires_migration = (
                "owner_user_id" in columns or "BETWEEN 1 AND 5" in age_constraint
            )
            if requires_migration:
                _create_screenings_table(connection, "screenings_migrated")
                connection.execute(
                    """
                    INSERT INTO screenings_migrated (
                        id, child_code, sex, age, height, weight, bmi, predicted_status,
                        model_version, explainability_json, screened_at, created_at
                    )
                    SELECT id, child_code, sex, age, height, weight, bmi, predicted_status,
                           model_version, explainability_json, screened_at, created_at
                    FROM screenings
                    """
                )
                connection.execute("DROP TABLE screenings")
                connection.execute("ALTER TABLE screenings_migrated RENAME TO screenings")

        connection.execute("DROP INDEX IF EXISTS screenings_owner_date_idx")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS screenings_date_idx ON screenings(screened_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS screenings_status_idx ON screenings(predicted_status)"
        )

        # Remove legacy account/session data; records were migrated above.
        connection.execute("DROP TABLE IF EXISTS sessions")
        connection.execute("DROP TABLE IF EXISTS users")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_screening(record: dict) -> dict:
    record_id = str(uuid.uuid4())
    created_at = _utc_now()
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO screenings (
                id, child_code, sex, age, height, weight, bmi,
                predicted_status, model_version, explainability_json, screened_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                record.get("child_code") or None,
                record["sex"],
                record["age"],
                record["height"],
                record["weight"],
                record["bmi"],
                record["predicted_status"],
                record["model_version"],
                record.get("explainability_json"),
                record["screened_at"],
                created_at,
            ),
        )
    return {"id": record_id, **record, "created_at": created_at}


def list_screenings(
    search: str = "",
    predicted_status: str | None = None,
) -> list[dict]:
    conditions = []
    parameters: list[object] = []
    if predicted_status:
        conditions.append("predicted_status = ?")
        parameters.append(predicted_status)
    if search:
        conditions.append("(child_code LIKE ? OR id LIKE ?)")
        search_pattern = f"%{search[:64]}%"
        parameters.extend((search_pattern, search_pattern))
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    with _connect() as connection:
        rows = connection.execute(
            f"""
            SELECT id, child_code, sex, age, height, weight, bmi,
                   predicted_status, model_version, explainability_json, screened_at, created_at
            FROM screenings {where_clause}
            ORDER BY screened_at DESC, id DESC
            LIMIT 10000
            """,
            parameters,
        ).fetchall()
    return [_serialize_screening(row) for row in rows]


def _serialize_screening(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "child_code": row["child_code"],
        "sex": row["sex"],
        "age": row["age"],
        "height": row["height"],
        "weight": row["weight"],
        "bmi": row["bmi"],
        "predicted_status": row["predicted_status"],
        "model_version": row["model_version"],
        "explainability": json.loads(row["explainability_json"]) if row["explainability_json"] else None,
        "screened_at": row["screened_at"],
        "created_at": row["created_at"],
    }


def delete_screening(record_id: str) -> bool:
    with _connect() as connection:
        cursor = connection.execute("DELETE FROM screenings WHERE id = ?", (record_id,))
        return cursor.rowcount > 0


def delete_all_screenings() -> int:
    with _connect() as connection:
        cursor = connection.execute("DELETE FROM screenings")
        return cursor.rowcount


def get_screening_counts() -> dict:
    with _connect() as connection:
        total = connection.execute("SELECT COUNT(*) AS count FROM screenings").fetchone()["count"]
        rows = connection.execute(
            "SELECT predicted_status, COUNT(*) AS count FROM screenings GROUP BY predicted_status"
        ).fetchall()
    return {
        "total_screenings": total,
        "class_counts": {row["predicted_status"]: row["count"] for row in rows},
    }


def update_screening(record_id: str, record: dict) -> dict | None:
    with _connect() as connection:
        cursor = connection.execute(
            """
            UPDATE screenings SET child_code = ?, sex = ?, age = ?, height = ?, weight = ?,
                bmi = ?, predicted_status = ?, model_version = ?, explainability_json = ?,
                screened_at = ? WHERE id = ?
            """,
            (
                record["child_code"] or None,
                record["sex"],
                record["age"],
                record["height"],
                record["weight"],
                record["bmi"],
                record["predicted_status"],
                record["model_version"],
                record.get("explainability_json"),
                record["screened_at"],
                record_id,
            ),
        )
        if cursor.rowcount == 0:
            return None
        row = connection.execute(
            """
            SELECT id, child_code, sex, age, height, weight, bmi, predicted_status,
                   model_version, explainability_json, screened_at, created_at
            FROM screenings WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
    return _serialize_screening(row)
