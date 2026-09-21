#!/usr/bin/env python3
"""Reads a built solution package and refuses to let a wrong one be published.

A successful SolutionPackager run is not evidence that the package is right.
It reports a component it could not take as a line in its log and then packs
what it has, exits zero, and the build goes green around a package that is
missing something. So the artifact itself is opened and read, and every claim
made about it on the release page is checked here first.

What this release is allowed to contain is deliberately narrow: the Ayonto
Mention code component and the two tables, and nothing else. No flows, no
connection references, no environment variables.

The **plug-in assembly is the one component with a gate rather than a verdict.**
The ingest exists in this repository, as a net48 assembly under `server/`, and the
base solution is where it belongs — but a solution can only carry a plug-in
assembly alongside the registration configuration that names it, and that
configuration comes out of a real environment. So the expectation is written down
here in full and switched off by `PLUGIN_ASSEMBLY_REQUIRED`: until it is on, a
package carrying a plug-in assembly is refused and the refusal names the gate;
once it is on, the package has to carry exactly this product's assembly and
plug-in type and nothing else. See `server/README.md`.

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
from typing import NamedTuple
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
#: Type 66 is a custom control, type 1 an entity, 90 a plug-in type and 91 a
#: plug-in assembly. See the solution component type table.
CUSTOM_CONTROL_COMPONENT_TYPE = "66"
ENTITY_COMPONENT_TYPE = "1"
PLUGIN_TYPE_COMPONENT_TYPE = "90"
PLUGIN_ASSEMBLY_COMPONENT_TYPE = "91"

#: Whether the package is expected to carry the server-side ingest assembly.
#:
#: **Off, and that is a statement about packaging rather than about the code.** The
#: ingest is implemented and tested under `server/`; what is missing is the piece
#: SolutionPackager needs in order to pack an assembly at all. Referencing the
#: plug-in project from the solution project is the documented mechanism — `pac
#: solution add-reference` writes it, and the solution targets then look for the
#: assembly's registration configuration under `PluginAssemblies/` in the solution
#: source. That configuration is an export artifact: it carries the PluginAssembly
#: and PluginType identifiers a Dataverse environment assigned. Until the ingest has
#: been registered in an environment and exported, there is nothing to pack, and
#: hand-writing that XML is exactly the kind of invented table metadata this
#: repository refuses to carry.
#:
#: Flip this to True in the same change that adds the registration configuration and
#: the project reference. Nothing else about this file has to move.
PLUGIN_ASSEMBLY_REQUIRED = False

#: The assembly and the plug-in type this product would ship, named so that the
#: check is about *which* assembly rather than about there being one.
PLUGIN_ASSEMBLY_NAME = "Ayonto.Mention.Ingest"
PLUGIN_TYPE_NAME = "Ayonto.Mention.Ingest.MentionIngestPlugin"

#: The tables this package installs.
#:
#: Stated here rather than read out of the source tree: a checker that takes its
#: expectations from the thing it is checking agrees with every drift, including
#: the drift somebody did not mean to make.
#:
#: What this file asks of them is what *packaging* can get wrong — the table is
#: missing, it is the wrong table, it lost its view, it grew a link to something
#: else. The per-column shapes of the event ledger are checked where the source
#: is checked, on the same content that is packed here, rather than written out
#: twice and left to drift apart.
class PackagedTable(NamedTuple):
    schema: str
    logical: str
    entity_set: str
    #: The raw <OwnershipTypeMask> value in the packaged solution XML. Dataverse
    #: names the ownership model OrganizationOwned and serializes it as
    #: OrgOwned; this is the serialized half. See `ownership` below.
    ownership_mask: str
    #: The ownership model's Dataverse name, for anything a person reads.
    ownership: str
    columns: frozenset[str]
    #: Exact view names, or None to require only that the table ships with one.
    views: frozenset[str] | None
    #: Whether the package has to carry it yet.
    required: bool
    forbidden_substrings: tuple[str, ...]


LEGACY_TABLE = PackagedTable(
    schema="ayonto_Mention",
    logical="ayonto_mention",
    entity_set="ayonto_mentions",
    # UserOwned, exactly as exported. Ownership decides how row-level security
    # behaves, so a package that changed it would be a different table wearing
    # the same name. Model and serialization are the same word for this one.
    ownership_mask="UserOwned",
    ownership="UserOwned",
    columns=frozenset(
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
    ),
    views=frozenset({"Active Mentions"}),
    required=True,
    forbidden_substrings=(),
)

LEDGER_TABLE = PackagedTable(
    schema="ayonto_MentionEvent",
    logical="ayonto_mentionevent",
    entity_set="ayonto_mentionevents",
    # Organization-owned: a Mention Event is product and system state written
    # authoritatively by the server, not something owned by whoever edited the
    # business record.
    #
    # The model is OrganizationOwned; solution XML serializes it as OrgOwned.
    # The v1.1.0.1 package carried the model's name as the raw value and the
    # real managed import rejected the table with 0x80044150, "Requested value
    # 'OrganizationOwned' was not found". The serialized value is what is
    # checked, so no package leaves here with that mistake again.
    ownership_mask="OrgOwned",
    ownership="OrganizationOwned",
    columns=frozenset(
        {
            "ayonto_MentionEventId",
            "ayonto_Name",
            "ayonto_EventId",
            "ayonto_RecordTable",
            "ayonto_RecordId",
            "ayonto_SourceField",
            "ayonto_RecipientUserId",
            "ayonto_InitiatingUserId",
            "ayonto_ConfigSchemaVersion",
            "ayonto_EmailEnabled",
            "ayonto_EmailSubject",
            "ayonto_EmailBody",
            "ayonto_EmailLinkText",
            "ayonto_TeamsEnabled",
            "ayonto_TeamsTitle",
            "ayonto_TeamsBody",
            "ayonto_TeamsLinkText",
            "ayonto_InAppEnabled",
            "ayonto_InAppTitle",
            "ayonto_InAppBody",
            "ayonto_InAppLinkText",
        }
    ),
    # Dataverse names the default view; this repository does not choose it. That
    # there is one is the thing worth asserting.
    views=None,
    required=True,
    forbidden_substrings=(
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
    ),
)

EXPECTED_TABLES = (LEGACY_TABLE, LEDGER_TABLE)

#: The ownership relationships Dataverse gives the user-owned legacy table. The
#: event ledger adds its own platform relationships, whose names and number are
#: the platform's to decide — so the count is a floor, and every relationship is
#: held to pointing at a platform table rather than at a host application's.
MINIMUM_RELATIONSHIPS = 6
#: The only tables ours may point at. A relationship to anything else would tie
#: this reusable solution to one customer's schema.
SYSTEM_RELATIONSHIP_TARGETS = frozenset({"businessunit", "systemuser", "team", "organization", "owner"})

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
#: `pluginassemblies/` is deliberately not in this list: plug-in content is judged
#: by `check_plugin` below, which knows whether it is expected and which assembly it
#: would have to be.
FORBIDDEN_PATH_PARTS = (
    "workflows/",
    "webresources/",
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
#: `SolutionPluginAssemblies` left this list when the ingest was written: whether it
#: may carry something is `check_plugin`'s question, not a constant's.
MUST_BE_EMPTY = (
    "Workflows",
    "Roles",
    "Templates",
    "EntityMaps",
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
    solution_xml: bytes,
    version: str,
    managed: bool,
    plugin_components: frozenset[tuple[str, str]] = frozenset(),
) -> None:
    """The identity the package claims, against the identity it should have.

    `plugin_components` is what `check_plugin` decided the package's plug-in content
    amounts to: empty while the gate is closed, and the assembly plus its plug-in
    type once it is open. It arrives as an argument rather than being read again
    here so that one function decides the plug-in question.
    """
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

    # The tables this release installs, plus the code component. Named rather
    # than counted loosely, because "some number of things" is not the check —
    # which things is.
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

    expected = {(CUSTOM_CONTROL_COMPONENT_TYPE, CONTROL_SCHEMA_NAME)}
    expected |= {
        (ENTITY_COMPONENT_TYPE, table.logical) for table in EXPECTED_TABLES if table.required
    }
    expected |= set(plugin_components)
    # A table that is not required yet may still be declared — the release that
    # first ships it declares it before the flag above is flipped.
    optional = {
        (ENTITY_COMPONENT_TYPE, table.logical) for table in EXPECTED_TABLES if not table.required
    }
    declared_optional = declared & optional
    expected |= declared_optional
    if declared != expected:
        missing = sorted(expected - declared)
        unexpected = sorted(declared - expected)
        raise PackageError(
            f"root components are wrong — missing {missing}, unexpected {unexpected}"
        )


def check_tables(root: ElementTree.Element) -> None:
    """The tables this release exists to install, against the tables they should be.

    Required, not merely tolerated. A package that imports cleanly and leaves the
    environment without the table is the failure this whole file is here to
    catch, and from v1.1.0 that failure has a direction it did not have before.
    """
    entities = root.findall("Entities/Entity")
    packaged = {entity.findtext("Name") or "": entity for entity in entities}

    known = {table.schema for table in EXPECTED_TABLES}
    unexpected = sorted(set(packaged) - known)
    if unexpected:
        raise PackageError(f"the package carries the table(s) {unexpected}, which this release does not install")

    for table in EXPECTED_TABLES:
        entity = packaged.get(table.schema)
        if entity is None:
            if table.required:
                raise PackageError(f"the package carries no {table.schema!r} table")
            continue
        check_table(table, entity)

    relationships = root.findall("EntityRelationships/EntityRelationship")
    if len(relationships) < MINIMUM_RELATIONSHIPS:
        raise PackageError(
            f"the package carries {len(relationships)} relationship(s), expected at least "
            f"{MINIMUM_RELATIONSHIPS} — the ownership relationships of the user-owned table"
        )

    ours = {table.logical for table in EXPECTED_TABLES}
    for relationship in relationships:
        name = relationship.get("Name", "")
        referencing = (relationship.findtext("ReferencingEntityName") or "").lower()
        referenced = (relationship.findtext("ReferencedEntityName") or "").lower()
        if referencing not in ours:
            raise PackageError(f"relationship {name!r} is declared on {referencing!r}, which is not a table of this solution")
        if referenced not in SYSTEM_RELATIONSHIP_TARGETS:
            raise PackageError(
                f"relationship {name!r} points at {referenced!r} — this solution is reusable and "
                "host-independent, and a link to a host application's table belongs to the host solution"
            )


def check_table(table: PackagedTable, entity: ElementTree.Element) -> None:
    described = entity.find("./EntityInfo/entity")
    if described is None:
        raise PackageError(f"the packaged table {table.schema!r} has no EntityInfo/entity")

    entity_set = described.findtext("EntitySetName")
    if entity_set != table.entity_set:
        raise PackageError(f"{table.logical}: EntitySetName is {entity_set!r}, expected {table.entity_set!r}")

    ownership = described.findtext("OwnershipTypeMask")
    if ownership != table.ownership_mask:
        raise PackageError(
            f"{table.logical}: the table is {ownership!r}, expected {table.ownership_mask!r} — "
            "ownership decides how row-level security behaves and is not a packaging detail, "
            f"and solution XML serializes the {table.ownership} model as {table.ownership_mask}"
        )

    columns = {
        attribute.get("PhysicalName", "")
        for attribute in entity.iter("attribute")
        if attribute.findtext("IsCustomField") == "1"
        or attribute.findtext("Type") == "primarykey"
    }

    for column in sorted(columns):
        lowered = column.lower()
        for forbidden in table.forbidden_substrings:
            if forbidden in lowered:
                raise PackageError(
                    f"{table.logical}: the column {column!r} carries {forbidden!r}. Delivery state is "
                    "per channel and is designed later, and a recipient is resolved server-side from "
                    "an identifier — never from a stored name or address"
                )

    if columns != table.columns:
        missing = sorted(table.columns - columns)
        unexpected = sorted(columns - table.columns)
        raise PackageError(
            f"{table.logical}: the table's columns are wrong — missing {missing}, unexpected {unexpected}"
        )

    lookups = sorted(
        attribute.get("PhysicalName", "")
        for attribute in entity.iter("attribute")
        if attribute.findtext("IsCustomField") == "1"
        and attribute.findtext("Type") in ("lookup", "customer", "owner")
    )
    if lookups and table is LEDGER_TABLE:
        raise PackageError(
            f"{table.logical}: carries the lookup column(s) {lookups}. The recipient, the actor and "
            "the source row are scalar identifiers precisely so that this solution needs no link to "
            "a host table or to systemuser"
        )

    views = set()
    for query in entity.iter("savedquery"):
        localized = query.find("./LocalizedNames/LocalizedName")
        if localized is not None:
            views.add(localized.get("description", ""))
    if table.views is not None:
        if views != table.views:
            raise PackageError(
                f"{table.logical}: the table carries the views {sorted(views)}, expected "
                f"{sorted(table.views)} — a view configured outside Entity.xml is packed silently "
                "into nothing"
            )
    elif not views:
        raise PackageError(
            f"{table.logical}: the table carries no view at all — a view configured outside "
            "Entity.xml is packed silently into nothing"
        )


def check_plugin(
    names: list[str],
    solution_xml: bytes,
    customizations_xml: bytes,
    required: bool = PLUGIN_ASSEMBLY_REQUIRED,
) -> tuple[frozenset[str], frozenset[tuple[str, str]]]:
    """Decides the plug-in question once, for the files, the manifest and the XML.

    Returns the package paths that the plug-in legitimately accounts for, and the
    root components the manifest is then expected to declare — so the allowlist and
    the manifest check can both be told the answer rather than each guessing at it.

    While the gate is closed the answer is "none of it", and the refusal says why
    rather than only that: an assembly reaching a package before its registration
    configuration exists means the solution source grew hand-written PluginAssembly
    XML, which is the failure mode worth naming.

    Once the gate is open the question becomes *which* assembly. A plug-in assembly
    is code that runs with the privileges of whoever registered it, so a package
    that carries one nobody named is a worse surprise than a package that carries
    none.
    """
    plugin_paths = frozenset(
        name for name in names if name.lower().startswith("pluginassemblies/")
    )

    customizations = ElementTree.fromstring(customizations_xml)
    declared_assemblies = customizations.findall("SolutionPluginAssemblies/PluginAssembly")

    solution = ElementTree.fromstring(solution_xml)
    manifest = solution.find("SolutionManifest")
    if manifest is None:
        raise PackageError("no SolutionManifest in solution.xml")
    plugin_roots = {
        (component.get("type"), component.get("schemaName"))
        for component in manifest.findall("RootComponents/RootComponent")
        if component.get("type") in (PLUGIN_ASSEMBLY_COMPONENT_TYPE, PLUGIN_TYPE_COMPONENT_TYPE)
    }

    if not required:
        if plugin_paths or declared_assemblies or plugin_roots:
            raise PackageError(
                "the package carries plug-in content, and this release is not supposed "
                f"to: the ingest assembly {PLUGIN_ASSEMBLY_NAME!r} can only be packed "
                "alongside a registration configuration exported from a real "
                "environment, and PLUGIN_ASSEMBLY_REQUIRED is still False. If the "
                "registration now exists, that flag and the solution project's "
                "reference are the deliberate change — not a package that grew an "
                "assembly on its own"
            )
        return frozenset(), frozenset()

    if not plugin_paths:
        raise PackageError(
            f"the package carries no plug-in assembly, and {PLUGIN_ASSEMBLY_NAME!r} is "
            "expected in it"
        )

    foreign = sorted(
        path
        for path in plugin_paths
        if PLUGIN_ASSEMBLY_NAME.lower() not in path.lower()
    )
    if foreign:
        raise PackageError(
            f"the package carries the plug-in file {foreign[0]!r}, which is not part of "
            f"{PLUGIN_ASSEMBLY_NAME!r} — a plug-in assembly runs with the privileges of "
            "whoever registered it, and this solution ships exactly one"
        )

    assembly_names = sorted(
        (assembly.findtext("Name") or "") for assembly in declared_assemblies
    )
    if assembly_names != [PLUGIN_ASSEMBLY_NAME]:
        raise PackageError(
            f"customizations.xml declares the plug-in assemblies {assembly_names}, "
            f"expected exactly [{PLUGIN_ASSEMBLY_NAME!r}]"
        )

    types = sorted(
        (plugin_type.findtext("TypeName") or "")
        for assembly in declared_assemblies
        for plugin_type in assembly.iter("PluginType")
    )
    if types != [PLUGIN_TYPE_NAME]:
        raise PackageError(
            f"the packaged assembly declares the plug-in types {types}, expected "
            f"exactly [{PLUGIN_TYPE_NAME!r}] — the ingest is one handler, and a type "
            "nobody named is a handler nobody reviewed"
        )

    # Steps belong to the host solution, not to this one. "Sdk Message Processing
    # Steps are also solution components and must also be added to an unmanaged
    # solution in order to be distributed" — and the step this ingest needs names a
    # customer's own table, which a reusable base solution must never contain.
    steps = [
        step
        for assembly in declared_assemblies
        for step in assembly.iter("SdkMessageProcessingStep")
    ]
    if steps:
        raise PackageError(
            "the package carries an SDK message processing step. A step names the host "
            "table it is registered against, and that belongs to the host solution — "
            "this one is reusable and must not contain a customer's table name"
        )

    expected_roots = {
        (PLUGIN_ASSEMBLY_COMPONENT_TYPE, PLUGIN_ASSEMBLY_NAME),
        (PLUGIN_TYPE_COMPONENT_TYPE, PLUGIN_TYPE_NAME),
    }
    if plugin_roots != expected_roots:
        raise PackageError(
            f"the plug-in root components are wrong — missing "
            f"{sorted(expected_roots - plugin_roots)}, unexpected "
            f"{sorted(plugin_roots - expected_roots)}"
        )

    return plugin_paths, frozenset(expected_roots)


def check_customizations(customizations_xml: bytes) -> None:
    """One code component, the tables this release installs, and none of the things a server side would add."""
    root = ElementTree.fromstring(customizations_xml)

    check_tables(root)

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

            solution_xml = package.read("solution.xml")
            customizations_xml = package.read("customizations.xml")
            plugin_paths, plugin_components = check_plugin(
                names, solution_xml, customizations_xml
            )

            present = set(names)
            missing = EXPECTED_FILES - present
            if missing:
                raise PackageError(
                    f"missing from the package: {', '.join(sorted(missing))}"
                )
            # The plug-in's own files cannot be named exactly: SolutionPackager puts
            # them under a folder carrying the assembly's identifier. They are
            # accounted for by `check_plugin`, which has already established that
            # every one of them belongs to this product's assembly.
            unexpected = present - EXPECTED_FILES - plugin_paths
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

            check_solution_manifest(solution_xml, version, managed, plugin_components)
            check_customizations(customizations_xml)
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
