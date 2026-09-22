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

The contracts below are stated rather than derived from the files they check: a
checker that reads its expectations out of the thing it is checking agrees with
every drift.

There are two tables, and they are not the same kind of thing.

`ayonto_mention` is the legacy-derived table this release repackages. Its
contract is what the legacy solution exported, and nothing here is allowed to
redesign it.

`ayonto_mentionevent` is the product's own event ledger. It is the one table in
this tree that was not copied from an export, because it has never existed in an
environment to be exported from — see `powerplatform/README.md` for why, and
`tools/powerplatform/generate-mentionevent-entity.py` for how it was derived from
the export that does exist. That makes this contract worth more than usual: it is
stated independently of the generator, so the two have to agree about what the
table is before anything ships.
"""

from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import NamedTuple

ROOT = Path(os.environ.get("SOLUTION_SOURCE") or Path(__file__).resolve().parents[2] / "powerplatform")
SRC = ROOT / "src"
ENTITY_COMPONENT_TYPE = "1"
#: Type 91 is a plug-in assembly, 90 a plug-in type. See the solution component type table.
PLUGIN_ASSEMBLY_COMPONENT_TYPE = "91"
PLUGIN_TYPE_COMPONENT_TYPE = "90"

SOLUTION_UNIQUE_NAME = "AyontoMention"
PUBLISHER_UNIQUE_NAME = "Ayonto"
PUBLISHER_PREFIX = "ayonto"
PUBLISHER_OPTION_VALUE_PREFIX = "14144"

#: The legacy-derived table, as the legacy solution exported it. Reused, not
#: redesigned, and its contract is names only: asserting types here would be
#: reading expectations out of the file under test.
LEGACY_COLUMNS = frozenset(
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

#: A GUID, written the only way this product writes one: canonical, hyphenated,
#: lowercase, 36 characters. Dataverse has no custom Uniqueidentifier column
#: type — see the "Can Create" column in the documentation of column types — so
#: every identifier is a string, and the length is part of the check. A braced
#: or parenthesised GUID does not fit in 36 characters, which is the point.
GUID_TEXT = 36


class Column(NamedTuple):
    """One column, in the vocabulary SolutionPackager writes into Entity.xml."""

    type: str
    #: <Format>, or None where the type carries none and none is asserted.
    format: str | None
    max_length: int | None
    #: <RequiredLevel>: none | required | systemrequired.
    required: str


#: The product's own event ledger. One row is one mention episode for one
#: recipient, and the row carries the notification configuration that applied
#: when it was created.
#:
#: Written down before the table exists. This is what decides whether the thing
#: created in a real environment and exported back is the thing that was asked
#: for, so a mismatch means one of the two is wrong — and the schema, not this
#: file, is the authority about which.
LEDGER_COLUMNS: dict[str, Column] = {
    "ayonto_MentionEventId": Column("primarykey", None, None, "systemrequired"),
    "ayonto_Name": Column("nvarchar", "text", 200, "required"),
    # identity
    "ayonto_EventId": Column("nvarchar", "text", GUID_TEXT, "required"),
    "ayonto_RecordTable": Column("nvarchar", "text", 128, "required"),
    "ayonto_RecordId": Column("nvarchar", "text", GUID_TEXT, "required"),
    "ayonto_SourceField": Column("nvarchar", "text", 128, "required"),
    "ayonto_RecipientUserId": Column("nvarchar", "text", GUID_TEXT, "required"),
    "ayonto_InitiatingUserId": Column("nvarchar", "text", GUID_TEXT, "required"),
    # notification configuration snapshot
    "ayonto_ConfigSchemaVersion": Column("int", None, None, "required"),
    "ayonto_EmailEnabled": Column("bit", None, None, "required"),
    "ayonto_EmailSubject": Column("nvarchar", "text", 4000, "none"),
    "ayonto_EmailBody": Column("ntext", "text", 100000, "none"),
    "ayonto_EmailLinkText": Column("nvarchar", "text", 4000, "none"),
    "ayonto_TeamsEnabled": Column("bit", None, None, "required"),
    "ayonto_TeamsTitle": Column("nvarchar", "text", 4000, "none"),
    "ayonto_TeamsBody": Column("ntext", "text", 100000, "none"),
    "ayonto_TeamsLinkText": Column("nvarchar", "text", 4000, "none"),
    "ayonto_InAppEnabled": Column("bit", None, None, "required"),
    "ayonto_InAppTitle": Column("nvarchar", "text", 4000, "none"),
    "ayonto_InAppBody": Column("ntext", "text", 100000, "none"),
    "ayonto_InAppLinkText": Column("nvarchar", "text", 4000, "none"),
}

#: Things this ledger must never grow, named so the failure says why rather than
#: only that a column set differs. Delivery state is per channel and comes later;
#: a recipient is resolved from an identifier server-side and is never a stored
#: name or address to fall back on.
FORBIDDEN_LEDGER_SUBSTRINGS = (
    "deliverystatus",
    "deliverydetail",
    "deliveryattempt",
    "recipientemail",
    "recipientname",
    "useremail",
    "username",
    "recordurl",
    "recordname",
    "formid",
    "occurrences",
    "channel",
)


class Table(NamedTuple):
    folder: str
    logical: str
    entity_set: str
    #: The raw <OwnershipTypeMask> value in solution XML. Not the same string as
    #: the ownership model's name: Dataverse calls the model OrganizationOwned
    #: and serializes it as OrgOwned. See `ownership` below.
    ownership_mask: str
    #: The ownership model's Dataverse name, for anything a person reads. Never
    #: compared against XML.
    ownership: str
    #: Names only, or names with their shapes. Exactly one of the two.
    columns: frozenset[str] | None
    typed_columns: dict[str, Column] | None
    #: Exact view names, or None to require only that the table ships with one.
    views: frozenset[str] | None
    #: Alternate keys, by logical name, each with the columns it covers. An empty
    #: mapping means the table must carry none.
    alternate_keys: dict[str, tuple[str, ...]]
    #: Whether the table has to be in the source yet.
    required: bool
    forbidden_substrings: tuple[str, ...]


EXPECTED_TABLES = (
    Table(
        folder="ayonto_Mention",
        logical="ayonto_mention",
        entity_set="ayonto_mentions",
        # UserOwned, and deliberately not changed. Ownership decides how
        # row-level security behaves, and changing it here would be redesigning
        # a table this release is only repackaging. Model and serialization are
        # the same word for this one; the real export spells it UserOwned.
        ownership_mask="UserOwned",
        ownership="UserOwned",
        columns=LEGACY_COLUMNS,
        typed_columns=None,
        views=frozenset({"Active Mentions"}),
        # None, and asserted rather than left unsaid: this file is a verbatim
        # export, and a key appearing in it would mean somebody edited it.
        alternate_keys={},
        required=True,
        forbidden_substrings=(),
    ),
    Table(
        folder="ayonto_MentionEvent",
        logical="ayonto_mentionevent",
        entity_set="ayonto_mentionevents",
        # Organization-owned, because a Mention Event is product and system
        # state written authoritatively by the server. It is not owned by
        # whoever happened to edit the business record, and record ownership
        # must never become notification identity or authorization.
        #
        # The model is OrganizationOwned; solution XML serializes it as
        # OrgOwned. v1.1.0.1 shipped the model's name as the raw value and the
        # real managed import rejected the table with 0x80044150, "Requested
        # value 'OrganizationOwned' was not found". The raw value is what is
        # compared here, so that mistake cannot reach a package again.
        ownership_mask="OrgOwned",
        ownership="OrganizationOwned",
        columns=None,
        typed_columns=LEDGER_COLUMNS,
        # The default view Dataverse creates with a table is not something this
        # repository chooses, so the name is not asserted. That there is one is:
        # a table whose views live outside Entity.xml ships with none.
        views=None,
        # The uniqueness the ingest's idempotency rests on, in the database rather
        # than in the handler. The ingest looks for an existing event and then
        # creates one, and those are two operations: two asynchronous jobs for the
        # same episode can both find nothing and both write. A query cannot prevent
        # that and a constraint can, so `eventId` carries an alternate key.
        #
        # One column, because that is already the contract — an event identifier
        # names one episode for one recipient, so it names one row — and because it
        # is what turns the documented conflict rule into something the platform
        # enforces rather than something the handler hopes for.
        alternate_keys={"ayonto_mentionevent_ak_eventid": ("ayonto_eventid",)},
        required=True,
        forbidden_substrings=FORBIDDEN_LEDGER_SUBSTRINGS,
    ),
)

#: The relationships the legacy table exported with. Exact, and not this
#: release's to change.
LEGACY_RELATIONSHIPS = frozenset(
    {
        "business_unit_ayonto_mention",
        "lk_ayonto_mention_createdby",
        "lk_ayonto_mention_modifiedby",
        "owner_ayonto_mention",
        "team_ayonto_mention",
        "user_ayonto_mention",
    }
)

#: The only tables our own may point at. Every one of these is a platform table
#: that Dataverse wires up itself for ownership and auditing. A relationship to
#: anything else would be a link to a host application's table, and would tie
#: this reusable solution to one customer's schema.
SYSTEM_RELATIONSHIP_TARGETS = frozenset({"businessunit", "systemuser", "team", "organization", "owner"})

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
    for table in EXPECTED_TABLES:
        if table.required and table.logical not in declared:
            fail(
                f"Solution.xml declares no <RootComponent type=\"1\"> for {table.logical!r} — "
                "the table would pack without ever being part of the solution, and nothing would say so"
            )

    # Type 91 is a plug-in assembly, and its schemaName is the full assembly identity.
    # There is deliberately no type 90 here: a plug-in type is declared inside the
    # assembly's registration rather than as a root component of its own.
    assemblies = {
        component.get("schemaName", ""): component.get("behavior")
        for component in section.iter("RootComponent")
        if component.get("type") == PLUGIN_ASSEMBLY_COMPONENT_TYPE
    }
    strays = sorted(
        component.get("type", "")
        for component in section.iter("RootComponent")
        if component.get("type") == PLUGIN_TYPE_COMPONENT_TYPE
    )
    if strays:
        fail(
            "Solution.xml declares a type 90 root component. A plug-in type belongs inside "
            "the assembly's registration, not in RootComponents"
        )

    return declared, assemblies


def check_tables(declared: set[str]) -> None:
    folders = sorted(path.name for path in (SRC / "Entities").iterdir() if path.is_dir())
    known = {table.folder: table for table in EXPECTED_TABLES}

    unexpected = [folder for folder in folders if folder not in known]
    if unexpected:
        fail(f"src/Entities holds {unexpected}, which no contract in this file describes")

    for table in EXPECTED_TABLES:
        if table.folder in folders:
            check_table(table, declared)
        elif table.required:
            fail(f"src/Entities has no {table.folder} folder — this release is supposed to carry that table")
        else:
            print(f"  table {table.logical}: not in the solution source yet")


#: The ingest assembly's registration, as the generator pins it. Stated here rather
#: than imported from the generator: a checker that takes its expectations from the
#: thing it is checking agrees with every drift, including the drift nobody meant.
PLUGIN_ASSEMBLY_NAME = "Ayonto.Mention.Ingest"
PLUGIN_ASSEMBLY_FULL_NAME = (
    "Ayonto.Mention.Ingest, Version=1.0.0.0, Culture=neutral, "
    "PublicKeyToken=0e66244ba4f12435"
)
PLUGIN_TYPE_NAME = "Ayonto.Mention.Ingest.MentionIngestPlugin"
PLUGIN_TYPE_QUALIFIED_NAME = f"{PLUGIN_TYPE_NAME}, {PLUGIN_ASSEMBLY_FULL_NAME}"
PLUGIN_ASSEMBLY_ID = "a55a415c-e993-455c-ae92-eb232bb0c23e"
PLUGIN_TYPE_ID = "61728de5-8d02-493b-8603-4e5cf9c7a10c"
PLUGIN_TYPE_FRIENDLY_NAME = "9fa5e208-42b6-4708-917f-20ca989c9602"
PLUGIN_FOLDER_NAME = f"{PLUGIN_ASSEMBLY_NAME}-{PLUGIN_ASSEMBLY_ID.upper()}"
#: Include Subcomponents. The plug-in types are the subcomponents of an assembly, and
#: they have to travel with it: 1 leaves them behind, 2 ships a shell. The Microsoft
#: export and the managed solution released from it both carry 0.
PLUGIN_ROOT_BEHAVIOR = "0"
PLUGIN_PACKAGED_DLL_PATH = (
    f"/PluginAssemblies/{PLUGIN_FOLDER_NAME}/{PLUGIN_ASSEMBLY_NAME}.dll"
)


def check_plugin_registration(declared_root_components: dict[str, str | None]) -> None:
    """The ingest assembly's registration source, and the absence of its binary.

    Two failures this guards against, and they fail in opposite directions.

    Without this file the solution build stops — "Unable to find assembly registration
    configuration" — so a drift here is loud. What is quiet is a *wrong* file: an
    identifier that changed makes the next import a different component rather than an
    update of this one, and every registered step in every environment keeps pointing at
    the assembly that is no longer there. So the pinned values are asserted, not merely
    parsed.

    The other direction is the assembly itself. It must **not** be committed: the
    project reference supplies the binary the solution packs, so what ships is what CI
    built. A checked-in DLL would be shipped instead, silently, and would go stale the
    first time somebody changed the code.
    """
    folder = SRC / "PluginAssemblies"
    if not folder.is_dir():
        fail("src/PluginAssemblies is missing — the ingest assembly has no registration source")

    registrations = sorted(child for child in folder.iterdir() if child.is_dir())
    if [child.name for child in registrations] != [PLUGIN_FOLDER_NAME]:
        fail(
            f"src/PluginAssemblies holds {[c.name for c in registrations]}, expected exactly "
            f"[{PLUGIN_FOLDER_NAME!r}] — the folder name carries the pinned assembly identifier"
        )

    registration = registrations[0]
    binaries = sorted(
        child.name for child in registration.iterdir() if child.suffix.lower() == ".dll"
    )
    if binaries:
        fail(
            f"src/PluginAssemblies/{registration.name} carries the compiled assembly "
            f"{binaries[0]!r}. Only the registration configuration belongs in this tree: the "
            "solution project's reference supplies the binary, so the package ships what CI "
            "built rather than whatever was last committed"
        )

    data_file = registration / f"{PLUGIN_ASSEMBLY_NAME}.dll.data.xml"
    if not data_file.is_file():
        fail(f"{data_file.relative_to(SRC.parent)} is missing")

    root = ET.parse(data_file).getroot()
    if root.tag != "PluginAssembly":
        fail(f"{data_file.name} describes <{root.tag}>, expected <PluginAssembly>")

    checks = [
        ("FullName", root.get("FullName"), PLUGIN_ASSEMBLY_FULL_NAME),
        ("PluginAssemblyId", (root.get("PluginAssemblyId") or "").lower(), PLUGIN_ASSEMBLY_ID),
        ("FileName", root.findtext("FileName"), PLUGIN_PACKAGED_DLL_PATH),
        ("IsolationMode", root.findtext("IsolationMode"), "2"),
        ("SourceType", root.findtext("SourceType"), "0"),
    ]
    for name, found, expected in checks:
        if found != expected:
            fail(f"{data_file.name}: {name} is {found!r}, expected {expected!r}")

    types = root.findall("PluginTypes/PluginType")
    if len(types) != 1:
        fail(f"{data_file.name} declares {len(types)} plug-in types, expected exactly one")

    plugin_type = types[0]
    for name, found, expected in [
        ("Name", plugin_type.get("Name"), PLUGIN_TYPE_NAME),
        ("AssemblyQualifiedName", plugin_type.get("AssemblyQualifiedName"), PLUGIN_TYPE_QUALIFIED_NAME),
        ("PluginTypeId", (plugin_type.get("PluginTypeId") or "").lower(), PLUGIN_TYPE_ID),
        ("FriendlyName", plugin_type.findtext("FriendlyName"), PLUGIN_TYPE_FRIENDLY_NAME),
    ]:
        if found != expected:
            fail(f"{data_file.name}: PluginType {name} is {found!r}, expected {expected!r}")

    # The root component, and only type 91. A plug-in type is not a root component: it
    # is declared inside the registration above, which is what the real Microsoft
    # solution source does and what this repository's build produces.
    if PLUGIN_ASSEMBLY_FULL_NAME not in declared_root_components:
        fail(
            "Solution.xml declares no type 91 root component for "
            f"{PLUGIN_ASSEMBLY_FULL_NAME!r} — an assembly no RootComponent mentions packs "
            "without being part of the solution"
        )

    behavior = declared_root_components[PLUGIN_ASSEMBLY_FULL_NAME]
    if behavior != PLUGIN_ROOT_BEHAVIOR:
        fail(
            f"the plug-in root component's behavior is {behavior!r}, expected "
            f"{PLUGIN_ROOT_BEHAVIOR!r} — Include Subcomponents, which is what carries the "
            "plug-in types along with the assembly. 1 leaves them behind and 2 ships a "
            "shell, and either would install a handler no step could be pointed at"
        )

    print(
        f"  plug-in {PLUGIN_ASSEMBLY_NAME}: registration only, type {PLUGIN_TYPE_NAME}, "
        f"assembly id {PLUGIN_ASSEMBLY_ID}"
    )


def read_alternate_keys(root: ET.Element) -> dict[str, tuple[str, ...]]:
    """The alternate keys a table's source declares, by logical name."""
    keys: dict[str, tuple[str, ...]] = {}
    for key in root.iter("EntityKey"):
        logical = (key.findtext("LogicalName") or "").strip().lower()
        covered = tuple(
            (name.text or "").strip().lower()
            for name in key.iter("AttributeName")
            if (name.text or "").strip()
        )
        keys[logical] = covered

    return keys


def check_alternate_keys(logical: str, table: Table, columns: set[str]) -> None:
    """The keys a table carries, against the keys it is supposed to carry.

    Both directions matter. A key that went missing takes the ingest's only real
    defence against two asynchronous jobs writing the same event with it, and does
    so silently — nothing else in a build would notice. A key nobody asked for is a
    uniqueness constraint on a table this product writes, which is exactly the kind
    of thing that fails at runtime on somebody else's data.
    """
    found = read_alternate_keys(ET.parse(SRC / "Entities" / table.folder / "Entity.xml").getroot())
    if found != table.alternate_keys:
        fail(
            f"{logical}: the alternate keys drifted — found {sorted(found.items())}, "
            f"expected {sorted(table.alternate_keys.items())}"
        )

    # A key naming a column the table does not have imports as nothing useful, and
    # the packer says nothing about it.
    lowered = {column.lower() for column in columns}
    for key, covered in table.alternate_keys.items():
        for column in covered:
            if column not in lowered:
                fail(f"{logical}: the alternate key {key!r} names {column!r}, which the table has no column for")


def check_table(table: Table, declared: set[str]) -> None:
    folder = SRC / "Entities" / table.folder
    entity_file = folder / "Entity.xml"
    if not entity_file.is_file():
        fail(f"Entities/{table.folder} has no Entity.xml")

    # The packer cannot read a hand-written one, and its exception names nothing
    # but the entity it was processing.
    if (folder / "RibbonDiff.xml").is_file():
        fail(f"Entities/{table.folder}/RibbonDiff.xml — leave it out; the packer cannot read one written by hand")

    # Read by nothing. The views belong inside Entity.xml, and a table whose
    # views live here ships with no view at all.
    if (folder / "SavedQueries").is_dir():
        fail(
            f"Entities/{table.folder}/SavedQueries — the packer never reads this folder; "
            "the views belong in <SavedQueries> inside Entity.xml"
        )

    root = ET.parse(entity_file).getroot()
    described = root.find("./EntityInfo/entity")
    if described is None:
        fail(f"Entities/{table.folder}/Entity.xml has no EntityInfo/entity")

    logical = (described.get("Name") or "").lower()
    if logical != table.logical:
        fail(f"Entities/{table.folder} describes {logical!r}, expected {table.logical!r}")
    if logical not in declared:
        fail(f"the table {logical!r} has no RootComponent in Solution.xml")

    entity_set = described.findtext("EntitySetName")
    if entity_set != table.entity_set:
        fail(f"{logical}: EntitySetName is {entity_set!r}, expected {table.entity_set!r}")

    ownership = described.findtext("OwnershipTypeMask")
    if ownership != table.ownership_mask:
        fail(
            f"{logical}: OwnershipTypeMask is {ownership!r}, expected {table.ownership_mask!r} — "
            "ownership is chosen when a table is created and cannot be changed afterwards, "
            f"and solution XML serializes the {table.ownership} model as {table.ownership_mask}"
        )

    attributes = [
        attribute
        for attribute in root.iter("attribute")
        if attribute.findtext("IsCustomField") == "1" or attribute.findtext("Type") == "primarykey"
    ]
    columns = {attribute.get("PhysicalName", "") for attribute in attributes}

    for column in sorted(columns):
        lowered = column.lower()
        for forbidden in table.forbidden_substrings:
            if forbidden in lowered:
                fail(
                    f"{logical}: the column {column!r} carries {forbidden!r}. Delivery state is per "
                    "channel and is designed later, and a recipient is resolved server-side from an "
                    "identifier — never from a stored name or address"
                )

    expected = table.columns if table.columns is not None else frozenset(table.typed_columns or {})
    if columns != expected:
        missing = sorted(expected - columns)
        extra = sorted(columns - expected)
        fail(f"{logical}: the columns drifted — missing {missing}, unexpected {extra}")

    if table.typed_columns is not None:
        check_column_shapes(logical, table, attributes)

    check_alternate_keys(logical, table, columns)

    views = set()
    for query in root.iter("savedquery"):
        name = query.find("./LocalizedNames/LocalizedName")
        if name is not None:
            views.add(name.get("description", ""))
    if table.views is not None:
        if views != table.views:
            fail(f"{logical}: the table carries the views {sorted(views)}, expected {sorted(table.views)}")
    elif not views:
        fail(f"{logical}: the table carries no view at all — a table exported without one ships without one")

    print(
        f"  table {logical}: {table.ownership}, {len(columns)} columns, "
        f"{len(views)} view(s), {len(table.alternate_keys)} alternate key(s), set {entity_set}"
    )


def check_column_shapes(logical: str, table: Table, attributes: list[ET.Element]) -> None:
    """The ledger's columns, down to the shapes the server was written against."""
    expected = table.typed_columns or {}
    problems: list[str] = []

    for attribute in attributes:
        name = attribute.get("PhysicalName", "")
        wanted = expected.get(name)
        if wanted is None:
            continue

        found_type = attribute.findtext("Type")
        if found_type != wanted.type:
            problems.append(f"{name}: type {found_type!r}, expected {wanted.type!r}")
            # Everything below is read in terms of the type, so stop on this one.
            continue

        # A lookup would tie this reusable solution to a host table or to
        # systemuser. The recipient, the actor and the source row are scalar
        # identifiers precisely so that they are not relationships.
        if found_type in ("lookup", "customer", "owner"):
            problems.append(f"{name}: is a {found_type}; this table carries no lookups")
            continue

        if wanted.format is not None:
            found_format = attribute.findtext("Format")
            if found_format != wanted.format:
                problems.append(f"{name}: format {found_format!r}, expected {wanted.format!r}")

        if wanted.max_length is not None:
            found_length = attribute.findtext("MaxLength")
            if found_length != str(wanted.max_length):
                problems.append(f"{name}: max length {found_length!r}, expected {wanted.max_length}")

        found_required = attribute.findtext("RequiredLevel")
        if found_required != wanted.required:
            problems.append(f"{name}: required level {found_required!r}, expected {wanted.required!r}")

    lookups = [
        attribute.get("PhysicalName", "")
        for attribute in attributes
        if attribute.findtext("Type") in ("lookup", "customer", "owner")
    ]
    for lookup in lookups:
        problems.append(f"{lookup}: is a lookup; this table carries no lookups")

    if problems:
        detail = "; ".join(sorted(set(problems)))
        fail(f"{logical}: the exported schema is not the schema this product asked for — {detail}")


def check_relationships() -> None:
    path = SRC / "Other" / "Relationships.xml"
    if not path.is_file():
        fail("src/Other/Relationships.xml is missing")

    nodes = list(ET.parse(path).getroot().iter("EntityRelationship"))
    found = {node.get("Name", "") for node in nodes}

    missing = sorted(LEGACY_RELATIONSHIPS - found)
    if missing:
        fail(f"relationships drifted — missing {missing}")

    ours = {table.logical for table in EXPECTED_TABLES}
    for node in nodes:
        name = node.get("Name", "")
        if name in LEGACY_RELATIONSHIPS:
            continue
        referencing = (node.findtext("ReferencingEntityName") or "").lower()
        referenced = (node.findtext("ReferencedEntityName") or "").lower()
        if referencing not in ours:
            fail(
                f"relationship {name!r} is declared on {referencing!r}, which is not a table of this "
                "solution"
            )
        if referenced not in SYSTEM_RELATIONSHIP_TARGETS:
            fail(
                f"relationship {name!r} points at {referenced!r}. This solution is reusable and "
                "host-independent: a relationship to a host application's table belongs to the host "
                "solution, not to this one"
            )

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
    declared, assemblies = check_manifest()
    check_tables(declared)
    check_plugin_registration(assemblies)
    check_relationships()
    check_customizations()
    print(f"solution source: {files} XML file(s) checked, {SOLUTION_UNIQUE_NAME} contract holds")


if __name__ == "__main__":
    main()
