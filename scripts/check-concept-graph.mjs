import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveConceptGraph, CONCEPT_GRAPH_RELATIONS, CONCEPT_GRAPH_STATES, normalizeConceptGraph } from '../src/core/ui/conceptGraph.js';

const graphSource = fs.readFileSync('src/core/ui/conceptGraph.js', 'utf8');
const mapSource = fs.readFileSync('src/components/playground/ConceptMap.jsx', 'utf8');
const localeSource = fs.readFileSync('src/locales/ui.js', 'utf8');
const cssSource = fs.readFileSync('src/index.css', 'utf8');

const journey = {
  currentEvent: { type: 'connect', conceptId: 'train-test-distribution-shift', evidenceId: 'COVERAGE_MISMATCH' },
  currentTarget: { type: 'concept', id: 'train-test-distribution-shift' },
  connectedConceptIds: ['train-test-distribution-shift'],
  events: [
    { type: 'intervene', experimentId: 'experiment-2', controlKey: 'test.input' },
    { type: 'observe', evidenceId: 'COVERAGE_MISMATCH' },
    { type: 'connect', conceptId: 'train-test-distribution-shift', evidenceId: 'COVERAGE_MISMATCH' },
  ],
};
const inquiry = {
  candidates: [
    { conceptId: 'train-test-distribution-shift', confidence: 'direct' },
    { conceptId: 'generalization', confidence: 'direct' },
  ],
};

const active = deriveConceptGraph({ inquiry, journey, activeConceptId: 'distribution-shift' });
assert.deepEqual(active.nodes.map((node) => node.id), ['train-test-distribution-shift', 'generalization']);
assert.equal(active.currentConceptId, 'train-test-distribution-shift');
assert.equal(active.nodes.find((node) => node.id === 'train-test-distribution-shift').state, CONCEPT_GRAPH_STATES.ACTIVE);
assert.deepEqual(active.frontierConceptIds, ['generalization']);
assert.deepEqual(active.pathConceptIds, ['train-test-distribution-shift']);
assert.deepEqual(active.connectedEvidenceIds, []);
assert.equal(active.edges.length, 1);
assert.deepEqual(active.edges[0], {
  from: 'generalization',
  to: 'train-test-distribution-shift',
  relation: CONCEPT_GRAPH_RELATIONS.RELATED,
});
assert.equal(active.causalEdgeCount, 0);

const connected = deriveConceptGraph({
  inquiry,
  journey: { ...journey, connectedConceptIds: ['train-test-distribution-shift'], events: [...journey.events, { type: 'connect', conceptId: 'generalization', evidenceId: 'TEST_ERROR_CHANGED_MORE' }] },
  activeConceptId: 'distribution-shift',
  selectedConceptId: 'train-test-distribution-shift',
});
assert.deepEqual(connected.connectedEvidenceIds, ['COVERAGE_MISMATCH']);
assert.deepEqual(connected.neighborConceptIds, ['generalization']);
assert.deepEqual(connected.highlightedConceptIds, ['train-test-distribution-shift', 'generalization']);

const illuminated = deriveConceptGraph({
  inquiry,
  journey: { ...journey, currentEvent: { type: 'illuminate', conceptId: 'train-test-distribution-shift' }, currentTarget: { type: 'concept', id: 'train-test-distribution-shift' } },
  activeConceptId: 'distribution-shift',
  illuminatedConceptIds: ['train-test-distribution-shift'],
});
assert.equal(illuminated.nodes.find((node) => node.id === 'train-test-distribution-shift').state, CONCEPT_GRAPH_STATES.ILLUMINATED);
assert.deepEqual(illuminated.frontierConceptIds, ['generalization']);

const selectedNeighbor = deriveConceptGraph({ inquiry, journey, activeConceptId: 'distribution-shift', selectedConceptId: 'generalization' });
assert.equal(selectedNeighbor.selectedConceptId, 'generalization');
assert.deepEqual(selectedNeighbor.neighborConceptIds, ['train-test-distribution-shift']);

const deterministic = deriveConceptGraph({ inquiry, journey, activeConceptId: 'distribution-shift' });
assert.deepEqual(active, deterministic);
assert.equal(normalizeConceptGraph(active).version, 1);
assert.equal(normalizeConceptGraph({ version: 999, nodes: [], edges: [] }), null);

assert.doesNotMatch(graphSource, /localStorage|sessionStorage|dispatch\s*\(|host\s*\./);
assert.doesNotMatch(graphSource, /mastery|infer(?:red|ence)?\s+caus/);
assert.doesNotMatch(mapSource, /onDispatch/);
for (const key of [
  'playground.conceptMap.title',
  'playground.conceptMap.state.unexplored',
  'playground.conceptMap.state.active',
  'playground.conceptMap.state.illuminated',
  'playground.conceptMap.relation.related',
]) assert.match(localeSource, new RegExp(`'${key.replaceAll('.', '\\.')}'`));
assert.match(cssSource, /concept-map-node-unexplored/);
assert.match(cssSource, /concept-map-node-illuminated/);
assert.match(cssSource, /prefers-reduced-motion/);

console.log('Concept graph checks passed: semantic projection, state colors, Distribution Shift path, evidence focus, frontier, deterministic edges, and authority boundaries.');
