#!/usr/bin/env python3
"""Derives the ayonto_mentionevent table source from real Dataverse exports.

Read this before trusting the file it writes.

The repository rule has been that table metadata comes from a real Dataverse
export, never from XML somebody typed. This script is a deliberate, documented
exception to that rule, and the reason is practical: the development environment
cannot run the provisioning tooling that would have created the table there, so
the table has to reach Dataverse the other way round — described in the solution
source and created by the managed import.

What keeps that from being guesswork is that nothing here invents XML. Every
element is copied from an export a real Dataverse produced, and only names,
labels, lengths and requirement levels are substituted:

  * the table skeleton, the system attributes, the primary key and the string
    and memo shapes come from this repository's own `ayonto_Mention/Entity.xml`,
    which is byte-identical to the export committed in the legacy repository;

  * the whole-number and two-option shapes come from Microsoft's own published
    solution exports, because the legacy table has neither. They are reproduced
    verbatim below with their source path, and only their names and labels are
    changed.

What could not be taken from any export is marked `UNVERIFIED` in this file.
There is no public Dataverse export of an OrganizationOwned custom table to copy
an ownership model from, so those few elements are reasoned from Microsoft's
published table reference and from how this repository's own UserOwned export
names the equivalent ownership parts. The managed import into a real environment
is what decides whether that reasoning was right.

The output is committed. This script exists so the derivation can be read and
repeated, not so the file is regenerated on every build: the component
identifiers below are pinned for exactly that reason.

    python3 tools/powerplatform/generate-mentionevent-entity.py
"""

from __future__ import annotations

import copy
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEGACY = ROOT / "powerplatform" / "src" / "Entities" / "ayonto_Mention" / "Entity.xml"
TARGET = ROOT / "powerplatform" / "src" / "Entities" / "ayonto_MentionEvent" / "Entity.xml"

LEGACY_SCHEMA = "ayonto_Mention"
LEGACY_LOGICAL = "ayonto_mention"
SCHEMA = "ayonto_MentionEvent"
LOGICAL = "ayonto_mentionevent"
ENTITY_SET = "ayonto_mentionevents"

DISPLAY_NAME = "Mention"
DISPLAY_COLLECTION = "Mentions"
DESCRIPTION = (
    "One mention episode for one recipient, with the notification configuration "
    "that applied when the event was created."
)

#: Pinned once and committed. A component identifier that changed on every run
#: would make every build a different solution.
VIEW_ID = "{b7c4e21a-3f96-4c58-9d0e-5a1f8c62d403}"

#: Dropped: ownership belongs to the organization, not to a user or a team.
USER_OWNED_ATTRIBUTES = ("OwnerId", "OwningBusinessUnit", "OwningTeam", "OwningUser")

#: A GUID written as text, canonical and lowercase. 36 characters and no more.
GUID = 36

# (PhysicalName, kind, max length, required, display name, description)
COLUMNS: list[tuple[str, str, int | None, bool, str, str]] = [
    ("ayonto_Name", "nvarchar", 200, True, "Name",
     "Readable label for this event. Not part of its identity."),
    ("ayonto_EventId", "nvarchar", GUID, True, "Event Id",
     "Mention episode identifier, canonical lowercase GUID."),
    ("ayonto_RecordTable", "nvarchar", 128, True, "Record Table",
     "Logical name of the table the mention was written on."),
    ("ayonto_RecordId", "nvarchar", GUID, True, "Record Id",
     "Identifier of the business row, canonical lowercase GUID."),
    ("ayonto_SourceField", "nvarchar", 128, True, "Source Field",
     "Logical name of the text column the mention was written in."),
    ("ayonto_RecipientUserId", "nvarchar", GUID, True, "Recipient User Id",
     "Identifier of the mentioned user, canonical lowercase GUID."),
    ("ayonto_InitiatingUserId", "nvarchar", GUID, True, "Initiating User Id",
     "Identifier of the user whose save created the event, from the trusted execution context."),
    ("ayonto_ConfigSchemaVersion", "int", None, True, "Configuration Schema Version",
     "Shape of the notification configuration snapshot carried by this row."),
    ("ayonto_EmailEnabled", "bit", None, True, "Email Enabled",
     "Whether email was enabled for this field when the event was created."),
    ("ayonto_EmailSubject", "nvarchar", 4000, False, "Email Subject",
     "Subject for the email notification."),
    ("ayonto_EmailBody", "ntext", 100000, False, "Email Message",
     "Message body for the email notification."),
    ("ayonto_EmailLinkText", "nvarchar", 4000, False, "Email Link Text",
     "Link text for the email notification."),
    ("ayonto_TeamsEnabled", "bit", None, True, "Teams Enabled",
     "Whether Teams was enabled for this field when the event was created."),
    ("ayonto_TeamsTitle", "nvarchar", 4000, False, "Teams Title",
     "Title for the Teams notification."),
    ("ayonto_TeamsBody", "ntext", 100000, False, "Teams Message",
     "Message body for the Teams notification."),
    ("ayonto_TeamsLinkText", "nvarchar", 4000, False, "Teams Link Text",
     "Link text for the Teams notification."),
    ("ayonto_InAppEnabled", "bit", None, True, "In-App Enabled",
     "Whether in-app notification was enabled for this field when the event was created."),
    ("ayonto_InAppTitle", "nvarchar", 4000, False, "In-App Title",
     "Title for the in-app notification."),
    ("ayonto_InAppBody", "ntext", 100000, False, "In-App Message",
     "Message body for the in-app notification."),
    ("ayonto_InAppLinkText", "nvarchar", 4000, False, "In-App Link Text",
     "Link text for the in-app notification."),
]

# Reproduced verbatim from a real Microsoft solution export, because this
# repository's own export has no two-option column to copy:
#   microsoft/Templates-for-Power-Platform
#   Solutions/mpa_Kudos/src/Entities/mpa_optoutuser/Entity.xml
BIT_TEMPLATE = """<attribute PhysicalName="PLACEHOLDER">
          <Type>bit</Type>
          <Name>placeholder</Name>
          <LogicalName>placeholder</LogicalName>
          <RequiredLevel>none</RequiredLevel>
          <DisplayMask>ValidForAdvancedFind|ValidForForm|ValidForGrid</DisplayMask>
          <ImeMode>auto</ImeMode>
          <ValidForUpdateApi>1</ValidForUpdateApi>
          <ValidForReadApi>1</ValidForReadApi>
          <ValidForCreateApi>1</ValidForCreateApi>
          <IsCustomField>1</IsCustomField>
          <IsAuditEnabled>1</IsAuditEnabled>
          <IsSecured>0</IsSecured>
          <IntroducedVersion>1.0.0.0</IntroducedVersion>
          <IsCustomizable>1</IsCustomizable>
          <IsRenameable>1</IsRenameable>
          <CanModifySearchSettings>1</CanModifySearchSettings>
          <CanModifyRequirementLevelSettings>1</CanModifyRequirementLevelSettings>
          <CanModifyAdditionalSettings>1</CanModifyAdditionalSettings>
          <SourceType>0</SourceType>
          <IsGlobalFilterEnabled>0</IsGlobalFilterEnabled>
          <IsSortableEnabled>0</IsSortableEnabled>
          <CanModifyGlobalFilterSettings>1</CanModifyGlobalFilterSettings>
          <CanModifyIsSortableSettings>1</CanModifyIsSortableSettings>
          <IsDataSourceSecret>0</IsDataSourceSecret>
          <AutoNumberFormat />
          <IsSearchable>0</IsSearchable>
          <IsFilterable>0</IsFilterable>
          <IsRetrievable>1</IsRetrievable>
          <IsLocalizable>0</IsLocalizable>
          <AppDefaultValue>0</AppDefaultValue>
          <optionset Name="OPTIONSET">
            <OptionSetType>bit</OptionSetType>
            <IntroducedVersion>1.0.0.0</IntroducedVersion>
            <IsCustomizable>1</IsCustomizable>
            <ExternalTypeName />
            <displaynames>
              <displayname description="DISPLAY" languagecode="1033" />
            </displaynames>
            <Descriptions>
              <Description description="DESCRIPTION" languagecode="1033" />
            </Descriptions>
            <options>
              <option value="1" ExternalValue="">
                <labels>
                  <label description="Yes" languagecode="1033" />
                </labels>
              </option>
              <option value="0" ExternalValue="">
                <labels>
                  <label description="No" languagecode="1033" />
                </labels>
              </option>
            </options>
          </optionset>
          <displaynames>
            <displayname description="DISPLAY" languagecode="1033" />
          </displaynames>
          <Descriptions>
            <Description description="DESCRIPTION" languagecode="1033" />
          </Descriptions>
        </attribute>"""

# Reproduced verbatim from a real Microsoft solution export, for the same reason:
#   microsoft/Templates-for-Power-Platform
#   Solutions/mpa_Kudos/src/Entities/mpa_Badge/Entity.xml
INT_TEMPLATE = """<attribute PhysicalName="PLACEHOLDER">
          <Type>int</Type>
          <Name>placeholder</Name>
          <LogicalName>placeholder</LogicalName>
          <RequiredLevel>none</RequiredLevel>
          <DisplayMask>ValidForAdvancedFind|ValidForForm|ValidForGrid</DisplayMask>
          <ImeMode>disabled</ImeMode>
          <ValidForUpdateApi>1</ValidForUpdateApi>
          <ValidForReadApi>1</ValidForReadApi>
          <ValidForCreateApi>1</ValidForCreateApi>
          <IsCustomField>1</IsCustomField>
          <IsAuditEnabled>1</IsAuditEnabled>
          <IsSecured>0</IsSecured>
          <IntroducedVersion>1.0.0.0</IntroducedVersion>
          <IsCustomizable>1</IsCustomizable>
          <IsRenameable>1</IsRenameable>
          <CanModifySearchSettings>1</CanModifySearchSettings>
          <CanModifyRequirementLevelSettings>1</CanModifyRequirementLevelSettings>
          <CanModifyAdditionalSettings>1</CanModifyAdditionalSettings>
          <SourceType>0</SourceType>
          <IsGlobalFilterEnabled>0</IsGlobalFilterEnabled>
          <IsSortableEnabled>0</IsSortableEnabled>
          <CanModifyGlobalFilterSettings>1</CanModifyGlobalFilterSettings>
          <CanModifyIsSortableSettings>1</CanModifyIsSortableSettings>
          <IsDataSourceSecret>0</IsDataSourceSecret>
          <AutoNumberFormat />
          <IsSearchable>0</IsSearchable>
          <IsFilterable>0</IsFilterable>
          <IsRetrievable>1</IsRetrievable>
          <IsLocalizable>0</IsLocalizable>
          <Format>none</Format>
          <MinValue>1</MinValue>
          <MaxValue>2147483647</MaxValue>
          <displaynames>
            <displayname description="DISPLAY" languagecode="1033" />
          </displaynames>
          <Descriptions>
            <Description description="DESCRIPTION" languagecode="1033" />
          </Descriptions>
        </attribute>"""


def text(parent: ET.Element, tag: str, value: str) -> None:
    node = parent.find(tag)
    if node is None:
        raise SystemExit(f"the legacy export has no <{tag}> to set")
    node.text = value


def set_labels(attribute: ET.Element, display: str, description: str) -> None:
    for node in attribute.iter("displayname"):
        node.set("description", display)
    for node in attribute.iter("Description"):
        node.set("description", description)


def rename(attribute: ET.Element, physical: str) -> None:
    attribute.set("PhysicalName", physical)
    text(attribute, "Name", physical.lower())
    text(attribute, "LogicalName", physical.lower())


def build_string(template: ET.Element, column: tuple) -> ET.Element:
    physical, kind, length, required, display, description = column
    new = copy.deepcopy(template)
    rename(new, physical)
    text(new, "RequiredLevel", "required" if required else "none")
    text(new, "MaxLength", str(length))
    # The legacy export carries Length as twice MaxLength for every string
    # column it has; memo columns carry no Length element at all.
    if new.find("Length") is not None:
        text(new, "Length", str(length * 2))
    mask = "ValidForAdvancedFind|ValidForForm|ValidForGrid"
    if physical == "ayonto_Name":
        # How the export marks the primary name column. There is no separate
        # element for it.
        mask = "PrimaryName|" + mask + "|RequiredForForm"
    text(new, "DisplayMask", mask)
    text(new, "IsSearchable", "1" if physical == "ayonto_Name" else "0")
    set_labels(new, display, description)
    return new


def build_from_template(raw: str, column: tuple) -> ET.Element:
    physical, kind, _, required, display, description = column
    filled = (
        raw.replace("PLACEHOLDER", physical)
        .replace("OPTIONSET", f"{LOGICAL}_{physical.lower()}")
        .replace(">placeholder<", f">{physical.lower()}<")
        .replace("DISPLAY", display)
        .replace("DESCRIPTION", description)
    )
    new = ET.fromstring(filled)
    text(new, "RequiredLevel", "required" if required else "none")
    return new


def main() -> int:
    tree = ET.parse(LEGACY)
    root = tree.getroot()
    text(root, "Name", SCHEMA)

    entity = root.find("./EntityInfo/entity")
    if entity is None:
        raise SystemExit("the legacy export has no EntityInfo/entity")
    entity.set("Name", SCHEMA)

    for node in entity.find("LocalizedNames").iter("LocalizedName"):
        node.set("description", DISPLAY_NAME)
    for node in entity.find("LocalizedCollectionNames").iter("LocalizedCollectionName"):
        node.set("description", DISPLAY_COLLECTION)
    for node in entity.find("Descriptions").iter("Description"):
        node.set("description", DESCRIPTION)

    text(entity, "EntitySetName", ENTITY_SET)
    # UNVERIFIED against a real export: no public Dataverse export of an
    # OrganizationOwned custom table exists to copy. Microsoft's table reference
    # documents that such tables carry OrganizationId and none of the user or
    # team ownership columns, which is what is done below.
    text(entity, "OwnershipTypeMask", "OrganizationOwned")

    attributes = entity.find("attributes")
    templates: dict[str, ET.Element] = {}
    primary_key: ET.Element | None = None
    system: list[ET.Element] = []
    business_unit: ET.Element | None = None

    for attribute in list(attributes):
        physical = attribute.get("PhysicalName", "")
        kind = attribute.findtext("Type") or ""
        attributes.remove(attribute)

        if kind == "primarykey":
            primary_key = attribute
            continue
        if physical == "OwningBusinessUnit":
            business_unit = attribute
            continue
        if physical in USER_OWNED_ATTRIBUTES:
            continue
        if attribute.findtext("IsCustomField") == "1":
            templates.setdefault(kind, attribute)
            continue
        system.append(attribute)

    if primary_key is None or business_unit is None:
        raise SystemExit("the legacy export is missing the attributes this derivation needs")
    for needed in ("nvarchar", "ntext"):
        if needed not in templates:
            raise SystemExit(f"the legacy export has no {needed} column to use as a template")

    rename(primary_key, f"{SCHEMA}Id")
    set_labels(primary_key, "Mention", "Unique identifier for this mention event.")

    # UNVERIFIED against a real export, for the same reason as the ownership
    # mask: modelled on the legacy export's own business-unit lookup, retargeted
    # at the organization exactly as the documented OrganizationOwned model
    # describes.
    organization = copy.deepcopy(business_unit)
    rename(organization, "OrganizationId")
    text(organization, "RequiredLevel", "systemrequired")
    # The real export leaves <LookupTypes /> empty on its ownership lookups, so
    # this one is left exactly as it was copied rather than filled in.
    set_labels(organization, "Organization", "Unique identifier of the organization this event belongs to.")

    for column in COLUMNS:
        kind = column[1]
        if kind in ("nvarchar", "ntext"):
            attributes.append(build_string(templates[kind], column))
        elif kind == "bit":
            attributes.append(build_from_template(BIT_TEMPLATE, column))
        elif kind == "int":
            attributes.append(build_from_template(INT_TEMPLATE, column))
        else:
            raise SystemExit(f"unknown column kind {kind!r}")

    attributes.append(primary_key)
    attributes.append(organization)
    for attribute in system:
        attributes.append(attribute)

    # The option sets the legacy state and status columns carry are named after
    # the table they belong to.
    for node in entity.iter("optionset"):
        name = node.get("Name", "")
        # The trailing underscore matters: without it this also rewrites the
        # option sets just built for this table, whose names already begin with
        # the new logical name.
        if name.startswith(LEGACY_LOGICAL + "_"):
            node.set("Name", name.replace(LEGACY_LOGICAL, LOGICAL, 1))

    view = root.find("./SavedQueries/savedqueries/savedquery")
    if view is None:
        raise SystemExit("the legacy export has no saved query to use as a template")
    text(view, "savedqueryid", VIEW_ID)
    for node in view.find("LocalizedNames").iter("LocalizedName"):
        node.set("description", "Active Mentions")

    grid = view.find("./layoutxml/grid")
    grid.set("jump", "ayonto_name")
    row = grid.find("row")
    row.set("id", f"{LOGICAL}id")
    for cell in list(row):
        row.remove(cell)
    fetch_entity = view.find("./fetchxml/fetch/entity")
    fetch_entity.set("name", LOGICAL)
    for node in list(fetch_entity):
        if node.tag == "attribute":
            fetch_entity.remove(node)

    # Only columns this table actually has.
    shown = [
        (f"{LOGICAL}id", None),
        ("ayonto_name", 300),
        ("ayonto_recordtable", 160),
        ("ayonto_sourcefield", 160),
        ("ayonto_recipientuserid", 260),
        ("createdon", 125),
    ]
    for index, (name, width) in enumerate(shown):
        fetch_entity.insert(index, ET.Element("attribute", {"name": name}))
        if width is not None:
            ET.SubElement(row, "cell", {"name": name, "width": str(width)})

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(tree, space="  ")
    tree.write(TARGET, encoding="utf-8", xml_declaration=True)
    TARGET.write_text(TARGET.read_text(encoding="utf-8").rstrip("\n") + "\n", encoding="utf-8")

    custom = sum(1 for a in attributes if a.findtext("IsCustomField") == "1")
    print(f"wrote {TARGET.relative_to(ROOT)}")
    print(f"  {LOGICAL}: OrganizationOwned, {custom} custom column(s), {len(attributes)} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
