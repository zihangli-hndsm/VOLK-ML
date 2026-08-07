import { validateTraceEvent } from './traceTypes.js';

// Deterministic trace recorder. `timestamp` equals the event index so replay
// produces byte-identical traces for identical action sequences.
export function createTraceRecorder(initial = []) {
  const traces = structuredClone(initial);
  let counter = traces.length;
  return {
    emit(type, payload = {}) {
      const event = {
        id: `trace-${counter}`,
        type,
        step: counter,
        timestamp: counter,
        payload: structuredClone(payload),
      };
      validateTraceEvent(event);
      traces.push(event);
      counter += 1;
      return event;
    },
    list() {
      return traces.map((event) => structuredClone(event));
    },
  };
}
