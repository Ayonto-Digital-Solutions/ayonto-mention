using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Ledger;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Recipients;

namespace Ayonto.Mention.Ingest.Tests.Fakes
{
    /// <summary>The published forms of a table, from a dictionary.</summary>
    public sealed class FakePublishedFormSource : IPublishedFormSource
    {
        private readonly Dictionary<string, List<PublishedForm>> _forms =
            new Dictionary<string, List<PublishedForm>>(StringComparer.OrdinalIgnoreCase);

        /// <summary>The tables that were asked about, in order.</summary>
        public List<string> AskedFor { get; } = new List<string>();

        public FakePublishedFormSource With(string recordTable, string name, string formXml)
        {
            List<PublishedForm> forms;
            if (!_forms.TryGetValue(recordTable, out forms))
            {
                forms = new List<PublishedForm>();
                _forms.Add(recordTable, forms);
            }

            forms.Add(new PublishedForm(Guid.NewGuid().ToString("D"), name, formXml));
            return this;
        }

        public IReadOnlyList<PublishedForm> FormsFor(string recordTable)
        {
            AskedFor.Add(recordTable);

            List<PublishedForm> forms;
            return _forms.TryGetValue(recordTable, out forms) ? forms : new List<PublishedForm>();
        }
    }

    /// <summary>A configuration resolver that answers whatever a test told it to.</summary>
    public sealed class FakeConfigurationResolver : INotificationConfigurationResolver
    {
        private readonly Func<string, string, NotificationConfigurationResult> _answer;

        public FakeConfigurationResolver(NotificationConfigurationResult answer)
        {
            _answer = (table, field) => answer;
        }

        public FakeConfigurationResolver(Func<string, string, NotificationConfigurationResult> answer)
        {
            _answer = answer;
        }

        /// <summary>Table and column pairs that were resolved, in order.</summary>
        public List<string> Resolved { get; } = new List<string>();

        public NotificationConfigurationResult Resolve(string recordTable, string sourceField)
        {
            Resolved.Add(recordTable + "." + sourceField);
            return _answer(recordTable, sourceField);
        }
    }

    /// <summary>A directory in which the users a test named exist, and nobody else does.</summary>
    public sealed class FakeRecipientDirectory : IRecipientDirectory
    {
        private readonly Dictionary<Guid, RecipientStatus> _users = new Dictionary<Guid, RecipientStatus>();

        /// <summary>The users that were looked up, in order.</summary>
        public List<Guid> LookedUp { get; } = new List<Guid>();

        public FakeRecipientDirectory WithActive(Guid userId)
        {
            _users[userId] = RecipientStatus.Active;
            return this;
        }

        public FakeRecipientDirectory WithDisabled(Guid userId)
        {
            _users[userId] = RecipientStatus.Disabled;
            return this;
        }

        /// <summary>A real, enabled account that is not a person to notify.</summary>
        public FakeRecipientDirectory WithIneligible(Guid userId)
        {
            _users[userId] = RecipientStatus.Ineligible;
            return this;
        }

        public RecipientResolution Resolve(Guid userId)
        {
            LookedUp.Add(userId);

            RecipientStatus status;
            if (!_users.TryGetValue(userId, out status))
            {
                return RecipientResolution.Unknown();
            }

            switch (status)
            {
                case RecipientStatus.Active:
                    return RecipientResolution.Active();
                case RecipientStatus.Disabled:
                    return RecipientResolution.Disabled();
                case RecipientStatus.Ineligible:
                    return RecipientResolution.Ineligible();
                default:
                    return RecipientResolution.Unknown();
            }
        }
    }

    /// <summary>A ledger in memory: what it already holds, and what was written to it.</summary>
    public sealed class FakeMentionEventLedger : IMentionEventLedger
    {
        private readonly List<MentionEventIdentity> _existing = new List<MentionEventIdentity>();
        private MentionEventIdentity _writtenByTheRace;
        private bool _racesOnce;

        /// <summary>The rows that were created, in order.</summary>
        public List<MentionEventRow> Rows { get; } = new List<MentionEventRow>();

        /// <summary>The event identifiers that were looked up, in order.</summary>
        public List<string> LookedUp { get; } = new List<string>();

        public FakeMentionEventLedger Holding(MentionEventIdentity identity)
        {
            _existing.Add(identity);
            return this;
        }

        /// <summary>
        /// Behaves like a second asynchronous job that got there first: the lookup finds
        /// nothing, and then the alternate key refuses the write because
        /// <paramref name="winner"/> has just been written under the same identifier.
        /// </summary>
        public FakeMentionEventLedger LosingTheRaceTo(MentionEventIdentity winner)
        {
            _writtenByTheRace = winner;
            _racesOnce = true;
            return this;
        }

        public IReadOnlyList<MentionEventIdentity> WithEventId(string eventId)
        {
            LookedUp.Add(eventId);

            var found = new List<MentionEventIdentity>();
            foreach (MentionEventIdentity identity in _existing)
            {
                if (string.Equals(identity.EventId, eventId, StringComparison.Ordinal))
                {
                    found.Add(identity);
                }
            }

            return found;
        }

        public LedgerWriteOutcome Create(MentionEventRow row)
        {
            if (_racesOnce)
            {
                _racesOnce = false;
                if (_writtenByTheRace != null)
                {
                    _existing.Add(_writtenByTheRace);
                }

                return LedgerWriteOutcome.EventIdTaken;
            }

            Rows.Add(row);
            _existing.Add(row.Identity);
            return LedgerWriteOutcome.Created;
        }
    }
}
