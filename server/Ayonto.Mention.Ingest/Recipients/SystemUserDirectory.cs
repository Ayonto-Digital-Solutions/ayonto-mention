using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Ayonto.Mention.Ingest.Recipients
{
    /// <summary>
    /// Resolves a claimed recipient against the `systemuser` table, in the context of
    /// the user whose save produced the claim.
    ///
    /// **The context is the authorization.** The companion column sits on a business
    /// record and anybody who may write the text may write an identifier into it, so
    /// "this is a real, enabled user" is not enough on its own: it would let somebody
    /// name a user they have no business naming and have the server notify them
    /// anyway. Asked through the initiating user's own service, a recipient the saving
    /// user cannot see does not resolve — and no event is created. That is the
    /// difference between resolving a recipient and authorizing one, and it is why
    /// this is the one part of the ingest that is deliberately not SYSTEM.
    ///
    /// A query rather than a retrieve, deliberately. `Retrieve` answers a row that is
    /// not there — or that the caller may not see — by throwing, and a plug-in reading
    /// an untrusted identifier would then have to tell an ordinary outcome apart from a
    /// platform fault it must not swallow. A query answers with no rows, and nothing
    /// has to be inferred from an exception.
    ///
    /// Only what the decision needs is read, and a name or an address is not part of
    /// it: nothing downstream may take a recipient's identity from either.
    /// </summary>
    public sealed class SystemUserDirectory : IRecipientDirectory
    {
        private const string UserTable = "systemuser";

        /// <summary>
        /// The access modes that are not people. 3 is Support User and 4 is
        /// Non-interactive — accounts that exist to run code or to carry a service,
        /// not to read a message.
        ///
        /// These are the same two values the control's own lookup excludes, in
        /// `pcf/src/services/dataverseUserSearchService.ts`, and this is deliberately a
        /// mirror of that contract rather than a second opinion about it: a person the
        /// editor could never have picked must not become a recipient because a payload
        /// named them. The numeric mapping is the one the client and the legacy control
        /// have used in production; confirming it against a real environment's
        /// `systemuser_accessmode` choice is listed in server/README.md as a proof this
        /// code cannot give itself.
        /// </summary>
        private const int SupportUserAccessMode = 3;

        private const int NonInteractiveAccessMode = 4;

        private readonly IOrganizationService _service;

        /// <summary>
        /// Takes the service to ask with. The plug-in hands it the one opened for
        /// `IPluginExecutionContext.InitiatingUserId` — the user who caused the
        /// source-record operation — and never the SYSTEM one.
        /// </summary>
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
                ColumnSet = new ColumnSet("isdisabled", "applicationid", "accessmode"),
                NoLock = true,
                TopCount = 1,
            };
            query.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, userId);

            EntityCollection found = _service.RetrieveMultiple(query);
            if (found == null || found.Entities.Count == 0)
            {
                // No such user, or none this caller may see. The two are one answer on
                // purpose: telling them apart would mean reporting the existence of a
                // record the caller has no access to.
                return RecipientResolution.Unknown();
            }

            Entity user = found.Entities[0];

            // Fail closed on an answer that cannot be read. `isdisabled` is a
            // system-required column on `systemuser`, so its absence here is not an
            // ordinary user with an ordinary gap — it is a query that did not return what
            // it asked for, or column security hiding it. Reading that silence as "not
            // disabled" would be choosing to notify on the strength of a value nobody
            // saw, which is the one direction this ingest must not guess in.
            bool disabled;
            if (!TryReadBoolean(user, "isdisabled", out disabled))
            {
                return RecipientResolution.Unknown();
            }
            if (disabled)
            {
                return RecipientResolution.Disabled();
            }

            // An application user is an identity for code. It has no inbox, no Teams
            // chat and nobody reading an in-app notification.
            object applicationId;
            if (user.Attributes.TryGetValue("applicationid", out applicationId) && IsSet(applicationId))
            {
                return RecipientResolution.Ineligible();
            }

            // Needed for the decision, so an unreadable value refuses rather than
            // defaults: "probably a person" is not a recipient.
            int accessMode;
            if (!TryReadOptionSet(user, "accessmode", out accessMode))
            {
                return RecipientResolution.Unknown();
            }
            if (accessMode == SupportUserAccessMode || accessMode == NonInteractiveAccessMode)
            {
                return RecipientResolution.Ineligible();
            }

            return RecipientResolution.Active();
        }

        private static bool TryReadBoolean(Entity entity, string column, out bool value)
        {
            value = false;

            object raw;
            if (!entity.Attributes.TryGetValue(column, out raw) || !(raw is bool))
            {
                return false;
            }

            value = (bool)raw;
            return true;
        }

        /// <summary>
        /// Reads a choice column. Dataverse hands one over as an `OptionSetValue`; an
        /// `int` is accepted as well so that the reading is about the value rather than
        /// about how a caller happened to build a row.
        /// </summary>
        private static bool TryReadOptionSet(Entity entity, string column, out int value)
        {
            value = 0;

            object raw;
            if (!entity.Attributes.TryGetValue(column, out raw))
            {
                return false;
            }

            var option = raw as OptionSetValue;
            if (option != null)
            {
                value = option.Value;
                return true;
            }
            if (raw is int)
            {
                value = (int)raw;
                return true;
            }

            return false;
        }

        /// <summary>True for an identifier that actually names something.</summary>
        private static bool IsSet(object value)
        {
            if (value is Guid)
            {
                return (Guid)value != Guid.Empty;
            }

            var text = value as string;
            if (text != null)
            {
                Guid parsed;
                return Guid.TryParse(text, out parsed) && parsed != Guid.Empty;
            }

            var reference = value as EntityReference;
            return reference != null && reference.Id != Guid.Empty;
        }
    }
}
