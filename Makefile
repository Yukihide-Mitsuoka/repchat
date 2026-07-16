# Canonical command interface (CLAUDE.md §11).
# Every agent, hook, and CI job calls ONLY these targets, so automation stays stable
# across stacks. TEMPLATE: replace each no-op with your project's real commands and
# delete the placeholder echo — or start from a reference implementation in profiles/
# (contract semantics: profiles/README.md). Optional FILE=<path> narrows format/lint
# to one file.

.PHONY: setup format lint test test-unit test-integration coverage build run \
        security-scan sbom clean help doctor

FILE ?=

help: ## List available targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

setup: ## Install toolchain and dependencies
	@echo "[template] setup: not wired yet — add your install commands here"

format: ## Auto-format code (all, or FILE=<path>)
	@echo "[template] format: not wired yet (e.g. ruff format / prettier --write / gofmt)"

lint: ## Lint code, zero warnings allowed — COD-001 (all, or FILE=<path>)
	@echo "[template] lint: not wired yet (e.g. ruff check / eslint / golangci-lint)"

test: ## Full test suite (unit + integration) — TST-001
	@echo "[template] test: not wired yet (e.g. pytest / npm test / go test ./...)"

test-unit: ## Fast unit suite only, used by pre-commit — TST-001
	@echo "[template] test-unit: not wired yet"

test-integration: ## Integration suite (may use containers)
	@echo "[template] test-integration: not wired yet"

coverage: ## Test with coverage report — TST-003 ratchet
	@echo "[template] coverage: not wired yet"

build: ## Produce deployable artifact
	@echo "[template] build: not wired yet"

run: ## Run the application locally
	@echo "[template] run: not wired yet"

security-scan: ## Local security sweep (secrets + deps + config)
	@if command -v gitleaks >/dev/null 2>&1; then gitleaks detect --no-banner; else echo "[template] gitleaks not installed — CI still enforces SEC-002"; fi
	@if command -v trivy >/dev/null 2>&1; then trivy fs --scanners vuln,misconfig,secret --exit-code 1 .; else echo "[template] trivy not installed — CI still enforces SEC-030"; fi

sbom: ## Generate SBOM (SPDX + CycloneDX) into ./dist — REL-020
	@mkdir -p dist
	@if command -v syft >/dev/null 2>&1; then syft . -o spdx-json=dist/sbom.spdx.json -o cyclonedx-json=dist/sbom.cdx.json && echo "SBOM written to dist/"; else echo "[template] syft not installed — release workflow generates the authoritative SBOM"; fi

clean: ## Remove build artifacts
	@rm -rf dist

doctor: ## Self-check the template: metadata invariants + guard-hook tests (foundation-level, stack-independent)
	@bash scripts/template-check.sh
	@bash .claude/hooks/tests/guard-bash.test.sh
