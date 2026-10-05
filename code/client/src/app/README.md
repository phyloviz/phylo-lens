# Client application code

The application connects the DOM shell, graph services and renderer. It does not
need a UI framework.

## Responsibilities

- `bootstrap.ts` finds and checks DOM elements, then creates the collaborators.
- `uiShell.ts` connects feature controls and reports status.
- `shell/` owns DOM events and feature workflows: search, region selection,
  ancillary fields, category colors and expansion controls.
- `workbench/` owns the loaded graph session and coordinates services and rendering.
- `workbench/viewport/` owns viewport requests, levels of detail and expansion.
- `components/` (outside this folder) renders reusable views from prepared data.
- `ancillary/` (outside this folder) calculates distributions and available fields.

## State and ownership

The workbench lifecycle is `idle`, `preparing`, `loadingViewport`, `ready` or
`failed`. A ready state requires both a session and a graph. Reducers calculate
new state; they do not perform requests, change the DOM or read the clock.

Palette and expansion-control state also have reducers. Request revisions,
timers, event listeners and renderer handles stay in the controller that owns
their lifetime. A response from an earlier request must not change a newer view.

Application models expose readonly properties and collections, including nested
ancillary values, mappings and graph nodes. This is a TypeScript check; it does
not freeze arbitrary JavaScript objects at runtime.

Mappings and filters are copied and frozen when entering stored state. Their
arrays and dictionaries are small and are also frozen. Caller-owned inputs are
left untouched. Load settings and prepare requests are captured before waiting,
so editing an input during a request cannot change that operation.

DTO mappers copy ancillary rows, observations, schemas and warnings into the
application model. Graph calculations reuse unchanged readonly data and replace
only the parts they change. Large graph snapshots are not recursively copied or
frozen on every update. Renderers own their mutable positions and attribute
records; node-click callbacks receive a separate readonly attribute record.

The Sigma adapter copies edge attribute records into Graphology, captures render
and motion options, and owns its highlight sets and motion pins. Position getters
return separate coordinate values. Simulation particles and worker buffers stay
mutable inside the motion component; simulation inputs are readonly.

Pie-program updates share one path for initial rendering and viewport changes.
Event subscriptions are registered and removed together. Node attribute helpers
own glyph styling and triangle rotations; the renderer owns their lifecycle.

Known node attributes expose typed ancillary data. Additional host attributes are
borrowed readonly values; their contents are not recursively copied or frozen.

Local arrays and maps used during calculations may be mutable; they are created
for that calculation and never mutate their inputs. Reducers check every action
variant at compile time. New actions require a corresponding reducer branch.

## Types and input checks

Use explicit application models for operations and results. JSON, JavaScript
exceptions and extensible renderer attributes enter as untrusted values; check
or convert them at that boundary. Stored failures and error callbacks use
`Error`. DOM event names determine their listener types.

## Terminology

Use ancillary data for isolate attributes, field or column for a table column,
and values or categories for its contents. A profile node may represent multiple
isolates. A collapsed subtree is a display group of graph nodes; its node count
must not be described as a count of isolates or profiles without that information.

Existing HTML IDs and backend `metadata_*` fields keep their external spelling.
Those names do not dictate the names used in application models.
