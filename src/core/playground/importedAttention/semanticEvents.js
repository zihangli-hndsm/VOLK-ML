import { createSemanticEventStore } from '../../exploration/semanticEvents.js';
import { createImportedAttentionEvidenceDraft, deriveImportedAttentionEvidence } from './profile.js';

export function createImportedAttentionEventStore() {
  return createSemanticEventStore({ limit: 24 });
}

export function commitImportedAttentionComparison(eventStore, comparison) {
  const evidence = deriveImportedAttentionEvidence(comparison);
  if (!eventStore || !evidence) {
    return { evidence: null, semanticEvents: eventStore?.snapshot?.() ?? null };
  }
  const experimentIds = [
    `g2-a-${comparison.modelHash.slice(-12)}`,
    `g2-b-${comparison.modelHash.slice(-12)}`,
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
  return { evidence, semanticEvents: eventStore.snapshot() };
}
