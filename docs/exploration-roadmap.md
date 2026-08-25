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

A learner who has never read the internal documentation should be able to create or modify data visually, preserve and compare experiments, inspect what changed, and continue from the result without first learning VOLK-ML's internal planner/script abstractions.

The Agent may accelerate this journey, but it must not be required for the core journey to work.

This roadmap should guide future Codex work whenever a task touches interactive data worlds, playground exploration, experiment comparison, manual or guided exploration, agent-guided exploration, or learning journeys.

## Document status and infrastructure direction

This roadmap is the authoritative exploration plan. The design rationale in `docs/exploration-infrastructure-supplement.md` has been selectively integrated here; when wording or phase boundaries differ, this roadmap governs implementation scope. The supplement remains a deeper reference, not a parallel backlog.

The infrastructure direction is to build open-ended scenarios from a finite set of registered semantic capabilities rather than accumulating hard-coded playgrounds or Agent-only recipes:

```text
learner intent
  -> scenario specification
  -> world construction and intervention
  -> experiment execution
  -> observable evidence
  -> next question
```

This direction strengthens the existing phased plan. It does not authorize implementing a general Scenario Engine before the minimum World, operation, comparison, and observation contracts have been proven through learner-facing vertical slices.

---

# Product thesis

VOLK-ML should combine three complementary surfaces.

## 1. Video: ways of seeing

Videos provide compact intuitions and broad mental models rather than complete syllabus coverage.

Examples:

- A model is a constrained way of searching for patterns.
- A loss function defines what counts as a bad answer.
- Representation can make a hard pattern easier to express.
- Generalization asks whether the pattern survives beyond observed examples.
- Every model contains inductive biases about what kinds of patterns are worth searching for.

A video should often end with an unresolved or partially resolved question that can be explored in VOLK-ML.

## 2. VOLK-ML Lab: worlds to explore

The platform provides manipulable environments where learners can change data, models, learning rules, and evaluation conditions and directly observe the consequences.

The learner should not need to start from an algorithm name. A valid entry point is simply to draw data and ask:

> "What pattern would a linear model see here?"

The Lab must remain a complete product even when AI features are disabled, unavailable, unconfigured, or deliberately ignored by the learner.

## 3. Agent: an exploration companion

The Agent helps transform vague curiosity into concrete, inspectable experiments. Its default behavior should be closer to a Socratic lab partner than an encyclopedia.

Preferred interaction order:

```text
Observe
  -> ask or clarify
  -> propose an experiment
  -> ask for a prediction when useful
  -> run or modify the world
  -> point to evidence
  -> explain only as needed
  -> suggest a next test
```

The Agent may still explain concepts directly when requested, but explanation should not replace experimentation when the user's question is experimentally testable.

The guiding principle is:

> **The Agent should accelerate exploration, not make exploration possible.**

## World–Data inquiry loop

The learner-facing semantic contract is explicit:

```text
World
  -> observation process / sampling
  -> finite Dataset
  -> model evidence and learner prediction
  -> intervention or resampling
  -> comparison
  -> revision / next question
```

World identity and Dataset provenance are distinct projections. A `Sample
again` action keeps the generated World's mechanism and identity fixed while
changing the finite observation sample; changing the generator's latent
relation is a World change. A duplicated Experiment can therefore compare the
same World with different data, or the same Dataset with different supported
model adapters. These semantics remain session-local and derived; they do not
introduce a probability engine, causal engine, World DSL, or automatic learner
understanding.

---

# Exploration modes

VOLK-ML should support three levels of guidance over the same underlying semantic system. These are not three separate products.

```text
                    ┌─ Free Explore
                    │
Video -> VOLK-ML Lab ┼─ Guided Explore
                    │
                    └─ Agent Explore
```

## Free Explore

For learners who already know what they want to try.

Primary surfaces:

- 2D Data Workspace;
- model controls;
- Experiment Bar;
- Duplicate;
- Compare;
- Repeat;
- Undo/Reset;
- metrics and visual evidence.

The system should stay mostly quiet and let perception and manipulation drive the next action.

## Guided Explore

For learners who want to explore an idea but do not yet know how to turn it into an experiment.

Guidance is deterministic and does not require an Agent or external AI provider.

Possible guidance:

- a starting World;
- an open question;
- a suggested manipulation;
- Changed / Unchanged summaries;
- Comparison Clarity;
- factual Observation notices;
- optional "things to try" cards;
- reusable experiment recipes.

Guided Explore must not become a locked step-by-step course. The learner may diverge immediately.

## Agent Explore

For learners who have a vague or natural-language question and want help translating it into experiments.

The Agent adds:

- natural-language interpretation;
- dynamic experiment planning;
- semantic World manipulation;
- context-sensitive follow-up suggestions;
- evidence-grounded explanation.

Agent Explore should build on the same Worlds, Experiments, domain operations, comparison system, and evidence that Free and Guided Explore use.

---

# Product principles

## Exploration before instruction

Do not require a learner to complete a lesson before using the system. Concepts may be discovered through free exploration and revisited from multiple directions.

## Questions before terminology

Whenever practical, let the learner encounter a phenomenon before naming it.

For example:

- Let the learner move the test distribution before introducing "distribution shift".
- Let one outlier pull a fitted line before introducing robustness.
- Let a model fit training points and fail elsewhere before introducing overfitting or extrapolation.

## Worlds and models are equally important

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

## Human interaction and Agent interaction are different

Humans naturally explore through a tight perceptual loop:

```text
perceive
  -> manipulate
  -> observe
  -> manipulate again
```

Agents naturally work more declaratively:

```text
goal
  -> plan
  -> semantic operations
  -> inspect result
```

Do not force humans to use planner-like abstractions merely because they are convenient for the Agent. Do not force the Agent to manipulate DOM/UI gestures merely because they are convenient for humans.

Both interaction styles should share the same domain semantics underneath.

## Manual parity for core exploration

Every core experiment that the Agent can create should have a reasonable manual path through the product.

Examples:

- Agent can add outliers -> learner can add points or spray them.
- Agent can create train/test shift -> learner can switch layers and move/edit the test World.
- Agent can compare two distributions -> learner can Duplicate and Compare.
- Agent can repeat an experiment -> learner can use Repeat.

If an Agent capability has no practical manual path, treat that as a design warning. Bulk or convenience operations may remain easier through the Agent, but their resulting state must remain visible, editable, reproducible, and understandable without the Agent.

## Controlled comparison is a core learning primitive

A learner should be able to duplicate an experiment, change one factor, and see exactly what was held constant.

## Important hidden mechanisms should become inspectable

Normalization, splitting, shuffling, initialization, augmentation, regularization, class weighting, and similar mechanisms should not silently invalidate a learner's interpretation of an experiment.

They do not all need to be exposed as default controls, but important transformations should be inspectable and, when pedagogically safe, toggleable.

## The same world should serve humans, videos, and agents

Do not create separate fake teaching logic for screenshots or the Agent. Reuse the existing unified playground/runtime direction: the human UI, presentation/video scripts, and Canvas Agent should operate on the same semantic state and actions wherever possible.

## Determinism matters

Exploration should support reproducible comparisons. Generated samples, Agent-created Worlds, duplicate experiments, repeated trials, and teaching presets must use explicit seed semantics where randomness is involved.

## Honest semantics over impressive visuals

Never imply that a hand-drawn finite sample is a probability distribution unless a separate generator has actually been defined or inferred. Never label an architecture sketch as a trained result. Never hide a meaningful approximation.

## Factual guidance before causal claims

The system may deterministically point out observable changes such as:

> "Test error changed much more than training error."

It should not automatically turn correlation into explanation:

> "The distribution shift caused the error increase."

Causal interpretation should be supported by controlled comparison or explicitly framed as a hypothesis to test.

---

# Core product model

## World

A `World` describes the environment that produces or contains observations used by an experiment.

The long-term World contract should distinguish four semantic concerns:

- **State**: current observations, stable identities, train/test membership, labels, time, and provenance;
- **Rules**: latent relations, class rules, correlations, dynamics, and other mechanisms that may produce data;
- **Observation process**: sampling, coverage, noise, missingness, measurement, and selection effects between latent rules and observed data;
- **Interventions**: explicit operations that change state, rules, or the observation process.

These concerns may share one implementation boundary at first, but they must not be collapsed semantically. The system should be able to represent the difference between changing an underlying relationship and changing only how that relationship is observed:

```text
latent World rules
  -> observation process
  -> observed Dataset
  -> Model / learning / evaluation
```

This distinction is the basis for honest exploration of sampling bias, noise, missingness, train/test coverage, covariate shift, concept shift, shortcut learning, and extrapolation. A finite Sample World does not claim latent rules or a generator unless those semantics are explicitly present.

The first implementation should focus on small two-dimensional supervised-learning Worlds because they are highly visual, cheap to run, and useful across regression, KNN, MLPs, classification, clustering, generalization, and distribution-shift examples.

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
Seed policy
Result / metrics
Relevant traces
```

An Experiment is not merely the current mutable project state. It should be possible to capture, duplicate, compare, repeat, and restore experimental states without manually reconstructing them.

The learner-facing UI should begin with A/B comparison, while the underlying identity and lineage remain branch-capable. An experimental branch should be expressible as a parent or baseline plus a semantic change set, not as storage hard-coded to exactly two slots. This leaves room for follow-up branches and Exploration Threads without exposing version-control concepts to beginners.

## Scenario specification

A `ScenarioSpec` is the conceptual grammar for expressing a controlled exploration. The exact implementation name and shape may follow existing runtime conventions, but it should be able to declare:

```text
Baseline
Interventions
Constraints
Observables
Randomness policy
Execution strategy
Comparison goal
Fidelity metadata
```

The core sentence it must preserve is:

> **Change X, hold Y fixed, observe Z.**

Interventions should use registered domain semantics, not model-specific prompt branches. Constraints should explicitly distinguish intended changes from held conditions and allow validation to reject a proposed scenario that introduces hidden confounds. A formal constraint editor and a general Scenario Engine UI are not Phase 1 requirements; the first value is a small, inspectable contract shared by manual, Guided, and Agent paths.

Exploration-variable metadata may extend existing control and operation schemas with semantic role, meaning, intervention kind, preserved conditions, possible effects, and known confounds. This metadata belongs to registered capabilities rather than Agent prompt memorization.

## Observables and evidence

Observables are first-class semantic outputs of an experiment. They may describe:

- outcomes, such as train error, test error, predictions, or residuals;
- model state, such as slope, intercept, boundaries, or learned parameters;
- learning behavior, such as loss trajectories, stopping reasons, or gradient evidence;
- World evidence, such as coverage, class balance, variance, or train/test mismatch.

Observation processing should follow a deterministic pipeline where practical:

```text
raw observables
  -> derived observables
  -> conservative evidence detectors
  -> learner UI / Guided Explore / Agent
```

Examples of derived observables include generalization gap, outlier sensitivity, repeat stability, and coverage mismatch. The Agent may explain or propose follow-ups from this evidence, but should not recompute deterministic facts or infer causes that the comparison does not establish.

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

Snapshots answer what an experiment contains now; semantic actions answer how it got there. History should therefore retain lightweight, JSON-safe action records with actor, domain, intent, and mutation summary. One human gesture or one accepted Agent proposal should form one understandable action boundary even when it expands into multiple low-level mutations. This supports grouped Undo, ancestry, provenance, and thread reconstruction without committing to full event sourcing.

---

# Human-first experiment interaction

The product should provide a small, learnable experiment grammar that matches normal human behavior.

A useful manual loop is:

```text
Make / Change
  -> Duplicate
  -> Change one branch
  -> Compare
  -> Repeat if needed
  -> Undo / refine
```

The learner should not need to think in terms of snapshots, captures, branches, planners, or scripts even if those concepts exist internally.

## Make / Change

Directly manipulate the current World, model, learning settings, or evaluation conditions.

Examples:

- draw data;
- move a cluster;
- add an outlier;
- change learning rate;
- switch the active train/test layer.

## Duplicate

A first-class action for the thought:

> "Keep this version. I want to try something else."

Duplicate should preserve the full experimental state by default so the learner begins from a controlled baseline.

## Compare

Bring two experiments into a common view and make differences explicit.

## Repeat

Run the same experimental conditions again under an explicit randomness policy.

Repeat is important because a single sample/run should not silently teach that one observed number is the underlying rule.

## Undo / Reset

Exploration depends on cheap reversible mistakes.

Undo should follow **human action boundaries**, not implementation-level mutations. One brush stroke that creates 80 points should normally be one undoable action, not 80 separate steps. One Agent request that adds three outliers should also be one inspectable/reversible mutation when practical.

---

# Experiment Bar

The **Experiment Bar** is a P0 human-facing design surface and should become the primary navigation model for active experimentation.

Its purpose is to answer, at a glance:

- Which experiment am I looking at?
- What other experiment am I comparing against?
- How do I preserve this state and try a variation?
- What changed between the two?
- Is comparison currently active?

A conceptual first version:

```text
A: Original          B: Test shift

[ A ] [ B ]   [+ Duplicate]   Compare: ON

Changed from A:
Test World
```

The exact visual design may evolve, but the human mental model should remain simple:

> **Keep one version, copy it, change something, compare.**

## Experiment Bar requirements

- clearly show the active Experiment;
- make Duplicate prominent;
- allow quick switching between A/B or the small supported number of branches;
- expose Compare without requiring a separate project/version workflow;
- show a compact Changed summary when a comparison baseline exists;
- preserve the distinction between an Experiment and a saved project;
- remain usable without the Agent;
- remain accessible by keyboard and touch;
- avoid becoming a full Git-like history UI.

## Initial scope

The first version should optimize for two experiments rather than prematurely building an arbitrary experiment tree.

A/B is enough to teach the core behavior:

```text
baseline
  -> duplicate
  -> modify B
  -> compare A vs B
```

Multi-branch exploration can be added only after the A/B interaction is proven understandable.

---

# Changed / Unchanged and Comparison Clarity

The system itself should make experimental structure visible, without requiring Agent reasoning.

## Changed / Unchanged

When B is duplicated from A, VOLK-ML should be able to summarize semantic differences.

Example:

```text
Changed
- Test distribution

Held constant
- Train data
- Model
- Learning rate
- Training steps
- Noise
```

If the learner later changes learning rate as well:

```text
Changed
- Test distribution
- Learning rate
```

This is not merely UI convenience. It teaches experimental control.

## Comparison Clarity

A lightweight deterministic indicator can communicate how isolated a comparison is.

Example:

```text
Comparison clarity: High
Only one experimental factor differs.
```

or:

```text
Comparison clarity: Mixed
Three factors differ:
- distribution
- sample count
- learning rate
```

Do not label a mixed experiment as "wrong". It may be a perfectly valid exploratory state. The system should only communicate that the observed difference cannot be cleanly attributed to one factor yet.

## Semantic diff, not raw JSON diff

Comparison must operate on domain meaning where possible.

Useful categories include:

- World/data;
- train/test relationship;
- model;
- learning configuration;
- evaluation configuration;
- randomness policy.

Do not expose internal field noise as the primary learner-facing diff.

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
- active class for classification Worlds;
- active layer: train, test, or view both;
- clear/reset;
- deterministic seed / regenerate where generation is stochastic.

## Train and test layers

Train/test should become visible spatial concepts, not only split percentages.

The Workspace should eventually support:

```text
[Train] [Test] [Both]
```

A learner may draw or manipulate the train and test Worlds separately.

This allows direct experiments such as:

- train on `x in [-1, 1]`, test on `x in [2, 4]`;
- keep the underlying relation the same but move input support;
- preserve training data while adding test noise;
- create class imbalance only in test;
- create regions with little or no training coverage.

The visual encoding must make layer membership clear without depending only on color.

## Classification support

The same 2D Workspace should support labeled points for KNN and small MLP experiments.

Examples:

- draw two well-separated classes;
- create an XOR layout;
- introduce mislabeled points;
- move a class cluster;
- change overlap;
- compare KNN and MLP decision boundaries on the same World.

## Regression support

Regression mode should allow direct visual fitting with Linear Regression first.

The fitted line and relevant metrics should update either live or through a clearly controlled fit action, depending on performance and pedagogical intent.

A powerful basic interaction is:

1. draw an obvious trend;
2. fit a line;
3. add one far outlier;
4. watch the fit change;
5. ask why.

## Live fit versus training

Do not blur an analytic or instantly recomputed best fit with iterative learning.

For simple Linear Regression, an immediate fitted-line preview can be useful. The UI should still distinguish concepts such as:

- current manually chosen parameters;
- analytic/best fit;
- parameters learned through gradient descent.

This distinction becomes essential when moving to models such as MLPs that cannot truthfully behave as if they instantly retrain after every pointer movement.

## Pattern mode

Pattern mode is a later extension of the same Workspace, not a replacement for direct drawing.

A learner might draw or configure an underlying relation and then sample from it with controls such as:

- sample count;
- noise amount;
- noise family when supported;
- x sampling range or simple x sampling pattern;
- outlier rate;
- seed.

The UI must always state whether the learner is editing explicit samples or a generator.

## View transform versus data transform

Zooming, panning, and auto-fit are view operations. Moving or rescaling data is a World mutation.

The UI and semantic state must keep these separate. An auto-fit axis must not visually erase the meaning of a distribution shift by making two distant Worlds appear identically centered without an obvious common reference.

Comparisons should use synchronized or otherwise explicitly comparable axes where the phenomenon depends on spatial position.

## Accessibility

Dragging cannot be the only way to perform a primary operation.

Provide practical alternatives such as:

- add point by numeric x/y fields;
- move selected point with numeric controls or keyboard-friendly step buttons;
- select class/layer with native controls;
- clear descriptions of the current dataset and selected point(s).

Touch interaction must remain usable on mobile/tablet, consistent with VOLK-ML's existing mobile goals.

## Performance bounds

The browser Workspace is pedagogical, not a large-data plotting engine.

Define explicit limits for:

- total points;
- points generated by one gesture;
- redraw frequency;
- decision-grid resolution;
- Agent-generated mutations.

Do not allow an Agent or brush gesture to generate unbounded work.

---

# World Builder

The 2D Workspace is the most direct World Builder. Parameterized generators are a complementary layer, especially useful for reproducible comparisons and Agent-created experiments.

Simple learner-facing presets should be backed by composable semantic primitives rather than becoming the only representation. For a 2D regression World, useful separable capabilities include:

```text
Input generator
+ latent relation
+ observation noise
+ anomaly process
+ sampling / coverage
+ train/test process
```

The UI may present a small preset such as "two clusters with noise," while the scenario and comparison layers retain which primitives were composed and which were changed. The first generator release should implement only the combinations required by its acceptance scenarios; this decomposition is an extension point, not a mandate for a universal generator framework.

World Composer v1 now provides that bounded compositional extension for Agent-designed Worlds. `WorldRecipe` is normalized into the same generated-World lifecycle, with stable group identities, primitive geometry, transforms, sampling, train/test variants, separated noise/anomaly semantics, and deterministic scoped seeds. Presets compile into the recipe; they are not a second generator contract. See `docs/architecture/world-composer.md`.

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

## Manual and generated Worlds must meet

A learner should be able to inspect and continue manipulating generated data. A parameterized World should not become a sealed Agent artifact.

Where semantics allow, the learner should be able to:

- regenerate from the same seed;
- change generator parameters;
- convert/freeze generated observations into explicit samples;
- manually edit the resulting samples with clear provenance.

Do not silently pretend that manual edits still came from the unchanged generator specification.

---

# Experiment comparison, randomness, and repeat

## Duplicate Experiment

A first-class action should duplicate the current Experiment while keeping everything identical by default.

```text
Experiment A
  -> Duplicate
Experiment B
```

The learner can then modify exactly one factor.

## Compare View

A/B comparison is a P0 exploration capability.

The comparison should show:

- the two Worlds or relevant visual states;
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

- changing one control in the same World;
- changing the Dataset/World;
- changing the train/test relationship;
- changing the model;
- changing learning configuration;
- changing evaluation configuration;
- changing randomness policy.

Do not reduce every comparison to a generic control-value pair if that loses important meaning.

Reuse existing capture/restore semantics and TeachingPlan comparison infrastructure where appropriate, but extend the semantic model rather than forcing World changes into unrelated model controls.

## Seed policy

Randomness must be explicit enough that learners can interpret comparisons.

The UI/model should eventually distinguish at least:

### Matched randomness where meaningful

Use corresponding randomness to isolate a changed factor when the generator semantics support it.

### Independent samples

Draw independent samples from each experimental condition.

### Repeat N times

Estimate how stable the observed effect is across repeated samples/runs.

Do not imply that one seed is definitive evidence about a stochastic system.

## Repeat

Repeat should be a manual first-class action, not an Agent-only operation.

It should also be a real, bounded Experiment Engine primitive:

```text
scenario
  -> explicit trial seeds
  -> repeated execution
  -> per-trial observables
  -> aggregate observables
```

Repeated execution must preserve the declared intervention and held conditions, report its randomness policy, and respect browser workload limits. The result should remain inspectable at both aggregate and individual-trial levels where practical.

A lightweight regression example may show multiple fitted slopes/lines across repeated datasets and summarize their spread.

This creates a natural path toward:

- variance;
- stability;
- sample size;
- uncertainty;
- the distinction between one observation and a repeatable pattern.

The first Repeat implementation should remain visually simple and bounded.

## Future parameter sweep

A bounded parameter sweep is a later core execution primitive, not a Phase 1 requirement. Its eventual contract should apply a declared list or range of values, execute under explicit randomness and constraints, and collect one or more observables. The architecture should leave room for this operation without adding sweep UI or broad framework work before Repeat and controlled comparison are proven.

---

# Guidance without an Agent

VOLK-ML should help users form experiments even when no Agent is present.

The system can provide structure without pretending to reason like an AI tutor.

## Things to try

A playground or Big-Idea entry may show optional prompts such as:

- What if one point is far away from all the others?
- What if training covers only half of the x-axis?
- What if the noise increases?
- Does adding more data stabilize the fitted line?

These prompts should be ignorable and should not lock the learner into a sequence.

## Experiment recipes

A recipe is a lightweight curated starting state, not a lesson.

A recipe may contain:

```text
Question
Initial World
Optional suggested manipulation
Relevant visible controls
```

Example:

```text
Question:
What happens when test data appears outside the training region?

Starting state:
Train and test initially overlap.

Suggested action:
Move the test points somewhere the model has never seen.
```

The learner should be free to change a different factor instead.

## Affordance guidance

When a learner chooses a question/prompt, the UI may highlight useful controls rather than performing the experiment automatically.

For example:

> "Try separating train and test."

may highlight:

- Train/Test layer selector;
- Duplicate;
- Compare.

This teaches how to use the Lab while preserving learner agency.

## Deterministic Observation Detection

Important observable patterns should not require an LLM to notice them.

A domain-specific observation layer may surface facts such as:

- test error changed much more than train error;
- train/test gap increased;
- slope moved strongly after a point was added;
- repeated runs show high variation;
- learning stopped because the learning rate was too high;
- one experiment differs from another in multiple causal factors.

Observation detectors should be based on explicit semantic state/metrics and conservative thresholds, not visual guessing.

They should describe evidence, not silently assert causes.

Example:

> **Notice:** Test error increased 3.2x while training error changed only slightly.

Not:

> **Explanation:** Distribution shift caused failure.

## System guidance should remain quiet by default

Free Explore should not constantly interrupt manipulation.

Observation notices should be subtle and dismissible. Guided Explore may surface them more prominently. Agent Explore may use them as evidence for a conversation.

---

# Exploration Agent

## Learner-facing surface

The default learner surface should begin with a simple prompt such as:

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

1. identify ambiguity that materially changes the experiment;
2. choose or offer a small number of meaningful interpretations;
3. propose a controlled experiment;
4. show exactly what it will change;
5. optionally ask the learner to predict the result;
6. run only after the user-facing action is explicit;
7. highlight evidence rather than immediately narrating a complete answer;
8. suggest a next experiment grounded in what just happened.

## Capability discovery and Scenario Fidelity

The Agent should discover what can be changed, observed, constrained, compared, repeated, or restored from registered semantic capabilities. It must not rely on a growing prompt-only catalog of model-specific scenarios. Existing control schemas, operation intents, semantic state, and Agent inspection APIs should evolve toward this capability-discovery boundary.

For every proposed scenario, the system should compare requested intent with implemented semantics and report one of:

- **exact**: every material requested condition is represented;
- **partial**: a useful subset is represented and missing aspects are explicit;
- **approximate**: the scenario uses a disclosed proxy or simplification.

Unsupported or omitted aspects must remain visible in fidelity metadata. Scenario Fidelity is evidence about implementation coverage, not a license to silently approximate or to expose internal planner vocabulary in the default learner UI.

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

## Agent action diff

Every Agent mutation should leave a concise inspectable record of what changed.

Example:

```text
Changed by Agent
- Test x-range: [-1, 1] -> [2, 4]

Unchanged
- Train World
- Model
- Learning rate
- Noise
```

The learner should be able to inspect and, where practical, undo the mutation without asking the Agent to reverse-engineer its own action.

## Agent initiative

The Agent should be quiet enough that the learner remains the explorer.

Default principle:

- do not comment on every gesture;
- do not turn every observation into a lecture;
- do not automatically change the World because a potentially interesting phenomenon appeared.

More active intervention is appropriate when:

- the learner explicitly enters Agent Explore;
- the learner asks for help;
- a requested goal cannot be completed without clarifying a material ambiguity;
- a clearly surprising/failure event is detected and the learner has opted into guidance.

## Ask less, infer more when safe

Do not turn every curiosity into a questionnaire. If a simple, reversible, clearly labeled experiment is available, the Agent may propose it directly and let the learner revise it.

## Evidence-grounded explanations

When the Agent explains a phenomenon, it should point to current experiment evidence whenever possible:

- training/test metrics;
- visible coverage gaps;
- parameter changes;
- residuals;
- decision boundaries;
- trace events;
- hidden preprocessing steps;
- deterministic Observation Detection output.

Avoid claiming a cause solely because two values changed together.

---

# Shared domain operations

Human and Agent interaction should converge on a stable set of semantic domain operations.

The operation registry is also the capability registry: each operation should declare enough semantics for UI affordances, validation, comparison, constraints, history, and Agent discovery to agree on what it changes. Model adapters may execute model mathematics, but they must not become the source of exploration capabilities or model-specific Agent branches.

Illustrative operations include:

```text
addPoints
movePoints
removePoints
setTrainTestMembership
setWorldGenerator
regenerateWorld
duplicateExperiment
activateExperiment
restoreExperiment
fitModel
runExperiment
repeatExperiment
compareExperiments
setModelControl
setEvaluationCondition
```

The exact API should follow existing architecture conventions and may use different names. The important design rule is that domain semantics are shared.

## Human mapping

Humans invoke domain operations through direct manipulation and visible controls:

```text
click / tap
brush
spray
drag
slider
layer switcher
Duplicate button
Compare button
Repeat button
Undo
```

## Agent mapping

The Agent invokes domain operations through semantic commands/plans:

```text
"Add three outliers."
"Move the test distribution to the right."
"Duplicate this and increase noise."
"Repeat this experiment five times."
```

## Semantic action history and grouped Undo

Every accepted operation should produce a lightweight semantic action record suitable for history and comparison. At minimum it should identify the actor, affected domain, user-level intent, and mutation summary. Compound brush gestures and approved Agent plans should be grouped into one reversible action boundary; low-level point updates should not flood learner history or require the Agent to reconstruct an inverse operation from prose.

## Do not let the Agent operate the DOM as the core contract

The Agent should not need to synthesize pointer movements or click coordinates to perform core experiment operations.

Conversely, the human UI should not need to expose TeachingPlan or script JSON to perform those same operations.

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

Useful Worlds: regression noise, label noise, outliers.

## Generalization

Why is fitting observed examples not enough?

Useful Worlds: train/test layers, gaps, extrapolation, sample-size changes.

## Distribution Shift

What happens when future observations do not look like training observations?

Useful Worlds: moved test support, changed class balance, changed noise.

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

The delivered finite-sample foundation remains the starting point. The following design decisions define forward-compatible extension boundaries; they do not require implementing a general Scenario Engine inside Phase 0.

### Scope

- define the minimum World contract for 2D sample data;
- define how train/test membership is represented;
- define Experiment snapshot/restore semantics;
- define Experiment semantic diff categories;
- define shared domain operations for UI and Agent use;
- distinguish World State, latent Rules, Observation Process, and Interventions in the semantic design, while allowing the first finite Sample World to implement only State and direct interventions;
- define a discoverable operation registry and minimal exploration-variable metadata rather than Agent-only capability lists;
- define minimal `change` / `hold` constraint semantics and observable declarations;
- keep Experiment identity and lineage branch-capable even though the first learner UI is A/B;
- define undoable human action boundaries;
- define lightweight grouped semantic action records;
- decide persistence/versioning impact before changing project JSON;
- keep UI strings localized;
- define resource limits and deterministic seed behavior;
- document the architecture contract before implementation if it changes existing playground semantics.

### Acceptance scenario

A programmatic test can create a small 2D World, mutate points, snapshot an Experiment, restore it deterministically, compare semantic state, and expose the same domain state to the UI/runtime and Agent-facing inspection APIs.

### Non-goal

Do not build the full drawing UI in this phase unless the accepted design explicitly combines the first vertical slice.

---

## Phase 1 - 2D Data Workspace MVP

### Goal

Let a learner directly create and reshape a finite 2D dataset without importing files or using the Agent.

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
- practical Undo/Reset with gesture-level action grouping;
- route every gesture through registered World interventions and verify the resulting grouped semantic action;
- view/data transform separation;
- non-drag precise-edit alternative.

### Acceptance scenarios

1. A learner draws an approximately linear cloud and fits Linear Regression.
2. A learner adds a far outlier and sees the fitted result change.
3. A learner creates two separated clouds without manually clicking every point.
4. A learner can draw train points in one x-region and test points in another.
5. Touch interaction works on a tablet-sized viewport.
6. A non-drag alternative exists for adding/editing at least one precise point.
7. One brush gesture is one understandable Undo action.
8. No gesture can exceed the documented point-generation limit.
9. The learner can complete these tasks without enabling or configuring an Agent.

---

## Phase 2 - Experiment Bar, snapshots, and A/B Compare

### Goal

Turn ad-hoc manipulation into a human-friendly controlled experiment workflow.

### Scope

- Experiment Bar;
- capture current Experiment;
- Duplicate;
- switch active A/B Experiment;
- modify one branch independently;
- preserve semantic parent/baseline identity and ancestry without hard-coding storage to only A and B;
- restore either branch;
- Compare toggle/view;
- Changed / Unchanged semantic summary;
- Comparison Clarity;
- key metric difference summary;
- explicit seed relationship;
- comparison state available to Agent inspection;
- manual Repeat entry point, even if repeated-trial visualization remains minimal initially.

### Acceptance scenario

Starting from one linear-regression World, a learner can use only visible UI to Duplicate it, change only the x-location pattern in B, switch between A and B, Compare them, and see exactly what changed and what remained constant.

The same semantic comparison is inspectable by the Agent, but no Agent is required to create it.

---

## Phase 3 - World Builder generators

### Goal

Complement freehand data drawing with reproducible parameterized Worlds.

### Initial scope

- uniform x;
- Gaussian-like x cloud;
- two-cluster x distribution;
- linear relation with slope/bias;
- sample count;
- noise amount;
- outlier injection;
- seed/regenerate;
- separate train/test World configuration;
- clear generated-vs-manual provenance;
- generated samples remain inspectable/editable;
- compose initial presets from explicit input, latent-relation, observation-noise, anomaly, coverage, and train/test primitives where the accepted vertical slice needs them.

### Acceptance scenarios

1. Re-running the same World specification and seed reproduces identical points.
2. Changing only x sampling while holding relation/noise fixed is visible in Compare View.
3. A manually created user can build the same class of comparison the Agent can request.
4. Agent-created parameterized Worlds remain editable/inspectable by the learner.
5. The UI clearly distinguishes generated samples from manually drawn samples and from the generator specification.

---

## Phase 4 - Manual and Guided Exploration UX

### Goal

Make VOLK-ML a complete exploration environment without Agent assistance.

### Scope

- Free Explore surface remains uncluttered;
- deterministic Observation Detection;
- first-class raw and derived observables shared by learner UI, Guided Explore, and Agent inspection;
- optional Things to Try prompts;
- experiment recipes;
- affordance guidance/highlighting;
- Comparison Clarity feedback;
- Repeat workflow with bounded repeated-trial evidence;
- lightweight factual notices;
- no external AI requirement.

### Acceptance scenarios

A learner can, without an Agent:

- discover how to add an outlier and compare its effect;
- create train/test shift;
- compare two data distributions;
- repeat a stochastic experiment;
- notice when a comparison changes multiple factors;
- follow an optional recipe and then diverge from it freely.

---

## Phase 5 - Exploration Agent learner mode

### Goal

Make natural-language curiosity an optional accelerator for the existing manual experiment system.

### Scope

- simplified learner-facing prompt;
- hide plan/script/fidelity internals by default;
- interpret common exploration goals into shared World/Experiment operations;
- discover available interventions, constraints, observables, execution operations, and resource limits from registered capabilities;
- represent controlled proposals as Scenario specifications grounded in `change` / `hold` semantics;
- report exact, partial, or approximate Scenario Fidelity with missing aspects disclosed;
- experiment proposals with visible change summaries;
- Agent mutation diff;
- optional prediction prompt;
- run and evidence highlight;
- grounded follow-up experiment suggestions;
- restrained initiative rules;
- retain advanced inspection mode for developers and power users.

### Acceptance scenarios

The following requests should lead to useful, inspectable experiments rather than generic explanations:

- "What happens if I add some outliers?"
- "Make the test data different from training data."
- "Try linear regression on two different distributions."
- "Make this dataset harder without changing the model."
- "Why did the line move so much after I added that point?"

The Agent must not silently change multiple causal factors when proposing a one-factor comparison.

The Agent must not gain scenario capabilities solely through model-specific prompt branches. If a capability cannot be discovered or invoked through the shared semantic layer, it is not yet an Agent-supported exploration operation.

Every resulting Experiment must remain manually inspectable, editable, comparable, and reversible through the normal product UI where practical.

---

## Phase 6 - Hypothesis, observation, and exploration threads

### Goal

Preserve the learner's reasoning path without imposing a rigid course.

### Scope

- optional hypothesis/prediction;
- Experiment link(s);
- concise observation capture;
- follow-up question;
- lightweight thread/history view;
- resume exploration from a previous branch.

### Acceptance scenario

A learner can return to an exploration and understand what question they asked, what two Experiments were compared, what they predicted, what evidence appeared, and what question came next.

---

## Phase 7 - Big-Idea exploration entrances

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

A learner can enter "Distribution Shift" without first selecting an algorithm chapter and immediately manipulate train/test Worlds in a meaningful experiment, with or without an Agent.

---

## Phase 8 - Training Microscope

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

A learner who sees unexpected training behavior can inspect the actual runtime trace and understand which parameter update or preprocessing step produced the visible change.

---

## Phase 9 - Extend the exploration model beyond 2D tabular Worlds

Only after the core loop works well should VOLK-ML aggressively expand the same exploration grammar to:

- CNN/image Worlds;
- sequence Worlds;
- attention/Transformer Worlds;
- embeddings/vector search;
- RAG;
- agent planning/tool-use.

The goal is not merely to add new components. Each new domain should answer:

1. What is the manipulable World?
2. What is the Model's inductive bias?
3. What can the learner change manually?
4. What evidence becomes visible?
5. What controlled comparisons become possible?
6. What can Guided Explore scaffold without AI?
7. What can the Agent safely accelerate?

### Phase 9 status — bounded cross-domain exploration slice

Phase 9 is implemented as one shared-runtime vertical slice for deterministic
Image/CNN, Sequence/attention, Embeddings/vector retrieval, and grounded RAG.
Each domain has finite bounded data, domain-native primitives, truthful
observables/traces, manual controls, and capability metadata. A small
cross-domain Agent planner can navigate representation depth or propose one
supported model-control experiment through the existing ScenarioSpec,
preflight, fidelity, and explicit-execution path. The provider context remains
bounded and payload-safe, and the async runner is a seam rather than an
artificial loading implementation.

The slice does not claim remote inference, pretrained semantic embeddings, a
general Transformer/CNN framework, or a full visual Composer. Those are
implementation limits of this bounded Phase 9 foundation, not alternate
runtime semantics. See `docs/architecture/phase9-cross-domain.md`.

## Later infrastructure after the core loop is proven

Once controlled comparison, bounded Repeat, deterministic observables, and capability discovery work in the 2D wedge, later cycles may add:

- richer ScenarioSpec composition across registered capabilities;
- repeat aggregation and evidence views beyond the initial bounded workflow;
- bounded parameter sweeps;
- deeper experiment graphs and branch navigation;
- cross-domain World composition for sequence, image, representation, and agent/tool-use scenarios.

These are dependency directions, not permission to broaden an earlier phase. Each must enter through a separately accepted learner-facing vertical slice.

---

# Priority summary

## P0 - Complete the human exploration loop

1. World semantic contract.
2. Shared domain operations.
3. 2D Data Workspace.
4. Train/Test World layers.
5. Undo/Reset action semantics.
6. Experiment Bar.
7. Experiment snapshot/Duplicate.
8. A/B Compare.
9. Changed / Unchanged semantic diff.
10. Comparison Clarity.
11. Manual Repeat entry point.
12. Agent-readable/mutable World and Experiment state through the same semantics.

The Agent learner experience is **not** a prerequisite for P0 success.

## P1 - Make exploration self-guiding and durable

1. Deterministic Observation Detection.
2. Things to Try prompts.
3. Experiment recipes.
4. Guided Explore affordance highlighting.
5. Repeat evidence/uncertainty visualization.
6. Hypothesis/prediction.
7. Observation.
8. New-question branching.
9. Exploration history.
10. Big-Idea entrances.
11. Hidden-mechanism inspection.

## P2 - Add Agent acceleration and internal-learning explanation

1. Learner-facing Agent exploration flow.
2. Agent semantic mutation diff.
3. Agent initiative rules.
4. Training Microscope.
5. Parameter trajectory.
6. Gradient visualization.
7. Loss landscape where truthful and useful.
8. Neural node/activation probes.

## P3 - Expand domains

1. image/CNN;
2. sequence;
3. attention/Transformer;
4. vector search/RAG;
5. agent planning.

Do not allow P3 breadth or Agent polish to displace P0 human exploration foundations unless a separate user-approved priority change is made.

---

# Product evaluation questions

Feature acceptance is necessary but not sufficient. Periodically evaluate whether the product actually encourages exploration.

Useful qualitative/product questions include:

- Can a first-time learner create a custom Experiment quickly without documentation?
- Can they preserve a state and try a variation without understanding snapshot/version terminology?
- Do they notice what changed between A and B?
- Do they run a second Experiment after seeing the first result?
- Can they complete the north-star distribution experiment with Agent features disabled?
- Does Guided Explore help without feeling like a mandatory lesson?
- Does the Agent produce more experimentation rather than more passive reading?
- Can a learner inspect and manually modify everything important the Agent changed?

Avoid optimizing only for lesson completion or number of Agent messages.

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
- an Agent-dependent application that becomes incomplete without an AI provider;
- a hidden system where Agent-generated changes cannot be inspected or reproduced;
- a Git-like experiment version-control interface for beginners;
- a general-purpose Scenario Engine framework built before the 2D exploration contracts prove their value;
- a formal constraint editor or parameter-sweep UI in the early Workspace phases.

---

# Architectural guidance for Codex

## Reuse current playground architecture

Before implementing exploration features, inspect the active playground architecture and reuse the unified runtime, semantic state, visualization scripts, trace contracts, TeachingPlan/composer pipeline, and Canvas Agent API where they genuinely fit.

Do not create a second independent state machine for the 2D Workspace if the existing runtime can be extended with a clean World contract.

Do not force World semantics into unrelated model controls merely to reuse `compare-control` machinery. Extend the abstraction when the domain concept is genuinely different.

## Domain operations first, adapters second

Design the semantic capability before designing separate Agent and UI shortcuts.

A healthy direction is:

```text
Domain operation
  -> human interaction adapter
  -> Agent interaction adapter
  -> deterministic validation / trace
```

Do not make DOM manipulation the Agent API. Do not make TeachingPlan the human UI model.

## Finite primitives, composable scenarios

Prefer a finite registry of semantically rich World, intervention, constraint, observable, and execution capabilities over hard-coded teaching scenarios. Human UI, Guided Explore, and Agent planning should compose the same capabilities at different levels of assistance.

The conceptual architecture may be reasoned about as Scenario, World, Experiment, and Observation engines with visualization adapters, but these are responsibility boundaries rather than a requirement for separate services, reducers, or premature framework modules. Add abstractions only when a validated vertical slice needs them.

Visualization should consume semantic state and map learner interactions back to domain operations. Neither the Agent nor comparison logic should reason from pixels or DOM structure when semantic evidence exists.

## Controlled changes and inspectability

Material experimental causes should be inspectable somewhere through progressive disclosure: World rules, observation process, data and membership, model, preprocessing, learning, evaluation, randomness, ancestry, action history, and Scenario Fidelity. This does not mean exposing every field in the default view.

For controlled comparisons, validate intended `change` and `hold` conditions before execution where practical. Do not hide confounds, and do not let a Changed / Unchanged summary claim one-factor clarity when the semantic diff shows otherwise.

## Keep UI and Agent operations aligned

A point added by the Agent and a point added by the user should pass through the same semantic mutation rules.

A World generated through an Agent request should be inspectable, editable, serializable, and testable through the same public contracts as a manually created World.

## Manual parity is an acceptance check

For every new core Agent experiment operation, answer:

> **Can a learner perform the same meaningful experiment without the Agent?**

If not, document why. Prefer adding or improving the manual domain affordance before expanding Agent-only behavior.

Do not interpret this as a requirement that every bulk Agent command needs an equally fast manual gesture. The requirement is semantic accessibility, not identical interaction cost.

## Experiment Bar is a product surface, not an internal debug view

Do not expose capture IDs, raw snapshots, planner state, or script provenance as the default Experiment Bar vocabulary.

The Experiment Bar should speak in human concepts:

- Original;
- Copy / Duplicate;
- active Experiment;
- Compare;
- Changed;
- Repeat.

Advanced/internal metadata may remain inspectable elsewhere.

## Persistence requires deliberate versioning

If World, Experiment, Experiment Bar state, or Exploration Thread state enters project JSON:

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
- duplicate Experiment before mutation -> semantically equal conditions;
- one-factor comparison -> exactly the declared factor differs;
- train/test point membership survives snapshot/restore;
- a brush gesture groups its point mutations into one human action;
- Agent mutation respects point/resource caps;
- Agent and manual mutations pass through the same semantic validation;
- Sample World never acquires generator claims without an explicit conversion;
- Comparison Clarity reflects semantic differences rather than raw incidental state;
- view transforms do not mutate World coordinates.
- latent World rules remain unchanged when only the observation process is intervened on;
- declared `hold` constraints reject conflicting operations;
- A/B branches are isolated and retain parent/baseline ancestry;
- one gesture or accepted Agent proposal produces one grouped semantic action;
- Repeat uses explicit seeds, preserves the Scenario, aggregates declared observables, and enforces limits;
- capability discovery exposes registered interventions and observables without model-specific Agent branches;
- exact, partial, and approximate Scenario Fidelity never hide missing requested aspects.

## Resource safety

Agent and UI generation paths must share hard limits. Validate limits before expanding large generated point sets or visualization scripts.

## Accessibility is part of acceptance

Do not treat keyboard/touch/non-drag access as a final polish phase for the Data Workspace or Experiment Bar. Primary exploration must remain possible without precise mouse-only dragging.

---

# Codex execution protocol

This roadmap does not override `AGENTS.md` or `docs/development-workflow.md`. It adds product direction and phase dependencies.

For each implementation cycle:

1. **Read only the relevant architecture docs and current code.** Code remains the source of truth.
2. **State the selected roadmap slice.** Do not silently combine multiple phases.
3. **Design before development.** Define goal, scope, data/semantic contract, human UX behavior, Agent implications if any, acceptance criteria, and exact tests.
4. **Check the no-Agent journey.** For a core exploration feature, state how a learner uses it manually before adding Agent shortcuts.
5. **Get user agreement before executable-code changes**, as required by the repository workflow.
6. **Implement one coherent vertical slice.** Prefer a small end-to-end learner capability over broad scaffolding with no usable surface.
7. **Keep Agent, UI, and runtime semantics aligned.** Avoid temporary duplicate behavior unless explicitly accepted.
8. **Run focused tests plus applicable `npm run check`, `npm run build`, and `git diff --check`.**
9. **Report acceptance criterion by criterion.** Include limitations and deferred items.
10. **Update relevant architecture documentation when contracts change.**
11. **Append the accepted change set to `CHANGELOG.md` before opening a pull request.**

When a proposed task conflicts with this roadmap, do not automatically reject it. Identify the conflict explicitly and ask whether priorities have changed when that difference is material.

---

# North-star acceptance journeys

The exploration layer should have both a complete manual journey and an Agent-accelerated journey.

## Manual north-star journey

The manual Lab is successful when the following feels natural without documentation or Agent configuration:

1. The learner watches a short video framing a model as a way to search for patterns.
2. They open VOLK-ML and draw an approximately linear set of points.
3. They fit Linear Regression and see the model's interpretation.
4. They add or spray a second cluster and observe the fit change.
5. They use the Experiment Bar to preserve the original state.
6. They Duplicate A into B.
7. They change B's input distribution while keeping the model the same.
8. Changed / Unchanged shows what differs.
9. Comparison Clarity indicates whether the comparison isolates one factor.
10. They predict what will happen if they choose to record a hypothesis.
11. They run/fit both Experiments.
12. Compare View shows the two Worlds, metrics, what changed, and what stayed constant.
13. A deterministic Observation notice points out a meaningful evidence difference without asserting a cause.
14. The learner decides what to change next.
15. They optionally Repeat to see whether the result is stable across randomness.
16. They can undo a manipulation and continue exploring.

No Agent, API key, TeachingPlan, Visualization Script, fidelity panel, or internal provenance vocabulary is required.

## Agent-accelerated north-star journey

The optional Agent adds a natural-language path on top of the same Lab:

1. The learner asks: "What if the data distribution changes?"
2. The Agent distinguishes a few meaningful interpretations and proposes one controlled Experiment.
3. The proposal is expressed as the same A/B structure used by the Experiment Bar.
4. The Agent shows exactly what it intends to change.
5. The learner runs or accepts the experiment.
6. The Agent mutation appears in Changed / Unchanged and can be manually inspected.
7. Compare View and deterministic evidence are the same evidence available without the Agent.
8. The Agent points to that evidence and suggests a follow-up rather than replacing the experiment with a lecture.
9. The learner can ignore the Agent and continue manually at any point.

At no point should the learner need to understand internal planner/script/fidelity terminology in order to complete either journey.

## Long-term Scenario capability test

The infrastructure direction is successful when the same registered capabilities can eventually express this scenario without a model-specific hard-coded lesson:

1. Keep the true linear relation and model fixed.
2. Restrict training observations to a sparse middle region.
3. Place part of the test distribution outside observed training coverage.
4. Add outliers to training only.
5. Compare the result with a baseline while showing every changed and held condition.
6. Repeat across explicit seeds.
7. Observe slope stability, train/test error, generalization gap, coverage mismatch, and repeat variation.
8. Continue by changing one additional factor or branching from either Experiment.

The learner may construct this through direct manipulation, Guided Explore, or an Agent proposal. All three paths must resolve to the same inspectable World interventions, constraints, experiment lineage, observables, and execution semantics. This is a long-term architecture test, not an early-phase acceptance requirement.

---

# Product identity

The intended direction can be summarized as:

> **VOLK-ML is a visual experiment lab for building machine-learning intuition.**
>
> Videos provide ways of seeing. The Lab provides Worlds to manipulate and experiments to compare. Guided Explore helps learners discover useful actions without AI. The Agent optionally helps turn curiosity into experiments.

The long-term differentiator is not the number of supported layers or frameworks. It is the ability to make abstract ML ideas physically explorable while preserving enough semantic rigor that the learner's conclusions remain trustworthy.

## Phase 10.1 — Curiosity Loop foundation

The first Phase 10 slice adds a bounded deterministic Curiosity projection on
top of the accepted Semantic Event and Learner Inquiry contracts. Curiosity
names an unresolved exploration opportunity; it is not a diagnosis of learner
confusion, knowledge, ability, or intent. The initial registry is limited to
single-factor mechanism questions, mixed-factor comparisons, distribution
shift questions, and repeat variation. Reflection questions and available
directions are localization-key and capability references, not generated
runtime operations. Goal 10.2 concept matching, Concept Card UI, adaptive
curriculum, learner profiles, and background AI remain deferred.
