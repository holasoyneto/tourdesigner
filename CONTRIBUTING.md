# Contributing to Tour Designer

Thank you for contributing to Tour Designer!

## Development Setup

```bash
# Backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q && .venv/bin/ruff check app scripts tests

# Frontend
cd frontend && npm install && npm run build && npm test
```

Please keep the codebase free of personal names, private domains, or hardcoded credentials, and ensure all CI checks pass before opening a pull request.

## Contributor License Agreement (CLA)

By submitting a pull request or other contribution to this repository, you agree to the following terms:

1. **Original Work & Authority:** Your contribution is your original work (or you have the right to submit it) and you have the legal authority to grant the licenses below.
2. **AGPL-3.0-only Open Source License:** You license your contribution to the project and the public under the [GNU Affero General Public License v3.0 (AGPL-3.0-only)](LICENSE).
3. **Dual-Licensing / Commercial Grant:** You grant the project maintainers a perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright and patent license to reproduce, modify, distribute, sublicense, and relicense your contribution under both `AGPL-3.0-only` and separate commercial or white-label licenses.
4. **No Obligation:** Maintainers are not obligated to merge or use any submitted contribution.
