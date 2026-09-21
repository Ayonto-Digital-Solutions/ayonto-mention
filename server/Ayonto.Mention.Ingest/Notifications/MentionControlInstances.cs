using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;

namespace Ayonto.Mention.Ingest.Notifications
{
    /// <summary>
    /// Finds the Mention control instances a form's XML declares for one column, and
    /// hands back the parameters each of them carries.
    ///
    /// A model-driven form is a Dataverse row and its definition is readable
    /// server-side: `SystemForm` is "Organization-owned entity customizations
    /// including form layout and dashboards", and its `FormXml` column is "XML
    /// representation of the form layout". The Form XML schema defines a
    /// `controlDescriptions` element whose `controlDescription` children each take a
    /// required `forControl` attribute, and each of those may contain `customControl`
    /// elements with an `id`, an optional `name` and `version`, and a `parameters`
    /// element.
    /// https://learn.microsoft.com/power-apps/developer/data-platform/reference/entities/systemform
    /// https://learn.microsoft.com/power-apps/developer/model-driven-apps/form-xml-schema
    ///
    /// So a control instance's configuration is durable metadata, stored against the
    /// control it belongs to. That is what makes it usable as authority — not that it
    /// is easier to read than a payload, but that reading it requires believing
    /// nobody.
    ///
    /// Which column an instance belongs to is read from the control's own bound
    /// parameter, `field`, which is the manifest's bound text property. Where that is
    /// absent the enclosing control's `datafieldname` answers the same question. The
    /// form id is deliberately not part of the question: no documented member of the
    /// plug-in execution context identifies the form a user was looking at, and a
    /// client could of course *send* one — which puts the question back where it
    /// started, with the server trusting the browser to name its own authority.
    ///
    /// One published control instance may appear several times in one form, once per
    /// form factor. That is not a conflict: the same configuration written three
    /// times agrees with itself, and three *different* configurations for one column
    /// is exactly the disagreement this product refuses to guess at.
    ///
    /// Pure: no Dataverse, nothing but the XML string.
    /// </summary>
    internal static class MentionControlInstances
    {
        /// <summary>
        /// The component's name in form metadata. Not `Ayonto.MentionControl`: that
        /// is the productive legacy control, which is a different component under the
        /// same publisher and knows nothing about this configuration.
        /// </summary>
        internal const string ControlName = "Ayonto.AyontoMentionControl";

        /// <summary>The manifest's bound text property, which names the source column.</summary>
        private const string BoundFieldParameter = "field";

        /// <summary>
        /// Reads the parameters of every Mention control instance in this form that is
        /// configured for <paramref name="sourceField"/>.
        /// </summary>
        /// <param name="formXml">One form's `formxml` value.</param>
        /// <param name="sourceField">The source column, as a lower-case logical name.</param>
        /// <param name="instances">One parameter set per matching control instance.</param>
        /// <param name="problem">Why the XML could not be read, when it could not.</param>
        internal static bool TryRead(
            string formXml,
            string sourceField,
            out IReadOnlyList<IReadOnlyDictionary<string, ParameterValue>> instances,
            out string problem)
        {
            instances = null;
            problem = null;

            if (string.IsNullOrWhiteSpace(formXml))
            {
                problem = "the form carries no formxml";
                return false;
            }

            XDocument document;
            try
            {
                // No DTD, no resolver, no external entity of any kind. Form metadata
                // is not a hostile document in the ordinary case, and a reader that
                // depends on that being true is a reader with a hole in it.
                var settings = new XmlReaderSettings
                {
                    DtdProcessing = DtdProcessing.Prohibit,
                    XmlResolver = null,
                    CloseInput = true,
                };
                using (var reader = XmlReader.Create(new StringReader(formXml), settings))
                {
                    document = XDocument.Load(reader);
                }
            }
            catch (XmlException error)
            {
                problem = "the form's formxml is not readable XML: " + error.Message;
                return false;
            }

            var found = new List<IReadOnlyDictionary<string, ParameterValue>>();
            IReadOnlyDictionary<string, string> columnsByControlId = ReadBoundColumns(document.Root);

            foreach (XElement control in Elements(document.Root, "customControl"))
            {
                string name = Attribute(control, "name");
                if (!string.Equals(name, ControlName, StringComparison.Ordinal))
                {
                    continue;
                }

                IReadOnlyDictionary<string, ParameterValue> parameters = ReadParameters(control);
                if (!BelongsTo(control, parameters, columnsByControlId, sourceField))
                {
                    continue;
                }

                found.Add(parameters);
            }

            instances = found;
            return true;
        }

        /// <summary>
        /// Whether this instance is the one configured for the column in question.
        ///
        /// The bound `field` parameter answers it where it is present. Where it is
        /// not, the control the description is `forControl` does — its
        /// `datafieldname`. An instance that answers neither way is not this column's.
        /// </summary>
        private static bool BelongsTo(
            XElement customControl,
            IReadOnlyDictionary<string, ParameterValue> parameters,
            IReadOnlyDictionary<string, string> columnsByControlId,
            string sourceField)
        {
            ParameterValue bound;
            if (parameters.TryGetValue(BoundFieldParameter, out bound) && !string.IsNullOrWhiteSpace(bound.Text))
            {
                return string.Equals(bound.Text.Trim().ToLowerInvariant(), sourceField, StringComparison.Ordinal);
            }

            for (XElement ancestor = customControl.Parent; ancestor != null; ancestor = ancestor.Parent)
            {
                string controlId = null;
                if (string.Equals(ancestor.Name.LocalName, "controlDescription", StringComparison.Ordinal))
                {
                    controlId = Attribute(ancestor, "forControl");
                }
                else if (string.Equals(ancestor.Name.LocalName, "control", StringComparison.Ordinal))
                {
                    controlId = Attribute(ancestor, "id");
                }

                if (string.IsNullOrWhiteSpace(controlId))
                {
                    continue;
                }

                string column;
                if (columnsByControlId.TryGetValue(Normalize(controlId), out column))
                {
                    return string.Equals(column, sourceField, StringComparison.Ordinal);
                }
            }

            return false;
        }

        /// <summary>
        /// Every control in the form layout that is bound to a column, by control id.
        /// Ids are compared without their braces or case, because form metadata writes
        /// them both ways.
        /// </summary>
        private static IReadOnlyDictionary<string, string> ReadBoundColumns(XElement root)
        {
            var columns = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (XElement control in Elements(root, "control"))
            {
                string id = Attribute(control, "id");
                string column = Attribute(control, "datafieldname");
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(column))
                {
                    continue;
                }

                columns[Normalize(id)] = column.Trim().ToLowerInvariant();
            }

            return columns;
        }

        private static IReadOnlyDictionary<string, ParameterValue> ReadParameters(XElement customControl)
        {
            var parameters = new Dictionary<string, ParameterValue>(StringComparer.Ordinal);
            XElement element = customControl
                .Elements()
                .FirstOrDefault(child => string.Equals(child.Name.LocalName, "parameters", StringComparison.Ordinal));
            if (element == null)
            {
                return parameters;
            }

            foreach (XElement parameter in element.Elements())
            {
                // Last one wins only in the sense that a duplicate cannot be two
                // values: a form that declares one parameter twice is a form whose
                // instances will not agree with each other, and that is caught where
                // configurations are compared.
                parameters[parameter.Name.LocalName] = new ParameterValue(
                    parameter.Value,
                    Attribute(parameter, "static"));
            }

            return parameters;
        }

        private static IEnumerable<XElement> Elements(XElement root, string localName)
        {
            if (root == null)
            {
                return new XElement[0];
            }

            return root
                .DescendantsAndSelf()
                .Where(element => string.Equals(element.Name.LocalName, localName, StringComparison.Ordinal));
        }

        private static string Attribute(XElement element, string localName)
        {
            XAttribute attribute = element
                .Attributes()
                .FirstOrDefault(candidate => string.Equals(candidate.Name.LocalName, localName, StringComparison.Ordinal));
            return attribute == null ? null : attribute.Value;
        }

        private static string Normalize(string controlId)
        {
            return controlId.Trim().Trim('{', '}').ToLowerInvariant();
        }

        /// <summary>
        /// One parameter as the form declared it: its text, and whether the form said
        /// the value is a literal rather than a column binding.
        /// </summary>
        internal sealed class ParameterValue
        {
            internal ParameterValue(string text, string staticAttribute)
            {
                Text = text;
                StaticAttribute = staticAttribute;
            }

            internal string Text { get; }

            /// <summary>The `static` attribute's raw value, or null where there was none.</summary>
            internal string StaticAttribute { get; }

            /// <summary>
            /// True where the form declared a literal value, or said nothing about it.
            ///
            /// A parameter explicitly marked as not static is bound to a column, and
            /// its text is that column's name rather than a subject line. Reading one
            /// as the other would put a column's logical name into somebody's inbox,
            /// so it is refused instead.
            /// </summary>
            internal bool IsLiteral
            {
                get
                {
                    return StaticAttribute == null
                        || string.Equals(StaticAttribute.Trim(), "true", StringComparison.OrdinalIgnoreCase);
                }
            }
        }
    }
}
