using System;
using System.Collections.Generic;

namespace Ayonto.Mention.Ingest.Json
{
    /// <summary>What a piece of parsed JSON turned out to be.</summary>
    public enum JsonKind
    {
        Object,
        Array,
        String,
        Number,
        Boolean,
        Null,
    }

    /// <summary>
    /// One parsed JSON value, and nothing more helpful than that.
    ///
    /// Every accessor states the kind it expects and returns false when the value
    /// is something else. There is no coercion anywhere: a string that reads like
    /// a number is a string, a number that reads like an index is not an index
    /// until somebody has asked whether it is a whole one. The payload this reads
    /// is written into a column on a business record by whoever may write the
    /// text, so a reader that quietly converts is a reader that quietly accepts.
    /// </summary>
    public sealed class JsonValue
    {
        private static readonly IReadOnlyDictionary<string, JsonValue> NoMembers =
            new Dictionary<string, JsonValue>(StringComparer.Ordinal);

        private static readonly IReadOnlyList<JsonValue> NoItems = new JsonValue[0];

        private readonly IReadOnlyDictionary<string, JsonValue> _members;
        private readonly IReadOnlyList<JsonValue> _items;
        private readonly string _text;
        private readonly double _number;
        private readonly bool _boolean;

        private JsonValue(
            JsonKind kind,
            IReadOnlyDictionary<string, JsonValue> members,
            IReadOnlyList<JsonValue> items,
            string text,
            double number,
            bool boolean)
        {
            Kind = kind;
            _members = members ?? NoMembers;
            _items = items ?? NoItems;
            _text = text;
            _number = number;
            _boolean = boolean;
        }

        public JsonKind Kind { get; }

        internal static JsonValue Object(IReadOnlyDictionary<string, JsonValue> members)
        {
            return new JsonValue(JsonKind.Object, members, null, null, 0d, false);
        }

        internal static JsonValue Array(IReadOnlyList<JsonValue> items)
        {
            return new JsonValue(JsonKind.Array, null, items, null, 0d, false);
        }

        internal static JsonValue String(string text)
        {
            return new JsonValue(JsonKind.String, null, null, text, 0d, false);
        }

        internal static JsonValue Number(double number)
        {
            return new JsonValue(JsonKind.Number, null, null, null, number, false);
        }

        internal static JsonValue Boolean(bool value)
        {
            return new JsonValue(JsonKind.Boolean, null, null, null, 0d, value);
        }

        internal static JsonValue Null()
        {
            return new JsonValue(JsonKind.Null, null, null, null, 0d, false);
        }

        /// <summary>The members of an object, empty for anything else.</summary>
        public IReadOnlyDictionary<string, JsonValue> Members
        {
            get { return Kind == JsonKind.Object ? _members : NoMembers; }
        }

        /// <summary>The items of an array, empty for anything else.</summary>
        public IReadOnlyList<JsonValue> Items
        {
            get { return Kind == JsonKind.Array ? _items : NoItems; }
        }

        /// <summary>The named member, or null where this is not an object or has no such member.</summary>
        public JsonValue Member(string name)
        {
            JsonValue found;
            return Kind == JsonKind.Object && _members.TryGetValue(name, out found) ? found : null;
        }

        /// <summary>True, with the text, only for a JSON string.</summary>
        public bool TryReadString(out string text)
        {
            text = Kind == JsonKind.String ? _text : null;
            return Kind == JsonKind.String;
        }

        /// <summary>
        /// True, with the value, only for a JSON number that is a whole number
        /// inside the range a text index can be.
        ///
        /// `1.0` is a whole number and is accepted; `1.5` and `1e400` are not.
        /// Positions in text are counted, and a counted thing that arrives with a
        /// fraction was not counted by the editor this payload claims to come from.
        /// </summary>
        public bool TryReadInt32(out int value)
        {
            value = 0;
            if (Kind != JsonKind.Number)
            {
                return false;
            }
            if (double.IsNaN(_number) || double.IsInfinity(_number))
            {
                return false;
            }
            if (_number != Math.Floor(_number))
            {
                return false;
            }
            if (_number < int.MinValue || _number > int.MaxValue)
            {
                return false;
            }

            value = (int)_number;
            return true;
        }

        /// <summary>True, with the value, only for a JSON boolean.</summary>
        public bool TryReadBoolean(out bool value)
        {
            value = Kind == JsonKind.Boolean && _boolean;
            return Kind == JsonKind.Boolean;
        }
    }
}
