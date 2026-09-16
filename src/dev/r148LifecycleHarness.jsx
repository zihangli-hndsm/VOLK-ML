import { useMemo, useRef, useState } from 'react';
import { AiProviderContext } from '../components/ai/AiProviderContext.jsx';
import AskVolkPanel from '../components/playground/AskVolkPanel.jsx';
import TeachingDialoguePanel from '../components/playground/TeachingDialoguePanel.jsx';
import LumiCompanion from '../components/playground/LumiCompanion.jsx';
import { beginLumiRequest, cancelLumiRequest, consumeLumiFeedback, createLumiPresentationState, finishLumiRequest, surfaceLumiFeedback } from '../core/ui/lumiPresentationRuntime.js';

const responseText = JSON.stringify({ answer: 'Deterministic fixture response.', tryExperiment: null, depth: null });
const teachingResponse = { origin: 'local', fallbackReason: null, move: 'OFFER_HINT', grounding: 'conceptual', evidenceRefs: [], expectedReplyKind: 'none', content: { key: 'episode.one.teachingDialogue.conceptual', params: {} }, contextRevision: 0, provisionalHypothesis: null };

export default function R148LifecycleHarness() {
  const [askSubmit, setAskSubmit] = useState(0);
  const [question, setQuestion] = useState('Why did the fit move?');
  const [events, setEvents] = useState([]);
  const [tick, setTick] = useState(0);
  const [contextRevision, setContextRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [teachingStopped, setTeachingStopped] = useState(false);
  const [presentation, setPresentation] = useState(() => createLumiPresentationState({ contextId: 'r148-harness' }));
  const [targetReady, setTargetReady] = useState(true);
  const [semanticAction, setSemanticAction] = useState('GUIDE');
  const askPending = useRef([]);
  const teachingPending = useRef([]);
  const turns = useRef(0);
  const askCalls = useRef(0);
  const teachingCalls = useRef(0);
  const gateway = useMemo(() => ({
    complete: ({ signal }) => new Promise((resolve, reject) => {
      askCalls.current += 1;
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
    teachingDialogue: { optedIn: true, stopped: teachingStopped, assistanceDisabled: false, transferReady: false, context: { contextRevision, prediction: null, activeFit: null, activeComparison: null, evidence: null } },
  }), [contextRevision, teachingStopped]);
  const host = useMemo(() => ({
    requestTeachingDialogue: () => new Promise((resolve, reject) => { teachingCalls.current += 1; teachingPending.current.push({ resolve: () => resolve({ ...teachingResponse, contextRevision }), reject }); }),
    cancelTeachingDialogueRequest: () => { const pending = teachingPending.current.at(-1); if (pending) pending.cancelled = true; },
    stopTeachingDialogue: () => setTeachingStopped(true),
    beginTeachingTransfer: () => {},
    skipTeachingDialogue: () => {},
    optInTeachingDialogue: () => {},
  }), [contextRevision]);
  const record = (event) => setEvents((current) => [...current, { at: Date.now(), ...event }].slice(-80));
  // Deliberately inline: every parent action changes the callback identity. The
  // mounted child cleanup must still be reserved for unmount, not rerender.
  const lifecycle = (event) => record({ source: event.source, phase: event.phase, requestId: event.requestId });
  const presentationLifecycle = (event) => {
    lifecycle(event);
    setPresentation((current) => {
      if (event.phase === 'start') return beginLumiRequest(current, event);
      if (event.phase === 'success') return finishLumiRequest(current, { requestId: event.requestId, status: 'success', feedbackEvent: event.feedbackEvent });
      if (event.phase === 'error' || event.phase === 'cancel') return cancelLumiRequest(current, event.requestId);
      if (event.phase === 'finish') return finishLumiRequest(current, { requestId: event.requestId, status: 'success' });
      return current;
    });
  };

  return <AiProviderContext.Provider value={aiValue}>
    <main>
      <h1>R148 mounted lifecycle harness</h1>
      <p data-harness-status>parent render {tick}; children {mounted ? 'mounted' : 'unmounted'}</p>
      <p data-harness-calls>ask calls {askCalls.current}; teaching calls {teachingCalls.current}</p>
      <section>
        <button data-action="ask-start" onClick={() => setAskSubmit((value) => value + 1)}>Start Ask</button>
        <button data-action="ask-resolve" onClick={() => askPending.current.pop()?.resolve()}>Resolve Ask</button>
        <button data-action="ask-resolve-oldest" onClick={() => askPending.current.shift()?.resolve()}>Resolve Ask oldest</button>
        <button data-action="ask-reject" onClick={() => askPending.current.pop()?.reject(new Error('fixture failure'))}>Reject Ask</button>
        <button data-action="parent-rerender" onClick={() => setTick((value) => value + 1)}>Parent rerender</button>
        <button data-action="context-change" onClick={() => setContextRevision((value) => value + 1)}>Teaching context change</button>
        <button data-action="unmount" onClick={() => { setMounted(false); setSemanticAction('STAY_SILENT'); }}>Unmount children</button>
        <button data-action="reset" onClick={() => { setEvents([]); setMounted(true); setTeachingStopped(false); setContextRevision((value) => value + 1); askCalls.current = 0; teachingCalls.current = 0; setPresentation(createLumiPresentationState({ contextId: 'r148-harness' })); setTargetReady(true); setSemanticAction('STAY_SILENT'); }}>Reset trace</button>
        <button data-action="surface-concept" onClick={() => setPresentation((current) => surfaceLumiFeedback(current, { id: 'r148-concept-1', kind: 'concept', source: 'runtime', evidenceId: 'evidence-1', target: 'ideas.map' }))}>Surface concept</button>
        <button data-action="consume-concept" onClick={() => setPresentation((current) => consumeLumiFeedback(current, 'r148-concept-1'))}>Consume concept</button>
        <button data-action="silent" onClick={() => setSemanticAction('STAY_SILENT')}>STAY_SILENT</button>
        <button data-action="restore-guide" onClick={() => setSemanticAction('GUIDE')}>Restore GUIDE</button>
        <button data-action="withdraw-target" onClick={() => setTargetReady(false)}>Withdraw target</button>
        <button data-action="restore-target" onClick={() => setTargetReady(true)}>Restore target</button>
      </section>
      <section><h2>LUMI presentation runtime</h2><LumiCompanion snapshot={snapshot} attention={{ semanticTarget: 'model.fit' }} semanticAction={semanticAction} semanticTarget="model.fit" meaningfulResult={false} askBusy={Boolean(presentation.activeRequest)} presentation={presentation} resolvedTarget={targetReady ? { status: 'ready', target: { controlId: 'episode-fit-a', key: 'model.fit', courseId: 'episode-1' } } : { status: 'missing', target: null }} guidanceDismissed={false} onDismissGuidance={() => setSemanticAction('STAY_SILENT')} onPresentationFeedbackConsumed={(id) => setPresentation((current) => consumeLumiFeedback(current, id))} onOpenGuidance={() => record({ source: 'lumi', phase: 'open-guidance' })} onOpenEvidence={() => record({ source: 'lumi', phase: 'open-evidence' })} onOpenIdeas={() => record({ source: 'lumi', phase: 'open-ideas' })} onOpenSettings={() => {}} isConfigured t={(key) => key} /></section>
      {mounted && <>
        <section><h2>AskVolkPanel</h2><AskVolkPanel agent={agent} presentation={presentation} question={question} onQuestionChange={setQuestion} submitToken={askSubmit} onBusyChange={(busy) => record({ source: 'ask', phase: busy ? 'busy' : 'idle' })} onRequestLifecycle={presentationLifecycle} onOpenAiSettings={() => {}} onTryExperiment={() => {}} t={(key) => key} /></section>
        <section><h2>TeachingDialoguePanel</h2><TeachingDialoguePanel snapshot={snapshot} host={host} onRequestLifecycle={presentationLifecycle} t={(key) => key} language="en" /></section>
      </>}
      <section><h2>Trace</h2><pre id="r148-trace">{JSON.stringify(events, null, 2)}</pre><button data-action="teaching-resolve" onClick={() => teachingPending.current.pop()?.resolve()}>Resolve Teaching</button><button data-action="teaching-resolve-oldest" onClick={() => teachingPending.current.shift()?.resolve()}>Resolve Teaching oldest</button><button data-action="teaching-reject" onClick={() => teachingPending.current.pop()?.reject(new Error('fixture teaching failure'))}>Reject Teaching</button></section>
    </main>
  </AiProviderContext.Provider>;
}
