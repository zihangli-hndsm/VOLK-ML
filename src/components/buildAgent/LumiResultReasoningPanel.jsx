import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createAgentApplicationResultBinding } from '../../core/agentApplicationApi.js';
import {
  createLocalLumiResultReasoning,
  createLlmLumiResultReasoningPolicy,
  createLumiResultReasoningContext,
} from '../../core/buildAgent/lumiResultReasoning.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';

function displayFactValue(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toPrecision(5).replace(/\.?0+$/, '');
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

function safeHistoryStatus(record, currentAttemptId, t) {
  if (record.status === 'succeeded') return t(record.attemptId === currentAttemptId ? 'lumiResult.history.current' : 'lumiResult.history.historical');
  if (record.status === 'running') return t('lumiResult.history.running');
  return t('lumiResult.history.failed');
}

export default function LumiResultReasoningPanel({
  nodes,
  edges,
  customComponents = [],
  dataset,
  runtime,
  resultBinding,
  runHistory = [],
  language = 'en',
  onSelectSuggestion,
  t,
}) {
  const { config, gateway, isConfigured } = useAiProvider();
  const policy = useMemo(() => createLlmLumiResultReasoningPolicy({ gateway }), [gateway]);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState('idle');
  const [outcome, setOutcome] = useState(null);
  const controllerRef = useRef(null);
  const generationRef = useRef(0);

  const currentBinding = useMemo(() => {
    try { return createAgentApplicationResultBinding({ nodes, edges, customComponents, dataset }); }
    catch { return null; }
  }, [nodes, edges, customComponents, dataset]);
  const reasoningState = useMemo(() => {
    try {
      return createLumiResultReasoningContext({
        history: runHistory,
        graph: { nodes, edges, customComponents },
        dataset,
        runtime,
        resultBinding,
        currentBinding,
      });
    } catch {
      return { current: false, context: null };
    }
  }, [runHistory, nodes, edges, customComponents, dataset, runtime, resultBinding, currentBinding]);
  const contextStamp = JSON.stringify({
    current: reasoningState.current,
    attemptId: runHistory.at(-1)?.attemptId ?? null,
    currentGraph: currentBinding?.graphSemanticFingerprint ?? null,
    currentDataset: currentBinding?.datasetFingerprint ?? null,
  });
  const latestRef = useRef(null);
  latestRef.current = { contextStamp, config, gateway, isConfigured };

  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setOutcome(null);
    setConsent(false);
    setStatus('idle');
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [contextStamp, config, gateway, isConfigured]);

  const generate = async () => {
    if (!reasoningState.current || !reasoningState.context) return;
    controllerRef.current?.abort();
    const generation = ++generationRef.current;
    const requestStamp = contextStamp;
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('working');
    setOutcome(null);
    const localFallback = createLocalLumiResultReasoning(reasoningState.context);
    if (!consent || !isConfigured || !config) {
      if (generation !== generationRef.current) return;
      setOutcome(localFallback);
      setStatus('local');
      setConsent(false);
      return;
    }
    try {
      const result = await policy.decide({
        context: reasoningState.context,
        requestId: `lumi-result-${crypto.randomUUID()}`,
        language,
        config,
        consent: true,
        signal: controller.signal,
      });
      const latest = latestRef.current;
      if (generation !== generationRef.current || latest.contextStamp !== requestStamp || latest.config !== config || latest.gateway !== gateway) return;
      setOutcome(result);
      setStatus('provider');
    } catch {
      const latest = latestRef.current;
      if (generation !== generationRef.current || latest.contextStamp !== requestStamp) return;
      setOutcome(localFallback);
      setStatus('fallback');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setConsent(false);
    }
  };

  const availableFacts = new Map((reasoningState.context?.facts ?? []).map((fact) => [fact.factId, fact]));
  const currentAttemptId = reasoningState.current && runHistory.at(-1)?.status === 'succeeded'
    ? runHistory.at(-1).attemptId
    : null;
  const hasHistory = runHistory.length > 0;
  if (!hasHistory) return null;

  return <section className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4" data-lumi-result-reasoning data-lumi-result-current={String(reasoningState.current)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-indigo-700">{t('lumiResult.eyebrow')}</p>
        <h3 className="mt-1 text-lg font-black text-slate-950">{t('lumiResult.title')}</h3>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">{t(reasoningState.current ? 'lumiResult.current' : 'lumiResult.stale')}</p>
      </div>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">{t('lumiResult.understandingNotAssessed')}</span>
    </div>

    <div className="mt-4 flex flex-wrap gap-2" aria-label={t('lumiResult.runHistoryLabel')}>
      {runHistory.slice(-8).map((record, index) => {
        const freshness = record.status === 'succeeded'
          ? record.attemptId === currentAttemptId ? 'current' : 'historical'
          : record.status;
        return <div key={record.attemptId} className="rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs" data-run-history-status={record.status} data-run-history-freshness={freshness} data-run-history-attempt-id={record.attemptId}>
        <span className="font-bold">{t('lumiResult.runOrdinal', { number: Math.max(1, runHistory.length - Math.min(runHistory.length, 8) + index + 1) })}</span>
        <span className="ml-2 text-slate-600">{safeHistoryStatus(record, currentAttemptId, t)}</span>
        {record.status === 'failed' && record.errorCode && <span className="ml-2 font-mono text-slate-400">{record.errorCode}</span>}
        {record.status === 'succeeded' && Object.entries(record.metrics).slice(0, 3).map(([key, value]) => <span key={key} className="ml-2 font-mono text-slate-500">{key}: {displayFactValue(value)}</span>)}
      </div>;
      })}
    </div>

    {reasoningState.current ? <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-white bg-white/80 p-3 text-xs leading-5 text-slate-600" data-lumi-result-privacy>
        <p className="font-bold">{t('lumiResult.privacyTitle')}</p>
        <p className="mt-1">{t('lumiResult.privacyDetails')}</p>
      </div>
      {isConfigured && <label className="flex items-start gap-3 rounded-xl border border-white bg-white/80 p-3 text-sm text-slate-700">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-4 accent-indigo-600" data-lumi-result-consent />
        <span>{t('lumiResult.providerConsent')}</span>
      </label>}
      <button type="button" onClick={generate} disabled={status === 'working'} className="rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" data-lumi-result-generate>
        {status === 'working' ? t('lumiResult.working') : t('lumiResult.generate')}
      </button>
      {status === 'fallback' && <p role="status" className="text-sm text-amber-800">{t('lumiResult.localFallback')}</p>}
      {status === 'local' && <p role="status" className="text-xs text-slate-500">{t('lumiResult.localOnly')}</p>}
      {outcome && <div className="space-y-2" data-lumi-result-outcome={outcome.source}>
        {outcome.statements.map((statement, index) => <article key={`${index}-${statement.localKey ?? statement.text}`} className="rounded-xl bg-white p-3 text-sm leading-6 text-slate-800">
          <p>{statement.localKey ? t(statement.localKey) : statement.text}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {statement.factIds.map((factId) => {
              const fact = availableFacts.get(factId);
              if (!fact) return null;
              return <span key={factId} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{fact.labelKey === 'lumiResult.fact.metric' ? t(fact.labelKey, { name: factId.slice('fact.metric.'.length) }) : t(fact.labelKey)}: <span className="font-mono font-bold">{displayFactValue(fact.value)}</span></span>;
            })}
          </div>
        </article>)}
        {outcome.suggestions.length > 0 && <div className="flex flex-wrap gap-2 pt-1">
          {outcome.suggestions.filter((suggestion) => suggestion.authority === 'suggestion-only' && suggestion.requiresLearnerAcceptance === true).map(({ id }) => <button type="button" key={id} onClick={() => onSelectSuggestion?.(id)} className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-800 hover:bg-indigo-100" data-lumi-result-suggestion={id}>{t(`lumiResult.suggestion.${id}`)}</button>)}
        </div>}
      </div>}
    </div> : <div className="mt-3 rounded-xl bg-white/80 p-3 text-sm text-slate-600">{t(runHistory.at(-1)?.status === 'failed' ? 'lumiResult.noCurrentFailed' : 'lumiResult.noCurrent')}</div>}
  </section>;
}
