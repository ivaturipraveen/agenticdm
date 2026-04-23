"""Shared platform persistence layer.

Holds tables used across workspaces (Agentic DM + LA Care):
  - platform_users    : signup / login accounts
  - platform_sessions : bearer-token sessions
  - lacare_runs       : one row per CCDA pipeline run
  - lacare_documents  : every CCDA document we ever ingested (raw XML + parsed JSON)
  - lacare_hits       : HEDIS evidence findings per run
  - lacare_agent_events: agent status ticks for live pipeline view
  - lacare_logs       : per-run pipeline log stream

Uses psycopg2 synchronously, mirroring fhir_store.py to avoid mixing async
drivers in the same process.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import contextlib
import threading
import time

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from config import get_settings


_PBKDF2_ITERATIONS = 180_000
_SESSION_TTL_HOURS = 24 * 7

_POOL_LOCK = threading.Lock()
_POOL: ThreadedConnectionPool | None = None

# Pool sizing rationale for the single Uvicorn worker (see RENDER_CHECKLIST).
#   minconn = 2   — keep a warm connection for healthz + one foreground request
#   maxconn = 20  — headroom for bursts (LA Care dashboard fires 6 parallel
#                   requests per refresh × concurrent users + pipeline DB work)
# TCP connect timeout keeps the app from wedging when Render Postgres is
# reaching quota or flapping: psycopg2 respects PGCONNECT_TIMEOUT, and we
# enforce a 5-second ceiling on the initial socket handshake. Tune up
# carefully — Render Postgres Starter plan caps at ~97 total connections.
_POOL_MIN_CONN = 2
_POOL_MAX_CONN = 20
_POOL_CONNECT_TIMEOUT_SECONDS = 5
_POOL_ACQUIRE_TIMEOUT_SECONDS = 5.0


def _get_pool() -> ThreadedConnectionPool:
    global _POOL
    if _POOL is None:
        with _POOL_LOCK:
            if _POOL is None:
                _POOL = ThreadedConnectionPool(
                    minconn=_POOL_MIN_CONN, maxconn=_POOL_MAX_CONN,
                    dsn=get_settings().sync_database_url,
                    connect_timeout=_POOL_CONNECT_TIMEOUT_SECONDS,
                )
    return _POOL


class _PooledConn:
    """Thin wrapper around a psycopg2 connection that returns itself to the
    shared pool on .close() instead of actually closing the socket. Provides
    full connection proxying so existing `conn = _conn(); ...; conn.close()`
    call sites don't need to change."""

    __slots__ = ("_conn", "_returned")

    def __init__(self, conn):
        self._conn = conn
        self._returned = False

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def cursor(self, *a, **kw):
        return self._conn.cursor(*a, **kw)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        if self._returned:
            return
        self._returned = True
        try:
            if self._conn.closed == 0:
                try:
                    self._conn.rollback()  # discard any in-flight tx
                except Exception:
                    pass
                _get_pool().putconn(self._conn)
            else:
                _get_pool().putconn(self._conn, close=True)
        except Exception:
            try:
                self._conn.close()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            try:
                self._conn.rollback()
            except Exception:
                pass
        self.close()
        return False


def get_conn() -> _PooledConn:
    """Checkout a pooled psycopg2 connection wrapped so `.close()` releases
    it back to the pool.

    Bounded wait: if the pool is saturated we spin up to
    `_POOL_ACQUIRE_TIMEOUT_SECONDS`, then raise. This prevents the event
    loop from hanging forever under burst load — the caller gets a fast
    5xx and Render's health check stays green.
    """
    pool = _get_pool()
    deadline = time.monotonic() + _POOL_ACQUIRE_TIMEOUT_SECONDS
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            raw = pool.getconn()
            return _PooledConn(raw)
        except Exception as exc:  # psycopg2.pool.PoolError on exhaustion
            last_err = exc
            time.sleep(0.05)
    raise RuntimeError(
        f"Postgres pool exhausted (>{_POOL_ACQUIRE_TIMEOUT_SECONDS}s wait); "
        f"last error: {last_err}"
    )


def _conn():  # backwards-compat alias used inside this module
    return get_conn()


# fhir_store.py and run_store.py import this symbol — keep the original
# signature so legacy code needs zero changes.
def pooled_connection() -> _PooledConn:
    return get_conn()


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #

def ensure_platform_tables() -> None:
    conn = _conn()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS platform_users (
            id            BIGSERIAL PRIMARY KEY,
            username      TEXT UNIQUE NOT NULL,
            email         TEXT,
            display_name  TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'analyst',
            apps          JSONB NOT NULL DEFAULT '["agentic","lacare"]',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login_at TIMESTAMPTZ
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS platform_sessions (
            token       TEXT PRIMARY KEY,
            user_id     BIGINT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at  TIMESTAMPTZ NOT NULL,
            user_agent  TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_runs (
            run_id              TEXT PRIMARY KEY,
            user_id             BIGINT REFERENCES platform_users(id) ON DELETE SET NULL,
            status              TEXT NOT NULL DEFAULT 'running',
            current_stage       TEXT DEFAULT 'idle',
            total_documents     INTEGER DEFAULT 0,
            processed_documents INTEGER DEFAULT 0,
            use_ai              BOOLEAN DEFAULT FALSE,
            source              TEXT DEFAULT 'upload',
            started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at        TIMESTAMPTZ,
            notes               TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_documents (
            id               BIGSERIAL PRIMARY KEY,
            run_id           TEXT REFERENCES lacare_runs(run_id) ON DELETE CASCADE,
            document_id      TEXT NOT NULL,
            document_type    TEXT,
            patient_id       TEXT,
            patient_name     TEXT,
            facility         TEXT,
            encounter_date   TEXT,
            sections         JSONB DEFAULT '[]',
            entry_count      INTEGER DEFAULT 0,
            narrative_chars  INTEGER DEFAULT 0,
            scenario         TEXT,
            warnings         JSONB DEFAULT '[]',
            raw_xml          TEXT,
            parsed_json      JSONB,
            nlp_json         JSONB,
            uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_documents_run_idx ON lacare_documents(run_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_documents_docid_idx ON lacare_documents(document_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_hits (
            id                  BIGSERIAL PRIMARY KEY,
            run_id              TEXT REFERENCES lacare_runs(run_id) ON DELETE CASCADE,
            document_id         TEXT NOT NULL,
            measure             TEXT NOT NULL,
            measure_name        TEXT NOT NULL,
            patient_id          TEXT,
            patient_name        TEXT,
            satisfied           BOOLEAN DEFAULT TRUE,
            confidence          NUMERIC(5,2),
            evidence_type       TEXT,
            source_document_type TEXT,
            source_section      TEXT,
            summary             TEXT,
            numerator_date      TEXT,
            denominator_date    TEXT,
            extra               JSONB DEFAULT '{}',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_hits_run_idx ON lacare_hits(run_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_hits_measure_idx ON lacare_hits(measure)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_agent_events (
            id           BIGSERIAL PRIMARY KEY,
            run_id       TEXT REFERENCES lacare_runs(run_id) ON DELETE CASCADE,
            agent        TEXT NOT NULL,
            status       TEXT NOT NULL,
            last_action  TEXT,
            processed    INTEGER DEFAULT 0,
            duration_ms  INTEGER DEFAULT 0,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (run_id, agent)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_logs (
            id         BIGSERIAL PRIMARY KEY,
            run_id     TEXT REFERENCES lacare_runs(run_id) ON DELETE CASCADE,
            ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            level      TEXT,
            message    TEXT,
            meta       JSONB DEFAULT '{}'
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_logs_run_idx ON lacare_logs(run_id, id)")

    # Curated sample library - seeded ONCE, reused across demos
    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_samples (
            id               BIGSERIAL PRIMARY KEY,
            sample_id        TEXT UNIQUE NOT NULL,
            scenario         TEXT NOT NULL,
            scenario_label   TEXT NOT NULL,
            document_type    TEXT NOT NULL,
            patient_id       TEXT,
            patient_name     TEXT,
            facility         TEXT,
            encounter_date   TEXT,
            section_count    INTEGER DEFAULT 0,
            entry_count      INTEGER DEFAULT 0,
            narrative_chars  INTEGER DEFAULT 0,
            expected_measure TEXT,
            summary          TEXT,
            raw_xml          TEXT NOT NULL,
            parsed_json      JSONB,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_samples_scenario_idx ON lacare_samples(scenario)")
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_samples_doctype_idx ON lacare_samples(document_type)")

    # Per-document step events — the "see every step" feature.
    # Each row captures one agent's work on one document: inputs → outputs.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_step_events (
            id               BIGSERIAL PRIMARY KEY,
            run_id           TEXT REFERENCES lacare_runs(run_id) ON DELETE CASCADE,
            document_id      TEXT NOT NULL,
            agent            TEXT NOT NULL,
            step_label       TEXT NOT NULL,
            status           TEXT NOT NULL DEFAULT 'complete',
            input_summary    TEXT,
            output_summary   TEXT,
            details          JSONB DEFAULT '{}',
            duration_ms      INTEGER DEFAULT 0,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_step_events_run_doc_idx ON lacare_step_events(run_id, document_id, id)")
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_step_events_agent_idx ON lacare_step_events(run_id, agent)")

    # Access/activity log — tails HTTP + pipeline events for the client demo
    cur.execute("""
        CREATE TABLE IF NOT EXISTS lacare_activity (
            id         BIGSERIAL PRIMARY KEY,
            ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            kind       TEXT NOT NULL,
            method     TEXT,
            path       TEXT,
            status     INTEGER,
            duration_ms INTEGER,
            actor      TEXT,
            message    TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS lacare_activity_ts_idx ON lacare_activity(id DESC)")

    conn.commit()
    cur.close()
    conn.close()


# --------------------------------------------------------------------------- #
# Users / auth primitives
# --------------------------------------------------------------------------- #

def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS)
    return dk.hex(), salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    check, _ = _hash_password(password, salt)
    return hmac.compare_digest(check, stored_hash)


def create_user(username: str, password: str, display_name: str, email: str | None = None,
                role: str = "analyst", apps: list[str] | None = None) -> dict[str, Any]:
    apps = apps or ["agentic", "lacare"]
    pwd_hash, salt = _hash_password(password)
    conn = _conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO platform_users (username, email, display_name, password_hash, password_salt, role, apps)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id, username, display_name, role, apps, created_at
        """, (username.lower().strip(), email, display_name, pwd_hash, salt, role, json.dumps(apps)))
        row = cur.fetchone()
        conn.commit()
        return {
            "id": row[0], "username": row[1], "display_name": row[2],
            "role": row[3], "apps": row[4], "created_at": row[5].isoformat(),
        }
    finally:
        cur.close()
        conn.close()


def get_user_by_username(username: str) -> dict[str, Any] | None:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    try:
        cur.execute("SELECT * FROM platform_users WHERE username=%s", (username.lower().strip(),))
        r = cur.fetchone()
        return dict(r) if r else None
    finally:
        cur.close()
        conn.close()


def authenticate(username: str, password: str) -> dict[str, Any] | None:
    user = get_user_by_username(username)
    if not user:
        return None
    if not _verify_password(password, user["password_hash"], user["password_salt"]):
        return None
    _touch_last_login(user["id"])
    return user


def _touch_last_login(user_id: int) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("UPDATE platform_users SET last_login_at=NOW() WHERE id=%s", (user_id,))
    conn.commit()
    cur.close()
    conn.close()


def create_session(user_id: int, user_agent: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=_SESSION_TTL_HOURS)
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO platform_sessions (token, user_id, expires_at, user_agent)
        VALUES (%s, %s, %s, %s)
    """, (token, user_id, expires, user_agent))
    conn.commit()
    cur.close()
    conn.close()
    return token


def lookup_session(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    try:
        cur.execute("""
            SELECT u.id, u.username, u.display_name, u.role, u.apps, s.expires_at
            FROM platform_sessions s
            JOIN platform_users u ON u.id = s.user_id
            WHERE s.token=%s AND s.expires_at > NOW()
        """, (token,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def drop_session(token: str) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM platform_sessions WHERE token=%s", (token,))
    conn.commit()
    cur.close()
    conn.close()


def log_activity(
    kind: str,
    method: str = "",
    path: str = "",
    status: int = 0,
    duration_ms: int = 0,
    actor: str = "",
    message: str = "",
) -> None:
    """Append a row to lacare_activity so the UI 'System Activity' drawer
    can show real-time HTTP + pipeline events. Swallows errors so logging
    failures never break the calling request.
    """
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO lacare_activity
                (kind, method, path, status, duration_ms, actor, message)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (kind, method or "", path or "", int(status or 0),
             int(duration_ms or 0), actor or "", message or ""),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass


def seed_default_admin() -> None:
    """Create an initial admin account on first boot so the platform is usable.

    The password is pulled from the PLATFORM_ADMIN_PASSWORD env var if set;
    otherwise defaults to 'brightcone2026'. This is ONE-TIME seeding — after
    first signup you can delete or change the account.
    """
    existing = get_user_by_username("admin")
    if existing:
        return
    pwd = os.environ.get("PLATFORM_ADMIN_PASSWORD", "brightcone2026")
    create_user(
        username="admin",
        password=pwd,
        display_name="Platform Admin",
        email="admin@brightcone.local",
        role="admin",
        apps=["agentic", "lacare"],
    )
