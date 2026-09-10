# Power Platform solution source

This tree holds the **YAML source-control format** for the Dataverse solution.

## Conventions

| Setting             | Value           |
| ------------------- | --------------- |
| Solution unique name | `AyontoMention` |
| Publisher            | `Ayonto`        |
| Publisher prefix     | `ayonto`        |

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
