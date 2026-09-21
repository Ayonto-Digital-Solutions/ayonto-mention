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
PLUGIN_TYPE = "Ayonto.Mention.Ingest.MentionIngestPlugin"
ASSEMBLY_PATH = f"PluginAssemblies/{ASSEMBLY}-A1B2C3D4/{ASSEMBLY}.dll"
DATA_PATH = f"PluginAssemblies/{ASSEMBLY}-A1B2C3D4/{ASSEMBLY}.dll.data.xml"

CLIENT_FILES = [
    "[Content_Types].xml",
    "solution.xml",
    "customizations.xml",
    "Controls/ayonto_Ayonto.AyontoMentionControl/bundle.js",
]


def solution_xml(*root_components: tuple[str, str]) -> bytes:
    declared = "".join(
        f'<RootComponent type="{kind}" schemaName="{name}" behavior="0" />'
        for kind, name in root_components
    )
    return (
        "<ImportExportXml><SolutionManifest><UniqueName>AyontoMention</UniqueName>"
        f"<RootComponents>{declared}</RootComponents>"
        "</SolutionManifest></ImportExportXml>"
    ).encode("utf-8")


def customizations_xml(
    assemblies: list[str] | None = None,
    types: list[str] | None = None,
    steps: list[str] | None = None,
) -> bytes:
    declared = ""
    for assembly in assemblies or []:
        declared_types = "".join(
            f"<PluginType><TypeName>{name}</TypeName></PluginType>" for name in types or []
        )
        declared_steps = "".join(
            f"<SdkMessageProcessingStep><Name>{name}</Name></SdkMessageProcessingStep>"
            for name in steps or []
        )
        declared += (
            f"<PluginAssembly><Name>{assembly}</Name>"
            f"<PluginTypes>{declared_types}</PluginTypes>"
            f"<SdkMessageProcessingSteps>{declared_steps}</SdkMessageProcessingSteps>"
            "</PluginAssembly>"
        )

    return (
        f"<ImportExportXml><SolutionPluginAssemblies>{declared}</SolutionPluginAssemblies>"
        "</ImportExportXml>"
    ).encode("utf-8")


#: The plug-in root components a package carrying the ingest would declare.
PLUGIN_ROOTS = (("91", ASSEMBLY), ("90", PLUGIN_TYPE))


class GateClosed(unittest.TestCase):
    """What the released package is today: the component, the tables, no assembly."""

    def test_a_package_without_plug_in_content_is_accepted(self):
        paths, components = checker.check_plugin(
            CLIENT_FILES, solution_xml(("1", "ayonto_mentionevent")), customizations_xml(),
            required=False,
        )

        self.assertEqual(frozenset(), paths)
        self.assertEqual(frozenset(), components)

    def test_an_assembly_file_is_refused_and_the_refusal_names_the_gate(self):
        with self.assertRaises(checker.PackageError) as refused:
            checker.check_plugin(
                CLIENT_FILES + [ASSEMBLY_PATH, DATA_PATH],
                solution_xml(),
                customizations_xml(),
                required=False,
            )

        self.assertIn("PLUGIN_ASSEMBLY_REQUIRED", str(refused.exception))

    def test_a_declared_assembly_is_refused_even_with_no_file(self):
        with self.assertRaises(checker.PackageError):
            checker.check_plugin(
                CLIENT_FILES, solution_xml(), customizations_xml([ASSEMBLY]), required=False
            )

    def test_a_plug_in_root_component_is_refused_even_with_no_file(self):
        with self.assertRaises(checker.PackageError):
            checker.check_plugin(
                CLIENT_FILES, solution_xml(*PLUGIN_ROOTS), customizations_xml(), required=False
            )

    def test_the_gate_is_closed_in_the_committed_checker(self):
        # The flag is the whole statement, so the test says it out loud: this
        # release does not package the ingest, and flipping it is a deliberate
        # change that arrives with the registration configuration.
        self.assertFalse(checker.PLUGIN_ASSEMBLY_REQUIRED)


class GateOpen(unittest.TestCase):
    """What the checker will insist on once an assembly may legitimately be packed."""

    def accept(self, names, solution, customizations):
        return checker.check_plugin(names, solution, customizations, required=True)

    def test_this_product_s_assembly_and_type_are_accepted_and_accounted_for(self):
        paths, components = self.accept(
            CLIENT_FILES + [ASSEMBLY_PATH, DATA_PATH],
            solution_xml(("1", "ayonto_mentionevent"), *PLUGIN_ROOTS),
            customizations_xml([ASSEMBLY], [PLUGIN_TYPE]),
        )

        self.assertEqual({ASSEMBLY_PATH, DATA_PATH}, set(paths))
        self.assertEqual({("91", ASSEMBLY), ("90", PLUGIN_TYPE)}, set(components))

    def test_a_missing_assembly_is_refused(self):
        with self.assertRaises(checker.PackageError) as refused:
            self.accept(CLIENT_FILES, solution_xml(*PLUGIN_ROOTS), customizations_xml([ASSEMBLY]))

        self.assertIn("no plug-in assembly", str(refused.exception))

    def test_somebody_else_s_assembly_is_refused(self):
        with self.assertRaises(checker.PackageError) as refused:
            self.accept(
                CLIENT_FILES + [ASSEMBLY_PATH, "PluginAssemblies/Other-1/Other.dll"],
                solution_xml(*PLUGIN_ROOTS),
                customizations_xml([ASSEMBLY], [PLUGIN_TYPE]),
            )

        self.assertIn("Other.dll", str(refused.exception))

    def test_an_assembly_nobody_declared_is_refused(self):
        with self.assertRaises(checker.PackageError):
            self.accept(
                CLIENT_FILES + [ASSEMBLY_PATH],
                solution_xml(*PLUGIN_ROOTS),
                customizations_xml(),
            )

    def test_a_plug_in_type_nobody_named_is_refused(self):
        with self.assertRaises(checker.PackageError) as refused:
            self.accept(
                CLIENT_FILES + [ASSEMBLY_PATH],
                solution_xml(*PLUGIN_ROOTS),
                customizations_xml([ASSEMBLY], [PLUGIN_TYPE, "Ayonto.Mention.Ingest.Something"]),
            )

        self.assertIn("plug-in types", str(refused.exception))

    def test_a_step_belongs_to_the_host_solution_and_is_refused_here(self):
        # A step names the host table it is registered against. A reusable base
        # solution carrying a customer's table name is the one thing this package
        # must never do.
        with self.assertRaises(checker.PackageError) as refused:
            self.accept(
                CLIENT_FILES + [ASSEMBLY_PATH],
                solution_xml(*PLUGIN_ROOTS),
                customizations_xml([ASSEMBLY], [PLUGIN_TYPE], ["ingest on a host table"]),
            )

        self.assertIn("host solution", str(refused.exception))

    def test_an_undeclared_root_component_is_refused(self):
        with self.assertRaises(checker.PackageError) as refused:
            self.accept(
                CLIENT_FILES + [ASSEMBLY_PATH],
                solution_xml(("91", ASSEMBLY)),
                customizations_xml([ASSEMBLY], [PLUGIN_TYPE]),
            )

        self.assertIn("root components are wrong", str(refused.exception))


if __name__ == "__main__":
    unittest.main()
