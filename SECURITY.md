# Security Policy

## Architecture & Tenant Isolation
- **Workspace / Tenant Isolation**: In multi-tenant mode (`TENANCY_MODE=multi`), every gig, item, person, file, and share link is scoped to an authenticated tenant repository (`tenants/{tenant_id}/...` in Firestore and GCS, or tenant-scoped SQLite tables). Cross-tenant reads and writes are rejected at the repository and API boundaries.
- **File Vault & Signed URLs**: Uploaded documents (boarding passes, riders, passports) are stored privately (`FILE_STORAGE_BACKEND=gcs` or local vault directory) and served only through short-lived HMAC-signed or authenticated download endpoints with content-type validation. External `source_url` ingestion enforces HTTPS-only public hosts and blocks private, loopback, link-local, and cloud metadata IP ranges (SSRF protection).
- **Stateless MCP Concurrency**: MCP `read_token` values are HMAC-SHA256 signed tokens bound to `(user_id, tenant_id, gig_id, gig_version, item_versions, exp)` and paired with compare-and-swap (`changed_since_read`) checks.

## MCP Authentication: Bearer Token vs URL Token
- **Recommended (`Authorization: Bearer <token>`)**: Use the `Authorization: Bearer` header whenever your MCP client supports custom headers (Claude Desktop, Cursor, CLI, server-to-server). Tokens in headers are not logged in browser history or standard URL access logs.
- **URL Token (`/mcp?token=<token>` or `/mcp/t/<token>`)**: Provided strictly for mobile AI clients that cannot configure custom HTTP headers. Treat a tokenized MCP URL as a password: never share screenshots containing the URL, rotate/revoke it immediately in **Settings -> AI / MCP** if exposed, and prefer read-only or scoped crew keys when appropriate.

## Reporting a Vulnerability
Please do **not** open public GitHub issues for security vulnerabilities.

Instead, report suspected vulnerabilities privately through GitHub Security Advisories (**Security -> Advisories -> Report a vulnerability**) with:
- A description of the issue and affected endpoint or component
- Steps to reproduce or a minimal proof of concept
- Any suggested remediation

We aim to acknowledge reports within 48 hours and ship fixes promptly.
