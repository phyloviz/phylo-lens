/** Full MST spans all levels; standard goeBURST stops at nlv (default 3). */
export type TypingOptions =
  { readonly algorithm: 'goeburstfullmst' } | { readonly algorithm: 'goeburst'; readonly nlv?: number };
