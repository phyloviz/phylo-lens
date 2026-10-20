/** Half-open DFS interval in one immutable prepared forest. */
export type TreeIndex = {
  readonly componentId: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly start: number;
  readonly end: number;
};
