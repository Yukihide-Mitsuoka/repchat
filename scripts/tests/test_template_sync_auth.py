import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/template_sync_auth.py"


class TemplateSyncAuthTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.repository = Path(self.temporary_directory.name)
        manifest = self.repository / ".github/inheritance/manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(
            json.dumps({"parent": {"repository": "acme/parent"}}),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def run_validator(
        self,
        *,
        source: str = "acme/parent",
        mode: str = "public",
        has_client_id: str = "false",
        has_private_key: str = "false",
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(self.repository),
                "--source-repository",
                source,
                "--mode",
                mode,
                "--has-client-id",
                has_client_id,
                "--has-private-key",
                has_private_key,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_public_parent_returns_bounded_identity(self) -> None:
        result = self.run_validator()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {"mode": "public", "owner": "acme", "repository": "parent"},
        )

    def test_github_app_requires_both_configuration_entries(self) -> None:
        result = self.run_validator(mode="github-app", has_client_id="true")

        self.assertEqual(result.returncode, 2)
        self.assertIn("GitHub App source authentication is incomplete", result.stderr)

    def test_github_app_accepts_complete_configuration(self) -> None:
        result = self.run_validator(
            mode="github-app",
            has_client_id="true",
            has_private_key="true",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["mode"], "github-app")

    def test_source_must_match_declared_direct_parent(self) -> None:
        result = self.run_validator(source="acme/other")

        self.assertEqual(result.returncode, 2)
        self.assertIn("declared direct parent does not match", result.stderr)

    def test_source_rejects_output_injection_characters(self) -> None:
        result = self.run_validator(source="acme/parent\nother=value")

        self.assertEqual(result.returncode, 2)
        self.assertIn("must be one owner/repository value", result.stderr)

    def test_unknown_mode_is_rejected(self) -> None:
        result = self.run_validator(mode="pat")

        self.assertEqual(result.returncode, 2)
        self.assertIn("Unsupported Template Sync source authentication mode", result.stderr)

    def test_missing_manifest_is_rejected(self) -> None:
        (self.repository / ".github/inheritance/manifest.json").unlink()

        result = self.run_validator()

        self.assertEqual(result.returncode, 2)
        self.assertIn("requires a child inheritance manifest", result.stderr)


if __name__ == "__main__":
    unittest.main()
