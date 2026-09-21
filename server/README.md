# Server-side ingest

The plug-in that turns a saved record into `ayonto_mentionevent` rows.

```
server/
├── Ayonto.Mention.Ingest/        # the plug-in assembly, net48
└── Ayonto.Mention.Ingest.Tests/  # its unit tests, net48, no Dataverse
```

The reasoning behind the design — why the ingest is an asynchronous plug-in step
rather than a flow, why the host registers it, what the server may and may not
believe — is in [`../docs/server-architecture.md`](../docs/server-architecture.md).
This file is about the code and about what still has to happen in an environment.

## What is built, and what is not

| | |
|---|---|
| The ingest pipeline, to the point of creating an event row | **implemented, unit-tested** |
| Packaging the assembly into the `AyontoMention` solution | **blocked on an environment** — see below |
| Registering the two steps on a host table | **host-owned**, and nothing here can do it |
| Dispatcher, e-mail, Teams, in-app, per-channel delivery state | **not started** |

Nothing in this directory sends a notification, and nothing in it has run in a
Dataverse environment. The tests prove the rules; they cannot prove the platform.

## The shape of the code

Nothing decides anything inside `Execute(IServiceProvider)`. The plug-in takes the
platform apart; everything that has a rule in it is a class that can be handed
fakes.

| | |
|---|---|
| `MentionIngestPlugin` | `IPlugin`. Checks the registration, reads the step's mapping, lifts the trusted values and the images out of the context, opens the SYSTEM service |
| `MentionIngest` | The order of the work: unchanged check, payload, configuration, recipient, idempotency, row |
| `Configuration/StepConfiguration` | The step's unsecure configuration, `sourceField=metadataField` per line |
| `Payload/CompanionPayloadParser` | The companion payload, treated as a claim throughout |
| `Json/JsonReader` | A strict RFC 8259 reader, written here rather than taken from a package |
| `Text/MentionSpans` | Whether a stored position still reads as a whole mention — the server's copy of the control's own rule |
| `Notifications/NotificationConfigurationResolver` | The authoritative configuration, from published `FormXml`, failing closed on disagreement |
| `Recipients/SystemUserDirectory` | The claimed recipient, resolved against `systemuser` |
| `Ledger/MentionEventLedger` | The one table this writes, and the idempotency lookup |

### Why the tests run on Windows

The assembly targets **net48**, because a Dataverse plug-in must target .NET
Framework and [4.8 is what Microsoft recommends for new
work](https://learn.microsoft.com/power-apps/developer/data-platform/supported-customizations).
`Microsoft.NETFramework.ReferenceAssemblies` is what lets it *compile* anywhere,
including the Ubuntu runner; running a net48 test assembly needs the .NET Framework
runtime, which exists only on Windows. So CI builds and tests this project on a
Windows runner while the rest of the workflow stays on Ubuntu.

Testing the same sources on a modern runtime was the alternative. It would mean
taking the Dataverse SDK from `Microsoft.PowerPlatform.Dataverse.Client` — the only
package that ships a `Microsoft.Xrm.Sdk` for .NET 8 and later — whose dependency
tree currently carries a known high-severity advisory. Testing the assembly that
ships, on the framework it runs on, is worth one runner.

```
dotnet build server/Ayonto.Mention.Ingest/Ayonto.Mention.Ingest.csproj -c Release   # anywhere
dotnet test  server/Ayonto.Mention.Ingest.Tests/Ayonto.Mention.Ingest.Tests.csproj  # Windows
```

## Packaging: what the solution build needs, and does not have

**The assembly is not in the solution package, and the reason is worth reading
before somebody tries again.** The documented mechanism was followed as far as it
goes, and it stops at something only an environment can supply.

`pac solution add-reference` is the supported way to put a plug-in project into a
solution project: *"if you want to associate a newly created plug-in with this
solution … you can use the `pac solution add-reference` command to update the
`.cdsproj` file to add the new plug-in"*
([pac solution](https://learn.microsoft.com/power-platform/developer/cli/reference/solution)).
Running it against this project writes the reference, and the solution build then
gets two steps further and stops:

1. **NuGet refuses the reference across frameworks.**

   ```
   error NU1201: Project Ayonto.Mention.Ingest is not compatible with net462.
   Project Ayonto.Mention.Ingest supports: net48
   ```

   `AyontoMentionSolution.cdsproj` declares `net462`, which is what
   `pac solution init` writes. Raising it to `net48` clears this, and was verified
   to clear it.

2. **SolutionPackager needs a registration configuration that does not exist yet.**

   ```
   error : Unable to find assembly registration configuration for
   .../Ayonto.Mention.Ingest.dll in the destination: obj/Release/Metadata/PluginAssemblies
   ```

   The solution targets look for `PluginAssemblies/**/*.dll.data.xml` in the
   solution source and match it to the assembly by full name. That file is an
   **export artifact**: it carries the `PluginAssembly` and `PluginType` identifiers
   a Dataverse environment assigned when the assembly was registered there.

So the reference is **not** committed, and the `cdsproj` is unchanged: leaving a
reference in place that fails the build would break the release workflow, which
packs the solution on every pull request. Hand-writing the missing XML is the other
way through, and it is the one this repository refuses — *"Do not hand-author table
metadata in this tree"*, for the reason that hand-written metadata drifts from the
schema and breaks import. The `ayonto_mentionevent` table is the one documented
exception, and it is derived by a committed script from a real export rather than
typed.

### What unblocks it, in order

1. Register the assembly in the Ayonto DEV environment — the Plug-in Registration
   tool, or `pac plugin push`.
2. Add it to the unmanaged `AyontoMention` solution there and export.
3. Take the exported `PluginAssemblies/…/Ayonto.Mention.Ingest.dll.data.xml` into
   `powerplatform/src/`, unchanged.
4. Raise the `cdsproj` to `net48` and add the project reference with
   `pac solution add-reference --path ../server/Ayonto.Mention.Ingest`.
5. Flip `PLUGIN_ASSEMBLY_REQUIRED` to `True` in
   `.github/scripts/check-release-package.py`. The expectation is already written
   there in full: exactly this assembly, exactly one plug-in type, and no SDK
   message processing step — a step names a host table, and this solution is
   reusable.

Steps 1 to 3 need an environment. Steps 4 and 5 are one commit once they are done.

## The registration a host has to make

Two steps per mention-enabled source table, registered against the plug-in type
this solution supplies. The steps belong to the **host** solution: a step names the
host's own table, and this base solution is reusable and must never contain a
customer's table name.

Plug-in type: `Ayonto.Mention.Ingest.MentionIngestPlugin`

### `Update`

| Setting | Value |
|---|---|
| Message | `Update` |
| Primary entity | the host source table |
| Stage | **PostOperation** |
| Execution mode | **Asynchronous** |
| Filtering attributes | **only** the companion metadata columns |
| Pre image | alias `PreImage`, the companion metadata columns |
| Post image | alias `PostImage`, the source text columns **and** the companion metadata columns |
| Unsecure configuration | the mapping, below |

### `Create`

| Setting | Value |
|---|---|
| Message | `Create` |
| Primary entity | the host source table |
| Stage | **PostOperation** |
| Execution mode | **Asynchronous** |
| Post image | alias `PostImage`, the source text columns **and** the companion metadata columns |
| Unsecure configuration | the same mapping |

`Create` has no pre image, because there is nothing before a record exists.

**The image aliases are exactly `PreImage` and `PostImage`.** The handler refuses a
registration that names them anything else, and says so rather than finding no
columns and doing nothing.

### The unsecure configuration

One mapping per line, `sourceField=metadataField`, lower-case logical names. Blank
lines and `#` comments are skipped. Several mention-enabled columns on one table are
ordinary:

```
description=ayonto_descriptionmentions
ayonto_notes=ayonto_notesmentions
```

Refused, each with a message naming what was declared: an empty configuration, a
line that is not a mapping, a name that is not a logical name, a source column
mapped twice, one companion column claimed by two source columns, and a column
mapped to itself.

**Nothing else belongs in it.** No notification text, no e-mail address, no
recipient. Notification configuration is resolved server-side from published form
metadata per record table and source field; a recipient is resolved against
`systemuser`. Putting either here would make a step registration into delivery
authority.

### Why the mode is not negotiable

A synchronous PostOperation step runs inside the database transaction, and an
exception there rolls the whole transaction back — which would let a notification
defect refuse somebody's business record. Registered asynchronously the record is
already saved and durable before any of this code runs.

The handler holds the line from its side: registered asynchronously it **throws** on
a registration mistake, so the system job fails visibly; registered synchronously it
**traces and returns**, because throwing would take somebody's save with it.

## What must still be proven in an environment

Code and tests cannot answer any of these:

- the assembly registering, and the two steps registering against a plug-in type
  supplied by a different installed solution;
- the images arriving with the expected columns, under the expected aliases, on
  both messages;
- whether a text-only edit through this control puts the unchanged companion column
  into the `Update` request at all, and what filtering attributes then do with it;
- an asynchronous failure leaving the source-record save untouched;
- the same-display-name replacement waking the `Update` step;
- the unsecure configuration surviving export and import;
- an ordinary user saving a host record **without** holding `Create` on the ledger,
  and the ingest writing the row as SYSTEM anyway;
- `objecttypecode`, `componentstate` and `formactivationstate` narrowing the form
  query the way the documentation says they do;
- a real `FormXml` from a real published form carrying the control's parameters in
  the shape the resolver reads.

Until those have run, this is an implementation of a decision — not a working
notification pipeline.
