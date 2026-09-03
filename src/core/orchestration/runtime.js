import { deriveOrchestrationProjection } from './projection.js';

export const ORCHESTRATION_RUNTIME_VERSION = 1;
const MAX_MEMORY_ENTRIES = 12;

const cleanMemory = (memory = {}) => ({
  prediction: memory.prediction ?? null,
  reflection: memory.reflection ?? null,
  continuationId: memory.continuationId ?? null,
  encounteredConcepts: Array.isArray(memory.encounteredConcepts) ? memory.encounteredConcepts.slice(-MAX_MEMORY_ENTRIES) : [],
  interpretations: Array.isArray(memory.interpretations) ? memory.interpretations.slice(-MAX_MEMORY_ENTRIES) : [],
  guidance: Array.isArray(memory.guidance) ? memory.guidance.slice(-MAX_MEMORY_ENTRIES) : [],
});

export function createOrchestrationRuntime({ contract, explorationHost = null, memory = {} } = {}) {
  let state = cleanMemory(memory);
  const runtime = {
    version: ORCHESTRATION_RUNTIME_VERSION,
    contract,
    explorationHost,
    getMemory: () => structuredClone(state),
    setMemory(next = {}) { state = cleanMemory({ ...state, ...next }); return runtime.getMemory(); },
    recordPrediction(prediction) { state = cleanMemory({ ...state, prediction: prediction ? structuredClone(prediction) : null }); return runtime.getMemory(); },
    recordReflection(reflection) { state = cleanMemory({ ...state, reflection: reflection ? structuredClone(reflection) : null }); return runtime.getMemory(); },
    recordInterpretation(interpretation) { state = cleanMemory({ ...state, interpretations: [...state.interpretations, structuredClone(interpretation)].slice(-MAX_MEMORY_ENTRIES) }); return runtime.getMemory(); },
    chooseContinuation(continuationId) {
      if (!(contract?.continuations ?? []).some((item) => item.id === continuationId)) return false;
      state = cleanMemory({ ...state, continuationId });
      return true;
    },
    dismissGuidance(stageId, actionId) {
      state = cleanMemory({ ...state, guidance: [...state.guidance, { stageId, actionId, dismissed: true }].slice(-MAX_MEMORY_ENTRIES) });
      return runtime.getMemory();
    },
    derive({ snapshot = null, semanticEvents = [], idleCategory = 'none' } = {}) {
      return deriveOrchestrationProjection({ contract, snapshot, semanticEvents, memory: state, idleCategory, recentGuidance: state.guidance, dismissed: state.guidance.at(-1)?.dismissed === true });
    },
  };
  return Object.freeze(runtime);
}

export function deriveOrchestrationState(options = {}) {
  return createOrchestrationRuntime(options).derive(options);
}
