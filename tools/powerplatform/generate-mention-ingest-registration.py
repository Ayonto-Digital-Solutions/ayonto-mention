#!/usr/bin/env python3
"""Derives the ingest assembly's registration source for the solution package.

Read this before trusting the file it writes.

SolutionPackager cannot pack a plug-in assembly from a project reference alone. The
solution targets take the built assembly and then look for its *registration
configuration* in the solution source, matched by assembly full name, and say so when
it is not there:

    error : Unable to find assembly registration configuration for
            Ayonto.Mention.Ingest.dll in the destination:
            obj/Release/Metadata/PluginAssemblies

That configuration is ordinary committed source rather than an export secret, and its
shape is not invented here. It is copied from a real Microsoft solution that ships a
plug-in the same way:

    microsoft/powercat-automation-kit
    AutomationKitControlCenter/SolutionPackage/src/PluginAssemblies/
      AutomationKitAuditFtechAPI-041FE709-3ACF-4866-8700-5B55FCA0E7D6/
        AutomationKitAuditFtechAPI.dll.data.xml
    AutomationKitControlCenter/SolutionPackage/src/Other/Solution.xml
      <RootComponent type="91" id="{041fe709-…}" schemaName="AutomationKitAuditFtechAPI, Version=…" />

Only the names, the assembly identity and the identifiers below are substituted. The
element set, their order, `IsolationMode`, `SourceType`, `IntroducedVersion`,
`CustomizationLevel` and the `FileName` shape are that export's, not this file's
opinion — and the released Microsoft managed solution built from it was checked to
confirm that is what actually ships.

**The three identifiers are pinned, and that is the point of the script.** A
`PluginAssemblyId` is fixed for the life of the product in every environment that ever
imports it: generated per run, every build would be a different assembly and every
registered step would have to be re-pointed by hand. They were minted once, they are
constants below, and the generator-drift gate in CI is what keeps them that way.

What this script deliberately does **not** write is the assembly itself. The binary
comes from the project reference at build time, so CI still builds what ships and no
compiled output is committed. `check-solution-source.py` refuses a committed DLL.

    python3 tools/powerplatform/generate-mention-ingest-registration.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOLUTION = ROOT / "powerplatform" / "src" / "Other" / "Solution.xml"
PLUGIN_ASSEMBLIES = ROOT / "powerplatform" / "src" / "PluginAssemblies"

#: The assembly, exactly as it is built. The public key token is the one
#: `server/Ayonto.Mention.Ingest/Ayonto.Mention.Ingest.snk` produces, and
#: `AssemblyIdentityTests` pins it from the other side.
ASSEMBLY_NAME = "Ayonto.Mention.Ingest"
ASSEMBLY_VERSION = "1.0.0.0"
PUBLIC_KEY_TOKEN = "0e66244ba4f12435"
ASSEMBLY_FULL_NAME = (
    f"{ASSEMBLY_NAME}, Version={ASSEMBLY_VERSION}, Culture=neutral, "
    f"PublicKeyToken={PUBLIC_KEY_TOKEN}"
)

#: The one handler this assembly registers.
PLUGIN_TYPE_NAME = "Ayonto.Mention.Ingest.MentionIngestPlugin"
PLUGIN_TYPE_QUALIFIED_NAME = f"{PLUGIN_TYPE_NAME}, {ASSEMBLY_FULL_NAME}"

#: Minted once, on 2026-09-22, and never again. Changing any of these makes the next
#: import a different component rather than an update of this one.
#:
#: `PluginAssemblyId` and `PluginTypeId` are the Dataverse primary keys of the two
#: components. `FriendlyName` is a string rather than a key — the Microsoft export
#: carries a GUID there, so this follows that shape for export parity, and pinning it
#: costs nothing and keeps the file byte-stable.
PLUGIN_ASSEMBLY_ID = "a55a415c-e993-455c-ae92-eb232bb0c23e"
PLUGIN_TYPE_ID = "61728de5-8d02-493b-8603-4e5cf9c7a10c"
PLUGIN_TYPE_FRIENDLY_NAME = "9fa5e208-42b6-4708-917f-20ca989c9602"

#: Never these. The first three are the Microsoft reference export's own identifiers;
#: copying one would claim another product's component identity.
FORBIDDEN_IDS = frozenset(
    {
        "041fe709-3acf-4866-8700-5b55fca0e7d6",
        "d51ecaf4-8a9f-43a4-8a39-3a80bd85d79e",
        "1a928467-8b52-4349-b132-476a68d006be",
    }
)

#: Sandbox. The Microsoft export's value, and the only one Dataverse offers online:
#: "Dataverse isn't available for on-premises deployments, so always accept the
#: default options of SandBox and Database".
ISOLATION_MODE = "2"
#: Database. Same export, same reason.
SOURCE_TYPE = "0"
#: The export's value, carried across rather than invented.
INTRODUCED_VERSION = "1.0"
CUSTOMIZATION_LEVEL = "1"

#: The folder name the packer reads: the assembly name and the upper-case identifier,
#: exactly as the Microsoft export spells it.
FOLDER_NAME = f"{ASSEMBLY_NAME}-{PLUGIN_ASSEMBLY_ID.upper()}"
DATA_FILE_NAME = f"{ASSEMBLY_NAME}.dll.data.xml"
PACKAGED_DLL_PATH = f"/PluginAssemblies/{FOLDER_NAME}/{ASSEMBLY_NAME}.dll"

#: The root component that makes the assembly part of the solution. Type 91 is a
#: plug-in assembly; its `id` is the assembly's identifier and its `schemaName` the
#: full assembly identity.
#:
#: There is deliberately **no** type 90 root component. A plug-in type is not declared
#: as a root component in the Microsoft export or in the solution that shipped from it —
#: it lives inside the assembly's registration, under `PluginTypes`. An earlier version
#: of the package checker expected one, which was wrong and is corrected.
ROOT_COMPONENT_TYPE = "91"
ROOT_COMPONENT = (
    f'      <RootComponent type="{ROOT_COMPONENT_TYPE}" id="{{{PLUGIN_ASSEMBLY_ID}}}" '
    f'schemaName="{ASSEMBLY_FULL_NAME}" />'
)

DATA_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<PluginAssembly FullName="{ASSEMBLY_FULL_NAME}" PluginAssemblyId="{PLUGIN_ASSEMBLY_ID}" \
CustomizationLevel="{CUSTOMIZATION_LEVEL}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <IsolationMode>{ISOLATION_MODE}</IsolationMode>
  <SourceType>{SOURCE_TYPE}</SourceType>
  <IntroducedVersion>{INTRODUCED_VERSION}</IntroducedVersion>
  <FileName>{PACKAGED_DLL_PATH}</FileName>
  <PluginTypes>
    <PluginType AssemblyQualifiedName="{PLUGIN_TYPE_QUALIFIED_NAME}" \
PluginTypeId="{PLUGIN_TYPE_ID}" Name="{PLUGIN_TYPE_NAME}">
      <FriendlyName>{PLUGIN_TYPE_FRIENDLY_NAME}</FriendlyName>
    </PluginType>
  </PluginTypes>
</PluginAssembly>
"""


def check_identifiers() -> None:
    """The pinned values, held to being three distinct GUIDs that are ours."""
    pinned = {
        "PLUGIN_ASSEMBLY_ID": PLUGIN_ASSEMBLY_ID,
        "PLUGIN_TYPE_ID": PLUGIN_TYPE_ID,
        "PLUGIN_TYPE_FRIENDLY_NAME": PLUGIN_TYPE_FRIENDLY_NAME,
    }
    shape = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    for name, value in pinned.items():
        if shape.fullmatch(value) is None:
            raise SystemExit(f"{name} is not a canonical lower-case GUID: {value!r}")
        if value in FORBIDDEN_IDS:
            raise SystemExit(f"{name} is the Microsoft reference export's own identifier")
    if len(set(pinned.values())) != len(pinned):
        raise SystemExit("the pinned identifiers are not all distinct")


def write_registration() -> Path:
    """The assembly's registration configuration, and only that."""
    folder = PLUGIN_ASSEMBLIES / FOLDER_NAME
    folder.mkdir(parents=True, exist_ok=True)

    # A folder left behind by an earlier identifier would pack a second assembly, and
    # SolutionPackager would not mention it.
    for stale in PLUGIN_ASSEMBLIES.iterdir():
        if stale.is_dir() and stale.name != FOLDER_NAME:
            raise SystemExit(
                f"{stale.relative_to(ROOT)} does not belong to the pinned identifier; "
                "remove it deliberately rather than leaving two registrations"
            )

    target = folder / DATA_FILE_NAME
    target.write_text(DATA_XML, encoding="utf-8")
    return target


def write_root_component() -> bool:
    """Puts exactly one type 91 root component into the solution manifest."""
    text = SOLUTION.read_text(encoding="utf-8")
    existing = re.findall(r'^ *<RootComponent type="91"[^/]*/>$', text, re.MULTILINE)

    if existing == [ROOT_COMPONENT]:
        return False
    if len(existing) > 1:
        raise SystemExit("Solution.xml declares more than one plug-in assembly root component")

    if existing:
        text = text.replace(existing[0], ROOT_COMPONENT)
    else:
        # After the tables, so the manifest reads in the order the solution installs.
        anchor = "    </RootComponents>"
        if anchor not in text:
            raise SystemExit("Solution.xml has no RootComponents element to add to")
        text = text.replace(anchor, f"{ROOT_COMPONENT}\n{anchor}", 1)

    SOLUTION.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    check_identifiers()
    target = write_registration()
    changed = write_root_component()

    print(f"wrote {target.relative_to(ROOT)}")
    print(f"  assembly    {ASSEMBLY_FULL_NAME}")
    print(f"  plug-in type {PLUGIN_TYPE_NAME}")
    print(f"  assembly id {PLUGIN_ASSEMBLY_ID}, type id {PLUGIN_TYPE_ID}")
    print(
        "  root component type 91 "
        + ("added/updated" if changed else "already correct")
    )
    print("  the assembly itself is not written here: the project reference supplies it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
