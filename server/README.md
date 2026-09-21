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
| `ayonto_EventId` uniqueness, so two concurrent jobs cannot write one event twice | **in the solution source** as an alternate key; **not yet imported anywhere** |
| Strong-named assembly, which registering a standalone assembly requires | **done**, and the identity is pinned by a test |
| Packaging the assembly into the `AyontoMention` solution | **blocked by a Microsoft tooling defect** — see below, with the exact error |
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
| `Ledger/MentionEventLedger` | The one table this writes, the idempotency lookup, and the duplicate-key answer |

### Idempotency is a constraint, not only a check

Looking for an existing event and then creating one are two operations. Two
asynchronous jobs for the same episode — a double save, a retried system job — can
both look, both find nothing, and both write. That notifies somebody twice, which is
the one thing `eventId` exists to prevent, and no amount of querying closes the
window.

So `ayonto_EventId` carries a **Dataverse alternate key**, which is how the platform
spells a uniqueness constraint on a column, and the second write is refused by the
database rather than by hope. One column is enough because it is already the
contract: an event identifier names one episode for one recipient, so it names one
row. The same constraint is what makes the documented conflict rule real — a second
row under a taken identifier cannot be written at all.

The handler then has to hear the refusal rather than fail the job over it:

| Create refused with | Meaning | What the ingest does |
|---|---|---|
| `DuplicateRecordEntityKey` `0x80060892` | "Entity Key {0} violated. A record with the same value for {1} already exists." | re-read, then the ordinary rule |
| `CrmSQLUniqueIndexOrConstraintViolation` `0x80073002` | *some* unique index or constraint was violated | **propagates** |
| anything else | a privilege error, a timeout, an unexpected fault | **propagates** |

One code, and it is the specific one. `0x80073002` is deliberately not treated as
idempotency: it says only that some unique constraint was violated, which is a
broader statement than "this event identifier is taken", and reading it as the
narrower one would let a genuine storage problem end a system job successfully having
recorded nothing. Whether a real race on this key can surface that way instead is a
question only a real environment can answer, and it is listed as one below.

Re-reading and applying the same rule is what keeps the outcome identical whoever
won the race: the same identity is a replay, a different one is `event_id_conflict`.
The narrowness is the point — an ingest that read every fault as idempotency would
report success for a notification it never recorded.

The key is in the solution source and both checkers require it, so a build cannot
lose it quietly. It has **not** been imported anywhere: it is newer than the
`v1.1.0.2` managed import that proved the table itself.

### The assembly is strong-named

Microsoft: *"If you don't use the dependent assemblies capability, you must sign
assemblies before you register them with Dataverse"*, and the route this assembly is
on is the standalone one — the solution project's tooling knows `PluginAssemblies`
and their registration configuration, and nothing about plug-in packages. Without a
strong name, step one of the packaging path below could not even be attempted.

`Ayonto.Mention.Ingest.snk` is therefore committed, and it is **not a secret**. A
strong name is an identity, not an authentication: anybody can generate a key and
sign their own assembly, and Microsoft is explicit that a strong name carries no
trust guarantee. What it does carry is the stable
`name, version, publicKeyToken` that Dataverse registers an assembly under — which
is exactly why it has to be the same key in every build, and therefore why it lives
in the repository rather than in a build secret. `AssemblyIdentityTests` pins the
resulting token, so regenerating the key is allowed and doing it unnoticed is not:

```
Ayonto.Mention.Ingest, Version=1.0.0.0, Culture=neutral, PublicKeyToken=0e66244ba4f12435
```

### Two services, and which is which is the security design

The plug-in opens exactly two, and the difference between them is what separates
resolving a recipient from authorizing one.

| | Service | Why |
|---|---|---|
| `SystemFormSource` | `CreateOrganizationService(null)` — SYSTEM | The published configuration is **product** state. Read through the saving user's roles, the same field would resolve a configuration for one colleague and none for another, and the difference would be frozen into a durable row somebody else is notified from |
| `MentionEventLedger` | SYSTEM | An ordinary user must be able to save a host record without holding `Create` on the event table. This is the privilege the whole design exists to take away from them |
| `SystemUserDirectory` | `CreateOrganizationService(context.InitiatingUserId)` | **The recipient lookup is an authorization**, not a lookup |

That last row is the point. Anybody who may write the source text may write any
identifier into the companion column, so "is this a real, enabled user" is only half
the question — "may the person who saved this record name that user at all" is the
rest of it, and SYSTEM would answer yes to both for anybody in the environment. Asked
in the initiating user's context, a recipient they cannot see simply does not resolve,
and no event is created.

`InitiatingUserId` rather than `UserId`: the documented difference is that `null`
"indicates the SYSTEM user" and `Guid.Empty` "the same user as
`IPluginExecutionContext.UserId`". The actor is whoever caused the operation, and a
step registered to run as somebody else must not widen what that actor can reach.

### What makes somebody a recipient

The server is the authority, and it enforces the same eligibility the control's own
lookup does rather than trusting that the lookup was used at all:

| | |
|---|---|
| resolvable in the initiating user's context | else **Unknown** |
| `isdisabled` is `false` | missing or unreadable → **Unknown**; `true` → **Disabled** |
| no `applicationid` | an application user is an identity for code → **Ineligible** |
| `accessmode` is neither 3 nor 4 | Support User and Non-interactive are not people → **Ineligible** |

Every value the decision needs has to be readable; silence refuses rather than
defaults. No e-mail address is read and none is required: whether a mailbox exists is
a delivery question for the dispatcher, and Teams and in-app notification need none.

The two access-mode numbers mirror
`pcf/src/services/dataverseUserSearchService.ts`, deliberately rather than
independently: a person the editor could never have picked must not become a recipient
because a payload named them. Confirming the numeric mapping against a real
environment's `systemuser_accessmode` choice is one of the proofs below.

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

## Packaging: a confirmed tooling defect, twice attempted

**The assembly is not in the solution package.** The documented mechanism was
followed to the end, twice, in both of the configurations Microsoft's own tooling
produces — and it fails at the same place both times. Attempting it a third way is
not the next useful thing to do.

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

**Both routes were tried, with the versions the current toolchain actually
resolves.** `pac` 2.12.1's own `pac plugin init` template asks for
`Microsoft.PowerApps.MSBuild.Plugin` `1.*`, which resolves to 1.52.1, the same
generation as the solution project's `Microsoft.PowerApps.MSBuild.Solution` `1.*`.
The second attempt used that template's plug-in **package** configuration —
`GeneratePackageOnBuild` on, so the build also produces the NuGet package the
dependent-assemblies capability uses — and the solution build failed with the
identical error. That is consistent with what the solution targets contain: the
MSBuild task that processes a project reference looks for `PluginAssemblies` and
`*dll.data.xml` and has no notion of a plug-in package at all.

So the reference is **not** committed, and the `cdsproj` is unchanged: leaving a
reference in place that fails the build would break the release workflow, which
packs the solution on every pull request. Hand-writing the missing XML is the other
way through, and it is the one this repository refuses — *"Do not hand-author table
metadata in this tree"*, for the reason that hand-written metadata drifts from the
schema and breaks import. The `ayonto_mentionevent` table is the one documented
exception, and it is derived by a committed script from a real export rather than
typed.

**What that means for the version number.** The built package carries no server
component, so this work is not released as a server release. The solution version is
`1.1.0.3` — a revision on top of the `1.1.0.2` that a real environment imported, and
the package genuinely does differ from it by the alternate key. It is deliberately
**not** `1.2.0.0`: a minor version would read as "the server ships now", and it does
not. Reusing `1.1.0.2` was the other option and is worse — that version is published,
and two different packages under one version is exactly what this repository's release
workflow refuses to allow.

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
6. Then, and only then, the solution version becomes a minor one: the package
   carries a server component for the first time.

Steps 1 to 3 need an environment. Steps 4 to 6 are one commit once they are done.

The alternative worth watching rather than working around: the defect is in the
solution project's plug-in handling, so a later
`Microsoft.PowerApps.MSBuild.Solution` may simply fix it. Re-running step 4 against a
newer package is a cheap thing to retry; inventing registration XML is not.

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
  the shape the resolver reads;
- the alternate key surviving a managed import, and the supporting index being
  created — the key is newer than the `v1.1.0.2` import that proved the table;
- a genuine concurrent double save producing `DuplicateRecordEntityKey` and the
  handler converging on one row, which is the only way to confirm that error code
  against a real platform rather than against a fake — and whether such a race can
  instead surface as `CrmSQLUniqueIndexOrConstraintViolation`, which is currently
  treated as an unexpected fault;
- that the initiating user's own context can read `systemuser` for an ordinary
  recipient, and that a recipient outside their reach resolves to nothing rather than
  to a fault;
- that `systemuser_accessmode` really numbers Support User 3 and Non-interactive 4 in
  a live environment, which is taken from the control's contract rather than from a
  published choice table.

Until those have run, this is an implementation of a decision — not a working
notification pipeline.
