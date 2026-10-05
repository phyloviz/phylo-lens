import type { AncillaryFilterState } from '../../ancillary/ancillaryTypes';
import type { LayoutVersion } from '../../contracts/graph/graphIdentifiers';
import type { PositionedGraph } from '../../contracts/positioned';
import type { GraphDisplayOptions } from '../../render/renderer.types';
import type { VisualMappingOptions } from '../../render/mapping/visualMapping';
import type { GraphSession } from './graphWorkbench.types';

export type GraphWorkbenchAction =
    | { readonly kind: 'loadStarted' }
    | { readonly kind: 'graphPrepared'; readonly session: GraphSession }
    | { readonly kind: 'viewportApplied'; readonly graph: PositionedGraph; readonly layoutVersion?: LayoutVersion }
    | { readonly kind: 'loadFailed'; readonly error: Error }
    | { readonly kind: 'lodRefreshPaused'; readonly paused: boolean }
    | { readonly kind: 'filtersUpdated'; readonly filters: AncillaryFilterState }
    | { readonly kind: 'visualMappingUpdated'; readonly visualMapping: VisualMappingOptions }
    | { readonly kind: 'displayOptionsUpdated'; readonly displayOptions: GraphDisplayOptions };
