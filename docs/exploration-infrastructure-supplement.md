# VOLK-ML Exploration Infrastructure Supplement

## Purpose

> **Integration status:** The actionable direction in this supplement was selectively integrated into `docs/exploration-roadmap.md` on 2026-08-12. The roadmap is the authoritative implementation plan and phase boundary. This document remains a deeper design rationale; it is not a separate backlog, and any future conflict should be resolved in favor of the roadmap.

This document supplements `docs/exploration-roadmap.md` with a deeper infrastructure direction that emerged after the original exploration design.

The original roadmap established the learner-facing product model:

- 2D Data Workspace;
- World as a first-class concept;
- Experiment Bar;
- Duplicate / Compare / Repeat;
- Free, Guided, and Agent Explore;
- Changed / Unchanged;
- Comparison Clarity;
- deterministic Observation Detection;
- Agent as an optional exploration companion rather than a required tutor.

That design remains valid.

This supplement extends it with a stronger assumption:

> **If VOLK-ML wants to support genuine open-ended exploration, it cannot depend mainly on a growing list of predefined playground controls and scenarios. It needs a composable scenario infrastructure capable of turning many different learner intentions into inspectable experiments.**

The new target is not merely a better Playground runtime. It is the foundation of a **Scenario Engine**.

The long-term goal is:

```text
Learner imagination
  -> intent
  -> scenario specification
  -> world construction / intervention
  -> experiment execution
  -> observation
  -> new question
```

The Agent should not be the source of the world's capabilities. It should help users discover and combine capabilities already represented semantically by the system.

---

# 1. What changes relative to the original roadmap

The original roadmap primarily described **what the learner should be able to do**.

This supplement focuses on **what the infrastructure must be able to express** so those learner actions can scale beyond a small set of hard-coded examples.

The conceptual shift is:

```text
Original direction

World
+ Experiment
+ Compare
+ Guided Explore
+ Agent
```

becomes:

```text
Extended direction

Scenario
  -> World rules and state
  -> Intervention
  -> Constraints
  -> Observables
  -> Experiment branching / repeat / sweep
  -> Evidence
  -> Human / Guided / Agent interaction
```

The original concepts should not be removed. Instead:

- `World` becomes more structured;
- `Experiment` becomes part of a broader experimental engine;
- `Compare` becomes one operation over branches;
- `Repeat` becomes a real execution primitive rather than only a UI action;
- Guided Explore is grounded in declared affordances and observables;
- the Agent plans over semantic capabilities rather than model-specific prompts or DOM interactions.

---

# 2. Core design principle: finite primitives, open-ended scenarios

Do not try to predict every scenario a learner may want to explore.

A weak sandbox scales by adding presets:

```text
Gaussian
Bimodal
Outlier
Noise
Distribution Shift
XOR
Overfit Demo
...
```

This eventually becomes a hidden course menu.

A strong sandbox defines a small set of composable primitives that can produce scenarios the designers did not explicitly author.

The analogy is not "many premade levels" but:

```text
blocks
+ rules
+ transformations
+ composition
```

For VOLK-ML, the important primitives are likely to include:

- World state;
- latent rules;
- observation process;
- generators;
- interventions;
- constraints;
- observables;
- experiment branches;
- repeats;
- parameter sweeps;
- semantic history.

The Agent's creativity should come from **composing valid primitives**, not from inventing unsupported behavior in natural language.

---

# 3. World should separate State, Rules, and Interventions

The original roadmap treats `World` as the data-generating or observation environment. Keep that definition, but refine its internal semantics.

A World should conceptually distinguish at least three things.

## 3.1 State

What currently exists.

Examples:

- the current 2D samples;
- current train/test membership;
- current class labels;
- current visible objects;
- current time step for a dynamic World.

For Linear Regression:

```text
State
- 100 observed points
- train/test membership
- current axis/domain metadata
```

## 3.2 Rules

What determines how the World behaves or generates observations.

Examples:

- `y = 2x + 1`;
- class determined by region;
- Gaussian observation noise;
- a background feature correlated with a class;
- sequence transition dynamics.

Rules are not necessarily visible to the learner by default.

## 3.3 Interventions

What can be deliberately changed.

Examples:

- add or remove points;
- move a cluster;
- increase noise;
- restrict observation coverage;
- shift only the test World;
- alter the underlying relation;
- relabel points;
- change the background correlation while preserving the object-label rule.

This separation matters because learners often express intent at this level:

> "Keep the real rule the same, but only let the model see a small part of the world."

That is naturally represented as:

```text
preserve latent rule
change observation process / coverage
```

rather than as an arbitrary collection of slider changes.

---

# 4. Distinguish latent world from observed world

The original Sample World / Pattern World distinction is important. Extend it into a more general pipeline:

```text
LATENT WORLD
what is actually true in the scenario

        ↓

OBSERVATION PROCESS
what can be sampled, measured, hidden, corrupted, or selected

        ↓

OBSERVED DATA
what the learner/model receives

        ↓

MODEL
what pattern the model can express

        ↓

LEARNING / EVALUATION
what happens from those observations
```

This structure supports many concepts with one abstraction:

- limited sampling;
- sampling bias;
- measurement noise;
- label noise;
- missing data;
- covariate shift;
- concept shift;
- shortcut learning;
- extrapolation;
- hidden confounding-like toy scenarios;
- train/test mismatch.

For example:

```text
Latent rule:
y = 2x + 1

Observation process:
training only samples x in [-1, 1]

Test process:
samples x in [2, 4]
```

The learner can then meaningfully ask whether the model learned a rule or merely behaved well where evidence existed.

A future UI may optionally expose a "Show hidden truth" or equivalent inspection mode, but the semantic distinction should exist before such UI is built.

---

# 5. Introduce a ScenarioSpec

The largest new abstraction proposed by this supplement is a semantic scenario specification.

A `ScenarioSpec` describes the experimental question in terms the runtime can validate.

Conceptually:

```text
ScenarioSpec

Baseline
Intervention(s)
Constraint(s)
Observable(s)
Randomness policy
Execution strategy
Comparison goal
Fidelity metadata
```

This does not need to be the exact implementation shape or public name. Codex should align it with existing Playground and TeachingPlan contracts where possible.

The important point is that the system gains a first-class representation for:

> **"Change X, keep Y fixed, observe Z."**

## Example

Learner intent:

> "What happens if training data becomes sparse, but the actual rule and model stay the same?"

Possible semantic scenario:

```text
Baseline:
- sample count = 100

Intervention:
- sample count -> 20

Hold constant:
- latent relation
- noise model
- model
- learning configuration

Observe:
- fitted slope
- train error
- test error
- variation across repeats
```

A ScenarioSpec becomes useful to:

- manual Guided Explore recipes;
- Agent-generated experiments;
- Compare validation;
- repeat and sweep execution;
- explanation grounding;
- future sharing and creator workflows.

---

# 6. Constraints must become a real infrastructure concept

The original roadmap already includes Changed / Unchanged and Comparison Clarity. The deeper infrastructure requirement is a constraint system.

Learners frequently express experiments with constraints:

- "Only change the test distribution."
- "Keep the model the same."
- "Make the problem harder without adding noise."
- "Use the same data and change only model capacity."

Represent this explicitly.

Conceptually:

```text
Change
- test distribution

Hold
- train World
- latent rule
- sample count
- model
- learning configuration
```

The scenario validator should be able to detect when a proposed operation violates a hold constraint.

Example:

```text
Requested:
hold sample count constant

Proposed intervention:
regenerate B with 200 samples instead of 100

Result:
scenario violates constraint
```

This is the infrastructure underneath:

- controlled experiments;
- Comparison Clarity;
- Agent reliability;
- trustworthy causal language.

The UI does not need to expose a formal constraint editor initially. Human-facing controls can remain simple while the semantic layer carries the constraint information.

---

# 7. Upgrade control metadata into exploration-variable metadata

The existing Playground control schema is useful for UI and teaching plans. Open-ended exploration requires richer semantic descriptions.

A variable should eventually be able to declare information such as:

```text
id: noiseAmount
role: world
meaning: observation uncertainty
interventionKind: continuous
preserves: latent relation
mayAffect:
- residual pattern
- fit stability
- train error
- test error
```

For learning rate:

```text
id: learningRate
role: learning
meaning: parameter-update step size
interventionKind: continuous
mayAffect:
- convergence speed
- stability
- loss trajectory
possible confounds:
- normalization
- optimizer choice
```

This metadata should not become verbose user-facing documentation by default.

Its purpose is to let the system answer questions such as:

- What can be changed here?
- Which change preserves the underlying rule?
- What can be held constant?
- What can be observed after this intervention?
- Is this operation appropriate for the learner's intent?

Do not hard-code all of this into Agent prompts when it can be expressed by the playground/domain schema.

---

# 8. Observables should become first-class semantic objects

The original roadmap includes metrics and Observation Detection. Extend this by formally distinguishing **what can be observed** from **what can be changed**.

Possible observables include:

```text
fit.slope
fit.intercept
train.error
test.error
prediction
residuals
parameterMovement
lossTrajectory
trainingStability
decisionBoundary
representation
coverage
predictionVariance
```

The exact observables depend on the Playground.

This allows the learner or Agent to ask:

> "What should we watch if we change this?"

without relying on generic chat reasoning.

## Observation levels

A useful long-term distinction is:

```text
Outcome observables
- accuracy
- MSE
- prediction

Model observables
- parameters
- decision boundary
- representation

Learning observables
- loss trajectory
- gradients
- update size
- divergence

World/evidence observables
- train/test coverage
- cluster separation
- sample count
- label/noise structure
```

This also provides a path from simple behavior-level exploration into the later Training Microscope.

---

# 9. Derived observables and evidence should be computed by the system

Many pedagogically useful observations are relations between raw values rather than raw runtime outputs.

Examples:

```text
generalizationGap
= testError - trainError
```

```text
outlierSensitivity
= |slopeAfter - slopeBefore|
```

```text
repeatStability
= variance across repeated trials
```

```text
coverageMismatch
= test regions with weak or absent train support
```

Use a layered evidence model:

```text
raw observables
  -> derived observables
  -> deterministic observation detectors
  -> learner-facing notices / Guided Explore / Agent reasoning
```

This reduces the amount of numerical and causal interpretation delegated to an LLM.

The Agent should consume evidence the Lab already knows how to compute where possible.

---

# 10. Experiment infrastructure should support a graph, even if the UI begins with A/B

The Experiment Bar should remain human-simple and A/B-first.

Do not change the initial UX into a complex branch tree.

However, the underlying experiment representation should avoid a hard-coded `experimentA` / `experimentB` architecture.

Exploration naturally branches:

```text
             Original
             /      \
       More noise   Less data
                      /    \
                 Bigger    Same
                 model     model
```

A useful long-term model is an `ExperimentGraph` or equivalent branch relationship where each experiment knows its parent/baseline and semantic change set.

The UI may expose only:

```text
A
B
```

until more complex navigation is genuinely needed.

This preserves simplicity while avoiding a future storage/runtime rewrite.

---

# 11. Store semantic actions, not only states

The original roadmap requires Undo and inspectable Agent mutations. The infrastructure should therefore preserve meaningful action history where practical.

A state snapshot can answer:

> "What is the world now?"

An action record can answer:

> "How did we get here?"

Illustrative action:

```text
Action:
add second cluster

Actor:
human

Domain:
world.train

Mutation:
24 points added by one spray gesture
```

Agent action:

```text
Action:
shift test support

Actor:
agent

Intent:
create a train/test distribution mismatch

Mutation:
test x-range [-1, 1] -> [2, 4]
```

Benefits:

- semantic Undo;
- experiment history;
- Agent intent inference;
- exploration-thread reconstruction;
- shareable scenario provenance;
- easier explanation of Changed / Unchanged.

Do not let this become a full event-sourcing rewrite unless the current architecture genuinely benefits from it. The first implementation may use lightweight grouped actions layered over snapshots.

---

# 12. Undo should operate on human-meaningful action boundaries

The original roadmap already states that one brush gesture should be one Undo action. Treat this as part of the semantic action model.

Examples:

```text
Undo: Draw linear band
Undo: Add second cluster
Undo: Move selected points
Undo: Agent shifted test World
```

not:

```text
Undo point #81
Undo point #80
Undo point #79
...
```

An Agent command that performs multiple low-level mutations should also normally produce one reversible high-level action when safe.

---

# 13. World generators should be composable

The original World Builder lists initial presets such as uniform, Gaussian-like, and two-cluster data. Keep those presets in the learner-facing UI.

Underneath, avoid making every useful scenario a separate handcrafted generator.

For 2D regression, a composable model might conceptually be:

```text
Input Generator
+
Latent Relation
+
Observation Noise
+
Anomaly Process
+
Sampling / Coverage
+
Train/Test Process
```

Example:

```text
Input:
two clusters

Relation:
linear

Noise:
higher on the right side

Anomalies:
5% outliers

Train sampling:
mostly left cluster

Test sampling:
both clusters
```

The Agent can construct this without requiring a hard-coded preset called something like:

`heteroscedastic-two-cluster-biased-train-test-demo`.

The visible UI may still offer only common presets and simple controls.

---

# 14. World composition should generalize beyond tabular 2D data

The 2D Workspace remains the correct first wedge.

The semantic infrastructure should not define `World == XY scatter`.

Different domains can compose different primitives.

## Regression

```text
Input generator
+ target relation
+ noise
+ sampling
```

## Classification

```text
spatial/input generator
+ class rule
+ label noise
+ sampling
```

## Sequence

```text
state-transition process
+ observation process
+ sequence length
+ noise / missingness
```

## Image shortcut-learning scenario

```text
object identity
+ background
+ transformation
+ object-label relationship
+ background-label relationship
```

Training World:

```text
background predicts label strongly
```

Test World:

```text
background correlation removed
```

This can produce a genuine shortcut-learning experiment using the same high-level Scenario grammar:

```text
change background-label relationship
hold object-label relationship constant
observe test behavior
```

This is why the Scenario layer should be domain-semantic rather than tied to one visualization.

---

# 15. Repeat should be a real Experiment Engine primitive

The original roadmap correctly makes Repeat a first-class manual action. Strengthen this requirement at the runtime level.

A repeated scenario should be expressible as:

```text
Scenario
  -> seeds / trials 1...N
  -> execute
  -> aggregate observables
```

Possible aggregate evidence:

- mean;
- variance;
- min/max or quantile range;
- distribution of fitted parameters;
- divergence rate;
- prediction stability.

The Agent should be able to respond to:

> "Maybe this happened by chance."

with:

> "Let's repeat the same setup."

without inventing a separate execution mechanism.

Repeat must remain bounded for browser safety.

---

# 16. Add Parameter Sweep as a future core primitive

Many learner questions are naturally continuous rather than A/B.

Examples:

- What happens as learning rate increases?
- Does sample size make the fitted slope more stable?
- How does noise affect generalization?
- When does model capacity begin to overfit?

Represent this as a bounded `Sweep` primitive rather than requiring dozens of manually duplicated branches.

Conceptually:

```text
Sweep

Variable:
learningRate

Range:
0.001 -> 1.0

Observe:
finalLoss
stability
convergenceSteps
```

or:

```text
Variable:
sampleCount

Values:
10, 20, 50, 100, 500

Observe:
fitVariance
```

Sweep is not required in the first Data Workspace release. The architecture should simply avoid making it difficult to add later.

---

# 17. Visualization should be an adapter over semantic state

The original roadmap begins with the 2D Workspace because it is the best first learner surface. Preserve that priority.

Long term:

```text
World / Experiment semantic state
          ↓
Visualization Adapter
```

Examples:

- regression -> scatter + fitted relation;
- classification -> points + decision boundary;
- optimization -> loss surface + parameter path;
- representation -> input space + hidden space;
- attention -> token relations;
- RAG -> query -> retrieval -> generation evidence.

The Agent should reason about semantic state and capabilities, not about pixels in the visualization.

Visualizations may expose additional interactions, but those interactions should map back to domain operations.

---

# 18. Capability discovery should replace Agent prompt memorization

As the sandbox grows, do not rely on one large Agent prompt that manually lists every supported action.

A Playground / Scenario environment should be able to expose something equivalent to:

```text
What can be changed?
What can be observed?
What constraints are supported?
What experiment operations are available?
What execution limits apply?
```

Illustrative capability response:

```text
World
- add / move / remove points
- set train/test membership
- change sampling generator
- change noise

Model
- fit
- predict
- inspect parameters

Experiment
- duplicate
- compare
- repeat

Observable
- slope
- MSE
- residuals
- train/test gap
```

The current control schemas, operation intents, semantic schemas, and Agent inspection contracts are likely useful foundations. Extend them rather than creating an unrelated discovery protocol.

This allows the Agent to plan from actual capabilities and makes new Playground features automatically discoverable when their contracts are registered.

---

# 19. Introduce Scenario Fidelity

The current playground architecture already treats fidelity and semantic correctness seriously. Extend that principle to generated scenarios.

Learner intent may be broader than the available sandbox.

Example:

> "Simulate realistic gradual distribution drift."

Suppose the system can only implement:

```text
Gaussian input mean moves from 0 to 3 over ten steps
```

The system should represent this as an approximation rather than silently claiming full fidelity.

Conceptually:

```text
Requested concept:
gradual distribution drift

Implemented scenario:
Gaussian mean shift over 10 steps

Fidelity:
partial / approximate

Missing aspects:
no change in variance, multimodality, or latent relation
```

Scenario fidelity is useful for:

- Agent honesty;
- educational correctness;
- Creator workflows;
- future domain expansion;
- preventing a toy simulation from being presented as a complete real-world model.

Reuse or align with existing fidelity terminology where possible instead of creating competing semantics.

---

# 20. Inspectable Everything principle

Any hidden mechanism that can materially change the interpretation of an experiment must be inspectable somewhere in the system.

This includes, as applicable:

```text
World rules
Observation process
Data
Train/test membership
Model
Parameters
Preprocessing
Learning configuration
Evaluation
Randomness
Experiment ancestry
Action history
Scenario fidelity
```

This does **not** mean all information should be visible by default.

Progressive disclosure still applies.

The principle is:

> **Important experimental causes may be hidden from the default view, but they must not be permanently inaccessible black boxes.**

This is especially important for normalization and other mechanisms that may change the meaning of a learner's experiment.

---

# 21. Intent-oriented assistance should be grounded in Scenario infrastructure

The current roadmap already establishes intent-oriented guidance. This supplement clarifies how it should scale.

The user says:

> "Make this harder without changing the model."

The Agent should not search an ad-hoc prompt library for a canned response.

It should reason over declared capabilities:

```text
Constraint:
hold model constant

Possible interventions:
- increase noise
- reduce samples
- create coverage gaps
- create train/test mismatch
- add outliers
```

Then propose one or more experiments depending on context.

The user says:

> "I want to know whether the model is learning the rule or just relying on where the data appeared."

The system can construct:

```text
preserve latent relation
change observation support
observe test behavior
compare against baseline
```

This is the intended relationship:

```text
Intent
  -> Scenario reasoning
  -> valid domain operations
  -> visible experiment
```

The Agent remains a guide and implementation assistant, not an evaluator that decides whether the learner is correct.

---

# 22. Updated long-term architecture direction

The following is a conceptual target, not a requirement to implement all layers immediately.

```text
                    SCENARIO ENGINE

Intent / Recipe / Manual action
          ↓
      ScenarioSpec
      ├── Baseline
      ├── Intervention(s)
      ├── Constraint(s)
      ├── Observable(s)
      ├── Randomness policy
      ├── Execution strategy
      └── Fidelity
          ↓

                    WORLD ENGINE
      ├── latent rules
      ├── observation process
      ├── generators
      ├── current state
      └── interventions
          ↓

                 EXPERIMENT ENGINE
      ├── snapshot / restore
      ├── branch
      ├── compare
      ├── repeat
      ├── sweep
      └── semantic action history
          ↓

                OBSERVATION ENGINE
      ├── raw observables
      ├── derived observables
      ├── aggregation
      └── deterministic detectors
          ↓

              VISUALIZATION ADAPTERS
          ↓

      Human UI / Guided Explore / Agent
```

Do not create these as separate services merely because the diagram separates concepts. They may be lightweight modules or extensions of existing playground contracts.

The architecture should remain proportional to the current product stage.

---

# 23. Integration guidance for the existing roadmap

Codex should integrate this supplement into `docs/exploration-roadmap.md` selectively rather than copying the whole document verbatim.

## Keep unchanged

The following original decisions remain strong and should stay central:

- exploration-first product identity;
- Video -> Lab -> optional Agent relationship;
- Free / Guided / Agent Explore;
- Agent optionality and manual parity;
- 2D Data Workspace as the first wedge;
- Experiment Bar as P0 human UX;
- A/B-first comparison UI;
- Changed / Unchanged;
- Comparison Clarity;
- deterministic Observation Detection;
- Progressive Disclosure;
- human-first manual interaction;
- Training Microscope later than the basic exploration loop.

## Strengthen / extend

The following original sections should eventually be upgraded:

### World

Extend from a mostly generator/sample abstraction to:

```text
State
Rules
Observation process
Interventions
```

with latent-vs-observed semantics.

### Experiment

Extend from snapshot/duplicate/compare into an underlying branch-capable Experiment representation with semantic actions.

Keep A/B as the initial UI.

### Repeat

Upgrade from UI behavior into a bounded runtime execution primitive with aggregate evidence.

### Observation Detection

Ground it in explicit Observables and Derived Observables.

### Agent

Add capability discovery, Scenario constraints, and Scenario fidelity. Avoid model-specific prompt logic where schema-level semantics can express the capability.

## Add new conceptual sections

The main roadmap should eventually include concise sections for:

- ScenarioSpec / scenario grammar;
- interventions and constraints;
- observables / derived observables;
- composable World generators;
- semantic action history;
- experiment branching infrastructure;
- parameter sweep as future infrastructure;
- capability discovery;
- Scenario Fidelity;
- latent World vs observation process.

## Do not prematurely expand Phase 1 scope

This supplement is a long-term infrastructure direction, not permission to implement all abstractions before the first useful vertical slice.

The first successful product experience is still:

```text
draw data
-> fit model
-> preserve baseline
-> duplicate
-> change something
-> compare
-> observe
```

The architecture should leave room for the Scenario Engine while the first releases stay concrete.

---

# 24. Suggested roadmap phase adjustments

The existing phases can remain broadly intact with several infrastructure additions.

## Phase 0 - Exploration foundation

Add design decisions for:

- World `State / Rules / Intervention` semantics;
- latent vs observed state where relevant;
- semantic operation registry;
- minimal constraint representation;
- observable declaration;
- branch-capable Experiment identity;
- grouped semantic actions;
- capability inspection.

Do not implement a general Scenario Engine framework before proving the minimal contracts required by the 2D vertical slice.

## Phase 1 - 2D Data Workspace

Use manual interactions to validate domain operations and action grouping.

## Phase 2 - Experiment Bar / Compare

Use semantic experiment ancestry and diffing rather than A/B-specific storage if practical.

## Phase 3 - World Builder

Prefer composable generator primitives underneath simple learner-facing presets.

## Phase 4 - Manual / Guided Explore

Introduce declared observables, derived evidence, and deterministic observation rules.

## Phase 5 - Agent Explore

Introduce Scenario planning over capabilities and constraints instead of expanding a library of bespoke prompts.

## Later infrastructure

Add Repeat aggregation, Sweep, richer ScenarioSpec, and cross-domain World composition as actual learner use cases demand them.

---

# 25. Validation principles for this infrastructure

When these concepts enter implementation, favor semantic contract tests.

Examples:

### World

- changing observed sampling can preserve the latent relation;
- changing latent relation is distinguishable from changing observed samples;
- view transforms do not mutate World state.

### Constraints

- a `hold model` scenario rejects or flags a model mutation;
- a one-factor comparison reports exactly one semantic difference.

### Experiment graph

- Duplicate creates a child with equivalent initial semantics;
- later mutations do not alter its baseline parent;
- ancestry survives snapshot/restore/persistence if persisted.

### Actions

- one brush gesture becomes one grouped semantic action;
- one multi-step Agent intervention can be undone as one meaningful action when safe.

### Repeat

- same explicit trial seeds reproduce results;
- aggregate evidence is derived from the declared trials;
- browser limits are enforced before execution.

### Capability discovery

- Agent-visible capabilities are generated from actual registered semantics;
- unsupported interventions cannot be presented as executable without fidelity/approximation handling.

### Scenario fidelity

- an approximate implementation cannot be reported as exact;
- fidelity metadata is inspectable by advanced UI/Agent explanation.

---

# 26. Anti-patterns

Avoid the following shortcuts as the exploration layer grows.

## Hard-coded teaching scenarios everywhere

Do not solve every new concept by adding another dedicated scenario with custom state and Agent prompts.

## Agent-only capabilities

Do not let natural language become the only way to produce useful experimental states.

## DOM-level Agent automation

Do not make pointer/click simulation the semantic control plane.

## Raw-control-only planning

Do not require Agent logic to infer pedagogy from names like `slider3` or even only `learningRate`. Add semantic roles where useful.

## A/B hard-coded into storage

A/B is a UI model, not necessarily the complete long-term data model.

## Hidden confounds

Do not let a comparison silently change seed, sample count, preprocessing, or another material factor while presenting itself as a one-factor experiment.

## LLM-computed evidence when deterministic evidence exists

Do not ask the Agent to visually guess or numerically reconstruct things the runtime can calculate.

## Premature general framework work

Do not spend months implementing abstract Scenario infrastructure before it is exercised by real learner-facing vertical slices.

The desired pattern is:

```text
concrete learner need
-> minimal semantic abstraction
-> reusable contract
-> next learner need
-> generalize carefully
```

---

# 27. North-star scenario capability test

A useful long-term test for the infrastructure is whether the system can support the following without a custom one-off implementation for each request:

> "Keep the true linear relationship and the model the same. Make training data sparse in the middle, move test data partly outside the observed region, add a few outliers only to training, and compare this with the original setup. Then repeat both experiments several times and show me whether the fitted slope and test error are stable."

The system should be able to decompose this into:

```text
Baseline
- original World / Model

Constraints
- hold latent relation
- hold model

Interventions
- modify train sampling coverage
- modify test sampling support
- inject train-only outliers

Observables
- fitted slope
- test error
- coverage mismatch

Execution
- branch from baseline
- compare
- repeat N bounded trials

Evidence
- semantic differences
- aggregate stability
```

The Agent may help the learner construct this scenario, but the underlying capabilities must exist independently of the Agent.

---

# 28. Long-term product implication

The original exploration roadmap describes VOLK-ML as a visual experiment lab for building machine-learning intuition.

This supplement adds a deeper infrastructure hypothesis:

> **The long-term reusable asset may be a general guided-inquiry runtime: a system that can represent a manipulable world, express interventions and constraints, run controlled experiments, expose evidence, and let humans or agents turn curiosity into further experiments.**

VOLK-ML should validate this idea first in machine learning, where the Worlds are cheap to simulate and abstract ideas are especially suitable for visualization.

Do not broaden the product prematurely. But when making architecture choices, prefer designs that preserve the possibility that the same scenario grammar could later support other experiment-friendly domains such as statistics, optimization, physics, or algorithmic systems.

The core product question remains simple:

> **Can the learner imagine a "what if" scenario, and can VOLK-ML help make that scenario concrete without taking ownership of the inquiry away from the learner?**
