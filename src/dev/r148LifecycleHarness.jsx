import { useMemo, useRef, useState } from 'react';
import { AiProviderContext } from '../components/ai/AiProviderContext.jsx';
import AskVolkPanel from '../components/playground/AskVolkPanel.jsx';
import TeachingDialoguePanel from '../components/playground/TeachingDialoguePanel.jsx';

const responseText = JSON.stringify({ answer: 'Deterministic fixture response.', tryExperiment: null, depth: null });
const teachingResponse = { origin: 'local', fallbackReason: null, move: 'OFFER_HINT', grounding: 'conceptual', evidenceRefs: [], expectedReplyKind: 'none', content: { key: 'episode.one.teachingDialogue.conceptual', params: {} }, contextRevision: 0, provisionalHypothesis: null };

export default function R148LifecycleHarness() {
  const [askSubmit, setAskSubmit] = useState(0);
  const [question, setQuestion] = useState('Why did the fit move?');
  const [events, setEvents] = useState([]);
  const [tick, setTick] = useState(0);
  const [contextRevision, setContextRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const askPending = useRef([]);
  const teachingPending = useRef([]);
  const turns = useRef(0);
  const gateway = useMemo(() => ({
    complete: ({ signal }) => new Promise((resolve, reject) => {
      const entry = { resolve: () => resolve({ text: responseText, protocol: 'fixture', model: 'fixture' }), reject };
      askPending.current.push(entry);
      signal?.addEventListener('abort', () => { entry.aborted = true; reject(Object.assign(new Error('aborted'), { code: 'AI_REQUEST_ABORTED' })); }, { once: true });
    }),
    recordTrace: () => {},
    getRequestTrace: () => [],
  }), []);
  const aiValue = useMemo(() => ({ config: { apiKey: 'fixture', model: 'fixture', protocol: 'openai-compatible' }, gateway, isConfigured: true }), [gateway]);
  const agent = useMemo(() => ({
    getLearningAssistantContext: () => ({ playground: { domain: 'fixture' }, inquiry: { stage: 'question' } }),
    recordLearningTurn: ({ role, text }) => ({ id: `turn-${++turns.current}`, role, text }),
  }), []);
  const snapshot = useMemo(() => ({
    bigIdea: { id: 'episode-1-sampling-variability' },
    teachingDialogue: { optedIn: true, stopped: false, assistanceDisabled: false, transferReady: false, context: { contextRevision, prediction: null, activeFit: null, activeComparison: null, evidence: null } },
  }), [contextRevision]);
  const host = useMemo(() => ({
    requestTeachingDialogue: () => new Promise((resolve, reject) => { teachingPending.current.push({ resolve: () => resolve({ ...teachingResponse, contextRevision }), reject }); }),
    cancelTeachingDialogueRequest: () => { const pending = teachingPending.current.at(-1); if (pending) pending.cancelled = true; },
    stopTeachingDialogue: () => {},
    beginTeachingTransfer: () => {},
    skipTeachingDialogue: () => {},
    optInTeachingDialogue: () => {},
  }), [contextRevision]);
  const record = (event) => setEvents((current) => [...current, { at: Date.now(), ...event }].slice(-80));
  // Deliberately inline: every parent action changes the callback identity. The
  // mounted child cleanup must still be reserved for unmount, not rerender.
  const lifecycle = (event) => record({ source: event.source, phase: event.phase, requestId: event.requestId });

  return <AiProviderContext.Provider value={aiValue}>
    <main>
      <h1>R148 mounted lifecycle harness</h1>
      <p data-harness-status>parent render {tick}; children {mounted ? 'mounted' : 'unmounted'}</p>
      <section>
        <button data-action="ask-start" onClick={() => setAskSubmit((value) => value + 1)}>Start Ask</button>
        <button data-action="ask-resolve" onClick={() => askPending.current.pop()?.resolve()}>Resolve Ask</button>
        <button data-action="ask-resolve-oldest" onClick={() => askPending.current.shift()?.resolve()}>Resolve Ask oldest</button>
        <button data-action="ask-reject" onClick={() => askPending.current.pop()?.reject(new Error('fixture failure'))}>Reject Ask</button>
        <button data-action="parent-rerender" onClick={() => setTick((value) => value + 1)}>Parent rerender</button>
        <button data-action="context-change" onClick={() => setContextRevision((value) => value + 1)}>Teaching context change</button>
        <button data-action="unmount" onClick={() => setMounted(false)}>Unmount children</button>
        <button data-action="reset" onClick={() => { setEvents([]); setMounted(true); setContextRevision(0); }}>Reset trace</button>
      </section>
      {mounted && <>
        <section><h2>AskVolkPanel</h2><AskVolkPanel agent={agent} presentation={{}} question={question} onQuestionChange={setQuestion} submitToken={askSubmit} onBusyChange={(busy) => record({ source: 'ask', phase: busy ? 'busy' : 'idle' })} onRequestLifecycle={lifecycle} onOpenAiSettings={() => {}} onTryExperiment={() => {}} t={(key) => key} /></section>
        <section><h2>TeachingDialoguePanel</h2><TeachingDialoguePanel snapshot={snapshot} host={host} onRequestLifecycle={lifecycle} t={(key) => key} language="en" /></section>
      </>}
      <section><h2>Trace</h2><pre id="r148-trace">{JSON.stringify(events, null, 2)}</pre><button data-action="teaching-resolve" onClick={() => teachingPending.current.pop()?.resolve()}>Resolve Teaching</button><button data-action="teaching-resolve-oldest" onClick={() => teachingPending.current.shift()?.resolve()}>Resolve Teaching oldest</button><button data-action="teaching-reject" onClick={() => teachingPending.current.pop()?.reject(new Error('fixture teaching failure'))}>Reject Teaching</button></section>
    </main>
  </AiProviderContext.Provider>;
}
