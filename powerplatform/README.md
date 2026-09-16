# Power Platform solution source

This tree holds the **YAML source-control format** for the Dataverse solution.

## Conventions

| Setting                      | Value           |
| ---------------------------- | --------------- |
| Solution unique name         | `AyontoMention` |
| Publisher                    | `Ayonto`        |
| Publisher prefix             | `ayonto`        |
| Publisher choice value prefix | `45013`         |

**The choice value prefix is a decision, not a discovery.** Dataverse derives the
values of choices created under a publisher from it, and `pac solution init`
picks a new one every time it runs — so without fixing it, the same publisher
would arrive at an environment wearing a different number in each release, and
two builds of one commit would differ for a reason that has nothing to do with
what is being shipped. `45013` is the value this product uses. The release
packaging sets it and the package checker enforces it.

It has to stay the same across releases. When the real solution and publisher are
exported from the Ayonto DEV environment into this tree, the exported publisher
must carry `45013` too. If a Dataverse environment ever turns out to hold an
`Ayonto` publisher with a different choice value prefix, **stop and reconcile the
two deliberately** — do not quietly change either side, because the value is part
of how existing choices keep their meaning.

The current v1.0.0 package creates no choices at all; the convention is recorded
now because v1.0.0 is what establishes the publisher.

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
