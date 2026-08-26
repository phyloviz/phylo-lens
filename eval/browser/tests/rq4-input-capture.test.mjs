import assert from "node:assert/strict";
import test from "node:test";
import {
  armCaptureInput,
  matchesCaptureInput,
} from "../src/rq4-input-capture.mjs";

const specification = {
  eventType: "dblclick",
  nativeEventType: "click",
  clickCount: 2,
  clientX: 10,
  clientY: 20,
  targetClusterId: "cluster-1",
};

function fixtureDocument() {
  let listener = null;
  return {
    document: {
      addEventListener: (type, callback, capture) => {
        listener = { type, callback, capture };
      },
      removeEventListener: (type, callback, capture) => {
        if (
          listener?.type === type &&
          listener.callback === callback &&
          listener.capture === capture
        )
          listener = null;
      },
    },
    listener: () => listener,
  };
}

function event(overrides = {}) {
  return {
    type: "click",
    isTrusted: true,
    detail: 2,
    clientX: 10,
    clientY: 20,
    target: {},
    preventDefault: () => {
      throw new Error("capture listener must not prevent default");
    },
    stopPropagation: () => {
      throw new Error("capture listener must not stop propagation");
    },
    ...overrides,
  };
}

test("capture phase records the trusted second click before synchronous collapse", () => {
  const { document, listener } = fixtureDocument();
  const root = { contains: () => true };
  const captured = [];
  armCaptureInput(document, root, specification, (input) =>
    captured.push(input),
  );
  assert.equal(listener().type, "click");
  assert.equal(listener().capture, true);
  listener().callback(event());
  assert.deepEqual(captured, [
    {
      eventType: "dblclick",
      nativeEventType: "click",
      clickCount: 2,
      capturePhase: true,
      timestamp: captured[0].timestamp,
      clientX: 10,
      clientY: 20,
      isTrusted: true,
      targetClusterId: "cluster-1",
      stage: "graph-root",
    },
  ]);
  assert.equal(listener(), null);
});

test("capture rejects untrusted, wrong-event, and wrong-target-context input", () => {
  const root = { contains: (target) => target === "inside" };
  assert.equal(
    matchesCaptureInput(
      event({ isTrusted: false, target: "inside" }),
      specification,
      root,
    ),
    false,
  );
  assert.equal(
    matchesCaptureInput(
      event({ detail: 1, target: "inside" }),
      specification,
      root,
    ),
    false,
  );
  assert.equal(
    matchesCaptureInput(event({ target: "outside" }), specification, root),
    false,
  );
  assert.equal(
    matchesCaptureInput(event({ target: "inside" }), specification, root),
    true,
  );
});
