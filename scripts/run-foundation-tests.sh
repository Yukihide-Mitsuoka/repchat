#!/usr/bin/env bash
# Run the Foundation regression suite selected by a bounded repository-owned contract.

set -u

suite="${FOUNDATION_TEST_SUITE:-all}"

case "$suite" in
  all)
    exec python3 -m unittest discover -s scripts/tests -p 'test_*.py'
    ;;
  fast | slow)
    runner="scripts/foundation_test_runner.py"
    if [ ! -f "$runner" ]; then
      echo "foundation tests: FOUNDATION_TEST_SUITE=$suite requires $runner" >&2
      exit 2
    fi
    exec python3 "$runner" --suite "$suite"
    ;;
  *)
    echo "foundation tests: invalid FOUNDATION_TEST_SUITE=$suite; expected all, fast, or slow" >&2
    exit 2
    ;;
esac
