#!/usr/bin/env python3
"""Reads a built solution package and refuses to let a wrong one be published.

A successful SolutionPackager run is not evidence that the package is right.
It reports a component it could not take as a line in its log and then packs
what it has, exits zero, and the build goes green around a package that is
missing something. So the artifact itself is opened and read, and every claim
made about it on the release page is checked here first.

What this release is allowed to contain is deliberately narrow: the Ayonto
Mention code component, and nothing else. No tables, no flows, no connection
references, no environment variables — those belong to a backend that does not
exist yet, and a package that quietly grew one would be a far worse surprise
than a failed build.

Fails closed: anything expected and missing, anything present and unexpected,
and anything it cannot read at all is an error.

Two notes for a reader who greps this file:

* The XML read here is the package this same job has just built, from source in
  this repository — not input from anywhere else. That is why the standard
  library parser is used rather than a hardened one: there is no untrusted
  document to harden against, and a release checker is not the place to add a
  dependency.
* `eval(` appears below as a *string to search for* inside the built bundle. It
  is how a development build is told from a production one; nothing here
  evaluates anything.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from xml.etree import ElementTree

SOLUTION_UNIQUE_NAME = "AyontoMention"
PUBLISHER_UNIQUE_NAME = "Ayonto"
PUBLISHER_PREFIX = "ayonto"
#: The prefix the `Ayonto` publisher already carries where this product is
#: installed. Fixed by the release preparation and checked here, so one publisher
#: does not arrive at an environment wearing a different number each release.
PUBLISHER_OPTION_VALUE_PREFIX = "14144"
CONTROL_SCHEMA_NAME = "ayonto_Ayonto.AyontoMentionControl"
CONTROL_NAMESPACE = "Ayonto"
CONTROL_CONSTRUCTOR = "AyontoMentionControl"
#: The productive legacy control, which lives in the same environments under the
#: same publisher. This package must never carry it: the two components are not
#: versions of one another — this one requires configuration the legacy contract
#: has no place for — and a package claiming that identity would land on top of a
#: control that forms are already using.
LEGACY_CONTROL_SCHEMA_NAME = "ayonto_Ayonto.MentionControl"
LEGACY_CONTROL_CONSTRUCTOR = "MentionControl"
#: Type 66 is a custom control. See the solution component type table.
CUSTOM_CONTROL_COMPONENT_TYPE = "66"
#: Every file this release's packages may contain, and no others.
#:
#: An allowlist rather than a list of things to refuse, because the interesting
#: failure is the file nobody thought of. It is deliberately brittle: the day a
#: version legitimately adds a stylesheet, an image or a third language, this
#: line fails and somebody looks at what is being shipped before it ships.
EXPECTED_FILES = frozenset(
    {
        "[Content_Types].xml",
        "solution.xml",
        "customizations.xml",
        "Controls/ayonto_Ayonto.AyontoMentionControl/ControlManifest.xml",
        "Controls/ayonto_Ayonto.AyontoMentionControl/bundle.js",
        "Controls/ayonto_Ayonto.AyontoMentionControl/bundle.js.LICENSE.txt",
        "Controls/ayonto_Ayonto.AyontoMentionControl/strings/MentionControl.1033.resx",
        "Controls/ayonto_Ayonto.AyontoMentionControl/strings/MentionControl.1031.resx",
    }
)

#: Anything a backend would bring with it. None of it belongs in this release.
FORBIDDEN_PATH_PARTS = (
    "entities/",
    "workflows/",
    "webresources/",
    "pluginassemblies/",
    "canvasapps/",
    "appmodules/",
    "connectionreferences",
    "environmentvariable",
    "savedqueries/",
    "ayonto_mention/",
    "groupdetaillist",
)
#: Elements in customizations.xml that must be present but empty.
MUST_BE_EMPTY = (
    "Entities",
    "Workflows",
    "Roles",
    "Templates",
    "EntityMaps",
    "EntityRelationships",
    "SolutionPluginAssemblies",
    "EntityDataProviders",
)


class PackageError(Exception):
    """Something about the package is wrong enough to stop the release."""


def _text(parent: ElementTree.Element, path: str) -> str:
    found = parent.find(path)
    if found is None or found.text is None:
        raise PackageError(f"{path} is missing from the solution manifest")
    return found.text.strip()


def check_solution_manifest(
    solution_xml: bytes, version: str, managed: bool
) -> None:
    """The identity the package claims, against the identity it should have."""
    root = ElementTree.fromstring(solution_xml)
    manifest = root.find("SolutionManifest")
    if manifest is None:
        raise PackageError("no SolutionManifest in solution.xml")

    unique_name = _text(manifest, "UniqueName")
    if unique_name != SOLUTION_UNIQUE_NAME:
        raise PackageError(
            f"solution unique name is {unique_name!r}, expected {SOLUTION_UNIQUE_NAME!r}"
        )

    actual_version = _text(manifest, "Version")
    if actual_version != version:
        raise PackageError(
            f"solution version is {actual_version!r}, expected {version!r}"
        )

    # 1 is managed, 0 is unmanaged. The two packages are told apart here rather
    # than by their file names, which are ours to choose and easy to swap.
    expected_managed = "1" if managed else "0"
    actual_managed = _text(manifest, "Managed")
    if actual_managed != expected_managed:
        raise PackageError(
            f"package reports Managed={actual_managed}, expected {expected_managed}"
        )

    publisher = manifest.find("Publisher")
    if publisher is None:
        raise PackageError("no Publisher in solution.xml")
    publisher_name = _text(publisher, "UniqueName")
    if publisher_name != PUBLISHER_UNIQUE_NAME:
        raise PackageError(
            f"publisher is {publisher_name!r}, expected {PUBLISHER_UNIQUE_NAME!r}"
        )
    prefix = _text(publisher, "CustomizationPrefix")
    if prefix != PUBLISHER_PREFIX:
        raise PackageError(f"prefix is {prefix!r}, expected {PUBLISHER_PREFIX!r}")
    option_prefix = _text(publisher, "CustomizationOptionValuePrefix")
    if option_prefix != PUBLISHER_OPTION_VALUE_PREFIX:
        raise PackageError(
            f"publisher option value prefix is {option_prefix!r}, expected "
            f"{PUBLISHER_OPTION_VALUE_PREFIX!r} — it is fixed, not generated"
        )

    components = manifest.findall("RootComponents/RootComponent")
    if len(components) != 1:
        raise PackageError(
            f"expected exactly one root component, found {len(components)}"
        )
    component = components[0]
    if component.get("type") != CUSTOM_CONTROL_COMPONENT_TYPE:
        raise PackageError(
            f"root component type is {component.get('type')!r}, "
            f"expected {CUSTOM_CONTROL_COMPONENT_TYPE!r} (custom control)"
        )
    schema_name = component.get("schemaName")
    if schema_name == LEGACY_CONTROL_SCHEMA_NAME:
        raise PackageError(
            f"the root component is {LEGACY_CONTROL_SCHEMA_NAME!r}, the productive "
            "legacy control — importing this would replace it"
        )
    if schema_name != CONTROL_SCHEMA_NAME:
        raise PackageError(
            f"root component is {schema_name!r}, expected {CONTROL_SCHEMA_NAME!r}"
        )


def check_customizations(customizations_xml: bytes) -> None:
    """One code component, and none of the things a backend would add."""
    root = ElementTree.fromstring(customizations_xml)

    for name in MUST_BE_EMPTY:
        element = root.find(name)
        if element is None:
            raise PackageError(f"customizations.xml has no {name} element")
        if len(element) != 0:
            raise PackageError(
                f"customizations.xml carries {len(element)} {name} — this release is "
                "the code component only"
            )

    controls = root.findall("CustomControls/CustomControl")
    if len(controls) != 1:
        raise PackageError(f"expected exactly one control, found {len(controls)}")
    name_element = controls[0].find("Name")
    if name_element is not None and name_element.text == LEGACY_CONTROL_SCHEMA_NAME:
        raise PackageError(
            f"customizations.xml names {LEGACY_CONTROL_SCHEMA_NAME!r}, the productive "
            "legacy control"
        )
    if name_element is None or name_element.text != CONTROL_SCHEMA_NAME:
        raise PackageError(
            f"control is {name_element.text if name_element is not None else None!r}, "
            f"expected {CONTROL_SCHEMA_NAME!r}"
        )


def check_control_manifest(manifest_xml: bytes, control_version: str) -> None:
    """The version Dataverse reads to decide whether anything changed."""
    root = ElementTree.fromstring(manifest_xml)
    control = root.find("control")
    if control is None:
        raise PackageError("no control element in the packaged ControlManifest.xml")

    if control.get("namespace") != CONTROL_NAMESPACE:
        raise PackageError(f"control namespace is {control.get('namespace')!r}")
    constructor = control.get("constructor")
    if constructor == LEGACY_CONTROL_CONSTRUCTOR:
        raise PackageError(
            f"the packaged control is {CONTROL_NAMESPACE}.{LEGACY_CONTROL_CONSTRUCTOR}, "
            "which is the productive legacy control — this package would overwrite it"
        )
    if constructor != CONTROL_CONSTRUCTOR:
        raise PackageError(f"control constructor is {constructor!r}")

    packaged = control.get("version")
    if packaged != control_version:
        raise PackageError(
            f"packaged control version is {packaged!r}, expected {control_version!r}"
        )


def check_bundle(bundle: bytes) -> None:
    """A development bundle must never leave the building.

    It is several times the size, carries its sources with it, and the platform
    documents that it should not be deployed. `eval(` is what tells them apart:
    the development bundle is built from it, the production bundle has none.
    """
    if not bundle:
        raise PackageError("bundle.js is empty")
    text = bundle.decode("utf-8", errors="replace")
    if "eval(" in text:
        raise PackageError(
            "bundle.js looks like a development build — it contains eval("
        )
    if "//# sourceMappingURL=" in text:
        raise PackageError("bundle.js still points at a source map")


def check_package(path: str, version: str, control_version: str, managed: bool) -> None:
    try:
        with zipfile.ZipFile(path) as package:
            names = package.namelist()
            if package.testzip() is not None:
                raise PackageError("the archive is damaged")

            # Asked first, so that a package wearing the legacy identity is
            # refused for that reason rather than for the eight files it is then
            # also missing. This is the mistake worth naming precisely: the two
            # components live in the same environments under the same publisher,
            # and one of them is in productive use.
            legacy = [name for name in names if LEGACY_CONTROL_SCHEMA_NAME in name]
            if legacy:
                raise PackageError(
                    f"package carries {legacy[0]!r} — that is the productive legacy "
                    "control, and this component must not claim its identity"
                )

            # A zip may carry the same path twice, and a reader would see only
            # one of them. Counted rather than set-compared for that reason.
            duplicates = {name for name in names if names.count(name) > 1}
            if duplicates:
                raise PackageError(f"package lists {sorted(duplicates)[0]!r} twice")

            present = set(names)
            missing = EXPECTED_FILES - present
            if missing:
                raise PackageError(
                    f"missing from the package: {', '.join(sorted(missing))}"
                )
            unexpected = present - EXPECTED_FILES
            if unexpected:
                raise PackageError(
                    f"package contains {', '.join(sorted(unexpected))}, which this "
                    "release does not ship — if that is intended, the expected file "
                    "list has to be reviewed and updated"
                )

            # Kept after the allowlist rather than replaced by it: these name the
            # specific things a backend would drag in, so a future change to the
            # list above cannot quietly let one through unremarked.
            lowered = [name.lower() for name in names]
            for forbidden in FORBIDDEN_PATH_PARTS:
                found = [name for name in lowered if forbidden in name]
                if found:
                    raise PackageError(
                        f"package contains {found[0]!r}, which this release may not ship"
                    )

            control_root = f"Controls/{CONTROL_SCHEMA_NAME}/"

            check_solution_manifest(package.read("solution.xml"), version, managed)
            check_customizations(package.read("customizations.xml"))
            check_control_manifest(
                package.read(control_root + "ControlManifest.xml"), control_version
            )
            check_bundle(package.read(control_root + "bundle.js"))
    except zipfile.BadZipFile as error:
        raise PackageError(f"not a readable zip archive: {error}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="path to the solution zip")
    parser.add_argument(
        "--version", required=True, help="expected solution version, e.g. 1.0.0.0"
    )
    parser.add_argument(
        "--control-version", required=True, help="expected control version, e.g. 1.0.0"
    )
    state = parser.add_mutually_exclusive_group(required=True)
    state.add_argument("--managed", action="store_true")
    state.add_argument("--unmanaged", action="store_true")
    arguments = parser.parse_args()

    try:
        check_package(
            arguments.package,
            arguments.version,
            arguments.control_version,
            managed=arguments.managed,
        )
    except (PackageError, OSError) as error:
        print(f"::error::{arguments.package}: {error}")
        return 1

    state_word = "managed" if arguments.managed else "unmanaged"
    print(
        f"{arguments.package}: {SOLUTION_UNIQUE_NAME} {arguments.version} "
        f"({state_word}), control {CONTROL_SCHEMA_NAME} {arguments.control_version}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
