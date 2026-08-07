import { describe, expect, it } from "vitest";

import * as publicApi from "../src";
import {
  INTERNAL_SNAPSHOT_APPLIED_OBSERVER,
  snapshotAppliedObserverForContainer,
} from "../src/app/workbench/internalSnapshotObserver";

describe("internal snapshot observer", () => {
  it("is absent from the public consumer API", () => {
    expect(Object.keys(publicApi)).not.toContain("INTERNAL_SNAPSHOT_APPLIED_OBSERVER");
    expect(Object.keys(publicApi)).not.toContain("snapshotAppliedObserverForContainer");
  });

  it("is scoped to the individual view container", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const observer = () => undefined;
    (first as Record<symbol, unknown>)[INTERNAL_SNAPSHOT_APPLIED_OBSERVER] = observer;

    expect(snapshotAppliedObserverForContainer(first)).toBe(observer);
    expect(snapshotAppliedObserverForContainer(second)).toBeUndefined();
  });
});
