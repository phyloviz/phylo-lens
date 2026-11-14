# Researcher walkthrough: aggregate interpretation and navigation

**Status: prepared; participant sessions have not been conducted.** This is a
formative evaluation kit for publication work. Automated regressions and a
facilitator dry run are technical checks, not participant results.

## Questions and scope

Can researchers distinguish automatic groups from manually folded branches,
recover exact available counts without confusing nodes with isolates, and
retain their place while expanding, zooming and arranging a tree?

Run an initial round with a few researchers who already use the tool. Record
their domain experience and prior familiarity; this convenience sample supports
finding and correcting problems, not population-wide usability estimates.
Allow about 20–30 minutes per session. The tasks below are a starting point:
ask which tasks resemble the participant's work before generalizing the findings.

## Repeatable public inputs

Use the repository's [379-node public tree](../../examples/newick/phyloviz-spneumoniae.nwk)
without ancillary data for the core walkthrough. It has one component, 379
canonical nodes and 378 edges. Its SHA-256 is:

```text
0331afdc62de543f63fa6c76f9e7e1b2c75461c53d2cd20a4910ee52f41aed12
```

Use a fresh browser context and default preparation settings, including a
small-component threshold of 64. Keep automatic layout motion off initially.
Record the actual settings; a previously changed threshold can hide the groups
needed for these tasks.

For a separate, optional node-versus-isolate task, use the public synthetic
[typing table](../../examples/typing/missing-loci.tsv) and its
[ancillary table](../../examples/typing/missing-loci-ancillary.tsv), joined by
`ID`. This requires a service configured for typing preparation, including its
Java runtime and conversion dependency. Verify that preparation works before
inviting a participant; mark this task as not run if unavailable. Do not silently
substitute a different service during a session.

## Facilitator preparation

1. Pin the client and service build. Record commits, API/service versions,
   preparation settings, browser/OS, viewport, device pixel ratio and input
   checksum in a copy of the [blank record](researcher-walkthrough-record.md).
   A local trial must also preserve its source diff, new files and checksums;
   a commit hash alone does not identify an uncommitted build.
2. Load the public tree, let the initial framing finish, and verify 379 drawn
   symbols at the finest detail level.
3. In Explore, choose **Collapse all**. Select the violet marker directly in the
   canvas and choose **Expand branch**. At the coarsest level this leaves two
   amber groups and the root. Internal generated IDs may not be searchable.
4. Check that the legend and inspector are readable at the session's viewport.
   Prepare the optional typing dataset separately if it will be used.
5. Open the [facilitator key](researcher-walkthrough-key.md) separately. Do not
   give the key or a tutorial on triangle encoding before the interpretation
   tasks. Participants may discover and read the interface's help naturally.

Obtain agreement before recording the screen, audio or attributed comments.
Use participant codes, collect only needed information, and agree where records
will be kept and when recordings will be deleted. Public fixtures avoid exposing
private research data. Participation and recording are separate choices.

## Neutral task prompts

Read each prompt without supplying the expected answer. Ask participants to
think aloud if comfortable. Record their first interpretation before offering
help. If stuck, use a general prompt first (for example, “What would you try
next?”), then record any specific hint separately.

| Task | Prompt | What to observe |
| --- | --- | --- |
| 1. Interpret | “What do the shapes and sizes in this view tell you? What would you want to check before using it in your analysis?” | First interpretation; discovery of the legend; certainty and misconceptions. |
| 2. Inspect counts | “How many tree nodes does each of these two groups contain? Could their sizes alone tell you their exact numerical ratio?” | Finding exact counts; distinguishing compressed size from proportional area. |
| 3. Read missing data | “What can you tell about the number of isolates represented here? What can you conclude if a value is unavailable?” | Unknown versus zero; nodes versus biological observations. |
| 4. Fold and return | “Expand a group, choose an internal branch to hide, then zoom away and return. Restore that branch. How can you tell what was hidden and what action will restore it?” | Automatic versus manual operations; count scope; lost context, failed actions and recovery. |
| 5. Arrange and share | “Adjust the layout when you want it to move, stop it, then zoom. Export a view you could explain to a colleague.” | Discovery of manual/automatic motion, retained arrangement, unexpected camera changes and exported explanations. |
| Optional: profiles | “In this typing dataset, how many profile nodes and isolates are there? Find a profile that represents more than one isolate. What does folding a branch let you conclude about its isolate total?” | Distinguishing 3 profiles from 4 isolates and root-only metadata from branch totals. |

Afterwards ask: “Which moment was most confusing?”, “What felt unpredictable?”
and “Which of your own analysis tasks would this help or hinder?” Ask for
examples before suggesting design solutions. Do not treat a preference alone as
evidence that a feature improves task performance.

## Recording and decisions

For each task record **unassisted completion**, **completion with assistance**,
**incomplete**, or **not run**. Keep mistakes, backtracking, hints, unexpected
movement and verbatim comments separate from the facilitator's interpretation.
Task times are optional descriptive observations; think-aloud and assistance make
them unsuitable as an uncontrolled speed comparison.

Review findings by consequence: incorrect scientific interpretation or lost work
first, then blocked navigation/recovery, then friction and presentation issues.
For each issue keep the triggering task, evidence, proposed correction and
recheck status. Do not change the build midway through a round; evaluate fixes
in a subsequent round and record their version.

| Possible publication statement | Evidence needed |
| --- | --- |
| Sizes are bounded; automatic LoD does not reposition the camera in tested scenarios | Mapping tests and real renderer/worker regressions, with scenario scope. |
| Exact available node and isolate counts are labeled distinctly | Count/metadata contracts and inspector/hover/export checks. |
| Researchers understood the encoding and recovered their place | Recorded participant task observations; currently pending. |
| The new design is faster or more usable than an alternative | A suitable comparison with a justified sample and controlled tasks; not established by this walkthrough. |

## Rationale and limits

[Munzner's nested model](https://www.cs.ubc.ca/labs/imager/tr/2009/NestedModel/)
separates domain tasks, visual encoding/interaction and algorithm validation.
Accordingly, software regressions and researcher observations answer different
questions here.

[Heer and Bostock (2010)](https://hci.stanford.edu/publications/2010/crowd-perception/heer-chi2010.pdf)
study graphical perception, including area judgments. That motivates checking
interpretation and offering exact counts; it does not validate this tool's
triangle mapping or prescribe its size limits.

[Heer and Robertson (2007)](https://sites.stat.columbia.edu/gelman/communication/HeerRobertson2007.pdf)
discuss orientation and object constancy in transitions between statistical
graphics. Preserving the requested camera during automatic LoD is our application
of that concern, not a universal rule established for tree browsers by their
experiments. The compressed size function and default 6–12 size range remain
engineering choices to review against actual use.
