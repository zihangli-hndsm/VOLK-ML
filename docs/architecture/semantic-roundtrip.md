# E3 bounded semantic round-trip evaluation

E3 evaluates the existing local path from a canonical VOLK graph through the
canonical compiler, a real CPU `torch.export`, the existing metadata-only
extractor and B2 adapter, and back to a detached VOLK graph:

```text
canonical Graph A
  → E1 compiler source + manifest
  → E1 source/manifest re-materialization check
  → execute only that fresh canonical source in a bounded test worker
  → torch.export.export on CPU
  → existing extract_exported_program
  → strict TorchExportDocumentV1 / B2 validation
  → Graph B
  → bounded structural comparison
```

This is a **bounded structural semantic match**, not numerical or functional
equivalence. The extractor and B2 proposal intentionally do not carry trained
weight values; Graph B initializes its own layers. E3 therefore compares
topology, operations, constructor configuration, supported shape facts, and
dtype—not predictions, tensor values, training history, or loss equality.

## Comparison contract

The comparison is test-only and does not change `graphSemanticFingerprintV1`
or introduce another project/graph identity. Canonical graph fingerprints
continue to include node and edge IDs. For a cross-format comparison, E3 maps
the supported ordered chain to topological ordinals and compares:

- input/output arity, ordered operations, typed source/target handles, and
  ordinal edge endpoints;
- registered component operation identity and effective constructor
  parameters, including Dense `input_features`, `units`, and `use_bias`;
- rank and feature extents independently derived from Graph A and Graph B,
  checked against the actual ExportedProgram metadata;
- input, parameter, and exported intermediate dtypes as a separate metric.

Generated IDs and layout do not participate in this E3 comparison. They remain
part of the existing workspace identity/presentation contracts. E1 records the
full workspace and compiler-selected subgraph identities and explicitly lists
excluded workspace nodes. An orphan or unrelated model is not silently
claimed as round-tripped.

E3 accepts Softmax axes `1` and `-1` as the same last feature axis only after
the B2 rank-two condition is established. B2 materializes the canonical axis
as `-1`; this normalization does not apply to other ranks or axes.

## B2 boundary and known losses

The current B2 adapter accepts exactly one rank-two user tensor input, one user
output, and an ordered single-use chain containing at least one Linear. It
supports `aten.linear.default`, `aten.relu.default`, `aten.sigmoid.default`,
`aten.tanh.default`, and `aten.softmax.int`. It rejects unsupported dtypes,
operators, branching, shared parameter use, buffers/constants, multiple inputs
or outputs, non-rank-two tensors, and unbounded/unsupported batch shapes.

The VOLK Tensor Input represents the feature shape without a batch axis. The
Torch Export document may report either a static example batch or one bounded
symbolic batch, but Graph B does not store the batch extent/range. E3 reports
this as `batch_extent_and_range_not_carried`; feature-rank/extents may match
while full batch-shape preservation does not. E3 does not turn this into a
whole-shape PASS.

The architecture-only PyTorch compiler creates layers in PyTorch's default
dtype. A Tensor Input marked `float16` does not cause a compiler cast. In the
tested CPU environment, forwarding a float16 input into the generated default
float32 Linear fails; even where torch.export can describe the graph, strict
B2 validation rejects mismatched Linear input/parameter dtypes. Float32 is the
positive matrix. Float16 is an explicit negative/limitation; the test must not
cast the model or input to hide it.

An unknown or unsupported operation is never filtered out. A failed compiler,
runtime, extractor, or B2 stage is reported as unsupported/unverified with its
stage and bounded reason code; it is not a semantic match. Missing configured
Torch is not a skip or PASS.

## Worker authority and safety

`scripts/semantic-roundtrip-python-worker.py` is a private, test-only execution
helper—not a sandbox, product runtime, public API, H2 worker, or import route.
The Node runner first compiles Graph A and validates its E1 source manifest by
canonical re-materialization. It then sends only that fresh compiler output,
over stdin, with its source digest and bounded input-shape metadata. The worker
uses argument-vector process launch (no shell), fixed CPU execution, one Torch
thread, bounded graph/input dimensions and standard I/O, and a parent-enforced
wall timeout. It calls `torch.export.export` in memory and the existing
extractor. It does not load `.pt2`, pickle, files named by a caller, weights,
datasets, or edited/arbitrary source. The E2-edited text is parsed by E2 only;
after the existing C1 proposal and C2 commit helpers produce canonical Graph
A′, E3 recompiles and executes only A′'s fresh compiler source.

The E1 source digest is integrity evidence, not authentication. The worker is
trusted local test code and is not a general-purpose defense against hostile
Python. Its only non-canonical model profiles are fixed, named shared-parameter
and view test variants with exact request shapes; the request cannot supply
Python source for those variants. E3 adds no production execution authority,
Apply path, transport, service, IR, importer, UI, or Cloud dependency.

## Cases and reports

Real positive cases cover Linear with and without bias, Linear-ReLU-Linear,
Linear-Sigmoid, Linear-Tanh, Softmax `-1` and `1`, mixed allowed operators,
multiple feature widths, and bounded dynamic batch. ID/layout renaming and an
E1-selected graph with an excluded orphan verify normalization and scope.

The negative matrix covers GELU/other unsupported ATen targets, Conv2D and
rank-four tensors, Flatten/Reshape/view, branched Add, multiple inputs/outputs,
shared parameters, incompatible Dense dimensions, unsupported batch/shape
forms, and float16 mismatch. Canonical registered Flatten and Reshape graphs
are compiled through E1. The Flatten case reaches strict B2 validation with
`aten.flatten.using_ints` and is rejected as
`TORCH_EXPORT_OPERATOR_UNSUPPORTED`. The static-batch Reshape case proves real
`aten.reshape.default` export; the existing extractor rejects its shape-list
argument with the exact `E3_EXTRACTOR_ARGUMENT_UNSUPPORTED` code. VOLK has no
registered view component, so a fixed `trusted-view-test-model` emits
`aten.view.default` and reaches the same exact extractor boundary. That case is
labelled as a test-model variant, never as Graph A coverage. Shared parameter
use likewise uses a separately labelled trusted variant. Deterministic
comparator controls independently mutate operation semantics, Dense
width/bias, feature shape, dtype, connectivity/typed handles, output arity,
unknown operations, cycles, disconnected structures, and bounds. Disconnected
structure and output arity each assert `E3_TOPOLOGY_UNSUPPORTED`; all controls
assert their exact reason/status so unobserved facts cannot match vacuously.

The versioned report records the base revision, Python/Torch CPU versions,
case IDs, E1 workspace/selection/source fingerprints, ExportedProgram document
fingerprints, B2 proposal IDs, per-metric results, timings, exits/rejection
stage, and declared losses. It contains no generated source, dataset rows,
credentials, weights, model files, or numerical outputs.

## Checks

`npm run check:semantic-roundtrip` runs the deterministic comparator suite and
is included in the normal `npm run check` precheck. The real-runtime command
requires an already-installed CPU PyTorch interpreter and an existing temp
directory. For this workstation, point temporary files to D: because C: is
space-constrained:

```powershell
$env:VOLK_E3_PYTHON = 'C:\Users\Administrator\AppData\Local\VOLK\venvs\torch-export-b2\Scripts\python.exe'
$env:VOLK_E3_TMPDIR = 'D:\volk-e3-semantic-roundtrip'
New-Item -ItemType Directory -Path $env:VOLK_E3_TMPDIR -Force | Out-Null
npm run test:semantic-roundtrip:torch
```

The explicit runtime command fails if the configured interpreter/Torch is
missing; it never installs dependencies. E3 acceptance also runs E1/E2/B2
focused checks, the configured real extractor check, full `npm run check`,
`npm run build`, `git diff --check`, and the affected E2/B2/B1/C2/D1/D2
browser suites. Those browser suites remain the authority/Apply regression;
E3 makes no browser or learner-surface change.
