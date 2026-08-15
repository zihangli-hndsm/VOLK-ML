# VOLK-ML Exploration UI Redesign Roadmap

## Purpose

This document is the execution reference for redesigning VOLK-ML's learner-facing exploration UI before aggressively expanding Phase 9 into image, sequence, Transformer, retrieval, RAG, and agent Worlds.

The redesign is not a cosmetic refresh. It is an information-architecture and interaction refactor whose purpose is to restore the simplicity of the early MVP while preserving the much richer exploration semantics that now exist underneath.

The north-star experience is:

> A first-time learner opens an experiment, immediately sees a phenomenon, touches or changes the World, observes a meaningful response, preserves the current state, tries a variation, and compares the two without first learning VOLK-ML's internal parameters or engineering abstractions.

The product should become simpler at the surface as its internal capability grows.

The guiding rule is:

> **System complexity should appear when the learner's question becomes more complex, not merely because the product has more features.**

This roadmap is subordinate to the semantic guarantees in `docs/exploration-roadmap.md`. The UI may change substantially; World, Experiment, comparison, evidence, repeat, provenance, and deterministic observation semantics must remain truthful.

---

# Why redesign before Phase 9

Phase 9 asks VOLK-ML to extend the same exploration grammar beyond 2D tabular Worlds into:

- CNN / image Worlds;
- sequence Worlds;
- attention / Transformer Worlds;
- embeddings and vector search;
- RAG;
- agent planning and tool-use.

That work should not begin as a sequence of domain-specific playground UIs layered on top of the current interface. If each new domain invents its own toolbar, parameter panel, evidence layout, and Agent workflow, the product will accumulate incompatible interaction models.

Before Phase 9 implementation, VOLK-ML should establish two reusable UI axes:

```text
Conceptual depth
Phenomenon -> Evidence -> Mechanism -> Representation -> Builder

Responsive density
Compact -> Medium -> Wide
```

Phase 9 may then map each new domain into the same grammar rather than creating another standalone playground.

Phase 9 runtime expansion is therefore deferred during this roadmap except for static mocks or paper prototypes used to pressure-test abstractions.

---

# Product goals

## 1. Restore the MVP feeling

The default Explore surface should feel small, direct, and understandable even though the system underneath is substantially more capable.

A first-time learner should not be confronted by:

- learning rate;
- weight and bias;
- normalization;
- optimizer details;
- trace controls;
- architecture controls;
- planner/script/fidelity internals;
- a permanent Agent console;
- a crowded global toolbar.

Those capabilities remain available, but they should be revealed only when the learner has a reason to care about them.

## 2. Phenomenon first

The first screen should emphasize:

- the World;
- visible model behavior;
- direct manipulation;
- the current experimental identity;
- a small question or prompt when appropriate.

The default learner loop is:

```text
See
 -> Touch / change
 -> Observe
 -> Preserve
 -> Change again
 -> Compare
```

## 3. Make touch a first-class interaction

Explore mode must work well on a phone because many learners will arrive directly from a video link on a mobile device.

A user should not need to remember VOLK-ML and later reopen it on a laptop in order to perform the first meaningful experiment.

The growth-critical transition is:

```text
Video
 -> click experiment link
 -> meaningful manipulation
```

The target is to make that transition possible in seconds.

## 4. Preserve expert depth without exposing it by default

The redesign must not remove VOLK-ML's builder/runtime identity. Instead, it separates exploration depth from construction depth.

Top-level mental model:

```text
Explore
  learner-facing experimentation

Build
  architecture, components, detailed parameters, execution, export
```

Explore is the default. Build remains available when the user's goal changes from understanding a phenomenon to constructing a system.

## 5. Create a reusable cross-domain shell

A future Image World and a 2D Regression World should reuse the same concepts for:

- experimental identity;
- Duplicate;
- Compare;
- Repeat;
- Changed / Held constant;
- evidence disclosure;
- deeper inspection;
- Agent-assisted navigation;
- responsive presentation.

The World visualization itself changes by domain. The experiment grammar should not.

---

# Core UI model

## Explore and Build

VOLK-ML should distinguish two top-level workspaces without duplicating semantic state.

### Explore

Primary purpose:

> Manipulate a World and understand model behavior.

Primary surfaces:

- World canvas;
- direct manipulation;
- Experiment Bar;
- contextual evidence;
- progressive conceptual depth;
- Guided Explore;
- optional Agent assistance.

### Build

Primary purpose:

> Construct or inspect the implementation of a model or pipeline.

Primary surfaces may include:

- component graph;
- architecture controls;
- detailed parameters;
- custom loss / execution settings;
- export and engineering-oriented views.

Explore and Build should share underlying project/runtime state. Switching workspace must not silently fork experiment semantics.

---

# Conceptual depth axis

The following levels are an internal design model. Do **not** expose `L0`, `L1`, etc. as learner-facing terminology.

## L0 — Phenomenon

Question:

> What is happening?

Default visible information:

- World;
- data / input objects;
- model behavior;
- direct manipulation tools;
- minimal experiment identity.

Example for linear regression:

- points;
- fitted line;
- Draw / Move / Erase;
- `A: My experiment`.

Do not expose detailed parameters merely because they exist.

## L1 — Evidence

Question:

> What changed, and where is the evidence?

Possible surfaces:

- residuals;
- train/test distinction;
- metrics;
- coverage;
- deterministic observations;
- repeated evidence;
- comparison differences.

Learner-facing entrances should use questions or actions such as:

- `Show errors`;
- `Compare results`;
- `Where did it change?`.

## L2 — Mechanism

Question:

> Why does the system change this way?

Possible surfaces:

- loss;
- gradient;
- learning rate;
- training steps;
- normalization;
- update dynamics.

The learner should encounter semantic controls before exact numeric controls where practical.

Example:

```text
Training speed
<----o---->

More details
Learning rate: 0.01
```

## L3 — Representation

Question:

> What internal representation makes this behavior possible?

Future surfaces include:

- hidden activations;
- learned representations;
- decision boundaries;
- embeddings;
- feature maps;
- attention.

The first redesign does not need to implement all of these. It must leave a coherent place for them.

## L4 — Builder

Question:

> How is this system constructed, and how can I build or modify it precisely?

This is where engineering detail belongs:

- graph;
- components;
- architecture;
- precise parameters;
- execution configuration;
- export.

A learner may enter Build directly. Depth belongs to the current question, not to a permanent `beginner` or `expert` identity.

---

# Progressive disclosure rules

## Never expose a parameter before there is a reason to care about it

Detailed controls should appear because the learner has entered a question that makes them meaningful.

Examples:

- learning rate appears when exploring update size;
- residuals appear when asking what counts as error;
- normalization appears when inspecting transformations or surprising scaling behavior;
- architecture appears when asking what patterns the model can represent.

## Organize by conceptual question, not `Advanced settings`

Avoid treating all complexity as one anonymous advanced panel.

Prefer entrances such as:

```text
Explore deeper

Why did the result change?
How does the model learn?
How well does it generalize?
How is the model built?
```

## Semantic controls before numeric controls

Prefer direct or conceptual manipulation first.

Examples:

- drag a data point instead of editing x/y fields;
- move a test cloud instead of first editing a distribution mean;
- `clean <-> noisy` before exposing exact standard deviation;
- one-step training before requiring a numeric step count.

Exact values remain inspectable when precision becomes useful.

---

# Base Explore shell

The default Explore workspace should converge toward three stable visual regions:

```text
+----------------------------------+
| Context Bar                      |
+----------------------------------+
|                                  |
|              WORLD               |
|                                  |
+----------------------------------+
| Experiment Bar                   |
+----------------------------------+
```

## Context Bar

Keep global chrome extremely small.

Default responsibilities:

- back / navigation;
- current World or exploration title;
- overflow menu.

Do not use the top bar as a dumping ground for playground-specific actions.

### Move away from the top bar

Object/world actions:

- Draw;
- Move;
- Erase;
- Brush / Spray.

These belong close to the World.

Experiment actions:

- Duplicate;
- Compare;
- Repeat;
- restore.

These belong in the Experiment Bar.

Concept/mechanism actions:

- residuals;
- formula;
- loss;
- learning rate;
- normalization;
- training details.

These belong behind depth/contextual disclosure.

Low-frequency global actions:

- reset;
- import/export;
- project settings.

These may live in overflow or the Build workspace.

---

# Responsive presentation model

Do not build separate phone, tablet, and desktop products. Share semantic state and reusable components, but adapt their presentation to available space and input capability.

Primary signals should be:

- container / viewport size;
- coarse vs precise pointer;
- hover availability;
- orientation.

Do not make user-agent detection the architecture foundation.

Conceptual layout modes:

```text
Compact   phone / narrow window
Medium    tablet / medium window
Wide      desktop / wide window
```

Exact breakpoints should be validated against the existing application rather than treated as product semantics.

## Compact

Target experience:

> One phenomenon and one primary action at a time.

Structure:

```text
Context
World
Touch toolbar
Experiment Bar
Bottom sheets for depth/evidence/Agent
```

Rules:

- no permanent right sidebar;
- no reliance on hover;
- large touch targets;
- no horizontal overflow;
- Compare must work without requiring two tiny side-by-side canvases.

## Medium

Typical tablet presentation:

```text
World
Experiment Bar
optional inspector / drawer
```

When present, the inspector should target approximately **300 px** on suitable medium/large layouts.

The inspector is closed by default in the learner-facing Explore entry.

On constrained tablet layouts it may overlay rather than permanently shrink the World.

## Wide

Desktop may display more information simultaneously:

```text
World | optional ~300 px inspector
Experiment Bar
```

Wide layouts may use side-by-side comparison where that improves understanding.

---

# Touch interaction principles

Touch is not desktop-without-hover.

## Direct manipulation

Prefer:

- tap to select/add where unambiguous;
- drag to move;
- explicit Draw / Move / Erase modes initially;
- two-finger pan/zoom where needed.

Avoid overloaded gestures whose meaning changes unpredictably.

## Hit targets

Small visual data points may keep a compact visual radius while using a substantially larger invisible interaction target.

Aim for touch targets around familiar mobile accessibility norms rather than forcing the finger to hit a 6–8 px mark precisely.

When finger occlusion makes precision difficult, use one or more of:

- drag offset;
- magnified preview;
- enlarged selected target;
- snapping when semantically safe.

## Canvas and page scrolling

The World must have a predictable gesture contract so point movement, drawing, canvas pan/zoom, and page scrolling do not fight each other.

---

# Experiment Bar 2.0

The Experiment Bar remains a P0 product primitive.

It should reveal complexity progressively.

## Initial state

```text
A  My experiment          + Try another
```

Do not show comparison metadata before a comparison exists.

## After Duplicate

```text
A  Original       B  New experiment
```

The UI should communicate that B began from A without requiring snapshot/version-control language.

## During Compare

Reveal relevant structure:

```text
Changed
- Test distribution

Held constant
- Model
- Noise
- Sample size
```

If multiple factors changed, show Comparison Clarity conservatively rather than declaring an experiment invalid.

## Responsive Compare

### Wide

Side-by-side A/B may be primary when readable.

### Compact

Prefer one or more of:

- swipe between A and B while preserving viewport;
- overlay / ghost baseline;
- hold-to-compare baseline/current;
- compact experiment carousel.

Do not force two unreadably small canvases into portrait mode merely to preserve desktop parity.

---

# Agent presentation

The Agent should not require a permanent chat panel in Explore mode.

At L0, a lightweight entry such as:

```text
Ask about this
```

is sufficient.

When the learner asks a question, the Agent should increasingly act as a navigator through conceptual depth:

```text
question
 -> identify relevant evidence / depth
 -> offer a concrete UI transition
 -> learner observes the result
 -> explain further when useful
```

Example:

> Learner: Why did that point move the line so much?

Agent response may first offer:

> Let's look at the error that point creates.
>
> `[Show residuals]`

instead of immediately producing a long mathematical explanation.

The Agent must not silently classify the learner as `beginner` or `expert` and mutate UI complexity without explanation. Adapt to the current question and explicit learner actions.

---

# Motion and animation principles

Animation belongs late in the roadmap, after information architecture and responsive behavior are correct.

Motion should communicate semantic change.

Good candidates:

- a duplicated experiment visibly becoming B;
- Compare transitioning into split/overlay mode;
- the fitted model responding smoothly to a moved point;
- evidence entering when a depth layer is opened;
- responsive migration from right drawer to bottom sheet;
- Changed / Held constant information appearing after a valid comparison exists.

Avoid decorative animation that competes with evidence or delays manipulation.

Desired character:

> calm, tactile, scientific, playful.

---

# Behavior telemetry and retention learning

The redesign should make it possible to evaluate whether guided exploration creates the intended learner behavior.

Telemetry is a **product-learning layer**, not a replacement for educational evaluation and not a reason to collect unnecessary personal data.

## Product questions to answer

At minimum, the system should eventually be able to answer:

1. Do people arriving from a video actually start an experiment?
2. How long does it take to reach the first meaningful manipulation?
3. After the first observed result, do learners create a second experiment?
4. Do learners discover Duplicate / Compare naturally?
5. Do learners change one factor or many factors at once?
6. Do they enter Evidence / Mechanism views after encountering a phenomenon?
7. Does Guided Explore lead to continued independent manipulation?
8. Do users return later and continue exploring?
9. Which exploration entry points produce the strongest second-experiment and return behavior?
10. Where do mobile users abandon the flow?

## North-star funnel

A useful initial funnel is:

```text
Video / shared exploration link
 -> exploration_opened
 -> first_meaningful_manipulation
 -> first_result_observed
 -> second_experiment_created
 -> comparison_viewed
 -> deeper_layer_opened (optional)
 -> session_continued / return_visit
```

The most important early metric is not raw registration count. It is evidence that users begin behaving like experimenters.

## Suggested early metrics

### Activation

- `time_to_first_meaningful_manipulation`;
- percentage of opened exploration links that reach a meaningful manipulation;
- percentage reaching a second manipulation after seeing a result.

### Experimental behavior

- `second_experiment_rate`;
- Duplicate usage rate;
- Compare usage rate;
- Repeat usage rate;
- average number of experiments per active session;
- percentage of comparisons with one changed semantic factor vs multiple factors.

### Depth discovery

- percentage entering Evidence;
- percentage entering Mechanism;
- sequence of depth transitions;
- whether the transition followed a relevant phenomenon / observation.

### Guidance

- guided prompt shown;
- prompt accepted / ignored;
- whether the learner continues manipulating after the prompt;
- whether the learner diverges productively from the suggested recipe.

### Retention

- return after 1 day / 7 days / 30 days when sufficient sample size exists;
- return to the same exploration vs a new exploration;
- whether returning users reach meaningful manipulation faster.

Do not over-optimize early around generic `time on site`; a long session can represent confusion as easily as engagement.

## Event semantics

Instrumentation should be based on semantic learner actions, not raw DOM events.

Prefer:

```text
world_point_moved
experiment_duplicated
experiment_compared
depth_evidence_opened
repeat_requested
guided_prompt_accepted
```

rather than:

```text
button_17_clicked
panel_3_opened
mousemove_count
```

This keeps analytics stable through UI redesigns and aligns it with the exploration runtime.

## Action boundaries

One meaningful human action should normally emit one semantic action event even if the UI produces many low-level updates.

Examples:

- one brush stroke creating 80 points is one learner manipulation boundary;
- dragging a point emits a committed semantic event at the end rather than analytics on every frame;
- an accepted Agent proposal that performs several mutations should retain one understandable high-level action plus inspectable mutation metadata where needed.

## Privacy and minimization

Initial telemetry should follow data minimization.

By default, do not collect:

- raw Agent conversations solely for product analytics;
- arbitrary user-entered text;
- imported dataset contents;
- image contents;
- exact point coordinates unless a specific research question genuinely requires them;
- sensitive device fingerprints.

Prefer semantic metadata such as:

```text
actor: human | guided | agent
action: experiment_duplicated
world_kind: sample_2d_regression
layout_mode: compact | medium | wide
input_mode: coarse | precise
changed_semantic_domains: [world]
comparison_clarity: high | mixed
```

If detailed research logging is introduced later, it should have a separate explicit policy/consent boundary rather than silently expanding ordinary product analytics.

## Analytics architecture

Do not couple core components directly to a specific analytics vendor.

Introduce a small semantic telemetry boundary, conceptually:

```text
Exploration UI / domain actions
        |
        v
Telemetry contract
        |
        +-> no-op adapter
        +-> local/dev logger
        +-> future analytics provider
```

The first UI phase should define this contract and may use a no-op implementation. Production collection, backend storage, dashboards, and third-party vendor integration are not required for UI-0.

---

# Responsive acceptance matrix

Every relevant phase should be checked against at least representative sizes such as:

```text
390 x 844    phone portrait
844 x 390    phone landscape
768 x 1024   tablet portrait
1024 x 768   tablet landscape
1440 x 900   desktop
```

These are test viewports, not device detection rules.

Common acceptance requirements:

- no unintended horizontal overflow;
- Canvas remains meaningfully usable;
- no control collisions;
- touch targets are usable;
- Experiment Bar remains reachable and understandable;
- drawer/sheet does not make the World impossible to inspect;
- orientation/layout changes do not lose experiment state;
- no semantic behavior differs merely because presentation changed.

---

# Learner experience acceptance scenarios

## Scenario A — first mobile visit

A learner arrives from a video link on a phone.

Without reading documentation, they can:

1. identify the phenomenon;
2. manipulate a data point or World object;
3. see model behavior change;
4. do so without opening a parameter inspector.

Target product question:

> Can a first-time learner perform a meaningful manipulation within roughly ten seconds after the exploration is ready?

This is a directional UX target, not a unit-test timing guarantee.

## Scenario B — second experiment

After seeing the first result, the learner can preserve it and create a variation without knowing snapshot terminology.

Target product question:

> Can the learner reach a second experiment within roughly thirty seconds in a prepared exploration?

## Scenario C — controlled comparison

The learner compares A and B and can identify what changed and what remained fixed.

Target product question:

> Can the learner understand the semantic difference between the experiments within roughly one minute of entering a prepared flow?

## Scenario D — deeper question

The learner asks or chooses to inspect why a phenomenon occurred.

The UI reveals Evidence or Mechanism without dumping the entire settings surface.

## Scenario E — no Agent

All core actions in Scenarios A–D remain possible with Agent disabled.

---

# Implementation phases

## UI-0 — Architecture and information hierarchy

Goal:

> Establish reusable UI contracts and migration boundaries before visible redesign work.

Deliverables:

- document/map the current learner-facing Explore surfaces and classify controls by responsibility;
- define Explore vs Build workspace boundaries without duplicating semantic state;
- define the internal conceptual depth model and learner-facing entrances;
- define presentation/layout capability boundaries for Compact / Medium / Wide;
- identify which current components are semantic/domain components and which are presentation-specific;
- establish a small semantic telemetry contract with a no-op/dev adapter boundary;
- define migration seams for Context Bar, World surface, Experiment Bar, depth inspector, Agent entry, and Build entry;
- add targeted tests for any new pure contracts/helpers;
- preserve current visible behavior unless a tiny structural change is necessary to create the seam.

UI-0 should **not**:

- perform the visual redesign;
- remove existing controls;
- change exploration runtime semantics;
- rewrite World / Experiment / evidence logic;
- implement a new analytics backend;
- add Phase 9 models;
- introduce complex animation;
- create separate mobile and desktop state trees.

Acceptance:

- future UI phases can consume one shared semantic state;
- responsive presentation can vary without changing experiment meaning;
- telemetry can observe semantic actions without components importing a vendor SDK directly;
- the codebase has clear seams for later shell replacement;
- existing tests remain green.

## UI-1 — Minimal Explore shell

Goal:

> Replace crowded permanent chrome with a stable Context / World / Experiment structure.

Work:

- reduce top-bar responsibility;
- establish Context Bar;
- establish default World-first spatial hierarchy;
- make detailed inspector closed by default in learner Explore entry;
- retain old functionality behind temporary compatible surfaces where needed.

Acceptance:

- first view is visibly calmer;
- no core feature is deleted;
- top bar no longer grows with playground-specific controls.

## UI-2 — Responsive and touch foundation

Goal:

> Make the core exploration loop usable in Compact, Medium, and Wide layouts.

Work:

- capability-based layout selection;
- bottom-sheet pattern for Compact;
- approximately 300 px inspector/drawer target where appropriate on Medium/Wide;
- touch-safe targets and direct manipulation;
- orientation handling;
- responsive smoke/interaction tests.

Acceptance:

- open -> manipulate -> duplicate -> compare -> undo works on representative phone and desktop layouts.

## UI-2.5 — Top-level Explore / Build surface split

Correction before UI-3:

- UI-0 through UI-2 established internal Explore seams and responsive
  Playground presentation, but the actual application entry still rendered
  the builder first.
- The top-level application now has two presentation-only surfaces: Explore
  (the default for a new session) and Build (the existing ReactFlow builder).
- Both surfaces consume the same Workspace/runtime state. Switching surfaces
  does not serialize, clone, reset, or otherwise change nodes, edges, data,
  model state, selection, project name, or Playground/Experiment state.
- Explore is question-first and uses the registered Big Idea entrances plus a
  compact direct-playground fallback. Build retains the full builder toolbar,
  component library, graph, parameters, runner, import/export, examples, and
  architecture controls behind an explicit Build entry.
- Global actions remain small presentation controls. Build-specific actions
  are local to the Build toolbar and use ordinary disclosure semantics.

This correction is intentionally limited to the actual app entry. It does not
begin UI-3 and does not create a second semantic state tree.

## UI-3 — Phenomenon-first L0

Goal:

> Make the default linear-regression exploration feel like a small experiment rather than a configuration tool.

Default visible elements should be limited to the phenomenon, direct manipulation, minimal context, and experiment identity.

Detailed training/model parameters move behind later disclosure.

Acceptance:

- a new learner can manipulate the World without understanding weight, bias, learning rate, or normalization;
- existing detailed controls remain reachable.

## UI-4 — Experiment Bar 2.0

Goal:

> Make preserve -> vary -> compare the primary human experiment grammar.

Work:

- progressive Experiment Bar;
- Duplicate;
- A/B navigation;
- responsive Compare;
- Changed / Held constant;
- Comparison Clarity;
- restore/undo relationships;
- Repeat placement where semantically appropriate.

Acceptance:

- compact layouts do not rely on unreadable side-by-side canvases;
- semantic comparison remains truthful;
- manual parity with Agent-generated core experiments is preserved.

## UI-5 — Progressive depth navigation

Goal:

> Reintroduce complexity through meaningful conceptual entrances.

Work:

- Evidence disclosure;
- Mechanism disclosure;
- future Representation slot;
- semantic controls before exact numeric controls where practical;
- contextual inspector/drawer/sheet.

Acceptance:

- parameters no longer dominate the initial screen;
- deeper information is discoverable rather than hidden arbitrarily.

## UI-6 — Agent as exploration layer

Goal:

> Make the Agent help navigate evidence and experiments rather than permanently occupy the interface.

Work:

- lightweight Agent entry;
- UI actions offered from Agent guidance;
- depth transitions driven by explicit learner acceptance;
- preserve Agent evidence/provenance guarantees.

Acceptance:

- Agent disabled mode remains complete;
- Agent does not need DOM imitation for semantic operations;
- questions can lead into evidence/mechanism views without long chat-first detours.

## UI-7 — Motion and polish

Goal:

> Add motion that teaches state change and make the interaction feel tactile and coherent.

Work only after prior phases are stable.

Acceptance:

- motion clarifies rather than delays;
- reduced-motion accessibility is respected;
- no evidence semantics depend on animation.

---

# Relationship to Phase 9

After UI-0 through the core learner-facing redesign are stable enough, Phase 9 should resume in two steps.

## Phase 9A — Cross-domain exploration contract

Before implementing heavy models, use static/mock vertical probes for at least:

- 2D regression;
- image classification;
- sequence or Transformer behavior.

For each domain answer:

```text
What is the manipulable World?
What is the Model's inductive bias?
What can the learner change manually?
What evidence becomes visible?
What controlled comparisons become possible?
What can Guided Explore scaffold without AI?
What can the Agent safely accelerate?
How does Phenomenon / Evidence / Mechanism / Representation map here?
How does Compact presentation remain meaningful?
```

## Phase 9B — Domain implementations

Only then expand runtime capability incrementally.

Suggested complexity order:

```text
2D tabular
 -> Image
 -> Sequence
 -> Transformer / attention
 -> Embeddings / retrieval
 -> RAG
 -> Agent planning / tool-use
```

Early Phase 9 should remain frontend-first where possible. Heavy local/cloud execution should be introduced only when learner demand justifies it.

---

# Non-goals during the redesign

Do not use this roadmap to justify:

- rewriting the ML runtime;
- replacing deterministic evidence with LLM inference;
- building a universal design system from scratch;
- building a universal Scenario Engine before needed;
- completing Phase 9 models;
- requiring authentication before first exploration;
- collecting high-granularity personal behavior data by default;
- forcing all Build functionality to be equally comfortable on phone;
- creating a separate `beginner mode` and `expert mode` state model.

Explore should be excellent on mobile. Build may remain desktop-preferred for complex architecture work.

---

# Engineering constraints

- Preserve semantic truth and deterministic evidence guarantees from `docs/exploration-roadmap.md`.
- Prefer composition and adapters over domain-specific UI forks.
- Keep domain/experiment state independent of presentation mode.
- Responsive changes must not recreate or reset experiments.
- Do not mutate World coordinates merely because viewport dimensions change.
- Keep data/world coordinates separate from display coordinates.
- One human gesture should map to an understandable semantic action boundary where practical.
- Agent and human paths should share domain operations rather than DOM automation.
- Telemetry must observe semantic actions through a boundary, not become business logic.
- Respect localization, accessibility, deterministic testing, project persistence, and existing browser/runtime constraints.

---

# Definition of redesign success

The redesign is successful when VOLK-ML can become substantially more capable without making the first learner-facing screen substantially more complicated.

For the canonical 2D exploration, a first-time phone user should be able to encounter:

```text
one question
one World
objects they can touch
visible model behavior
a lightweight Experiment Bar
```

and only later reveal:

```text
evidence
mechanism
representation
precise parameters
builder internals
```

At the same time, the product should begin generating privacy-conscious evidence about whether learners actually follow the intended loop:

```text
see
 -> manipulate
 -> observe
 -> create another experiment
 -> compare
 -> ask a deeper question
 -> return and explore again
```

That learner behavior, rather than the number of controls implemented, is the primary product outcome this redesign is meant to enable and measure.
