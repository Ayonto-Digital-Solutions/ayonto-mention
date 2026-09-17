#!/usr/bin/env python3
"""Reads a built solution package and refuses to let a wrong one be published.

A successful SolutionPackager run is not evidence that the package is right.
It reports a component it could not take as a line in its log and then packs
what it has, exits zero, and the build goes green around a package that is
missing something. So the artifact itself is opened and read, and every claim
made about it on the release page is checked here first.

What this release is allowed to contain is deliberately narrow: the Ayonto
Mention code component and the central `ayonto_mention` table, and nothing else.
No flows, no plug-in assemblies, no connection references, no environment
variables — those belong to a server side that does not exist yet, and a package
that quietly grew one would be a far worse surprise than a failed build.

From v1.1.0 the table is **required**, not merely permitted. Up to v1.0.2 this
file refused an Entities section outright, because the package was the client
only and a table appearing in it would have meant something had gone wrong. A
release that is supposed to install a table and does not is the same class of
silent failure in the other direction, so the check is inverted rather than
dropped: the table's name, ownership, columns and view are stated below and held
against what was actually packed.

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
#: The second legacy control, which shares the publisher and must never be here.
LEGACY_GROUP_CONTROL_SCHEMA_NAME = "ayonto_Ayonto.GroupDetailListControl"
#: Type 66 is a custom control, type 1 an entity. See the solution component type table.
CUSTOM_CONTROL_COMPONENT_TYPE = "66"
ENTITY_COMPONENT_TYPE = "1"

#: The table, as the legacy solution exported it and as this package reuses it.
#:
#: Stated here rather than read out of the source tree: a checker that takes its
#: expectations from the thing it is checking agrees with every drift, including
#: the drift somebody did not mean to make.
TABLE_LOGICAL_NAME = "ayonto_mention"
TABLE_SCHEMA_NAME = "ayonto_Mention"
TABLE_ENTITY_SET_NAME = "ayonto_mentions"
#: UserOwned, exactly as exported. Ownership decides how row-level security
#: behaves, so a package that changed it would be a different table wearing the
#: same name.
TABLE_OWNERSHIP = "UserOwned"
TABLE_COLUMNS = frozenset(
    {
        "ayonto_Channel",
        "ayonto_DeliveryDetail",
        "ayonto_DeliveryStatus",
        "ayonto_LinkText",
        "ayonto_MentionId",
        "ayonto_MentionedById",
        "ayonto_Message",
        "ayonto_Name",
        "ayonto_RecordId",
        "ayonto_RecordName",
        "ayonto_RecordTable",
        "ayonto_RecordUrl",
        "ayonto_Subject",
        "ayonto_UserEmail",
        "ayonto_UserId",
        "ayonto_UserName",
    }
)
TABLE_VIEWS = frozenset({"Active Mentions"})
#: The ownership relationships Dataverse gives a user-owned table. Six, no more:
#: a seventh would mean this package had grown a link to something else.
EXPECTED_RELATIONSHIPS = 6
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

#: Anything a server side or another product would bring with it. None of it
#: belongs in this release.
#:
#: The table is not in this list and never was a file: SolutionPackager inlines
#: entities into customizations.xml when it packs, so the database arrives as
#: content rather than as a path. It is checked where it actually lives.
FORBIDDEN_PATH_PARTS = (
    "workflows/",
    "webresources/",
    "pluginassemblies/",
    "canvasapps/",
    "appmodules/",
    "connectionreferences",
    "environmentvariable",
    "groupdetaillist",
)
#: Elements in customizations.xml that must be present but empty.
#:
#: `Entities` and `EntityRelationships` left this list in v1.1.0: the first now
#: carries the table, the second the six ownership relationships that come with
#: it. Both are checked by content further down instead.
MUST_BE_EMPTY = (
    "Workflows",
    "Roles",
    "Templates",
    "EntityMaps",
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

    # Two root components from v1.1.0: the table and the code component. Named
    # rather than counted loosely, because "two of something" is not the check —
    # which two is.
    components = manifest.findall("RootComponents/RootComponent")
    declared = {
        (component.get("type"), component.get("schemaName")) for component in components
    }
    for schema_name in (LEGACY_CONTROL_SCHEMA_NAME, LEGACY_GROUP_CONTROL_SCHEMA_NAME):
        if (CUSTOM_CONTROL_COMPONENT_TYPE, schema_name) in declared:
            raise PackageError(
                f"the package declares {schema_name!r}, a productive legacy component — "
                "importing this would land on top of something forms already use"
            )

    expected = {
        (ENTITY_COMPONENT_TYPE, TABLE_LOGICAL_NAME),
        (CUSTOM_CONTROL_COMPONENT_TYPE, CONTROL_SCHEMA_NAME),
    }
    if declared != expected:
        missing = sorted(expected - declared)
        unexpected = sorted(declared - expected)
        raise PackageError(
            f"root components are wrong — missing {missing}, unexpected {unexpected}"
        )


def check_table(root: ElementTree.Element) -> None:
    """The table this release exists to install, against the table it should be.

    Required, not merely tolerated. A package that imports cleanly and leaves the
    environment without the table is the failure this whole file is here to
    catch, and from v1.1.0 that failure has a direction it did not have before.
    """
    entities = root.findall("Entities/Entity")
    if len(entities) != 1:
        raise PackageError(
            f"expected exactly one table, found {len(entities)} — this release "
            f"installs {TABLE_LOGICAL_NAME!r} and nothing else"
        )

    entity = entities[0]
    name = entity.findtext("Name")
    if name != TABLE_SCHEMA_NAME:
        raise PackageError(f"the packaged table is {name!r}, expected {TABLE_SCHEMA_NAME!r}")

    described = entity.find("./EntityInfo/entity")
    if described is None:
        raise PackageError("the packaged table has no EntityInfo/entity")

    entity_set = described.findtext("EntitySetName")
    if entity_set != TABLE_ENTITY_SET_NAME:
        raise PackageError(
            f"EntitySetName is {entity_set!r}, expected {TABLE_ENTITY_SET_NAME!r}"
        )

    ownership = described.findtext("OwnershipTypeMask")
    if ownership != TABLE_OWNERSHIP:
        raise PackageError(
            f"the table is {ownership!r}, expected {TABLE_OWNERSHIP!r} — ownership "
            "decides how row-level security behaves and is not a packaging detail"
        )

    columns = {
        attribute.get("PhysicalName", "")
        for attribute in entity.iter("attribute")
        if attribute.findtext("IsCustomField") == "1"
        or attribute.findtext("Type") == "primarykey"
    }
    if columns != TABLE_COLUMNS:
        missing = sorted(TABLE_COLUMNS - columns)
        unexpected = sorted(columns - TABLE_COLUMNS)
        raise PackageError(
            f"the table's columns are wrong — missing {missing}, unexpected {unexpected}"
        )

    views = set()
    for query in entity.iter("savedquery"):
        localized = query.find("./LocalizedNames/LocalizedName")
        if localized is not None:
            views.add(localized.get("description", ""))
    if views != TABLE_VIEWS:
        raise PackageError(
            f"the table carries the views {sorted(views)}, expected {sorted(TABLE_VIEWS)} — "
            "a view configured outside Entity.xml is packed silently into nothing"
        )

    relationships = root.findall("EntityRelationships/EntityRelationship")
    if len(relationships) != EXPECTED_RELATIONSHIPS:
        raise PackageError(
            f"the package carries {len(relationships)} relationship(s), expected "
            f"{EXPECTED_RELATIONSHIPS} — the ownership relationships of a user-owned table"
        )


def check_customizations(customizations_xml: bytes) -> None:
    """One code component, one table, and none of the things a server side would add."""
    root = ElementTree.fromstring(customizations_xml)

    check_table(root)

    for name in MUST_BE_EMPTY:
        element = root.find(name)
        if element is None:
            raise PackageError(f"customizations.xml has no {name} element")
        if len(element) != 0:
            raise PackageError(
                f"customizations.xml carries {len(element)} {name} — this release is "
                "the code component and the table, and nothing else"
            )

    controls = root.findall("CustomControls/CustomControl")
    if len(controls) != 1:
        raise PackageError(f"expected exactly one control, found {len(controls)}")
    name_element = controls[0].find("Name")
    for legacy in (LEGACY_CONTROL_SCHEMA_NAME, LEGACY_GROUP_CONTROL_SCHEMA_NAME):
        if name_element is not None and name_element.text == legacy:
            raise PackageError(
                f"customizations.xml names {legacy!r}, a productive legacy component"
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
