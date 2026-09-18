#!/usr/bin/env python3
"""Writes the release version into the checked-in solution manifest.

Until v1.0.2 there was a script here that turned a freshly generated solution
project into the one the release needed: `pac solution init` produced something
generic on every run, and three things had to be corrected before it was built.
That whole arrangement is gone. The solution is source in this repository now,
so its unique name, publisher and packaging are read from the file rather than
patched into a generated one.

What is left is the version, and it is left because it is the one value a
release legitimately decides. `pac solution version` moves only the build and
revision parts, so a release version is written out rather than incremented into
place.

The edit is checked. If the manifest ever stops looking like the one this repo
carries, the release stops rather than quietly packaging something else.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SOLUTION_UNIQUE_NAME = "AyontoMention"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", help="path to src/Other/Solution.xml")
    parser.add_argument(
        "--version", required=True, help="solution version, four parts, e.g. 1.1.0.0"
    )
    arguments = parser.parse_args()

    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", arguments.version) is None:
        print(f"::error::{arguments.version!r} is not a four-part solution version")
        return 1

    path = Path(arguments.manifest)
    if not path.is_file():
        print(f"::error::{path} is missing")
        return 1

    text = path.read_text(encoding="utf-8")

    # The manifest this repository carries, not any manifest. A file that does
    # not name this solution is not one a release should be stamping.
    if f"<UniqueName>{SOLUTION_UNIQUE_NAME}</UniqueName>" not in text:
        print(
            f"::error::{path} does not declare <UniqueName>{SOLUTION_UNIQUE_NAME}</UniqueName>"
        )
        return 1

    text, replaced = re.subn(
        r"<Version>[^<]*</Version>", f"<Version>{arguments.version}</Version>", text, count=1
    )
    if replaced != 1:
        print(f"::error::{path} has no <Version> element to stamp")
        return 1

    path.write_text(text, encoding="utf-8")
    print(f"{path}: {SOLUTION_UNIQUE_NAME} {arguments.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
