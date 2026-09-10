# Application and domain code

Everything in this folder is plain TypeScript and React. It must not import
`ComponentFramework` types directly, so that it can be unit tested without a
Power Apps component framework host.

| Folder        | Responsibility                                                  |
| ------------- | --------------------------------------------------------------- |
| `components/` | React components rendered by the control (Fluent UI v9).          |
| `hooks/`      | Reusable React hooks.                                             |
| `services/`   | Dataverse access behind interfaces, so tests can substitute them. |
| `domain/`     | Pure logic (parsing, matching, formatting). No I/O, no React.     |
| `types/`      | Shared type declarations.                                         |

The PCF adapter lives in `../MentionControl/index.ts` and is the only place
allowed to touch the framework API.
