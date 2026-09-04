import contextlib
import io
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from scripts import pr_language_policy as policy


ROOT = Path(__file__).resolve().parents[2]
JA = (
    "利用先の要件に合わせて設定の検証を追加し、"
    "不正な入力を安全に拒否するように変更しました。"
)
EN = "Validate repository configuration and reject invalid input before processing."


class PullRequestLanguageTest(unittest.TestCase):
    def evaluate(self, **overrides):
        values = dict(
            role="consumer",
            title="fix: 設定の検証を追加",
            body=JA,
            actor="contributor",
            labels=[],
        )
        values.update(overrides)
        return policy.evaluate(**values)

    def test_consumer_japanese_with_technical_evidence(self):
        self.assertEqual(
            [],
            self.evaluate(
                body=JA + "\n`parse_config` https://example.com\n> Original evidence"
            ),
        )
        self.assertEqual([], self.evaluate(title="fix(API): 入力検証"))
        self.assertTrue(self.evaluate(title="fix: validate input"))
        self.assertTrue(self.evaluate(body=EN))
        self.assertTrue(self.evaluate(title="設定の検証を追加"))

    def test_producer_english_and_original_language_evidence(self):
        values = dict(role="producer", title="fix: validate input", body=EN)
        self.assertEqual([], self.evaluate(**values))
        self.assertEqual(
            [], self.evaluate(**{**values, "body": EN + "\n> " + JA + "\n`日本語の製品名`"})
        )
        self.assertEqual(
            [], self.evaluate(**{**values, "body": EN + "\n``日本語の製品名``"})
        )
        self.assertTrue(self.evaluate(**{**values, "body": JA + EN}))
        self.assertTrue(self.evaluate(**{**values, "body": EN + "\n`" + JA}))
        self.assertTrue(self.evaluate(**{**values, "title": "fix: APIの入力を検証"}))

    def test_comments_code_and_controls_do_not_supply_prose(self):
        hidden = (f"<!-- {JA} -->", f"```md\n{JA}\n```", f"~~~~\n{JA}\n~~~\n{JA}",
                  f"`{JA}`", f"> {JA}", f"    {JA}", f"## {JA}", f"- [x] {JA}", f"| {JA} |")
        for body in hidden:
            with self.subTest(body=body):
                self.assertTrue(self.evaluate(body=body))
        self.assertEqual([], self.evaluate(body=f"```text\nhidden\n```\n{JA}"))

    def test_empty_actual_template_fails_for_both_roles(self):
        template = (ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text()
        self.assertTrue(self.evaluate(body=template))
        self.assertTrue(self.evaluate(role="producer", title="fix: validate input", body=template))

    def test_exact_automation_identity_only(self):
        for actor in policy.TRUSTED_ACTORS:
            self.assertEqual([], self.evaluate(actor=actor, title="automated update", body=EN))
        for actor in ("github-actions", "dependabot", "github-actions[bot]-fake", "contributor"):
            self.assertTrue(
                self.evaluate(
                    actor=actor,
                    body="github-actions[bot] chore/template_sync_abc " + EN,
                )
            )

    def test_exceptions_require_label_and_visible_reason(self):
        exception = EN + "\n## Language exception\nExternal reviewer requires English."
        self.assertTrue(self.evaluate(body=exception))
        self.assertEqual([], self.evaluate(labels=[policy.EXCEPTION_LABEL], body=exception))
        for content in ("", "<!-- External reviewer -->", "```\nExternal reviewer\n```"):
            self.assertTrue(
                self.evaluate(
                    labels=[policy.EXCEPTION_LABEL],
                    body=EN + "\n## 言語例外\n" + content,
                )
            )
        self.assertTrue(
            self.evaluate(
                labels=[policy.EXCEPTION_LABEL], body=EN + "\n## 言語例外\nshort"
            )
        )
        for hidden in (
            f"```\n{exception}\n```",
            f"<!-- {exception} -->",
            "> ## Language exception\n> Evidence",
        ):
            self.assertTrue(self.evaluate(labels=[policy.EXCEPTION_LABEL], body=hidden))

    def test_invalid_inputs_fail_even_for_automation(self):
        for overrides in (
            dict(role=""), dict(labels={}), dict(labels=[None]),
            dict(labels=["x"] * 101), dict(title=""), dict(actor=""),
            dict(title="x" * 257), dict(body="x" * 65537),
        ):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.evaluate(
                    **{**overrides, "actor": overrides.get("actor", "github-actions[bot]")}
                )
        self.assertTrue(self.evaluate(body=""))
        self.assertEqual([], self.evaluate(actor="github-actions[bot]", body=""))

    def test_cli_missing_or_malformed_metadata_fails_closed(self):
        valid = dict(
            PR_ROLE="consumer", PR_TITLE="fix: 入力を検証", PR_BODY=JA,
            PR_AUTHOR="contributor", PR_LABELS_JSON="[]",
        )
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, policy.main(valid))
            self.assertEqual(1, policy.main({**valid, "PR_BODY": EN}))
            for key in valid:
                missing = {name: value for name, value in valid.items() if name != key}
                self.assertEqual(2, policy.main(missing))
            for labels in ("invalid", "{}", "[null]", "x" * 20001):
                self.assertEqual(2, policy.main({**valid, "PR_LABELS_JSON": labels}))

    def test_real_cli_treats_shell_text_as_data(self):
        environment = {
            **os.environ, "PR_ROLE": "producer", "PR_TITLE": "fix: validate input",
            "PR_BODY": EN + "\n`$(exit 73)`", "PR_AUTHOR": "contributor",
            "PR_LABELS_JSON": json.dumps([]),
        }
        result = subprocess.run(
            [sys.executable, "-m", "scripts.pr_language_policy"], cwd=ROOT,
            env=environment, text=True, capture_output=True, check=False,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertNotIn("exit 73", result.stdout)

    def test_foundation_caller_uses_base_code_role_and_event_metadata(self):
        # The caller is protected; descendants port it separately, not by test failure.
        readme = (ROOT / "README.md").read_text()
        marker = "<!-- repository-readme-owner: Yukihide-Mitsuoka/ai-dev-foundation -->"
        if marker not in readme:
            self.skipTest(
                "Foundation caller assertion; downstream protected caller needs reviewed port"
            )
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        required_fragments = (
            "ref: ${{ github.event.pull_request.base.sha }}",
            "working-directory: .pr-language-base",
            "PR_ROLE: ${{ steps.pr-role.outputs.role }}",
            "PR_AUTHOR: ${{ github.event.pull_request.user.login }}",
            "python3 -m scripts.pr_language_policy",
            "edited, labeled, unlabeled",
        )
        for required in required_fragments:
            self.assertIn(required, workflow)
        validation_step = workflow.split(
            "- name: Validate PR prose language (ADR-0020/0021)", 1
        )[1]
        self.assertIn("working-directory: .pr-language-base", validation_step)
        self.assertNotIn("pull_request_target:", workflow)
        for line in workflow.splitlines():
            if any(
                expression in line
                for expression in (
                    "${{ github.event.pull_request.title }}",
                    "${{ github.event.pull_request.body }}",
                )
            ):
                self.assertTrue(line.strip().startswith(("PR_TITLE:", "PR_BODY:")))


if __name__ == "__main__":
    unittest.main()
