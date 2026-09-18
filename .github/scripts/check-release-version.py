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

What is compared is the repository against itself. Three files declare the
control version, and a package built while they disagree is not the thing the
release page says it is. Nothing here edits a committed file: a release is cut
from what was reviewed and merged, and a build that quietly rewrites a version is
a build that can publish something nobody read. Raising a version is a commit,
and it belongs in a pull request.
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

CONTROL_VERSION_ATTRIBUTE = re.compile(r'<control\b[^>]*?\bversion="([^"]*)"')


def read_package_version(path: Path) -> str:
    return str(json.loads(path.read_text(encoding="utf-8"))["version"])


def read_control_version(path: Path) -> str:
    found = CONTROL_VERSION_ATTRIBUTE.search(path.read_text(encoding="utf-8"))
    if found is None:
        raise ValueError(f"no control version attribute in {path}")
    return found.group(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--solution-version",
        required=True,
        help="Dataverse solution version, four parts, e.g. 1.1.0.1",
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
        declared = {
            "package.json": read_package_version(root / "package.json"),
            "pcf/package.json": read_package_version(root / "pcf" / "package.json"),
            "pcf/MentionControl/ControlManifest.Input.xml": read_control_version(
                root / "pcf" / "MentionControl" / "ControlManifest.Input.xml"
            ),
        }
    except (OSError, ValueError, KeyError) as problem:
        print(f"::error::cannot read a version declaration: {problem}")
        return 1

    wrong = {
        where: found
        for where, found in declared.items()
        if found != arguments.control_version
    }
    if wrong:
        for where, found in wrong.items():
            print(
                f"::error::{where} says {found}, but the control version being "
                f"released is {arguments.control_version}"
            )
        print(
            "::error::raise the version in a pull request first; a release does not "
            "rewrite what it ships"
        )
        return 1

    for where, found in declared.items():
        print(f"{where}: {found}")
    print(f"all control version declarations agree on {arguments.control_version}")
    print(
        f"solution version {arguments.solution_version} is the version the packages "
        f"are stamped and named with"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
