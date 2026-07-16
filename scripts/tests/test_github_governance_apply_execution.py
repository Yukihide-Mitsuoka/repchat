import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).parents[2]
MODULE_PATH = ROOT / "scripts/github_governance.py"
SPEC = importlib.util.spec_from_file_location("github_governance_apply_execution", MODULE_PATH)
governance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(governance)


def action(action_id, control_id):
    return {
        "body": {"enabled": True},
        "endpoint": f"repos/acme/demo/settings/{action_id}",
        "id": action_id,
        "method": "PATCH",
        "side_effects": [],
        "verify_controls": [control_id],
    }


def report(statuses):
    return {
        "controls": [
            {"id": control_id, "status": status}
            for control_id, status in statuses.items()
        ],
        "repository": "acme/demo",
        "schema_version": 1,
        "status": "compliant" if set(statuses.values()) == {"compliant"} else "drift",
    }


def apply_plan(actions):
    return {
        "actions": actions,
        "before_status": "drift",
        "repository": "acme/demo",
        "schema_version": 1,
        "status": "ready" if actions else "compliant",
        "target_branch": "main",
    }


def completed_runner(returncode=0, stderr=""):
    result = subprocess.CompletedProcess([], returncode=returncode, stdout="{}", stderr=stderr)
    return mock.Mock(return_value=result)


class ApplyExecutionTest(unittest.TestCase):
    def test_write_uses_versioned_gh_api_and_json_stdin(self):
        runner = completed_runner()

        governance._gh_write_action(action("first", "control.first"), runner)

        command = runner.call_args.args[0]
        self.assertEqual(command[:4], ["gh", "api", "--method", "PATCH"])
        self.assertIn(f"X-GitHub-Api-Version: {governance.API_VERSION}", command)
        self.assertEqual(command[-3:], ["repos/acme/demo/settings/first", "--input", "-"])
        self.assertEqual(runner.call_args.kwargs["input"], '{"enabled":true}')
        self.assertNotIn("shell", runner.call_args.kwargs)

    def test_write_failure_does_not_expose_github_stderr(self):
        runner = completed_runner(1, "token ghp_sensitive")

        with self.assertRaisesRegex(governance.PolicyError, "GitHub write failed") as raised:
            governance._gh_write_action(action("first", "control.first"), runner)

        self.assertNotIn("ghp_sensitive", str(raised.exception))

    def test_actions_are_written_and_verified_one_at_a_time(self):
        actions = [action("first", "control.first"), action("second", "control.second")]
        plan = apply_plan(actions)
        inventories = iter(({"step": 1}, {"step": 2}))
        discoverer = mock.Mock(side_effect=lambda *_args, **_kwargs: next(inventories))
        runner = completed_runner()
        refreshed_second = action("second", "control.second")
        refreshed_second["body"] = {"enabled": "refreshed"}
        second_plan = {**plan, "actions": [refreshed_second]}
        complete_plan = {**plan, "actions": [], "status": "compliant"}

        with (
            mock.patch.object(
                governance,
                "build_apply_actions",
                side_effect=[plan, second_plan, complete_plan],
            ) as planner,
            mock.patch.object(
                governance,
                "compare_governance",
                side_effect=lambda _policy, inventory: {
                    "before": report({"control.first": "drift", "control.second": "drift"}),
                    1: report({"control.first": "compliant", "control.second": "drift"}),
                    2: report({"control.first": "compliant", "control.second": "compliant"}),
                }[inventory.get("step", "before")],
            ),
        ):
            result = governance.execute_apply(
                {}, {"initial": True}, "acme/demo", runner=runner, discoverer=discoverer
            )

        self.assertEqual(result["status"], "compliant")
        self.assertEqual(result["attempted_actions"], ["first", "second"])
        self.assertEqual(result["verified_actions"], ["first", "second"])
        self.assertEqual(runner.call_count, 2)
        self.assertEqual(discoverer.call_count, 2)
        self.assertEqual(planner.call_count, 3)
        self.assertEqual(runner.call_args_list[1].kwargs["input"], '{"enabled":"refreshed"}')

    def test_failed_verification_stops_before_the_next_write(self):
        actions = [action("first", "control.first"), action("second", "control.second")]
        plan = apply_plan(actions)
        runner = completed_runner()

        with (
            mock.patch.object(governance, "build_apply_actions", return_value=plan),
            mock.patch.object(
                governance,
                "compare_governance",
                side_effect=[
                    report({"control.first": "drift", "control.second": "drift"}),
                    report({"control.first": "drift", "control.second": "drift"}),
                ],
            ),
            self.assertRaises(governance.ApplyFailure) as raised,
        ):
            governance.execute_apply(
                {},
                {"initial": True},
                "acme/demo",
                runner=runner,
                discoverer=mock.Mock(return_value={"step": 1}),
            )

        self.assertEqual(runner.call_count, 1)
        self.assertEqual(raised.exception.evidence["failed_action"], "first")
        self.assertEqual(raised.exception.evidence["failure_phase"], "verification")
        self.assertEqual(raised.exception.evidence["verified_actions"], [])

    def test_write_or_read_back_failure_stops_immediately(self):
        plan = apply_plan(
            [action("first", "control.first"), action("second", "control.second")]
        )
        before = report({"control.first": "drift", "control.second": "drift"})
        cases = (
            (
                "write",
                mock.Mock(
                    return_value=subprocess.CompletedProcess(
                        [], returncode=1, stdout="", stderr="sensitive"
                    )
                ),
                mock.Mock(),
            ),
            (
                "read_back",
                mock.Mock(
                    return_value=subprocess.CompletedProcess(
                        [], returncode=0, stdout="{}", stderr=""
                    )
                ),
                mock.Mock(side_effect=governance.PolicyError("read failed")),
            ),
        )
        for phase, runner, discoverer in cases:
            with (
                self.subTest(phase=phase),
                mock.patch.object(governance, "build_apply_actions", return_value=plan),
                mock.patch.object(governance, "compare_governance", return_value=before),
                self.assertRaises(governance.ApplyFailure) as raised,
            ):
                governance.execute_apply(
                    {}, {}, "acme/demo", runner=runner, discoverer=discoverer
                )

            self.assertEqual(runner.call_count, 1)
            self.assertEqual(raised.exception.evidence["failure_phase"], phase)
            self.assertEqual(raised.exception.evidence["attempted_actions"], ["first"])
            self.assertEqual(raised.exception.evidence["verified_actions"], [])
            if phase == "write":
                discoverer.assert_not_called()
            else:
                discoverer.assert_called_once()

    def test_repeated_action_after_replanning_is_not_retried(self):
        plan = apply_plan([action("first", "control.first")])
        runner = completed_runner()
        with (
            mock.patch.object(governance, "build_apply_actions", side_effect=[plan, plan]),
            mock.patch.object(
                governance,
                "compare_governance",
                side_effect=[
                    report({"control.first": "drift"}),
                    report({"control.first": "compliant"}),
                ],
            ),
            self.assertRaises(governance.ApplyFailure) as raised,
        ):
            governance.execute_apply(
                {}, {}, "acme/demo", runner=runner, discoverer=mock.Mock(return_value={})
            )

        self.assertEqual(runner.call_count, 1)
        self.assertEqual(raised.exception.evidence["failure_phase"], "replanning")

    def test_confirmation_mismatch_blocks_all_writes_and_reads(self):
        runner = mock.Mock()
        discoverer = mock.Mock()
        plan = apply_plan([action("first", "control.first")])

        with (
            mock.patch.object(governance, "build_apply_actions", return_value=plan),
            self.assertRaisesRegex(governance.PolicyError, "confirmation"),
        ):
            governance.execute_apply(
                {}, {}, "acme/other", runner=runner, discoverer=discoverer
            )

        runner.assert_not_called()
        discoverer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
