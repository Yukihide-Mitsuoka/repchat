import re
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
FOUNDATION_DOCS = REPOSITORY_ROOT / "docs" / "foundation"
APPROVED_JAPANESE_DOCS = {
    FOUNDATION_DOCS / "guides" / "usage.ja.md",
    FOUNDATION_DOCS / "guides" / "ai-instruction-files.ja.md",
}
IMMUTABLE_HISTORICAL_RECORD = (
    FOUNDATION_DOCS / "adr" / "0002-ai-facing-docs-in-english.md"
)
JAPANESE_SCRIPT = re.compile(r"[ぁ-ゖァ-ヺ一-龯]")


def find_japanese_documents(root: Path) -> set[Path]:
    return set(root.rglob("*.ja.md"))


class FoundationDocumentLanguageTest(unittest.TestCase):
    def test_only_owner_approved_japanese_documents_exist(self):
        actual = find_japanese_documents(FOUNDATION_DOCS)

        self.assertEqual(APPROVED_JAPANESE_DOCS, actual)

    def test_an_additional_localized_document_is_outside_the_allowlist(self):
        candidate = FOUNDATION_DOCS / "guides" / "third-guide.ja.md"

        self.assertNotIn(candidate, APPROVED_JAPANESE_DOCS)

    def test_approved_japanese_documents_are_present(self):
        for path in APPROVED_JAPANESE_DOCS:
            with self.subTest(path=path.relative_to(REPOSITORY_ROOT)):
                self.assertTrue(path.is_file())

    def test_other_foundation_documents_contain_no_japanese_script(self):
        excluded = APPROVED_JAPANESE_DOCS | {IMMUTABLE_HISTORICAL_RECORD}

        for path in FOUNDATION_DOCS.rglob("*.md"):
            if path in excluded:
                continue
            with self.subTest(path=path.relative_to(REPOSITORY_ROOT)):
                content = path.read_text(encoding="utf-8")
                self.assertIsNone(JAPANESE_SCRIPT.search(content))


if __name__ == "__main__":
    unittest.main()
