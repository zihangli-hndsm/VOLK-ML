import { createSemanticEventStore } from '../../exploration/semanticEvents.js';
import { acceptExecutionResultV1 } from '../../execution/executionContract.js';
import { createImportedAttentionEvidenceDraft, deriveImportedAttentionEvidence } from './profile.js';

export function createImportedAttentionEventStore() {
  return createSemanticEventStore({ limit: 24 });
}

export function commitImportedAttentionExecution(eventStore, executionResult, executionRequest, currentIdentity) {
  let accepted;
  try {
    accepted = acceptExecutionResultV1(executionResult, executionRequest, currentIdentity);
  } catch {
    return { evidence: null, semanticEvents: eventStore?.snapshot?.() ?? null, reason: 'invalid-execution-result' };
  }
  if (!accepted.accepted) {
    return { evidence: null, semanticEvents: eventStore?.snapshot?.() ?? null, reason: accepted.reason };
  }
  const comparison = accepted.output;
  const evidence = deriveImportedAttentionEvidence(comparison);
  const runIdentity = typeof comparison?.requestId === 'string'
    && /^g2-[A-Za-z0-9_-]{8,80}$/.test(comparison.requestId)
    ? comparison.requestId
    : null;
  if (!eventStore || !evidence || !runIdentity) {
    return { evidence: null, semanticEvents: eventStore?.snapshot?.() ?? null, reason: 'comparison-invalid' };
  }
  const experimentIds = [
    `g2-a-${runIdentity}`,
    `g2-b-${runIdentity}`,
  ];
  const drafts = [
    {
      type: 'comparison.completed', actor: 'human', experimentIds,
      semanticFactors: ['input-token-substitution'],
      semanticFactorPaths: ['input.token[4]'],
      operationTypes: ['COMPARE_EXPERIMENTS'], reasonCode: 'g2-one-token-comparison',
    },
  ];
  const detectorEvidence = createImportedAttentionEvidenceDraft(evidence, { modelHash: comparison.modelHash, experimentIds });
  if (detectorEvidence) drafts.push(detectorEvidence);
  eventStore.append(drafts);
  return { evidence, semanticEvents: eventStore.snapshot(), executionResult };
}
