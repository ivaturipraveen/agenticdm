import json
import asyncio
from typing import Set, Any, Dict
from fastapi import WebSocket
from datetime import datetime, timezone


class WebSocketManager:
    def __init__(self) -> None:
        self.active_connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self.active_connections.discard(websocket)

    async def broadcast(self, event_type: str, payload: Dict[str, Any]) -> None:
        message = json.dumps({"type": event_type, **payload})
        dead: Set[WebSocket] = set()
        async with self._lock:
            connections = set(self.active_connections)
        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self.active_connections -= dead

    async def send_agent_status(self, agent: str, status: str, last_action: str, records_processed: int) -> None:
        await self.broadcast("AGENT_STATUS", {
            "agent": agent, "status": status, "last_action": last_action,
            "records_processed": records_processed,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    async def send_audit_entry(self, entry: Dict[str, Any]) -> None:
        await self.broadcast("AUDIT_LOG_ENTRY", {"entry": entry})

    async def send_stage_change(self, stage: str, run_id: str) -> None:
        await self.broadcast("PIPELINE_STAGE_CHANGE", {"stage": stage, "run_id": run_id})

    async def send_reasoning(self, agent: str, step: str, detail: str = "", emoji: str = "",
                              run_id: str = "") -> None:
        ts = datetime.now(timezone.utc).isoformat()
        await self.broadcast("AGENT_REASONING", {
            "agent": agent, "step": step, "detail": detail, "emoji": emoji, "timestamp": ts,
        })
        from pipeline_state import pipeline_state as _ps
        effective_run_id = run_id or getattr(_ps, 'run_id', '') or ''
        if effective_run_id:
            try:
                from run_store import append_log
                append_log(effective_run_id, agent, step, "reasoning", 0, detail, "reasoning", "", step)
            except Exception:
                pass

    async def send_log_message(self, message: str, level: str = "info", run_id: str = "") -> None:
        await self.broadcast("LOG_MESSAGE", {
            "message": message,
            "level": level,
            "run_id": run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        if run_id:
            try:
                from run_store import append_log
                append_log(run_id, "system", message, level, 0, "", "message")
            except Exception:
                pass


ws_manager = WebSocketManager()
