import asyncio
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from enum import Enum


class Stage(str, Enum):
    IDLE = "IDLE"
    EXTRACT = "EXTRACT"
    TRANSFORM = "TRANSFORM"
    VALIDATE = "VALIDATE"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    LOAD = "LOAD"
    RECONCILE = "RECONCILE"
    COMPLETE = "COMPLETE"
    HALTED = "HALTED"


class PipelineState:
    def __init__(self) -> None:
        self.current_stage: Stage = Stage.IDLE
        self.run_id: Optional[str] = None
        self.start_time: Optional[datetime] = None
        self.stage_statuses: Dict[str, str] = {}
        self.approval_event: asyncio.Event = asyncio.Event()
        self.review_event: asyncio.Event = asyncio.Event()
        self.approved: bool = False
        self.halted: bool = False
        self.drift_confirm_event: asyncio.Event = asyncio.Event()
        self.schema_mapping: Optional[Dict[str, Any]] = None
        self.reconciliation: Optional[Dict[str, Any]] = None
        self.current_dataset_id: str = "synthea_standard"
        self.pending_reviews: list[Dict[str, Any]] = []
        self._lock: asyncio.Lock = asyncio.Lock()

        self.agent_statuses: Dict[str, Dict[str, Any]] = {
            "discovery":      {"status": "idle",     "last_action": "", "records_processed": 0, "last_active": None},
            "transformation": {"status": "idle",     "last_action": "", "records_processed": 0, "last_active": None},
            "orchestration":  {"status": "idle",     "last_action": "", "records_processed": 0, "last_active": None},
            "qa":             {"status": "idle",     "last_action": "", "records_processed": 0, "last_active": None},
            "monitor":        {"status": "watching", "last_action": "Initialized", "records_processed": 0, "last_active": None},
        }

    async def start_run(self) -> str:
        async with self._lock:
            if not self.run_id:
                self.run_id = str(uuid.uuid4())
            self.start_time = datetime.now(timezone.utc)
            self.current_stage = Stage.IDLE
            self.stage_statuses = {}
            self.approval_event.clear()
            self.review_event.clear()
            self.approved = False
            self.halted = False
            self.drift_confirm_event.clear()
            self.pending_reviews = []
            return self.run_id

    async def advance_stage(self, stage: Stage, status: str = "success") -> None:
        async with self._lock:
            if self.current_stage != Stage.IDLE:
                self.stage_statuses[self.current_stage.value] = status
            self.current_stage = stage

    async def set_stage(self, stage: Stage) -> None:
        async with self._lock:
            self.current_stage = stage

    async def approve(self) -> None:
        async with self._lock:
            self.approved = True
        self.approval_event.set()

    async def halt(self) -> None:
        async with self._lock:
            self.halted = True
            self.current_stage = Stage.HALTED
        self.approval_event.set()
        self.review_event.set()

    async def confirm_drift(self) -> None:
        async with self._lock:
            self.halted = False
        self.drift_confirm_event.set()

    async def reset(self) -> None:
        async with self._lock:
            self.current_stage = Stage.IDLE
            self.run_id = None
            self.start_time = None
            self.stage_statuses = {}
            self.approval_event.clear()
            self.review_event.clear()
            self.approved = False
            self.halted = False
            self.drift_confirm_event.clear()
            self.pending_reviews = []

    async def set_pending_reviews(self, reviews: list[Dict[str, Any]]) -> None:
        async with self._lock:
            self.pending_reviews = reviews
            if reviews:
                self.review_event.clear()
            else:
                self.review_event.set()

    async def resolve_review(self, table: str, source_column: str, decision: str, selected_target: Optional[str] = None) -> None:
        async with self._lock:
            for item in self.pending_reviews:
                if item.get("table") == table and item.get("source_column") == source_column:
                    item["review_decision"] = decision
                    if selected_target is not None:
                        item["target_field"] = selected_target

            if self.schema_mapping:
                for table_map in self.schema_mapping.get("mapping_summary", []):
                    if table_map.get("table") != table:
                        continue
                    for field in table_map.get("fields", []):
                        if field.get("source_column") == source_column:
                            if decision in ("accept", "edit"):
                                field["status"] = "auto_mapped"
                                if selected_target is not None:
                                    field["target_field"] = selected_target
                            elif decision == "reject":
                                field["status"] = "ignored"
                self.schema_mapping["requires_review"] = [
                    r for r in self.pending_reviews if r.get("review_decision") not in ("accept", "reject", "edit")
                ]

            unresolved = [r for r in self.pending_reviews if r.get("review_decision") not in ("accept", "reject", "edit")]
            if not unresolved:
                self.review_event.set()

    def update_agent(self, agent: str, status: str, last_action: str = "", records_processed: int = 0) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if agent in self.agent_statuses:
            self.agent_statuses[agent]["status"] = status
            if last_action:
                self.agent_statuses[agent]["last_action"] = last_action
            if records_processed:
                self.agent_statuses[agent]["records_processed"] += records_processed
            self.agent_statuses[agent]["last_active"] = now

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.current_stage.value,
            "run_id": self.run_id,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "stage_statuses": self.stage_statuses,
            "halted": self.halted,
            "pending_reviews": self.pending_reviews,
        }


pipeline_state = PipelineState()
