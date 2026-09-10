# Tests

Unit and component tests mirroring the structure of `../src`.

The test runner is added in a later step. Tests must not depend on a running
Power Apps component framework host: the adapter in `../MentionControl` stays
thin precisely so that everything meaningful can be tested here.
