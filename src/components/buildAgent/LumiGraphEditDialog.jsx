import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  compileGraphEditPlan,
  createGraphEditContext,
  createLlmGraphEditIntentInterpreter,
  GRAPH_EDIT_MAX_REQUEST_LENGTH,
  resolveGraphEditLocally,
} from '../../core/graph/graphEditIntent.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';
import { useWorkspaceGraphProposalSubmission } from '../graph/WorkspaceGraphProposalContext.jsx';

function errorKey(code) {
  if (code === 'GRAPH_EDIT_CONTEXT_STALE' || code === 'GRAPH_EDIT_INTENT_STALE') return 'graphEdit.error.stale';
  if (code === 'GRAPH_EDIT_CONSENT_REQUIRED') return 'graphEdit.error.consent';
  if (code === 'AI_REQUEST_TIMEOUT') return 'graphEdit.error.timeout';
  if (code === 'AI_REQUEST_CANCELLED') return 'graphEdit.error.cancelled';
  if (code === 'GRAPH_EDIT_REQUEST_INVALID') return 'graphEdit.error.request';
  return 'graphEdit.error.providerFallback';
}

function contextFrom(project, language) {
  try { return { context: createGraphEditContext(project, { language }), error: null }; }
  catch (error) { return { context: null, error }; }
}

function localizedValue(value, language = 'en') {
  if (typeof value === 'string') return value;
  return value?.[language] ?? value?.en ?? Object.values(value ?? {}).find((entry) => typeof entry === 'string') ?? '';
}

function localizeCandidate(candidate, context, language, t) {
  const nodeName = (ref) => {
    const node = context?.nodeByRef.get(ref);
    return localizedValue(node?.data.label, language) || localizedValue(node?.data.manifest?.name, language) || t('graphEdit.ambiguousCandidate');
  };
  const componentName = (ref) => localizedValue(context?.componentByRef.get(ref)?.name, language) || t('graphEdit.ambiguousCandidate');
  let label;
  switch (candidate.kind) {
    case 'node': label = t('graphEdit.candidate.node', { name: nodeName(candidate.ref), index: candidate.ordinal ?? 1 }); break;
    case 'component': label = t('graphEdit.candidate.component', { name: componentName(candidate.ref), index: candidate.ordinal ?? 1 }); break;
    case 'edge': label = t('graphEdit.candidate.edge', {
      source: nodeName(candidate.sourceRef), sourcePort: candidate.sourcePort,
      target: nodeName(candidate.targetRef), targetPort: candidate.targetPort,
      index: candidate.ordinal ?? 1,
    }); break;
    case 'node-pair': label = t(candidate.operation === 'MOVE_NODE' ? 'graphEdit.candidate.movePair' : 'graphEdit.candidate.nodePair', {
      source: nodeName(candidate.sourceRef), target: nodeName(candidate.targetRef), index: candidate.ordinal ?? 1,
    }); break;
    case 'port-pair': label = t('graphEdit.candidate.portPair', {
      source: nodeName(candidate.sourceRef), sourcePort: candidate.sourcePort,
      target: nodeName(candidate.targetRef), targetPort: candidate.targetPort,
      index: candidate.ordinal ?? 1,
    }); break;
    case 'property': label = t('graphEdit.candidate.property', { name: candidate.label ?? candidate.key, index: candidate.ordinal ?? 1 }); break;
    default: label = candidate.label ?? t('graphEdit.ambiguousCandidate');
  }
  return { ...candidate, selectionKey: JSON.stringify(candidate), label };
}

export default function LumiGraphEditDialog({ open, initialRequest = '', onClose, nodes, edges, customComponents, language = 'en', hasStagedProposal = false, t }) {
  const { config, gateway, isConfigured, openSettings } = useAiProvider();
  const submitProposal = useWorkspaceGraphProposalSubmission();
  const interpreter = useMemo(() => createLlmGraphEditIntentInterpreter({ gateway }), [gateway]);
  const [request, setRequest] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [outcomeContextStamp, setOutcomeContextStamp] = useState(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
  const abortRef = useRef(null);
  const activeRequestRef = useRef(null);
  const requestIdRef = useRef(null);
  const generationRef = useRef(0);
  const inputRef = useRef(null);

  const project = useMemo(() => ({ graph: { nodes, edges }, customComponents }), [nodes, edges, customComponents]);
  const contextState = useMemo(() => contextFrom(project, language), [nodes, edges, customComponents, language]);
  const context = contextState.context;
  const latestRef = useRef(null);
  const contextStampRef = useRef(null);
  latestRef.current = { open, contextIdentity: context?.contextIdentity ?? null, projectSignature: context?.projectSignature ?? null, registrySignature: context?.registrySignature ?? null, config, gateway, isConfigured };

  useEffect(() => {
    const stamp = JSON.stringify({ contextIdentity: context?.contextIdentity ?? null, config, gateway });
    if (contextStampRef.current !== null && contextStampRef.current !== stamp) {
      setConsent(false);
      setOutcome(null);
      setOutcomeContextStamp(null);
      setSelectedCandidateKey('');
      setError('');
      if (status !== 'interpreting') setStatus('idle');
    }
    contextStampRef.current = stamp;
  }, [context?.contextIdentity, config, gateway, status]);

  const cancel = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeRequestRef.current = null;
    requestIdRef.current = null;
    setStatus('idle');
    setOutcome(null);
    setOutcomeContextStamp(null);
    setSelectedCandidateKey('');
    setError('');
  };

  const reset = () => {
    cancel();
    setRequest('');
    setConsent(false);
  };

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      if (initialRequest) {
        setRequest(initialRequest.slice(0, GRAPH_EDIT_MAX_REQUEST_LENGTH));
        setConsent(false);
        setStatus('idle');
        setError('');
        setOutcome(null);
        setOutcomeContextStamp(null);
        setSelectedCandidateKey('');
      }
    }
    else reset();
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, [open, initialRequest]);

  useEffect(() => {
    const active = activeRequestRef.current;
    if (!open || status !== 'interpreting' || !active) return;
    const env = latestRef.current;
    const identityChanged = JSON.stringify(active.contextIdentity) !== JSON.stringify(env.contextIdentity)
      || active.projectSignature !== env.projectSignature
      || active.registrySignature !== env.registrySignature;
    const providerChanged = active.config !== env.config || active.gateway !== env.gateway || !env.isConfigured;
    if (!identityChanged && !providerChanged) return;
    generationRef.current += 1;
    active.controller.abort();
    abortRef.current = null;
    activeRequestRef.current = null;
    requestIdRef.current = null;
    setOutcome(null);
    setError(t('graphEdit.error.stale'));
    setStatus('error');
  }, [open, status, context, config, gateway, isConfigured, t]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); reset(); onClose(); }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('[data-lumi-graph-edit] [role="dialog"]');
      const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const currentContextStamp = JSON.stringify(context?.contextIdentity ?? null);
  const outcomeIsCurrent = Boolean(outcome) && outcomeContextStamp === currentContextStamp;
  const activeCandidates = outcomeIsCurrent ? (outcome?.candidates ?? []).map((candidate) => localizeCandidate(candidate, context, language, t)) : [];
  const selectedCandidate = activeCandidates.find((candidate) => candidate.selectionKey === selectedCandidateKey) ?? null;
  const canInterpret = Boolean(request.trim()) && status !== 'interpreting' && !hasStagedProposal && Boolean(context);

  const interpret = async (candidateChoice = null) => {
    if (!context || hasStagedProposal) return;
    if (candidateChoice && outcomeContextStamp !== currentContextStamp) {
      setOutcome(null);
      setOutcomeContextStamp(null);
      setSelectedCandidateKey('');
      setError(t('graphEdit.error.stale'));
      setStatus('error');
      return;
    }
    setError('');
    setOutcome(null);
    setOutcomeContextStamp(null);
    setSelectedCandidateKey('');
    const nextId = `graph-edit-${crypto.randomUUID()}`;
    const generation = ++generationRef.current;
    requestIdRef.current = nextId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    activeRequestRef.current = { controller, contextIdentity: context.contextIdentity, projectSignature: context.projectSignature, registrySignature: context.registrySignature, config, gateway };
    setStatus('interpreting');

    const stillCurrent = () => generation === generationRef.current && requestIdRef.current === nextId;
    if (candidateChoice || !consent || !isConfigured || !config) {
      const local = resolveGraphEditLocally(request, context, { language, selection: candidateChoice, requestId: nextId });
      if (!stillCurrent()) return;
      requestIdRef.current = null;
      abortRef.current = null;
      activeRequestRef.current = null;
      setOutcome(local);
      setOutcomeContextStamp(JSON.stringify(context.contextIdentity));
      setStatus(local.kind);
      setConsent(false);
      return;
    }

    const capturedContextIdentity = context.contextIdentity;
    const capturedDefinitions = context.projectSignature;
    const capturedRegistry = context.registrySignature;
    try {
      const result = await interpreter.interpret({
        request,
        requestId: nextId,
        project,
        config,
        consent,
        language,
        signal: controller.signal,
      });
      if (!stillCurrent()) return;
      if (JSON.stringify(latestRef.current.contextIdentity) !== JSON.stringify(capturedContextIdentity)
        || latestRef.current.projectSignature !== capturedDefinitions
        || latestRef.current.registrySignature !== capturedRegistry
        || latestRef.current.config !== config || latestRef.current.gateway !== gateway) {
        setError(t('graphEdit.error.stale'));
        setStatus('error');
        return;
      }
      setOutcome(result);
      setOutcomeContextStamp(JSON.stringify(context.contextIdentity));
      setStatus(result.kind);
    } catch (failure) {
      if (!stillCurrent()) return;
      if (failure?.code === 'AI_REQUEST_CANCELLED' || failure?.code === 'GRAPH_EDIT_INTENT_STALE') return;
      const local = resolveGraphEditLocally(request, context, { language, requestId: nextId });
      if (!stillCurrent()) return;
      setOutcome(local);
      setOutcomeContextStamp(JSON.stringify(context.contextIdentity));
      setError(t(errorKey(failure?.code)));
      setStatus(local.kind === 'plan' ? 'fallback' : local.kind);
    } finally {
      if (requestIdRef.current === nextId) {
        requestIdRef.current = null;
        if (abortRef.current === controller) abortRef.current = null;
        if (activeRequestRef.current?.controller === controller) activeRequestRef.current = null;
      }
      setConsent(false);
    }
  };

  const prepareDiff = () => {
    if (!context || !outcomeIsCurrent || outcome?.kind !== 'plan' || hasStagedProposal) return;
    const result = compileGraphEditPlan({ plan: outcome, project, requestId: outcome.requestId, context });
    if (!result.ok) { setError(t(errorKey(result.diagnostics?.[0]?.code))); setStatus('error'); return; }
    const submitted = submitProposal(result.proposal);
    if (!submitted?.ok) { setError(t('graphEdit.error.invalidPlan')); setStatus('error'); return; }
    reset();
    onClose();
  };

  const localOnly = !consent || !isConfigured || !config;
  const statusText = status === 'interpreting' ? t('graphEdit.interpreting')
    : status === 'fallback' ? t('graphEdit.localFallback')
      : status === 'plan' ? t('graphEdit.planReady')
        : status === 'clarification' ? t('graphEdit.needsClarification')
          : status === 'unsupported' ? t('graphEdit.unsupported') : t('graphEdit.localFirst');

  return <div className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-slate-950/55 p-3 sm:p-5" data-lumi-graph-edit>
    <section role="dialog" aria-modal="true" aria-labelledby="graph-edit-title" className="my-auto w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-indigo-600">{t('graphEdit.eyebrow')}</p>
          <h2 id="graph-edit-title" className="mt-1 text-2xl font-black text-slate-950">{t('graphEdit.title')}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t('graphEdit.description')}</p>
        </div>
        <button type="button" className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => { reset(); onClose(); }}>{status === 'interpreting' ? t('common.cancel') : t('common.close')}</button>
      </header>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-800">{t('graphEdit.requestLabel')}</span>
          <textarea ref={inputRef} value={request} maxLength={GRAPH_EDIT_MAX_REQUEST_LENGTH} rows={3} onChange={(event) => { generationRef.current += 1; abortRef.current?.abort(); abortRef.current = null; activeRequestRef.current = null; requestIdRef.current = null; setRequest(event.target.value); setConsent(false); setOutcome(null); setOutcomeContextStamp(null); setSelectedCandidateKey(''); setError(''); setStatus('idle'); }} className="w-full resize-y rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder={t('graphEdit.requestPlaceholder')} />
          <span className="mt-1 block text-right text-xs text-slate-500">{t('graphEdit.characterCount', { count: request.length })}</span>
        </label>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600" data-graph-edit-privacy>
          <p className="font-bold">{t('graphEdit.privacyTitle')}</p>
          <p className="mt-1">{t('graphEdit.privacyDetails', { nodes: context?.nodeByRef.size ?? 0, edges: context?.edgeByRef.size ?? 0, components: context?.componentByRef.size ?? 0 })}</p>
          <p className="mt-1">{t('graphEdit.privacyExcluded')}</p>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm leading-5 text-indigo-950">
          <input type="checkbox" checked={consent} disabled={!isConfigured || !config || status === 'interpreting'} onChange={(event) => { setConsent(event.target.checked); setOutcome(null); setOutcomeContextStamp(null); setSelectedCandidateKey(''); setError(''); setStatus('idle'); }} className="mt-1 h-4 w-4 shrink-0 accent-indigo-600" />
          <span>{t(isConfigured && config ? 'graphEdit.providerConsent' : 'graphEdit.providerUnavailable')}</span>
        </label>

        {hasStagedProposal && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t('graphEdit.previewAlreadyOpen')}</p>}
        {contextState.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">{t('graphEdit.error.invalidContext')}</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}

        {outcomeIsCurrent && outcome?.kind === 'clarification' && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4" role="status" data-graph-edit-clarification>
          <h3 className="font-black text-amber-950">{t(`graphEdit.reason.${outcome.code}`)}</h3>
          {activeCandidates.length > 0 && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('graphEdit.chooseTarget')}>
            {activeCandidates.map((candidate) => <button key={candidate.selectionKey} type="button" data-graph-edit-candidate={candidate.kind} aria-pressed={selectedCandidateKey === candidate.selectionKey} className={`rounded-xl px-3 py-2 text-sm font-bold ${selectedCandidateKey === candidate.selectionKey ? 'bg-indigo-700 text-white' : 'bg-white text-slate-800'}`} onClick={() => setSelectedCandidateKey(candidate.selectionKey)}>{candidate.label}</button>)}
          </div>}
          {selectedCandidate && <button type="button" data-graph-edit-resolve className="mt-3 rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white" onClick={() => interpret(selectedCandidate)}>{t('graphEdit.continueWithSelection')}</button>}
        </section>}

        {outcomeIsCurrent && outcome?.kind === 'unsupported' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t(`graphEdit.reason.${outcome.code}`)}</p>}
        {outcomeIsCurrent && outcome?.kind === 'plan' && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-graph-edit-plan>
          <h3 className="font-black text-emerald-950">{t('graphEdit.planTitle')}</h3>
          <p className="mt-2 text-sm leading-6 text-emerald-950">{t('graphEdit.planSummary', { count: outcome.steps.length })}</p>
          <p className="mt-2 text-xs leading-5 text-emerald-900">{t('graphEdit.planAuthority')}</p>
        </section>}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-slate-500" aria-live="polite">{statusText}</span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {!isConfigured && <button type="button" className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700" onClick={openSettings}>{t('buildIntent.configureProvider')}</button>}
            <button type="button" data-graph-edit-interpret disabled={!canInterpret} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" onClick={() => interpret(null)}>{status === 'interpreting' ? t('graphEdit.interpreting') : localOnly ? t('graphEdit.interpretLocal') : t('graphEdit.interpretProvider')}</button>
            {outcomeIsCurrent && outcome?.kind === 'plan' && <button type="button" data-graph-edit-review className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white" onClick={prepareDiff}>{t('graphEdit.reviewDiff')}</button>}
          </div>
        </div>
      </div>
    </section>
  </div>;
}
