# World Composer v1

World Composer adds a bounded semantic grammar for deterministic finite Worlds.
It is a domain capability used by humans and the Exploration Agent; it is not
a second World state machine and it does not execute model-specific code.

## Contract

`src/core/exploration/worldRecipe.js` owns the versioned, JSON-safe
`WorldRecipe` contract. A recipe contains a task, 2D coordinate space, stable
group IDs, primitive shape parameters, transforms, train/test sampling, and
separate position noise, label noise, outliers, and local noise rules. V1
supports blob, line, arc, ring, moon, spiral, rectangle, ellipse, polygon, and
polyline. Presets are compiled into this same contract.

The recipe deliberately does not contain a random seed. The existing World
`randomness.seed` / generator seed remains the single seed authority. A
recipe plus seed is the deterministic realization identity.

## Materialization

`worldMaterializer.js` validates and materializes a recipe into ordinary finite
World observations. Transform order is scale, rotate, then translate. Split
transforms are applied after the common group transform. Geometry, position
noise, label noise, and outlier decisions use stable scoped substreams derived
from seed, World ID, group ID, split, purpose, and sample index. This lets an
unchanged group keep its realization when another group is edited.

Sampling density is a separate semantic field. `uniform`, `center-heavy`, and
`edge-heavy` are interpreted over the primitive's domain (radial for filled
blobs/ellipses, x-axis for filled rectangles, and path position for paths).
Gradient density is explicit about its `x` or `path` axis; unsupported
shape/axis combinations are rejected instead of silently changing geometry.
Path density means normalized geometric arc length, not an arbitrary primitive
parameter. Ellipse outlines, spirals, and moons use deterministic 256-sample
arc-length lookup tables; the crescent moon is the connected boundary made by
the intersecting outer and inner circles, with `u` selecting boundary length
and `v` supplying bounded normal thickness. Non-intersecting moon circles are
invalid. Filled polygons are sampled from a deterministic ear-clipped triangulation, so all samples are interior points. Self-intersecting polygons are invalid.

Every generated observation keeps bounded generation metadata including recipe
version, group ID, shape type, sample index, split, noise flags, and anomaly.
There is no `Math.random`, dynamic code, `eval`, or user-supplied expression
execution in the materializer. Function curves and arbitrary mathematical ASTs
remain future work.

## Runtime and compatibility

The existing generator is represented as `kind: "legacy-generator"`; old
serialized generator objects without `kind` are normalized to that kind. World
Composer uses `kind: "world-recipe"`. Both retain the configured/draft,
generated/clean, dirty, modified, realization, freeze, and seed lifecycle.

`SET_WORLD_RECIPE` and `PATCH_WORLD_RECIPE` are registered public World
operations. They use the same atomic World transaction, inverse/restore,
history, Agent preflight, and human dispatch boundaries as legacy generator and
point operations. Recipe edits change the desired recipe and preserve the
displayed realization until `REGENERATE_WORLD` is explicitly applied.

Recipe patches have a strict versioned schema and bounded numeric validator.
Unknown fields, non-finite values, out-of-range values, unknown groups, and
unsupported patch combinations fail before materialization; values are never
silently coerced or clamped. Transform patches may target `all`, `train`, or
`test`; split-specific transforms are represented in
`group.splitTransforms` and remain visible to comparison.
The provider JSON schemas reuse the same numeric bounds and strict density
variants as the local validator. Scenario validation derives exact expected
recipe paths from the normalized recipe plus the validated patch; a caller
cannot replace that contract with a fabricated path list.

The current conservative limits include 20 coordinate units, 10 scale units,
20 radius units, 10 thickness units, 20 spiral turns, 5 position-noise units,
30 outlier-distance units, 10 density-weight units, 16 groups, 500 points per
group/split, 5,000 total observations, 16 local-noise rules per split, and 32
patch changes. These are resource and numerical-safety bounds, not a second
normalization layer.

Existing legacy World Builder controls remain unchanged. Recipe Worlds show a
localized bounded summary with regenerate/freeze actions rather than pretending
that legacy controls edit a richer recipe.

## Comparison and Agent

Existing comparison top-level factors remain authoritative. Recipe-aware detail
is exposed as `comparison.details.worldRecipe`, with changed paths, unchanged
paths, affected group IDs, and changed splits. Scenario fidelity maps recipe
designs to the existing `world` factor and checks actual normalized recipe
paths against declared semantic domains. A whole-recipe create explicitly
declares `whole-recipe`; an edit declares only the domains represented by its
validated patch and records the exact normalized changed paths. Exact-path
comparison is the final fidelity boundary: an extra group, split, property, or
component path, or a missing expected path, becomes partial fidelity rather
than being hidden by a coarse domain or natural-language hold claim.
`World.task` describes the current materialized realization. Configuring a
different desired recipe leaves the existing task and observations unchanged
until regeneration; recipe regeneration atomically switches the task to the
recipe task, while legacy regeneration produces the legacy regression task.
Generated-world validation checks task against the current realization, not a
dirty future recipe. Detached preflight therefore rejects an attached adapter
that is incompatible with the regenerated task without mutating the live
session.

Agent interpretation may return only a bounded `world-design` outcome carrying
a validated recipe or recipe patch. The deterministic planner turns that into
`SET_WORLD_RECIPE`/`PATCH_WORLD_RECIPE` plus `REGENERATE_WORLD`, then uses the
normal detached preflight and explicit execution flow. The Agent never emits
raw observations or executable operations. The provider-facing context uses a
bounded recipe summary (group IDs, shapes, transforms, sampling, noise, and
counts) without observations or imported rows. Local fallback exposes
registered presets; unsupported designs remain clarification outcomes.

## Current limits

V1 bounds groups, points per polygon/polyline, samples, local-noise rules, and
patch changes. Local noise supports bounding boxes and circles; boundary-aware
noise is deferred. KNN supports the current classification World mutation
contract. MLP supports atomic World mutation for exactly two numeric features
and two classification labels, with both labels represented in Train; wider
feature spaces and multiclass MLP Worlds remain deferred. A full visual recipe
editor and safe function-curve AST are deferred.
