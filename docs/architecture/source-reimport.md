# Controlled generated-source re-import (E2)

E2 supports a narrow offline round trip from a canonical VOLK PyTorch export to
a detached graph patch. It does not turn Python into an import format. The
learner may edit a generated source file, but only registered parameter values
and unambiguous references between existing typed ports can become a proposal.
No source is executed, imported, trained, or sent to a service.

```text
validated VOLK project + canonical E1 source manifest
              │
              ├─ fixed, bounded Python AST worker (parse only)
              ├─ canonical source/manifest rematerialization
              ├─ allowlisted parameter and reference edits
              └─ static shape guard
                           ↓
                detached C1 GraphPatchProposal
                           ↓
              D1 or D2 staging / C2 preview
                           ↓ explicit learner Apply
                current-project revalidation / commit
```

## Authority and supported edits

The project graph, registry, manifest, and current C1/C2 validators remain the
authority. The source manifest must rematerialize exactly from the current
project and the original generated source. The original AST is also bound back
to E1 node/edge origin spans. Rehashed or otherwise altered provenance does
not grant authority. E2 removes only AST source-location metadata when comparing
syntax, so comments and spacing do not create a graph proposal; changing a
module, scaffold, operation, input signature, or unsupported expression fails
closed.

Version 1 permits parameter changes for registered `Dense`, `Conv2D`,
`MaxPool2D`, `Softmax`, `Dropout`, `BatchNorm1D`, `BatchNorm2D`, and `LayerNorm`
constructors. Recurrent and attention layer definitions may pass through
unchanged but cannot be edited. Rewires must correspond to existing node
references with the same expression structure, and the replacement source must
have exactly one output compatible with the target input. Nodes cannot be
added or removed. TensorFlow, trainers/tabular pipelines, composites, unknown
operations, weights, imports, arbitrary Python, and source side effects are
not supported.

The static shape guard proves only the operations it understands. It reports
`proven-compatible` or `partially-proven`; a partially proven result is not a
claim that the model runs. Known contradictions are rejected. Execution, if
desired, remains a separate action through the regular learner-confirmed Run
path.

## Local worker and privacy bounds

`tools/source_reimport/parse_generated_pytorch.py` uses Python's standard
library parser in isolated mode (`-I -S`). The launcher uses a fixed script
path, argument-vector process creation, no shell, a sanitized environment, and
bounded stdin/stdout/stderr, AST nodes/depth, source size, and elapsed time.
The worker returns syntax structure only; it never evaluates the edited file.
Stable diagnostic codes are returned without echoing source, project rows, or
process output. Python is already a local prerequisite for this optional tool;
no package installation is performed. Missing Python leaves the application
and graph workflows unaffected.

The CLI rejects symbolic-link inputs, aliased inputs, output/input aliases,
existing output paths, malformed UTF-8, and over-bound files. A new proposal is
created exclusively and is never written over an existing path. A no-op does
not create an output file.

## Local use

First export both source and the E1 manifest from the same current graph through
D1 `exportGraph({ framework: 'pytorch', includeManifest: true })` or D2
`volk_export_graph`. Save the project JSON, exported source, and manifest. Make
the intended edits in a copy of the source, then run:

```text
npm run source:reimport -- --project project.volkml --original-source original.py --manifest manifest.json --edited-source edited.py --out proposal.json
```

The command is local and offline. It emits either a bounded C1 patch proposal or
a stable diagnostic. Submit that proposal through D1
`submitGraphPatchProposal` or D2 `volk_submit_graph_patch_proposal`. Staging is
preview-only; review the existing C2 diff and click its normal Apply control to
commit. Cancellation leaves the project unchanged. The CLI itself has no
mounted-workspace handle and cannot Apply.

Focused checks:

```text
npm run check:source-reimport
npm run test:source-reimport:browser
```

The browser acceptance runs a mounted local workspace through both D1 and D2,
checks that each proposal remains detached until the visible C2 Apply click,
and confirms that source handling does not invoke Run. Existing source export,
graph patch, B1, C2, D1, D2, Torch Export, and ONNX checks remain required.
