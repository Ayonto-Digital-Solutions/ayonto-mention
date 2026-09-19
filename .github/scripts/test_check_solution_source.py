#!/usr/bin/env python3
"""What the solution-source checker refuses, proved against sources built here.

The `ayonto_mentionevent` table is derived rather than exported, so the checker is
the only thing standing between a mistake in that derivation and a solution that
ships it. Each test here describes a way the derived schema could be wrong and
asserts the checker says so rather than letting it through.

The fixtures are the smallest XML the checker reads, not copies of a real export.
A test that asserted against a transcription of the real file would only prove the
transcription agrees with itself.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parent / "check-solution-source.py"
REPOSITORY_SOURCE = Path(__file__).resolve().parents[2] / "powerplatform"

GUID = 36

#: The ledger exactly as the contract asks for it. Every test starts here and
#: breaks one thing.
LEDGER_COLUMNS: list[tuple[str, str, str | None, int | None, str]] = [
    ("ayonto_MentionEventId", "primarykey", None, None, "systemrequired"),
    ("ayonto_Name", "nvarchar", "text", 200, "required"),
    ("ayonto_EventId", "nvarchar", "text", GUID, "required"),
    ("ayonto_RecordTable", "nvarchar", "text", 128, "required"),
    ("ayonto_RecordId", "nvarchar", "text", GUID, "required"),
    ("ayonto_SourceField", "nvarchar", "text", 128, "required"),
    ("ayonto_RecipientUserId", "nvarchar", "text", GUID, "required"),
    ("ayonto_InitiatingUserId", "nvarchar", "text", GUID, "required"),
    ("ayonto_ConfigSchemaVersion", "int", None, None, "required"),
    ("ayonto_EmailEnabled", "bit", None, None, "required"),
    ("ayonto_EmailSubject", "nvarchar", "text", 4000, "none"),
    ("ayonto_EmailBody", "ntext", "text", 100000, "none"),
    ("ayonto_EmailLinkText", "nvarchar", "text", 4000, "none"),
    ("ayonto_TeamsEnabled", "bit", None, None, "required"),
    ("ayonto_TeamsTitle", "nvarchar", "text", 4000, "none"),
    ("ayonto_TeamsBody", "ntext", "text", 100000, "none"),
    ("ayonto_TeamsLinkText", "nvarchar", "text", 4000, "none"),
    ("ayonto_InAppEnabled", "bit", None, None, "required"),
    ("ayonto_InAppTitle", "nvarchar", "text", 4000, "none"),
    ("ayonto_InAppBody", "ntext", "text", 100000, "none"),
    ("ayonto_InAppLinkText", "nvarchar", "text", 4000, "none"),
]

LEGACY_COLUMNS = [
    ("ayonto_MentionId", "primarykey", None, None, "systemrequired"),
    ("ayonto_Name", "nvarchar", "text", 200, "required"),
    ("ayonto_Channel", "nvarchar", "text", 32, "none"),
    ("ayonto_DeliveryDetail", "nvarchar", "text", 500, "none"),
    ("ayonto_DeliveryStatus", "nvarchar", "text", 64, "none"),
    ("ayonto_LinkText", "nvarchar", "text", 100, "none"),
    ("ayonto_MentionedById", "nvarchar", "text", 64, "none"),
    ("ayonto_Message", "ntext", "text", 2000, "none"),
    ("ayonto_RecordId", "nvarchar", "text", 64, "none"),
    ("ayonto_RecordName", "nvarchar", "text", 400, "none"),
    ("ayonto_RecordTable", "nvarchar", "text", 128, "none"),
    ("ayonto_RecordUrl", "nvarchar", "text", 500, "none"),
    ("ayonto_Subject", "nvarchar", "text", 200, "none"),
    ("ayonto_UserEmail", "nvarchar", "text", 200, "none"),
    ("ayonto_UserId", "nvarchar", "text", 64, "none"),
    ("ayonto_UserName", "nvarchar", "text", 200, "none"),
]

LEGACY_RELATIONSHIPS = [
    ("business_unit_ayonto_mention", "ayonto_Mention", "BusinessUnit"),
    ("lk_ayonto_mention_createdby", "ayonto_Mention", "SystemUser"),
    ("lk_ayonto_mention_modifiedby", "ayonto_Mention", "SystemUser"),
    ("owner_ayonto_mention", "ayonto_Mention", "Owner"),
    ("team_ayonto_mention", "ayonto_Mention", "Team"),
    ("user_ayonto_mention", "ayonto_Mention", "SystemUser"),
]


def attribute_xml(
    name: str, kind: str, fmt: str | None, max_length: int | None, required: str
) -> str:
    parts = [f'      <attribute PhysicalName="{name}">', f"        <Type>{kind}</Type>"]
    if fmt is not None:
        parts.append(f"        <Format>{fmt}</Format>")
    if max_length is not None:
        parts.append(f"        <MaxLength>{max_length}</MaxLength>")
    parts.append(f"        <RequiredLevel>{required}</RequiredLevel>")
    parts.append(f'        <IsCustomField>{"0" if kind == "primarykey" else "1"}</IsCustomField>')
    parts.append("      </attribute>")
    return "\n".join(parts)


def entity_xml(
    logical: str,
    entity_set: str,
    ownership: str,
    columns: list[tuple[str, str, str | None, int | None, str]],
    views: list[str],
) -> str:
    attributes = "\n".join(attribute_xml(*column) for column in columns)
    saved = "\n".join(
        "      <savedquery>\n"
        "        <LocalizedNames>\n"
        f'          <LocalizedName description="{view}" languagecode="1033" />\n'
        "        </LocalizedNames>\n"
        "      </savedquery>"
        for view in views
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<Entity>\n"
        "  <EntityInfo>\n"
        f'    <entity Name="{logical}">\n'
        f"      <EntitySetName>{entity_set}</EntitySetName>\n"
        f"      <OwnershipTypeMask>{ownership}</OwnershipTypeMask>\n"
        f"{attributes}\n"
        "    </entity>\n"
        "  </EntityInfo>\n"
        "  <SavedQueries>\n"
        f"{saved}\n"
        "  </SavedQueries>\n"
        "</Entity>\n"
    )


def build_source(
    root: Path,
    *,
    with_ledger: bool = True,
    ledger_columns: list[tuple[str, str, str | None, int | None, str]] | None = None,
    ledger_ownership: str = "OrganizationOwned",
    ledger_views: list[str] | None = None,
    ledger_entity_set: str = "ayonto_mentionevents",
    extra_relationships: list[tuple[str, str, str]] | None = None,
    extra_folders: dict[str, str] | None = None,
) -> Path:
    """Writes a minimal solution source and answers with its root."""
    src = root / "src"
    (src / "Other").mkdir(parents=True)
    (src / "Entities").mkdir(parents=True)

    tables = [("ayonto_Mention", "ayonto_mention")]

    legacy = src / "Entities" / "ayonto_Mention"
    legacy.mkdir()
    (legacy / "Entity.xml").write_text(
        entity_xml("ayonto_mention", "ayonto_mentions", "UserOwned", LEGACY_COLUMNS, ["Active Mentions"]),
        encoding="utf-8",
    )

    if with_ledger:
        tables.append(("ayonto_MentionEvent", "ayonto_mentionevent"))
        ledger = src / "Entities" / "ayonto_MentionEvent"
        ledger.mkdir()
        (ledger / "Entity.xml").write_text(
            entity_xml(
                "ayonto_mentionevent",
                ledger_entity_set,
                ledger_ownership,
                ledger_columns if ledger_columns is not None else LEDGER_COLUMNS,
                ledger_views if ledger_views is not None else ["Active Mentions"],
            ),
            encoding="utf-8",
        )

    for folder, logical in (extra_folders or {}).items():
        other = src / "Entities" / folder
        other.mkdir()
        (other / "Entity.xml").write_text(
            entity_xml(logical, f"{logical}s", "UserOwned", LEGACY_COLUMNS, ["Active"]),
            encoding="utf-8",
        )

    components = "\n".join(
        f'        <RootComponent type="1" schemaName="{logical}" behavior="0" />'
        for _, logical in tables
    )
    (src / "Other" / "Solution.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<ImportExportXml>\n"
        "  <SolutionManifest>\n"
        "    <UniqueName>AyontoMention</UniqueName>\n"
        "    <Version>1.1.0.0</Version>\n"
        "    <Publisher>\n"
        "      <UniqueName>Ayonto</UniqueName>\n"
        "      <CustomizationPrefix>ayonto</CustomizationPrefix>\n"
        "      <CustomizationOptionValuePrefix>14144</CustomizationOptionValuePrefix>\n"
        "    </Publisher>\n"
        "    <RootComponents>\n"
        f"{components}\n"
        "    </RootComponents>\n"
        "  </SolutionManifest>\n"
        "</ImportExportXml>\n",
        encoding="utf-8",
    )

    relationships = LEGACY_RELATIONSHIPS + (extra_relationships or [])
    nodes = "\n".join(
        f'  <EntityRelationship Name="{name}">\n'
        f"    <ReferencingEntityName>{referencing}</ReferencingEntityName>\n"
        f"    <ReferencedEntityName>{referenced}</ReferencedEntityName>\n"
        "  </EntityRelationship>"
        for name, referencing, referenced in relationships
    )
    (src / "Other" / "Relationships.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        f"<EntityRelationships>\n{nodes}\n</EntityRelationships>\n",
        encoding="utf-8",
    )

    (src / "Other" / "Customizations.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<ImportExportXml>\n"
        "  <Entities />\n"
        "  <Roles />\n"
        "  <Workflows />\n"
        "  <SolutionPluginAssemblies />\n"
        "</ImportExportXml>\n",
        encoding="utf-8",
    )
    return root


def run(source: Path) -> tuple[int, str]:
    finished = subprocess.run(
        [sys.executable, str(CHECKER)],
        capture_output=True,
        text=True,
        env={"SOLUTION_SOURCE": str(source), "PATH": "/usr/bin:/bin"},
        check=False,
    )
    return finished.returncode, finished.stdout + finished.stderr


class SourceCheckerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._directory = tempfile.TemporaryDirectory()
        self.root = Path(self._directory.name)
        self.addCleanup(self._directory.cleanup)

    # -- the shapes that must pass -----------------------------------------

    def test_accepts_the_repository_source(self) -> None:
        """Whatever else changes, what is actually committed still passes."""
        code, said = run(REPOSITORY_SOURCE)
        self.assertEqual(code, 0, said)
        self.assertIn("contract holds", said)

    def test_accepts_the_ledger_as_specified(self) -> None:
        code, said = run(build_source(self.root))
        self.assertEqual(code, 0, said)
        self.assertIn("ayonto_mentionevent: OrganizationOwned", said)

    def test_rejects_the_ledger_being_absent(self) -> None:
        # The package exists to install it. A solution that builds cleanly and
        # leaves the environment without the ledger is the failure this whole
        # file is here to catch.
        code, said = run(build_source(self.root, with_ledger=False))
        self.assertEqual(code, 1)
        self.assertIn("ayonto_mentionevent", said)

    def test_accepts_system_relationships_on_the_ledger(self) -> None:
        code, said = run(
            build_source(
                self.root,
                extra_relationships=[
                    ("lk_ayonto_mentionevent_createdby", "ayonto_MentionEvent", "SystemUser"),
                    ("business_unit_ayonto_mentionevent", "ayonto_MentionEvent", "BusinessUnit"),
                ],
            )
        )
        self.assertEqual(code, 0, said)

    # -- ownership ----------------------------------------------------------

    def test_rejects_a_user_owned_ledger(self) -> None:
        code, said = run(build_source(self.root, ledger_ownership="UserOwned"))
        self.assertEqual(code, 1)
        self.assertIn("OwnershipTypeMask", said)
        self.assertIn("cannot be changed afterwards", said)

    # -- the no-lookup rule -------------------------------------------------

    def test_rejects_a_recipient_lookup(self) -> None:
        columns = LEDGER_COLUMNS + [("ayonto_RecipientUser", "lookup", None, None, "none")]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("ayonto_RecipientUser", said)

    def test_rejects_a_relationship_to_a_host_table(self) -> None:
        code, said = run(
            build_source(
                self.root,
                extra_relationships=[
                    ("ayonto_mentionevent_hosttable", "ayonto_MentionEvent", "some_hosttable")
                ],
            )
        )
        self.assertEqual(code, 1)
        self.assertIn("host-independent", said)

    # -- the columns that must not come back --------------------------------

    def test_rejects_a_shared_delivery_status(self) -> None:
        columns = LEDGER_COLUMNS + [("ayonto_DeliveryStatus", "nvarchar", "text", 64, "none")]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("Delivery state is per", said)

    def test_rejects_a_stored_recipient_address(self) -> None:
        columns = LEDGER_COLUMNS + [("ayonto_UserEmail", "nvarchar", "text", 200, "none")]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("never from a stored name or address", said)

    # -- the shapes themselves ----------------------------------------------

    def test_rejects_the_legacy_guid_length(self) -> None:
        columns = [
            (name, kind, fmt, 64 if name == "ayonto_EventId" else length, required)
            for name, kind, fmt, length, required in LEDGER_COLUMNS
        ]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("max length", said)
        self.assertIn("ayonto_EventId", said)

    def test_rejects_a_single_line_body(self) -> None:
        columns = [
            (name, "nvarchar" if name == "ayonto_EmailBody" else kind, fmt, length, required)
            for name, kind, fmt, length, required in LEDGER_COLUMNS
        ]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("ayonto_EmailBody", said)

    def test_rejects_an_optional_identity_column(self) -> None:
        columns = [
            (name, kind, fmt, length, "none" if name == "ayonto_RecipientUserId" else required)
            for name, kind, fmt, length, required in LEDGER_COLUMNS
        ]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("required level", said)

    def test_rejects_a_missing_snapshot_column(self) -> None:
        columns = [column for column in LEDGER_COLUMNS if column[0] != "ayonto_TeamsBody"]
        code, said = run(build_source(self.root, ledger_columns=columns))
        self.assertEqual(code, 1)
        self.assertIn("ayonto_TeamsBody", said)

    def test_rejects_a_wrong_entity_set(self) -> None:
        code, said = run(build_source(self.root, ledger_entity_set="ayonto_mentionevent"))
        self.assertEqual(code, 1)
        self.assertIn("EntitySetName", said)

    # -- the packaging traps the checker has always been about ---------------

    def test_rejects_a_ledger_with_no_view(self) -> None:
        code, said = run(build_source(self.root, ledger_views=[]))
        self.assertEqual(code, 1)
        self.assertIn("no view at all", said)

    def test_rejects_an_unknown_table_folder(self) -> None:
        code, said = run(build_source(self.root, extra_folders={"ayonto_Something": "ayonto_something"}))
        self.assertEqual(code, 1)
        self.assertIn("ayonto_Something", said)


if __name__ == "__main__":
    unittest.main()
