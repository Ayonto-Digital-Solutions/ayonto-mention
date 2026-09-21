using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Ayonto.Mention.Ingest.Recipients
{
    /// <summary>
    /// Resolves a claimed recipient against the `systemuser` table.
    ///
    /// A query rather than a retrieve, deliberately. `Retrieve` answers a row that is
    /// not there by throwing, and a plug-in that reads an untrusted identifier would
    /// then have to tell "no such user" — an ordinary outcome for an untrusted claim —
    /// apart from a platform fault it must not swallow. A query answers with no rows,
    /// and nothing has to be inferred from an exception.
    ///
    /// Only what is needed is read: whether the user exists, and whether they are
    /// disabled. No name and no address, because nothing downstream may take a
    /// recipient's identity from either.
    /// </summary>
    public sealed class SystemUserDirectory : IRecipientDirectory
    {
        private const string UserTable = "systemuser";

        private readonly IOrganizationService _service;

        public SystemUserDirectory(IOrganizationService service)
        {
            if (service == null)
            {
                throw new ArgumentNullException(nameof(service));
            }

            _service = service;
        }

        public RecipientResolution Resolve(Guid userId)
        {
            if (userId == Guid.Empty)
            {
                return RecipientResolution.Unknown();
            }

            var query = new QueryExpression(UserTable)
            {
                ColumnSet = new ColumnSet("isdisabled"),
                NoLock = true,
                TopCount = 1,
            };
            query.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, userId);

            EntityCollection found = _service.RetrieveMultiple(query);
            if (found == null || found.Entities.Count == 0)
            {
                return RecipientResolution.Unknown();
            }

            Entity user = found.Entities[0];

            // Fail closed on an answer that cannot be read. `isdisabled` is a
            // system-required column on `systemuser`, so its absence here is not an
            // ordinary user with an ordinary gap — it is a query that did not return what
            // it asked for, or column security hiding it. Reading that silence as "not
            // disabled" would be choosing to notify on the strength of a value nobody
            // saw, which is the one direction this ingest must not guess in.
            object raw;
            if (!user.Attributes.TryGetValue("isdisabled", out raw) || !(raw is bool))
            {
                return RecipientResolution.Unknown();
            }

            return (bool)raw ? RecipientResolution.Disabled() : RecipientResolution.Active();
        }
    }
}
