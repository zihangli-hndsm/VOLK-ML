import { componentById, defaults, pluginRegistry } from '../components.js';
import { createAgentNode } from '../canvasAgent.js';
import { normalizeAiConfig } from '../ai/aiSettings.js';
import { createProviderGateway } from '../ai/providerRegistry.js';
import { runBoundedTask } from '../ai/agentRequestContract.js';
import { graphPatchBaseFromProject } from './workspacePatchApply.js';
import { createGraphPatchProposal, dryRunGraphPatch, MAX_GRAPH_PATCH_OPERATIONS } from './graphPatchProposal.js';
import { fingerprintJsonV1, graphIdentityV1 } from './identity.js';

export const GRAPH_EDIT_INTENT_VERSION = 1;
export const GRAPH_EDIT_MAX_REQUEST_LENGTH = 240;
export const GRAPH_EDIT_MAX_CONTEXT_CODE_UNITS = 64_000;
export const GRAPH_EDIT_MAX_STEPS = MAX_GRAPH_PATCH_OPERATIONS;
export const GRAPH_EDIT_RATIONALE_CODE = 'volk-graph-edit-intent-v1';

export const GRAPH_EDIT_OPERATION_TYPES = Object.freeze([
  'ADD_NODE', 'REMOVE_NODE', 'UPDATE_PARAMETERS', 'CONNECT', 'DISCONNECT', 'MOVE_NODE',
]);

export const GRAPH_EDIT_CLARIFICATION_CODES = Object.freeze([
  'ambiguous-target', 'ambiguous-component', 'ambiguous-port', 'request-ambiguous',
  'invalid-connection', 'unsupported-operation', 'unsupported-replace-subgraph', 'context-too-large',
]);

const EDIT_OUTCOMES = Object.freeze(['plan', 'clarification', 'unsupported']);
const RELATIONS = Object.freeze(['left-of', 'right-of', 'above', 'below']);
const MAX_STEP_TEXT = 120;

const stepSchemas = Object.freeze([
  { type: 'object', additionalProperties: false, properties: { op: { const: 'ADD_NODE' }, componentRef: { type: 'string', maxLength: 32 }, resultRef: { type: 'string', maxLength: 32 } }, required: ['op', 'componentRef', 'resultRef'] },
  { type: 'object', additionalProperties: false, properties: { op: { const: 'REMOVE_NODE' }, nodeRef: { type: 'string', maxLength: 32 } }, required: ['op', 'nodeRef'] },
  { type: 'object', additionalProperties: false, properties: { op: { const: 'UPDATE_PARAMETERS' }, nodeRef: { type: 'string', maxLength: 32 }, changes: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', maxLength: 64 }, value: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'number' }, { type: 'boolean' }] } }, required: ['key', 'value'] } } }, required: ['op', 'nodeRef', 'changes'] },
  { type: 'object', additionalProperties: false, properties: { op: { const: 'CONNECT' }, sourceRef: { type: 'string', maxLength: 32 }, sourcePort: { type: 'string', maxLength: 120 }, targetRef: { type: 'string', maxLength: 32 }, targetPort: { type: 'string', maxLength: 120 } }, required: ['op', 'sourceRef', 'sourcePort', 'targetRef', 'targetPort'] },
  { type: 'object', additionalProperties: false, properties: { op: { const: 'DISCONNECT' }, edgeRef: { type: 'string', maxLength: 32 } }, required: ['op', 'edgeRef'] },
  { type: 'object', additionalProperties: false, properties: { op: { const: 'MOVE_NODE' }, nodeRef: { type: 'string', maxLength: 32 }, relation: { type: 'string', enum: RELATIONS }, anchorRef: { type: 'string', maxLength: 32 } }, required: ['op', 'nodeRef', 'relation', 'anchorRef'] },
]);

export const GRAPH_EDIT_INTENT_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: GRAPH_EDIT_INTENT_VERSION },
    requestId: { type: 'string', minLength: 1, maxLength: 96 },
    kind: { type: 'string', enum: EDIT_OUTCOMES },
    steps: { type: 'array', maxItems: GRAPH_EDIT_MAX_STEPS, items: { anyOf: stepSchemas } },
    code: { anyOf: [{ type: 'string', enum: GRAPH_EDIT_CLARIFICATION_CODES }, { type: 'null' }] },
  },
  required: ['version', 'requestId', 'kind', 'steps', 'code'],
});

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = structuredClone(details);
  throw error;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function rejectUnknown(value, allowed, path) {
  if (!isRecord(value)) fail('GRAPH_EDIT_INTENT_INVALID', { path });
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail('GRAPH_EDIT_INTENT_INVALID', { path, field: unknown });
}

function boundedText(value, path, max = MAX_STEP_TEXT) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('GRAPH_EDIT_INTENT_INVALID', { path });
  }
  return value.trim();
}

function normalizedRequest(value) {
  if (typeof value !== 'string') fail('GRAPH_EDIT_REQUEST_INVALID');
  const request = value.trim();
  if (!request || request.length > GRAPH_EDIT_MAX_REQUEST_LENGTH || /[\u0000-\u001f\u007f]/.test(request)) {
    fail('GRAPH_EDIT_REQUEST_INVALID');
  }
  if (/^(?:\s*[\[{])/.test(request) || /(?:^|\n)\s*[-+]?\d+(?:\.\d+)?\s*[,;\t]\s*[-+]?\d/.test(request)) {
    fail('GRAPH_EDIT_REQUEST_INVALID');
  }
  return request;
}

function manifestName(manifest, language = 'en') {
  const name = manifest?.name;
  if (typeof name === 'string') return name;
  return name?.[language] ?? name?.en ?? Object.values(name ?? {}).find((value) => typeof value === 'string') ?? manifest?.id ?? '';
}

function availableComponents(project) {
  const custom = Array.isArray(project?.customComponents) ? project.customComponents.filter((item) => item?.customComposite === true) : [];
  const manifests = [...pluginRegistry, ...custom];
  const unique = new Map();
  for (const manifest of manifests) {
    if (typeof manifest?.id === 'string' && !unique.has(manifest.id)) unique.set(manifest.id, manifest);
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function projectDefinitionsFingerprint(definitions) {
  try {
    const serialized = JSON.stringify(definitions);
    if (typeof serialized !== 'string') fail('GRAPH_EDIT_PROJECT_INVALID');
    return fingerprintJsonV1(JSON.parse(serialized), 'graph-edit-definitions');
  } catch (error) {
    if (error?.code) throw error;
    fail('GRAPH_EDIT_PROJECT_INVALID');
  }
}

function safePropertyDefinition(property, { custom = false } = {}) {
  const allowedTypes = new Set(['number', 'slider', 'select', 'boolean']);
  if (!allowedTypes.has(property?.type) || typeof property.key !== 'string') return null;
  const projected = { key: property.key, type: property.type };
  for (const field of ['min', 'max', 'step']) {
    if (Number.isFinite(property[field])) projected[field] = property[field];
  }
  if (!custom && property.type === 'select' && Array.isArray(property.options)) {
    projected.options = property.options.slice(0, 32).map((option) => option?.value ?? option);
  }
  return projected;
}

function safeParameterValues(node) {
  const properties = node.data.manifest.properties ?? [];
  const safe = {};
  for (const property of properties) {
    if (!['number', 'slider', 'boolean', 'select'].includes(property.type)) continue;
    const value = node.data.parameters?.[property.key];
    if (typeof value === 'number' && Number.isFinite(value)) safe[property.key] = value;
    else if (typeof value === 'boolean') safe[property.key] = value;
    else if (property.type === 'select' && typeof value === 'string' && Array.isArray(property.options)
      && property.options.some((option) => (option?.value ?? option) === value)) safe[property.key] = value;
  }
  return safe;
}

/** Build a request-scoped local mapping and a bounded semantic projection. Raw graph IDs never enter `projection`. */
export function createGraphEditContext(project, { language = 'en' } = {}) {
  if (!isRecord(project) || !isRecord(project.graph) || !Array.isArray(project.graph.nodes)
    || !Array.isArray(project.graph.edges) || !Array.isArray(project.customComponents)) {
    fail('GRAPH_EDIT_PROJECT_INVALID');
  }
  const baseGraph = graphPatchBaseFromProject(project);
  const identity = graphIdentityV1(baseGraph);
  const sortedNodes = [...baseGraph.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...baseGraph.edges].sort((left, right) => left.id.localeCompare(right.id));
  const components = availableComponents(project);
  const nodeByRef = new Map(sortedNodes.map((node, index) => [`node_${index + 1}`, node]));
  const edgeByRef = new Map(sortedEdges.map((edge, index) => [`edge_${index + 1}`, edge]));
  const componentByRef = new Map(components.map((manifest, index) => [`component_${index + 1}`, manifest]));
  const nodeRefById = new Map([...nodeByRef.entries()].map(([ref, node]) => [node.id, ref]));
  const edgeRefById = new Map([...edgeByRef.entries()].map(([ref, edge]) => [edge.id, ref]));
  const componentRefById = new Map([...componentByRef.entries()].map(([ref, manifest]) => [manifest.id, ref]));
  const projection = {
    version: GRAPH_EDIT_INTENT_VERSION,
    graphIdentity: identity,
    topologyCoverage: 'complete',
    nodes: [...nodeByRef.entries()].map(([ref, node]) => ({
      ref,
      componentRef: componentRefById.get(node.data.manifest.id) ?? null,
      name: componentById.has(node.data.manifest.id) ? manifestName(node.data.manifest, language).slice(0, 80) : null,
      kind: node.data.manifest.kind,
      operation: node.data.manifest.op,
      inputs: (node.data.manifest.inputs ?? []).slice(0, 64).map(({ name, type }) => ({ name, type })),
      outputs: (node.data.manifest.outputs ?? []).slice(0, 64).map(({ name, type }) => ({ name, type })),
      properties: (node.data.manifest.properties ?? []).map((property) => safePropertyDefinition(property, { custom: !componentById.has(node.data.manifest.id) })).filter(Boolean).slice(0, 32),
      values: safeParameterValues(node),
    })),
    edges: [...edgeByRef.entries()].map(([ref, edge]) => ({
      ref,
      sourceRef: nodeRefById.get(edge.source),
      sourcePort: edge.sourceHandle,
      targetRef: nodeRefById.get(edge.target),
      targetPort: edge.targetHandle,
    })),
    componentCatalog: [...componentByRef.entries()].map(([ref, manifest]) => ({
      ref,
      name: componentById.has(manifest.id) ? manifestName(manifest, language).slice(0, 80) : null,
      kind: manifest.kind,
      operation: manifest.op,
      inputs: (manifest.inputs ?? []).slice(0, 64).map(({ name, type }) => ({ name, type })),
      outputs: (manifest.outputs ?? []).slice(0, 64).map(({ name, type }) => ({ name, type })),
      properties: (manifest.properties ?? []).map((property) => safePropertyDefinition(property, { custom: !componentById.has(manifest.id) })).filter(Boolean).slice(0, 32),
      definitionSource: componentById.has(manifest.id) ? 'registered' : 'existing-project-composite',
    })),
  };
  const serialized = JSON.stringify(projection);
  if (serialized.length > GRAPH_EDIT_MAX_CONTEXT_CODE_UNITS) {
    fail('GRAPH_EDIT_CONTEXT_TOO_LARGE', { maxCodeUnits: GRAPH_EDIT_MAX_CONTEXT_CODE_UNITS });
  }
  const projectSignature = projectDefinitionsFingerprint(project.customComponents);
  const registrySignature = projectDefinitionsFingerprint(components);
  const contextIdentity = { graph: identity, projectSignature, registrySignature };
  return {
    baseGraph: structuredClone(baseGraph),
    identity,
    contextIdentity,
    projection,
    serialized,
    nodeByRef,
    edgeByRef,
    componentByRef,
    nodeRefById,
    edgeRefById,
    componentRefById,
    projectDefinitions: structuredClone(project.customComponents),
    projectSignature,
    registrySignature,
  };
}

function refsAllowed(plan, context, index) {
  const nodeRefs = new Set(context.nodeByRef.keys());
  const edgeRefs = new Set(context.edgeByRef.keys());
  const componentRefs = new Set(context.componentByRef.keys());
  const newRefs = new Set();
  for (const [stepIndex, step] of plan.steps.entries()) {
    const path = `steps[${stepIndex}]`;
    const existingOrNew = (ref, field, allowNew = true) => {
      const text = boundedText(ref, `${path}.${field}`, 32);
      if (nodeRefs.has(text) || (allowNew && newRefs.has(text))) return text;
      fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { path, field });
    };
    switch (step.op) {
      case 'ADD_NODE': {
        rejectUnknown(step, ['op', 'componentRef', 'resultRef'], path);
        const componentRef = boundedText(step.componentRef, `${path}.componentRef`, 32);
        if (!componentRefs.has(componentRef)) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { path, field: 'componentRef' });
        const resultRef = boundedText(step.resultRef, `${path}.resultRef`, 32);
        if (!/^new_[a-z0-9_]{1,24}$/.test(resultRef) || newRefs.has(resultRef) || nodeRefs.has(resultRef)) {
          fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { path, field: 'resultRef' });
        }
        newRefs.add(resultRef);
        break;
      }
      case 'REMOVE_NODE':
        rejectUnknown(step, ['op', 'nodeRef'], path);
        existingOrNew(step.nodeRef, 'nodeRef', false);
        break;
      case 'UPDATE_PARAMETERS': {
        rejectUnknown(step, ['op', 'nodeRef', 'changes'], path);
        existingOrNew(step.nodeRef, 'nodeRef');
        if (!Array.isArray(step.changes) || step.changes.length < 1 || step.changes.length > 32) fail('GRAPH_EDIT_INTENT_INVALID', { path, field: 'changes' });
        const keys = new Set();
        step.changes.forEach((change, changeIndex) => {
          const changePath = `${path}.changes[${changeIndex}]`;
          rejectUnknown(change, ['key', 'value'], changePath);
          const key = boundedText(change.key, `${changePath}.key`, 64);
          if (keys.has(key) || !['string', 'number', 'boolean'].includes(typeof change.value)
            || (typeof change.value === 'number' && !Number.isFinite(change.value))
            || (typeof change.value === 'string' && change.value.length > 120)) {
            fail('GRAPH_EDIT_INTENT_INVALID', { path: changePath });
          }
          keys.add(key);
        });
        break;
      }
      case 'CONNECT':
        rejectUnknown(step, ['op', 'sourceRef', 'sourcePort', 'targetRef', 'targetPort'], path);
        existingOrNew(step.sourceRef, 'sourceRef');
        boundedText(step.sourcePort, `${path}.sourcePort`, 120);
        existingOrNew(step.targetRef, 'targetRef');
        boundedText(step.targetPort, `${path}.targetPort`, 120);
        break;
      case 'DISCONNECT': {
        rejectUnknown(step, ['op', 'edgeRef'], path);
        const edgeRef = boundedText(step.edgeRef, `${path}.edgeRef`, 32);
        if (!edgeRefs.has(edgeRef)) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { path, field: 'edgeRef' });
        break;
      }
      case 'MOVE_NODE':
        rejectUnknown(step, ['op', 'nodeRef', 'relation', 'anchorRef'], path);
        existingOrNew(step.nodeRef, 'nodeRef');
        if (!RELATIONS.includes(step.relation)) fail('GRAPH_EDIT_INTENT_INVALID', { path, field: 'relation' });
        existingOrNew(step.anchorRef, 'anchorRef');
        if (step.nodeRef === step.anchorRef) fail('GRAPH_EDIT_INTENT_INVALID', { path, field: 'anchorRef' });
        break;
      default:
        fail(step.op === 'REPLACE_SUBGRAPH' ? 'GRAPH_EDIT_OPERATION_UNSUPPORTED' : 'GRAPH_EDIT_INTENT_INVALID', { path, operationIndex: stepIndex });
    }
  }
  return { plan, newRefs };
}

/** Strict runtime validator for the provider's untrusted typed intent. */
export function validateGraphEditIntentPlan(value, { requestId, context } = {}) {
  try {
    rejectUnknown(value, ['version', 'requestId', 'kind', 'steps', 'code'], 'plan');
    if (value.version !== GRAPH_EDIT_INTENT_VERSION) fail('GRAPH_EDIT_INTENT_VERSION_UNSUPPORTED');
    if (boundedText(value.requestId, 'requestId', 96) !== requestId) fail('GRAPH_EDIT_INTENT_STALE');
    if (!EDIT_OUTCOMES.includes(value.kind)) fail('GRAPH_EDIT_INTENT_INVALID', { field: 'kind' });
    if (!Array.isArray(value.steps) || value.steps.length > GRAPH_EDIT_MAX_STEPS) fail('GRAPH_EDIT_INTENT_INVALID', { field: 'steps' });
    if (value.kind === 'plan') {
      if (value.steps.length === 0 || value.code !== null) fail('GRAPH_EDIT_INTENT_INVALID', { field: 'kind/steps' });
    } else {
      if (value.steps.length !== 0 || !GRAPH_EDIT_CLARIFICATION_CODES.includes(value.code)) fail('GRAPH_EDIT_INTENT_INVALID', { field: 'kind/code' });
    }
    if (!context || typeof context !== 'object') fail('GRAPH_EDIT_CONTEXT_REQUIRED');
    refsAllowed(value, context);
    return { valid: true, plan: structuredClone(value) };
  } catch (error) {
    return { valid: false, diagnostics: [{ code: error?.code ?? 'GRAPH_EDIT_INTENT_INVALID', ...(error?.details ? { details: structuredClone(error.details) } : {}) }] };
  }
}

function parseProviderText(value) {
  if (typeof value !== 'string' || value.length > 30_000) fail('GRAPH_EDIT_INTENT_RESPONSE_INVALID');
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); }
  catch { fail('GRAPH_EDIT_INTENT_RESPONSE_INVALID'); }
}

function providerInstructions() {
  return [
    'You interpret a learner request to edit one existing VOLK-ML graph. Return only the exact GraphEditIntentPlanV1 JSON object.',
    'The supplied graph and component catalog are semantic context with temporary aliases. Select only supplied node, edge, and component references.',
    'Never return graph data, IDs, manifests, code, arbitrary operations, Apply/Run instructions, or claims that an edit has happened.',
    'Only use ADD_NODE, REMOVE_NODE, UPDATE_PARAMETERS, CONNECT, DISCONNECT, MOVE_NODE. REPLACE_SUBGRAPH is unsupported.',
    'Use exact supplied property keys, typed ports, and catalog component refs. If a target, component, or port is ambiguous or unsupported, return clarification with no steps.',
    'For REMOVE_NODE, return REMOVE_NODE only; deterministic local code will construct the required explicit incident DISCONNECT operations before it.',
    'MOVE_NODE must use a relative relation and another supplied node alias. Numeric layout coordinates are not accepted from you.',
    'Proposal creation is not execution. The learner must review the local C1/C2 before/after diff and explicitly Apply.',
  ].join('\n');
}

function requestMessage({ requestId, request, projection, targetChoices = [] }) {
  return JSON.stringify({
    contract: 'GraphEditIntentPlanV1',
    version: GRAPH_EDIT_INTENT_VERSION,
    requestId,
    learnerRequest: request,
    semanticGraphContext: projection,
    ...(targetChoices.length ? { learnerSelectedTargetRefs: targetChoices } : {}),
  });
}

/** Optional provider adapter. The affirmative consent check is required at the call site and repeated here. */
export function createLlmGraphEditIntentInterpreter({ gateway, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const providerGateway = gateway ?? createProviderGateway({ fetchImpl });
  return Object.freeze({
    async interpret({ request, requestId, project, config, consent = false, language = 'en', signal, timeoutMs: requestTimeoutMs, targetChoices = [] } = {}) {
      if (consent !== true) fail('GRAPH_EDIT_CONSENT_REQUIRED');
      const normalized = normalizedRequest(request);
      const normalizedConfig = normalizeAiConfig(config);
      if (!normalizedConfig) fail('GRAPH_EDIT_PROVIDER_NOT_CONFIGURED');
      const id = boundedText(requestId, 'requestId', 96);
      const context = createGraphEditContext(project, { language });
      const userMessage = requestMessage({ requestId: id, request: normalized, projection: context.projection, targetChoices });
      const result = await runBoundedTask({
        requestId: id,
        signal,
        timeoutMs: requestTimeoutMs ?? timeoutMs,
        repairInput: { task: 'graph-edit-intent-validation', instruction: 'Correct only the typed intent object; do not add graph data or execute the request.' },
        execute: async ({ attempt, attemptBudget, signal: effectiveSignal }) => providerGateway.complete({
          config: normalizedConfig,
          system: providerInstructions(),
          messages: [
            { role: 'user', content: userMessage },
            ...(attempt ? [{ role: 'user', content: 'Correct only the intent JSON schema. Keep the same request and graph aliases; do not invent graph state.' }] : []),
          ],
          responseMode: 'json',
          responseSchema: { name: 'volk_ml_graph_edit_intent_v1', schema: GRAPH_EDIT_INTENT_RESPONSE_SCHEMA },
          requestId: id,
          attemptBudget,
          signal: effectiveSignal,
        }),
        validate: (response) => {
          const checked = validateGraphEditIntentPlan(parseProviderText(response?.text), { requestId: id, context });
          if (!checked.valid) fail(checked.diagnostics[0]?.code ?? 'GRAPH_EDIT_INTENT_RESPONSE_INVALID', checked.diagnostics[0]?.details ?? {});
          return checked.plan;
        },
      });
      return { ...result.value, source: 'provider', contextIdentity: context.contextIdentity, projectSignature: context.projectSignature, registrySignature: context.registrySignature };
    },
  });
}

function localizedText(value, language) {
  if (typeof value === 'string') return value;
  return value?.[language] ?? value?.en ?? Object.values(value ?? {}).find((entry) => typeof entry === 'string') ?? '';
}

function mentions(text, candidates) {
  const lower = text.toLocaleLowerCase();
  const found = candidates.filter((candidate) => candidate.text && lower.includes(candidate.text.toLocaleLowerCase()));
  const longest = Math.max(0, ...found.map((entry) => entry.text.length));
  return found.filter((entry) => entry.text.length === longest)
    .sort((left, right) => lower.indexOf(left.text.toLocaleLowerCase()) - lower.indexOf(right.text.toLocaleLowerCase()));
}

function localNodeCandidates(context, language) {
  return [...context.nodeByRef.entries()].map(([ref, node]) => ({
    ref,
    node,
    text: localizedText(node.data.label, language) || localizedText(node.data.manifest.name, language),
  }));
}

const MAX_CLARIFICATION_CANDIDATES = 32;

function clarification(code, candidates = []) {
  return { version: GRAPH_EDIT_INTENT_VERSION, kind: 'clarification', steps: [], code, candidates: candidates.slice(0, MAX_CLARIFICATION_CANDIDATES) };
}

function nodeCandidate(ref, ordinal) { return { kind: 'node', ref, ordinal }; }

function componentCandidate(ref, ordinal) { return { kind: 'component', ref, ordinal }; }

function edgeCandidate(ref, edge, context, ordinal) {
  return {
    kind: 'edge', ref, ordinal,
    sourceRef: context.nodeRefById.get(edge.source),
    sourcePort: edge.sourceHandle,
    targetRef: context.nodeRefById.get(edge.target),
    targetPort: edge.targetHandle,
  };
}

function nodePairCandidate(operation, source, target, ordinal) {
  return { kind: 'node-pair', operation, sourceRef: source.ref, targetRef: target.ref, ordinal };
}

function portPairCandidate(sourceRef, targetRef, pair, ordinal) {
  return { kind: 'port-pair', operation: 'CONNECT', sourceRef, sourcePort: pair.sourcePort, targetRef, targetPort: pair.targetPort, ordinal };
}

function nodeCandidates(matches) {
  return matches.map(({ ref }, index) => nodeCandidate(ref, index + 1));
}

function pairCandidates(operation, matches) {
  const pairs = [];
  for (const source of matches) {
    for (const target of matches) {
      if (source.ref === target.ref) continue;
      pairs.push(nodePairCandidate(operation, source, target, pairs.length + 1));
      if (pairs.length >= MAX_CLARIFICATION_CANDIDATES) return pairs;
    }
  }
  return pairs;
}

function edgeCandidates(entries, context) {
  return entries.slice(0, MAX_CLARIFICATION_CANDIDATES).map(([ref, edge], index) => edgeCandidate(ref, edge, context, index + 1));
}

function componentCandidates(entries) {
  return entries.slice(0, MAX_CLARIFICATION_CANDIDATES).map(([ref], index) => componentCandidate(ref, index + 1));
}

function selected(selection, kind, predicate = () => true) {
  return selection?.kind === kind && predicate(selection) ? selection : null;
}

function makeLocalPlan(steps, context, requestId, { failureCode = 'request-ambiguous' } = {}) {
  const candidate = { version: GRAPH_EDIT_INTENT_VERSION, requestId, kind: 'plan', steps, code: null };
  const checked = validateGraphEditIntentPlan(candidate, { requestId, context });
  if (!checked.valid) return clarification(failureCode);
  return { ...checked.plan, source: 'local', contextIdentity: context.contextIdentity, projectSignature: context.projectSignature, registrySignature: context.registrySignature };
}

function matchingNodes(text, context, language) {
  const lower = text.toLocaleLowerCase();
  const found = localNodeCandidates(context, language)
    .map((candidate) => ({ ...candidate, matchIndex: candidate.text ? lower.indexOf(candidate.text.toLocaleLowerCase()) : -1 }))
    .filter((candidate) => candidate.matchIndex >= 0);
  return found.filter((candidate) => !found.some((other) => other.matchIndex === candidate.matchIndex
      && other.text.length > candidate.text.length
      && other.text.toLocaleLowerCase().startsWith(candidate.text.toLocaleLowerCase())))
    .sort((left, right) => left.matchIndex - right.matchIndex);
}

function parseValue(raw, property) {
  const valueText = raw.trim().replace(/[.,。！!？?]+$/, '');
  if (property.type === 'boolean') {
    if (/^(true|yes|on|是|开启|开)$/i.test(valueText)) return true;
    if (/^(false|no|off|否|关闭|关)$/i.test(valueText)) return false;
    return undefined;
  }
  if (property.type === 'number' || property.type === 'slider') {
    const match = valueText.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
    return match ? Number(match[0]) : undefined;
  }
  if (property.type === 'select') {
    return property.options?.map((option) => option?.value ?? option).find((option) => String(option).toLocaleLowerCase() === valueText.toLocaleLowerCase());
  }
  return undefined;
}

function matchProperty(text, node, language) {
  const lower = text.toLocaleLowerCase();
  const candidates = (node.data.manifest.properties ?? []).flatMap((property) => {
    const labels = [property.key, localizedText(property.label, language)].filter(Boolean);
    return labels.map((candidate) => ({ property, text: candidate }));
  });
  const matched = candidates.filter((candidate) => candidate.text && lower.includes(candidate.text.toLocaleLowerCase()))
    .sort((left, right) => lower.indexOf(left.text.toLocaleLowerCase()) - lower.indexOf(right.text.toLocaleLowerCase()));
  return [...new Map(matched.map((entry) => [entry.property.key, entry])).values()];
}

function inferredPortPair(source, target) {
  const pairs = [];
  for (const output of source.data.manifest.outputs ?? []) {
    for (const input of target.data.manifest.inputs ?? []) {
      if (output.type === input.type) pairs.push({ sourcePort: output.name, targetPort: input.name });
    }
  }
  return pairs;
}

/** Conservative offline parser: it emits only unambiguous local intent for simple supported phrasing. */
export function resolveGraphEditLocally(requestInput, context, { language = 'en', targetOverride = null, selection = null, requestId = 'local-plan' } = {}) {
  let request;
  try { request = normalizedRequest(requestInput); }
  catch { return clarification('request-ambiguous'); }
  const text = request.toLocaleLowerCase();
  const nodes = localNodeCandidates(context, language);
  const chosen = selection ?? (typeof targetOverride === 'string' ? { kind: 'node', ref: targetOverride } : null);
  const selectedNode = (matches) => {
    const nodeChoice = selected(chosen, 'node', (candidate) => matches.some((entry) => entry.ref === candidate.ref));
    if (nodeChoice) return matches.find((entry) => entry.ref === nodeChoice.ref);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
    return nodes.length === 1 ? nodes[0] : null;
  };

  if (/\breplace\s+(?:the\s+)?subgraph\b|替换子图|整体替换/.test(text)) return clarification('unsupported-replace-subgraph');

  if (/\b(remove|delete)\b|删除|移除/.test(text) && /\b(edge|connection|link)\b|连线|连接/.test(text)) {
    const matchedEdges = [...context.edgeByRef.entries()].filter(([, edge]) => {
      const source = context.nodeByRef.get(context.nodeRefById.get(edge.source));
      const target = context.nodeByRef.get(context.nodeRefById.get(edge.target));
      const sourceName = localizedText(source?.data.label, language).toLocaleLowerCase();
      const targetName = localizedText(target?.data.label, language).toLocaleLowerCase();
      return (sourceName && text.includes(sourceName) && targetName && text.includes(targetName));
    });
    const edgeChoice = selected(chosen, 'edge', (candidate) => matchedEdges.some(([ref]) => ref === candidate.ref));
    if (edgeChoice) return makeLocalPlan([{ op: 'DISCONNECT', edgeRef: edgeChoice.ref }], context, requestId);
    if (matchedEdges.length === 1) return makeLocalPlan([{ op: 'DISCONNECT', edgeRef: matchedEdges[0][0] }], context, requestId);
    if (matchedEdges.length > 1) return clarification('ambiguous-port', edgeCandidates(matchedEdges, context));
  }

  if (/\b(disconnect|unlink)\b|断开|取消连接/.test(text)) {
    const nodesMentioned = matchingNodes(text, context, language);
    const matchedEdges = nodesMentioned.length === 2
      ? [...context.edgeByRef.entries()].filter(([, edge]) => edge.source === nodesMentioned[0].node.id && edge.target === nodesMentioned[1].node.id)
      : [...context.edgeByRef.entries()];
    const edgeChoice = selected(chosen, 'edge', (candidate) => matchedEdges.some(([ref]) => ref === candidate.ref));
    if (edgeChoice) return makeLocalPlan([{ op: 'DISCONNECT', edgeRef: edgeChoice.ref }], context, requestId);
    if (matchedEdges.length === 1) return makeLocalPlan([{ op: 'DISCONNECT', edgeRef: matchedEdges[0][0] }], context, requestId);
    return clarification(matchedEdges.length ? 'ambiguous-port' : 'request-ambiguous', edgeCandidates(matchedEdges, context));
  }

  if (/\b(connect|wire)\b|(?:^|[\s，,、])(?:请)?连接(?=\s|到|$)/.test(text)) {
    const matches = matchingNodes(text, context, language);
    const pairChoice = selected(chosen, 'node-pair', (candidate) => candidate.operation === 'CONNECT'
      && matches.some(({ ref }) => ref === candidate.sourceRef) && matches.some(({ ref }) => ref === candidate.targetRef));
    const selectedPortPair = selected(chosen, 'port-pair', (candidate) => candidate.operation === 'CONNECT'
      && context.nodeByRef.has(candidate.sourceRef) && context.nodeByRef.has(candidate.targetRef));
    if (selectedPortPair) {
      const source = context.nodeByRef.get(selectedPortPair.sourceRef);
      const target = context.nodeByRef.get(selectedPortPair.targetRef);
      const belongsToRequest = matches.some(({ ref }) => ref === selectedPortPair.sourceRef)
        && matches.some(({ ref }) => ref === selectedPortPair.targetRef);
      const isCompatiblePair = inferredPortPair(source, target).some((pair) => pair.sourcePort === selectedPortPair.sourcePort && pair.targetPort === selectedPortPair.targetPort);
      if (!belongsToRequest || !isCompatiblePair) return clarification('invalid-connection');
      return makeLocalPlan([{ op: 'CONNECT', sourceRef: selectedPortPair.sourceRef, sourcePort: selectedPortPair.sourcePort, targetRef: selectedPortPair.targetRef, targetPort: selectedPortPair.targetPort }], context, requestId, { failureCode: 'invalid-connection' });
    }
    let endpoints;
    if (pairChoice) endpoints = [
      { ref: pairChoice.sourceRef, node: context.nodeByRef.get(pairChoice.sourceRef) },
      { ref: pairChoice.targetRef, node: context.nodeByRef.get(pairChoice.targetRef) },
    ];
    else if (matches.length === 2) endpoints = matches;
    else if (matches.length > 2) return clarification('ambiguous-target', pairCandidates('CONNECT', matches));
    else return clarification('request-ambiguous');
    const candidates = inferredPortPair(endpoints[0].node, endpoints[1].node);
    if (candidates.length === 0) return clarification('invalid-connection');
    if (candidates.length > 1) return clarification('ambiguous-port', candidates.slice(0, MAX_CLARIFICATION_CANDIDATES).map((candidate, index) => portPairCandidate(endpoints[0].ref, endpoints[1].ref, candidate, index + 1)));
    return makeLocalPlan([{ op: 'CONNECT', sourceRef: endpoints[0].ref, sourcePort: candidates[0].sourcePort, targetRef: endpoints[1].ref, targetPort: candidates[0].targetPort }], context, requestId, { failureCode: 'invalid-connection' });
  }

  if (/\b(move|reposition)\b|移动|放置/.test(text)) {
    const matches = matchingNodes(text, context, language);
    const pairChoice = selected(chosen, 'node-pair', (candidate) => candidate.operation === 'MOVE_NODE'
      && matches.some(({ ref }) => ref === candidate.sourceRef) && matches.some(({ ref }) => ref === candidate.targetRef));
    if (!pairChoice && matches.length !== 2) return clarification(matches.length > 2 ? 'ambiguous-target' : 'request-ambiguous', pairCandidates('MOVE_NODE', matches));
    const relationMatch = text.match(/\b(left|right|above|below)\b|左侧|左边|右侧|右边|上方|上面|下方|下面/);
    const relationText = relationMatch?.[0] ?? '';
    const relation = /left|左/.test(relationText) ? 'left-of' : /right|右/.test(relationText) ? 'right-of' : /above|上/.test(relationText) ? 'above' : /below|下/.test(relationText) ? 'below' : null;
    if (!relation) return clarification('request-ambiguous');
    return makeLocalPlan([{ op: 'MOVE_NODE', nodeRef: pairChoice?.sourceRef ?? matches[0].ref, relation, anchorRef: pairChoice?.targetRef ?? matches[1].ref }], context, requestId);
  }

  if (/\b(set|change|adjust|update)\b|设置|修改|调整/.test(text)) {
    const matches = matchingNodes(text, context, language);
    const selected = selectedNode(matches);
    if (!selected) return clarification('ambiguous-target', nodeCandidates(matches));
    const properties = matchProperty(text, selected.node, language);
    const propertyChoice = chosen?.kind === 'property' && properties.some(({ property }) => property.key === chosen.key)
      ? properties.find(({ property }) => property.key === chosen.key) : null;
    if (properties.length !== 1 && !propertyChoice) return clarification(properties.length > 1 ? 'ambiguous-port' : 'request-ambiguous', properties.map(({ property }, index) => ({ kind: 'property', key: property.key, label: localizedText(property.label, language), ordinal: index + 1 })));
    const valueMatch = request.match(/(?:\bto\b|=|:|为|改成|设为)\s*([^,;，；]+)/i);
    if (!valueMatch) return clarification('request-ambiguous');
    const property = (propertyChoice ?? properties[0]).property;
    const value = parseValue(valueMatch[1], property);
    if (value === undefined) return clarification('request-ambiguous');
    return makeLocalPlan([{ op: 'UPDATE_PARAMETERS', nodeRef: selected.ref, changes: [{ key: property.key, value }] }], context, requestId);
  }

  if (/\b(remove|delete)\b|删除|移除/.test(text)) {
    const matches = matchingNodes(text, context, language);
    const target = selectedNode(matches);
    if (!target) return clarification('ambiguous-target', nodeCandidates(matches));
    return makeLocalPlan([{ op: 'REMOVE_NODE', nodeRef: target.ref }], context, requestId);
  }

  if (/\b(add|insert)\b|添加|加入/.test(text)) {
    const components = [...context.componentByRef.entries()].map(([ref, manifest]) => ({ ref, manifest, text: manifestName(manifest, language) }));
    const componentRequest = request.replace(/^\s*(?:add|insert)\b\s*/i, '').replace(/^\s*(?:添加|加入)\s*/, '').toLocaleLowerCase();
    const matches = mentions(componentRequest, components);
    const componentChoice = selected(chosen, 'component', (candidate) => context.componentByRef.has(candidate.ref));
    if (componentChoice && (matches.length === 0 || matches.some(({ ref }) => ref === componentChoice.ref))) {
      return makeLocalPlan([{ op: 'ADD_NODE', componentRef: componentChoice.ref, resultRef: 'new_1' }], context, requestId);
    }
    if (matches.length !== 1) return clarification(matches.length > 1 ? 'ambiguous-component' : 'request-ambiguous', componentCandidates(matches.length ? matches : [...context.componentByRef.entries()]));
    return makeLocalPlan([{ op: 'ADD_NODE', componentRef: matches[0].ref, resultRef: 'new_1' }], context, requestId);
  }
  return clarification('request-ambiguous');
}

function safeParameterValue(property, value) {
  if (property.type === 'number' || property.type === 'slider') {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || (Number.isFinite(property.min) && value < property.min)
      || (Number.isFinite(property.max) && value > property.max)) return false;
    const step = Number.isFinite(property.step) && property.step > 0 ? property.step : 1;
    const base = Number.isFinite(property.min) ? property.min : 0;
    return Math.abs((value - base) / step - Math.round((value - base) / step)) < 1e-8;
  }
  if (property.type === 'boolean') return typeof value === 'boolean';
  if (property.type === 'select') return typeof value === 'string' && Array.isArray(property.options)
    && property.options.some((option) => (option?.value ?? option) === value);
  return false;
}

function nextNodePosition(nodes) {
  const occupied = new Set(nodes.map((node) => `${Math.round(node.position.x / 220)}:${Math.round(node.position.y / 140)}`));
  for (let row = 0; row < 64; row += 1) {
    for (let column = 0; column < 64; column += 1) {
      if (!occupied.has(`${column}:${row}`)) return { x: column * 220, y: row * 140 };
    }
  }
  fail('GRAPH_EDIT_LAYOUT_CAPACITY');
}

function movePosition(node, anchor, relation) {
  const gap = 220;
  const position = { x: anchor.position.x, y: anchor.position.y };
  if (relation === 'left-of') position.x -= gap;
  if (relation === 'right-of') position.x += gap;
  if (relation === 'above') position.y -= gap;
  if (relation === 'below') position.y += gap;
  if (Math.abs(position.x) > 10_000 || Math.abs(position.y) > 10_000) fail('GRAPH_EDIT_LAYOUT_OUT_OF_BOUNDS');
  return position;
}

function manifestForProperty(node, key) {
  return (node?.data?.manifest?.properties ?? []).find((property) => property.key === key) ?? null;
}

/** Locally map a validated plan to canonical C1 operations and create a detached C1 proposal. */
export function compileGraphEditPlan({ plan: inputPlan, project, requestId, context: suppliedContext = null } = {}) {
  try {
    const context = suppliedContext ?? createGraphEditContext(project);
    const { source: planSource = 'provider', contextIdentity = null, projectSignature = null, registrySignature = null, ...typedPlan } = inputPlan ?? {};
    const checked = validateGraphEditIntentPlan(typedPlan, { requestId: typedPlan?.requestId ?? requestId, context });
    if (!checked.valid || checked.plan.kind !== 'plan') fail(checked.diagnostics?.[0]?.code ?? 'GRAPH_EDIT_PLAN_REQUIRED', checked.diagnostics?.[0]?.details ?? {});
    const plan = checked.plan;
    if (requestId && plan.requestId !== requestId) fail('GRAPH_EDIT_INTENT_STALE');
    if (contextIdentity && JSON.stringify(contextIdentity) !== JSON.stringify(context.contextIdentity)) fail('GRAPH_EDIT_CONTEXT_STALE');
    if (projectDefinitionsFingerprint(project.customComponents) !== context.projectSignature) fail('GRAPH_EDIT_CONTEXT_STALE');
    if (projectSignature && projectSignature !== context.projectSignature) fail('GRAPH_EDIT_CONTEXT_STALE');
    if (registrySignature && registrySignature !== context.registrySignature) fail('GRAPH_EDIT_CONTEXT_STALE');

    const nodes = structuredClone(context.baseGraph.nodes);
    const edges = structuredClone(context.baseGraph.edges);
    const nodeIds = new Map([...context.nodeByRef.entries()].map(([ref, node]) => [ref, node.id]));
    const edgeIds = new Map([...context.edgeByRef.entries()].map(([ref, edge]) => [ref, edge.id]));
    const operations = [];
    for (const [stepIndex, step] of plan.steps.entries()) {
      if (step.op === 'ADD_NODE') {
        const manifest = context.componentByRef.get(step.componentRef);
        if (!manifest) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { field: 'componentRef' });
        const nodeId = `lumi-${plan.requestId.replace(/[^A-Za-z0-9-]/g, '').slice(-24)}-n${stepIndex}`;
        if (nodes.some((node) => node.id === nodeId)) fail('GRAPH_EDIT_GENERATED_ID_COLLISION');
        const added = createAgentNode({
          nodes,
          manifest,
          request: { id: nodeId, position: nextNodePosition(nodes) },
          idFactory: () => `graph-edit-${stepIndex}`,
        });
        const componentDefinitions = manifest.customComposite === true ? [structuredClone(manifest)] : [];
        operations.push({ op: 'ADD_NODE', node: added, componentDefinitions });
        nodes.push(added);
        nodeIds.set(step.resultRef, nodeId);
      } else if (step.op === 'REMOVE_NODE') {
        const nodeId = nodeIds.get(step.nodeRef);
        if (!nodeId) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { field: 'nodeRef' });
        for (const edge of [...edges].filter((candidate) => candidate.source === nodeId || candidate.target === nodeId)) {
          operations.push({ op: 'DISCONNECT', edgeId: edge.id });
          edgeIds.delete([...edgeIds.entries()].find(([, value]) => value === edge.id)?.[0]);
          edges.splice(edges.findIndex((candidate) => candidate.id === edge.id), 1);
        }
        operations.push({ op: 'REMOVE_NODE', nodeId });
        nodes.splice(nodes.findIndex((candidate) => candidate.id === nodeId), 1);
      } else if (step.op === 'UPDATE_PARAMETERS') {
        const nodeId = nodeIds.get(step.nodeRef);
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (!node) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { field: 'nodeRef' });
        const parameters = { ...node.data.parameters };
        for (const change of step.changes) {
          const property = manifestForProperty(node, change.key);
          if (!property || !safeParameterValue(property, change.value)) fail('GRAPH_EDIT_PARAMETER_INVALID', { propertyKey: change.key });
          parameters[change.key] = change.value;
        }
        operations.push({ op: 'UPDATE_PARAMETERS', nodeId, parameters });
        node.data = { ...node.data, parameters, status: 'idle' };
      } else if (step.op === 'CONNECT') {
        const source = nodes.find((candidate) => candidate.id === nodeIds.get(step.sourceRef));
        const target = nodes.find((candidate) => candidate.id === nodeIds.get(step.targetRef));
        if (!source || !target) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { field: 'sourceRef/targetRef' });
        const edgeId = `lumi-${plan.requestId.replace(/[^A-Za-z0-9-]/g, '').slice(-24)}-e${stepIndex}`;
        if (edges.some((edge) => edge.id === edgeId)) fail('GRAPH_EDIT_GENERATED_ID_COLLISION');
        const edge = { id: edgeId, source: source.id, sourceHandle: step.sourcePort, target: target.id, targetHandle: step.targetPort, type: 'deletable' };
        operations.push({ op: 'CONNECT', edge });
        edges.push(edge);
      } else if (step.op === 'DISCONNECT') {
        const edgeId = edgeIds.get(step.edgeRef);
        if (!edgeId || !edges.some((candidate) => candidate.id === edgeId)) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { field: 'edgeRef' });
        operations.push({ op: 'DISCONNECT', edgeId });
        edges.splice(edges.findIndex((candidate) => candidate.id === edgeId), 1);
        edgeIds.delete(step.edgeRef);
      } else if (step.op === 'MOVE_NODE') {
        const node = nodes.find((candidate) => candidate.id === nodeIds.get(step.nodeRef));
        const anchor = nodes.find((candidate) => candidate.id === nodeIds.get(step.anchorRef));
        if (!node || !anchor || node === anchor) fail('GRAPH_EDIT_INTENT_REFERENCE_INVALID', { field: 'nodeRef/anchorRef' });
        const position = movePosition(node, anchor, step.relation);
        operations.push({ op: 'MOVE_NODE', nodeId: node.id, position });
        node.position = position;
      }
    }
    if (operations.length > GRAPH_EDIT_MAX_STEPS) fail('GRAPH_EDIT_TOO_MANY_OPERATIONS');
    const dryRun = dryRunGraphPatch(context.baseGraph, operations);
    if (!dryRun.ok) fail(dryRun.diagnostics[0]?.code ?? 'GRAPH_EDIT_PATCH_INVALID', dryRun.diagnostics[0]?.details ?? {});
    const source = {
      producer: planSource === 'provider' ? 'external-agent' : 'local-agent',
      provenance: {
        artifactId: `graph-edit-${plan.requestId.replace(/[^A-Za-z0-9-]/g, '').slice(-36)}`,
        revision: 'graph-edit-intent-v1',
        fingerprint: context.identity.semanticFingerprint,
        location: 'local-project',
      },
    };
    const created = createGraphPatchProposal({
      baseGraph: context.baseGraph,
      operations,
      source,
      rationale: GRAPH_EDIT_RATIONALE_CODE,
    });
    if (!created.ok) fail(created.diagnostics?.[0]?.code ?? 'GRAPH_EDIT_PATCH_INVALID', created.diagnostics?.[0]?.details ?? {});
    return { ok: true, proposal: created.proposal, resultGraph: created.resultGraph, operations: created.proposal.operations, operationCount: operations.length, semanticChanged: dryRun.graphIdentity.semanticFingerprint !== context.identity.semanticFingerprint };
  } catch (error) {
    return { ok: false, diagnostics: [{ code: error?.code ?? 'GRAPH_EDIT_PATCH_INVALID', ...(error?.details ? { details: structuredClone(error.details) } : {}) }] };
  }
}
