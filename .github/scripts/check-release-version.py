#!/usr/bin/env python3
"""Checks that everything in the repository agrees on the version being released.

A release names a version once, on the outside — a tag, or a number typed into
a workflow. Three places inside the repository name it too, and Dataverse reads
one of them to decide whether anything changed at all. If they disagree, the
package that goes out is not the thing the release page says it is.

So the version is compared rather than written. Nothing here edits a committed
file: a release is cut from what was reviewed and merged, and a build that
quietly rewrites a version is a build that can publish something nobody read.
Raising the version is a commit, and it belongs in a pull request.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

CONTROL_VERSION = re.compile(r'<control\b[^>]*?\bversion="([^"]*)"')


def read_package_version(path: Path) -> str:
    return str(json.loads(path.read_text(encoding="utf-8"))["version"])


def read_control_version(path: Path) -> str:
    found = CONTROL_VERSION.search(path.read_text(encoding="utf-8"))
    if found is None:
        raise SystemExit(f"::error::no control version attribute in {path}")
    return found.group(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="the version being released, e.g. 1.0.0")
    parser.add_argument(
        "--root", default=".", help="repository root (default: current directory)"
    )
    arguments = parser.parse_args()

    if re.fullmatch(r"\d+\.\d+\.\d+", arguments.version) is None:
        print(
            f"::error::{arguments.version!r} is not a MAJOR.MINOR.PATCH version",
        )
        return 1

    root = Path(arguments.root)
    declared = {
        "package.json": read_package_version(root / "package.json"),
        "pcf/package.json": read_package_version(root / "pcf" / "package.json"),
        "pcf/MentionControl/ControlManifest.Input.xml": read_control_version(
            root / "pcf" / "MentionControl" / "ControlManifest.Input.xml"
        ),
    }

    wrong = {
        where: found for where, found in declared.items() if found != arguments.version
    }
    if wrong:
        for where, found in wrong.items():
            print(
                f"::error::{where} says {found}, but the release is {arguments.version}"
            )
        print(
            "::error::raise the version in a pull request first; a release does not "
            "rewrite what it ships"
        )
        return 1

    for where, found in declared.items():
        print(f"{where}: {found}")
    print(f"all version declarations agree on {arguments.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
