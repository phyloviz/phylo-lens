describe("client bootstrap", () => {
  it("bootstraps immediately when the document is already ready", async () => {
    const { runWhenDocumentReady } = await import(
      "../src/app/clientBootstrap"
    );
    const callback = vi.fn();
    const documentRef = {
      readyState: "complete",
      addEventListener: vi.fn(),
    } as unknown as Document;

    runWhenDocumentReady(callback, documentRef);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("waits for DOMContentLoaded while the document is loading", async () => {
    const { runWhenDocumentReady, WINDOW_EVENT_DOM_READY } = await import(
      "../src/app/clientBootstrap"
    );
    const callback = vi.fn();
    const addEventListener = vi.fn(
      (_event: string, handler: EventListenerOrEventListenerObject) => {
        if (typeof handler === "function") {
          handler(new Event(WINDOW_EVENT_DOM_READY));
        } else {
          handler.handleEvent(new Event(WINDOW_EVENT_DOM_READY));
        }
      },
    );
    const documentRef = {
      readyState: "loading",
      addEventListener,
    } as unknown as Document;

    runWhenDocumentReady(callback, documentRef);

    expect(addEventListener).toHaveBeenCalledWith(
      WINDOW_EVENT_DOM_READY,
      callback,
      { once: true },
    );
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
