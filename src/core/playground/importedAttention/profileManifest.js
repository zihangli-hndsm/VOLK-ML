const manifest = {
  schema: 'ModelArtifactBindingManifestV1',
  manifestId: 'g2-bert-tiny-attention-operator-correspondence-v1',
  manifestSha256: '0ab129df393aac7b59c9e13a468c1c23d22b451677a3193babd96e64c34b8be6',
  bindingKind: 'operator-correspondence',
  fullModelRepresented: false,
  artifact: {
    profileId: 'bert-tiny-sst2-attention-v25-cpu-v1',
    sha256: '3ef55e4c13475e2b6cf4aec1f5002130412e9d58659e9e0943aeae863eba9cb1',
    byteLength: 17641252,
    sourceModelId: 'gokulsrinivasagan/bert_uncased_L-2_H-128_A-2_sst2',
    sourceRevision: 'e454ff624bde2785ee174112f0bcc7e99da8344d',
    sourceWeightsSha256: '8c3fd725aad8a2719edef9ef67a71996f5ffe53f24279c28e29fd2b7ae748dc2',
    sourceConfigSha256: '15007c130ff8f6e9940edf4105680b3a395110b1570d7e6f27d468b4e28a3aee',
    license: 'apache-2.0',
    opset: { domain: '', version: 25 },
    onnxNodeCount: 70,
    attentionOperatorCount: 2,
  },
  exporter: {
    id: 'volk-g2-attention-export-reference',
    manifestContractVersion: 1,
    torch: '2.14.0+cpu',
    transformers: '5.17.0',
    onnx: '1.23.0',
    onnxruntime: '1.30.0',
  },
  anchorContract: {
    componentId: 'multihead_attention_node',
    op: 'multihead_attention',
    parameters: { embed_dim: 128, num_heads: 2, dropout: 0 },
    mappingConfidence: 'exporter-declared-profile-operator-correspondence',
    buildOutputTensor: 'context-only',
  },
  inputContract: {
    onnxInputs: [
      { name: 'input_ids', metadataShape: [1, 'sequence'] },
      { name: 'attention_mask', metadataShape: [1, 'sequence'] },
      { name: 'token_type_ids', metadataShape: [1, 'sequence'] },
    ],
    runtimeInputShape: [1, 6],
    runtimeSequenceLength: 6,
    exportSequenceRange: { minimum: 6, maximum: 512 },
    tokenizer: {
      modelId: 'gokulsrinivasagan/bert_uncased_L-2_H-128_A-2_sst2',
      revision: 'e454ff624bde2785ee174112f0bcc7e99da8344d',
      class: 'BertTokenizer',
      algorithm: 'bert-wordpiece-uncased',
      filesSha256: {
        'tokenizer.json': '0d3aef594edd5f9b53e7f814277a9171dc70ff93eb66bda6e01f7aa53997d963',
        'tokenizer_config.json': 'ae57eda34a3d4e3bbab5edd30c5b7e4ee3c493fa48c2e1af1443b6bd619afc19',
        'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
        'vocab.txt': '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
      },
    },
    preprocessing: {
      specialTokens: 'pinned-tokenizer-defaults',
      attentionMask: 'all-ones',
      tokenTypeIds: 'all-zeros',
      changedContentTokenPosition: 4,
      changedContentTokenCount: 1,
      fixedInputPairSha256: 'f965a89e44c9b672c1e11732ed0cc2e1ed87ca8a878bf5e164467e4e26e54b8a',
    },
  },
  outputContract: {
    logits: {
      name: 'logits',
      onnxMetadataShape: [1, 2],
      runtimeShape: [1, 2],
      semantic: 'classifier-logits',
    },
    attentionTensors: [
      {
        layerIndex: 0,
        operator: {
          domain: '',
          opType: 'Attention',
          nodeName: 'node__symbolic_multi_out__3',
          outputIndex: 3,
          qkMatmulOutputMode: 3,
          isCausal: false,
        },
        tensor: {
          name: 'attention_layer_0',
          semantic: 'post-softmax-attention-probabilities',
          onnxMetadataShape: [1, 2, 'sequence', null],
          runtimeShape: [1, 2, 6, 6],
          heads: 2,
        },
      },
      {
        layerIndex: 1,
        operator: {
          domain: '',
          opType: 'Attention',
          nodeName: 'node__symbolic_multi_out_1__3',
          outputIndex: 3,
          qkMatmulOutputMode: 3,
          isCausal: false,
        },
        tensor: {
          name: 'attention_layer_1',
          semantic: 'post-softmax-attention-probabilities',
          onnxMetadataShape: [1, 2, 'sequence', null],
          runtimeShape: [1, 2, 6, 6],
          heads: 2,
        },
      },
    ],
    missingSemantics: {
      onnxMetadataUnknownDimension: null,
      runtimeObservationRequiresExactShape: [1, 2, 6, 6],
      buildNodeDoesNotProduceArtifactTensor: true,
      fullClassifierGraphNotRepresented: true,
    },
  },
};

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

export const G2_ATTENTION_EXPORT_MANIFEST = freezeDeep(manifest);
