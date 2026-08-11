# VOLK-ML Exploration Roadmap

## Purpose

This document is the long-term product and implementation reference for turning VOLK-ML from a visual ML builder with teaching features into an **exploration-first machine-learning environment**.

The target experience is not a conventional linear course and not a no-code AutoML tool. VOLK-ML should help a learner move from a vague intuition or question to a concrete experiment, observe what changes, form a better mental model, and continue exploring.

The core loop is:

```text
Curiosity
  -> experimental question
  -> manipulate a world
  -> make a prediction
  -> run or compare experiments
  -> observe evidence
  -> form a new question
  -> continue exploring
```

A canonical north-star request is:

> "I want to see how linear regression behaves under different data distributions."

A learner who has never read the internal documentation should be able to express that curiosity, create or modify data visually, compare controlled experiments, inspect what changed, and continue from the result without learning VOLK-ML's internal script/planner abstractions first.

This roadmap should guide future Codex work whenever a task touches interactive data worlds, playground exploration, experiment comparison, agent-guided exploration, or learning journeys.

---

## Product thesis

VOLK-ML should combine three complementary surfaces.

### 1. Video: ways of seeing

Videos provide compact intuitions and broad mental models rather than complete syllabus coverage.

Examples:

- A model is a constrained way of searching for patterns.
- A loss function defines what counts as a bad answer.
- Representation can make a hard pattern easier to express.
- Generalization asks whether the pattern survives beyond observed examples.
- Every model contains inductive biases about what kinds of patterns are worth searching for.

A video should often end with an unresolved or partially resolved question that can be explored in VOLK-ML.

### 2. VOLK-ML: worlds to explore

The platform provides manipulable environments where learners can change data, models, learning rules, and evaluation conditions and directly observe the consequences.

The learner should not need to start from an algorithm name. A valid entry point is simply to draw data and ask:

> "What pattern would a linear model see here?"

### 3. Agent: an exploration companion

The Agent should primarily help transform curiosity into experiments. Its default behavior should be closer to a Socratic lab partner than an encyclopedia.

Preferred interaction order:

```text
Observe
  -> ask or clarify
  -> propose an experiment
  -> ask for a prediction
  -> run or modify the world
  -> point to evidence
  -> explain only as needed
  -> suggest a next test
```

The Agent may still explain concepts directly when requested, but explanation should not replace experimentation when the user's question is experimentally testable.

---

## Product principles

### Exploration before instruction

Do not require a learner to complete a lesson before using the system. Concepts may be discovered through free exploration and revisited from multiple directions.

### Questions before terminology

Whenever practical, let the learner encounter a phenomenon before naming it.

For example:

- Let the learner move the test distribution before introducing "distribution shift".
- Let one outlier pull a fitted line before introducing robustness.
- Let a model fit training points and fail elsewhere before introducing overfitting or extrapolation.

### Worlds and models are equally important

Current ML tools often make the model the first-class object. Exploration requires the data-generating world to be equally manipulable.

VOLK-ML should eventually expose four conceptual layers:

```text
WORLD
What observations are possible and how are they generated?

MODEL
What kinds of patterns can be represented?

LEARNING
How are model parameters changed from evidence?

EVALUATION
Where and how is the learned rule tested?
```

### Controlled comparison is a core learning primitive

A learner should be able to duplicate an experiment, change one factor, and see exactly what was held constant.

### Important hidden mechanisms should become inspectable

Normalization, splitting, shuffling, initialization, augmentation, regularization, class weighting, and similar mechanisms should not silently invalidate a learner's interpretation of an experiment.

They do not all need to be exposed as default controls, but important transformations should be inspectable and, when pedagogically safe, toggleable.

### The same world should serve humans, videos, and agents

Do not create separate fake teaching logic for screenshots or the Agent. Reuse the existing unified playground/runtime direction: the human UI, presentation/video scripts, and Canvas Agent should operate on the same semantic state and actions wherever possible.

### Determinism matters

Exploration should support reproducible comparisons. Generated samples, Agent-created worlds, duplicate experiments, and teaching presets must use explicit seeds where randomness is involved.

### Honest semantics over impressive visuals

Never imply that a hand-drawn finite sample is a probability distribution unless a separate generator has actually been defined or inferred. Never label an architecture sketch as a trained result. Never hide a meaningful approximation.

---

# Core product model

## World

A `World` describes the environment that produces or contains observations used by an experiment.

The first implementation should focus on small two-dimensional supervised-learning worlds because they are highly visual, cheap to run, and useful across regression, KNN, MLPs, classification, clustering, generalization, and distribution-shift examples.

A World may initially be one of two semantic modes.

### Sample World

The learner directly creates a finite set of observations.

```text
Learner actions
  -> explicit points
  -> dataset used by the model
```

This is the default meaning of drawing points on the canvas.

### Generative / Pattern World

The learner defines an underlying pattern or generator and VOLK-ML samples observations from it.

```text
underlying pattern
  + input sampling rule
  + noise
  + seed
  -> observed samples
```

This mode must remain semantically distinct from Sample World. A drawn line or curve in Pattern mode may represent a latent relation; a brush stroke in Sample mode represents actual observations.

The first releases do not need a universal probability-distribution DSL.

---

## Dataset

A Dataset is the finite set of observations currently produced by or stored in a World.

For two-dimensional work it should carry, as applicable:

- stable point IDs;
- x/y values;
- train/test membership;
- class label or regression target semantics;
- provenance such as manual drawing, generated pattern, imported workspace data, or Agent mutation;
- seed and generator metadata when generated;
- no claim of an underlying distribution when none exists.

---

## Experiment

An `Experiment` is a reproducible bundle of conditions and evidence.

At minimum it should conceptually include:

```text
World / Dataset
Model
Learning settings
Evaluation settings
Seed(s)
Result / metrics
Relevant traces
```

An experiment is not merely the current mutable project state. It should be possible to capture, duplicate, compare, and restore experimental states without manually reconstructing them.

---

## Exploration Thread

An `Exploration Thread` records the learner's evolving reasoning rather than a lesson-completion score.

A minimal thread can contain:

```text
Question
Hypothesis or prediction
Experiment(s)
Observation
New question
```

This should be lightweight and optional. It is intended to preserve reasoning, not turn the app into a notebook product.

---

# 2D Data Workspace

The 2D Data Workspace is the highest-priority new exploration surface.

Its purpose is to make distributions, clusters, trends, noise, gaps, and outliers **physically manipulable** before the learner needs formal vocabulary.

## First interaction

A new learner should be able to enter an empty or lightly seeded 2D space and create data immediately.

A strong opening experience is:

```text
Draw some data.
Then ask a model what pattern it sees.
```

Do not require the learner to begin by importing CSV, selecting a formal distribution, or assembling a full graph.

## Initial tool set

Keep the first release intentionally small.

### Point

Tap/click to add one observation.

Best for:

- individual examples;
- outliers;
- precise edits.

### Brush

Drag to create observations along a path with bounded stochastic spread.

Best for:

- linear trends;
- curves;
- bands;
- quickly sketching a relation.

### Spray

Press/drag over a region to create a local cloud of points. Density increases with interaction time or distance while respecting a hard generation cap.

Best for:

- clusters;
- multi-modal shapes;
- local density differences.

### Select

Select one point or a lasso/group of points for manipulation.

Useful group actions may later include:

- move;
- stretch;
- rotate;
- duplicate;
- scatter/jitter;
- relabel.

Do not ship all group transforms in the first slice if they make the interaction model confusing.

### Erase

Remove individual points or points within a bounded brush region.

## Essential controls

Prefer a few semantic controls over a professional drawing toolbar.

Initial candidates:

- spread / jitter;
- generation density;
- active class for classification worlds;
- active layer: train, test, or view both;
- clear/reset;
- deterministic seed / regenerate where generation is stochastic.

## Train and test layers

Train/test should become visible spatial concepts, not only split percentages.

The Workspace should eventually support:

```text
[Train] [Test] [Both]
```

A learner may draw or manipulate the train and test worlds separately.

This allows direct experiments such as:

- train on `x in [-1, 1]`, test on `x in [2, 4]`;
- keep the underlying relation the same but move input support;
- preserve training data while adding test noise;
- create class imbalance only in test;
- create regions with little or no training coverage.

The visual encoding must make layer membership clear without depending only on color.

## Classification support

The same 2D workspace should support labeled points for KNN and small MLP experiments.

Examples:

- draw two well-separated classes;
- create an XOR layout;
- introduce mislabeled points;
- move a class cluster;
- change overlap;
- compare KNN and MLP decision boundaries on the same world.

## Regression support

Regression mode should allow direct visual fitting with Linear Regression first.

The fitted line and relevant metrics should update either live or through a clearly controlled fit action, depending on performance and pedagogical intent.

A powerful basic interaction is:

1. draw an obvious trend;
2. fit a line;
3. add one far outlier;
4. watch the fit change;
5. ask why.

## Pattern mode

Pattern mode is a later extension of the same workspace, not a replacement for direct drawing.

A learner might draw or configure an underlying relation and then sample from it with controls such as:

- sample count;
- noise amount;
- noise family when supported;
- x sampling range or simple x sampling pattern;
- outlier rate;
- seed.

The UI must always state whether the learner is editing explicit samples or a generator.

## Accessibility

Dragging cannot be the only way to perform a primary operation.

Provide practical alternatives such as:

- add point by numeric x/y fields;
- move selected point with numeric controls or keyboard-friendly step buttons;
- select class/layer with native controls;
- clear descriptions of the current dataset and selected point(s).

Touch interaction must remain usable on mobile/tablet, consistent with VOLK-ML's existing mobile goals.

## Performance bounds

The browser workspace is pedagogical, not a large-data plotting engine.

Define explicit limits for:

- total points;
- points generated by one gesture;
- redraw frequency;
- decision-grid resolution;
- Agent-generated mutations.

Do not allow an Agent or brush gesture to generate unbounded work.

---

# World Builder

The 2D workspace is the most direct World Builder. Parameterized generators are a complementary layer, especially useful for reproducible Agent-created experiments.

## First generator vocabulary

Start with a small semantically clear set.

For input locations:

- uniform;
- Gaussian-like cloud;
- two clusters / mixture;
- manually drawn samples.

For regression relation:

- linear slope and bias;
- later: simple nonlinear curves if needed for model-capacity exploration.

For noise:

- amount / spread;
- later: a small set of families only when their distinction is actually teachable.

For anomalies:

- outlier count or rate;
- direct manual placement should remain available.

## Agent and World Builder

The Agent should be able to create or modify the same semantic World that the learner can inspect and edit.

Examples:

> "Add a few outliers."

> "Make the test data appear farther to the right."

> "Create two clusters but keep the same linear model."

> "Make this problem harder without changing the model."

Every Agent mutation must be inspectable. The UI should be able to state what changed.

---

# Experiment snapshots and controlled comparison

## Duplicate Experiment

A first-class action should duplicate the current experiment while keeping everything identical by default.

```text
Experiment A
  -> Duplicate
Experiment B
```

The learner can then modify exactly one factor.

## Compare View

A/B comparison is a P0 exploration capability.

The comparison should show:

- the two worlds or relevant visual states;
- metrics appropriate to the model;
- the factor(s) changed;
- the conditions held constant;
- seed relationship;
- the most meaningful result differences without prematurely explaining causality.

Example:

```text
A: Uniform x                   B: Two-cluster x

Train MSE: 1.1                Train MSE: 1.2
Test MSE:  1.3                Test MSE:  4.7
Slope:     1.96               Slope:     2.13

Changed:
- input distribution

Held constant:
- model
- underlying relation
- noise level
- sample count
- optimizer settings
- seed policy
```

## Comparison semantics

The system must distinguish:

- changing one control in the same world;
- changing the dataset/world;
- changing the train/test relationship;
- changing the model;
- changing learning configuration.

Do not reduce every comparison to a generic control-value pair if that loses important meaning.

Reuse existing capture/restore semantics and TeachingPlan comparison infrastructure where appropriate, but extend the semantic model rather than forcing World changes into unrelated model controls.

---

# Exploration Agent

## Learner-facing surface

The default learner surface should begin with a single simple prompt such as:

> **What are you curious about?**

Do not require the learner to understand:

- TeachingPlan;
- Visualization Script;
- fidelity checks;
- primitive types;
- provenance details;
- planner/composer implementation.

Those are valuable developer/advanced inspection surfaces and may remain available behind an advanced mode.

## Agent responsibilities

For experimentally testable questions, the Agent should attempt to:

1. identify the ambiguity that materially changes the experiment;
2. choose or offer a small number of meaningful interpretations;
3. propose a controlled experiment;
4. show exactly what it will change;
5. optionally ask the learner to predict the result;
6. run only after the user-facing action is explicit;
7. highlight evidence rather than immediately narrating a complete answer;
8. suggest a next experiment grounded in what just happened.

## Example: vague distribution question

User:

> "How does linear regression behave under different distributions?"

Good Agent behavior:

> "Distribution can change in several ways. Let's start by keeping the underlying linear relation and noise fixed, and only changing where x-values appear. We can compare a broad uniform sample with two separated clusters."

Then offer concrete actions such as:

- compare input locations;
- change noise instead;
- make train and test distributions different.

The Agent should create experiments rather than only explain the definitions.

## Ask less, infer more when safe

Do not turn every curiosity into a questionnaire. If a simple, reversible, clearly labeled experiment is available, the Agent may propose it directly and let the learner revise it.

## Evidence-grounded explanations

When the Agent explains a phenomenon, it should cite or point to current experiment evidence whenever possible:

- training/test metrics;
- visible coverage gaps;
- parameter changes;
- residuals;
- decision boundaries;
- trace events;
- hidden preprocessing steps.

Avoid claiming a cause solely because two values changed together.

---

# Hypothesis and exploration history

## Lightweight hypothesis step

Before a comparison or surprising experiment, optionally ask:

> "What do you think will happen?"

Do not require this for every action. It is most useful when a prediction creates a meaningful contrast with the result.

## Observation

After an experiment, record concise evidence such as:

> "Training error stayed similar, but test error increased strongly."

An observation is not necessarily an explanation.

## New question

The system or learner may turn an observation into the next branch:

> "Is the gap caused by missing training coverage?"

## Exploration Thread

A learner should eventually be able to revisit a compact chain such as:

```text
Question
-> Hypothesis
-> Experiment A/B
-> Observation
-> Follow-up question
```

Avoid gamified completion scores as the primary representation of learning.

---

# Big-Idea entry points

VOLK-ML should retain algorithm/component entry points, but add concept-level ways to enter exploration.

Candidate themes:

## Finding Patterns

What does it mean for a machine to learn a regularity from observations?

Useful models: Linear Regression, KNN, small MLP.

## Similarity

When is "things like this tend to behave like this" a useful model?

Useful models: KNN, embeddings later.

## Noise and Robustness

What happens when observations become uncertain, messy, or anomalous?

Useful worlds: regression noise, label noise, outliers.

## Generalization

Why is fitting observed examples not enough?

Useful worlds: train/test layers, gaps, extrapolation, sample-size changes.

## Distribution Shift

What happens when future observations do not look like training observations?

Useful worlds: moved test support, changed class balance, changed noise.

## Representation

Can a problem become easier when the data is transformed?

Useful models: MLP hidden representation, embeddings later.

## Model Capacity

When does a more expressive model help, and when does it merely fit accidental detail?

Useful models: linear model vs MLP, MLP width/depth.

## Optimization

If we can measure error, how does the model find better parameters?

Useful surfaces: gradient descent timeline and later Training Microscope.

These are not locked lessons. Each is a curated starting state that can branch into free exploration.

---

# Hidden mechanisms and pipeline inspection

A learner should be able to inspect consequential transformations between raw observations and model behavior.

For Linear Regression, normalization is an immediate example.

A useful conceptual pipeline view is:

```text
Raw data
  -> preprocessing / normalization
  -> model
  -> loss / learning
  -> evaluation
```

If a learner scales x-values by 1000 and optimization remains stable because the browser trainer standardizes data, the system should make that mechanism discoverable rather than letting the learner infer a false conclusion about raw-scale invariance.

Later inspectable mechanisms may include:

- normalization;
- shuffling;
- train/test splitting;
- initialization;
- regularization;
- augmentation;
- class weighting.

Do not expose every mechanism as a default toggle. Use progressive disclosure.

---

# Training Microscope

Training Microscope remains an important second-stage feature, but it comes after the exploration loop is functional.

Its purpose is to answer:

> "What is happening inside learning right now?"

Potential capabilities:

- play/pause training;
- one batch / one step;
- current prediction;
- current loss;
- current gradient;
- parameter update equation;
- parameter trajectory;
- loss history;
- later: activation and gradient probes for neural networks.

Example:

```text
w = 0.40
∂L/∂w = -0.21
η = 0.10

w_next = 0.40 - 0.10 * (-0.21)
       = 0.421
```

The Microscope should reuse real runtime traces, not a disconnected animation that can disagree with actual execution.

---

# Delivery phases

The phases below are ordered by product dependency, not by implementation convenience.

## Phase 0 - Exploration foundation

### Goal

Create the semantic and architectural base for Worlds and Experiments without duplicating the current playground runtime.

### Scope

- define the minimum World contract for 2D sample data;
- define how train/test membership is represented;
- define Experiment snapshot/restore semantics;
- define how World state is inspected and mutated through the Agent boundary;
- decide persistence/versioning impact before changing project JSON;
- keep UI strings localized;
- define resource limits and deterministic seed behavior;
- document the architecture contract before implementation if it changes existing playground semantics.

### Acceptance scenario

A programmatic test can create a small 2D World, mutate points, snapshot an experiment, restore it deterministically, and expose the same semantic state to the UI/runtime and Agent-facing inspection APIs.

### Non-goal

Do not build the full drawing UI in this phase unless the accepted design explicitly combines the first vertical slice.

---

## Phase 1 - 2D Data Workspace MVP

### Goal

Let a learner directly create and reshape a finite 2D dataset without importing files.

### Minimum scope

- Point;
- Brush;
- Spray;
- Select single point or minimal group selection;
- Erase;
- spread/density controls where needed;
- explicit train/test layer switching;
- regression mode;
- classification labels if the architecture can support them cleanly in the same slice;
- deterministic bounded point generation;
- undo/reset only if it can be delivered reliably without destabilizing project history.

### Acceptance scenarios

1. A learner draws an approximately linear cloud and fits Linear Regression.
2. A learner adds a far outlier and sees the fitted result change.
3. A learner creates two separated clouds without manually clicking every point.
4. A learner can draw train points in one x-region and test points in another.
5. Touch interaction works on a tablet-sized viewport.
6. A non-drag alternative exists for adding/editing at least one precise point.
7. No gesture can exceed the documented point-generation limit.

---

## Phase 2 - Experiment snapshots and A/B Compare

### Goal

Turn ad-hoc manipulation into controlled experimentation.

### Scope

- capture current experiment;
- duplicate experiment;
- modify one branch independently;
- restore either branch;
- run both under clear seed policy;
- side-by-side or otherwise simultaneous comparison;
- changed-vs-held-constant summary;
- key metric difference summary;
- comparison state available to Agent inspection.

### Acceptance scenario

Starting from one linear-regression world, duplicate it, change only the x-location pattern in B, run both, and produce a comparison that explicitly reports the changed factor and held-constant conditions.

---

## Phase 3 - World Builder generators

### Goal

Complement freehand data drawing with reproducible, Agent-friendly parameterized worlds.

### Initial scope

- uniform x;
- Gaussian-like x cloud;
- two-cluster x distribution;
- linear relation with slope/bias;
- sample count;
- noise amount;
- outlier injection;
- seed/regenerate;
- separate train/test World configuration.

### Acceptance scenarios

1. Re-running the same World specification and seed reproduces identical points.
2. Changing only x sampling while holding relation/noise fixed is visible in Compare View.
3. Agent-created parameterized Worlds remain editable/inspectable by the learner.
4. The UI clearly distinguishes generated samples from manually drawn samples and from the generator specification.

---

## Phase 4 - Exploration Agent learner mode

### Goal

Make natural-language curiosity a first-class entry point into experiments.

### Scope

- simplified learner-facing prompt;
- hide plan/script/fidelity internals by default;
- interpret common exploration goals into World/Experiment operations;
- experiment proposals with visible change summaries;
- optional prediction prompt;
- run and evidence highlight;
- grounded follow-up experiment suggestions;
- retain advanced inspection mode for developers and power users.

### Acceptance scenarios

The following requests should lead to useful, inspectable experiments rather than generic explanations:

- "What happens if I add some outliers?"
- "Make the test data different from training data."
- "Try linear regression on two different distributions."
- "Make this dataset harder without changing the model."
- "Why did the line move so much after I added that point?"

The Agent must not silently change multiple causal factors when proposing a one-factor comparison.

---

## Phase 5 - Hypothesis, observation, and exploration threads

### Goal

Preserve the learner's reasoning path without imposing a rigid course.

### Scope

- optional hypothesis/prediction;
- experiment link(s);
- concise observation capture;
- follow-up question;
- lightweight thread/history view;
- resume exploration from a previous branch.

### Acceptance scenario

A learner can return to an exploration and understand what question they asked, what two experiments were compared, what they predicted, what evidence appeared, and what question came next.

---

## Phase 6 - Big-Idea exploration entrances

### Goal

Provide curated conceptual starting points without turning them into locked lessons.

### Scope

Start with a small set such as:

- Finding Patterns;
- Noise and Robustness;
- Generalization;
- Distribution Shift;
- Model Capacity.

Each entrance should load a useful initial World/Experiment and pose a question, while leaving the learner free to diverge immediately.

### Acceptance scenario

A learner can enter "Distribution Shift" without first selecting an algorithm chapter and immediately manipulate train/test worlds in a meaningful experiment.

---

## Phase 7 - Training Microscope

### Goal

Allow exploration to descend from behavior into mechanism.

### Scope

- stepwise training playback;
- parameter and loss traces;
- gradient evidence;
- visible update mechanics;
- pipeline preprocessing visibility;
- later neural activation/gradient probes.

### Acceptance scenario

A learner who sees an unexpected training behavior can inspect the actual runtime trace and understand which parameter update or preprocessing step produced the visible change.

---

## Phase 8 - Extend the exploration model beyond 2D tabular worlds

Only after the core loop works well should VOLK-ML aggressively expand the same exploration grammar to:

- CNN/image worlds;
- sequence worlds;
- attention/Transformer worlds;
- embeddings/vector search;
- RAG;
- agent planning/tool-use.

The goal is not merely to add new components. Each new domain should answer:

1. What is the manipulable World?
2. What is the Model's inductive bias?
3. What can the learner change?
4. What evidence becomes visible?
5. What controlled comparisons become possible?
6. What can the Agent safely manipulate and explain?

---

# Priority summary

## P0 - Complete the exploration loop

1. World semantic contract.
2. 2D Data Workspace.
3. Train/Test World layers.
4. Experiment snapshot/duplicate.
5. A/B Compare.
6. Agent-readable/mutable World and Experiment state.
7. Simplified learner-facing Agent flow.

## P1 - Make exploration pedagogically durable

1. Hypothesis/prediction.
2. Observation.
3. New-question branching.
4. Exploration history.
5. Big-Idea entrances.
6. Hidden-mechanism inspection.

## P2 - Explain internal learning mechanics

1. Training Microscope.
2. Parameter trajectory.
3. Gradient visualization.
4. Loss landscape where truthful and useful.
5. Neural node/activation probes.

## P3 - Expand domains

1. image/CNN;
2. sequence;
3. attention/Transformer;
4. vector search/RAG;
5. agent planning.

Do not allow P3 breadth to displace P0 exploration foundations unless a separate user-approved priority change is made.

---

# Non-goals

The exploration roadmap does **not** aim to turn VOLK-ML into:

- a full replacement for a university ML syllabus;
- a professional vector drawing application;
- a general scientific notebook;
- an unrestricted probability-programming environment;
- a large-scale data visualization product;
- a no-code AutoML service;
- an Agent that primarily lectures in chat;
- a hidden system where Agent-generated changes cannot be inspected or reproduced.

---

# Architectural guidance for Codex

## Reuse current playground architecture

Before implementing exploration features, inspect the active playground architecture and reuse the unified runtime, semantic state, visualization scripts, trace contracts, TeachingPlan/composer pipeline, and Canvas Agent API where they genuinely fit.

Do not create a second independent state machine for the 2D Workspace if the existing runtime can be extended with a clean World contract.

Do not force World semantics into unrelated model controls merely to reuse `compare-control` machinery. Extend the abstraction when the domain concept is genuinely different.

## Keep UI and Agent operations aligned

A point added by the Agent and a point added by the user should pass through the same semantic mutation rules.

A World generated through an Agent request should be inspectable, editable, serializable, and testable through the same public contracts as a manually created World.

## Persistence requires deliberate versioning

If World, Experiment, or Exploration Thread state enters project JSON:

- inspect the current project contract;
- decide whether `PROJECT_VERSION` must change;
- add migration coverage;
- preserve old projects;
- do not create an Agent-only persistence format.

## Localized UI remains mandatory

All new user-visible copy belongs in `src/locales/ui.js` and must preserve English, Chinese, and parallel-language behavior according to `AGENTS.md`.

## Deterministic tests over screenshot-only assertions

When an interaction teaches a semantic claim, add a pure or focused contract assertion where practical.

Examples:

- same seed + same generator -> same points;
- duplicate experiment before mutation -> semantically equal conditions;
- one-factor comparison -> exactly the declared factor differs;
- train/test point membership survives snapshot/restore;
- Agent mutation respects point/resource caps;
- Sample World never acquires generator claims without an explicit conversion.

## Resource safety

Agent and UI generation paths must share hard limits. Validate limits before expanding large generated point sets or visualization scripts.

## Accessibility is part of acceptance

Do not treat keyboard/touch/non-drag access as a final polish phase for the Data Workspace. Primary exploration must remain possible without precise mouse-only dragging.

---

# Codex execution protocol

This roadmap does not override `AGENTS.md` or `docs/development-workflow.md`. It adds product direction and phase dependencies.

For each implementation cycle:

1. **Read only the relevant architecture docs and current code.** Code remains the source of truth.
2. **State the selected roadmap slice.** Do not silently combine multiple phases.
3. **Design before development.** Define goal, scope, data/semantic contract, UX behavior, acceptance criteria, and exact tests.
4. **Get user agreement before executable-code changes**, as required by the repository workflow.
5. **Implement one coherent vertical slice.** Prefer a small end-to-end learner capability over broad scaffolding with no usable surface.
6. **Keep Agent, UI, and runtime semantics aligned.** Avoid temporary duplicate behavior unless explicitly accepted.
7. **Run focused tests plus applicable `npm run check`, `npm run build`, and `git diff --check`.**
8. **Report acceptance criterion by criterion.** Include limitations and deferred items.
9. **Update relevant architecture documentation when contracts change.**
10. **Append the accepted change set to `CHANGELOG.md` before opening a pull request.**

When a proposed task conflicts with this roadmap, do not automatically reject it. Identify the conflict explicitly and ask whether priorities have changed when that difference is material.

---

# North-star acceptance journey

The long-term exploration layer is successful when the following journey feels natural without documentation:

1. The learner watches a short video framing a model as a way to search for patterns.
2. They open VOLK-ML and draw an approximately linear set of points.
3. They fit Linear Regression and see the model's interpretation.
4. They spray a second cluster and observe the fit change.
5. They ask the Agent: "What if the data distribution changes?"
6. The Agent distinguishes a few meaningful interpretations and proposes one controlled experiment.
7. The learner duplicates the experiment.
8. A keeps the original World; B changes only the x distribution.
9. The learner predicts the outcome.
10. Both experiments run under an explicit comparable seed policy.
11. Compare View shows the two Worlds, metrics, what changed, and what stayed constant.
12. The Agent points to an evidence difference rather than immediately delivering a lecture.
13. The learner notices that test behavior differs and asks why.
14. The Agent highlights training coverage or another relevant mechanism and proposes a follow-up.
15. The learner changes the test World directly and continues.
16. The Exploration Thread preserves the question, prediction, evidence, and new question.

At no point should the learner need to understand internal planner/script/fidelity terminology in order to complete this journey.

---

# Product identity

The intended direction can be summarized as:

> **VOLK-ML is a visual experiment lab for building machine-learning intuition.**
>
> Videos provide ways of seeing. The platform provides worlds to manipulate. The Agent helps turn curiosity into experiments.

The long-term differentiator is not the number of supported layers or frameworks. It is the ability to make abstract ML ideas physically explorable while preserving enough semantic rigor that the learner's conclusions remain trustworthy.
