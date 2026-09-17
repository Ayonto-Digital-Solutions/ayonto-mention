# Power Platform solution source

This tree holds the Dataverse solution project and its source in the **classic
SolutionPackager XML format** — `src/Entities/<Table>/Entity.xml` and
`src/Other/`.

**Why the classic format and not YAML.** The reserved layout here used to be the
YAML source-control format (`solutions/`, `entities/`, `modernflows/`,
`publishers/`). Nothing had been produced into it. What this solution actually
needs is the `ayonto_mention` table, and that table already exists as a real
export — in the legacy product's repository, in the classic XML format. Reusing
that export unchanged is worth more than a format preference, and mixing the two
layouts is not an option: on a case-insensitive filesystem `entities/` and
`Entities/` are one directory, on Linux they are two, and a tree that means
different things on a developer's machine and in CI is a trap rather than a
reservation.

## What is here

```
powerplatform/
├── AyontoMentionSolution.cdsproj   # the solution project; builds both packages
└── src/
    ├── Entities/ayonto_Mention/Entity.xml   # the table, verbatim from the legacy export
    └── Other/
        ├── Solution.xml            # AyontoMention identity, publisher, root components
        ├── Customizations.xml      # <Entities /> stays childless — see below
        └── Relationships.xml       # the six ownership relationships
```

`Entity.xml`, `Relationships.xml` and `Customizations.xml` are byte-for-byte the
files the legacy solution exports. Only `Solution.xml` differs, and only in three
places: the unique name, the display name and the version. No table metadata was
touched.

## Three things the packer will not tell you

Each of these packs cleanly, imports cleanly, and leaves something out. They are
guarded by `.github/scripts/check-solution-source.py`, which runs before every
release build.

1. **An entity folder that no `RootComponent` mentions** packs without the table.
   There is no warning anywhere.
2. **A non-empty `<Entities />` in `Customizations.xml`** makes SolutionPackager
   drop the Entities folder entirely. The element has to be present and childless.
3. **A `SavedQueries/` folder** is read by nothing. Views belong inside
   `<SavedQueries>` in `Entity.xml`, and a table whose views live in a folder
   ships with no view at all.

A hand-written `RibbonDiff.xml` is a fourth: the packer answers it with a
`NullReferenceException` that names only the entity it was processing.

## Conventions

| Setting                      | Value           |
| ---------------------------- | --------------- |
| Solution unique name         | `AyontoMention` |
| Publisher                    | `Ayonto`        |
| Publisher prefix             | `ayonto`        |
| Publisher choice value prefix | `14144`         |
| Code component                | `Ayonto.AyontoMentionControl` |
| Table                         | `ayonto_mention`, user-owned, from v1.1.0 |

**The choice value prefix is taken from the publisher that already exists.**
Dataverse derives the values of choices created under a publisher from it, and
`pac solution init` picks a new one every time it runs — so without fixing it,
the same publisher would arrive at an environment wearing a different number in
each release. It therefore has to be fixed, and it is not this repository's to
invent: an `Ayonto` publisher is already in productive use with `14144`, and a
solution naming a different number for the same publisher would be asking to
change it.

v1.0.0 shipped `45013`, chosen here before that was known. From v1.0.1 the
existing publisher is what this follows; **v1.0.0 stays as published** and is not
rewritten. The release packaging sets `14144` and the package checker enforces it.

It has to stay the same from here on. When the real solution and publisher are
exported from a Dataverse environment into this tree, the exported publisher must
carry `14144` too. If an environment ever turns out to hold an `Ayonto` publisher
with a different prefix, **stop and reconcile deliberately** — do not quietly
change either side, because the value is part of how existing choices keep their
meaning.

The client-only package released today creates no choices at all. The first
package that carries the event ledger will, and from that point the prefix above
is what its values are derived from.

**The component name is also a coexistence decision.** The productive legacy
mention control occupies `Ayonto.MentionControl` under this same publisher, and
the two are not versions of one another: this one requires `recordId`,
`recordTable` and `mentionMetadata`, which the legacy contract has no place for,
and a code component may gain optional properties in a later version but not
required ones. So this product is `Ayonto.AyontoMentionControl` — same vendor
namespace, its own name, no version number baked into it — and both controls can
be installed in one environment and put on one form.

## What this solution owns, and what a host solution owns

Ayonto Mention ships as a **reusable base solution**. An application that wants
mentions installs it and then depends on it. That split is not packaging
convenience — it follows from how solutions are built, and it decides what may
ever appear in this tree.

| `AyontoMention` (this solution) | The host application's own solution |
|---|---|
| the code component | its business tables and text columns |
| the central event ledger and its keys | **one companion metadata column per mention-enabled text column** |
| the plug-in package, assembly and types | the form bindings to the code component |
| the security components the ledger needs — ordinary users get no `Create`/`Update`/`Delete` on it | the concrete SDK message processing steps on its source tables |
| later: dispatcher and per-channel delivery state | the mapping from each text column to its companion column |

**This solution cannot predeclare host-specific companion columns.** A column is
a component that lives inside a table — *"Except for choice columns, all other
columns can't exist outside of a table"*
([Solution concepts](https://learn.microsoft.com/en-us/power-platform/alm/solution-concepts-alm)).
Carrying columns for tables a solution names while it is built is ordinary, and
it is what the host solution does for its own. What a reusable base solution
cannot do is name a host table that has not been chosen yet: this one is built
before it knows which application will use it. The host knows its own tables
exactly, so the columns belong there, in the solution that already owns the table
they sit on.

The plug-in *types* belong here; the *steps* that register them against a host's
table belong to the host. A step is the registration — there is no half of one —
and Microsoft describes this arrangement directly: a solution may contain a step
while *"another solution containing the assembly is already installed"*
([Register a plug-in](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-plug-in)).

The reasoning in full, including why the ingest is an asynchronous plug-in step
rather than a flow per table, is in
[`../docs/server-architecture.md`](../docs/server-architecture.md).

## Rules

- **Do not hand-author table metadata in this tree.** `Entity.xml` and
  `Relationships.xml` come from a real Dataverse export and are copied, not
  written. Hand-written metadata drifts from the schema and breaks import.
  Solution-level packaging metadata — unique name, display name, version, root
  components — is a different thing and may be edited deliberately.
- The control is contributed by the PCF project in [`../pcf`](../pcf) and is
  referenced from the solution project rather than copied here.
- Keep this tree customer-neutral: no tenant or environment IDs, no connection
  IDs, no real user or customer data. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Unvalidated: what happens where the legacy solution is already installed

The table this package installs carries the same logical name as the one the
legacy `AyontoPcfControls` solution installs, under the same publisher. In an
environment that already has that solution, two managed solutions would then
relate to one table.

**Whether that is safe has not been tested, and this file does not claim it is.**
Managed solution layering has rules for this, and rules are not the same as
evidence. Before this package is imported anywhere that matters, the following
need answers from a real environment:

| | To validate |
|---|---|
| A | Import into a clean environment with no legacy solution present |
| B | Import into an environment where `AyontoPcfControls` and its `ayonto_mention` already exist |
| C | Whether import order changes the outcome |
| D | How the two managed solutions layer over the shared table |
| E | What uninstalling either one does to the table and to the data in it |
| F | Whether a solution that declares a dependency on the legacy table still has it satisfied afterwards |

Until those are answered, treat B through F as open. The safe sequence is a
clean environment first.

## What this solution does not carry

No flows, no plug-in assemblies, no SDK message processing steps, no connection
references, no environment variables, no security roles. The import asks for no
connection, because nothing in it needs one. The server side described in
[`../docs/server-architecture.md`](../docs/server-architecture.md) is designed
and unbuilt; this package installs the table it will eventually write to, and
nothing writes to it yet.
