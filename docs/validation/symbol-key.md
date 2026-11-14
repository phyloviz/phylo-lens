# Contextual symbol key

The graph key shows only automatic groups, collapsed branches and additional
connections present in the current loaded view. A plain tree needs no special
symbol key. Short labels stay beside the graph; the size explanation is available
through the keyboard-accessible **About symbols** disclosure. Its open state
survives streamed updates. Exact available counts remain in hover and inspection,
and publication exports retain their interpretation notes.

Changing key content can resize the canvas and cause a viewport refresh.
Connection-query errors therefore remain until another explicit query, removal
or dataset load; a redraw must not replace an actionable error with normal counts.

Nielsen's [usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
motivate recognition, familiar wording and limiting irrelevant information.
[Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
motivates putting the longer explanation behind an explicit control. Applying
those principles to this placement is a design decision, not a result established
by those articles for tree browsers.

The canvas card keeps a stable outer height while its graph uses the remaining
space. Functional checks cover updating symbols, retaining the disclosure state,
responsive fit and exported captions. These checks do not establish researcher
discoverability or task performance; the researcher walkthrough remains pending.
