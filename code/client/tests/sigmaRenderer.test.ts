vi.mock("sigma", () => {
  class FakeSigma {
    getCamera() {
      return {
        setState: () => undefined,
      };
    }

    refresh() {
      return undefined;
    }

    kill() {
      return undefined;
    }
  }

  return { default: FakeSigma };
});

import {
  ERR_CONTAINER_NOT_FOUND,
  SigmaRenderer,
  sigmaCameraToViewportState,
  sigmaRatioToLodZoom,
} from "../src/render/adapters/sigmaRenderer";

const CONTAINER_ID = "graph-root";

describe("sigmaRenderer", () => {
  it("throws when mounting with a missing container", () => {
    const renderer = new SigmaRenderer();

    expect(() => renderer.mount({ containerId: CONTAINER_ID })).toThrow(
      ERR_CONTAINER_NOT_FOUND.replace("{containerId}", CONTAINER_ID),
    );
  });

  it("mounts, renders, and unmounts with a valid container", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();

    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [{ id: "e_root_a_1", source: "root", target: "a" }],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    renderer.unmount();
  });

  it("maps deeper camera zoom to progressively higher lod zoom values", () => {
    expect(sigmaRatioToLodZoom(2)).toBe(1);
    expect(sigmaRatioToLodZoom(1)).toBe(2);
    expect(sigmaRatioToLodZoom(0.5)).toBe(3);
    expect(sigmaRatioToLodZoom(0.25)).toBe(4);
    expect(sigmaRatioToLodZoom(0.125)).toBe(5);
    expect(sigmaRatioToLodZoom(0.05)).toBeGreaterThan(6);
    expect(sigmaRatioToLodZoom(0.002)).toBeGreaterThan(10);
  });

  it("translates sigma camera state into graph-space viewport bounds", () => {
    expect(
      sigmaCameraToViewportState(
        { minX: -120, maxX: 280, minY: 0, maxY: 300 },
        { x: 0.25, y: 0.5, ratio: 0.5 },
      ),
    ).toEqual({
      x: -20,
      y: 150,
      width: 200,
      height: 150,
    });
  });
});
