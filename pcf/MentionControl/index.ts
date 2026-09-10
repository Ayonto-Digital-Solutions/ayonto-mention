import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";

/**
 * Power Apps component framework adapter for the Ayonto Mention control.
 *
 * This class is deliberately thin. It implements only the framework
 * lifecycle and delegates rendering to the React components under `src/`.
 * Domain logic must not live here so that it stays unit-testable without
 * a PCF host.
 */
export class MentionControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;

    constructor() {
        // Empty
    }

    /**
     * Initializes the control instance.
     * @param context Property bag provided by the framework.
     * @param notifyOutputChanged Callback used to signal new outputs.
     * @param state Session state for a single user.
     */
    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
    }

    /**
     * Called whenever a value in the property bag changes.
     * @param context Property bag provided by the framework.
     * @returns The root React element for the control.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        // The render tree is introduced together with the mention implementation.
        return React.createElement(React.Fragment);
    }

    /**
     * @returns The outputs defined as "bound" or "output" in the manifest.
     */
    public getOutputs(): IOutputs {
        return {};
    }

    /**
     * Called when the control is removed from the DOM tree.
     */
    public destroy(): void {
        // Add cleanup logic here when the control acquires listeners or pending calls.
    }
}
