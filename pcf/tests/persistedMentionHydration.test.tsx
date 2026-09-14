import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { HydratedMentionEditor } from "../src/components/HydratedMentionEditor";
import type { HydratedMentionEditorProps } from "../src/components/HydratedMentionEditor";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { MentionRepositoryError } from "../src/domain/mentionPersistence";
import type {
    CreateMentionRequest,
    MentionRecipient,
    MentionRepository,
    PersistedMention,
} from "../src/domain/mentionPersistence";
import type { MentionRecordContext } from "../src/domain/recordContext";
import type { UserSearchProvider, UserSearchResult } from "../src/domain/userSearch";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";

/** Fictional records and people. Two people deliberately share a display name. */
const RECORD_A: MentionRecordContext = {
    recordId: "aaaaaaaa-1111-2222-3333-444444444444",
    recordTable: "account",
    sourceField: "description",
};
const RECORD_B: MentionRecordContext = {
    recordId: "bbbbbbbb-5555-6666-7777-888888888888",
    recordTable: "account",
    sourceField: "description",
};

const ALEX = "Alex Rivera";
const DANA = "Dana Winter";
const ROBIN = "Robin Fox";

function stored(name: string, userId: string, email?: string): PersistedMention {
    const recipient: MentionRecipient =
        email === undefined ? { userId, name } : { userId, name, email };
    return { id: `row-${userId}`, recipient };
}

interface Store {
    readonly repository: MentionRepository;
    /** The context each `list` was called with, in order. */
    readonly listCalls: MentionRecordContext[];
    readonly createCalls: CreateMentionRequest[];
    /** Answers the pending read at that index. */
    settle(index: number, mentions: readonly PersistedMention[]): Promise<void>;
    /** Fails the pending read at that index the way the repository would. */
    fail(index: number): Promise<void>;
}

function controllableStore(): Store {
    const listCalls: MentionRecordContext[] = [];
    const createCalls: CreateMentionRequest[] = [];
    const settlers: {
        resolve: (mentions: readonly PersistedMention[]) => void;
        reject: (reason: Error) => void;
    }[] = [];

    const at = (index: number): (typeof settlers)[number] => {
        const settler = settlers[index];
        if (settler === undefined) {
            throw new Error(`expected a pending read at index ${index.toString()}`);
        }
        return settler;
    };

    return {
        repository: {
            list: (context: MentionRecordContext) => {
                listCalls.push(context);
                return new Promise<readonly PersistedMention[]>((resolve, reject) => {
                    settlers.push({ resolve, reject });
                });
            },
            create: (request: CreateMentionRequest) => {
                createCalls.push(request);
                return Promise.resolve(stored(request.recipient.name, request.recipient.userId));
            },
        },
        listCalls,
        createCalls,
        settle: async (index, mentions) => {
            at(index).resolve(mentions);
            await flush();
        },
        fail: async (index) => {
            at(index).reject(new MentionRepositoryError("read"));
            await flush();
        },
    };
}

const idleSearch: UserSearchProvider = {
    search: () => Promise.resolve({ users: [], hasMore: false }),
};

interface Recorded {
    readonly changes: string[];
    readonly selected: MentionOccurrence[];
    readonly written: (readonly MentionOccurrence[])[];
}

let container: HTMLDivElement;
let recorded: Recorded;

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView"
);

function props(over: Partial<HydratedMentionEditorProps> = {}): HydratedMentionEditorProps {
    return {
        value: "",
        disabled: false,
        label: "Comment",
        userSearchProvider: idleSearch,
        repository: controllableStore().repository,
        recordContext: null,
        onChange: (next: string) => recorded.changes.push(next),
        onMentionSelected: (mention) => recorded.selected.push(mention),
        onWrittenMentionsChange: (mentions) => recorded.written.push(mentions),
        ...over,
    };
}

function render(p: HydratedMentionEditorProps): void {
    act(() => {
        ReactDOM.render(<HydratedMentionEditor {...p} />, container);
    });
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

function advance(ms: number = MENTION_SEARCH_DEBOUNCE_MS): void {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

function field(): HTMLTextAreaElement {
    const element = container.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

function type(next: string, caret: number = next.length): void {
    const element = field();
    act(() => {
        element.value = next;
        element.setSelectionRange(caret, caret);
        Simulate.change(element);
    });
}

function press(key: string): void {
    act(() => {
        Simulate.keyDown(field(), { key });
    });
}

/** The set the editor reported last, or an empty one when it never reported. */
function lastWritten(): readonly MentionOccurrence[] {
    return recorded.written[recorded.written.length - 1] ?? [];
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    recorded = { changes: [], selected: [], written: [] };
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function stubbedScrollIntoView(): void {
            // Scrolling is not what these tests are about.
        },
    });
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
    if (originalScrollIntoView === undefined) {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    } else {
        Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    }
});

describe("reading the stored mentions", () => {
    it("reads once for the record it is given", async () => {
        const store = controllableStore();
        render(props({ repository: store.repository, recordContext: RECORD_A, value: `@${ALEX} ` }));

        expect(store.listCalls).toEqual([RECORD_A]);
        await store.settle(0, [stored(ALEX, "u-alex")]);
        expect(store.listCalls).toHaveLength(1);
    });

    it("asks for exactly the record, table and column it was given", () => {
        const store = controllableStore();
        render(
            props({
                repository: store.repository,
                recordContext: { ...RECORD_A, sourceField: "ayonto_notes" },
            })
        );

        expect(store.listCalls).toEqual([{ ...RECORD_A, sourceField: "ayonto_notes" }]);
    });

    it("does not read again when the same record is rendered over and over", () => {
        const store = controllableStore();
        const stable = props({ repository: store.repository, recordContext: RECORD_A });

        render(stable);
        // A fresh context object each time, exactly as the adapter builds one.
        render({ ...stable, recordContext: { ...RECORD_A } });
        render({ ...stable, recordContext: { ...RECORD_A }, value: "typed on" });

        expect(store.listCalls).toHaveLength(1);
    });

    it("reads nothing while the record has no context", () => {
        const store = controllableStore();
        render(props({ repository: store.repository, recordContext: null, value: `@${ALEX} ` }));

        expect(store.listCalls).toEqual([]);
    });

    it("reads once the record becomes persistable, without resetting the editor", async () => {
        const store = controllableStore();
        const base = props({ repository: store.repository, recordContext: null });
        render(base);
        type("typed while unsaved");
        expect(store.listCalls).toEqual([]);

        render({ ...base, recordContext: RECORD_A });

        expect(store.listCalls).toEqual([RECORD_A]);
        // Same editing session: the text the user was in the middle of stands.
        expect(field().value).toBe("typed while unsaved");
        await store.settle(0, []);
    });

    it("reads the new record when the form moves to one", async () => {
        const store = controllableStore();
        const base = props({ repository: store.repository, recordContext: RECORD_A });
        render(base);
        await store.settle(0, []);

        render({ ...base, recordContext: RECORD_B });

        expect(store.listCalls).toEqual([RECORD_A, RECORD_B]);
    });
});

describe("hydrating what the store knew", () => {
    it("gives a mention already in the text the person it was written for", async () => {
        const store = controllableStore();
        render(
            props({
                repository: store.repository,
                recordContext: RECORD_A,
                value: `Hi @${ALEX}, thanks`,
            })
        );

        await store.settle(0, [stored(ALEX, "u-alex", "alex.rivera@example.invalid")]);

        expect(lastWritten()).toEqual([
            { start: 3, name: ALEX, userId: "u-alex", email: "alex.rivera@example.invalid" },
        ]);
    });

    it("never touches the text or tells the host anything changed", async () => {
        const store = controllableStore();
        render(
            props({ repository: store.repository, recordContext: RECORD_A, value: `@${ALEX} ` })
        );

        await store.settle(0, [stored(ALEX, "u-alex")]);

        expect(field().value).toBe(`@${ALEX} `);
        expect(recorded.changes).toEqual([]);
    });

    it("does not report a stored mention as a freshly picked one", async () => {
        const store = controllableStore();
        render(
            props({ repository: store.repository, recordContext: RECORD_A, value: `@${ALEX} ` })
        );

        await store.settle(0, [stored(ALEX, "u-alex")]);

        // A stored mention is already stored: reporting it as picked is what
        // would start another grace period and write the row a second time.
        expect(recorded.selected).toEqual([]);
    });

    it("says nothing when the store knew nobody the text names", async () => {
        const store = controllableStore();
        render(props({ repository: store.repository, recordContext: RECORD_A, value: "no names" }));

        await store.settle(0, [stored(ALEX, "u-alex")]);

        expect(recorded.written).toEqual([]);
    });

    it("infers nothing for a name two people were stored under", async () => {
        const store = controllableStore();
        render(
            props({ repository: store.repository, recordContext: RECORD_A, value: `Hi @${ROBIN} ` })
        );

        await store.settle(0, [stored(ROBIN, "id-a"), stored(ROBIN, "id-b")]);

        expect(recorded.written).toEqual([]);
    });

    it("keeps what the user picked in this session, whatever the store says", async () => {
        const store = controllableStore();
        const search = {
            search: (term: string) =>
                Promise.resolve<UserSearchResult>({
                    users:
                        term === "Ro"
                            ? [
                                  { id: "id-a", name: ROBIN, jobTitle: "Field Engineer" },
                                  { id: "id-b", name: ROBIN, jobTitle: "Account Manager" },
                              ]
                            : [],
                    hasMore: false,
                }),
        };
        render(
            props({
                repository: store.repository,
                recordContext: RECORD_A,
                userSearchProvider: search,
            })
        );

        // The user picks the second Robin Fox while the read is still out.
        type("@Ro");
        advance();
        await flush();
        press("ArrowDown");
        press("Enter");
        expect(lastWritten()).toEqual([{ start: 0, name: ROBIN, userId: "id-b" }]);

        // The store only ever saw the other one.
        await store.settle(0, [stored(ROBIN, "id-a")]);

        expect(lastWritten()).toEqual([{ start: 0, name: ROBIN, userId: "id-b" }]);
    });
});

describe("a read that comes back too late", () => {
    it("never hydrates the record now open with the one just left", async () => {
        const store = controllableStore();
        const base = props({ repository: store.repository, recordContext: RECORD_A });
        render(base);
        expect(store.listCalls).toEqual([RECORD_A]);

        // The form moves on while the first read is still out, and the record it
        // moved to has nothing stored of its own.
        render({ ...base, recordContext: RECORD_B, value: `@${ALEX} ` });
        await store.settle(1, []);
        expect(recorded.written).toEqual([]);

        // Only now does the read for the record that was left come back, and it
        // knows exactly the name standing in this record's text.
        await store.settle(0, [stored(ALEX, "u-alex-on-a")]);

        expect(recorded.written).toEqual([]);
    });

    it("leaves the record now open alone when the one just left fails", async () => {
        const store = controllableStore();
        const base = props({ repository: store.repository, recordContext: RECORD_A });
        render(base);
        render({ ...base, recordContext: RECORD_B, value: `@${ALEX} ` });
        await store.settle(1, [stored(ALEX, "u-alex-on-b")]);
        expect(lastWritten()).toEqual([{ start: 0, name: ALEX, userId: "u-alex-on-b" }]);

        await store.fail(0);

        expect(lastWritten()).toEqual([{ start: 0, name: ALEX, userId: "u-alex-on-b" }]);
    });

    it("drops what was loaded for the record just left", async () => {
        const store = controllableStore();
        const base = props({
            repository: store.repository,
            recordContext: RECORD_A,
            value: "nothing mentioned yet",
        });
        render(base);
        await store.settle(0, [stored(DANA, "u-dana")]);
        expect(recorded.written).toEqual([]);

        // Another record, whose own read has not answered yet. A mention in its
        // text must not be filled in from the record before it.
        render({ ...base, recordContext: RECORD_B, value: `@${DANA} ` });

        expect(recorded.written).toEqual([]);
    });

    it("does not touch the editor once it is gone", async () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const store = controllableStore();
        render(
            props({ repository: store.repository, recordContext: RECORD_A, value: `@${ALEX} ` })
        );

        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });
        await store.settle(0, [stored(ALEX, "u-alex")]);

        // React complains about a state update on a component that is no longer
        // there, and that complaint is the symptom of a read nobody owns.
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
    });
});

describe("a read that fails", () => {
    it("leaves the field usable and hydrates nothing", async () => {
        const store = controllableStore();
        render(
            props({ repository: store.repository, recordContext: RECORD_A, value: `@${ALEX} ` })
        );

        await store.fail(0);

        expect(recorded.written).toEqual([]);
        type("still typing");
        expect(field().value).toBe("still typing");
    });

    it("is consumed, so nothing is logged and no rejection escapes", async () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const store = controllableStore();
        render(
            props({ repository: store.repository, recordContext: RECORD_A, value: `@${ALEX} ` })
        );

        await store.fail(0);

        expect(errors).not.toHaveBeenCalled();
        expect(warnings).not.toHaveBeenCalled();
        errors.mockRestore();
        warnings.mockRestore();
    });
});

describe("a value the host decides", () => {
    it("hydrates a stored mention in the value it brings", async () => {
        const store = controllableStore();
        const base = props({ repository: store.repository, recordContext: RECORD_A, value: "" });
        render(base);
        await store.settle(0, [stored(DANA, "u-dana")]);
        expect(recorded.written).toEqual([]);

        // Another control, or a business rule, put the text there.
        render({ ...base, value: `Please read this, @${DANA} ` });

        expect(lastWritten()).toEqual([{ start: 18, name: DANA, userId: "u-dana" }]);
    });

    it("does not give a name typed by hand an identity it never had", async () => {
        const store = controllableStore();
        const base = props({
            repository: store.repository,
            recordContext: RECORD_A,
            value: `@${ALEX} `,
        });
        render(base);
        await store.settle(0, [stored(ALEX, "u-alex")]);
        expect(lastWritten()).toEqual([{ start: 0, name: ALEX, userId: "u-alex" }]);

        // Deleted locally: the mention is gone, and so is the person it meant.
        type("");
        expect(lastWritten()).toEqual([]);

        // Typed out again by hand, without picking anybody. It reads the same and
        // means nobody — the store knowing an Alex Rivera does not make this one.
        type(`@${ALEX} `);

        expect(lastWritten()).toEqual([]);
    });
});
