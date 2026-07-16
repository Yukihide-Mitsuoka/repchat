import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).parents[2]
MODULE_PATH = ROOT / "scripts/github_governance.py"
SPEC = importlib.util.spec_from_file_location("github_governance_cli", MODULE_PATH)
governance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(governance)


class GovernanceCliTest(unittest.TestCase):
    def run_cli(self, command, status="compliant"):
        report = {"repository": "acme/demo", "status": status}
        stdout = io.StringIO()
        with (
            mock.patch.object(
                governance,
                "discover_github",
                return_value={"inventory": True},
            ) as discover,
            mock.patch.object(governance, "compare_governance", return_value=report),
            contextlib.redirect_stdout(stdout),
        ):
            exit_code = governance.main([command, "--root", str(ROOT), "--repo", "acme/demo"])
        return exit_code, json.loads(stdout.getvalue()), discover

    def test_plan_reports_drift_without_failing(self):
        exit_code, report, discover = self.run_cli("plan", "drift")

        self.assertEqual(exit_code, 0)
        self.assertEqual(report["status"], "drift")
        discover.assert_called_once_with("acme/demo", "main")

    def test_audit_exit_code_distinguishes_compliance_from_incomplete_audit(self):
        for status, expected in (("compliant", 0), ("drift", 1), ("unknown", 1)):
            with self.subTest(status=status):
                exit_code, report, _ = self.run_cli("audit", status)
                self.assertEqual(exit_code, expected)
                self.assertEqual(report["status"], status)

    def test_github_read_failure_returns_policy_error_exit(self):
        stderr = io.StringIO()
        with (
            mock.patch.object(
                governance,
                "discover_github",
                side_effect=governance.PolicyError("read failed"),
            ),
            contextlib.redirect_stderr(stderr),
        ):
            exit_code = governance.main(
                ["audit", "--root", str(ROOT), "--repo", "acme/demo"]
            )

        self.assertEqual(exit_code, 2)
        self.assertIn("governance policy error: read failed", stderr.getvalue())

    def test_online_commands_require_explicit_repository(self):
        for command in ("plan", "audit", "apply"):
            with self.subTest(command=command), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    governance.main([command, "--root", str(ROOT)])
                self.assertEqual(raised.exception.code, 2)

    def test_apply_requires_exact_confirmation_before_discovery(self):
        for confirmation in (None, "acme/other"):
            arguments = ["apply", "--root", str(ROOT), "--repo", "acme/demo"]
            if confirmation:
                arguments.extend(("--confirm-repo", confirmation))
            stderr = io.StringIO()
            with (
                self.subTest(confirmation=confirmation),
                mock.patch.object(governance, "discover_github") as discover,
                contextlib.redirect_stderr(stderr),
                self.assertRaises(SystemExit) as raised,
            ):
                governance.main(arguments)
            self.assertEqual(raised.exception.code, 2)
            self.assertIn("--confirm-repo must exactly match --repo", stderr.getvalue())
            discover.assert_not_called()

    def test_apply_emits_success_or_partial_failure_evidence(self):
        cases = (
            ({"repository": "acme/demo", "status": "compliant"}, 0, None),
            (
                {"failed_action": "branch.ruleset", "status": "failed"},
                2,
                "verification failed",
            ),
        )
        for evidence, expected_exit, error in cases:
            stdout = io.StringIO()
            stderr = io.StringIO()
            effect = governance.ApplyFailure(error, evidence) if error else evidence
            with (
                self.subTest(error=error),
                mock.patch.object(
                    governance, "discover_github", return_value={"inventory": True}
                ),
                mock.patch.object(
                    governance,
                    "execute_apply",
                    side_effect=effect if error else None,
                    return_value=None if error else effect,
                ) as execute,
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                exit_code = governance.main(
                    [
                        "apply",
                        "--root",
                        str(ROOT),
                        "--repo",
                        "acme/demo",
                        "--confirm-repo",
                        "acme/demo",
                    ]
                )

            self.assertEqual(exit_code, expected_exit)
            self.assertEqual(json.loads(stdout.getvalue()), evidence)
            execute.assert_called_once_with(mock.ANY, {"inventory": True}, "acme/demo")
            if error:
                self.assertIn("governance apply error: verification failed", stderr.getvalue())

    def test_validate_remains_offline_and_loads_profiles(self):
        profile = {
            "schema_version": 1,
            "id": "terraform-gcp",
            "parent": "ai-dev-foundation",
            "required_checks": ["iac-scan"],
        }
        stdout = io.StringIO()
        with (
            mock.patch.object(governance, "discover_github") as discover,
            mock.patch.object(governance, "_load_profiles", return_value=[profile]) as load,
            contextlib.redirect_stdout(stdout),
        ):
            exit_code = governance.main(["validate", "--root", str(ROOT)])

        self.assertEqual(exit_code, 0)
        report = json.loads(stdout.getvalue())
        self.assertEqual(report["profiles"], [profile])
        self.assertIn("iac-scan", report["settings"]["required_checks"])
        load.assert_called_once_with(ROOT)
        discover.assert_not_called()


if __name__ == "__main__":
    unittest.main()
