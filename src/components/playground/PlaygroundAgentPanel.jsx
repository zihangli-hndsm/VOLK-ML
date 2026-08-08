import { useRef, useState } from 'react';

// User-facing Agent surface (PR F.2): Ask Agent -> plan -> compose -> preview
// -> inspect -> run -> revise -> export/import. Nothing runs unseen: the
// generated TeachingPlan / Script enters a preview state first and is only
// loaded into the runtime when the user clicks Run. All execution goes
// through the existing Playground Host / Agent / Script Runtime APIs.

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
  const fileRef = useRef(null);

  const generate = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setLoadError(null);
    try {
      const plan = await agent.plan(goal);
      const composed = await agent.composeScript(plan);
      setPreview({
        mode: composed.mode,
        plan,
        script: composed.script,
        fidelity: composed.fidelity,
        dryRun: composed.dryRun,
        error: null,
      });
      setTab('overview');
    } catch (error) {
      setPreview({
        error: {
          code: error?.code ?? 'OPERATION_FAILED',
          message: error?.message ?? String(error),
          details: error?.details ?? {},
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!preview?.script) return;
    const provenance = preview.mode === 'revised' ? 'revised' : 'composed';
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
      await host.loadScript(script, { provenance: 'imported' });
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

  const provenance = snapshot?.provenance ?? 'preset';
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

  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-black uppercase tracking-wider text-violet-600">{t('playground.agent.ask')}</span>
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') generate(); }}
        placeholder={t('playground.agent.placeholder')}
        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
      />
      <button disabled={!goal.trim() || busy} onClick={generate}
        className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
        {busy ? t('playground.agent.busy') : t('playground.agent.generate')}
      </button>
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

    {preview?.script && <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wider text-slate-600">{t('playground.agent.preview')}</p>
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
        <p><span className="font-bold text-slate-500">{t('playground.agent.objective')}:</span> {preview.plan?.goal?.objective}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.steps')}:</span> {steps.length}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.controls')}:</span> {controlsChanged.join(', ') || '—'}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.operations')}:</span> {operations.join(', ') || '—'}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.captures')}:</span> {captures.join(', ') || '—'}</p>
        <p><span className="font-bold text-slate-500">{t('playground.agent.primitives')}:</span> {preview.script.primitives.map((primitive) => primitive.type).join(', ')}</p>
        <p className={preview.fidelity?.valid ? 'text-emerald-700' : 'text-red-700'}>
          {preview.fidelity?.valid ? t('playground.agent.fidelityPassed') : t('playground.agent.fidelityFailed')}
        </p>
      </div>}

      {tab === 'plan' && <div className="mt-3 max-h-64 overflow-auto rounded-xl bg-white p-3 font-mono text-[11px]">
        {preview.plan?.phases?.map((phase, index) => (
          <p key={`${phase.id}-${index}`}>
            {phase.id}: {phase.kind}
            {phase.control !== undefined ? ` ${phase.control}=${JSON.stringify(phase.value)}` : ''}
            {phase.count !== undefined ? ` x${phase.count}` : ''}
            {phase.captureId ? ` -> ${phase.captureId}` : ''}
          </p>
        ))}
      </div>}

      {tab === 'script' && <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-200">
        {JSON.stringify(preview.script, null, 2)}
      </pre>}

      {tab === 'fidelity' && <div className="mt-3 space-y-2">
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
        {!preview.fidelity?.valid && preview.fidelity?.missing?.length > 0 && (
          <p className="text-xs font-bold text-red-700">{t('playground.agent.missing')}: {preview.fidelity.missing.join(', ')}</p>
        )}
      </div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button disabled={!preview.fidelity?.valid} onClick={runPreview}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
          {t('playground.agent.run')}
        </button>
        <button onClick={copyJson} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.copyJson')}</button>
        <button onClick={downloadJson} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.downloadJson')}</button>
        <button onClick={() => fileRef.current?.click()} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.agent.loadJson')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onLoadFile} />
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
          {t(`playground.agent.provenance.${provenance}`) ?? provenance}
        </span>
      </div>
    </div>}
  </div>;
}
