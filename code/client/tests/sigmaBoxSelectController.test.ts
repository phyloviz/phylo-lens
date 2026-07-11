import { describe, expect, it, vi } from "vitest";

import {
  BOX_SELECT_OVERLAY_CLASS,
  default as sigmaBoxSelectController,
} from "../src/render/adapters/sigma/sigmaBoxSelectController";
import type { SigmaViewportBounds } from "../src/render/adapters/sigma/graphViewerTypes";

type Handler = (payload: unknown) => void;

function makeFakeSigma() {
  const handlers = new Map<string, Handler>();
  const settings = new Map<string, unknown>([["enableCameraPanning", true]]);
  const mouseCaptor = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    off: (event: string, handler: Handler) => {
      if (handlers.get(event) === handler) {
        handlers.delete(event);
      }
    },
  };

  return {
    sigma: {
      getMouseCaptor: () => mouseCaptor,
      getSetting: (key: string) => settings.get(key),
      setSetting: (key: string, value: unknown) => {
        settings.set(key, value);
      },
      // Identity-ish conversion: viewport px map to graph coords with a y-flip
      // and 2x scale so tests can assert the min/max normalization.
      viewportToGraph: (point: { x: number; y: number }) => ({
        x: point.x * 2,
        y: -point.y,
      }),
    },
    emit: (event: string, payload: unknown) => handlers.get(event)?.(payload),
    getSetting: (key: string) => settings.get(key),
    hasHandler: (event: string) => handlers.has(event),
  };
}

describe("SigmaBoxSelectController", () => {
  it("converts a shift+drag box to normalized graph bounds", () => {
    const container = document.createElement("div");
    const rig = makeFakeSigma();
    const onRegionSelected = vi.fn<[SigmaViewportBounds], void>();

    const controller = sigmaBoxSelectController({
      getSigma: () => rig.sigma as never,
      getContainer: () => container,
      isModeEnabled: () => false,
      onRegionSelected,
    });
    controller.bind();

    rig.emit("mousedown", {
      x: 40,
      y: 60,
      original: { shiftKey: true },
      preventSigmaDefault: () => {},
    });
    // Camera panning is suppressed while a box is being drawn.
    expect(rig.getSetting("enableCameraPanning")).toBe(false);
    expect(container.querySelector(`.${BOX_SELECT_OVERLAY_CLASS}`)).not.toBeNull();

    rig.emit("mousemovebody", { x: 10, y: 20, preventSigmaDefault: () => {} });
    rig.emit("mouseup", { x: 10, y: 20, preventSigmaDefault: () => {} });

    expect(onRegionSelected).toHaveBeenCalledTimes(1);
    // start=(40,60)->(80,-60), end=(10,20)->(20,-20); min/max normalized.
    expect(onRegionSelected).toHaveBeenCalledWith({
      xmin: 20,
      xmax: 80,
      ymin: -60,
      ymax: -20,
    });
    // Overlay removed and camera panning restored after release.
    expect(container.querySelector(`.${BOX_SELECT_OVERLAY_CLASS}`)).toBeNull();
    expect(rig.getSetting("enableCameraPanning")).toBe(true);
  });

  it("ignores a plain drag when region-select mode is off and Shift is absent", () => {
    const container = document.createElement("div");
    const rig = makeFakeSigma();
    const onRegionSelected = vi.fn<[SigmaViewportBounds], void>();

    const controller = sigmaBoxSelectController({
      getSigma: () => rig.sigma as never,
      getContainer: () => container,
      isModeEnabled: () => false,
      onRegionSelected,
    });
    controller.bind();

    rig.emit("mousedown", { x: 40, y: 60, preventSigmaDefault: () => {} });
    rig.emit("mousemovebody", { x: 10, y: 20, preventSigmaDefault: () => {} });
    rig.emit("mouseup", { x: 10, y: 20, preventSigmaDefault: () => {} });

    expect(onRegionSelected).not.toHaveBeenCalled();
    expect(container.querySelector(`.${BOX_SELECT_OVERLAY_CLASS}`)).toBeNull();
    // Camera panning is left untouched when no box is drawn.
    expect(rig.getSetting("enableCameraPanning")).toBe(true);
  });

  it("draws a box on a plain drag once region-select mode is enabled", () => {
    const container = document.createElement("div");
    const rig = makeFakeSigma();
    const onRegionSelected = vi.fn<[SigmaViewportBounds], void>();

    const controller = sigmaBoxSelectController({
      getSigma: () => rig.sigma as never,
      getContainer: () => container,
      isModeEnabled: () => true,
      onRegionSelected,
    });
    controller.bind();

    rig.emit("mousedown", { x: 5, y: 5, preventSigmaDefault: () => {} });
    rig.emit("mousemovebody", { x: 50, y: 50, preventSigmaDefault: () => {} });
    rig.emit("mouseup", { x: 50, y: 50, preventSigmaDefault: () => {} });

    expect(onRegionSelected).toHaveBeenCalledTimes(1);
  });

  it("treats a sub-threshold drag as a click and emits nothing", () => {
    const container = document.createElement("div");
    const rig = makeFakeSigma();
    const onRegionSelected = vi.fn<[SigmaViewportBounds], void>();

    const controller = sigmaBoxSelectController({
      getSigma: () => rig.sigma as never,
      getContainer: () => container,
      isModeEnabled: () => true,
      onRegionSelected,
    });
    controller.bind();

    rig.emit("mousedown", { x: 30, y: 30, preventSigmaDefault: () => {} });
    rig.emit("mouseup", { x: 31, y: 31, preventSigmaDefault: () => {} });

    expect(onRegionSelected).not.toHaveBeenCalled();
    expect(container.querySelector(`.${BOX_SELECT_OVERLAY_CLASS}`)).toBeNull();
  });

  it("detaches its captor handlers on unbind", () => {
    const container = document.createElement("div");
    const rig = makeFakeSigma();
    const controller = sigmaBoxSelectController({
      getSigma: () => rig.sigma as never,
      getContainer: () => container,
      isModeEnabled: () => true,
      onRegionSelected: vi.fn(),
    });

    controller.bind();
    expect(rig.hasHandler("mousedown")).toBe(true);
    controller.unbind();
    expect(rig.hasHandler("mousedown")).toBe(false);
  });
});
