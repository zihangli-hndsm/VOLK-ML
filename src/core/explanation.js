import { architectureLayout, stageForManifest } from './visualLanguage.js';

export const EXPLANATION_SKILLS = Object.freeze([
  'trace-data-flow',
  'describe-component-purpose',
  'inspect-missing-inputs',
  'compare-alternatives',
  'suggest-learning-questions',
]);

export function analyzeProject(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (incoming.has(edge.target)) incoming.get(edge.target).push(edge);
  });
  const layers = architectureLayout(nodes, edges);
  const steps = layers.flatMap((layer, layerIndex) => layer.map((node) => ({
    id: node.id,
    layer: layerIndex,
    name: node.data.manifest.name,
    description: node.data.manifest.description,
    stage: stageForManifest(node.data.manifest),
    inputs: node.data.manifest.inputs.map((input) => input.name),
    outputs: node.data.manifest.outputs.map((output) => output.name),
    parameters: node.data.parameters,
  })));
  const missingInputs = nodes.flatMap((node) => node.data.manifest.inputs
    .filter((input) => !incoming.get(node.id).some((edge) => edge.targetHandle === input.name))
    .map((input) => ({ nodeId: node.id, name: node.data.manifest.name, input: input.name })));
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connectedCount: connectedIds.size,
    isolatedCount: nodes.filter((node) => !connectedIds.has(node.id)).length,
    stages: Object.fromEntries(['data', 'model', 'training', 'output'].map((stage) => [
      stage,
      steps.filter((step) => step.stage === stage).length,
    ])),
    steps,
    missingInputs,
    edges: edges.map((edge) => ({
      source: nodeById.get(edge.source)?.data.manifest.op,
      sourceHandle: edge.sourceHandle,
      target: nodeById.get(edge.target)?.data.manifest.op,
      targetHandle: edge.targetHandle,
    })),
  };
}

export function buildAgentPrompt(analysis, language = 'en') {
  return [
    'You are the VOLK-ML project tutor.',
    `Answer in ${language === 'zh' ? 'Chinese' : 'English'}.`,
    'Explain the graph from data flow to output, distinguish deterministic facts from suggestions, and stay beginner-friendly.',
    `Available skills: ${EXPLANATION_SKILLS.join(', ')}.`,
    `Project analysis: ${JSON.stringify(analysis)}`,
  ].join('\n');
}

export async function askExplanationAgent({
  analysis,
  question,
  endpoint,
  apiKey,
  model,
  language,
  history = [],
}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildAgentPrompt(analysis, language) },
        ...history,
        { role: 'user', content: question },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.choices?.[0]?.message?.content ?? payload.output_text ?? '';
}
