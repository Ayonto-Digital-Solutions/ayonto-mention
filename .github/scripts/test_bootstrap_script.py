#!/usr/bin/env python3
"""What the gapped-device bootstrap must say, checked from here.

The script runs where nothing in this repository can reach it: a real Dataverse
environment, on a machine that is not this one. Every mistake in it costs a round
trip to discover, so the parts that can be checked without running it are checked
here — the shape of the create payload, the properties the verification actually
reads, and the command lines an operator is told to type.

This is deliberately a text-level check. It is not a substitute for running the
script; it is the half of the problem that does not need an environment.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "powerplatform" / "Initialize-MentionEventSchema.ps1"
SOURCE = SCRIPT.read_text(encoding="utf-8")

#: Where an operator could be told to type a command. Kept together so a
#: corrected command line cannot be fixed in one place and left wrong in another.
COMMAND_SURFACES = (SCRIPT, ROOT / "docs" / "server-architecture.md", ROOT / "README.md")

#: The identifiers that are GUIDs written as text, and the length that is their
#: contract. 36 is the canonical hyphenated lowercase form; a braced value does
#: not fit, which is the point.
GUID_COLUMNS = (
    "ayonto_EventId",
    "ayonto_RecordId",
    "ayonto_RecipientUserId",
    "ayonto_InitiatingUserId",
)

SNAPSHOT_COLUMNS = (
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
)


class CreatePayloadTests(unittest.TestCase):
    def test_declares_the_primary_name_attribute(self) -> None:
        # IsPrimaryName on the attribute is not the same statement as
        # PrimaryNameAttribute on the table, and the table definition wants both.
        self.assertIn("PrimaryNameAttribute = $script:Table.PrimaryNameLogical", SOURCE)

    def test_the_primary_name_is_the_logical_name(self) -> None:
        # Lower case. The schema-cased ayonto_Name is a different string, and
        # PrimaryNameAttribute is a logical name.
        self.assertIn("PrimaryNameLogical  = 'ayonto_name'", SOURCE)
        self.assertIn("PrimaryNameSchema   = 'ayonto_Name'", SOURCE)

    def test_sends_the_solution_header_on_writes(self) -> None:
        self.assertIn("'MSCRM.SolutionUniqueName'", SOURCE)

    def test_declares_no_lookup_of_any_kind(self) -> None:
        kinds = set(re.findall(r"Kind = '(\w+)'", SOURCE))
        self.assertEqual(kinds, {"String", "Memo", "Integer", "Boolean"})

    def test_refuses_to_send_a_lookup_even_if_one_appeared(self) -> None:
        self.assertIn("refusing to create lookup column", SOURCE)

    def test_declares_every_identity_column_as_text_36(self) -> None:
        for column in GUID_COLUMNS:
            declaration = next(
                (line for line in SOURCE.splitlines() if f"Schema = '{column}'" in line), None
            )
            self.assertIsNotNone(declaration, f"{column} is not declared")
            self.assertIn("Kind = 'String'", declaration or "")
            self.assertIn("$script:GuidLength", declaration or "")
        self.assertIn("$script:GuidLength = 36", SOURCE)

    def test_declares_every_snapshot_column(self) -> None:
        for column in SNAPSHOT_COLUMNS:
            self.assertIn(f"Schema = '{column}'", SOURCE, f"{column} is not declared")

    def test_every_channel_starts_off(self) -> None:
        self.assertIn("DefaultValue      = $false", SOURCE)


class VerificationTests(unittest.TestCase):
    """The script promises "present and exact -> no-op". This is what "exact" has to mean."""

    def test_casts_to_every_derived_metadata_type(self) -> None:
        # MaxLength, DefaultValue, MinValue and MaxValue are not on the base
        # AttributeMetadata type. Without the cast, a Text(64) reads as a String
        # and passes for a Text(36).
        # Matched inside the cast table itself, not anywhere in the file: the
        # same type names appear in the create payload, so a looser check would
        # still pass with the casts removed.
        declared = set(re.findall(r"Type = '(\w+AttributeMetadata)'", SOURCE))
        self.assertEqual(
            declared,
            {
                "StringAttributeMetadata",
                "MemoAttributeMetadata",
                "IntegerAttributeMetadata",
                "BooleanAttributeMetadata",
            },
        )
        self.assertIn("Microsoft.Dynamics.CRM.$($cast.Type)", SOURCE)

    def test_selects_the_properties_it_compares(self) -> None:
        for selected in ("MaxLength", "RequiredLevel", "IsPrimaryName", "MinValue", "MaxValue", "DefaultValue"):
            self.assertIn(selected, SOURCE, f"{selected} is never selected")

    def test_reads_the_required_level_through_its_value(self) -> None:
        # RequiredLevel is an AttributeRequiredLevelManagedProperty; comparing the
        # property itself to a string would always differ and never be noticed.
        self.assertIn("function Get-RequiredLevelValue", SOURCE)
        self.assertIn("-Name 'Value'", SOURCE)

    def test_compares_max_length(self) -> None:
        self.assertIn("has max length", SOURCE)

    def test_compares_the_boolean_default(self) -> None:
        self.assertIn("a channel nobody configured must not be on", SOURCE)

    def test_compares_the_integer_bounds(self) -> None:
        self.assertIn("expected 2147483647", SOURCE)

    def test_compares_the_primary_name_attribute(self) -> None:
        self.assertIn("primary name attribute is", SOURCE)

    def test_verifies_the_primary_name_column_like_any_other(self) -> None:
        self.assertIn("function Get-ExpectedColumns", SOURCE)
        self.assertIn("PrimaryName = $true", SOURCE)

    def test_fails_closed_and_repairs_nothing(self) -> None:
        self.assertIn("Nothing was deleted, recreated or altered", SOURCE)
        for destructive in ("Invoke-Dataverse -Method DELETE", "-Method PUT", "-Method PATCH"):
            self.assertNotIn(destructive, SOURCE, f"the script performs {destructive}")


class SafetyTests(unittest.TestCase):
    def test_verifies_the_token_before_writing(self) -> None:
        gate = SOURCE.index("-Path 'WhoAmI'")
        create = SOURCE.index("New-MentionEventTable\n    Publish-Table")
        self.assertLess(gate, create, "the WhoAmI gate must come before any write")

    def test_never_prints_the_token(self) -> None:
        printing = [
            line
            for line in SOURCE.splitlines()
            if "$script:Token" in line and re.search(r"Write-(Host|Output|Step|Verbose|Debug)", line)
        ]
        self.assertEqual(printing, [])

    def test_redacts_the_token_from_errors(self) -> None:
        self.assertIn("<redacted>", SOURCE)

    def test_carries_no_environment_or_tenant_value(self) -> None:
        self.assertNotRegex(SOURCE, r"https://[a-z0-9-]+\.crm\d*\.dynamics\.com")
        self.assertNotRegex(SOURCE, r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def function_body(name: str) -> str:
    """The text of one PowerShell function, up to the next one."""
    start = SOURCE.index(f"function {name} {{")
    remainder = SOURCE[start + len(name) + 12 :]
    end = remainder.find("\nfunction ")
    return remainder if end == -1 else remainder[:end]


class MetadataCacheTests(unittest.TestCase):
    """Metadata is cached, so reading back what was just written needs asking.

    "Metadata changes are cached for performance reasons and a request for a
    newly created item might return a 404 because it hasn't been cached yet.
    Caching might take 30 seconds." Without the header, a successful create is
    followed by a read that finds nothing, and the script reports a failure that
    did not happen.
    """

    def test_the_transport_can_ask_for_strong_consistency(self) -> None:
        self.assertIn("[switch] $StrongConsistency", SOURCE)
        self.assertIn("$headers['Consistency'] = 'Strong'", SOURCE)

    def test_the_table_read_asks_for_it(self) -> None:
        self.assertIn("-StrongConsistency", function_body("Get-ExistingTable"))

    def test_the_base_column_read_asks_for_it(self) -> None:
        self.assertIn("-StrongConsistency", function_body("Get-BaseColumns"))

    def test_every_typed_column_read_asks_for_it(self) -> None:
        body = function_body("Get-TypedColumns")
        calls = [line for line in body.splitlines() if "Invoke-Dataverse" in line]
        self.assertTrue(calls, "Get-TypedColumns makes no request")
        for call in calls:
            self.assertIn("-StrongConsistency", call)

    def test_whoami_does_not_ask_for_it(self) -> None:
        # Not a metadata read, and the header costs the caching it would gain
        # nothing from.
        call = next(line for line in SOURCE.splitlines() if "-Path 'WhoAmI'" in line)
        self.assertNotIn("-StrongConsistency", call)

    def test_no_sleep_or_retry_was_used_instead(self) -> None:
        # Waiting out a cache is a guess about how long it takes. The header is
        # the answer the platform documents.
        for workaround in ("Start-Sleep", "retry", "Retry"):
            self.assertNotIn(workaround, SOURCE, f"the script works around the cache with {workaround}")


class CommandLineTests(unittest.TestCase):
    """`--managed` and `--allowDelete` are switches. Giving them a value is wrong."""

    def test_no_surface_passes_a_value_to_a_switch(self) -> None:
        for path in COMMAND_SURFACES:
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8")
            for wrong in ("--managed false", "--managed true", "--allowDelete false", "--allowDelete true"):
                self.assertNotIn(
                    wrong,
                    text,
                    f"{path.relative_to(ROOT)} passes a value to a switch: {wrong}",
                )

    def test_the_export_command_omits_managed_entirely(self) -> None:
        # Omitting the switch is what makes the export unmanaged.
        export = next(line for line in SOURCE.splitlines() if "pac solution export" in line)
        self.assertIn("--overwrite", export)
        self.assertNotIn("--managed", export)

    def test_the_unpack_command_names_the_package_type(self) -> None:
        unpack = next(line for line in SOURCE.splitlines() if "pac solution unpack" in line)
        self.assertIn("--packagetype Unmanaged", unpack)
        self.assertNotIn("--allowDelete", unpack)


if __name__ == "__main__":
    unittest.main()
