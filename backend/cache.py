"""Lightweight in-process TTL cache for read-mostly endpoints.

This module exists to turn hot read endpoints (that the frontend polls
at 2.5s intervals) into near-free lookups. It is intentionally tiny —
~80 lines, no dependencies beyond stdlib — so it can never become a
hidden source of bugs.

## When to use it

GOOD candidates (safe to cache):
  * `/api/lacare/measures` — static list, never changes without a deploy
  * `/api/lacare/samples` (list) — seeded at startup, new ones arrive
    only via explicit admin action
  * `/api/target/health` — pings the FHIR endpoint; result valid for ~30s
  * `/api/datasets` — source schema scan, mutates only when Synthea is
    re-imported
  * `_get_source_tables()` — reads information_schema, same cadence

BAD candidates (do NOT cache):
  * Anything with per-user state (sessions, tenant-scoped data)
  * Pipeline status, run lists, live dashboard
  * Documents / hits during an active run
  * Anything write-through

## Guarantees

  * Thread-safe — a single `threading.Lock` guards the dict
  * Single process only — does NOT sync across Uvicorn workers. We
    currently run `--workers 1` so this is fine (see RENDER_CHECKLIST).
    If we ever scale to N workers we must switch to Redis.
  * Bounded TTL — entries expire by wall clock, not LRU. No eviction
    policy is needed because the key space is tiny (a few dozen fixed
    endpoints with small argument combos).
  * Negative caching — exceptions are NOT cached; a failing call is
    retried on the next request.
"""
from __future__ import annotations

import threading
import time
from functools import wraps
from typing import Any, Callable, TypeVar

T = TypeVar("T")

_STORE: dict[str, tuple[float, Any]] = {}
_LOCK = threading.Lock()


def _now() -> float:
    return time.monotonic()


def get(key: str) -> tuple[bool, Any]:
    """Return (hit, value). `hit=False` means miss or expired."""
    with _LOCK:
        entry = _STORE.get(key)
        if entry is None:
            return False, None
        expires_at, value = entry
        if expires_at < _now():
            _STORE.pop(key, None)
            return False, None
        return True, value


def set(key: str, value: Any, ttl_seconds: float) -> None:
    """Store `value` under `key` for `ttl_seconds`."""
    with _LOCK:
        _STORE[key] = (_now() + ttl_seconds, value)


def invalidate(prefix: str = "") -> int:
    """Drop all keys (or those starting with `prefix`). Returns count removed."""
    with _LOCK:
        if not prefix:
            n = len(_STORE)
            _STORE.clear()
            return n
        to_drop = [k for k in _STORE if k.startswith(prefix)]
        for k in to_drop:
            _STORE.pop(k, None)
        return len(to_drop)


def stats() -> dict[str, Any]:
    """Introspection — used by /api/healthz & debugging."""
    with _LOCK:
        return {
            "entries": len(_STORE),
            "keys": sorted(_STORE.keys()),
        }


def cached(ttl_seconds: float, key_prefix: str = "") -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator that caches a sync function's return value by its args.

    Usage:
        @cached(ttl_seconds=30, key_prefix="measures")
        def load_measures() -> list: ...

    The cache key is `"{key_prefix}:{repr(args)}:{repr(kwargs)}"`. If your
    function takes non-reprable args, pass a manual key via `cache.get/set`
    instead of the decorator.
    """
    def wrap(fn: Callable[..., T]) -> Callable[..., T]:
        prefix = key_prefix or fn.__name__

        @wraps(fn)
        def inner(*args: Any, **kwargs: Any) -> T:
            key = f"{prefix}:{args!r}:{sorted(kwargs.items())!r}"
            hit, value = get(key)
            if hit:
                return value  # type: ignore[return-value]
            value = fn(*args, **kwargs)
            set(key, value, ttl_seconds)
            return value

        inner.__wrapped__ = fn  # type: ignore[attr-defined]
        inner.cache_key_prefix = prefix  # type: ignore[attr-defined]
        return inner

    return wrap


async def get_or_set_async(
    key: str, ttl_seconds: float, loader: Callable[[], Any]
) -> Any:
    """Async version — calls `loader()` (which may be sync or async) on miss."""
    import asyncio
    import inspect

    hit, value = get(key)
    if hit:
        return value
    result = loader()
    if inspect.isawaitable(result):
        result = await result
    set(key, result, ttl_seconds)
    return result
