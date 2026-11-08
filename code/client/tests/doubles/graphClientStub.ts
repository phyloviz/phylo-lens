import { vi } from 'vitest';
import type { GraphClient } from '../../src/contracts/graph/GraphClient';

async function unexpected(): Promise<never> {
  throw new Error('Unexpected graph client operation; configure this scenario explicitly.');
}

export function graphClientStub(overrides: Partial<GraphClient> = {}) {
  return {
    prepareGraph: vi.fn<GraphClient['prepareGraph']>(unexpected),
    readViewport: vi.fn<GraphClient['readViewport']>(unexpected),
    applyAncillaryData: vi.fn<GraphClient['applyAncillaryData']>(unexpected),
    searchGraph: vi.fn<GraphClient['searchGraph']>(unexpected),
    readRegion: vi.fn<GraphClient['readRegion']>(unexpected),
    ...overrides,
  } satisfies GraphClient;
}
