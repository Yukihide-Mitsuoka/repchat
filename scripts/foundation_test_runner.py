#!/usr/bin/env python3
"""Run the foundation regression tests as explicit fast or slow suites."""

import argparse
import sys
import unittest
from pathlib import Path
from typing import Iterable


REPOSITORY_ROOT = Path(__file__).parents[1]
SLOW_TEST_MODULES = frozenset({"test_template_inheritance_plan"})
SUITES = ("all", "fast", "slow")


def belongs_to_suite(test_id: str, suite_name: str) -> bool:
    """Return whether a unittest ID belongs to the requested suite."""
    if suite_name not in SUITES:
        raise ValueError(f"unknown foundation test suite: {suite_name}")
    if suite_name == "all":
        return True

    is_slow = any(part in SLOW_TEST_MODULES for part in test_id.split("."))
    return is_slow if suite_name == "slow" else not is_slow


def iter_test_cases(suite: unittest.TestSuite) -> Iterable[unittest.TestCase]:
    """Flatten nested unittest suites without executing their fixtures."""
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from iter_test_cases(test)
        else:
            yield test


def load_suite(tests_directory: Path, suite_name: str) -> unittest.TestSuite:
    discovered = unittest.defaultTestLoader.discover(
        str(tests_directory), pattern="test_*.py"
    )
    return unittest.TestSuite(
        test
        for test in iter_test_cases(discovered)
        if belongs_to_suite(test.id(), suite_name)
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=SUITES, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    sys.path.insert(0, str(REPOSITORY_ROOT))
    tests_directory = Path(__file__).with_name("tests")
    suite = load_suite(tests_directory, args.suite)
    if suite.countTestCases() == 0:
        print(f"foundation {args.suite} suite selected no tests", file=sys.stderr)
        return 2
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
