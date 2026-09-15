/**
 * Stands in for Floating UI's geometry engine while tests run.
 *
 * Fluent positions the suggestion list with Floating UI, which measures elements
 * and decides where they fit. jsdom performs no layout: every element it is
 * asked about is zero by zero at the origin. The engine therefore cannot produce
 * a meaningful answer here, and computing one anyway costs about thirty seconds
 * per opened popup as it retries a problem that has no solution in this
 * environment.
 *
 * So the arithmetic is replaced and nothing else is. The positioning *contract* —
 * which element is the target, which strategy, which boundaries — is still built
 * by the editor and still handed to Fluent, and `computePosition` is a spy, so a
 * test can assert what actually reached the engine. What is not tested here is
 * where a popup physically lands on a screen, which is a browser's business and
 * is verified in a real environment rather than pretended at in jsdom.
 *
 * Nothing about this file reaches production: it exists only in the Jest setup.
 */
jest.mock("@floating-ui/dom", () => {
    const actual = jest.requireActual<Record<string, unknown>>("@floating-ui/dom");

    return {
        ...actual,
        computePosition: jest.fn(() =>
            Promise.resolve({
                x: 0,
                y: 0,
                placement: "bottom-start",
                strategy: "fixed",
                middlewareData: {},
            })
        ),
    };
});
