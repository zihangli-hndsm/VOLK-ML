import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyBuildIntentLayerCount,
  classifyUnsupportedBuildIntent,
  createBuildDatasetContext,
  createGraphProposal,
  createLlmBuildIntentInterpreter,
  planBuildGoal,
} from '../../core/buildAgent/index.js';
import { adaptBuildAgentGraphProposal } from '../../core/graph/workspaceProposal.js';
import { useAiProvider } from '../ai/AiProviderContext.jsx';
import { useWorkspaceGraphProposalSubmission } from '../graph/WorkspaceGraphProposalContext.jsx';

function safeMessageKey(error) {
  switch (error?.code) {
    case 'BUILD_INTENT_PROVIDER_NOT_CONFIGURED': return 'buildIntent.error.notConfigured';
    case 'BUILD_DATASET_CONTEXT_INVALID': return 'buildIntent.error.dataset';
    case 'BUILD_INTENT_REQUEST_INVALID': return 'buildIntent.error.request';
    case 'BUILD_INTENT_RESPONSE_INVALID':
    case 'BUILD_INTENT_VERSION_UNSUPPORTED': return 'buildIntent.error.response';
    case 'AI_REQUEST_TIMEOUT': return 'buildIntent.error.timeout';
    case 'AI_REQUEST_CANCELLED': return 'buildIntent.error.cancelled';
    case 'BUILD_INTENT_PROVIDER_CHANGED': return 'buildIntent.error.providerChanged';
    case 'BUILD_INTENT_DATASET_CHANGED': return 'buildIntent.error.datasetStale';
    default: return 'buildIntent.error.provider';
  }
}

const METRIC_KEYS = Object.freeze({
  rmse: 'buildIntent.metric.rmse',
  r2: 'buildIntent.metric.r2',
  accuracy: 'buildIntent.metric.accuracy',
  'macro-f1': 'buildIntent.metric.macroF1',
});

const RATIONALE_KEYS = Object.freeze({
  'baseline.linear-regression': 'buildIntent.rationale.linearRegression',
  'baseline.knn-classification': 'buildIntent.rationale.knnClassification',
  'model.small-mlp-regression': 'buildIntent.rationale.mlpRegression',
  'model.small-mlp-classification': 'buildIntent.rationale.mlpClassification',
});

const LIMITATION_KEYS = Object.freeze({
  'knn.browser-only': 'buildIntent.limitation.knnBrowserOnly',
  'mlp.numeric-tabular-only': 'buildIntent.limitation.mlpNumericTabularOnly',
});

function localizedIdentifiers(identifiers, lookup, t) {
  return identifiers.map((identifier) => t(lookup[identifier])).join(', ');
}

function planSummary(plan, t) {
  return {
    task: t(`buildIntent.task.${plan.task}`),
    model: t(`buildIntent.model.${plan.modelFamily}`),
    featureCount: plan.dataset.featureColumns.length,
    features: plan.dataset.featureColumns.join(', '),
    target: plan.dataset.targetColumn,
    trainPercent: Math.round(plan.training.trainRatio * 100),
    testPercent: 100 - Math.round(plan.training.trainRatio * 100),
    metrics: localizedIdentifiers(plan.evaluation.metrics, METRIC_KEYS, t),
    rationale: localizedIdentifiers(plan.rationale, RATIONALE_KEYS, t),
    limitations: localizedIdentifiers(plan.limitations, LIMITATION_KEYS, t),
    hasLimitations: plan.limitations.length > 0,
    hiddenUnits: plan.training.hiddenUnits ?? null,
    epochs: plan.training.epochs ?? null,
    batchSize: plan.training.batchSize ?? null,
  };
}

function requestInvalidationCode(active, environment) {
  if (!environment?.open) return null;
  if (!environment.isConfigured || !environment.config || active.config !== environment.config || active.gateway !== environment.gateway) {
    return 'BUILD_INTENT_PROVIDER_CHANGED';
  }
  if (active.datasetFingerprint !== environment.datasetFingerprint) return 'BUILD_INTENT_DATASET_CHANGED';
  return null;
}

export default function LumiBuildIntentDialog({ open, onClose, nodes, edges, dataset, t }) {
  const { config, gateway, isConfigured, openSettings } = useAiProvider();
  const submitProposal = useWorkspaceGraphProposalSubmission();
  const interpreter = useMemo(() => createLlmBuildIntentInterpreter({ gateway }), [gateway]);
  const [request, setRequest] = useState('');
  const [clarification, setClarification] = useState(null);
  const [status, setStatus] = useState('idle');
  const [errorKey, setErrorKey] = useState('');
  const [decision, setDecision] = useState(null);
  const [plan, setPlan] = useState(null);
  const abortRef = useRef(null);
  const activeRequestRef = useRef(null);
  const requestVersionRef = useRef(0);
  const requestIdRef = useRef(null);
  const initialFocusRef = useRef(null);

  const reset = () => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeRequestRef.current = null;
    requestIdRef.current = null;
    setRequest('');
    setClarification(null);
    setStatus('idle');
    setErrorKey('');
    setDecision(null);
    setPlan(null);
  };

  useEffect(() => {
    if (open) initialFocusRef.current?.focus();
    else reset();
    return () => {
      requestVersionRef.current += 1;
      abortRef.current?.abort();
    };
  }, [open]);

  const currentDatasetFingerprint = useMemo(() => {
    if (!dataset) return null;
    try { return createBuildDatasetContext(dataset).datasetFingerprint; }
    catch { return null; }
  }, [dataset]);
  const latestEnvironmentRef = useRef(null);
  latestEnvironmentRef.current = { open, isConfigured, config, gateway, datasetFingerprint: currentDatasetFingerprint };

  useEffect(() => {
    const active = activeRequestRef.current;
    if (!open || status !== 'interpreting' || !active) return;
    const errorCode = requestInvalidationCode(active, latestEnvironmentRef.current);
    if (!errorCode) return;
    requestVersionRef.current += 1;
    active.controller.abort();
    activeRequestRef.current = null;
    if (abortRef.current === active.controller) abortRef.current = null;
    requestIdRef.current = null;
    setDecision(null);
    setPlan(null);
    setErrorKey(safeMessageKey({ code: errorCode }));
    setStatus('error');
  }, [open, status, isConfigured, config, gateway, currentDatasetFingerprint]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { reset(); onClose(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, status, onClose]);

  if (!open) return null;

  const graphIsEmpty = nodes.length === 0 && edges.length === 0;
  const canInterpret = Boolean(request.trim()) && Boolean(dataset) && graphIsEmpty && status !== 'interpreting';

  const interpret = async (nextClarification = clarification) => {
    setErrorKey('');
    setDecision(null);
    setPlan(null);
    if (!graphIsEmpty) { setErrorKey('buildIntent.error.graphNotEmpty'); return; }
    if (!dataset) { setErrorKey('buildIntent.error.datasetRequired'); return; }
    let context;
    try { context = createBuildDatasetContext(dataset); }
    catch (failure) { setErrorKey(safeMessageKey(failure)); return; }

    let unsupportedModel;
    let layerDecision;
    try {
      unsupportedModel = classifyUnsupportedBuildIntent(request);
      layerDecision = classifyBuildIntentLayerCount(request, nextClarification);
    } catch (failure) {
      setErrorKey(safeMessageKey(failure));
      setStatus('error');
      return;
    }
    if (unsupportedModel) {
      setDecision(unsupportedModel);
      setStatus('unsupported');
      return;
    }
    if (layerDecision) {
      setDecision(layerDecision);
      setClarification(nextClarification);
      setStatus(layerDecision.kind === 'clarification' ? 'clarification' : 'unsupported');
      return;
    }
    if (!isConfigured || !config) {
      setErrorKey('buildIntent.error.notConfigured');
      return;
    }

    const localRequestId = `build-intent-${crypto.randomUUID()}`;
    const version = ++requestVersionRef.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const activeRequest = { controller, config, gateway, datasetFingerprint: context.datasetFingerprint };
    activeRequestRef.current = activeRequest;
    requestIdRef.current = localRequestId;
    setStatus('interpreting');
    try {
      const result = await interpreter.interpret({
        request,
        requestId: localRequestId,
        datasetContext: context,
        clarification: nextClarification,
        config,
        signal: controller.signal,
      });
      if (version !== requestVersionRef.current || requestIdRef.current !== localRequestId) return;
      const invalidationCode = requestInvalidationCode(activeRequest, latestEnvironmentRef.current);
      if (invalidationCode) {
        requestVersionRef.current += 1;
        controller.abort();
        activeRequestRef.current = null;
        if (abortRef.current === controller) abortRef.current = null;
        requestIdRef.current = null;
        setDecision(null);
        setPlan(null);
        setErrorKey(safeMessageKey({ code: invalidationCode }));
        setStatus('error');
        return;
      }
      activeRequestRef.current = null;
      abortRef.current = null;
      setDecision(result);
      if (result.kind === 'goal') {
        const planned = planBuildGoal(result.goal, context);
        if (planned.kind === 'plan') {
          setPlan({ plan: planned.plan, datasetFingerprint: context.datasetFingerprint });
          setStatus('planned');
        } else {
          setDecision({ ...result, planningOutcome: planned });
          setStatus(planned.kind === 'unsupported' ? 'unsupported' : 'clarification');
        }
      } else {
        setClarification(nextClarification);
        setStatus(result.kind);
      }
    } catch (failure) {
      if (version !== requestVersionRef.current || requestIdRef.current !== localRequestId) return;
      const invalidationCode = requestInvalidationCode(activeRequest, latestEnvironmentRef.current);
      activeRequestRef.current = null;
      abortRef.current = null;
      requestIdRef.current = null;
      setErrorKey(safeMessageKey({ code: invalidationCode ?? failure?.code }));
      setStatus('error');
    }
  };

  const stageReviewProposal = () => {
    if (!plan) return;
    try {
      if (!graphIsEmpty) { setErrorKey('buildIntent.error.graphNotEmpty'); setStatus('error'); return; }
      const currentContext = createBuildDatasetContext(dataset);
      if (currentContext.datasetFingerprint !== plan.datasetFingerprint) {
        setErrorKey('buildIntent.error.datasetStale');
        setStatus('error');
        return;
      }
      const detached = createGraphProposal({ plan: plan.plan, dataset, datasetContext: currentContext });
      const adapted = adaptBuildAgentGraphProposal(detached, { targetGraph: { nodes: [], edges: [] } });
      if (!adapted.ok) { setErrorKey('buildIntent.error.proposal'); setStatus('error'); return; }
      const submitted = submitProposal(adapted.proposal);
      if (!submitted.ok) { setErrorKey('buildIntent.error.proposal'); setStatus('error'); return; }
      onClose();
    } catch (failure) {
      setErrorKey(safeMessageKey(failure));
      setStatus('error');
    }
  };

  const details = plan ? planSummary(plan.plan, t) : null;
  const providerLabel = isConfigured ? t('buildIntent.providerReady') : t('buildIntent.providerMissing');
  return <div className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-slate-950/55 p-3 sm:p-5" data-lumi-build-intent>
    <section role="dialog" aria-modal="true" aria-labelledby="build-intent-title" className="my-auto w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-indigo-600">{t('buildIntent.eyebrow')}</p>
          <h2 id="build-intent-title" className="mt-1 text-2xl font-black text-slate-950">{t('buildIntent.title')}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t('buildIntent.description')}</p>
        </div>
        <button type="button" className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => { reset(); onClose(); }}>{status === 'interpreting' ? t('common.cancel') : t('common.close')}</button>
      </header>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-800">{t('buildIntent.requestLabel')}</span>
          <textarea ref={initialFocusRef} value={request} maxLength={240} rows={3} onChange={(event) => { requestVersionRef.current += 1; abortRef.current?.abort(); abortRef.current = null; requestIdRef.current = null; setRequest(event.target.value); setClarification(null); setDecision(null); setPlan(null); setErrorKey(''); setStatus('idle'); }} className="w-full resize-y rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder={t('buildIntent.requestPlaceholder')} />
          <span className="mt-1 block text-right text-xs text-slate-500">{t('buildIntent.characterCount', { count: request.length })}</span>
        </label>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600" data-build-intent-privacy>{t('buildIntent.privacy')}</div>

        {!graphIsEmpty && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t('buildIntent.graphNotEmpty')}</p>}
        {!dataset && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t('buildIntent.datasetRequired')}</p>}

        {errorKey && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">{t(errorKey)}</p>}

        {decision?.kind === 'clarification' && decision.code === 'mlp-layer-count' && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-live="polite">
          <h3 className="font-black text-amber-950">{t('buildIntent.layerQuestion')}</h3>
          <p className="mt-1 text-sm text-amber-900">{t('buildIntent.layerExplanation')}</p>
          <button type="button" className="mt-3 rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white" onClick={() => { const choice = { code: 'mlp-layer-count', choice: 'two-dense-total' }; setClarification(choice); interpret(choice); }}>{t('buildIntent.twoDenseTotal')}</button>
        </section>}

        {status === 'clarification' && decision?.code !== 'mlp-layer-count' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t('buildIntent.clarification')}</p>}
        {status === 'unsupported' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t(decision?.code === 'unsupported-parameters' ? 'buildIntent.unsupportedParameters' : 'buildIntent.unsupported')}</p>}

        {details && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-build-intent-plan>
          <h3 className="font-black text-emerald-950">{t('buildIntent.planTitle')}</h3>
          <p className="mt-2 text-sm leading-6 text-emerald-950">{t('buildIntent.planSummary', details)}</p>
          <dl className="mt-3 grid gap-2 text-xs leading-5 text-emerald-950 sm:grid-cols-2">
            <div><dt className="font-black">{t('buildIntent.planFeaturesLabel')}</dt><dd className="break-words">{details.features}</dd></div>
            <div><dt className="font-black">{t('buildIntent.planSplitLabel')}</dt><dd>{t('buildIntent.planSplit', details)}</dd></div>
            <div><dt className="font-black">{t('buildIntent.planEvaluationLabel')}</dt><dd>{details.metrics}</dd></div>
            <div><dt className="font-black">{t('buildIntent.planRationaleLabel')}</dt><dd>{details.rationale}</dd></div>
            <div className="sm:col-span-2"><dt className="font-black">{t('buildIntent.planLimitationsLabel')}</dt><dd>{details.hasLimitations ? details.limitations : t('buildIntent.planNoLimitations')}</dd></div>
          </dl>
          {details.hiddenUnits !== null && <p className="mt-1 text-xs text-emerald-900">{t('buildIntent.mlpShape', { hiddenUnits: details.hiddenUnits })}</p>}
          {details.epochs !== null && <p className="mt-1 text-xs text-emerald-900">{t('buildIntent.planEpochs', { epochs: details.epochs })}</p>}
          {details.batchSize !== null && <p className="mt-1 text-xs text-emerald-900">{t('buildIntent.planBatchSize', { batchSize: details.batchSize })}</p>}
          <p className="mt-2 text-xs leading-5 text-emerald-900">{t('buildIntent.reviewOnly')}</p>
        </section>}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-slate-500" aria-live="polite">{status === 'interpreting' ? t('buildIntent.interpreting') : providerLabel}</span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {!isConfigured && <button type="button" className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700" onClick={openSettings}>{t('buildIntent.configureProvider')}</button>}
            <button type="button" disabled={!canInterpret} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" onClick={() => interpret(null)}>{status === 'interpreting' ? t('buildIntent.interpreting') : t('buildIntent.interpret')}</button>
            {plan && <button type="button" className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white" onClick={stageReviewProposal}>{t('buildIntent.reviewGraph')}</button>}
          </div>
        </div>
      </div>
    </section>
  </div>;
}
