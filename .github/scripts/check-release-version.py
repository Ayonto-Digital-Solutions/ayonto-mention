#!/usr/bin/env python3
"""Checks that the repository agrees on the versions being released.

A release carries two versions, and they are not the same number.

The Dataverse solution has a version of the form `major.minor.build.revision` —
four parts, and an update has to raise one of them before the platform treats it
as an update at all. The code component inside that solution has a version of its
own, and the component framework manifest defines that one as Semantic
Versioning: three parts.

  https://learn.microsoft.com/power-apps/maker/data-platform/update-solutions
  https://learn.microsoft.com/power-apps/developer/component-framework/manifest-schema-reference/control

Until now the release named one three-part number and appended `.0` to reach a
solution version. That holds only while the two move together, and they do not.
The solution can need a fourth-part revision on its own — a table, a step, a
security role, anything on the server side — with the control untouched, and a
Semantic Version has nowhere to put that. So the two are named separately, and
neither is derived from the other.

They are related by release, not by arithmetic. A solution `1.1.0.1` shipping a
control `1.1.0` is the ordinary case rather than a mistake, and nothing here
compares them.

What is compared is the repository against itself, and against what the release
claims to be. Four files declare a version, and every one of them is checked:

    powerplatform/src/Other/Solution.xml      the solution version
    package.json                             \\
    pcf/package.json                          }  the control version
    pcf/MentionControl/ControlManifest.Input.xml /

Both versions are declared in the repository. Neither is invented outside it.

That second point is the whole reason this script exists. A tag and a dispatch
input *name* a release; they do not get to decide what version it carries. If
`v1.1.0.1` is pushed at a commit whose manifest still says `1.1.0.0`, the
release would ship a solution version nobody reviewed — the build would stamp the
tag's number into the manifest on its way past and publish it. So the tag is
checked against the committed manifest and the build stops when they differ.

Nothing here edits a committed file. Raising either version is a commit, and it
belongs in a pull request.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Four parts for the solution, three for the control. Anchored, digits only: a
# version that merely starts with the right shape is not the right shape, and
# everything downstream puts these into filenames and into a manifest.
SOLUTION_VERSION = re.compile(r"\d+\.\d+\.\d+\.\d+")
CONTROL_VERSION = re.compile(r"\d+\.\d+\.\d+")

SOLUTION_MANIFEST = Path("powerplatform/src/Other/Solution.xml")
SOLUTION_VERSION_ELEMENT = re.compile(r"<Version>([^<]*)</Version>")
CONTROL_VERSION_ATTRIBUTE = re.compile(r'<control\b[^>]*?\bversion="([^"]*)"')


def read_package_version(path: Path) -> str:
    return str(json.loads(path.read_text(encoding="utf-8"))["version"])


def read_control_version(path: Path) -> str:
    found = CONTROL_VERSION_ATTRIBUTE.search(path.read_text(encoding="utf-8"))
    if found is None:
        raise ValueError(f"no control version attribute in {path}")
    return found.group(1)


def read_solution_version(path: Path) -> str:
    found = SOLUTION_VERSION_ELEMENT.search(path.read_text(encoding="utf-8"))
    if found is None:
        raise ValueError(f"no <Version> element in {path}")
    return found.group(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--solution-version",
        required=True,
        help="Dataverse solution version being released, four parts, e.g. 1.1.0.1",
    )
    parser.add_argument(
        "--control-version",
        required=True,
        help="PCF control version, Semantic Versioning, e.g. 1.1.0",
    )
    parser.add_argument(
        "--root", default=".", help="repository root (default: current directory)"
    )
    arguments = parser.parse_args()

    if SOLUTION_VERSION.fullmatch(arguments.solution_version) is None:
        print(
            f"::error::{arguments.solution_version!r} is not a four-part "
            "MAJOR.MINOR.BUILD.REVISION solution version"
        )
        return 1

    if CONTROL_VERSION.fullmatch(arguments.control_version) is None:
        print(
            f"::error::{arguments.control_version!r} is not a three-part "
            "MAJOR.MINOR.PATCH control version"
        )
        return 1

    # Read before compared, and a file that cannot be read is a failure rather
    # than a version nobody checked.
    root = Path(arguments.root)
    try:
        committed_solution = read_solution_version(root / SOLUTION_MANIFEST)
        declared_control = {
            "package.json": read_package_version(root / "package.json"),
            "pcf/package.json": read_package_version(root / "pcf" / "package.json"),
            "pcf/MentionControl/ControlManifest.Input.xml": read_control_version(
                root / "pcf" / "MentionControl" / "ControlManifest.Input.xml"
            ),
        }
    except (OSError, ValueError, KeyError) as problem:
        print(f"::error::cannot read a version declaration: {problem}")
        return 1

    # Everything wrong at once, rather than one thing per run: whoever reads this
    # log is trying to find out what the repository actually says.
    problems = []
    if committed_solution != arguments.solution_version:
        problems.append(
            f"::error::{SOLUTION_MANIFEST.as_posix()} declares solution version "
            f"{committed_solution}, but this release is being built as "
            f"{arguments.solution_version}"
        )
    for where, found in declared_control.items():
        if found != arguments.control_version:
            problems.append(
                f"::error::{where} says {found}, but the control version being "
                f"released is {arguments.control_version}"
            )

    if problems:
        for problem in problems:
            print(problem)
        print(
            "::error::a tag or a dispatch input names a release; it does not decide "
            "what version that release carries. Raise the version in a pull request "
            "first — a release does not rewrite what it ships"
        )
        return 1

    print(f"{SOLUTION_MANIFEST.as_posix()}: {committed_solution}")
    for where, found in declared_control.items():
        print(f"{where}: {found}")
    print(
        f"solution {arguments.solution_version} and control "
        f"{arguments.control_version} are both declared in the repository"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
