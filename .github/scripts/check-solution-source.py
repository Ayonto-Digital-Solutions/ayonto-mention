#!/usr/bin/env python3
"""Checks the Dataverse solution source for the mistakes SolutionPackager does not complain about.

Every rule here is a failure the packer answers with silence. It packs, the
import succeeds, and something is simply not there. The lessons are the legacy
product's, paid for once already:

* an entity folder that no RootComponent mentions packs without the table, and
  nothing anywhere says so;
* a non-empty <Entities /> in Customizations.xml makes the packer drop the
  Entities folder entirely;
* a SavedQueries folder is read by nothing — the packer takes views from
  <SavedQueries> inside Entity.xml, and a table ships with no view at all;
* a hand-written RibbonDiff.xml makes the packer throw a NullReferenceException
  that names only the entity it was processing.

The contract below is the table as the legacy solution exported it. It is stated
rather than derived from the files it checks: a checker that reads its
expectations out of the thing it is checking agrees with every drift.
"""

from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(os.environ.get("SOLUTION_SOURCE") or Path(__file__).resolve().parents[2] / "powerplatform")
SRC = ROOT / "src"
ENTITY_COMPONENT_TYPE = "1"

SOLUTION_UNIQUE_NAME = "AyontoMention"
PUBLISHER_UNIQUE_NAME = "Ayonto"
PUBLISHER_PREFIX = "ayonto"
PUBLISHER_OPTION_VALUE_PREFIX = "14144"

#: The table, as the legacy solution exported it. Reused, not redesigned.
TABLE_FOLDER = "ayonto_Mention"
TABLE_LOGICAL_NAME = "ayonto_mention"
TABLE_ENTITY_SET_NAME = "ayonto_mentions"
#: UserOwned, and deliberately not changed. Ownership decides how row-level
#: security behaves, and changing it here would be redesigning a table this
#: release is only repackaging.
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
RELATIONSHIPS = frozenset(
    {
        "business_unit_ayonto_mention",
        "lk_ayonto_mention_createdby",
        "lk_ayonto_mention_modifiedby",
        "owner_ayonto_mention",
        "team_ayonto_mention",
        "user_ayonto_mention",
    }
)
#: Sections this release carries nothing in. Listed so that the day one of them
#: gains a child, somebody reads this line before it ships.
MUST_BE_EMPTY = ("Entities", "Roles", "Workflows", "SolutionPluginAssemblies")


def fail(message: str) -> None:
    print(f"::error::solution source: {message}", file=sys.stderr)
    sys.exit(1)


def check_xml_well_formed() -> int:
    files = sorted(SRC.rglob("*.xml"))
    if not files:
        fail(f"{SRC} holds no XML at all — is the solution source there?")
    for path in files:
        try:
            ET.parse(path)
        except ET.ParseError as error:
            fail(f"{path.relative_to(ROOT)} is not well-formed XML: {error}")
    return len(files)


def check_manifest() -> set[str]:
    manifest = SRC / "Other" / "Solution.xml"
    if not manifest.is_file():
        fail("src/Other/Solution.xml is missing")

    root = ET.parse(manifest).getroot()
    section = root.find("SolutionManifest")
    if section is None:
        fail("src/Other/Solution.xml has no SolutionManifest")

    unique = section.findtext("UniqueName")
    if unique != SOLUTION_UNIQUE_NAME:
        fail(f"solution unique name is {unique!r}, expected {SOLUTION_UNIQUE_NAME!r}")

    publisher = section.find("Publisher")
    if publisher is None:
        fail("src/Other/Solution.xml has no Publisher")
    for label, found, expected in (
        ("publisher", publisher.findtext("UniqueName"), PUBLISHER_UNIQUE_NAME),
        ("prefix", publisher.findtext("CustomizationPrefix"), PUBLISHER_PREFIX),
        (
            "option value prefix",
            publisher.findtext("CustomizationOptionValuePrefix"),
            PUBLISHER_OPTION_VALUE_PREFIX,
        ),
    ):
        if found != expected:
            fail(f"{label} is {found!r}, expected {expected!r}")

    declared = {
        component.get("schemaName", "").lower()
        for component in section.iter("RootComponent")
        if component.get("type") == ENTITY_COMPONENT_TYPE
    }
    if TABLE_LOGICAL_NAME not in declared:
        fail(
            f"Solution.xml declares no <RootComponent type=\"1\"> for {TABLE_LOGICAL_NAME!r} — "
            "the table would pack without ever being part of the solution, and nothing would say so"
        )
    return declared


def check_table(declared: set[str]) -> None:
    folders = sorted(path.name for path in (SRC / "Entities").iterdir() if path.is_dir())
    if folders != [TABLE_FOLDER]:
        fail(f"src/Entities holds {folders}, expected exactly ['{TABLE_FOLDER}']")

    folder = SRC / "Entities" / TABLE_FOLDER
    entity_file = folder / "Entity.xml"
    if not entity_file.is_file():
        fail(f"Entities/{TABLE_FOLDER} has no Entity.xml")

    # The packer cannot read a hand-written one, and its exception names nothing
    # but the entity it was processing.
    if (folder / "RibbonDiff.xml").is_file():
        fail(f"Entities/{TABLE_FOLDER}/RibbonDiff.xml — leave it out; the packer cannot read one written by hand")

    # Read by nothing. The views belong inside Entity.xml, and a table whose
    # views live here ships with no view at all.
    if (folder / "SavedQueries").is_dir():
        fail(
            f"Entities/{TABLE_FOLDER}/SavedQueries — the packer never reads this folder; "
            "the views belong in <SavedQueries> inside Entity.xml"
        )

    root = ET.parse(entity_file).getroot()
    described = root.find("./EntityInfo/entity")
    if described is None:
        fail(f"Entities/{TABLE_FOLDER}/Entity.xml has no EntityInfo/entity")

    logical = (described.get("Name") or "").lower()
    if logical != TABLE_LOGICAL_NAME:
        fail(f"the table is {logical!r}, expected {TABLE_LOGICAL_NAME!r}")
    if logical not in declared:
        fail(f"the table {logical!r} has no RootComponent in Solution.xml")

    entity_set = described.findtext("EntitySetName")
    if entity_set != TABLE_ENTITY_SET_NAME:
        fail(f"EntitySetName is {entity_set!r}, expected {TABLE_ENTITY_SET_NAME!r}")

    ownership = described.findtext("OwnershipTypeMask")
    if ownership != TABLE_OWNERSHIP:
        fail(
            f"OwnershipTypeMask is {ownership!r}, expected {TABLE_OWNERSHIP!r} — "
            "ownership decides how row-level security behaves and is not this release's to change"
        )

    columns = {
        attribute.get("PhysicalName", "")
        for attribute in root.iter("attribute")
        if attribute.findtext("IsCustomField") == "1" or attribute.findtext("Type") == "primarykey"
    }
    if columns != TABLE_COLUMNS:
        missing = sorted(TABLE_COLUMNS - columns)
        extra = sorted(columns - TABLE_COLUMNS)
        fail(f"the table's columns drifted — missing {missing}, unexpected {extra}")

    views = set()
    for query in root.iter("savedquery"):
        name = query.find("./LocalizedNames/LocalizedName")
        if name is not None:
            views.add(name.get("description", ""))
    if views != TABLE_VIEWS:
        fail(f"the table carries the views {sorted(views)}, expected {sorted(TABLE_VIEWS)}")

    print(
        f"  table {logical}: {TABLE_OWNERSHIP}, {len(columns)} columns, "
        f"{len(views)} view(s), set {entity_set}"
    )


def check_relationships() -> None:
    path = SRC / "Other" / "Relationships.xml"
    if not path.is_file():
        fail("src/Other/Relationships.xml is missing")
    found = {node.get("Name", "") for node in ET.parse(path).getroot().iter("EntityRelationship")}
    if found != RELATIONSHIPS:
        missing = sorted(RELATIONSHIPS - found)
        extra = sorted(found - RELATIONSHIPS)
        fail(f"relationships drifted — missing {missing}, unexpected {extra}")
    print(f"  relationships: {len(found)}")


def check_customizations() -> None:
    path = SRC / "Other" / "Customizations.xml"
    if not path.is_file():
        fail("src/Other/Customizations.xml is missing")
    root = ET.parse(path).getroot()

    for name in MUST_BE_EMPTY:
        node = root.find(name)
        if node is None:
            fail(f"src/Other/Customizations.xml has no <{name} /> element")
        if len(node) > 0:
            if name == "Entities":
                fail(
                    "src/Other/Customizations.xml must keep <Entities /> childless — "
                    "the packer drops the Entities folder otherwise and ships no table"
                )
            fail(f"src/Other/Customizations.xml declares {len(node)} <{name}> child(ren); this release carries none")

    for unexpected in ("connectionreferences", "environmentvariabledefinitions"):
        node = root.find(unexpected)
        if node is not None and len(node) > 0:
            fail(f"src/Other/Customizations.xml declares <{unexpected}>; this release carries none")
    print("  customizations: Entities childless, no roles, workflows, plug-in assemblies, connections or variables")


def main() -> None:
    if not SRC.is_dir():
        fail(f"{SRC} does not exist")
    files = check_xml_well_formed()
    declared = check_manifest()
    check_table(declared)
    check_relationships()
    check_customizations()
    print(f"solution source: {files} XML file(s) checked, {SOLUTION_UNIQUE_NAME} contract holds")


if __name__ == "__main__":
    main()
