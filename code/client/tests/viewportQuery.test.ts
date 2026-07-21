import { describe, expect, it } from "vitest";

import {
  buildGraphViewportQuery,
  expandViewportBounds,
  semanticLodLevelForCameraRatio,
  semanticLodLevelForCameraRatioWithHysteresis,
} from "../src/app/workbench/viewport/viewportQuery";

const viewState = {
  bounds: { xmin: 10, xmax: 20, ymin: -5, ymax: 15 },
  cameraRatio: 0.2,
};

describe("viewportQuery", () => {
  it("builds padded bbox and semantic zoom queries from renderer viewport state", () => {
    expect(
      buildGraphViewportQuery({
        datasetId: "tree",
        layoutVersion: "layout-1",
        viewState,
        maxNodes: 500,
        lodTierCount: 4,
      }),
    ).toEqual({
      dataset_id: "tree",
      layout_version: "layout-1",
      zoom: 5,
      lod_level: 2,
      max_nodes: 500,
      xmin: 5,
      xmax: 25,
      ymin: -15,
      ymax: 25,
    });
  });

  it("omits bbox for global lod zero queries", () => {
    expect(
      buildGraphViewportQuery({
        datasetId: "tree",
        layoutVersion: "layout-1",
        viewState,
        maxNodes: 500,
        forceGlobal: true,
        lodTierCount: 4,
      }),
    ).toEqual({
      dataset_id: "tree",
      layout_version: "layout-1",
      zoom: 5,
      lod_level: 0,
      max_nodes: 500,
    });
  });

  it("targets the finest tier with no bbox when forcing finest tier", () => {
    expect(
      buildGraphViewportQuery({
        datasetId: "tree",
        layoutVersion: "layout-1",
        viewState,
        maxNodes: 500,
        forceFinestTier: true,
        lodTierCount: 4,
      }),
    ).toEqual({
      dataset_id: "tree",
      layout_version: "layout-1",
      zoom: 5,
      lod_level: 3,
      max_nodes: 500,
    });
  });

  it("maps camera ratio to semantic lod levels across geometric bands", () => {
    expect(semanticLodLevelForCameraRatio(1, 4)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.79, 4)).toBe(1);
    expect(semanticLodLevelForCameraRatio(0.31, 4)).toBe(2);
    expect(semanticLodLevelForCameraRatio(0.12, 4)).toBe(3);
    expect(semanticLodLevelForCameraRatio(Number.NaN, 4)).toBe(0);
  });

  it("uses denser semantic lod progression for large tier stacks", () => {
    expect(semanticLodLevelForCameraRatio(1 / 224, 15)).toBeGreaterThanOrEqual(12);
    expect(semanticLodLevelForCameraRatio(1 / 224, 15)).toBeLessThan(15);
  });

  it("holds the current tier within the boundary hysteresis dead-band", () => {
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.79, 4, 0)).toBe(0);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.74, 4, 0)).toBe(1);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.33, 4, 1)).toBe(1);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.25, 4, 1)).toBe(2);
  });

  it("expands viewport bounds with spatial padding", () => {
    expect(expandViewportBounds({ xmin: 10, xmax: 20, ymin: -5, ymax: 15 }, 0.5)).toEqual({
      xmin: 5,
      xmax: 25,
      ymin: -15,
      ymax: 25,
    });
  });
});
