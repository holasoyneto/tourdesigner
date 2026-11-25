"""Structured tour-logistics extractor.

Converts pasted emails, WhatsApp messages, vouchers, or running orders into typed
GigItem proposals and optional gig header patches. Routes through the live-configured
Google AI model (Vertex AI or Gemini API) and falls back to a deterministic local parser
when offline or unconfigured.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.ai.models import ResolvedAIConfig, record_model_deprecation_alert, resolve_ai_config
from app.config import get_settings
from app.repo.protocol import TourRepo

_FLIGHT_RE = re.compile(
    r"\b(?P<flight_no>[A-Z]{2}\s?\d{2,4})\b"
    r"(?:.*?\b(?P<dep>[A-Z]{3})\s*(?:->|→|-|to)\s*(?P<arr>[A-Z]{3})\b)?",
    re.IGNORECASE,
)
_TIME_RANGE_RE = re.compile(
    r"^(?P<start>\d{1,2})[h:](?P<sm>\d{2})?\s*(?:[-–—→]|->|to)?\s*"
    r"(?:(?P<end>\d{1,2})[h:](?P<em>\d{2})?)?\s+(?P<rest>.+)$",
    re.IGNORECASE,
)
_PNR_RE = re.compile(r"\b(?:pnr|ref|booking|conf(?:irmation)?)[:#\s]+([A-Z0-9]{5,8})\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"(\+\d[\d\s\-().]{7,18}\d)")
_EMAIL_RE = re.compile(r"([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")

_SYSTEM_PROMPT = """You are a meticulous tour-logistics extraction engine.
Extract ONLY facts explicitly stated in the user text — never invent times, PNRs, fees, or names.
Return strict JSON with shape:
{
  "gig_patch": { ...optional header fields like venue, city, doors_time, soundcheck_time, set_time, set_end, promoter... },
  "items": [
    {
      "collection": "flights"|"transport"|"hotels"|"schedule"|"timetable"|"contacts"|"crew"|"rider"|"guests"|"notes_list",
      "data": { ...collection fields... }
    }
  ],
  "warnings": [ ...any ambiguous lines skipped... ]
}
All times must be 24h HH:MM local to the venue/airport."""


def _fmt_hhmm(hour: str, minute: str | None) -> str:
    h = int(hour)
    m = int(minute or "0")
    if not (0 <= h <= 24 and 0 <= m <= 59):
        return ""
    return f"{h:02d}:{m:02d}"


_DATE_ISO_RE = re.compile(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b")
_DATE_DMY_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b")


def _parse_date_token(raw: str) -> str | None:
    s = (raw or "").strip()
    m1 = _DATE_ISO_RE.search(s)
    if m1:
        y, mo, d = int(m1.group(1)), int(m1.group(2)), int(m1.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    m2 = _DATE_DMY_RE.search(s)
    if m2:
        a, b, y = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        # Prefer DD/MM/YYYY unless second number > 12 (US MM/DD/YYYY)
        mo, d = (a, b) if b > 12 and a <= 12 else (b, a)
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def detect_multi_date_rows(text: str) -> list[dict[str, Any]]:
    """Detect multi-date CSV / TSV / Master Tour schedule pastes (>= 2 distinct dates)."""
    import csv
    import io

    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []

    delimiter = "\t" if sum("\t" in ln for ln in lines[:10]) >= 2 else "," if sum("," in ln for ln in lines[:10]) >= 2 else None
    rows_out: list[dict[str, Any]] = []
    seen_dates: set[str] = set()

    if delimiter:
        reader = list(csv.reader(io.StringIO("\n".join(lines)), delimiter=delimiter))
        if not reader:
            return []
        header_cells = [c.strip().lower() for c in reader[0]]
        has_header = any(
            k in h for h in header_cells for k in ("date", "city", "ville", "venue", "salle", "club", "status", "set")
        )
        col_map: dict[str, int] = {}
        if has_header:
            for idx, h in enumerate(header_cells):
                if "date" in h and "date" not in col_map:
                    col_map["date"] = idx
                elif any(w in h for w in ("city", "ville", "town")) and "city" not in col_map:
                    col_map["city"] = idx
                elif any(w in h for w in ("venue", "salle", "club", "festival", "room")) and "venue" not in col_map:
                    col_map["venue"] = idx
                elif any(w in h for w in ("country", "pays")) and "country" not in col_map:
                    col_map["country"] = idx
                elif any(w in h for w in ("status", "statut")) and "status" not in col_map:
                    col_map["status"] = idx
                elif any(w in h for w in ("set", "time", "showtime")) and "set_time" not in col_map:
                    col_map["set_time"] = idx
                elif "promoter" in h and "promoter" not in col_map:
                    col_map["promoter"] = idx
        data_rows = reader[1:] if has_header else reader
        for cells in data_rows:
            if not any(c.strip() for c in cells):
                continue
            dt: str | None = None
            if "date" in col_map and col_map["date"] < len(cells):
                dt = _parse_date_token(cells[col_map["date"]])
            if not dt:
                for c in cells:
                    dt = _parse_date_token(c)
                    if dt:
                        break
            if not dt:
                continue
            city = cells[col_map["city"]].strip() if "city" in col_map and col_map["city"] < len(cells) else ""
            venue = cells[col_map["venue"]].strip() if "venue" in col_map and col_map["venue"] < len(cells) else ""
            if not has_header:
                non_date = [c.strip() for c in cells if c.strip() and _parse_date_token(c) != dt]
                city = non_date[0] if len(non_date) >= 1 else ""
                venue = non_date[1] if len(non_date) >= 2 else ""
            if not city and not venue:
                continue
            raw_status = (
                cells[col_map["status"]].strip().lower()
                if "status" in col_map and col_map["status"] < len(cells)
                else "hold"
            )
            status = raw_status if raw_status in {"hold", "pending", "confirmed", "announced", "advancing"} else "hold"
            set_time = cells[col_map["set_time"]].strip() if "set_time" in col_map and col_map["set_time"] < len(cells) else ""
            country = cells[col_map["country"]].strip() if "country" in col_map and col_map["country"] < len(cells) else ""
            promoter = cells[col_map["promoter"]].strip() if "promoter" in col_map and col_map["promoter"] < len(cells) else ""
            seen_dates.add(dt)
            rows_out.append(
                {
                    "date": dt,
                    "city": city,
                    "venue": venue,
                    "country": country,
                    "status": status,
                    "set_time": set_time,
                    "promoter": promoter,
                }
            )
    else:
        for ln in lines:
            dt = _parse_date_token(ln)
            if not dt:
                continue
            rest = _DATE_ISO_RE.sub("", _DATE_DMY_RE.sub("", ln)).strip(" \t-|·—•")
            parts = [p.strip() for p in re.split(r"\s*[|—–-]\s*", rest) if p.strip()]
            city = parts[0] if parts else rest
            venue = parts[1] if len(parts) > 1 else ""
            if city or venue:
                seen_dates.add(dt)
                rows_out.append({"date": dt, "city": city, "venue": venue, "country": "", "status": "hold", "set_time": "", "promoter": ""})

    return rows_out if len(seen_dates) >= 2 else []


def extract_deterministic(text: str) -> dict[str, Any]:
    """Fast, zero-cost deterministic parser for pasted schedules, flights, hotels, and contacts."""
    items: list[dict[str, Any]] = []
    gig_patch: dict[str, Any] = {}
    warnings: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip(" \t•-*")
        if not line:
            continue

        # 1. Hotel line (check before flight regex so confirmation codes like HR9921 aren't misread as flights)
        if re.search(r"\b(?:hotel|hôtel|check-?in|check-?out)\b", line, re.I) and not _TIME_RANGE_RE.match(line):
            pnr = _PNR_RE.search(line)
            phone = _PHONE_RE.search(line)
            hdata: dict[str, Any] = {"name": re.sub(r"^(?:hotel|hôtel)[:\s-]+", "", line, flags=re.I).split("—")[0].strip()}
            if pnr:
                hdata["confirmation"] = pnr.group(1).upper()
            if phone:
                hdata["phone"] = phone.group(1).strip()
            items.append({"collection": "hotels", "data": hdata})
            continue

        # 2. Flight line (e.g. "AF1181 LHR -> CDG 11:25 13:45 PNR AFX92K")
        fm = _FLIGHT_RE.search(line)
        if fm and not re.search(r"^(?:room|chambre|cdj|djm)\b", line, re.I):
            code = fm.group("flight_no").replace(" ", "").upper()
            times = re.findall(r"\b(\d{1,2})[h:](\d{2})\b", line)
            pnr = _PNR_RE.search(line)
            data: dict[str, Any] = {"flight_no": code, "status": "on_time"}
            if fm.group("dep"):
                data["dep_iata"] = fm.group("dep").upper()
            if fm.group("arr"):
                data["arr_iata"] = fm.group("arr").upper()
            if len(times) >= 1:
                data["dep_time"] = _fmt_hhmm(*times[0])
            if len(times) >= 2:
                data["arr_time"] = _fmt_hhmm(*times[1])
            if pnr:
                data["ref"] = pnr.group(1).upper()
            items.append({"collection": "flights", "data": data})
            continue

        # 3. Timed line (schedule or timetable)
        tm = _TIME_RANGE_RE.match(line)
        if tm:
            start = _fmt_hhmm(tm.group("start"), tm.group("sm"))
            end = _fmt_hhmm(tm.group("end"), tm.group("em")) if tm.group("end") else None
            rest = tm.group("rest").strip(" -–—:")
            if not start:
                warnings.append(f"Invalid time: {line}")
                continue
            low = rest.lower()
            artist_kw = get_settings().artist_name.strip().lower()
            lineup_kws = ("warmup", "warm-up", "closing", "b2b", "dj set", "headliner") + ((artist_kw,) if artist_kw else ())
            non_lineup_kws = ("soundcheck", "dinner", "diner", "dîner", "lunch", "doors", "curfew", "load-in", "load in", "check-in", "checkin", "pickup", "transfer", "driver", "van", "taxi", "shuttle", "lobby", "meeting", "press", "interview")
            is_late_slot = bool(end and (start < "06:00" or start >= "22:00") and not any(k in low for k in non_lineup_kws))
            if any(k in low for k in lineup_kws) or is_late_slot:
                items.append(
                    {
                        "collection": "timetable",
                        "data": {
                            "act": rest,
                            "start": start,
                            **({"end": end} if end else {}),
                            "is_us": bool(artist_kw and artist_kw in low),
                        },
                    }
                )
            elif any(k in low for k in ("pickup", "pick-up", "driver", "van", "transfer", "shuttle", "chauffeur")):
                phone = _PHONE_RE.search(rest)
                items.append(
                    {
                        "collection": "transport",
                        "data": {
                            "mode": "van" if "van" in low else "car",
                            "type": "pickup",
                            "time": start,
                            "notes": rest,
                            **({"driver_phone": phone.group(1).strip()} if phone else {}),
                        },
                    }
                )
            else:
                kind = (
                    "soundcheck" if "soundcheck" in low
                    else "meal" if any(w in low for w in ("dinner", "dîner", "diner", "lunch", "déjeuner", "meal"))
                    else "set" if "set" in low
                    else "press" if any(w in low for w in ("press", "interview", "media"))
                    else "other"
                )
                items.append(
                    {
                        "collection": "schedule",
                        "data": {
                            "time": start,
                            **({"end_time": end} if end else {}),
                            "label": rest,
                            "kind": kind,
                        },
                    }
                )
            continue

        # 4. Contact line with phone or email
        phone = _PHONE_RE.search(line)
        email = _EMAIL_RE.search(line)
        if phone or email:
            name_part = line
            if phone:
                name_part = name_part.replace(phone.group(1), "")
            if email:
                name_part = name_part.replace(email.group(1), "")
            name_clean = re.sub(r"[\s\-–—:,|]+$", "", name_part).strip() or "Contact"
            items.append(
                {
                    "collection": "contacts",
                    "data": {
                        "name": name_clean,
                        **({"phone": phone.group(1).strip()} if phone else {}),
                        **({"email": email.group(1).strip()} if email else {}),
                    },
                }
            )
            continue

    return {
        "engine": "deterministic",
        "provider": "local",
        "model": "deterministic",
        "gig_patch": gig_patch,
        "items": items,
        "warnings": warnings,
    }


def _strip_json_fence(raw_text: str) -> str:
    txt = raw_text.strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt, flags=re.IGNORECASE)
        txt = re.sub(r"\s*```$", "", txt)
    return txt.strip()


def _build_gemini_payload(
    text: str,
    gig_context: dict[str, Any] | None,
    *,
    max_output_tokens: int | None = None,
    thinking_level: str | None = None,
    disable_thinking: bool = False,
) -> dict[str, Any]:
    gen_cfg: dict[str, Any] = {
        "temperature": 0.1,
        "responseMimeType": "application/json",
    }
    if max_output_tokens and max_output_tokens > 0:
        gen_cfg["maxOutputTokens"] = max_output_tokens
    if thinking_level:
        gen_cfg["thinkingConfig"] = {"thinkingLevel": thinking_level}
    elif disable_thinking:
        gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}
    return {
        "systemInstruction": {"parts": [{"text": _SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": f"Gig context: {json.dumps(gig_context or {}, ensure_ascii=False)}\n\nDocument:\n{text}"
                    }
                ],
            }
        ],
        "generationConfig": gen_cfg,
    }


async def _call_vertex(cfg: ResolvedAIConfig, payload: dict[str, Any]) -> dict[str, Any]:
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(google.auth.transport.requests.Request())
    loc = cfg.vertex_location or "global"
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    url = (
        f"https://{host}/v1/projects/{cfg.vertex_project}/locations/{loc}"
        f"/publishers/google/models/{cfg.model}:generateContent"
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {creds.token}"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def _call_gemini_api(cfg: ResolvedAIConfig, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{cfg.model}:generateContent"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url,
            headers={"x-goog-api-key": cfg.gemini_api_key},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def _call_anthropic_api(
    cfg: ResolvedAIConfig,
    text: str,
    gig_context: dict[str, Any] | None,
    *,
    max_output_tokens: int | None = None,
) -> str:
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": cfg.model,
        "max_tokens": max_output_tokens or 2048,
        "temperature": 0.1,
        "system": _SYSTEM_PROMPT + "\nReturn ONLY valid JSON with no markdown or prose outside the JSON object.",
        "messages": [
            {
                "role": "user",
                "content": f"Gig context: {json.dumps(gig_context or {}, ensure_ascii=False)}\n\nDocument:\n{text}",
            }
        ],
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url,
            headers={
                "x-api-key": cfg.anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            json=payload,
        )
        resp.raise_for_status()
        body = resp.json()
    blocks = body.get("content") or []
    return "".join(str(b.get("text") or "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")


async def _call_openai_api(
    cfg: ResolvedAIConfig,
    text: str,
    gig_context: dict[str, Any] | None,
    *,
    max_output_tokens: int | None = None,
) -> str:
    url = "https://api.openai.com/v1/chat/completions"
    payload: dict[str, Any] = {
        "model": cfg.model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Gig context: {json.dumps(gig_context or {}, ensure_ascii=False)}\n\nDocument:\n{text}",
            },
        ],
    }
    if max_output_tokens and max_output_tokens > 0:
        payload["max_completion_tokens"] = max_output_tokens
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {cfg.openai_api_key}"},
            json=payload,
        )
        resp.raise_for_status()
        body = resp.json()
    return str(((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "")


async def extract_logistics(
    text: str,
    *,
    gig_context: dict[str, Any] | None = None,
    repo: TourRepo | None = None,
    config_override: ResolvedAIConfig | None = None,
    max_output_tokens: int | None = None,
    thinking_level: str | None = None,
) -> dict[str, Any]:
    """Unified extractor: live-configured Google / Anthropic / OpenAI model, else deterministic."""
    cfg = config_override or resolve_ai_config(repo)
    if cfg.effective_provider == "local":
        res = extract_deterministic(text)
        multi = detect_multi_date_rows(text)
        if multi:
            res["multi_dates"] = multi
        return res

    # Cost-controlled reasoning config on hosted Free Beta:
    # - Gemini 4+ / 3+ use thinkingLevel (e.g. "low" on Gemini 4 Hydrogen, "MINIMAL" on 3.5 Flash-Lite)
    # - Legacy Gemini 2.5 Flash uses thinkingBudget=0
    eff_thinking = thinking_level
    disable_thinking = False
    low_model = cfg.model.lower()
    if cfg.hosted_locked and not eff_thinking:
        if "2.5-flash" in low_model:
            disable_thinking = True
        elif cfg.hosted_thinking_level:
            eff_thinking = cfg.hosted_thinking_level
    elif eff_thinking and "2.5-flash" in low_model:
        eff_thinking = None
        disable_thinking = True

    try:
        if cfg.effective_provider == "anthropic":
            raw_text = await _call_anthropic_api(cfg, text, gig_context, max_output_tokens=max_output_tokens)
        elif cfg.effective_provider == "openai":
            raw_text = await _call_openai_api(cfg, text, gig_context, max_output_tokens=max_output_tokens)
        else:
            payload = _build_gemini_payload(
                text,
                gig_context,
                max_output_tokens=max_output_tokens,
                thinking_level=eff_thinking,
                disable_thinking=disable_thinking,
            )
            if cfg.effective_provider == "vertex":
                body = await _call_vertex(cfg, payload)
            else:
                body = await _call_gemini_api(cfg, payload)
            raw_text = body["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(_strip_json_fence(raw_text))
        return {
            "engine": f"{cfg.effective_provider}:{cfg.model}",
            "provider": cfg.effective_provider,
            "model": cfg.model,
            "gig_patch": parsed.get("gig_patch") if isinstance(parsed.get("gig_patch"), dict) else {},
            "items": parsed.get("items") if isinstance(parsed.get("items"), list) else [],
            "warnings": parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else [],
            **({"multi_dates": multi} if (multi := detect_multi_date_rows(text)) else {}),
        }
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else 0
        if repo is not None and status_code in (404, 410):
            record_model_deprecation_alert(
                repo,
                model=cfg.model,
                reason=f"{cfg.effective_provider} returned HTTP {status_code} (model sunset or deprecated)",
                status_code=status_code,
            )
        fallback = extract_deterministic(text)
        label_map = {
            "vertex": "Vertex AI",
            "gemini": "Gemini API",
            "anthropic": "Anthropic API",
            "openai": "OpenAI API",
        }
        label = label_map.get(cfg.effective_provider, cfg.effective_provider)
        fallback["warnings"].append(
            f"{label} ({cfg.model}) returned HTTP {status_code} — used local deterministic parser."
        )
        return fallback
    except Exception as exc:
        fallback = extract_deterministic(text)
        label_map = {
            "vertex": "Vertex AI",
            "gemini": "Gemini API",
            "anthropic": "Anthropic API",
            "openai": "OpenAI API",
        }
        label = label_map.get(cfg.effective_provider, cfg.effective_provider)
        fallback["warnings"].append(
            f"{label} ({cfg.model}) unavailable ({type(exc).__name__}) — used local deterministic parser."
        )
        return fallback
