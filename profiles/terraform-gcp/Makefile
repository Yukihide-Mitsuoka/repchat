# Profile: Terraform (GCP foundations, layered) + Python tooling via uv + OPA.
# Reference implementation of the canonical command contract — see profiles/README.md.
# Copy to repo root and adjust paths. Canonical targets first (hooks/CI depend on
# their exact semantics); project-specific extensions below.
# Adapted 2026-07-02 from a production foundations Makefile; deliberate changes from
# the original: lint is check-only, no `%:` catch-all, DESTROY_ARGS replaces
# $(MAKECMDGOALS), tflint --init moved to setup, test-mode logic deduplicated.

.PHONY: help setup format lint test test-unit test-integration coverage build run \
        security-scan sbom clean doctor \
        check template generate opa plan deploy destroy delivery delivery-doc \
        test-mode prune

FILE ?=
DESTROY_ARGS ?=

# Sourced at the start of deploy-family recipes: activates test mode (random prefix,
# skip management projects) when .test_mode_env exists. Single shell line — vars persist.
TEST_MODE_SH = if [ -f .test_mode_env ]; then echo "🧪 Test Mode Active: skipping management projects (logsink/monitoring)."; . ./.test_mode_env; export SKIP_MANAGEMENT_PROJECTS=true; fi

help: ## List available targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Canonical interface (CLAUDE.md §11) — do not change semantics.
# ---------------------------------------------------------------------------

setup: ## Install toolchain: python deps, tflint plugins, git hooks (idempotent)
	uv sync
	tflint --init --config "$(CURDIR)/.tflint.hcl"
	pre-commit install --hook-type pre-commit --hook-type pre-push

format: ## Auto-format terraform + python (all, or FILE=<path>)
ifneq ($(FILE),)
	@case "$(FILE)" in \
		*.tf|*.tfvars) terraform fmt "$(FILE)" ;; \
		*.py) uv run ruff format "$(FILE)" ;; \
		*) : ;; \
	esac
else
	cd terraform && terraform fmt -recursive
	uv run ruff format terraform/scripts tests
endif

lint: ## Check-only, zero warnings (COD-001). Fixing is `make format`'s job.
	cd terraform && terraform fmt -recursive -check
	tflint --recursive --config "$(CURDIR)/.tflint.hcl" --chdir terraform
	find terraform/scripts -name "*.sh" -exec shellcheck -s bash {} +
	uv run ruff check terraform/scripts tests
	opa check policies/*.rego

test: test-unit test-integration ## Full suite

test-unit: ## Fast python suite — pre-push gate
	uv run pytest tests/

test-integration: ## terraform test for every module, then every non-module test dir
	@set -e; for dir in terraform/modules/*/; do \
		echo "Testing $$dir..."; \
		(cd "$$dir" && rm -rf .terraform .terraform.lock.hcl && terraform init -backend=false >/dev/null && terraform test); \
	done
	@set -e; for dir in $$(find terraform -name '*.tftest.hcl' -not -path 'terraform/modules/*' -exec dirname {} \; | sort -u); do \
		echo "Testing $$dir..."; \
		(cd "$$dir" && rm -rf .terraform .terraform.lock.hcl && terraform init -backend=false >/dev/null && terraform test); \
	done

coverage: ## Python tests with coverage report (TST-003 ratchet)
	uv run pytest tests/ --cov --cov-report=term-missing --cov-report=xml

build: ## IaC "build" = credential-free validate of every terraform config
	@set -e; for dir in $$(find terraform -name '*.tf' -not -path '*/.terraform/*' -exec dirname {} \; | sort -u); do \
		echo "Validating $$dir..."; \
		(cd "$$dir" && terraform init -backend=false >/dev/null && terraform validate); \
	done

run: plan ## For IaC, "run" shows the execution plan

security-scan: ## Local sweep: secrets + IaC misconfig + policy syntax
	@if command -v gitleaks >/dev/null 2>&1; then gitleaks detect --no-banner; else echo "gitleaks not installed — CI still enforces SEC-002"; fi
	@if command -v trivy >/dev/null 2>&1; then trivy config --exit-code 1 terraform; else echo "trivy not installed — CI still enforces SEC-030"; fi
	opa check policies/*.rego

sbom: ## SBOM (SPDX + CycloneDX) into dist/ — REL-020
	@mkdir -p dist
	@if command -v syft >/dev/null 2>&1; then syft . -o spdx-json=dist/sbom.spdx.json -o cyclonedx-json=dist/sbom.cdx.json && echo "SBOM written to dist/"; else echo "syft not installed — release workflow generates the authoritative SBOM"; fi

clean: ## Remove caches/artifacts inside the workspace only (GR-031)
	find terraform -type d -name ".terraform" -exec rm -rf {} +
	find terraform -type f -name ".terraform.lock.hcl" -exec rm -f {} +
	find . -type d -name "__pycache__" -exec rm -rf {} +
	rm -rf dist

doctor: ## Foundation self-check: metadata invariants + guard-hook tests
	@bash scripts/template-check.sh
	@bash .claude/hooks/tests/guard-bash.test.sh

# ---------------------------------------------------------------------------
# Project extensions — GCP foundations workflow (Excel SSoT → generate → deploy)
# ---------------------------------------------------------------------------

check: ## Pre-flight check: GCP permissions, billing, APIs
	bash terraform/scripts/preflight_check.sh

template: ## Generate a blank gcp-foundations.xlsx (SSoT input) with dropdowns
	uv run terraform/scripts/generate_template.py

generate: ## Generate Terraform resources from gcp-foundations.xlsx, then format
	uv run terraform/scripts/generate_resources.py
	cd terraform && terraform fmt -recursive

opa: ## Policy syntax check only (also part of lint)
	opa check policies/*.rego

plan: ## Global deployment in plan-only mode
	@$(TEST_MODE_SH); bash terraform/scripts/deploy_all.sh --plan-only

deploy: ## Apply global deployment (agents: verify plan + human go-ahead first)
	@$(TEST_MODE_SH); bash terraform/scripts/deploy_all.sh

destroy: ## DANGEROUS (GR-031): requires allow_resource_destruction=true in common.tfvars AND explicit human approval. Options: DESTROY_ARGS="--from-layer=3"
	@$(TEST_MODE_SH); bash terraform/scripts/destroy_all.sh $(DESTROY_ARGS)

delivery: ## (構築ベンダー専用) Build delivery archive (zip) under delivery/ — original .git untouched
	@bash terraform/scripts/handover-wrap.sh

delivery-doc: ## Generate only the delivery document (構築設定明細書) under delivery/
	uv run terraform/scripts/generate_delivery.py

test-mode: ## Toggle test mode (random prefix & skip management projects)
	uv run python terraform/scripts/toggle_test_mode.py

prune: ## Remove orphan 4_projects/ directories not defined in the SSoT (Excel)
	uv run terraform/scripts/prune_orphans.py
