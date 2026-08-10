import { useRef, useState } from 'react';
import { createLlmGoalInterpreter, getAgentExamples, LLM_PROVIDERS } from '../../core/playgroundAgent.js';
import {
  compositionPreview,
  importedPreview,
  previewFidelityStatus,
  previewProvenance,
  previewRunnable,
  revisionErrorPreview,
  revisionPreview,
} from './agentPreviewState.js';

// User-facing Agent surface (PR F.2 / F.2.1). The loop is:
//   Ask -> Plan -> Compose -> Preview -> Run -> Revise -> Preview revised ->
//   Run revised -> Export / Import.
// There are two separate sources of truth: the script being PREVIEWED and the
// script LOADED in the runtime (snapshot.provenance). Nothing runs unseen:
// previews never auto-load, imports never auto-replace the active script, and
// revisions replace the preview only - Run always stays explicit.

const TAB_KEYS = ['overview', 'plan', 'script', 'fidelity'];

function fidelityGroup(requirement) {
  if (requirement.startsWith('control:')) return 'controls';
  if (requirement.startsWith('operation:')) return 'operations';
  if (requirement.startsWith('visual:')) return 'visual';
  if (requirement.startsWith('runtime')) return 'runtime';
  if (requirement.startsWith('trace:')) return 'trace';
  return 'other';
}

export default function PlaygroundAgentPanel({ host, agent, snapshot, t }) {
  const [goal, setGoal] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [loadError, setLoadError] = useState(null);
  const [shortenSteps, setShortenSteps] = useState(3);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [leftValue, setLeftValue] = useState('');
  const [rightValue, setRightValue] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState('local');
  const [aiConfig, setAiConfig] = useState({ providerId: 'openai-compatible', apiKey: '', model: 'gpt-4o-mini', endpoint: '' });
  const [aiStatus, setAiStatus] = useState('local');
  const [aiError, setAiError] = useState(null);
  const fileRef = useRef(null);
  const interpreterRef = useRef(null);
  if (!interpreterRef.current) interpreterRef.current = createLlmGoalInterpreter();

  const examples = getAgentExamples(snapshot?.playgroundId);
  const selectedProvider = LLM_PROVIDERS.find((provider) => provider.id === aiConfig.providerId) ?? LLM_PROVIDERS[0];

  const generate = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setLoadError(null);
    try {
      let plan;
      if (aiMode === 'ai') {
        const interpreted = await interpreterRef.current.interpret({
          request: goal,
          context: agent.inspectContext(),
          providerId: aiConfig.providerId,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          endpoint: aiConfig.endpoint,
        });
        plan = await agent.plan(interpreted.goal);
        setAiStatus('ai');
      } else {
        plan = await agent.plan(goal);
        setAiStatus('local');
      }
      const composed = await agent.composeScript(plan);
      setPreview(compositionPreview(composed));
      setTab('overview');
      setSelectedTypes(composed.script.primitives.map((primitive) => primitive.type));
      if (plan.goal.type === 'compare-control') {
        setLeftValue(String(plan.goal.values[0]));
        setRightValue(String(plan.goal.values[1]));
      }
    } catch (error) {
      setAiStatus(aiMode === 'ai' ? 'error' : 'local');
      setAiError(aiMode === 'ai' ? (error?.message ?? 'AI interpretation failed.') : null);
      setPreview({ error: { code: error?.code ?? 'OPERATION_FAILED', message: error?.message ?? String(error), details: error?.details ?? {} } });
    } finally {
      setBusy(false);
    }
  };

  const applyRevision = async (request) => {
    if (!preview?.script || busy) return;
    setBusy(true);
    try {
      const revised = await agent.reviseScript({ plan: preview.plan, script: preview.script, request });
      setPreview(revisionPreview(preview, revised));
      setTab('overview');
      setSelectedTypes(revised.script.primitives.map((primitive) => primitive.type));
      if (revised.plan?.goal?.type === 'compare-control') {
        setLeftValue(String(revised.plan.goal.values[0]));
        setRightValue(String(revised.plan.goal.values[1]));
      }
    } catch (error) {
      // A failed revision keeps the previous valid preview intact and the
      // error is surfaced separately.
      setPreview(revisionErrorPreview(preview, {
        code: error?.code ?? 'OPERATION_FAILED',
        message: error?.message ?? String(error),
        details: error?.details ?? {},
      }));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!preview?.script || !previewRunnable(preview)) return;
    const provenance = previewProvenance(preview) ?? 'imported';
    await host.loadScript(structuredClone(preview.script), { provenance });
    await host.dispatch({ type: 'SCRIPT_PLAY' });
    setLoadError(null);
  };

  const copyJson = async () => {
    if (!preview?.script) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(preview.script, null, 2));
    } catch { /* clipboard may be unavailable; keep the panel usable */ }
  };

  const downloadJson = () => {
    if (!preview?.script) return;
    const blob = new Blob([JSON.stringify(preview.script, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'volk-ml-playground-script.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onLoadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const script = JSON.parse(await file.text());
      const validation = agent.validateScript(script);
      if (!validation.valid) {
        throw Object.assign(new Error(validation.code), { code: validation.code, details: validation.details });
      }
      const dry = agent.dryRunScript(script);
      if (!dry.valid) {
        throw Object.assign(new Error(dry.code), { code: dry.code, details: dry.details });
      }
      // Import means: validate -> preview the imported declaration. The user
      // still presses Run to load it, so preview and runtime never disagree.
      setPreview(importedPreview({ script, dryRun: dry }));
      setTab('overview');
      setSelectedTypes(script.primitives.map((primitive) => primitive.type));
      setLoadError(null);
    } catch (error) {
      setLoadError({
        code: error?.code ?? 'INVALID_SCRIPT',
        message: error?.message ?? String(error),
        details: error?.details ?? {},
      });
    } finally {
      event.target.value = '';
    }
  };

  const availableTypes = preview?.script?.primitives?.map((primitive) => primitive.type) ?? [];
  const toggleType = (type) => {
    setSelectedTypes((current) => (
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    ));
  };

  const steps = preview?.script?.steps ?? [];
  const controlsChanged = [...new Set(steps.flatMap((step) => Object.keys(step.setControl ?? {})))];
  const operations = [...new Set(steps.filter((step) => step.invoke).map((step) => step.invoke.operation))];
  const captures = [...new Set(steps.filter((step) => step.capture).map((step) => step.capture.id))];
  const fidelityChecks = preview?.fidelity?.checks ?? [];
  const groups = {};
  for (const check of fidelityChecks) {
    const group = fidelityGroup(check.requirement);
    (groups[group] ??= []).push(check);
  }

  const previewBadge = previewProvenance(preview);
  const activeBadge = snapshot?.provenance ?? 'preset';
  const runnable = previewRunnable(preview);
  const fidelityStatus = previewFidelityStatus(preview);
  const isComparison = preview?.plan?.goal?.type === 'compare-control';
  const useLocalParser = () => {
    setAiMode('local');
    setAiStatus('local');
    setAiError(null);
  };
  const configureProvider = (providerId) => {
    const provider = LLM_PROVIDERS.find((item) => item.id === providerId) ?? LLM_PROVIDERS[0];
    setAiConfig((current) => ({ ...current, providerId, model: provider.defaultModel, endpoint: '' }));
    setAiMode('local');
    setAiStatus('local');
  };

  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-black uppercase tracking-wider text-violet-600">{t('playground.agent.ask')}</span>
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') generate(); }}
        placeholder={t(examples.placeholderKey)}
        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
      />
      <button disabled={!goal.trim() || busy} onClick={generate}
        className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
        {busy ? t('playground.agent.busy') : t('playground.agent.generate')}
      </button>
    </div>
    <div className="mt-2 flex flex-wrap gap-2">
      {examples.items.slice(0, 3).map((example) => (
        <button key={example.id} onClick={() => setGoal(t(example.promptKey))} className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-50">
          {t(example.promptKey)}
        </button>
      ))}
    </div>
    <div className="mt-3 rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setAiOpen((value) => !value)} aria-expanded={aiOpen} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
        <span className="text-xs font-black uppercase tracking-wider text-slate-700">{t('playground.agent.aiTitle')}</span>
        <span className="text-[10px] font-bold text-slate-500">{aiStatus === 'ai' ? t('playground.agent.aiMode') : t('playground.agent.localMode')} · {aiOpen ? '−' : '+'}</span>
      </button>
      {aiOpen && <div className="border-t border-slate-100 p-3">
        <p className="text-xs leading-5 text-amber-800">{t('playground.agent.aiWarning')}</p>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">{t('playground.agent.aiDisclosure')}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-600">{t('playground.agent.provider')}
            <select value={aiConfig.providerId} onChange={(event) => configureProvider(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
              {LLM_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{t(provider.labelKey)}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">{t('playground.agent.model')}
            <input value={aiConfig.model} onChange={(event) => setAiConfig((current) => ({ ...current, model: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" />
          </label>
          <label className="text-xs font-bold text-slate-600 sm:col-span-2">{t('playground.agent.apiKey')}
            <input type="password" autoComplete="off" value={aiConfig.apiKey} onChange={(event) => { setAiConfig((current) => ({ ...current, apiKey: event.target.value })); setAiError(null); }} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 font-mono text-xs" />
          </label>
          {aiConfig.providerId === 'openai-compatible' && <label className="text-xs font-bold text-slate-600 sm:col-span-2">{t('playground.agent.endpoint')}
            <input value={aiConfig.endpoint} placeholder={t('playground.agent.endpointPlaceholder')} onChange={(event) => setAiConfig((current) => ({ ...current, endpoint: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" />
          </label>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button disabled={!aiConfig.apiKey.trim() || !aiConfig.model.trim()} onClick={() => { setAiMode('ai'); setAiStatus('ai'); setAiError(null); }} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('playground.agent.useAi')}</button>
          <button onClick={() => { setAiConfig((current) => ({ ...current, apiKey: '' })); useLocalParser(); }} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.clearKey')}</button>
          <button onClick={useLocalParser} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.useLocal')}</button>
          <span className="text-[11px] font-bold text-slate-500">{t('playground.agent.providerStatus', { provider: t(selectedProvider.labelKey), status: aiStatus === 'ai' ? t('playground.agent.aiMode') : t('playground.agent.localMode') })}</span>
        </div>
        {aiError && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{aiError}</p>}
      </div>}
    </div>

    {loadError && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
      {t('playground.agent.loadError')}: {loadError.code} — {loadError.message}
    </p>}

    {preview?.error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
      <p className="font-black">{preview.error.code}</p>
      <p className="mt-1">{preview.error.message}</p>
      {Object.keys(preview.error.details ?? {}).length > 0
        && <pre className="mt-2 overflow-auto font-mono text-[10px]">{JSON.stringify(preview.error.details, null, 2)}</pre>}
    </div>}

    {preview?.revisionError && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
      <p className="font-black">{t('playground.agent.revisionFailed')}: {preview.revisionError.code}</p>
      <p className="mt-1">{preview.revisionError.message}</p>
      <p className="mt-1 text-[10px]">{t('playground.agent.revisionKeptPreview')}</p>
    </div>}

    {preview?.script && <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">{t('playground.agent.preview')}</p>
          {previewBadge && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
            {t(`playground.agent.provenance.${previewBadge}`)}
          </span>}
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {t('playground.agent.active')}: {t(`playground.agent.provenance.${activeBadge}`)}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-white p-1">
          {TAB_KEYS.map((key) => (
            <button key={key} onClick={() => setTab(key)}
              className={`rounded-lg px-2 py-1 text-xs font-bold ${tab === key ? 'bg-violet-600 text-white' : 'text-slate-600'}`}>
              {t(`playground.agent.tab.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <p><span className="font-bold text-slate-500">{t('playground.agent.objective')}:</span> {preview.plan?.goal?.objective ?? t('playground.agent.notApplicable')}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.steps')}:</span> {steps.length}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.controls')}:</span> {controlsChanged.join(', ') || '—'}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.operations')}:</span> {operations.join(', ') || '—'}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.captures')}:</span> {captures.join(', ') || '—'}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.primitives')}:</span> {preview.script.primitives.map((primitive) => primitive.type).join(', ')}</p>
        <p className={fidelityStatus === 'passed' ? 'text-emerald-700' : fidelityStatus === 'failed' ? 'text-red-700' : 'text-slate-500'}>
          {fidelityStatus === 'passed' ? t('playground.agent.fidelityPassed')
            : fidelityStatus === 'failed' ? t('playground.agent.fidelityFailed')
              : t('playground.agent.fidelityNotAvailable')}
        </p>
      </div>}

      {tab === 'plan' && <div className="mt-3 max-h-64 overflow-auto rounded-xl bg-white p-3 font-mono text-[11px]">
        {preview.plan
          ? preview.plan.phases.map((phase, index) => (
            <p key={`${phase.id}-${index}`}>
              {phase.id}: {phase.kind}
              {phase.control !== undefined ? ` ${phase.control}=${JSON.stringify(phase.value)}` : ''}
              {phase.count !== undefined ? ` x${phase.count}` : ''}
              {phase.captureId ? ` -> ${phase.captureId}` : ''}
            </p>
          ))
          : <p>{t('playground.agent.planNotAvailable')}</p>}
      </div>}

      {tab === 'script' && <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-200">
        {JSON.stringify(preview.script, null, 2)}
      </pre>}

      {tab === 'fidelity' && <div className="mt-3 space-y-2">
        {preview.mode === 'imported' && <div className="rounded-xl bg-white p-3 text-xs text-slate-600">
          <p className="font-bold text-emerald-700">✓ {t('playground.agent.validationPassed')}</p>
          <p className="mt-1 font-bold text-emerald-700">✓ {t('playground.agent.dryRunPassed')}</p>
          <p className="mt-1">{t('playground.agent.fidelityNotAvailable')}</p>
        </div>}
        {Object.entries(groups).map(([group, checks]) => (
          <div key={group} className="rounded-xl bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{group}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {checks.map((check) => (
                <span key={check.requirement}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${check.satisfied ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {check.satisfied ? '✓' : '✗'} {check.requirement}
                </span>
              ))}
            </div>
          </div>
        ))}
        {fidelityStatus === 'failed' && preview?.fidelity?.missing?.length > 0 && (
          <p className="text-xs font-bold text-red-700">{t('playground.agent.missing')}: {preview.fidelity.missing.join(', ')}</p>
        )}
      </div>}

      <div className="mt-4 space-y-3">
        <div className="rounded-xl bg-white p-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-violet-600">{t('playground.agent.reviseTitle')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => applyRevision({ type: 'focus_result' })} disabled={busy}
              className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-40">
              {t('playground.agent.focusResult')}
            </button>
            <span className="text-xs font-bold text-slate-600">{t('playground.agent.maxSteps')}</span>
            <input type="number" min="1" value={shortenSteps}
              onChange={(event) => setShortenSteps(Number(event.target.value))}
              className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
            <button onClick={() => applyRevision({ type: 'shorten', maxSteps: shortenSteps })} disabled={busy || !Number.isInteger(shortenSteps) || shortenSteps < 1}
              className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-40">
              {t('playground.agent.shorten')}
            </button>
          </div>
          {availableTypes.length > 0 && <div className="mt-2">
            <div className="flex flex-wrap gap-2">
              {availableTypes.map((type) => (
                <label key={type} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} className="h-3 w-3 accent-violet-600" />
                  {type}
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={() => applyRevision({ type: 'keep_visuals', primitiveTypes: selectedTypes })} disabled={busy || !selectedTypes.length}
                className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-40">
                {t('playground.agent.keepVisuals')}
              </button>
              <button onClick={() => applyRevision({ type: 'remove_visual', primitiveTypes: selectedTypes })} disabled={busy || !selectedTypes.length}
                className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-40">
                {t('playground.agent.removeVisual')}
              </button>
            </div>
          </div>}
          {isComparison && <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600">{t('playground.agent.compareValues', { control: preview.plan.goal.control })}</span>
            <input type="number" value={leftValue} onChange={(event) => setLeftValue(event.target.value)}
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
            <input type="number" value={rightValue} onChange={(event) => setRightValue(event.target.value)}
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
            <button onClick={() => applyRevision({ type: 'change_comparison_values', control: preview.plan.goal.control, values: [Number(leftValue), Number(rightValue)] })}
              disabled={busy || !leftValue || !rightValue}
              className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-40">
              {t('playground.agent.changeValues')}
            </button>
          </div>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button disabled={!runnable || busy} onClick={runPreview}
            className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
            {t('playground.agent.run')}
          </button>
          <button onClick={copyJson} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.copyJson')}</button>
          <button onClick={downloadJson} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.downloadJson')}</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.loadJson')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onLoadFile} />
        </div>
      </div>
    </div>}
  </div>;
}
