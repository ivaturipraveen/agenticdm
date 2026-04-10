import httpx
from typing import List, Dict, Any
from config import get_settings

settings = get_settings()


async def post_bundle(records: List[Dict[str, Any]], resource_type: str) -> Dict[str, Any]:
    entries = []
    for r in records:
        resource_id = r.get("id", "")
        method = "PUT" if resource_type == "Patient" and resource_id else "POST"
        url = f"{resource_type}/{resource_id}" if method == "PUT" and resource_id else resource_type
        entries.append({"resource": r, "request": {"method": method, "url": url}})

    bundle = {"resourceType": "Bundle", "type": "transaction", "entry": entries}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(settings.fhir_base_url, json=bundle)
            if response.status_code in (200, 201):
                return {
                    "success": True,
                    "simulated": False,
                    "http_status": response.status_code,
                    "count": len(entries),
                    "bundle_sample": bundle["entry"][:2],
                }
            # Non-2xx from FHIR server — propagate as real error
            raise RuntimeError(
                f"FHIR server returned HTTP {response.status_code} for {resource_type}: {response.text[:200]}"
            )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        raise RuntimeError(
            f"FHIR server unreachable at {settings.fhir_base_url}: {exc}"
        ) from exc
