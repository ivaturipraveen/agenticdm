import json
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any
from pathlib import Path

AUDIT_LOG_FILE = Path(__file__).parent / "audit_log.jsonl"
_lock = asyncio.Lock()


def _build_entry(agent: str, action: str, status: str, records_affected: int, details: str) -> Dict[str, Any]:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": agent,
        "action": action,
        "status": status,
        "records_affected": records_affected,
        "details": details,
    }


async def log_entry(agent: str, action: str, status: str, records_affected: int = 0, details: str = "") -> Dict[str, Any]:
    entry = _build_entry(agent, action, status, records_affected, details)
    async with _lock:
        with open(AUDIT_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    return entry


def log_entry_sync(agent: str, action: str, status: str, records_affected: int = 0,
                   details: str = "", run_id: str = "") -> Dict[str, Any]:
    entry = _build_entry(agent, action, status, records_affected, details)
    with open(AUDIT_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    if run_id:
        try:
            from run_store import append_log
            append_log(run_id, agent, action, status, records_affected, details)
        except Exception:
            pass
    return entry


def get_all_logs() -> List[Dict[str, Any]]:
    if not AUDIT_LOG_FILE.exists():
        return []
    entries = []
    with open(AUDIT_LOG_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return entries


def export_pdf(filepath: str) -> None:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    entries = get_all_logs()
    doc = SimpleDocTemplate(filepath, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=16, spaceAfter=12)
    story.append(Paragraph("Brightcone Healthcare Migration - Compliance Audit Log", title_style))
    story.append(Paragraph(f"Generated: {datetime.now(timezone.utc).isoformat()}", styles["Normal"]))
    story.append(Spacer(1, 0.25 * inch))

    headers = ["Timestamp", "Agent", "Action", "Status", "Records", "Details"]
    table_data = [headers]
    for e in entries:
        table_data.append([
            e.get("timestamp", "")[:19],
            e.get("agent", ""),
            e.get("action", "")[:40],
            e.get("status", ""),
            str(e.get("records_affected", 0)),
            e.get("details", "")[:60],
        ])

    col_widths = [1.2 * inch, 1.0 * inch, 1.8 * inch, 0.9 * inch, 0.7 * inch, 2.0 * inch]
    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t)
    doc.build(story)
