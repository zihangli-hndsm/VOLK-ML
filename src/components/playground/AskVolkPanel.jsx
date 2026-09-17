import { useEffect, useMemo, useRef, useState } from 'react';
import { createAiDiagnostic } from '../../core/ai/diagnostics.js';
import { createLearningAssistant } from '../../core/exploration/learningAssistant.js';
import { AGENT_TASK_MODES } from '../../core/ai/agentRequestContract.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';
import AiDiagnosticPanel from '../ai/AiDiagnosticPanel.jsx';
import LearningContextDisclosure from './LearningContextDisclosure.jsx';
import { InstructionalAnnotationActions, instructionalAnchor, selectedTextWithin } from './InstructionalAnnotationSurface.jsx';

function initialSelectionFor(value) {
  if (!value?.anchor || !value?.quote) return null;
  return { messageId: value.messageId ?? value.anchor.messageId ?? null, anchor: value.anchor, quote: value.quote };
}

export default function AskVolkPanel({ agent, presentation, initialSelection = null, question, onQuestionChange, submitToken = 0, onBusyChange, onRequestLifecycle, onOpenAiSettings, onTryExperiment, t }) {
  const { config, gateway, isConfigured } = useAiProvider();
  const assistant = useMemo(() => createLearningAssistant({ gateway }), [gateway]);
  const [answer, setAnswer] = useState(null);
  const [selection, setSelection] = useState(initialSelectionFor(initialSelection));
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [annotationMessage, setAnnotationMessage] = useState('');
  // A remounted Ask panel must not replay a token that was already consumed
  // before the learner switched Agent modes.
  const handledSubmitToken = useRef(submitToken);
  const activeRequestId = useRef(null);
  const abortController = useRef(null);
  const requestSequence = useRef(0);
  const mounted = useRef(false);
  const lifecycleRef = useRef(onRequestLifecycle);

  useEffect(() => { lifecycleRef.current = onRequestLifecycle; }, [onRequestLifecycle]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setSelection(initialSelectionFor(initialSelection));
    if (initialSelection?.quote) onQuestionChange(`${t('ai.askSelectedPrefix')} “${initialSelection.quote}”`);
  }, [initialSelection?.messageId, initialSelection?.quote, initialSelection?.anchor?.contentId, onQuestionChange, t]);

  const answerIdentity = answer?.messageId ?? null;
  const answerAnchor = answerIdentity
    ? instructionalAnchor({ surface: 'agent-answer', contentId: `${answerIdentity}.answer`, messageId: answerIdentity, localizationKey: 'ai.askAnswer' })
    : null;
  const captureAnswerSelection = (event) => {
    const quote = selectedTextWithin(event.currentTarget);
    if (!quote || !answerIdentity) return;
    setSelection({ messageId: answerIdentity, anchor: answerAnchor, quote });
  };

  const ask = async () => {
    if (!question.trim() || busy) return;
    if (!isConfigured) {
      setDiagnostic(createAiDiagnostic({ error: { code: 'AI_CONFIG_MISSING', message: 'Configure a provider to use Ask VOLK.' }, config, stage: 'configuration' }));
      return;
    }
    const sequence = ++requestSequence.current;
    const requestId = `ask-${Date.now()}-${handledSubmitToken.current}-${sequence}`;
    activeRequestId.current = requestId;
    abortController.current?.abort();
    abortController.current = typeof AbortController === 'function' ? new AbortController() : null;
    setBusy(true);
    onBusyChange?.(true);
    onRequestLifecycle?.({ phase: 'start', source: 'ask', requestId });
    setDiagnostic(null);
    setAnnotationMessage('');
    try {
      const context = agent.getLearningAssistantContext({
        presentation,
        selectedAnchor: selection?.anchor ?? null,
        selectedQuote: selection?.quote ?? null,
      });
      const nextAnswer = await assistant.ask({ question, config, context, taskMode: AGENT_TASK_MODES.ASK, requestId, signal: abortController.current?.signal });
      const current = mounted.current && activeRequestId.current === requestId && requestSequence.current === sequence;
      if (!current) return null;
      agent.recordLearningTurn({ role: 'user', text: question });
      const assistantTurn = agent.recordLearningTurn({ role: 'assistant', text: nextAnswer.answer });
      setAnswer({ ...nextAnswer, messageId: assistantTurn?.id ?? null });
      setSelection(null);
      onRequestLifecycle?.({ phase: 'success', source: 'ask', requestId, feedbackEvent: { id: `ask:${assistantTurn?.id ?? requestId}`, kind: 'answer', source: 'ask', target: 'ideas.map' } });
    } catch (error) {
      if (mounted.current && activeRequestId.current === requestId && requestSequence.current === sequence) {
        setDiagnostic(createAiDiagnostic({ error, config, stage: 'failed', requestId }));
        onRequestLifecycle?.({ phase: 'error', source: 'ask', requestId });
      }
    } finally {
      if (mounted.current && activeRequestId.current === requestId && requestSequence.current === sequence) {
        setBusy(false);
        onBusyChange?.(false);
        onRequestLifecycle?.({ phase: 'finish', source: 'ask', requestId });
        activeRequestId.current = null;
      }
    }
  };

  useEffect(() => () => {
    requestSequence.current += 1;
    abortController.current?.abort();
    if (activeRequestId.current) lifecycleRef.current?.({ phase: 'cancel', source: 'ask', requestId: activeRequestId.current });
    activeRequestId.current = null;
  }, []);

  useEffect(() => {
    if (!submitToken || submitToken === handledSubmitToken.current) return;
    handledSubmitToken.current = submitToken;
    ask();
  }, [submitToken]);

  const askAboutSelection = (selected) => {
    if (!selected?.quote) return;
    onQuestionChange(`${t('ai.askSelectedPrefix')} “${selected.quote}”`);
    setAnnotationMessage('');
  };

  const context = agent.getLearningAssistantContext({
    presentation,
    selectedAnchor: selection?.anchor ?? null,
    selectedQuote: selection?.quote ?? null,
  });

  return <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs leading-5 text-slate-600">{t('ai.askIntro')}</p>
    {!isConfigured && <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{t('ai.askNeedsProvider')}</span><button type="button" onClick={onOpenAiSettings} className="rounded-lg px-2 py-1 font-bold text-violet-700 hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500">{t('ai.configure')}</button></div>}
    <LearningContextDisclosure context={context} selection={selection} onClearSelection={() => setSelection(null)} t={t} />
    {answer && <section className="mt-3 rounded-xl border border-violet-100 bg-white p-3" aria-live="polite">
      <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">{t('ai.askAnswer')}</p>
      <p data-annotation-surface="agent-answer" onMouseUp={captureAnswerSelection} onTouchEnd={captureAnswerSelection} className="mt-1 select-text text-sm leading-6 text-slate-800">{answer.answer}</p>
      {selection?.messageId === answerIdentity && <InstructionalAnnotationActions selection={selection} agent={agent} onAskAbout={askAboutSelection} t={t} />}
      {annotationMessage && <p className="mt-2 text-xs font-bold text-emerald-700">{annotationMessage}</p>}
      {answer.tryExperiment && <button type="button" onClick={() => onTryExperiment?.(answer.tryExperiment)} className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('ai.tryInWorld')}</button>}
    </section>}
    <AiDiagnosticPanel diagnostic={diagnostic} trace={gateway.getRequestTrace?.()} t={t} />
  </div>;
}
