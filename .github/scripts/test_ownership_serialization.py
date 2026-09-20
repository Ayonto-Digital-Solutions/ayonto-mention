#!/usr/bin/env python3
"""The one thing the real v1.1.0.1 import proved wrong.

`OrganizationOwned` is the name Dataverse gives the ownership model. Solution
XML does not serialize it under that name: it writes `OrgOwned`. The v1.1.0.1
managed import carried the model's name as the raw `<OwnershipTypeMask>` value
and Dataverse rejected `ayonto_MentionEvent` outright:

    0x80044150  Requested value 'OrganizationOwned' was not found.

The table is still organization-owned. Only the serialization was wrong, and
the reason it reached a package is that one word was used for both jobs. These
tests keep the two apart in the three places that decide what ships: the
generator that writes the table source, the checker that guards that source,
and the checker that guards the built package.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "tools" / "powerplatform" / "generate-mentionevent-entity.py"
LEGACY = ROOT / "powerplatform" / "src" / "Entities" / "ayonto_Mention" / "Entity.xml"
RELATIVE_TARGET = Path("powerplatform/src/Entities/ayonto_MentionEvent/Entity.xml")

#: What solution XML must carry, and the value that must never come back.
SERIALIZED = "<OwnershipTypeMask>OrgOwned</OwnershipTypeMask>"
REJECTED = "<OwnershipTypeMask>OrganizationOwned</OwnershipTypeMask>"


def load(name: str):
    """Imports one of the checker scripts, whose names are not identifiers."""
    path = Path(__file__).resolve().parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GeneratorOwnership(unittest.TestCase):
    """Run the generator somewhere else and read what it actually wrote."""

    def setUp(self) -> None:
        self._directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        root = Path(self._directory.name)

        generator = root / "tools" / "powerplatform" / GENERATOR.name
        generator.parent.mkdir(parents=True)
        shutil.copy2(GENERATOR, generator)

        legacy = root / "powerplatform" / "src" / "Entities" / "ayonto_Mention"
        legacy.mkdir(parents=True)
        shutil.copy2(LEGACY, legacy / "Entity.xml")

        finished = subprocess.run(
            [sys.executable, str(generator)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(finished.returncode, 0, finished.stderr)
        self.said = finished.stdout
        self.entity = (root / RELATIVE_TARGET).read_text(encoding="utf-8")

    def test_writes_the_serialized_ownership_value(self) -> None:
        self.assertIn(SERIALIZED, self.entity)

    def test_never_writes_the_ownership_model_name(self) -> None:
        self.assertNotIn(REJECTED, self.entity)

    def test_the_table_stays_organization_owned(self) -> None:
        """The fix is serialization. The ownership model is not being changed.

        An organization-owned table carries OrganizationId and none of the user
        or team ownership columns. That is what makes OrgOwned the right raw
        value rather than a word that merely gets past the importer.
        """
        self.assertIn('PhysicalName="OrganizationId"', self.entity)
        for absent in ("OwnerId", "OwningUser", "OwningTeam", "OwningBusinessUnit"):
            self.assertNotIn(f'PhysicalName="{absent}"', self.entity)

    def test_says_both_names(self) -> None:
        """A reader of the output should not have to guess which is which."""
        self.assertIn("OrganizationOwned", self.said)
        self.assertIn("OrgOwned", self.said)


class CheckerOwnership(unittest.TestCase):
    """Both checkers compare the raw value, and both name the model."""

    def setUp(self) -> None:
        self.source = load("check-solution-source")
        self.package = load("check-release-package")

    def source_table(self, logical: str):
        found = [t for t in self.source.EXPECTED_TABLES if t.logical == logical]
        self.assertEqual(len(found), 1, f"{logical} is not in EXPECTED_TABLES")
        return found[0]

    def test_source_checker_expects_the_serialized_value(self) -> None:
        table = self.source_table("ayonto_mentionevent")
        self.assertEqual(table.ownership_mask, "OrgOwned")
        self.assertEqual(table.ownership, "OrganizationOwned")

    def test_package_checker_expects_the_serialized_value(self) -> None:
        table = self.package.LEDGER_TABLE
        self.assertEqual(table.logical, "ayonto_mentionevent")
        self.assertEqual(table.ownership_mask, "OrgOwned")
        self.assertEqual(table.ownership, "OrganizationOwned")

    def test_the_legacy_table_is_untouched(self) -> None:
        """UserOwned is spelled the same either way, and stays that way."""
        for table in (self.source_table("ayonto_mention"), self.package.LEGACY_TABLE):
            self.assertEqual(table.logical, "ayonto_mention")
            self.assertEqual(table.ownership_mask, "UserOwned")
            self.assertEqual(table.ownership, "UserOwned")


if __name__ == "__main__":
    unittest.main()
