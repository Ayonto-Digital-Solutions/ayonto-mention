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
    /// The service factory, which records the user the service was asked for.
    ///
    /// That argument is the whole of the SYSTEM decision: `null` "indicates the SYSTEM
    /// user", and a test asserting it is asserting that the authoritative ledger write
    /// does not borrow the calling user's privileges.
    /// </summary>
    public sealed class FakeOrganizationServiceFactory : IOrganizationServiceFactory
    {
        private readonly IOrganizationService _service;

        public FakeOrganizationServiceFactory(IOrganizationService service)
        {
            _service = service;
        }

        /// <summary>The user ids the plug-in asked for a service as, in order.</summary>
        public System.Collections.Generic.List<Guid?> AskedFor { get; } = new System.Collections.Generic.List<Guid?>();

        public IOrganizationService CreateOrganizationService(Guid? userId)
        {
            AskedFor.Add(userId);
            return _service;
        }
    }
}
