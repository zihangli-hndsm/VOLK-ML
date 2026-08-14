# Phase 7: Big-Idea exploration entrances

Phase 7 adds a small concept-first launch surface to the Lab. It is additive:
the existing playground and model selectors remain available, while a learner
can also enter through Finding Patterns, Noise and Robustness, Generalization,
Distribution Shift, or Model Capacity.

## Contract and registry

`src/core/exploration/bigIdeaRegistry.js` owns the deterministic, JSON-safe
`BigIdeaEntrance` v1 declarations. Each declaration has localization keys, a
starting playground/model, an explicit seed, semantic setup actions, focused
observable IDs, affordances, and suggested actions. The registry validates
playgrounds, model adapters, controls, generator specs, World operations,
observables, and seed values during development/import.

The registry is product content, not a curriculum or an Agent-generated
catalog. React renders the registered declarations and does not contain
theme-specific execution branches.

## Initialization and provenance

`createPlaygroundHost.openBigIdeaEntrance()` validates a declaration, creates a
detached ordinary playground session, and applies its setup actions before
committing anything to the live host. A setup failure therefore leaves no
partially initialized learner session. The resulting runtime carries only
lightweight provenance (`id`, `version`, starter question key, and relevant
observable IDs); World, model, Experiment Workspace, and evidence remain the
authoritative state.

All generated starts use explicit seeds. Restart is an explicit fresh
initialization operation. The host never reapplies the defaults after the
learner changes a World, control, experiment, or comparison.

## Exploration modes and Threads

The entrance question is a visible, non-blocking invitation. The learner can
immediately use Free Explore, Guided Explore, World Builder, Run, Duplicate,
Compare, Repeat, and Evidence. Guidance remains optional and does not become a
step sequence.

An entrance does not create an Exploration Thread automatically. The learner
can choose `Keep this exploration`, which creates the normal Phase 6 Thread
with the entrance question and `big-idea:<id>` source on the Question entry.
Thread authority is unchanged: runtime supplies condition, experiment, and
evidence facts; learner text supplies questions, predictions, and notes.

The same provenance is exposed through `inspectContext().exploration.bigIdea`,
so an Agent can understand the conceptual starting point without receiving a
private execution path. Agent proposals still use the existing semantic
proposal, preflight, and explicit execution lifecycle. Opening and manually
using an entrance requires no AI provider.

## Starting verticals and limitations

Finding Patterns, Noise and Robustness, Generalization, and Distribution Shift
use the existing generated regression World and Linear Regression adapter.
Their train/test supports, noise, outliers, and observations are real World
semantics that remain editable in the ordinary Data Lab.

Distribution Shift is the primary acceptance vertical: its deterministic
start puts Train and Test in separated input ranges, making a Test support
intervention semantically visible before any model run.

Model Capacity uses the existing MLP XOR playground and its actual
`hiddenUnits` control. It does not introduce a fake capacity slider or a new
cross-adapter comparison system. The initial Phase 7 set intentionally does
not add a general scenario engine, recommendation system, curriculum state,
or language-to-catalog router.
