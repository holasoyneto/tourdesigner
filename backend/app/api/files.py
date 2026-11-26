"""File vault API with direct GCS V4 signed URLs, local fallback, and safe content headers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, BackgroundTasks, Body, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response

from app.api.common import (
    created,
    err,
    get_app_settings,
    get_repo,
    get_tenant_id,
    ok,
    record_audit,
    require_member,
)
from app.config import Settings, get_settings
from app.domain.auth import constant_time_equals
from app.domain.models import FileRecord, new_id
from app.domain.roles import can_access_gig, is_owner

router = APIRouter(prefix="/api", tags=["files"])
_FALLBACK_HMAC_SECRET = secrets.token_hex(32)


def _mcp_hmac_secret(root_repo) -> str:
    if root_repo is not None:
        sec = root_repo.get_setting("mcp_file_hmac_secret", "")
        if isinstance(sec, str) and len(sec) >= 32:
            return sec
        new_sec = secrets.token_hex(32)
        try:
            root_repo.set_setting("mcp_file_hmac_secret", new_sec)
            return new_sec
        except Exception:
            pass
    return _FALLBACK_HMAC_SECRET


def mint_mcp_file_token(
    root_repo,
    *,
    file_id: str,
    tenant_id: str | None = None,
    ttl_seconds: int = 900,
) -> str:
    payload_obj = {
        "fid": file_id,
        "tid": tenant_id or "",
        "exp": int(time.time()) + max(60, ttl_seconds),
    }
    b64 = base64.urlsafe_b64encode(json.dumps(payload_obj, separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
    sig = hmac.new(_mcp_hmac_secret(root_repo).encode("utf-8"), b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def verify_mcp_file_token(root_repo, token: str) -> tuple[str, str | None] | None:
    if "." not in (token or ""):
        return None
    b64, sig = token.split(".", 1)
    expected = hmac.new(_mcp_hmac_secret(root_repo).encode("utf-8"), b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not constant_time_equals(sig, expected):
        return None
    try:
        padded = b64 + "=" * (-len(b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        if int(data.get("exp") or 0) < int(time.time()):
            return None
        fid = str(data.get("fid") or "").strip()
        tid = str(data.get("tid") or "").strip() or None
        if not fid:
            return None
        return fid, tid
    except Exception:
        return None

MAX_LOCAL_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MiB local cap; cloud mode uploads directly to GCS
_CHUNK_BYTES = 1024 * 1024
_SAFE_INLINE_MIMES = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "text/plain",
    }
)
_OBJECT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,80}$")


def _local_vault_dir(settings: Settings | None = None) -> Path:
    cfg = settings or get_settings()
    root = Path(cfg.file_vault_local_path).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_local_path(
    object_id: str,
    settings: Settings | None = None,
    tenant_id: str | None = None,
) -> Path | None:
    if not _OBJECT_ID_RE.fullmatch(object_id or ""):
        return None
    root = _local_vault_dir(settings)
    base = (root / tenant_id).resolve() if tenant_id else root
    if not base.is_relative_to(root):
        return None
    base.mkdir(parents=True, exist_ok=True)
    candidate = (base / object_id).resolve()
    if not candidate.is_relative_to(base):
        return None
    return candidate


def _sanitize_filename(raw: str | None) -> str:
    leaf = Path(raw or "document").name
    cleaned = re.sub(r"[\x00-\x1f\x7f\"\\;/]+", "_", leaf).strip(" .")
    return (cleaned or "document")[:180]


def _content_disposition(disposition_type: str, filename: str) -> str:
    safe = _sanitize_filename(filename)
    ascii_name = safe.encode("ascii", "ignore").decode("ascii").strip() or "document"
    encoded = quote(safe, safe="")
    return f'{disposition_type}; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded}'


def _sign_gcs_url(
    gcs_key: str,
    *,
    method: str,
    content_type: str | None = None,
    minutes: int = 15,
    bucket_name: str | None = None,
) -> str:
    from google.cloud import storage

    settings = get_settings()
    client = storage.Client()
    blob = client.bucket(bucket_name or settings.file_vault_bucket).blob(gcs_key)
    kwargs: dict[str, Any] = {
        "version": "v4",
        "expiration": timedelta(minutes=minutes),
        "method": method,
    }
    if content_type:
        kwargs["content_type"] = content_type
    return blob.generate_signed_url(**kwargs)


def upload_gcs_bytes(bucket_name: str, gcs_key: str, data: bytes, content_type: str) -> None:
    from google.cloud import storage

    client = storage.Client()
    blob = client.bucket(bucket_name).blob(gcs_key)
    blob.upload_from_string(data, content_type=content_type)


def download_gcs_bytes(bucket_name: str, gcs_key: str, *, max_bytes: int = 2 * 1024 * 1024) -> bytes | None:
    from google.cloud import storage

    client = storage.Client()
    blob = client.bucket(bucket_name).blob(gcs_key)
    blob.reload()
    if blob.size is not None and int(blob.size) > max_bytes:
        return None
    return blob.download_as_bytes()


def _fetch_drive_bytes(drive_file_id: str, mime: str) -> tuple[bytes, str] | None:
    """Read-only fallback for legacy v1 files stored in Google Workspace Shared Drive (`drive_file_id`)."""
    fid = (drive_file_id or "").strip()
    if not fid:
        return None
    try:
        import google.auth
        import google.auth.transport.requests

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/drive.readonly"])
        creds.refresh(google.auth.transport.requests.Request())
        headers = {"Authorization": f"Bearer {creds.token}"}
        is_google_doc = mime.startswith("application/vnd.google-apps.")
        if is_google_doc:
            url = f"https://www.googleapis.com/drive/v3/files/{quote(fid, safe='')}/export"
            params: dict[str, Any] = {"mimeType": "application/pdf"}
            out_mime = "application/pdf"
        else:
            url = f"https://www.googleapis.com/drive/v3/files/{quote(fid, safe='')}"
            params = {"alt": "media", "supportsAllDrives": "true"}
            out_mime = mime or "application/octet-stream"
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            return resp.content, out_mime
    except Exception:
        return None


def delete_gcs_object(bucket_name: str, gcs_key: str) -> None:
    from google.cloud import storage

    client = storage.Client()
    blob = client.bucket(bucket_name).blob(gcs_key)
    blob.delete()


def _gcs_key_allowed_for_tenant(gcs_key: str, settings: Settings, tenant_id: str | None) -> bool:
    if not gcs_key or ".." in gcs_key:
        return False
    if settings.tenancy_mode == "multi":
        return bool(tenant_id) and gcs_key.startswith(f"vault/t/{tenant_id}/")
    return gcs_key.startswith("vault/")


def _mirror_file_to_workspace_drive(repo, file_id: str) -> None:
    """Queue an asynchronous copy into Google Workspace Shared Drive when mirroring is enabled.

    Hard-blocked in multi-tenant (public) mode so public tenant files can NEVER touch an operator's Drive.
    """
    settings = get_settings()
    if settings.tenancy_mode == "multi":
        return
    if not settings.drive_mirror_enabled or not settings.drive_root_folder_id:
        return
    rec = repo.get_file(file_id)
    if not rec or rec.drive_file_id:
        return
    rec.mirror_status = "pending"
    repo.upsert_file(rec)


@router.get("/files")
def list_files(
    request: Request,
    gig_id: str | None = None,
    person_id: str | None = None,
) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    files = repo.list_files(gig_id=gig_id, person_id=person_id)
    if not is_owner(member):
        files = [f for f in files if f.scope != "private"]
    if member.artist_ids:
        visible_gigs = {g.id for g in repo.list_gigs() if can_access_gig(member, g)}
        files = [f for f in files if not f.gig_id or f.gig_id in visible_gigs]
    return ok(files=[f.model_dump(mode="json") for f in files])


@router.post("/files/sign-upload")
def sign_upload(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    """Issue a direct V4 Signed PUT URL to GCS, or local multipart target in self-hosted mode."""
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    name = _sanitize_filename(str(body.get("name") or ""))
    if not name:
        return err("name_required", status=400)
    mime = str(body.get("mime") or "application/octet-stream").split(";")[0].strip().lower()
    object_id = new_id("obj")
    tenant_id = get_tenant_id(request)
    gcs_key = f"vault/t/{tenant_id}/{object_id}" if tenant_id else f"vault/v2/{object_id}"
    settings = get_app_settings(request)

    if settings.file_storage_backend == "gcs" and settings.file_vault_bucket:
        upload_url = _sign_gcs_url(gcs_key, method="PUT", content_type=mime)
        return ok(mode="gcs_signed_put", object_id=object_id, gcs_key=gcs_key, upload_url=upload_url)

    return ok(
        mode="local_multipart",
        object_id=object_id,
        gcs_key=gcs_key,
        upload_url="/api/files/upload",
    )


@router.post("/files/confirm")
def confirm_gcs_upload(
    request: Request,
    background: BackgroundTasks,
    body: dict[str, Any] = Body(...),
) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    object_id = str(body.get("object_id") or new_id("obj"))
    if not _OBJECT_ID_RE.fullmatch(object_id):
        return err("invalid_object_id", status=400)
    tenant_id = get_tenant_id(request)
    expected_prefix = f"vault/t/{tenant_id}/" if tenant_id else "vault/v2/"
    gcs_key = str(body.get("gcs_key") or f"{expected_prefix}{object_id}")
    if not gcs_key.startswith(expected_prefix):
        return err("invalid_gcs_key", status=400)
    try:
        size = max(0, int(body.get("size") or 0))
    except (TypeError, ValueError):
        return err("invalid_size", status=400)

    rec = FileRecord(
        object_id=object_id,
        gig_id=body.get("gig_id"),
        person_id=body.get("person_id"),
        name=_sanitize_filename(str(body.get("name") or "document")),
        mime=str(body.get("mime") or "application/octet-stream").split(";")[0].strip().lower(),
        size=size,
        content_sha256=body.get("content_sha256"),
        gcs_key=gcs_key,
        doc_kind=body.get("doc_kind"),
        doc_country=body.get("doc_country"),
        doc_expires=body.get("doc_expires"),
        scope="private" if body.get("scope") == "private" else "crew",
        added_by=member.id,
    )
    saved = get_repo(request).upsert_file(rec)
    background.add_task(_mirror_file_to_workspace_drive, get_repo(request), saved.id)
    record_audit(request, "upload_file", saved.id, f"Attached {saved.name}")
    return created(file=saved.model_dump(mode="json"))


@router.post("/files/upload")
async def upload_local_file(
    request: Request,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    gig_id: str | None = Form(default=None),
    person_id: str | None = Form(default=None),
    doc_kind: str | None = Form(default=None),
    doc_expires: str | None = Form(default=None),
    scope: str | None = Form(default="crew"),
) -> JSONResponse:
    """Streamed local vault upload handler with strict size enforcement."""
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member

    hasher = hashlib.sha256()
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_LOCAL_UPLOAD_BYTES:
            return err("file_too_large", status=413)
        hasher.update(chunk)
        chunks.append(chunk)

    settings = get_app_settings(request)
    tenant_id = get_tenant_id(request)
    repo = get_repo(request)
    if settings.tenancy_mode == "multi" and settings.hosted_max_files_mb > 0:
        used_bytes = sum(max(0, int(f.size or 0)) for f in repo.list_files())
        if used_bytes + total > settings.hosted_max_files_mb * 1024 * 1024:
            return err("quota_storage_exceeded", status=413)

    object_id = new_id("obj")
    dest = _safe_local_path(object_id, settings, tenant_id)
    if dest is None:
        return err("invalid_object_id", status=400)
    dest.write_bytes(b"".join(chunks))

    safe_name = _sanitize_filename(file.filename)
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    rec = FileRecord(
        object_id=object_id,
        gig_id=gig_id or None,
        person_id=person_id or None,
        name=safe_name,
        mime=mime,
        size=total,
        content_sha256=hasher.hexdigest(),
        gcs_key=f"local/{object_id}",
        doc_kind=doc_kind or None,
        doc_expires=doc_expires or None,
        scope="private" if scope == "private" else "crew",
        added_by=member.id,
    )
    saved = get_repo(request).upsert_file(rec)
    background.add_task(_mirror_file_to_workspace_drive, get_repo(request), saved.id)
    record_audit(request, "upload_file", saved.id, f"Uploaded {saved.name}")
    return created(file=saved.model_dump(mode="json"))


@router.get("/files/mcp/{sig_token}")
def download_mcp_signed_file(sig_token: str, request: Request):
    """Serve a file via a short-lived HMAC-signed URL minted by the MCP get_file tool."""
    root_repo = getattr(request.app.state, "repo", None)
    verified = verify_mcp_file_token(root_repo, sig_token)
    if not verified:
        return err("invalid_or_expired_link", status=401)
    file_id, tenant_id = verified
    settings = get_app_settings(request)
    if settings.tenancy_mode == "multi":
        if not tenant_id:
            return err("invalid_or_expired_link", status=401)
        repo = request.app.state.tenant_manager.get_repo(tenant_id)
        if repo is None:
            return err("file_not_found", status=404)
    else:
        repo = root_repo or get_repo(request)
        tenant_id = None

    rec = repo.get_file(file_id)
    if not rec:
        return err("file_not_found", status=404)
    if settings.file_storage_backend == "gcs" and rec.gcs_key and settings.file_vault_bucket:
        if not _gcs_key_allowed_for_tenant(rec.gcs_key, settings, tenant_id):
            return err("file_not_found", status=404)
        url = _sign_gcs_url(rec.gcs_key, method="GET", bucket_name=settings.file_vault_bucket)
        return RedirectResponse(url=url, status_code=302)

    local_path = _safe_local_path(rec.object_id, settings, tenant_id)
    mime = (rec.mime or "application/octet-stream").split(";")[0].strip().lower()
    if local_path and local_path.is_file():
        allow_inline = mime in _SAFE_INLINE_MIMES
        disp = _content_disposition("inline" if allow_inline else "attachment", rec.name)
        return FileResponse(
            str(local_path),
            media_type=mime if allow_inline else "application/octet-stream",
            headers={
                "Content-Disposition": disp,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    if rec.drive_file_id and settings.tenancy_mode != "multi":
        fetched = _fetch_drive_bytes(rec.drive_file_id, mime)
        if fetched is not None:
            raw_bytes, out_mime = fetched
            allow_inline = out_mime in _SAFE_INLINE_MIMES
            disp = _content_disposition("inline" if allow_inline else "attachment", rec.name)
            return Response(
                content=raw_bytes,
                media_type=out_mime if allow_inline else "application/octet-stream",
                headers={
                    "Content-Disposition": disp,
                    "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )

    return err("file_bytes_missing", status=404)


@router.get("/files/{file_id}/download")
def download_file(file_id: str, request: Request, inline: bool = False):
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    rec = repo.get_file(file_id)
    if not rec:
        return err("file_not_found", status=404)
    if rec.scope == "private" and not is_owner(member):
        return err("file_not_found", status=404)
    if rec.gig_id and member.artist_ids:
        gig = repo.get_gig(rec.gig_id)
        if not gig or not can_access_gig(member, gig):
            return err("file_not_found", status=404)
    settings = get_app_settings(request)
    tenant_id = get_tenant_id(request)
    if settings.file_storage_backend == "gcs" and rec.gcs_key and settings.file_vault_bucket:
        if not _gcs_key_allowed_for_tenant(rec.gcs_key, settings, tenant_id):
            return err("file_not_found", status=404)
        url = _sign_gcs_url(rec.gcs_key, method="GET", bucket_name=settings.file_vault_bucket)
        return ok(url=url, name=rec.name, mime=rec.mime)
    local_path = _safe_local_path(rec.object_id, settings, tenant_id)
    mime = (rec.mime or "application/octet-stream").split(";")[0].strip().lower()
    if local_path and local_path.is_file():
        allow_inline = inline and mime in _SAFE_INLINE_MIMES
        disp = _content_disposition("inline" if allow_inline else "attachment", rec.name)
        return FileResponse(
            str(local_path),
            media_type=mime if allow_inline else "application/octet-stream",
            headers={
                "Content-Disposition": disp,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    if rec.drive_file_id and settings.tenancy_mode != "multi":
        fetched = _fetch_drive_bytes(rec.drive_file_id, mime)
        if fetched is not None:
            raw_bytes, out_mime = fetched
            allow_inline = inline and out_mime in _SAFE_INLINE_MIMES
            disp = _content_disposition("inline" if allow_inline else "attachment", rec.name)
            return Response(
                content=raw_bytes,
                media_type=out_mime if allow_inline else "application/octet-stream",
                headers={
                    "Content-Disposition": disp,
                    "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )

    return err("file_bytes_missing", status=404)


@router.patch("/files/{file_id}")
def update_file_meta(file_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    rec = repo.get_file(file_id)
    if not rec or (rec.scope == "private" and not is_owner(member)):
        return err("file_not_found", status=404)
    for k in ("name", "pinned", "gig_id", "person_id", "doc_kind", "doc_country", "doc_expires", "scope"):
        if k in body:
            if k == "scope" and not is_owner(member):
                continue
            val = _sanitize_filename(str(body[k])) if k == "name" else body[k]
            setattr(rec, k, val)
    saved = repo.upsert_file(rec)
    return ok(file=saved.model_dump(mode="json"))


@router.delete("/files/{file_id}")
def delete_file(file_id: str, request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    rec = repo.get_file(file_id)
    if not rec or (rec.scope == "private" and not is_owner(member)):
        return err("file_not_found", status=404)
    repo.delete_file(file_id)
    settings = get_app_settings(request)
    tenant_id = get_tenant_id(request)
    if (
        settings.file_storage_backend == "gcs"
        and rec.gcs_key
        and settings.file_vault_bucket
        and _gcs_key_allowed_for_tenant(rec.gcs_key, settings, tenant_id)
    ):
        try:
            delete_gcs_object(settings.file_vault_bucket, rec.gcs_key)
        except Exception:
            pass
    local_path = _safe_local_path(rec.object_id, settings, tenant_id)
    if local_path and local_path.is_file():
        local_path.unlink(missing_ok=True)
    record_audit(request, "delete_file", file_id, f"Deleted {rec.name} by {member.name}")
    return ok(file_id=file_id)
