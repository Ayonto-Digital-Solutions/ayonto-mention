# Power Platform solution source

This tree holds the **YAML source-control format** for the Dataverse solution.

## Conventions

| Setting                      | Value           |
| ---------------------------- | --------------- |
| Solution unique name         | `AyontoMention` |
| Publisher                    | `Ayonto`        |
| Publisher prefix             | `ayonto`        |
| Publisher choice value prefix | `14144`         |
| Code component                | `Ayonto.AyontoMentionControl` |

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
| the security components the ledger needs | the concrete SDK message processing steps on its source tables |
| later: dispatcher and per-channel delivery state | the mapping from each text column to its companion column |

**This solution cannot carry companion columns.** A column is a component that
lives inside a table, and a solution can only carry one for a table it names
while it is being built — *"Except for choice columns, all other columns can't
exist outside of a table"*
([Solution concepts](https://learn.microsoft.com/en-us/power-platform/alm/solution-concepts-alm)).
This solution is built before it knows which application will use it. The host
knows its own tables exactly, so the columns belong there, in the solution that
already owns the table they sit on.

The plug-in *types* belong here; the *steps* that register them against a host's
table belong to the host. A step is the registration — there is no half of one —
and Microsoft describes this arrangement directly: a solution may contain a step
while *"another solution containing the assembly is already installed"*
([Register a plug-in](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-plug-in)).

The reasoning in full, including why the ingest is an asynchronous plug-in step
rather than a flow per table, is in
[`../docs/server-architecture.md`](../docs/server-architecture.md).

## Reserved layout

```
powerplatform/src/
├── solutions/AyontoMention/
├── publishers/
├── entities/
├── modernflows/
└── environmentvariabledefinitions/
```

## Rules

- **Do not hand-author files in this tree.** Every artefact must be produced by
  supported PAC CLI / Dataverse tooling against the Microsoft schema, then
  committed. Hand-written YAML drifts from the schema and breaks import.
- The control is contributed by the PCF project in [`../pcf`](../pcf) and is
  referenced from the solution project rather than copied here.
- Keep this tree customer-neutral: no tenant or environment IDs, no connection
  IDs, no real user or customer data. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

The directories currently contain only `.gitkeep` placeholders to reserve the
structure.
