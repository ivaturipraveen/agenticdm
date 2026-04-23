# Render production checklist — agenticdm

After the Starter → Standard upgrade, apply every item below. Most take
30 seconds each in the Render dashboard. Together they eliminate all
four failure classes we saw in the 27 Apr incident (OOM kills, cold
starts, WS timeouts, event-loop blocking).

---

## 1. Settings that MUST change in the Render UI

Open: **Render dashboard → agenticdm → Settings**

| Section | Field | Old value | New value |
|---------|-------|-----------|-----------|
| General | Instance Type | Starter (0.5 CPU / 512 MB) | **Standard (1 CPU / 2 GB)** ✅ already done |
| Deploy | Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` | **see §2 below** |
| Deploy | Auto-Deploy | On Commit | **Off** (switch to manual for prod) |
| Health Checks | Health Check Path | *(empty)* | **`/api/healthz`** |

---

## 2. New Start Command (copy this verbatim)

Replace the Start Command with:

```
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2 --timeout-keep-alive 75 --proxy-headers --forwarded-allow-ips=* --access-log
```

What each flag does and why:

| Flag | Why |
|------|-----|
| `--workers 2` | Uses both sides of the 1-CPU Standard. While one worker runs the pipeline the other serves `/status`, `/ws` and `/auth/apps`. **This is the fix for the "UI froze during a run" symptom.** |
| `--timeout-keep-alive 75` | Keeps TCP connections alive longer than Render's 60s edge idle cap, preventing WebSocket drop-outs. |
| `--proxy-headers` | Makes `request.client.host` reflect the real client IP (through Render's edge). |
| `--forwarded-allow-ips=*` | Trusts the Render edge. |
| `--access-log` | Adds one-line access logs per request for incident triage. |

---

## 3. Environment variables — verify all exist

**Settings → Environment** must contain:

| Key | Purpose | Value |
|-----|---------|-------|
| `DATABASE_URL` | Postgres, async | Render auto-links from your Managed DB |
| `SYNC_DATABASE_URL` | Postgres, sync (psycopg2) | same URL, or `postgresql://…` form |
| `ANTHROPIC_API_KEY` | LLM key | **keep secret** — never commit |
| `LACARE_LLM_MODEL` | Override LLM | `claude-haiku-4-5-20251001` |
| `PYTHONUNBUFFERED` | Unbuffered logs | `1` |
| `PYTHONDONTWRITEBYTECODE` | No `.pyc` churn | `1` |
| `WEB_CONCURRENCY` | Hint for workers | `2` |

---

## 4. Code changes shipped with this commit

These are already in the repo and will take effect on the next deploy.

### `/api/healthz` + `/api/readyz`
Lightweight liveness probes. `/healthz` pings the DB pool (<200 ms) and
returns 200 if healthy / 503 if DB is down. Render hits it every few
seconds. If the app gets stuck, Render sees the 503 and restarts the
instance automatically — no silent cascading failures.

### Agentic DM LLM call is no longer blocking
`agents/discovery_agent.py` was calling `build_mapping_summary()` — a
**synchronous** function that wraps the Anthropic SDK — directly from an
async handler. That call took 20–60 seconds per Synthea run and blocked
every other request on the same worker during that window. We now wrap
it with `asyncio.to_thread(...)` so the event loop stays free.

**This is the single biggest fix.** It's what caused the "WebSocket open
for 46 s then closed" and "/api/auth/apps returning 29-byte error body"
symptoms. LA Care already used `asyncio.to_thread` for its NLP calls —
now Agentic DM matches.

### `render.yaml` at repo root
IaC reference config — if you ever re-create the Render service from
scratch, you can blueprint-deploy it from this file instead of hand-
typing the settings.

---

## 5. Operational runbook — if it hangs again

The Render logs are now rich enough to diagnose any future issue in
under a minute. Here's the checklist:

### Symptom: UI shows "pipeline stuck", bytes/sec dropping to 0

1. Open **Render → agenticdm → Logs** (top-right of service page).
2. Grep for the last successful `GET /api/healthz` line. If it's more
   than 15 s old, the worker is blocked.
3. Check the last `POST /api/pipeline/start` — if the response size is
   ≤ 100 bytes, it returned an error JSON body (look for `detail`).
4. Check memory: **Metrics → Memory**. If > 1.8 GB for more than 30 s
   you are memory-pressured; reduce Synthea batch size or move to Pro.
5. Force a restart via **Manual Deploy → Clear build cache & deploy**.

### Symptom: every request returns 503

1. `/api/healthz` should be returning 503 too — check its `db_error`
   field in the response body. If it complains about `connection pool
   exhausted`, bump `ThreadedConnectionPool` maxconn in
   `backend/platform_db.py` from 10 → 20.
2. If `db_error` says `could not connect to server`, check Render DB
   status — it's likely maintenance.

### Symptom: frequent cold starts

Render Standard instances do NOT spin down on idle (only Free tier
does), so if you see 3–5 s first-hit latency after traffic quiets it's
the keep-alive TCP handshake, not a cold start. Ignore.

### Symptom: WebSocket drops mid-run

1. Check if the pipeline is synchronously doing heavy work on the loop.
   All LLM calls in the codebase (as of this commit) are already in
   `asyncio.to_thread`. If you add new ones, remember to thread them.
2. Verify `--timeout-keep-alive 75` is actually in the Start Command.
   Render edge idles connections at 60 s so Uvicorn must keep them
   alive longer.

---

## 6. What to monitor weekly

Render dashboard → **Metrics**:

| Metric | Healthy | Alert if |
|--------|---------|----------|
| CPU | < 60 % avg | > 80 % for > 5 min |
| Memory | < 1.4 GB | > 1.7 GB sustained |
| Response time p95 | < 500 ms for `/healthz` | > 2 s (worker blocked) |
| Request rate | varies | sudden drop to 0 |
| 5xx rate | < 0.1 % | > 1 % |

If CPU hits 80 % often you have two options — move to **Pro** (2 CPU, 4 GB)
or split the LA Care service out. See `render.yaml` for the split blueprint.

---

## 7. What we are NOT doing yet (and when we should)

Deliberately deferred, because they add cost or complexity not needed
for the current demo phase:

| Item | When to add |
|------|-------------|
| Redis for WebSocket pub/sub | When you need > 1 instance (horizontal scale) |
| Read replica Postgres | When dashboard queries > 50 ms p95 |
| Sentry or Datadog | Before onboarding the first paying customer |
| Prometheus / OpenTelemetry | When you want multi-service traces |
| Rate limiting | When public endpoint traffic > 10 rps sustained |
| Blue-green deploys | When a bad deploy would affect > 50 users |

The current architecture will comfortably handle an LA Care client demo
and a ~500-row / day Synthea migration without any of the above. Add
them in the order listed as load grows.
