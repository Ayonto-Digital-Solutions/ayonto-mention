import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";

/**
 * The context and state types are derived from the control itself rather than
 * imported from `generated/ManifestTypes`, so this suite stays valid when the
 * manifest gains properties.
 */
type ControlContext = Parameters<MentionControl["init"]>[0];
type ControlState = Parameters<MentionControl["init"]>[2];

const createContext = (): ControlContext => ({}) as unknown as ControlContext;
// ControlState is ComponentFramework.Dictionary, an index signature that an
// empty object already satisfies, so no assertion is needed here. The context
// above is a different matter: it has fourteen required members.
const createState = (): ControlState => ({});

describe("MentionControl adapter", () => {
    let control: MentionControl;
    let notifyOutputChanged: jest.Mock<void, []>;

    beforeEach(() => {
        control = new MentionControl();
        notifyOutputChanged = jest.fn<void, []>();
    });

    it("initializes without invoking the framework callback", () => {
        expect(() =>
            control.init(createContext(), notifyOutputChanged, createState())
        ).not.toThrow();

        // The framework must only be notified when outputs actually change.
        expect(notifyOutputChanged).not.toHaveBeenCalled();
    });

    it("returns a valid React element from updateView", () => {
        control.init(createContext(), notifyOutputChanged, createState());

        expect(React.isValidElement(control.updateView(createContext()))).toBe(true);
    });

    it("mounts the element returned by updateView into the DOM", () => {
        control.init(createContext(), notifyOutputChanged, createState());

        const container = document.createElement("div");
        document.body.appendChild(container);

        expect(() => {
            act(() => {
                ReactDOM.render(control.updateView(createContext()), container);
            });
        }).not.toThrow();

        // Rendering alone must never trigger an output notification.
        expect(notifyOutputChanged).not.toHaveBeenCalled();

        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });
        container.remove();
    });

    it("exposes outputs as an object", () => {
        control.init(createContext(), notifyOutputChanged, createState());

        const outputs = control.getOutputs();

        expect(outputs).toBeDefined();
        expect(typeof outputs).toBe("object");
    });

    it("can be destroyed after initialization", () => {
        control.init(createContext(), notifyOutputChanged, createState());

        expect(() => control.destroy()).not.toThrow();
    });
});
