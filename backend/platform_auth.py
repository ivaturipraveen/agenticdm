"""DB-backed platform auth: signup, login, logout, app catalog, session check.

All routes live under /api/auth/*.
"""
from __future__ import annotations

import re
from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse

from platform_db import (
    authenticate,
    create_session,
    create_user,
    drop_session,
    get_user_by_username,
    lookup_session,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")


def _shape_user(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row.get("role", "analyst"),
        "apps": row.get("apps") or ["agentic", "lacare"],
    }


@router.post("/signup")
async def signup(payload: dict = Body(...)):
    username = (payload.get("username") or "").strip().lower()
    password = payload.get("password") or ""
    display_name = (payload.get("display_name") or "").strip() or username.title()
    email = payload.get("email") or None

    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username must be 3-32 chars, lowercase letters/digits/._-")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if get_user_by_username(username):
        raise HTTPException(status_code=409, detail="Username already taken")

    try:
        user = create_user(
            username=username,
            password=password,
            display_name=display_name,
            email=email,
            role="analyst",
            apps=["agentic", "lacare"],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not create account: {exc}")

    token = create_session(user["id"])
    return JSONResponse({
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "apps": user["apps"],
        },
    })


@router.post("/login")
async def login(payload: dict = Body(...), user_agent: str | None = Header(default=None)):
    username = (payload.get("username") or "").strip().lower()
    password = payload.get("password") or ""
    user = authenticate(username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_session(user["id"], user_agent=user_agent)
    return JSONResponse({"token": token, "user": _shape_user(user)})


@router.get("/me")
async def me(authorization: str | None = Header(default=None)):
    token = _extract_token(authorization)
    session = lookup_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return JSONResponse({"user": _shape_user(session)})


@router.post("/logout")
async def logout(payload: dict = Body(default_factory=dict), authorization: str | None = Header(default=None)):
    token = payload.get("token") or _extract_token(authorization)
    if token:
        drop_session(token)
    return JSONResponse({"status": "ok"})


@router.get("/apps")
async def apps_catalog():
    """Workspaces the shell can render on the selector screen."""
    return JSONResponse({
        "apps": [
            {
                "id": "agentic",
                "name": "Agentic Data Migration",
                "tagline": "AI agents that discover, transform, validate, and load to FHIR.",
                "description": "Autonomous migration pipeline for legacy healthcare data. Discovery, transformation, reconciliation and FHIR loading with a human-in-the-loop approval gate.",
                "icon": "flow",
                "route": "/agentic",
                "accent": "blue",
            },
            {
                "id": "lacare",
                "name": "LA Care — CCDA Intelligence",
                "tagline": "Turn millions of CCD/CDA documents into HEDIS quality evidence.",
                "description": "Ingests C-CDA XML from uploads or HIE feeds, extracts structured clinical data, runs narrative NLP on unstructured text, and matches against HEDIS value sets to recover measure evidence claims data misses.",
                "icon": "health",
                "route": "/lacare",
                "accent": "rose",
            },
        ]
    })


def _extract_token(authorization: str | None) -> str:
    if not authorization:
        return ""
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return authorization.strip()


def require_session(authorization: str | None) -> dict:
    token = _extract_token(authorization)
    session = lookup_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session
