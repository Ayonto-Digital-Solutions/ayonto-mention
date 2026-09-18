#!/usr/bin/env python3
"""Tests for the version contract a release is held to.

The contract is the point of these tests. A Dataverse solution version has four
parts, a PCF control version has three, and neither is derived from the other —
so the pair that actually ships, a solution `1.1.0.1` carrying a control `1.1.0`,
has to be accepted, and each shape has to be rejected in the other's place.

The regression worth naming is the one this replaced: a release that took one
three-part number and appended `.0` to invent a solution version. That is why
the last test reads the workflow rather than the script. A checker that accepts
two versions proves nothing if the workflow still derives one of them.

Standard library only: this runs in CI beside the other checks, and a check that
needs installing is a check that gets skipped.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPOSITORY = SCRIPTS.parents[1]

# The script is named the way the workflow calls it, hyphens and all, so it is
# loaded by path rather than imported.
_specification = importlib.util.spec_from_file_location(
    "check_release_version", SCRIPTS / "check-release-version.py"
)
checker = importlib.util.module_from_spec(_specification)
_specification.loader.exec_module(checker)

MANIFEST = """<?xml version="1.0" encoding="utf-8" ?>
<manifest>
  <control namespace="Ayonto" constructor="MentionControl" version="{version}"
           display-name-key="Ayonto_Mention" control-type="virtual">
  </control>
</manifest>
"""


def build_repository(
    root: Path,
    package: str = "1.1.0",
    pcf_package: str = "1.1.0",
    manifest: str = "1.1.0",
) -> Path:
    """Writes the three files that declare the control version."""
    (root / "package.json").write_text(
        json.dumps({"name": "ayonto-mention", "version": package}), encoding="utf-8"
    )
    control = root / "pcf" / "MentionControl"
    control.mkdir(parents=True)
    (root / "pcf" / "package.json").write_text(
        json.dumps({"name": "pcf", "version": pcf_package}), encoding="utf-8"
    )
    (control / "ControlManifest.Input.xml").write_text(
        MANIFEST.format(version=manifest), encoding="utf-8"
    )
    return root


def run(root: Path, solution_version: str, control_version: str) -> tuple[int, str]:
    """Runs the checker the way the workflow does, and reports what it said."""
    argv = [
        "check-release-version.py",
        "--solution-version",
        solution_version,
        "--control-version",
        control_version,
        "--root",
        str(root),
    ]
    output = io.StringIO()
    original, sys.argv = sys.argv, argv
    try:
        with contextlib.redirect_stdout(output):
            code = checker.main()
    finally:
        sys.argv = original
    return code, output.getvalue()


class VersionContract(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_accepts_the_pair_that_ships(self) -> None:
        """A four-part solution carrying a three-part control: the normal case."""
        build_repository(self.root, "1.1.0", "1.1.0", "1.1.0")
        code, said = run(self.root, "1.1.0.1", "1.1.0")
        self.assertEqual(code, 0, said)
        self.assertIn("1.1.0.1", said)

    def test_accepts_versions_with_no_relationship(self) -> None:
        """The two are related by release, not by arithmetic."""
        build_repository(self.root, "1.1.0", "1.1.0", "1.1.0")
        code, said = run(self.root, "4.7.2.9", "1.1.0")
        self.assertEqual(code, 0, said)

    def test_rejects_a_three_part_solution_version(self) -> None:
        """A control version handed in as a solution version is not one."""
        build_repository(self.root)
        code, said = run(self.root, "1.1.0", "1.1.0")
        self.assertEqual(code, 1)
        self.assertIn("four-part", said)

    def test_rejects_a_four_part_control_version(self) -> None:
        """Semantic Versioning has three parts; a fourth is not one of them."""
        build_repository(self.root)
        code, said = run(self.root, "1.1.0.1", "1.1.0.1")
        self.assertEqual(code, 1)
        self.assertIn("three-part", said)

    def test_rejects_malformed_versions(self) -> None:
        build_repository(self.root)
        for solution, control in (
            ("1.1", "1.1.0"),
            ("1.1.0.0.1", "1.1.0"),
            ("v1.1.0.0", "1.1.0"),
            ("1.1.0.x", "1.1.0"),
            ("", "1.1.0"),
            ("1.1.0.0", "1.1"),
            ("1.1.0.0", "1.1.0-rc.1"),
            ("1.1.0.0", ""),
        ):
            with self.subTest(solution=solution, control=control):
                code, _ = run(self.root, solution, control)
                self.assertEqual(code, 1)

    def test_rejects_a_declaration_that_disagrees(self) -> None:
        """Three files name the control version, and all three have to agree."""
        for where in ("package", "pcf_package", "manifest"):
            with self.subTest(disagrees=where):
                with tempfile.TemporaryDirectory() as directory:
                    root = build_repository(Path(directory), **{where: "1.2.0"})
                    code, said = run(root, "1.1.0.1", "1.1.0")
                    self.assertEqual(code, 1)
                    self.assertIn("1.2.0", said)

    def test_rejects_a_repository_it_cannot_read(self) -> None:
        """Fail closed: an unreadable declaration is not an agreeing one."""
        code, said = run(self.root, "1.1.0.1", "1.1.0")
        self.assertEqual(code, 1)
        self.assertIn("::error::", said)


class ThisRepository(unittest.TestCase):
    def test_what_is_committed_passes(self) -> None:
        """The versions actually declared here, checked as the workflow does."""
        solution = re.search(
            r"<Version>([^<]*)</Version>",
            (REPOSITORY / "powerplatform/src/Other/Solution.xml").read_text(
                encoding="utf-8"
            ),
        )
        self.assertIsNotNone(solution)
        control = json.loads(
            (REPOSITORY / "package.json").read_text(encoding="utf-8")
        )["version"]
        code, said = run(REPOSITORY, solution.group(1), control)
        self.assertEqual(code, 0, said)


class NoDerivation(unittest.TestCase):
    """The release path names both versions; it does not compute either."""

    def setUp(self) -> None:
        self.workflow = (REPOSITORY / ".github/workflows/release.yml").read_text(
            encoding="utf-8"
        )

    def test_no_version_has_a_part_appended_to_it(self) -> None:
        derived = re.findall(r"\$\{\w*VERSION\w*\}\.\d+", self.workflow)
        self.assertEqual(derived, [], f"a version is still being derived: {derived}")

    def test_both_versions_are_named_separately(self) -> None:
        for flag in ("--solution-version", "--control-version"):
            self.assertTrue(flag in self.workflow, f"release.yml never passes {flag}")
        self.assertTrue(
            re.search(r'--version "\$\{SOLUTION_VERSION\}"', self.workflow),
            "the stamp step is not handed the solution version verbatim",
        )


if __name__ == "__main__":
    unittest.main()
