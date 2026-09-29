import { useEffect, useRef, useState } from 'react';
import { createImportedAttentionEventStore, commitImportedAttentionExecution } from '../core/playground/importedAttention/semanticEvents.js';
import { createG2ExecutionRequestV1, createG2ExecutionResultV1, g2CurrentExecutionIdentityV1 } from '../core/playground/importedAttention/executionAdapter.js';
import { createExecutionResultV1 } from '../core/execution/executionContract.js';
import {
  G2_ATTENTION_SEQUENCE_LENGTH,
  G2_INPUT_IDS_A,
  G2_INPUT_IDS_B,
} from '../core/playground/importedAttention/profile.js';
import { clearG2LocalModelCache, loadG2LocalModelArtifact, saveG2LocalModelArtifact } from '../core/localModelCache.js';
import { createLocalModelReference } from '../core/localModelReferences.js';
import { localAttentionClient } from '../services/localAttention/client.js';

export default function ImportedAttentionExperience({ open, onClose, localModelReference = null, projectSessionId, onModelBound, t }) {
  const [runner, setRunner] = useState({ status: 'disconnected', modelLoaded: false, modelHash: null, providerVersion: null });
  const [connectionCode, setConnectionCode] = useState('');
  const [runnerToken, setRunnerToken] = useState('');
  const [activeModelHash, setActiveModelHash] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [semanticEvents, setSemanticEvents] = useState({ events: [], evidenceInstances: [] });
  const [errorKey, setErrorKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [cacheNoticeKey, setCacheNoticeKey] = useState(null);
  const fileInputRef = useRef(null);
  const requestControllerRef = useRef(null);
  const restoreAttemptRef = useRef(null);
  const requestGenerationRef = useRef(0);
  const eventStoreRef = useRef(null);
  if (!eventStoreRef.current) eventStoreRef.current = createImportedAttentionEventStore();

  useEffect(() => {
    if (!open) return undefined;
    if (!runnerToken) {
      setRunner((current) => current.status === 'disconnected'
        ? current
        : { status: 'disconnected', modelLoaded: false, modelHash: null, providerVersion: null });
      setActiveModelHash(null);
      return undefined;
    }
    let active = true;
    let timer = null;
    let inFlight = false;
    let controller = null;
    const reference = localModelReference;
    const linkedHash = reference?.sha256 ? `sha256:${reference.sha256}` : null;

    const checkRunner = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const health = await localAttentionClient.health({ token: runnerToken, signal: controller.signal });
        if (!active) return;
        const isLinkedModelLoaded = Boolean(linkedHash && health.modelLoaded && health.modelHash === linkedHash);
        setRunner({ ...health, status: 'available' });
        if (isLinkedModelLoaded) {
          setActiveModelHash(linkedHash);
          restoreAttemptRef.current = null;
          return;
        }

        setActiveModelHash(null);
        if (!reference) return;

        const attemptKey = `${reference.profileId}:${reference.sha256}:${health.modelHash ?? 'empty'}`;
        if (restoreAttemptRef.current === attemptKey) return;
        restoreAttemptRef.current = attemptKey;
        setRunner({ ...health, status: 'checking', modelLoaded: false, modelHash: null });
        setErrorKey(null);
        const cachedFile = await loadG2LocalModelArtifact(reference);
        if (!active) return;
        if (!cachedFile) {
          setRunner({ ...health, status: 'available', modelLoaded: false, modelHash: null });
          return;
        }
        const binding = await localAttentionClient.importModel(cachedFile, { token: runnerToken, signal: controller.signal });
        if (!active) return;
        if (binding.profileId !== reference.profileId || binding.sha256 !== reference.sha256) {
          throw Object.assign(new Error('g2.error.modelCacheCorrupt'), { translationKey: 'g2.error.modelCacheCorrupt' });
        }
        setActiveModelHash(binding.modelHash);
        setRunner({ status: 'available', modelLoaded: true, modelHash: binding.modelHash });
        setErrorKey(null);
        restoreAttemptRef.current = null;
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        if (error?.translationKey === 'g2.error.authorizationInvalid') {
          setRunnerToken('');
          setActiveModelHash(null);
          setRunner({ status: 'disconnected', modelLoaded: false, modelHash: null, providerVersion: null });
          setErrorKey('g2.error.authorizationInvalid');
          return;
        }
        if (error?.translationKey === 'g2.error.runtimeUnavailable' || error?.translationKey === 'g2.error.requestTimeout') {
          setActiveModelHash(null);
          setRunner((current) => ({ ...current, status: 'offline', modelLoaded: false, modelHash: null }));
          return;
        }
        setActiveModelHash(null);
        setRunner((current) => ({ ...current, status: 'offline', modelLoaded: false, modelHash: null }));
        setErrorKey(error?.translationKey ?? 'g2.error.modelCacheUnavailable');
      } finally {
        inFlight = false;
        controller = null;
        if (active) timer = window.setTimeout(checkRunner, 1500);
      }
    };

    checkRunner();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [open, runnerToken, projectSessionId, localModelReference?.profileId, localModelReference?.sha256]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!open) {
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      setBusy(false);
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function connectRunner() {
    const token = connectionCode.trim();
    setBusy(true);
    setErrorKey(null);
    try {
      const health = await localAttentionClient.health({ token });
      setRunner({ ...health, status: 'available' });
      setRunnerToken(token);
      setConnectionCode('');
      restoreAttemptRef.current = null;
    } catch (error) {
      setRunner({ status: 'offline', modelLoaded: false, modelHash: null, providerVersion: null });
      setErrorKey(error?.translationKey ?? 'g2.error.runtimeUnavailable');
    } finally {
      setBusy(false);
    }
  }

  function disconnectRunner() {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    setRunnerToken('');
    setRunner({ status: 'disconnected', modelLoaded: false, modelHash: null, providerVersion: null });
    setActiveModelHash(null);
    setBusy(false);
    setErrorKey(null);
    restoreAttemptRef.current = null;
  }

  async function clearLocalCache() {
    setCacheNoticeKey(null);
    try {
      await clearG2LocalModelCache();
      setCacheNoticeKey('g2.cache.cleared');
    } catch (error) {
      setCacheNoticeKey(error?.translationKey ?? 'g2.error.modelCacheUnavailable');
    }
  }

  async function importSelectedModel(file) {
    if (!file) return;
    const generation = ++requestGenerationRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setBusy(true);
    setErrorKey(null);
    try {
      const binding = await localAttentionClient.importModel(file, { token: runnerToken, signal: controller.signal });
      if (generation !== requestGenerationRef.current) return;
      const reference = createLocalModelReference({ profileId: binding.profileId, sha256: binding.sha256 });
      setActiveModelHash(binding.modelHash);
      setRunner((current) => ({ ...current, status: 'available', modelLoaded: true, modelHash: binding.modelHash }));
      restoreAttemptRef.current = null;
      onModelBound?.(reference);
      try {
        await saveG2LocalModelArtifact(file, reference);
      } catch (cacheError) {
        if (generation === requestGenerationRef.current) setErrorKey(cacheError?.translationKey ?? 'g2.error.modelCacheUnavailable');
      }
    } catch (error) {
      if (generation === requestGenerationRef.current && error?.name !== 'AbortError') {
        setErrorKey(error?.translationKey ?? 'g2.error.runtimeUnavailable');
        setRunner((current) => ({ ...current, status: 'offline', modelLoaded: false, modelHash: null }));
      }
    } finally {
      if (generation === requestGenerationRef.current) setBusy(false);
    }
  }

  async function runComparison() {
    if (!activeModelHash || !runnerToken || busy) return;
    const generation = ++requestGenerationRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setBusy(true);
    setErrorKey(null);
    const startedAt = new Date().toISOString();
    const executionRequestId = `g2-${crypto.randomUUID()}`;
    let executionRequest = null;
    try {
      executionRequest = createG2ExecutionRequestV1({
        projectSessionId,
        modelHash: activeModelHash,
        requestId: executionRequestId,
        providerVersion: runner.providerVersion,
        approvedAt: startedAt,
      });
      const comparisonResult = await localAttentionClient.compare({
        modelHash: activeModelHash,
        providerVersion: runner.providerVersion,
        requestId: executionRequestId,
        token: runnerToken,
        signal: controller.signal,
      });
      if (generation !== requestGenerationRef.current) return;
      const resultEnvelope = createG2ExecutionResultV1({
        request: executionRequest,
        comparison: comparisonResult,
        providerVersion: comparisonResult.providerVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      const currentIdentity = g2CurrentExecutionIdentityV1({
        projectSessionId,
        modelHash: activeModelHash,
        providerVersion: comparisonResult.providerVersion,
      });
      const committed = commitImportedAttentionExecution(
        eventStoreRef.current,
        resultEnvelope,
        executionRequest,
        currentIdentity,
      );
      if (!committed.evidence) {
        const staleEnvelope = createExecutionResultV1({
          request: executionRequest,
          runId: executionRequestId,
          status: 'stale',
          providerVersion: runner.providerVersion,
          startedAt,
          finishedAt: new Date().toISOString(),
          diagnostics: [committed.reason === 'stale' ? 'RESULT_IDENTITY_STALE' : 'RESULT_REJECTED'],
        });
        setExecutionResult(staleEnvelope);
        setErrorKey('g2.error.responseInvalid');
        return;
      }
      setExecutionResult(resultEnvelope);
      setComparison(comparisonResult);
      setEvidence(committed.evidence);
      setSemanticEvents(committed.semanticEvents);
    } catch (error) {
      if (generation === requestGenerationRef.current && error?.name !== 'AbortError') {
        setErrorKey(error?.translationKey ?? 'g2.error.runtimeUnavailable');
        if (executionRequest) {
          const status = error?.code === 'requestTimeout' ? 'timed-out' : 'failed';
          setExecutionResult(createExecutionResultV1({
            request: executionRequest,
            runId: executionRequestId,
            status,
            providerVersion: runner.providerVersion,
            startedAt,
            finishedAt: new Date().toISOString(),
            diagnostics: [String(error?.code ?? 'RUN_FAILED').replace(/[^A-Z0-9._-]/gi, '_').toUpperCase().slice(0, 64)],
          }));
        }
      }
    } finally {
      if (generation === requestGenerationRef.current) setBusy(false);
    }
  }

  const linkedHash = localModelReference?.sha256 ? `sha256:${localModelReference.sha256}` : null;
  const modelReady = Boolean(activeModelHash && activeModelHash === linkedHash
    && runner.modelLoaded && runner.modelHash === linkedHash);
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/65 p-2 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="g2-title" data-g2-imported-attention>
    <section className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">{t('g2.kicker')}</p>
          <h2 id="g2-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{t('g2.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">{t('g2.subtitle')}</p>
        </div>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">{t('common.close')}</button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 sm:p-5">
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h3 className="font-black text-slate-900">{t('g2.import.heading')}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-600">{t('g2.import.description')}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-slate-500">{linkedHash ? t('g2.import.linkedHash', { hash: linkedHash }) : t('g2.import.noModel')}</p>
            <p className="mt-1 text-xs font-bold text-slate-500" data-g2-runner-status={runner.status}>{t(`g2.status.${runner.status}`)}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">{t('g2.connection.lifecycle')}</p>
            {!runnerToken && <div className="mt-3 flex max-w-xl flex-wrap gap-2">
              <label className="sr-only" htmlFor="g2-runner-code">{t('g2.connection.codeLabel')}</label>
              <input id="g2-runner-code" type="password" autoComplete="off" value={connectionCode} onChange={(event) => setConnectionCode(event.target.value)} placeholder={t('g2.connection.codePlaceholder')} aria-label={t('g2.connection.codeLabel')} data-g2-connection-code className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
              <button type="button" disabled={busy || connectionCode.trim().length < 32} onClick={connectRunner} className="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-black text-indigo-800 disabled:opacity-50" data-g2-connect-runner>{busy ? t('g2.working') : t('g2.connection.connect')}</button>
            </div>}
            {runnerToken && <button type="button" disabled={busy} onClick={disconnectRunner} className="mt-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50" data-g2-disconnect-runner>{t('g2.connection.disconnect')}</button>}
            {errorKey && <p className="mt-2 rounded-xl bg-rose-50 p-2 text-sm font-bold text-rose-800" role="alert">{t(errorKey)}</p>}
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <input ref={fileInputRef} type="file" accept=".onnx,application/onnx" className="sr-only" aria-label={t('g2.import.choose')} data-g2-model-input onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; importSelectedModel(file); }} />
            <button type="button" disabled={!runnerToken || busy || runner.status === 'checking'} onClick={() => fileInputRef.current?.click()} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50" data-g2-import-model>{t(localModelReference ? 'g2.import.relink' : 'g2.import.choose')}</button>
            <button type="button" disabled={!modelReady || !runnerToken || busy} onClick={runComparison} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50" data-g2-run-comparison data-g2-execution-status={executionResult?.status ?? 'none'}>{busy ? t('g2.working') : t('g2.compare')}</button>
          </div>
        </section>
        {localModelReference && !modelReady && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">{t('g2.import.relinkRequired')}</p>}
        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="font-black text-slate-900">{t('g2.pair.heading')}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-600">{t('g2.pair.description')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <TokenSequence title={t('g2.pair.sampleA')} tokens={['CLS', 'this', 'movie', 'was', 'good', 'SEP']} tokenIds={G2_INPUT_IDS_A} t={t} />
            <TokenSequence title={t('g2.pair.sampleB')} tokens={['CLS', 'this', 'movie', 'was', 'bad', 'SEP']} tokenIds={G2_INPUT_IDS_B} t={t} />
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('g2.pair.fixedSettings')}</p>
        </section>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-g2-cache-policy>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900">{t('g2.cache.heading')}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">{t('g2.cache.capacity')}</p>
            {cacheNoticeKey && <p className="mt-1 text-xs font-bold text-slate-700" role="status">{t(cacheNoticeKey)}</p>}
          </div>
          <button type="button" onClick={clearLocalCache} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700" data-g2-clear-cache>{t('g2.cache.clear')}</button>
        </section>
        {comparison && evidence && <>
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4" data-g2-evidence data-g2-event-count={semanticEvents.events.length} data-g2-run-id={comparison.requestId} data-g2-experiment-ids={(semanticEvents.events.filter((event) => event.type === 'comparison.completed').at(-1)?.experimentIds ?? []).join(',')} data-g2-evidence-instance-count={semanticEvents.evidenceInstances.length}>
            <h3 className="font-black text-emerald-950">{t('g2.evidence.heading')}</h3>
            <p className="mt-1 text-sm leading-5 text-emerald-900">{t(evidence.attentionChanged ? 'g2.evidence.attentionChanged' : 'g2.evidence.noAttentionChange')}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {evidence.layerDeltas.map((item) => <p key={item.layer} className="rounded-xl bg-white/80 p-2 text-sm font-bold text-emerald-950">{t('g2.evidence.layerDelta', { layer: item.layer + 1, value: item.maxAbsoluteDelta.toFixed(6) })}</p>)}
              {evidence.logitDeltas.map((value, index) => <p key={index} className="rounded-xl bg-white/80 p-2 text-sm text-slate-800">{t('g2.evidence.logitDelta', { classIndex: index, value: value.toFixed(6) })}</p>)}
            </div>
            {evidence.attentionChanged && <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3" data-g2-concept-eligible>
              <h4 className="font-black text-slate-950">{t('g2.concept.title')}</h4>
              <p className="mt-1 text-sm leading-5 text-slate-700">{t('g2.concept.body')}</p>
              <p className="mt-2 text-xs font-bold text-emerald-800">{t('g2.concept.status')}</p>
            </div>}
          </section>
          <section className="space-y-3" aria-label={t('g2.results.label')}>
            <h3 className="font-black text-slate-900">{t('g2.results.heading')}</h3>
            <div className="grid gap-3 xl:grid-cols-2">
              <AttentionSample sample={comparison.sampleA} title={t('g2.pair.sampleA')} tokens={['CLS', 'this', 'movie', 'was', 'good', 'SEP']} t={t} />
              <AttentionSample sample={comparison.sampleB} title={t('g2.pair.sampleB')} tokens={['CLS', 'this', 'movie', 'was', 'bad', 'SEP']} t={t} />
            </div>
          </section>
        </>}
      </div>
    </section>
  </div>;
}

function TokenSequence({ title, tokens, tokenIds, t }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-xs font-black text-slate-500">{title}</p>
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('g2.pair.tokenSequence', { title })}>
      {tokens.map((token, index) => <span key={index} className={`rounded-lg px-2 py-1 text-xs font-bold ${index === 4 ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'bg-slate-100 text-slate-800'}`} title={t('g2.pair.tokenId', { id: tokenIds[index] })}>{token}</span>)}
    </div>
  </div>;
}

function AttentionSample({ sample, title, tokens, t }) {
  return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
    <h4 className="font-black text-slate-900">{title}</h4>
    <div className="mt-2 flex flex-wrap gap-2">
      {sample.logits.map((value, index) => <span key={index} className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-950">{t('g2.results.logit', { classIndex: index, value: value.toFixed(4) })}</span>)}
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {sample.attentionProbabilities.map((layer, layerIndex) => layer.map((head, headIndex) => <div key={`${layerIndex}:${headIndex}`} className="min-w-0 rounded-xl bg-slate-50 p-2">
        <p className="mb-2 text-xs font-black text-slate-700">{t('g2.results.attentionTitle', { layer: layerIndex + 1, head: headIndex + 1 })}</p>
        <div className="grid grid-cols-[repeat(6,minmax(0,1fr))] gap-0.5" role="grid" aria-label={t('g2.results.attentionTitle', { layer: layerIndex + 1, head: headIndex + 1 })}>
          {Array.from({ length: G2_ATTENTION_SEQUENCE_LENGTH ** 2 }, (_, index) => {
            const row = Math.floor(index / G2_ATTENTION_SEQUENCE_LENGTH);
            const column = index % G2_ATTENTION_SEQUENCE_LENGTH;
            const value = head[row][column];
            return <span key={index} role="gridcell" title={t('g2.results.cell', { row: tokens[row], column: tokens[column], value: value.toFixed(6) })} aria-label={t('g2.results.cell', { row: tokens[row], column: tokens[column], value: value.toFixed(6) })} className="grid aspect-square min-w-0 place-items-center rounded-sm text-[8px] font-bold tabular-nums text-slate-950" style={{ backgroundColor: `rgba(37,99,235,${Math.max(0.08, Math.min(0.82, value))})` }}>{value.toFixed(2)}</span>;
          })}
        </div>
        <div className="mt-1 flex justify-between gap-1 text-[9px] text-slate-500"><span>{t('g2.results.rowsAttendTo')}</span><span>{t('g2.results.columnsAre')}</span></div>
      </div>))}
    </div>
  </article>;
}
