# Profile: Python — uv + Ruff (format & lint) + mypy + pytest.
# Reference implementation of the canonical command contract (profiles/README.md).
# Copy to repo root; replace {{PACKAGE}} with your top-level package name; test
# filters assume the tests/ mirror of src/ (unit/ and integration/ subdirs).

.PHONY: help setup format lint test test-unit test-integration coverage build run \
        security-scan sbom clean doctor

FILE ?=

help: ## List available targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Canonical interface (CLAUDE.md §11) — do not change semantics.
# ---------------------------------------------------------------------------

setup: ## Install toolchain: python deps + git hooks (idempotent)
	uv sync
	pre-commit install --hook-type pre-commit --hook-type pre-push

format: ## Auto-format (all, or FILE=<path>)
ifneq ($(FILE),)
	uv run ruff format "$(FILE)"
	uv run ruff check --fix-only "$(FILE)"
else
	uv run ruff format .
	uv run ruff check --fix-only .
endif

lint: ## Check-only, zero warnings (COD-001): format check + lint + types
	uv run ruff format --check .
	uv run ruff check .
	uv run mypy src

test: ## Full suite
	uv run pytest tests

test-unit: ## Fast suite — pre-push gate (excludes integration/e2e dirs)
	uv run pytest tests --ignore-glob="**/integration/**" --ignore=tests/e2e

test-integration: ## Integration dirs only (containers allowed)
	uv run pytest tests --ignore-glob="**/unit/**" --ignore=tests/e2e

coverage: ## Tests with coverage report (TST-003 ratchet)
	uv run pytest tests --cov=src --cov-report=term-missing --cov-report=xml

build: ## Build wheel + sdist into dist/
	uv build

run: ## Run the application locally
	uv run python -m {{PACKAGE}}

security-scan: ## Local sweep: secrets + dependency vulns (lockfile-aware)
	@if command -v gitleaks >/dev/null 2>&1; then gitleaks detect --no-banner; else echo "gitleaks not installed — CI still enforces SEC-002"; fi
	@if command -v trivy >/dev/null 2>&1; then trivy fs --scanners vuln,secret --exit-code 1 .; else echo "trivy not installed — CI still enforces SEC-030"; fi

sbom: ## SBOM (SPDX + CycloneDX) into dist/ — REL-020
	@mkdir -p dist
	@if command -v syft >/dev/null 2>&1; then syft . -o spdx-json=dist/sbom.spdx.json -o cyclonedx-json=dist/sbom.cdx.json && echo "SBOM written to dist/"; else echo "syft not installed — release workflow generates the authoritative SBOM"; fi

clean: ## Remove build artifacts and caches (workspace only — GR-031)
	rm -rf dist htmlcov .coverage coverage.xml .pytest_cache .ruff_cache .mypy_cache
	find . -type d -name "__pycache__" -exec rm -rf {} +

doctor: ## Foundation self-check: metadata invariants + guard-hook tests
	@bash scripts/template-check.sh
	@bash .claude/hooks/tests/guard-bash.test.sh
