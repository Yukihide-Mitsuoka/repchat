# Temporary ADR-0024 compatibility entry. Taskfile.yml owns every implementation.
# Remove after local callers and downstream consumers use task directly.

.PHONY: help setup format lint test test-unit test-integration coverage build run \
        security-scan sbom clean doctor doctor-slow infra-plan deploy destroy

FILE ?=
export FILE

help setup test test-unit test-integration coverage build run security-scan sbom clean \
doctor doctor-slow infra-plan deploy destroy:
	@task "$@"

format lint:
	@task "$@" FILE="$${FILE}"
