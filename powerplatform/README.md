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

## The table is UserOwned, and that is a decision rather than an omission

`ayonto_mention` is **UserOwned**. It is the real legacy component, preserved
deliberately, and its ownership is **not temporary packaging metadata**.

Microsoft is explicit that this cannot be revisited later: *"Once a table is
created, the ownership type can't be changed"*, and *"After you create a custom
table, you can't change the ownership… If you later determine that your custom
table must be of a different type, you need to delete it and create a new one"*
([Types of tables](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/types-of-entities)).

**The consequence is worth stating plainly.** Importing v1.1.0 into an
environment that does not yet have this table *creates a UserOwned table there*.
From that moment the ownership is fixed for that environment. It is therefore an
architectural decision this release makes on behalf of every environment that
imports it — not something a later release can casually flip, and not something
to be discovered after the fact.

Ownership is a separate question from authorization. It scopes row-level access
once a privilege exists; it does not grant one.

**The security boundary in
[`../docs/server-architecture.md`](../docs/server-architecture.md) is a target,
and this release does not reach it.** That target is: ordinary application users
must not require direct `Create`, `Update` or `Delete` on this table, because the
trusted server ingest authors the events.

What v1.1.0 does about it is **nothing, deliberately**:

- it carries **no security role**;
- it does not rewrite the privileges an environment already has;
- so the effective privileges on this table are environment-specific and have to
  be observed rather than assumed.

There is a reason not to touch them yet. The older mention control writes
`ayonto_mention` rows from the browser, so an environment still running it may
grant exactly the direct access the target design removes. Removing it here would
break that control before anything replaces it. The privilege change belongs to
the server cutover.

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
| Table (current)               | `ayonto_mention`, **UserOwned**, from v1.1.0 |
| Table (product)               | `ayonto_mentionevent`, **Organization-owned**, shipped as solution source in v1.1.0.1 — derived from the legacy export, **not yet import-proven** |
| Ownership, as solution XML spells it | `<OwnershipTypeMask>OrgOwned</OwnershipTypeMask>` — the serialization of the `OrganizationOwned` model; v1.1.0.1 wrote the model's name instead and the real import rejected the table with `0x80044150` ([why](../docs/server-architecture.md#the-product-event-table)) |

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
| later: the security components the ledger needs — **none ship in v1.1.0** | the concrete SDK message processing steps on its source tables |
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

  **`ayonto_MentionEvent` is the one documented exception, and it is worth
  knowing why before trusting it.** That table has never existed in a Dataverse
  environment, so there was no export to copy: the development environment
  cannot run the tooling that would have created it there, so the table reaches
  Dataverse the other way round — described here and created by the managed
  import.

  It is still not typed by hand. `tools/powerplatform/generate-mentionevent-entity.py`
  derives it from `ayonto_Mention/Entity.xml` — this repository's own real
  export — substituting names, labels, lengths and requirement levels and
  nothing else. The two column shapes the legacy table does not have, whole
  number and two options, are reproduced verbatim from Microsoft's own published
  solution exports, named in that script.

  What no export could supply is marked `UNVERIFIED` there: no public Dataverse
  export of an *organization-owned* custom table exists, so the ownership column
  and the organization relationship are reasoned from Microsoft's table
  reference rather than copied. **The managed import into a real environment is
  what decides whether that reasoning was right.** A local SolutionPackager
  build proves the file packs, not that Dataverse accepts it. If the import
  fails, correct the derivation from the real import error — do not patch the
  generated XML by hand, or the next regeneration silently undoes the fix.
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
| **G1** | **Coexistence** — what privileges users on this table *actually* have while the legacy solution is still present, and that importing v1.1.0 does not break the legacy deployment merely by arriving |
| **G2** | **Post-cutover** — once the trusted ingest exists: ordinary users can save host records *without* direct ledger `Create`/`Update`/`Delete`, the trusted writer creates validated events, and direct user mutation of the ledger is denied |

G is split because the two halves happen at different times and must not be run
together. **G1 observes and changes nothing.** It goes first, because what a
migrating environment currently permits is not knowable from here — and the
legacy control's own writes may depend on it. **G2 is the cutover**, and it is
the point at which privileges actually change.

Neither security change is implemented now. The eventual owner value for a
server-written row is **not decided here** either; it belongs to the server
implementation and to G2.

Until those are answered, treat B through G2 as open. The safe sequence is a clean
environment first.

### How to read the overlap with the legacy solution

Not "guaranteed safe", and not "unsupported" either. Dataverse layers managed
solutions at component level, and for a table the behaviour is *top wins*;
Microsoft's own advice is to *"construct a solution that follows best practices
so that your solution won't interfere with other solutions"* and points at
segmented solutions
([Solution layers](https://learn.microsoft.com/en-us/power-platform/alm/solution-layers-alm)).

What that leaves is a **migration and coexistence proof**, to be run in a real
environment, which decides the migration sequence. The package is not being
changed to avoid taking that test.

## What this solution does not carry

No flows, no plug-in assemblies, no SDK message processing steps, no connection
references, no environment variables, no security roles. The import asks for no
connection, because nothing in it needs one. The server side described in
[`../docs/server-architecture.md`](../docs/server-architecture.md) is designed
and unbuilt; this package installs the table it will eventually write to, and
nothing writes to it yet.
