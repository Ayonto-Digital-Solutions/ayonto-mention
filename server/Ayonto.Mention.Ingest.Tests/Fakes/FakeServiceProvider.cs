using System;
using Microsoft.Xrm.Sdk;

namespace Ayonto.Mention.Ingest.Tests.Fakes
{
    /// <summary>
    /// The three services a plug-in is handed, and the option of handing it fewer.
    /// </summary>
    public sealed class FakeServiceProvider : IServiceProvider
    {
        public FakeServiceProvider(
            IPluginExecutionContext context,
            ITracingService trace,
            IOrganizationServiceFactory factory)
        {
            Context = context;
            Trace = trace;
            Factory = factory;
        }

        public IPluginExecutionContext Context { get; set; }

        public ITracingService Trace { get; set; }

        public IOrganizationServiceFactory Factory { get; set; }

        public object GetService(Type serviceType)
        {
            if (serviceType == typeof(IPluginExecutionContext))
            {
                return Context;
            }
            if (serviceType == typeof(ITracingService))
            {
                return Trace;
            }
            if (serviceType == typeof(IOrganizationServiceFactory))
            {
                return Factory;
            }

            return null;
        }
    }

    /// <summary>
    /// The service factory, which records the user each service was asked for and can
    /// hand out a different one per context.
    ///
    /// That argument is the whole of the privilege design: `null` "indicates the SYSTEM
    /// user", and any other value a specific user. Handing back two distinguishable
    /// services is what lets a test prove *which* operation ran under which identity,
    /// rather than only that SYSTEM was asked for at some point.
    /// </summary>
    public sealed class FakeOrganizationServiceFactory : IOrganizationServiceFactory
    {
        private readonly IOrganizationService _system;
        private readonly IOrganizationService _asUser;

        /// <summary>One service for everything, for the tests that do not care.</summary>
        public FakeOrganizationServiceFactory(IOrganizationService service)
            : this(service, null)
        {
        }

        /// <summary>
        /// A SYSTEM service and a caller-context one. `asUser` answers every request that
        /// names a user; null falls back to the SYSTEM service.
        /// </summary>
        public FakeOrganizationServiceFactory(IOrganizationService system, IOrganizationService asUser)
        {
            _system = system;
            _asUser = asUser;
        }

        /// <summary>The user ids the plug-in asked for a service as, in order.</summary>
        public System.Collections.Generic.List<Guid?> AskedFor { get; } = new System.Collections.Generic.List<Guid?>();

        public IOrganizationService CreateOrganizationService(Guid? userId)
        {
            AskedFor.Add(userId);
            if (userId == null)
            {
                return _system;
            }

            return _asUser ?? _system;
        }
    }
}
