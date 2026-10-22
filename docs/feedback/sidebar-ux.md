# Viewer workspace

The demo groups controls by task: Explore, Appearance, and Data. Data opens before
the first load; successful loading opens Explore. Changing tabs preserves control
values, files, and each task's scroll position. On compact screens, Controls opens
the task drawer; loading closes it so the graph remains available.

Search stays above the graph. A contextual inspector presents Node, Overview, or
Region content. Selection opens Node; completed region queries open Region. Hiding
the inspector gives its width back to the canvas. Export opens a native dialog
with its own progress and completion feedback.

These choices apply discoverability, clear action targets, and feedback from
[Norman](https://jnd.org/books/the-design-of-everyday-things-revised-and-expanded-edition/),
consistency and reduced memory demands from
[Shneiderman](https://www.cs.umd.edu/~ben/goldenrules.html), and
[progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
for preparation settings and secondary explanations. Keyboard navigation follows
the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/); export uses a
native modal dialog with Escape, contained focus, and return to its trigger.

## Component boundaries

- `createPhyloLensView` is the exported, framework-independent graph viewer API.
- `AncillaryWheel` is an internal shared distribution renderer used by overview,
  node, and region views. Node details, search results, and region results have
  separate internal rendering functions.
- Header, task panels, inspector, and export dialog are demo-shell HTML. The
  workspace controller owns navigation and surface state; existing controllers
  own graph operations. These surfaces are not exported UI components.

Functional checks cover navigation and state retention, search-to-branch actions,
both size scales, label bounds, palette lifecycle, PNG download and dialog focus,
canvas resizing, and layouts from 320 to 1440 pixels. They do not establish user
task completion time or discoverability; those need observation of representative
analysis tasks.
