#!/usr/bin/env python3
"""Turns a freshly generated solution project into the one this release needs.

`pac solution init` produces a project named after the folder it was created in,
versioned 1.0, and with the packaging choice commented out. Three things have to
be settled before it is built, and they are settled here rather than in a shell
heredoc so that they can be run and read outside a workflow:

* the solution's unique name. The project folder cannot be called AyontoMention,
  because a solution project may not share its name with a component project it
  references — pac refuses the reference, and msbuild calls it ambiguous. The
  name that matters is the one inside Solution.xml, and Dataverse reads that one.
* the version, in full. `pac solution version` moves only the build and revision
  parts, so a release version is written out rather than incremented into place.
* managed and unmanaged from a single build, which is what SolutionPackageType
  set to Both means.

Every edit is checked: if the generated project ever stops looking like this,
the release stops rather than quietly packaging something else.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SOLUTION_UNIQUE_NAME = "AyontoMention"
SOLUTION_DISPLAY_NAME = "Ayonto Mention"
#: The publisher's option value prefix, taken from the publisher that exists.
#:
#: `pac solution init` draws a new one every time it runs, so the same publisher
#: would arrive at an environment wearing a different number in every release —
#: and two builds of one commit would differ in their bytes for a reason that has
#: nothing to do with what is being shipped. So it is fixed.
#:
#: The value is not this repository's to invent: an `Ayonto` publisher already
#: exists in the environments this product has to live in, carrying 14144, and a
#: solution that named a different number for the same publisher would be asking
#: to change it. v1.0.0 shipped 45013, decided before that constraint was known;
#: from v1.0.1 the existing publisher is what this follows.
PUBLISHER_OPTION_VALUE_PREFIX = "14144"
#: The commented-out block `pac solution init` writes into every new cdsproj.
COMMENTED_PACKAGE_TYPE = re.compile(
    r"[ \t]*<!--\s*\n"
    r"[ \t]*<PropertyGroup>\s*\n"
    r"[ \t]*<SolutionPackageType>[^<]*</SolutionPackageType>\s*\n"
    r"[ \t]*<SolutionPackageEnableLocalization>[^<]*</SolutionPackageEnableLocalization>\s*\n"
    r"[ \t]*</PropertyGroup>\s*\n"
    r"[ \t]*-->"
)
BOTH = (
    "  <PropertyGroup>\n"
    "    <SolutionPackageType>Both</SolutionPackageType>\n"
    "  </PropertyGroup>"
)


def prepare_manifest(path: Path, project_name: str, version: str) -> None:
    # utf-8-sig: the generated file carries a byte order mark, and SolutionPackager
    # expects to find it again.
    text = path.read_text(encoding="utf-8-sig")

    text, names = re.subn(
        f"<UniqueName>{re.escape(project_name)}</UniqueName>",
        f"<UniqueName>{SOLUTION_UNIQUE_NAME}</UniqueName>",
        text,
        count=1,
    )
    text, labels = re.subn(
        f'<LocalizedName description="{re.escape(project_name)}"',
        f'<LocalizedName description="{SOLUTION_DISPLAY_NAME}"',
        text,
        count=1,
    )
    text, versions = re.subn(
        r"<Version>[^<]*</Version>", f"<Version>{version}</Version>", text, count=1
    )
    text, prefixes = re.subn(
        r"<CustomizationOptionValuePrefix>[^<]*</CustomizationOptionValuePrefix>",
        "<CustomizationOptionValuePrefix>"
        f"{PUBLISHER_OPTION_VALUE_PREFIX}"
        "</CustomizationOptionValuePrefix>",
        text,
        count=1,
    )

    if (names, labels, versions, prefixes) != (1, 1, 1, 1):
        raise SystemExit(
            f"::error::{path} is not the project pac generates "
            f"(unique name {names}, localized name {labels}, version {versions}, "
            f"option value prefix {prefixes})"
        )

    path.write_text(text, encoding="utf-8-sig")
    print(
        f"{path}: {SOLUTION_UNIQUE_NAME} {version}, "
        f"option value prefix {PUBLISHER_OPTION_VALUE_PREFIX}"
    )


def prepare_project(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "<SolutionPackageType>Both</SolutionPackageType>" in text:
        print(f"{path}: SolutionPackageType already Both")
        return

    text, replaced = COMMENTED_PACKAGE_TYPE.subn(BOTH, text, count=1)
    if replaced != 1:
        raise SystemExit(
            f"::error::{path} does not contain the commented SolutionPackageType "
            "block pac generates; check what the CLI produces now"
        )

    path.write_text(text, encoding="utf-8")
    print(f"{path}: SolutionPackageType=Both")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", help="path to the generated solution project")
    parser.add_argument(
        "--version", required=True, help="solution version, four parts, e.g. 1.0.0.0"
    )
    arguments = parser.parse_args()

    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", arguments.version) is None:
        print(f"::error::{arguments.version!r} is not a four-part solution version")
        return 1

    project = Path(arguments.project)
    name = project.name
    manifest = project / "src" / "Other" / "Solution.xml"
    cdsproj = project / f"{name}.cdsproj"
    for required in (manifest, cdsproj):
        if not required.is_file():
            print(f"::error::{required} is missing — was the project generated?")
            return 1

    prepare_manifest(manifest, name, arguments.version)
    prepare_project(cdsproj)
    return 0


if __name__ == "__main__":
    sys.exit(main())
