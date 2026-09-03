import { messages } from '../../locales/ui.js';
import { getExplorationContract, getOrchestrationContract } from '../exploration/inquiryContracts.js';
import { INQUIRY_CONCEPT_REGISTRY } from '../exploration/learnerInquiry.js';
import { LUMI_ACTION_TYPES } from '../exploration/inquiryContracts.js';
import { isSemanticAffordanceTarget } from './targets.js';
import { ORCHESTRATION_FALLBACK_LEVELS } from './fallback.js';

export const ORCHESTRATION_SCHEMA_VERSION = 1;
const fallbackLevels = new Set(Object.values(ORCHESTRATION_FALLBACK_LEVELS));

const localizationExists = (key) => !key || Boolean(messages[key]);

export function validateOrchestrationContractV1(contract, { knownEvidenceIds = [], knownConceptIds = Object.keys(INQUIRY_CONCEPT_REGISTRY) } = {}) {
  const errors = [];
  if (contract?.version !== ORCHESTRATION_SCHEMA_VERSION || typeof contract?.id !== 'string' || !contract.id) errors.push('identity');
  if (!getExplorationContract(contract?.explorationContractId) && contract?.explorationContractId !== contract?.id) errors.push('explorationContractId');
  const stages = Array.isArray(contract?.stages) ? contract.stages : [];
  if (!stages.length) errors.push('stages.empty');
  const ids = new Set();
  for (const stage of stages) {
    if (!stage?.id || ids.has(stage.id)) errors.push(`stage.duplicate:${stage?.id ?? 'missing'}`);
    ids.add(stage?.id);
    for (const next of stage?.next ?? []) if (!stages.some((candidate) => candidate.id === next)) errors.push(`stage.next:${stage.id}:${next}`);
    if (!localizationExists(stage?.questionKey) || !localizationExists(stage?.goalKey)) errors.push(`stage.localization:${stage.id}`);
    for (const target of stage?.targets ?? []) if (!isSemanticAffordanceTarget(target)) errors.push(`target:${target}`);
    for (const level of stage?.fallbackLevels ?? []) if (!fallbackLevels.has(level)) errors.push(`fallback:${stage.id}:${level}`);
  }
  const entry = contract?.entryStage ?? stages[0]?.id;
  if (!entry || !ids.has(entry)) errors.push('entryStage');
  for (const stageId of contract?.fallbackSpine ?? []) if (!ids.has(stageId)) errors.push(`fallbackSpine:${stageId}`);
  if (Array.isArray(contract?.fallbackSpine) && contract.fallbackSpine.length && contract.fallbackSpine[0] !== entry) errors.push('fallbackSpine.entry');
  for (const stage of stages) for (const action of stage?.guidance?.actions ?? []) if (!LUMI_ACTION_TYPES.includes(action)) errors.push(`stage.action:${stage.id}:${action}`);
  for (const id of contract?.evidenceRequirements ?? []) if (knownEvidenceIds.length && !knownEvidenceIds.includes(id)) errors.push(`evidence:${id}`);
  for (const id of contract?.conceptRequirements ?? []) if (knownConceptIds.length && !knownConceptIds.includes(id)) errors.push(`concept:${id}`);
  for (const action of contract?.agentPolicy?.actionTypes ?? []) if (!LUMI_ACTION_TYPES.includes(action)) errors.push(`action:${action}`);
  for (const item of contract?.continuations ?? []) {
    if (!item?.id || !item?.questionKey || !localizationExists(item.questionKey)) errors.push(`continuation:${item?.id ?? 'missing'}`);
  }
  return { valid: errors.length === 0, errors };
}

export const validateOrchestrationContract = validateOrchestrationContractV1;
