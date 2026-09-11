/**
 * Environment shims for jsdom.
 *
 * jsdom implements no ResizeObserver, while several Fluent UI v9 components —
 * MessageBar among them — construct one on mount. Real browsers, which is where
 * a PCF control actually runs, provide it. This fills the gap so those
 * components can be rendered in tests at all.
 *
 * It is a polyfill for a missing platform API, not a stand-in for any of this
 * repository's own code, and it is only installed when the environment has none.
 */
class ResizeObserverShim implements ResizeObserver {
    public observe(): void {
        // Nothing is measured in jsdom; the callback simply never fires.
    }

    public unobserve(): void {
        // Nothing to stop observing.
    }

    public disconnect(): void {
        // Nothing to disconnect.
    }
}

globalThis.ResizeObserver ??= ResizeObserverShim;
