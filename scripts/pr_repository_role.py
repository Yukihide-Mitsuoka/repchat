"""Resolve ADR-0021 roles from a caller-selected, reviewed contract checkout.

No network or writes. Callers must select the accepted base checkout, not PR-head
metadata, so adding an export in a PR cannot change that PR's language requirement.
"""

from pathlib import Path

from scripts import template_inheritance as inheritance


def _export_paths(root):
    foundation = root / inheritance.FOUNDATION_BOOTSTRAP_EXPORT_PATH
    paths = [foundation] if foundation.exists() or foundation.is_symlink() else []
    templates = root / ".ai/contracts/templates"
    if templates.exists() or templates.is_symlink():
        # Inspect only the two owner-qualified directory levels, including symlinks
        # that globbing might otherwise silently omit. Bound malformed input work.
        pending = [(templates, 0)]
        inspected = 0
        while pending:
            directory, depth = pending.pop()
            if inspected > 256 or directory.resolve() != directory or not directory.is_dir():
                raise inheritance.InheritanceError("unsafe or excessive template export directories")
            for child in directory.iterdir():
                inspected += 1
                if inspected > 256:
                    raise inheritance.InheritanceError("excessive template export entries")
                if child.name == "inheritance-export.json":
                    if depth != 2:
                        raise inheritance.InheritanceError("template export must be owner-qualified")
                    paths.append(child)
                elif depth < 2 and (child.is_dir() or child.is_symlink()):
                    pending.append((child, depth + 1))
    return sorted(path.relative_to(root).as_posix() for path in paths)


def _validated_export(root, path):
    document = inheritance._read_json(root, path)
    if not isinstance(document, dict):
        raise inheritance.InheritanceError("inheritance export must be an object")
    repository = inheritance._repository(document.get("repository"), "export.repository")
    owner_root = f".ai/contracts/templates/{repository.casefold()}/"
    if path != inheritance.FOUNDATION_BOOTSTRAP_EXPORT_PATH and path != owner_root + "inheritance-export.json":
        raise inheritance.InheritanceError("template export path must match repository identity")
    export = inheritance._validate_bootstrap_export(path, document, repository)
    inputs = export["agent_inputs"]
    if type(inputs) is not list or not 1 <= len(inputs) < inheritance.MAX_AGENT_INPUTS:
        raise inheritance.InheritanceError("export agent_inputs must be a bounded nonempty list")
    repositories, input_paths = [], []
    for index, item in enumerate(inputs):
        inheritance._object(item, {"layer", "repository", "path"}, "export agent input")
        identity = inheritance._repository(item["repository"], "export agent repository").casefold()
        expected_layer = "foundation" if index == 0 else "template"
        expected_root = ".ai/contracts/foundation/" if index == 0 else f".ai/contracts/templates/{identity}/"
        input_path = inheritance._ownership_root(item["path"], "export agent path", file_only=True)
        if item["layer"] != expected_layer or not input_path.startswith(expected_root):
            raise inheritance.InheritanceError("export agent input layer or path is inconsistent")
        inheritance._require_regular_file(root, input_path, "export agent input")
        if not inheritance._owned_by(input_path, export["inherited_paths"]):
            raise inheritance.InheritanceError("export agent input must be inherited")
        repositories.append(identity)
        input_paths.append(input_path)
    if len(set(repositories)) != len(inputs) or len(set(input_paths)) != len(inputs):
        raise inheritance.InheritanceError("duplicate export agent inputs")
    if repositories[-1] != repository.casefold():
        raise inheritance.InheritanceError("export final agent input must match its repository")
    if (path == inheritance.FOUNDATION_BOOTSTRAP_EXPORT_PATH) != (len(inputs) == 1):
        raise inheritance.InheritanceError("foundation and template exports have distinct input layers")
    return repository.casefold()


def resolve_role(root: Path, repository: str) -> str:
    """Return producer/consumer; malformed or contradictory evidence raises ValueError.

This validates local ownership evidence, not remote origin or inherited file drift.
The caller supplies the actual GitHub repository identity and accepted base checkout.
"""
    repository = inheritance._repository(repository, "current repository").casefold()
    root = Path(root).resolve(strict=True)
    manifest = root / inheritance.MANIFEST_PATH
    contract = None
    if manifest.exists() or manifest.is_symlink():
        contract = inheritance.validate_inheritance(root)
        if contract["parent"]["repository"].casefold() == repository:
            raise inheritance.InheritanceError("repository cannot inherit from itself")
        inputs = contract.get("agent_contract", {}).get("inputs")
        if inputs and inputs[-1]["repository"].casefold() != repository:
            raise inheritance.InheritanceError("project profile identity must match current repository")
    exports = [_validated_export(root, path) for path in _export_paths(root)]
    if len(set(exports)) != len(exports):
        raise inheritance.InheritanceError("duplicate repository inheritance exports")
    if repository in exports:
        return "producer"
    if contract is not None:
        return "consumer"
    raise inheritance.InheritanceError("no validated producer or consumer role evidence")
