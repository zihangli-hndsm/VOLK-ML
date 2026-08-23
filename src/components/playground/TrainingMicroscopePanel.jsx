import { useEffect, useMemo, useState } from 'react';

const numberText = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toFixed(5)
  : '—';

function ObjectiveTiming({ objective, t }) {
  if (!objective) return null;
  return <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
    <div><dt className="text-slate-500">{t('playground.trainingMicroscope.lossBefore')}</dt><dd className="font-mono font-bold">{numberText(objective.before?.lossNormalized)}</dd></div>
    <div><dt className="text-slate-500">{t('playground.trainingMicroscope.lossAfter')}</dt><dd className="font-mono font-bold">{numberText(objective.after?.lossNormalized)}</dd></div>
  </dl>;
}

function ParameterPair({ value, t }) {
  if (!value) return <p className="text-sm text-slate-500">{t('playground.trainingMicroscope.unavailable')}</p>;
  return <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
    <div><dt className="text-slate-500">{t('playground.trainingMicroscope.slope')}</dt><dd className="font-mono font-bold">{numberText(value.weight)}</dd></div>
    <div><dt className="text-slate-500">{t('playground.trainingMicroscope.bias')}</dt><dd className="font-mono font-bold">{numberText(value.bias)}</dd></div>
  </dl>;
}

export default function TrainingMicroscopePanel({ snapshot, onDispatch, t, openByDefault = false }) {
  const microscope = snapshot?.trainingMicroscope;
  const [selectedStep, setSelectedStep] = useState(null);
  const [open, setOpen] = useState(openByDefault);
  const identity = microscope?.runIdentity?.conditionFingerprint ?? null;
  useEffect(() => setSelectedStep(null), [identity]);
  useEffect(() => setOpen(openByDefault), [identity, openByDefault]);
  const selected = useMemo(
    () => microscope?.steps?.find((step) => step.step === selectedStep) ?? microscope?.selectedStep ?? null,
    [microscope, selectedStep],
  );
  if (!microscope) return null;
  const canStep = Boolean(microscope.canStep);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
    <summary className="cursor-pointer font-black text-slate-900">{t('playground.trainingMicroscope.title')}</summary>
    <div className="mt-3 space-y-4">
      <p className="text-sm text-slate-600">{t('playground.trainingMicroscope.description')}</p>
      {!microscope.available && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('playground.trainingMicroscope.unavailable')}</p>}
      {microscope.available && <>
        {microscope.status === 'reduced' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('playground.trainingMicroscope.reduced')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-black text-slate-800">{t('playground.trainingMicroscope.loss')}</span>
          <span className="text-xs font-bold text-slate-500">{t('playground.trainingMicroscope.currentStep')}: {microscope.currentRuntimeStep} / {microscope.totalSteps}</span>
          <button type="button" disabled={!canStep} onClick={() => onDispatch({ type: 'TRAINING_STEP' })} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{t('playground.trainingMicroscope.nextStep')}</button>
        </div>
        {selected?.objective && <section className="rounded-xl bg-white p-3"><h4 className="text-xs font-black uppercase text-slate-500">{t('playground.trainingMicroscope.stepOutcome')}</h4><ObjectiveTiming objective={selected.objective} t={t} />{selected.outcome?.status === 'stopped' && <p role="status" className="mt-2 text-xs font-bold text-amber-800">{t('playground.trainingMicroscope.trainingStopped')}</p>}</section>}
        {microscope.lossTrace.length ? <div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label={t('playground.trainingMicroscope.lossTrace')}>
          {microscope.lossTrace.map((point) => <button key={point.step} type="button" aria-label={`${t('playground.trainingMicroscope.recordedStep')} ${point.step}`} aria-pressed={selectedStep === point.step} onClick={() => setSelectedStep(point.step)} className={`min-w-16 rounded-lg border px-2 py-2 text-left text-[11px] ${selectedStep === point.step ? 'border-blue-500 bg-blue-100' : 'border-slate-200 bg-white'}`}>
            <span className="block font-black">{point.step}</span><span className="font-mono text-slate-600">{numberText(point.loss)}</span>
          </button>)}
        </div> : <p className="text-sm text-slate-500">{t('playground.trainingMicroscope.noTrace')}</p>}
        <div className="grid gap-3 md:grid-cols-4">
          <section className="rounded-xl bg-white p-3"><h4 className="text-xs font-black uppercase text-slate-500">{t('playground.trainingMicroscope.before')}</h4><ParameterPair value={selected?.parameters?.before} t={t} /></section>
          <section className="rounded-xl bg-white p-3"><h4 className="text-xs font-black uppercase text-slate-500">{t('playground.trainingMicroscope.gradient')}</h4><ParameterPair value={selected?.gradients} t={t} /></section>
          <section className="rounded-xl bg-white p-3"><h4 className="text-xs font-black uppercase text-slate-500">{t('playground.trainingMicroscope.update')}</h4><p className="text-xs text-slate-500">{t('playground.trainingMicroscope.learningRate')}: <span className="font-mono font-bold">{numberText(selected?.update?.learningRate)}</span></p><ParameterPair value={selected?.update?.delta} t={t} /></section>
          <section className="rounded-xl bg-white p-3"><h4 className="text-xs font-black uppercase text-slate-500">{t('playground.trainingMicroscope.after')}</h4><ParameterPair value={selected?.parameters?.after} t={t} /></section>
        </div>
        <p className="text-xs text-slate-500">{t('playground.trainingMicroscope.currentModel')}: {t('playground.trainingMicroscope.slope')} {numberText(microscope.currentModel?.weight)}, {t('playground.trainingMicroscope.bias')} {numberText(microscope.currentModel?.bias)}. {selected ? `${t('playground.trainingMicroscope.recordedStep')} ${selected.step}` : ''}</p>
        <section className="rounded-xl border border-slate-200 bg-white p-3"><h4 className="text-xs font-black uppercase text-slate-500">{t('playground.trainingMicroscope.preprocessing')}</h4>{microscope.preprocessing.length ? <ul className="mt-2 space-y-1 text-xs text-slate-600">{microscope.preprocessing.map((record) => <li key={record.id}><span className="font-bold">{record.kind}</span> — {record.status}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">{t('playground.trainingMicroscope.preprocessingNone')}</p>}</section>
      </>}
    </div>
  </details>;
}
