# Generated source provenance (E1)

`src/core/compiler.js` remains the single source compiler for both plain
PyTorch/TensorFlow exports and the opt-in provenance result. Compiler paths
assemble ordered source sections carrying ownership at emission time; the
plain API flattens those same sections into the established Python source.
`src/core/sourceMapWriter.js` records UTF-8 half-open byte spans and 1-based
line spans as it emits the sections. It does not infer ownership by searching
generated text.

## Contract and identities

The optional `VolkSourceExportManifestV1` identifies:

- The complete workspace semantic graph: SHA-256 over stable node/edge IDs,
  registered component semantics, effective parameters, topology, and order.
- The compiler-selected, composite-expanded graph: a separate SHA-256, the
  compiler selection rule, expanded IDs, and effective IR compilation order.
- Top-level workspace node/edge IDs included in the selected graph and those
  excluded by graph selection. Expanded compiler IDs are not misrepresented as
  workspace IDs.
- The exact UTF-8 source SHA-256 and byte length, plus source spans attributed
  to workspace nodes, folded composite instances, internal composite edges,
  workspace edges, and compiler-generated scaffolding.

Layout coordinates, viewport, selection, drag and execution status, labels,
localized copy, and presentation-only edge styling do not contribute to
semantic identity. Dataset rows and file contents are not part of the graph
projection or manifest. Parameter values are consumed by the compiler and
affect its digest, but are never copied into the manifest. SHA-256 values are
integrity fingerprints, not signatures, authentication, or proof of authorship.

Custom composites expand only inside compilation. The compiler supplies a
stable deterministic ID factory scoped by workspace instance, nested
composition path, child key, and edge index. This removes random expansion
identity from generated source while leaving editor/runtime expansion's
existing ID behavior unchanged. Each expanded child maps back to the folded
workspace instance and its ordered path; internal edges retain their template
edge key/index and folded-instance owner. A catalogue template is not treated
as a mounted workspace node. Repeated child keys at different nesting paths
and one external input redirected to multiple composite inputs remain distinct
and traceable.

## Validation and authority

The source-neutral Agent Application API keeps version 1. Its existing
`exportGraph({ framework })` response is unchanged. The additive strict option
`includeManifest: true` returns source plus the manifest from
`compileGraphWithSourceManifest()`. D2's `volk_export_graph` forwards the same
option. The Build inspector also provides an explicit localized source-plus-
provenance bundle download through this D1 boundary.

`validateSourceExportManifest()` first checks bounds and byte spans, then
re-materializes the graph/framework using the canonical compiler and compares
the complete expected source and manifest. It never parses, executes, or
re-imports arbitrary edited source. The artifact remains source-only: no
download or execution occurs through D1/MCP, and the normal Run control retains
its learner-confirmation requirements. Canvas Agent API v1, Playground Agent
API, project JSON, compiler IR version, and MCP method allowlist/authority are
unchanged.

Limits include 2,048 workspace nodes, 4,096 workspace edges, 600,000 source
bytes at the compiler contract, 900,000 manifest code units, 4,000 source
construct mappings, and bounded identity traversal. D1's tighter generated
source and response limits still apply. Exceeding a bound fails closed rather
than returning a partial map. A graph too large for the bounded D1 result may
still use the established plain-source compiler API where its source bound
permits it.

Focused checks:

```text
npm run check:source-export
npm run check:agent-application
npm run check:agent-application:d3
npm run test:agent-application:browser
npm run test:mcp:browser
```

The separate controlled re-import adapter consumes this provenance only after
re-materializing the canonical source and graph. Its stricter PyTorch-only
allowlist, offline AST worker, and detached C1/C2 handoff are documented in
[`source-reimport.md`](./source-reimport.md); exporting a manifest does not by
itself enable arbitrary source import.
