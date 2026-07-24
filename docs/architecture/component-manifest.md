# Component manifest contract

Read this document before adding or modifying a component. The canonical registry is `src/core/components.js`; tests in `scripts/check-core.mjs` enforce the most important invariants.

## Schema

Every manifest uses component schema version `2` and has this conceptual shape:

```js
{
  schemaVersion: 2,
  id: 'dense_node',
  op: 'dense',
  kind: 'layer',
  name: { en: 'Dense / Linear', zh: '全连接 / 线性层' },
  description: { en: '...', zh: '...' },
  category: 'Layers',
  inputs: [{ name: 'input', type: 'Tensor' }],
  outputs: [{ name: 'output', type: 'Tensor' }],
  properties: [{
    key: 'units',
    label: { en: 'Output Units', zh: '输出单元数' },
    type: 'number',
    default: 64,
    min: 1,
    max: 4096,
    step: 1
  }],
  runtime: {
    minimumTier: 'L1',
    browserBackend: 'none'
  },
  compatibility: {
    pytorch: 'exact',
    tensorflow: 'exact'
  },
  composition: null
}
```

## Stable identity and semantics

- `id` is the persisted component identity. Never reuse an existing ID for a different operation.
- `op` is the framework-neutral semantic operation consumed by VOLK IR and compiler switches.
- `kind` describes the graph role. Architecture compilation currently recognizes `source`, `layer`, `merge`, `sink`, and `composite`.
- Other active roles include `data`, `model`, `training`, `evaluation`, `inference`, `loss`, and `optimizer`.
- Port names and types are persisted graph contracts. Renaming them requires an import migration.
- `category` must have a matching `category.*` key in `src/locales/ui.js`.

## Localization

Component-owned metadata remains in the manifest:

- `name`
- `description`
- every property `label`

All active languages need values. Interface copy outside manifest metadata belongs in `src/locales/ui.js`.

## Ports

Ports are nominally typed. A connection is valid only when output and input types match exactly.

Common types include:

- `Tensor`
- `Table`
- `DatasetSplit`
- `ModelSpec`
- `TrainedModel`
- `LossSpec`
- `OptimizerSpec`
- `Metrics`

Use an existing type when the semantic payload is the same. Introduce a new type only when connecting it to the old type would be unsafe.

Each input name and each output name must be unique within its manifest. Inputs are required unless the runtime/compiler explicitly gains an optional-port contract.

## Properties

Supported property controls are:

| Type | Value | Expected metadata |
| --- | --- | --- |
| `number` | number | `default`, optional `min`, `max`, `step` |
| `slider` | number | `default`, `min`, `max`, `step` |
| `select` | string | `default`, `options` |
| `boolean` | boolean | `default` |
| `text` | string | `default` |

Property keys are part of the compiler contract. Keep generated-source mappings and workload formulas synchronized with property changes.

## Runtime and compatibility

`runtime.minimumTier` is the lowest plausible execution environment:

- `L0`: browser CPU
- `L1`: browser WebGPU
- `L2`: local Python
- `L3`: remote GPU

`runtime.browserBackend` is currently `cpu` or `none`. It describes actual availability, not an aspiration.

Each framework compatibility value must be one of:

- `exact`: equivalent operation and relevant defaults;
- `adapted`: deliberate parameter/layout adaptation preserves intended behavior;
- `approximate`: useful conversion with known semantic differences;
- `unsupported`: compilation must stop and name the component.

Never mark a component `exact` merely because both frameworks have similarly named APIs. Check axis order, padding, momentum, training/evaluation behavior, output structure, and loss input semantics.

## Basic and composite components

A basic component maps directly to an IR operation. A composite packages registered basic components and must remain expandable.

```js
composition: {
  nodes: [
    {
      key: 'dense',
      componentId: 'dense_node',
      parameters: {
        input_features: '$input_features',
        units: '$hidden_units'
      }
    },
    { key: 'activation', componentId: 'relu_node', parameters: {} }
  ],
  edges: [
    {
      source: 'dense',
      sourceHandle: 'output',
      target: 'activation',
      targetHandle: 'input'
    }
  ],
  inputs: {
    input: [{ node: 'dense', port: 'input' }]
  },
  outputs: {
    output: { node: 'activation', port: 'output' }
  }
}
```

- Internal `key` values are unique within the composite.
- `componentId` must resolve to a registered component.
- A string beginning with `$` references a property on the composite parent.
- External inputs may fan out to multiple internal inputs, as used by residual connections.
- Every external input/output mapping must refer to a real parent port and real child port.
- Expansion replaces the parent node, creates internal nodes/edges, and redirects existing external edges.

Do not hide behavior inside a composite that cannot be represented by its expanded graph.

## Adding a component

1. Define stable `id`, semantic `op`, role, localized metadata, and typed ports.
2. Add bounded properties with realistic defaults.
3. Set honest framework compatibility and minimum execution tier.
4. Add PyTorch and TensorFlow mappings, or mark unsupported.
5. Add parameter/operation estimation when the component materially affects model size.
6. Add browser execution only when an actual backend exists.
7. Add registry and compiler assertions to `scripts/check-core.mjs`.
8. Run the validation baseline in `overview.md`.

For a composite, also test expansion count, port mappings, and parent-property substitution.
