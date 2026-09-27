import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  askExplanationAgent,
  buildGraphExplanationRequestV1,
  buildLocalDepthContent,
  currentGraphRunEvidenceV1,
  depthForDeclaredTechnicality,
  graphExplanationContextFingerprint,
  localGraphExplanationReply,
  GRAPH_EXPLANATION_DEPTHS,
  GRAPH_EXPLANATION_TECHNICALITY_PREFERENCES,
} from '../core/explanation.js';
import { stageStyles } from '../core/visualLanguage.js';
import { useAiProvider } from './ai/AiProviderContext.jsx';

const DEPTH_KEYS = Object.freeze({
  phenomenon: 'agent.depth.phenomenon',
  evidence: 'agent.depth.evidence',
  mechanism: 'agent.depth.mechanism',
  representation: 'agent.depth.representation',
  math: 'agent.depth.math',
  code: 'agent.depth.code',
});

const TECHNICALITY_KEYS = Object.freeze({
  'big-picture': 'agent.technicality.bigPicture',
  'how-it-works': 'agent.technicality.howItWorks',
  'technical-detail': 'agent.technicality.technicalDetail',
});

function metricSummary(metrics = {}, t) {
  return Object.entries(metrics).map(([key, value]) => `${t(`agent.metric.${key}`)}: ${Number(value).toPrecision(4)}`).join(' · ');
}

function sameScopeFields(left, right) {
  return Boolean(left && right
    && left.requestFingerprint === right.requestFingerprint
    && left.config === right.config
    && left.gateway === right.gateway
    && left.fundingMode === right.fundingMode
    && left.isConfigured === right.isConfigured
    && left.dataset === right.dataset
    && left.model === right.model
    && left.runtime === right.runtime
    && left.resultBinding === right.resultBinding
    && left.technicality === right.technicality);
}

function consentMatchesScope(consent, scope) {
  return sameScopeFields(consent, scope) && consent.contextRevision === scope.contextRevision;
}

export default function ExplanationDialog({
  open, nodes, edges, customComponents = [], dataset, model, runtime, resultBinding,
  language, onClose, t,
}) {
  const { config, gateway, fundingMode, isConfigured, openSettings } = useAiProvider();
  const analysis = useMemo(() => buildLocalDepthContent({ nodes, edges, depth: 'phenomenon' }).analysis, [nodes, edges]);
  const runEvidence = useMemo(() => currentGraphRunEvidenceV1({
    nodes, edges, customComponents, dataset, model, runtime, resultBinding,
  }), [nodes, edges, customComponents, dataset, model, runtime, resultBinding]);
  const [technicality, setTechnicality] = useState('big-picture');
  const [depth, setDepth] = useState(() => depthForDeclaredTechnicality('big-picture'));
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]);
  const [providerConsent, setProviderConsent] = useState(null);
  const [loading, setLoading] = useState(false);
  const activeRequestContextRef = useRef({ scope: null, revision: 0 });
  const providerConsentRef = useRef(null);
  const requestControllerRef = useRef(null);
  const depthContent = useMemo(() => buildLocalDepthContent({ nodes, edges, depth, runEvidence }), [nodes, edges, depth, runEvidence]);
  const request = useMemo(() => {
    const trimmed = question.trim();
    if (!trimmed) return null;
    try {
      return buildGraphExplanationRequestV1({ nodes, edges, depth, question: trimmed, language, runEvidence });
    } catch {
      return null;
    }
  }, [nodes, edges, depth, question, language, runEvidence]);
  const requestFingerprint = useMemo(() => graphExplanationContextFingerprint(request), [request]);
  const currentScopeFields = { requestFingerprint, config, gateway, fundingMode, isConfigured, dataset, model, runtime, resultBinding, technicality };
  if (!sameScopeFields(activeRequestContextRef.current.scope, currentScopeFields)) {
    activeRequestContextRef.current = {
      scope: currentScopeFields,
      revision: activeRequestContextRef.current.revision + 1,
    };
  }
  const consentScope = { ...currentScopeFields, contextRevision: activeRequestContextRef.current.revision };
  const hasProviderConsent = consentMatchesScope(providerConsent, consentScope);

  const clearProviderConsent = () => {
    providerConsentRef.current = null;
    setProviderConsent(null);
  };

  const setCurrentProviderConsent = (enabled) => {
    const binding = enabled && request && isConfigured ? {
      ...consentScope,
    } : null;
    providerConsentRef.current = binding;
    setProviderConsent(binding);
  };

  const selectTechnicality = (nextTechnicality) => {
    if (nextTechnicality === technicality) return;
    clearProviderConsent();
    setTechnicality(nextTechnicality);
    setDepth(depthForDeclaredTechnicality(nextTechnicality));
  };

  useLayoutEffect(() => {
    if (providerConsentRef.current) clearProviderConsent();
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setLoading(false);
  }, [requestFingerprint, config, gateway, fundingMode, isConfigured, dataset, model, runtime, resultBinding, technicality]);

  useLayoutEffect(() => () => requestControllerRef.current?.abort(), []);

  if (!open) return null;

  const localReply = () => {
    const facts = localGraphExplanationReply({ depth, analysis, runEvidence });
    const params = {
      nodes: facts.nodeCount,
      edges: facts.edgeCount,
      missing: facts.missingInputCount,
      runState: t(facts.hasCurrentRun ? 'agent.evidence.current' : 'agent.evidence.none'),
      metrics: facts.hasCurrentRun ? t('agent.evidence.metricValues', { values: metricSummary(facts.metrics, t) }) : '',
    };
    return t(`agent.localReply.${depth}`, params);
  };

  const appendReply = (prompt, reply, source, factIds = []) => {
    setHistory((current) => [...current, { role: 'user', content: prompt }, {
      role: 'assistant', content: reply, source, factCount: factIds.length,
    }].slice(-24));
  };

  const ask = async () => {
    const prompt = question.trim();
    if (!prompt || loading) return;
    const useProvider = request && isConfigured && consentMatchesScope(providerConsentRef.current, consentScope);
    if (!useProvider) {
      clearProviderConsent();
      appendReply(prompt, localReply(), 'local');
      setQuestion('');
      return;
    }
    // Consent is a single-use capability. Consume it synchronously before any
    // network request can begin, including when the provider later fails.
    clearProviderConsent();
    const capturedContextRevision = activeRequestContextRef.current.revision;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    try {
      const response = await askExplanationAgent({ request, config, gateway, signal: controller.signal });
      if (activeRequestContextRef.current.revision !== capturedContextRevision) return;
      appendReply(prompt, response.explanation, 'provider', response.factIds);
      setQuestion('');
    } catch {
      if (activeRequestContextRef.current.revision !== capturedContextRevision) return;
      appendReply(prompt, localReply(), 'fallback');
      setQuestion('');
    } finally {
      clearTimeout(timeout);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const lineList = depthContent.analysis.connections;
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="graph-explanation-title" className="grid max-h-[94vh] w-full max-w-6xl gap-5 overflow-auto rounded-3xl bg-white p-4 shadow-2xl sm:p-5 lg:grid-cols-[1.05fr_0.95fr]" onMouseDown={(event) => event.stopPropagation()}>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">{t('agent.eyebrow')}</p><h2 id="graph-explanation-title" className="mt-1 text-2xl font-black">{t('agent.title')}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{t('agent.description')}</p></div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(analysis.stages).map(([stage, count]) => <div key={stage} className={`rounded-2xl p-3 ${stageStyles[stage].soft}`}><p className={`text-xs font-bold ${stageStyles[stage].text}`}>{t(`stage.${stage}`)}</p><p className="mt-1 text-2xl font-black">{count}</p></div>)}</div>

        <div className="mt-4 space-y-2">{analysis.steps.map((step, index) => <article key={step.id} className="flex min-w-0 gap-3 rounded-2xl border border-slate-200 p-3">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${stageStyles[step.stage].soft} ${stageStyles[step.stage].text}`}>{index + 1}</span>
          <div className="min-w-0"><p className="font-bold">{t(step.name)}</p><p className="mt-1 text-sm leading-6 text-slate-600">{t(step.description)}</p>
            {step.properties.length > 0 && <p className="mt-1 break-words text-xs text-slate-500">{step.properties.map((property) => `${t(property.label)} = ${String(property.value)}`).join(' · ')}</p>}
          </div>
        </article>)}</div>
        {analysis.missingInputs.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('agent.missingInputs', { count: analysis.missingInputs.length })}</div>}
      </div>

      <div className="min-w-0 rounded-3xl bg-slate-950 p-4 text-white sm:p-5">
        <h3 className="text-lg font-black">{t('agent.technicalityTitle')}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">{t('agent.technicalityDescription')}</p>
        <div role="group" aria-label={t('agent.technicalityTitle')} className="mt-3 grid gap-2 sm:grid-cols-3">
          {GRAPH_EXPLANATION_TECHNICALITY_PREFERENCES.map((candidate) => <button
            key={candidate}
            type="button"
            data-testid={`graph-explanation-technicality-${candidate}`}
            aria-pressed={technicality === candidate}
            onClick={() => selectTechnicality(candidate)}
            className={`rounded-xl px-3 py-2 text-left text-xs font-bold ${technicality === candidate ? 'bg-violet-500 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/20'}`}
          >{t(TECHNICALITY_KEYS[candidate])}</button>)}
        </div>

        <h3 className="text-lg font-black">{t('agent.depthTitle')}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{t('agent.depthDescription')}</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">{t('agent.depthOverrideNote')}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{GRAPH_EXPLANATION_DEPTHS.map((candidate) => <button
          key={candidate}
          type="button"
          data-testid={`graph-explanation-depth-${candidate}`}
          aria-pressed={depth === candidate}
          onClick={() => { clearProviderConsent(); setDepth(candidate); }}
          className={`rounded-xl px-3 py-2 text-sm font-bold transition ${depth === candidate ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/20'}`}
        >{t(DEPTH_KEYS[candidate])}</button>)}</div>

        <div data-testid="graph-explanation-content" className="mt-4 max-h-[34vh] min-h-28 overflow-auto rounded-2xl bg-white/5 p-4 text-sm leading-6">
          {depth === 'phenomenon' && <div className="space-y-2"><p>{t('agent.phenomenonSummary', { nodes: analysis.nodeCount, edges: analysis.edgeCount, isolated: analysis.isolatedCount })}</p><p className="text-slate-300">{t('agent.phenomenonNotice')}</p></div>}
          {depth === 'evidence' && <div className="space-y-2">{depthContent.runEvidence
            ? <><p>{t('agent.evidenceCurrent')}</p><p className="font-mono text-xs text-emerald-300">{metricSummary(depthContent.runEvidence.metrics, t)}</p></>
            : <p>{t('agent.evidenceNone')}</p>}</div>}
          {depth === 'mechanism' && <div className="space-y-3">{depthContent.mechanisms.map((item, index) => <div key={`${index}-${String(item.name?.en ?? '')}`}><p className="font-bold text-white">{t(item.name)}</p><p className="text-slate-300">{t(item.intuition)}</p>{item.principle !== item.intuition && <p className="mt-1 text-slate-400">{t(item.principle)}</p>}</div>)}</div>}
          {depth === 'representation' && <div className="space-y-2">{lineList.length
            ? lineList.map((edge) => <p key={edge.alias} className="font-mono text-xs">{edge.source}.{edge.sourcePort} → {edge.target}.{edge.targetPort}</p>)
            : <p>{t('agent.representationNoConnections')}</p>}{analysis.missingInputs.length > 0 && <p className="mt-2 text-amber-300">{t('agent.missingInputs', { count: analysis.missingInputs.length })}</p>}</div>}
          {depth === 'math' && <div className="space-y-3">{depthContent.lessons.length
            ? depthContent.lessons.map((lesson, index) => <div key={index}><p className="font-mono text-base text-emerald-300">{t(lesson.formula)}</p><p className="mt-1 text-xs text-slate-400">{t(lesson.intuition)}</p></div>)
            : <p>{t('agent.mathUnavailable')}</p>}</div>}
          {depth === 'code' && <div>{depthContent.codeAvailable
            ? <><p className="mb-2 text-xs text-slate-400">{t('agent.codeGeneratedNote')}{depthContent.codeTruncated ? ` ${t('agent.codeTruncated')}` : ''}</p><pre className="overflow-x-auto whitespace-pre rounded-xl bg-black/30 p-3 text-xs leading-5 text-emerald-200">{depthContent.code}</pre></>
            : <p>{t('agent.codeUnavailable')}</p>}</div>}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 p-3">
          <div className="flex items-start justify-between gap-2"><div><h4 className="font-black">{t('agent.askTitle')}</h4><p className="mt-1 text-xs leading-5 text-slate-400">{t('agent.privacy')}</p></div><button type="button" onClick={openSettings} className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20">{t('ai.configure')}</button></div>
          {isConfigured && <label className="mt-3 flex gap-2 text-xs leading-5 text-slate-300"><input type="checkbox" checked={hasProviderConsent} onChange={(event) => setCurrentProviderConsent(event.target.checked)} className="mt-1 accent-blue-500" />{t('agent.providerConsent')}</label>}
          {!isConfigured && <p className="mt-2 text-xs text-slate-400">{t('agent.localOnly')}</p>}
          {history.length > 0 && <div aria-live="polite" className="mt-3 max-h-48 space-y-2 overflow-auto">{history.map((message, index) => <div key={`${index}-${message.role}`} className={`whitespace-pre-wrap rounded-2xl p-3 text-sm leading-6 ${message.role === 'user' ? 'ml-8 bg-blue-500 text-white' : 'mr-8 bg-white text-slate-800'}`}>
            {message.role === 'assistant' && <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{t(message.source === 'provider' ? 'agent.providerLabel' : message.source === 'fallback' ? 'agent.fallbackLabel' : 'agent.localLabel')}</p>}
            {message.content}
            {message.factCount > 0 && <p className="mt-1 text-xs text-slate-500">{t('agent.factReferenceCount', { count: message.factCount })}</p>}
          </div>)}</div>}
          <textarea aria-label={t('agent.questionLabel')} maxLength={500} disabled={loading} value={question} onChange={(event) => { clearProviderConsent(); setQuestion(event.target.value); }} placeholder={t('agent.questionPlaceholder')} className="mt-3 min-h-20 w-full rounded-2xl border border-white/10 bg-white/10 p-3 text-sm outline-none" />
          <button type="button" data-testid="graph-explanation-ask" disabled={loading || !question.trim()} onClick={ask} className="mt-2 w-full rounded-2xl bg-blue-500 px-4 py-3 font-bold disabled:opacity-40">{loading ? t('agent.thinking') : t(hasProviderConsent ? 'agent.askProvider' : 'agent.askLocal')}</button>
        </div>
      </div>
    </section>
  </div>;
}
