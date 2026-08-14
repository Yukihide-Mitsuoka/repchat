import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
RENOVATE_CONFIG = REPOSITORY_ROOT / "renovate.json"
DEPENDABOT_CONFIG = REPOSITORY_ROOT / ".github" / "dependabot.yml"


class DependencyUpdateAutomationTest(unittest.TestCase):
    def test_renovate_is_the_only_version_update_configuration(self):
        self.assertTrue(RENOVATE_CONFIG.is_file())
        self.assertFalse(
            DEPENDABOT_CONFIG.exists(),
            "Renovate is authoritative; a Dependabot version-update file creates a "
            "second provider and must contain a non-empty updates list to be valid",
        )


if __name__ == "__main__":
    unittest.main()
