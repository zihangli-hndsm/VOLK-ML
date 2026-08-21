import { useMemo, useState } from 'react';
import { createAiDiagnostic, diagnosticText } from '../../core/ai/diagnostics.js';
import { createLearningAssistant } from '../../core/exploration/learningAssistant.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';

const MAX_SELECTED_QUOTE = 280;

function selectionQuote() {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return '';
  return String(window.getSelection()?.toString() ?? '').trim().slice(0, MAX_SELECTED_QUOTE);
}

function answerAnchor() {
  return {
    surface: 'agent-answer',
    contentId: 'ask-volk-answer',
    messageId: 'ask-volk-answer',
    localizationKey: 'ai.askAnswer',
  };
}

export default function AskVolkPanel({ agent, presentation, onOpenAiSettings, onTryExperiment, t }) {
  const { config, gateway, isConfigured } = useAiProvider();
  const assistant = useMemo(() => createLearningAssistant({ gateway }), [gateway]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [annotationMessage, setAnnotationMessage] = useState('');

  const anchor = answerAnchor();
  const captureSelection = () => {
    const quote = selectionQuote();
    if (quote) setSelectedQuote(quote);
  };

  const ask = async () => {
    if (!question.trim() || busy) return;
    if (!isConfigured) {
      setDiagnostic(createAiDiagnostic({ error: { code: 'AI_CONFIG_MISSING', message: 'Configure a provider to use Ask VOLK.' }, config, stage: 'configuration' }));
      return;
    }
    setBusy(true);
    setDiagnostic(null);
    setAnnotationMessage('');
    try {
      const context = agent.getLearningAssistantContext({
        presentation,
        selectedAnchor: selectedQuote ? anchor : null,
        selectedQuote: selectedQuote || null,
      });
      const nextAnswer = await assistant.ask({ question, config, context });
      agent.recordLearningTurn({ role: 'user', text: question });
      agent.recordLearningTurn({ role: 'assistant', text: nextAnswer.answer });
      setAnswer(nextAnswer);
    } catch (error) {
      setDiagnostic(createAiDiagnostic({ error, config, stage: 'failed' }));
    } finally {
      setBusy(false);
    }
  };

  const annotate = (kind) => {
    if (!answer) return;
    try {
      agent.addLearnerAnnotation({ kind, anchor, quote: selectedQuote || null });
      setAnnotationMessage(t('ai.annotationSaved'));
    } catch (error) {
      setDiagnostic(createAiDiagnostic({ error, config, stage: 'failed' }));
    }
  };

  const askAboutSelection = () => {
    if (!selectedQuote) return;
    setQuestion(`${t('ai.askSelectedPrefix')} “${selectedQuote}”`);
    setAnnotationMessage('');
  };

  return <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs leading-5 text-slate-600">{t('ai.askIntro')}</p>
    <div className="mt-3 flex gap-2">
      <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') ask(); }} placeholder={t('ai.askPlaceholder')} aria-label={t('ai.askPlaceholder')} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" />
      <button type="button" disabled={!question.trim() || busy} onClick={ask} className="ui-motion-interactive rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-500">{busy ? t('playground.agentGuide.working') : t('playground.agentGuide.ask')}</button>
    </div>
    {!isConfigured && <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{t('ai.askNeedsProvider')}</span><button type="button" onClick={onOpenAiSettings} className="rounded-lg px-2 py-1 font-bold text-violet-700 hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500">{t('ai.configure')}</button></div>}
    {answer && <section className="mt-3 rounded-xl border border-violet-100 bg-white p-3" aria-live="polite">
      <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">{t('ai.askAnswer')}</p>
      <p id="ask-volk-answer" data-annotation-surface="agent-answer" onMouseUp={captureSelection} onTouchEnd={captureSelection} className="mt-1 select-text text-sm leading-6 text-slate-800">{answer.answer}</p>
      {selectedQuote && <div className="mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-950"><p className="font-bold">{selectedQuote}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => annotate('understood')} className="rounded-lg bg-white px-2 py-1 font-bold ring-1 ring-violet-200">{t('ai.annotationUnderstood')}</button><button type="button" onClick={() => annotate('unclear')} className="rounded-lg bg-white px-2 py-1 font-bold ring-1 ring-violet-200">{t('ai.annotationUnclear')}</button><button type="button" onClick={askAboutSelection} className="rounded-lg bg-white px-2 py-1 font-bold ring-1 ring-violet-200">{t('ai.annotationAsk')}</button></div></div>}
      {annotationMessage && <p className="mt-2 text-xs font-bold text-emerald-700">{annotationMessage}</p>}
      {answer.tryExperiment && <button type="button" onClick={() => onTryExperiment?.(answer.tryExperiment)} className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('ai.tryInWorld')}</button>}
    </section>}
    {diagnostic && <section role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><p className="font-black">{t(`ai.diagnostic.${diagnostic.errorCode}`)}</p><details className="mt-1"><summary className="cursor-pointer font-mono text-[10px]">{diagnostic.errorCode}</summary><pre className="mt-1 max-w-full whitespace-pre-wrap">{diagnosticText(diagnostic)}</pre></details></section>}
  </div>;
}
