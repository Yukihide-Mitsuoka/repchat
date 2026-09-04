"""Bounded PR prose checks (ADR-0020/0021), not a natural-language classifier."""

import json
import os
import re


TRUSTED_ACTORS = frozenset({"dependabot[bot]", "github-actions[bot]"})
EXCEPTION_LABEL = "language-exception-approved"
JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")
KANA = re.compile(r"[\u3040-\u30ff]")
LATIN = re.compile(r"[A-Za-z]")
WORDS = re.compile(r"\b[A-Za-z]{2,}\b")
TITLE = re.compile(r"^[a-z][a-z0-9-]*(?:\([^\r\n()]+\))?!?:\s+(\S[^\r\n]*)$")
COMMENT = re.compile(r"<!--.*?(?:-->|\Z)", re.DOTALL)
URL = re.compile(r"https?://\S+")
FIXED_LINE = re.compile(r"^(?:#{1,6}\s|[-*]\s+\[[ xX]\]|\||>|Refs:\s*#?\d*\s*$)")
EMPTY_FIELD = re.compile(r"^[-*]\s+[^:：]+[:：]\s*$")
EXCEPTION = re.compile(
    r"^##\s+(?:Language exception|言語例外)\s*\n(.*?)(?=^#{1,2}\s|\Z)",
    re.MULTILINE | re.DOTALL | re.IGNORECASE,
)


def _prose_lines(markdown):
    fence = None
    for line in COMMENT.sub("", markdown).splitlines():
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if marker:
            run, tail = marker.groups()
            if fence is None:
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence) and not tail.strip():
                fence = None
            continue
        if fence or line.startswith(("    ", "\t")):
            continue
        yield line.strip()


def _without_inline_code(text):
    """Remove closed inline-code spans in one pass; retain malformed spans as prose."""
    delimiter = None
    output = []
    pending = []
    for part in re.split(r"(`+)", text):
        if part.startswith("`"):
            if delimiter is None:
                delimiter = part
                pending = [part]
            elif part == delimiter:
                delimiter = None
                pending = []
            else:
                pending.append(part)
        elif delimiter is None:
            output.append(part)
        else:
            pending.append(part)
    output.extend(pending)
    return "".join(output)


def visible_prose(markdown):
    """Remove non-authored template controls and technical/quoted evidence."""
    lines = []
    for text in _prose_lines(markdown):
        if not FIXED_LINE.match(text) and not EMPTY_FIELD.fullmatch(text):
            lines.append(URL.sub("", _without_inline_code(text)))
    return "\n".join(lines)


def evaluate(role, title, body, actor, labels):
    """Return actionable errors. Role is supplied by the accepted-base CI step."""
    if role not in {"producer", "consumer"}:
        raise ValueError("PR_ROLE must be producer or consumer")
    if not isinstance(labels, list) or len(labels) > 100 or any(
        not isinstance(label, str) or len(label) > 100 for label in labels
    ):
        raise ValueError("PR_LABELS_JSON must contain at most 100 string labels")
    for name, value, limit in (("title", title, 256), ("author", actor, 100)):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError(f"PR {name} must be nonempty and within its size limit")
    if not isinstance(body, str) or len(body) > 65536:
        raise ValueError("PR body must be a string within its size limit")
    if actor in TRUSTED_ACTORS:
        return []
    if EXCEPTION_LABEL in labels:
        reason = EXCEPTION.search("\n".join(_prose_lines(body)))
        if reason and len(re.findall(r"[A-Za-z\u3040-\u9fff]", visible_prose(reason[1]))) >= 10:
            return []
        return [
            "Language exception needs a visible reason under "
            "## Language exception or ## 言語例外."
        ]
    match = TITLE.fullmatch(title)
    summary = visible_prose(match[1]) if match else ""
    prose = visible_prose(body)
    errors = []
    if role == "consumer":
        if len(JAPANESE.findall(summary)) < 2:
            errors.append(
                "Consumer title: use a Conventional Commit prefix and a Japanese summary."
            )
        if len(JAPANESE.findall(prose)) < 20 or not KANA.search(prose):
            errors.append(
                "Consumer body: add at least 20 Japanese prose characters, including kana."
            )
    else:
        if len(WORDS.findall(summary)) < 2 or JAPANESE.search(summary):
            errors.append(
                "Producer title: use a Conventional Commit prefix and an English summary."
            )
        if (
            len(LATIN.findall(prose)) < 20
            or len(WORDS.findall(prose)) < 3
            or JAPANESE.search(prose)
        ):
            errors.append(
                "Producer body: write English prose; quote or backtick original-language evidence."
            )
    return errors


def main(environment=None):
    environment = os.environ if environment is None else environment
    names = ("PR_ROLE", "PR_TITLE", "PR_BODY", "PR_AUTHOR", "PR_LABELS_JSON")
    try:
        if any(name not in environment for name in names):
            raise ValueError("required PR metadata environment input is missing")
        raw_labels = environment["PR_LABELS_JSON"]
        if len(raw_labels) > 20000:
            raise ValueError("PR_LABELS_JSON exceeds the input limit")
        errors = evaluate(*(environment[name] for name in names[:-1]), json.loads(raw_labels))
    except (ValueError, TypeError) as error:
        # JSON errors can contain fragments of PR metadata; never echo them to logs.
        message = (
            "PR_LABELS_JSON is invalid JSON"
            if isinstance(error, json.JSONDecodeError)
            else str(error)
        )
        print(f"::error::{message}")
        return 2
    for error in errors:
        print(f"::error::{error}")
    if errors:
        return 1
    print("PR-language policy: satisfied or explicitly exempted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
