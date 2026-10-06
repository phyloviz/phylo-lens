import { toDatasetId, toLayoutVersion } from '../src/contracts/graph/graphIdentifiers';
import { describe, expect, it } from 'vitest';

import {
  buildGraphViewportRequest,
  expandViewportBounds,
  semanticLodLevelForCameraRatio,
  semanticLodLevelForCameraRatioWithHysteresis,
} from '../src/app/workbench/viewport/viewportRequest';

const viewState = {
  bounds: { xmin: 10, xmax: 20, ymin: -5, ymax: 15 },
  cameraRatio: 0.2,
};

describe('viewportQuery', () => {
  it('derives a viewport-area target separately from padded retrieval bounds', () => {
    const query = buildGraphViewportRequest({
      datasetId: toDatasetId('tree'),
      viewState: { ...viewState, pixelSize: { width: 480, height: 240 } },
      lodTierCount: 4,
      previousEffectiveLodLevel: 1,
    });
    expect(query.lodTargetRepresentations).toBe(200);
    expect(query.previousLodLevel).toBe(1);
    expect(query.lodSelectionBounds).toEqual(viewState.bounds);
    expect(query.xmin).toBe(5);
    expect(query.lodLevel).toBe(2);
    expect(query).not.toHaveProperty('maxNodes');
  });

  it('makes the selection target depend on screen area and configurable spacing', () => {
    const state = { ...viewState, pixelSize: { width: 480, height: 240 } };
    const base = { datasetId: toDatasetId('tree'), viewState: state };
    expect(buildGraphViewportRequest({ ...base, representationSpacingPx: 12 }).lodTargetRepresentations).toBe(800);
    expect(
      buildGraphViewportRequest({ ...base, viewState: { ...state, pixelSize: { width: 960, height: 480 } } })
        .lodTargetRepresentations
    ).toBe(800);
    expect(() => buildGraphViewportRequest({ ...base, representationSpacingPx: 0 })).toThrow();
    expect(() => buildGraphViewportRequest({ ...base, representationSpacingPx: 1e-300 })).toThrow();
  });

  it('queries bounds at adaptive tier zero and leaves explicit tier commands exact', () => {
    const base = {
      datasetId: toDatasetId('tree'),
      viewState: { ...viewState, cameraRatio: 1, pixelSize: { width: 480, height: 240 } },
      lodTierCount: 4,
    };
    const query = buildGraphViewportRequest(base);
    expect(query.lodLevel).toBe(0);
    expect(query).toHaveProperty('xmin');
    expect(query).toHaveProperty('lodTargetRepresentations');
    const pinnedCoarsest = buildGraphViewportRequest({ ...base, forcedLodLevel: 0 });
    expect(pinnedCoarsest).toHaveProperty('xmin');
    expect(pinnedCoarsest).not.toHaveProperty('lodTargetRepresentations');
    expect(buildGraphViewportRequest({ ...base, forceGlobal: true })).not.toHaveProperty('xmin');
    for (const override of [{ forceGlobal: true }, { forceFinestTier: true }, { forcedLodLevel: 2 }]) {
      expect(buildGraphViewportRequest({ ...base, ...override })).not.toHaveProperty('lodTargetRepresentations');
    }
  });

  it('omits the count limit during normal navigation', () => {
    const query = buildGraphViewportRequest({ datasetId: toDatasetId('tree'), viewState });
    expect(query).not.toHaveProperty('maxNodes');
  });

  it('builds padded bbox and semantic zoom queries from renderer viewport state', () => {
    expect(
      buildGraphViewportRequest({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        viewState,
        maxNodes: 500,
        lodTierCount: 4,
      })
    ).toEqual({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-1'),
      zoom: 5,
      lodLevel: 2,
      maxNodes: 500,
      xmin: 5,
      xmax: 25,
      ymin: -15,
      ymax: 25,
    });
  });

  it('omits bbox for global lod zero queries', () => {
    expect(
      buildGraphViewportRequest({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        viewState,
        maxNodes: 500,
        forceGlobal: true,
        lodTierCount: 4,
      })
    ).toEqual({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-1'),
      zoom: 5,
      lodLevel: 0,
      maxNodes: 500,
    });
  });

  it('targets the finest tier with no bbox when forcing finest tier', () => {
    expect(
      buildGraphViewportRequest({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        viewState,
        maxNodes: 500,
        forceFinestTier: true,
        lodTierCount: 4,
      })
    ).toEqual({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-1'),
      zoom: 5,
      lodLevel: 3,
      maxNodes: 500,
    });
  });

  it('maps camera ratio to semantic lod levels across geometric bands', () => {
    expect(semanticLodLevelForCameraRatio(1, 4)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.79, 4)).toBe(1);
    expect(semanticLodLevelForCameraRatio(0.31, 4)).toBe(2);
    expect(semanticLodLevelForCameraRatio(0.12, 4)).toBe(3);
    expect(semanticLodLevelForCameraRatio(Number.NaN, 4)).toBe(0);
  });

  it('uses denser semantic lod progression for large tier stacks', () => {
    expect(semanticLodLevelForCameraRatio(1 / 224, 15)).toBeGreaterThanOrEqual(12);
    expect(semanticLodLevelForCameraRatio(1 / 224, 15)).toBeLessThan(15);
  });

  it('holds the current tier within the boundary hysteresis dead-band', () => {
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.79, 4, 0)).toBe(0);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.75, 4, 0)).toBe(1);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.33, 4, 2)).toBe(2);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.25, 4, 1)).toBe(2);
  });

  it('reaches high zoom tiers with proportional hysteresis in both directions', () => {
    expect(semanticLodLevelForCameraRatioWithHysteresis(1 / 25.79, 6, 3)).toBe(4);
    expect(semanticLodLevelForCameraRatioWithHysteresis(1 / 60, 6, 4)).toBe(5);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.021, 6, 5)).toBe(5);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.022, 6, 5)).toBe(4);
    expect(semanticLodLevelForCameraRatioWithHysteresis(1, 6, 5)).toBe(0);
    expect(semanticLodLevelForCameraRatioWithHysteresis(0.001, 6, 0)).toBe(5);
  });

  it('expands viewport bounds with spatial padding', () => {
    expect(expandViewportBounds({ xmin: 10, xmax: 20, ymin: -5, ymax: 15 }, 0.5)).toEqual({
      xmin: 5,
      xmax: 25,
      ymin: -15,
      ymax: 25,
    });
  });
});

it('uses projected glyph footprints when they exceed nominal representation spacing', () => {
  const state = {
    cameraRatio: 1,
    bounds: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
    pixelSize: { width: 480, height: 240 },
    representationSpacingPx: 48,
  };
  expect(buildGraphViewportRequest({ datasetId: toDatasetId('test'), viewState: state }).lodTargetRepresentations).toBe(
    50
  );
  expect(
    buildGraphViewportRequest({
      datasetId: toDatasetId('test'),
      viewState: { ...state, representationSpacingPx: 6 },
    }).lodTargetRepresentations
  ).toBe(200);
});

it('keeps motion/retrieval padding out of density selection at deep zoom', () => {
  const raw = { xmin: 1.13, xmax: 1.15, ymin: 1.42, ymax: 1.44 };
  const halo = { xmin: 1.09, xmax: 1.19, ymin: 1.38, ymax: 1.48 };
  const q = buildGraphViewportRequest({
    datasetId: toDatasetId('test'),
    lodTierCount: 16,
    viewState: {
      cameraRatio: 1 / 51.22,
      bounds: halo,
      selectionBounds: raw,
      pixelSize: { width: 1500, height: 700 },
    },
  });
  expect(q.lodSelectionBounds).toEqual(raw);
  expect(q.xmin).toBeLessThan(halo.xmin);
  expect(q.xmax).toBeGreaterThan(halo.xmax);
  expect(q.lodLevel).toBeGreaterThan(8);
});
