# Profile: TypeScript / Node.js — pnpm + Prettier + ESLint + tsc + Vitest.
# Reference implementation of the canonical command contract (profiles/README.md).
# Copy to repo root, ensure package.json defines "build" and "dev" scripts, adjust
# test path filters to your layout (this one assumes the tests/ mirror of src/).

.PHONY: help setup format lint test test-unit test-integration coverage build run \
        security-scan sbom clean doctor

FILE ?=

help: ## List available targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Canonical interface (CLAUDE.md §11) — do not change semantics.
# ---------------------------------------------------------------------------

setup: ## Install toolchain: node deps (frozen lockfile) + git hooks
	corepack enable
	pnpm install --frozen-lockfile
	pre-commit install --hook-type pre-commit --hook-type pre-push

format: ## Auto-format (all, or FILE=<path>)
ifneq ($(FILE),)
	pnpm exec prettier --write "$(FILE)"
else
	pnpm exec prettier --write .
endif

lint: ## Check-only, zero warnings (COD-001): prettier check + eslint + types
	pnpm exec prettier --check .
	pnpm exec eslint . --max-warnings 0
	pnpm exec tsc --noEmit

test: ## Full suite
	pnpm exec vitest run

test-unit: ## Fast suite — pre-push gate (excludes integration/e2e dirs)
	pnpm exec vitest run --exclude "**/integration/**" --exclude "**/e2e/**"

test-integration: ## Integration + e2e dirs only
	pnpm exec vitest run --dir tests --exclude "**/unit/**"

coverage: ## Tests with coverage report (TST-003 ratchet)
	pnpm exec vitest run --coverage

build: ## Produce deployable artifact (delegates to package.json "build")
	pnpm run build

run: ## Run locally (delegates to package.json "dev")
	pnpm run dev

security-scan: ## Local sweep: secrets + dependency vulns
	@if command -v gitleaks >/dev/null 2>&1; then gitleaks detect --no-banner; else echo "gitleaks not installed — CI still enforces SEC-002"; fi
	@if command -v trivy >/dev/null 2>&1; then trivy fs --scanners vuln,secret --exit-code 1 .; else echo "trivy not installed — CI still enforces SEC-030"; fi
	pnpm audit --audit-level high

sbom: ## SBOM (SPDX + CycloneDX) into dist/ — REL-020
	@mkdir -p dist
	@if command -v syft >/dev/null 2>&1; then syft . -o spdx-json=dist/sbom.spdx.json -o cyclonedx-json=dist/sbom.cdx.json && echo "SBOM written to dist/"; else echo "syft not installed — release workflow generates the authoritative SBOM"; fi

clean: ## Remove build artifacts and caches (workspace only — GR-031)
	rm -rf dist coverage .eslintcache node_modules/.cache

doctor: ## Foundation self-check: metadata invariants + guard-hook tests
	@bash scripts/template-check.sh
	@bash .claude/hooks/tests/guard-bash.test.sh
