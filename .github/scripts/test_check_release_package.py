#!/usr/bin/env python3
"""What the package checker does about plug-in content, in both of its states.

The plug-in assembly is the one component in this package whose expectation is a
gate rather than a verdict: the ingest is written and tested, and a solution can
only carry an assembly alongside the registration configuration a real environment
produces. So the checker has to be right twice — while the gate is closed and after
it is opened — and only one of those states can be exercised against a real package.

These tests call `check_plugin` directly with the smallest inputs it reads. The rest
of the checker is exercised against the actual built packages, in the release
workflow, where the artifact itself is the fixture.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parent / "check-release-package.py"


def load_checker():
    """Imports a module whose file name is not an identifier."""
    specification = importlib.util.spec_from_file_location("check_release_package", CHECKER)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


checker = load_checker()

ASSEMBLY = "Ayonto.Mention.Ingest"
ASSEMBLY_ID = "a55a415c-e993-455c-ae92-eb232bb0c23e"
FULL_NAME = (
    "Ayonto.Mention.Ingest, Version=1.0.0.0, Culture=neutral, "
    "PublicKeyToken=0e66244ba4f12435"
)
PLUGIN_TYPE = "Ayonto.Mention.Ingest.MentionIngestPlugin"
TYPE_ID = "61728de5-8d02-493b-8603-4e5cf9c7a10c"
DLL_PATH = f"PluginAssemblies/{ASSEMBLY}-{ASSEMBLY_ID.upper()}/{ASSEMBLY}.dll"

CLIENT_FILES = [
    "[Content_Types].xml",
    "solution.xml",
    "customizations.xml",
    "Controls/ayonto_Ayonto.AyontoMentionControl/bundle.js",
]


def solution_xml(*root_components: tuple[str, str, str]) -> bytes:
    """A manifest declaring the given (type, id, schemaName) root components."""
    declared = ""
    for kind, identifier, schema in root_components:
        identifier_attribute = f' id="{{{identifier}}}"' if identifier else ""
        declared += f'<RootComponent type="{kind}"{identifier_attribute} schemaName="{schema}" />'
    return (
        "<ImportExportXml><SolutionManifest><UniqueName>AyontoMention</UniqueName>"
        f"<RootComponents>{declared}</RootComponents>"
        "</SolutionManifest></ImportExportXml>"
    ).encode("utf-8")


def customizations_xml(
    assemblies: list[tuple[str, str]] | None = None,
    types: list[tuple[str, str]] | None = None,
    steps: list[str] | None = None,
) -> bytes:
    """`assemblies` are (FullName, PluginAssemblyId); `types` are (Name, PluginTypeId)."""
    declared = ""
    for full_name, identifier in assemblies or []:
        declared_types = "".join(
            f'<PluginType Name="{name}" PluginTypeId="{type_id}" />'
            for name, type_id in types or []
        )
        declared_steps = "".join(
            f"<SdkMessageProcessingStep><Name>{name}</Name></SdkMessageProcessingStep>"
            for name in steps or []
        )
        declared += (
            f'<PluginAssembly FullName="{full_name}" PluginAssemblyId="{identifier}">'
            f"<PluginTypes>{declared_types}</PluginTypes>"
            f"<SdkMessageProcessingSteps>{declared_steps}</SdkMessageProcessingSteps>"
            "</PluginAssembly>"
        )

    return (
        f"<ImportExportXml><SolutionPluginAssemblies>{declared}</SolutionPluginAssemblies>"
        "</ImportExportXml>"
    ).encode("utf-8")


#: The plug-in exactly as the built package carries it.
GOOD_ROOT = ("91", ASSEMBLY_ID, FULL_NAME)
GOOD_FILES = CLIENT_FILES + [DLL_PATH]


def good_customizations() -> bytes:
    return customizations_xml([(FULL_NAME, ASSEMBLY_ID)], [(PLUGIN_TYPE, TYPE_ID)])


class PluginContract(unittest.TestCase):
    """The contract the real built package satisfies, and the ways of missing it.

    The shape here is the one a real Microsoft solution ships and this repository's own
    build produces: **one type 91 root component whose schemaName is the full assembly
    identity**, and the plug-in type declared inside the assembly's registration. An
    earlier version of the checker expected a type 90 root component alongside, and a
    short assembly name in schemaName. Neither would ever have matched a package, so
    both are asserted the right way round here.
    """

    def accept(self, names=None, solution=None, customizations=None):
        return checker.check_plugin(
            names if names is not None else GOOD_FILES,
            solution if solution is not None else solution_xml(GOOD_ROOT),
            customizations if customizations is not None else good_customizations(),
            required=True,
        )

    def refuse(self, **kwargs):
        with self.assertRaises(checker.PackageError) as refused:
            self.accept(**kwargs)
        return str(refused.exception)

    def test_the_package_this_repository_builds_is_accepted(self):
        paths, components = self.accept()

        self.assertEqual({DLL_PATH}, set(paths))
        self.assertEqual({("91", FULL_NAME)}, set(components))

    def test_the_gate_is_open_in_the_committed_checker(self):
        # The flag is the statement: from solution 1.2.0.0 the package carries the ingest.
        self.assertTrue(checker.PLUGIN_ASSEMBLY_REQUIRED)

    def test_a_missing_assembly_file_is_refused(self):
        self.assertIn("carries no", self.refuse(names=CLIENT_FILES))

    def test_an_assembly_under_another_identifier_is_refused(self):
        wrong = f"PluginAssemblies/{ASSEMBLY}-00000000-0000-0000-0000-000000000000/{ASSEMBLY}.dll"
        self.assertIn("carries no", self.refuse(names=CLIENT_FILES + [wrong]))

    def test_somebody_else_s_assembly_alongside_ours_is_refused(self):
        self.assertIn(
            "Other.dll",
            self.refuse(names=GOOD_FILES + ["PluginAssemblies/Other-1/Other.dll"]),
        )

    def test_a_wrong_full_name_is_refused(self):
        said = self.refuse(
            customizations=customizations_xml(
                [("Ayonto.Mention.Ingest", ASSEMBLY_ID)], [(PLUGIN_TYPE, TYPE_ID)]
            )
        )
        self.assertIn("FullName", said)

    def test_a_wrong_assembly_id_is_refused(self):
        said = self.refuse(
            customizations=customizations_xml(
                [(FULL_NAME, "00000000-0000-0000-0000-000000000000")],
                [(PLUGIN_TYPE, TYPE_ID)],
            )
        )
        self.assertIn("PluginAssemblyId", said)

    def test_a_missing_plug_in_type_is_refused(self):
        self.assertIn(
            "plug-in types",
            self.refuse(customizations=customizations_xml([(FULL_NAME, ASSEMBLY_ID)], [])),
        )

    def test_a_plug_in_type_nobody_named_is_refused(self):
        said = self.refuse(
            customizations=customizations_xml(
                [(FULL_NAME, ASSEMBLY_ID)],
                [(PLUGIN_TYPE, TYPE_ID), ("Ayonto.Mention.Ingest.Something", TYPE_ID)],
            )
        )
        self.assertIn("plug-in types", said)

    def test_a_second_assembly_declaration_is_refused(self):
        said = self.refuse(
            customizations=customizations_xml(
                [(FULL_NAME, ASSEMBLY_ID), ("Other, Version=1.0.0.0", ASSEMBLY_ID)],
                [(PLUGIN_TYPE, TYPE_ID)],
            )
        )
        self.assertIn("plug-in assemblies", said)

    def test_a_step_belongs_to_the_host_solution_and_is_refused_here(self):
        # A step names the host table it is registered against. A reusable base solution
        # carrying a customer's table name is the one thing this package must never do.
        said = self.refuse(
            customizations=customizations_xml(
                [(FULL_NAME, ASSEMBLY_ID)],
                [(PLUGIN_TYPE, TYPE_ID)],
                ["ingest on a host table"],
            )
        )
        self.assertIn("host solution", said)

    def test_a_missing_root_component_is_refused(self):
        # An assembly no RootComponent mentions packs without being part of the solution.
        self.assertIn("0 plug-in root components", self.refuse(solution=solution_xml()))

    def test_a_type_90_root_component_is_refused(self):
        # The mistake this file used to make from the other side: a plug-in type is not a
        # root component.
        said = self.refuse(
            solution=solution_xml(GOOD_ROOT, ("90", TYPE_ID, PLUGIN_TYPE))
        )
        self.assertIn("type 91", said)

    def test_a_root_component_naming_another_id_is_refused(self):
        said = self.refuse(
            solution=solution_xml(("91", "00000000-0000-0000-0000-000000000000", FULL_NAME))
        )
        self.assertIn("pinned", said)

    def test_a_root_component_with_the_short_name_is_refused(self):
        # The full identity is what Dataverse registers the assembly under.
        said = self.refuse(solution=solution_xml(("91", ASSEMBLY_ID, ASSEMBLY)))
        self.assertIn("schemaName", said)

    def test_with_the_gate_closed_the_same_package_is_refused(self):
        with self.assertRaises(checker.PackageError) as refused:
            checker.check_plugin(
                GOOD_FILES, solution_xml(GOOD_ROOT), good_customizations(), required=False
            )

        self.assertIn("PLUGIN_ASSEMBLY_REQUIRED", str(refused.exception))

    def test_with_the_gate_closed_a_client_only_package_is_accepted(self):
        paths, components = checker.check_plugin(
            CLIENT_FILES, solution_xml(), customizations_xml(), required=False
        )

        self.assertEqual(frozenset(), paths)
        self.assertEqual(frozenset(), components)


if __name__ == "__main__":
    unittest.main()
