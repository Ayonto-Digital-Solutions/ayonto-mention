#!/usr/bin/env python3
"""Tests for the version contract a release is held to.

The contract is the point of these tests. A Dataverse solution version has four
parts, a PCF control version has three, and neither is derived from the other —
so the pair that actually ships, a solution `1.1.0.1` carrying a control `1.1.0`,
has to be accepted, and each shape has to be rejected in the other's place.

Two regressions are worth naming, because both are ways a release can ship a
version nobody reviewed.

The first is the one this replaced: a release that took one three-part number and
appended `.0` to invent a solution version.

The second is subtler and is why the committed manifest is checked at all. A tag
`v1.1.0.1` pushed at a commit whose `Solution.xml` still says `1.1.0.0` would
otherwise have been stamped into the manifest on the way past and published — a
solution version that existed nowhere in the reviewed source. A tag names a
release; it does not decide what version that release carries.

That is also why the last tests read the workflow rather than the script. A
checker that holds the line proves nothing if the workflow derives a version
behind its back, or stamps the manifest before asking.

Standard library only: this runs in CI beside the other checks, and a check that
needs installing is a check that gets skipped.
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPOSITORY = SCRIPTS.parents[1]

# The script is named the way the workflow calls it, hyphens and all, so it is
# loaded by path rather than imported.
#
# Compiled and executed here rather than through a file loader, because a file
# loader writes and reuses a bytecode cache — and a stale one reports on a
# previous version of the script while the source on disk says something else.
# CI checks out fresh and would never see it; anyone editing the checker locally
# would, and the failure looks like a bad test rather than a stale cache.
CHECKER = SCRIPTS / "check-release-version.py"
checker = types.ModuleType("check_release_version")
checker.__file__ = str(CHECKER)
exec(  # noqa: S102 — the file under test, read from disk on every run
    compile(CHECKER.read_text(encoding="utf-8"), str(CHECKER), "exec"),
    checker.__dict__,
)

SOLUTION = """<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml>
  <SolutionManifest>
    <UniqueName>AyontoMention</UniqueName>
{version}  </SolutionManifest>
</ImportExportXml>
"""

MANIFEST = """<?xml version="1.0" encoding="utf-8" ?>
<manifest>
  <control namespace="Ayonto" constructor="MentionControl" version="{version}"
           display-name-key="Ayonto_Mention" control-type="virtual">
  </control>
</manifest>
"""


def build_repository(
    root: Path,
    solution: str | None = "1.1.0.0",
    package: str = "1.1.0",
    pcf_package: str = "1.1.0",
    manifest: str = "1.1.0",
    write_solution: bool = True,
) -> Path:
    """Writes the four files that declare a version.

    `solution=None` writes a manifest with no <Version> element at all;
    `write_solution=False` leaves the file out entirely.
    """
    if write_solution:
        element = "" if solution is None else f"    <Version>{solution}</Version>\n"
        directory = root / "powerplatform" / "src" / "Other"
        directory.mkdir(parents=True)
        (directory / "Solution.xml").write_text(
            SOLUTION.format(version=element), encoding="utf-8"
        )
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
        build_repository(self.root, solution="1.1.0.1")
        code, said = run(self.root, "1.1.0.1", "1.1.0")
        self.assertEqual(code, 0, said)
        self.assertIn("1.1.0.1", said)

    def test_accepts_versions_with_no_relationship(self) -> None:
        """The two are related by release, not by arithmetic."""
        build_repository(self.root, solution="4.7.2.9")
        code, said = run(self.root, "4.7.2.9", "1.1.0")
        self.assertEqual(code, 0, said)

    def test_rejects_a_solution_version_that_is_not_committed(self) -> None:
        """The regression this closes.

        A tag `v1.1.0.1` or a dispatch input `1.1.0.1`, at a commit whose manifest
        still declares 1.1.0.0. The shape is perfectly valid; the version is one
        nobody reviewed, and the build has to stop before it is stamped in.
        """
        build_repository(self.root, solution="1.1.0.0")
        code, said = run(self.root, "1.1.0.1", "1.1.0")
        self.assertEqual(code, 1)
        self.assertIn("declares solution version 1.1.0.0", said)
        self.assertIn("1.1.0.1", said)

    def test_rejects_a_solution_version_lower_than_the_committed_one(self) -> None:
        """Disagreement in either direction is disagreement."""
        build_repository(self.root, solution="1.1.0.1")
        code, _ = run(self.root, "1.1.0.0", "1.1.0")
        self.assertEqual(code, 1)

    def test_rejects_a_missing_solution_manifest(self) -> None:
        build_repository(self.root, write_solution=False)
        code, said = run(self.root, "1.1.0.0", "1.1.0")
        self.assertEqual(code, 1)
        self.assertIn("::error::", said)

    def test_rejects_a_manifest_with_no_version_element(self) -> None:
        build_repository(self.root, solution=None)
        code, said = run(self.root, "1.1.0.0", "1.1.0")
        self.assertEqual(code, 1)
        self.assertIn("<Version>", said)

    def test_reports_every_disagreement_at_once(self) -> None:
        """One run should say everything that is wrong, not the first thing."""
        build_repository(self.root, solution="1.1.0.0", pcf_package="1.2.0")
        code, said = run(self.root, "1.1.0.1", "1.1.0")
        self.assertEqual(code, 1)
        self.assertIn("declares solution version 1.1.0.0", said)
        self.assertIn("pcf/package.json says 1.2.0", said)

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
                    root = build_repository(
                        Path(directory), solution="1.1.0.1", **{where: "1.2.0"}
                    )
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

    def test_the_checker_reads_the_manifest_the_workflow_stamps(self) -> None:
        """One file, named once, or the check and the stamp drift apart."""
        self.assertEqual(
            checker.SOLUTION_MANIFEST.as_posix(),
            "powerplatform/src/Other/Solution.xml",
        )


class NoDerivation(unittest.TestCase):
    """The release path names both versions; it does not compute either."""

    def setUp(self) -> None:
        self.workflow = (REPOSITORY / ".github/workflows/release.yml").read_text(
            encoding="utf-8"
        )

    def test_no_version_has_a_part_appended_to_it(self) -> None:
        derived = re.findall(r"\$\{\w*VERSION\w*\}\.\d+", self.workflow)
        self.assertEqual(derived, [], f"a version is still being derived: {derived}")

    def test_the_manifest_is_checked_before_it_is_stamped(self) -> None:
        """Order is the whole guarantee.

        The stamp step writes the solution version into the manifest. If it ran
        first, the check would read the value the release asked for rather than
        the value the repository committed, and would pass for anything.
        """
        check = self.workflow.index("- name: Check the version declarations agree")
        stamp = self.workflow.index("- name: Stamp the solution version")
        self.assertLess(check, stamp, "the manifest is stamped before it is checked")

    def test_both_versions_are_named_separately(self) -> None:
        for flag in ("--solution-version", "--control-version"):
            self.assertTrue(flag in self.workflow, f"release.yml never passes {flag}")
        self.assertTrue(
            re.search(r'--version "\$\{SOLUTION_VERSION\}"', self.workflow),
            "the stamp step is not handed the solution version verbatim",
        )


if __name__ == "__main__":
    unittest.main()
