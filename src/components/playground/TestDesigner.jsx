import { useMemo, useState } from 'react';
import {
  TEST_DESIGN_PREDICTION_CHOICES,
  createTestDesign,
  validateTestDesign,
} from '../../core/exploration/testDesign.js';

function valueLabel(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function inputValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function optionTarget(option, value) {
  if (option.type === 'boolean') return value === 'true';
  if (option.type === 'number' || option.type === 'integer') return value === '' ? undefined : Number(value);
  return value;
}

function factorLabelKey(id) {
  const exact = {
    'world.relation': 'playground.testDesign.option.relationSlope',
    'observationProcess.noise': 'playground.testDesign.option.noise',
    'observationProcess.sampleCount': 'playground.testDesign.option.sampleCount',
    'observationProcess.sample': 'playground.testDesign.option.sampleAgain',
  }[id];
  if (exact) return exact;
  if (id?.includes('.controls.')) return `playground.control.${id.split('.').at(-1)}`;
  if (['world', 'observationProcess', 'trainTest', 'model', 'learning', 'evaluation', 'randomness'].includes(id)) return `playground.experiment.factor.${id}`;
  const factor = id?.split('.')[0];
  return ['world', 'observationProcess', 'trainTest', 'model', 'learning', 'evaluation', 'randomness'].includes(factor)
    ? `playground.experiment.factor.${factor}`
    : 'playground.testDesign.unknownFactor';
}

function errorKey(error) {
  return ['missing-baseline', 'missing-outcome', 'unsupported-intervention', 'missing-target', 'target-out-of-range'].includes(error)
    ? `playground.testDesign.error.${error}`
    : 'playground.testDesign.error.invalid';
}

export default function TestDesigner({ hypothesis, snapshot, capabilities, t, onSave, onCancel, existingDesign = null }) {
  const options = capabilities?.options ?? [];
  const initialOption = existingDesign?.intervention
    ? options.find((option) => option.operationType === existingDesign.intervention.operationType
      && option.controlKey === existingDesign.intervention.controlKey
      && option.path === existingDesign.intervention.path)
    : options[0];
  const [optionId, setOptionId] = useState(initialOption?.id ?? '');
  const option = options.find((item) => item.id === optionId) ?? initialOption ?? null;
  const [toValue, setToValue] = useState(inputValue(existingDesign?.intervention?.toValue ?? option?.defaultToValue));
  const [held, setHeld] = useState((existingDesign?.heldConstantFactors ?? []).filter((id) => id !== initialOption?.semanticPath));
  const [outcomes, setOutcomes] = useState(existingDesign?.outcomeObservableIds ?? capabilities?.outcomes?.slice(0, 1).map((item) => item.id) ?? []);
  const [prediction, setPrediction] = useState(existingDesign?.prediction?.choice ?? hypothesis?.prediction?.choice ?? 'uncertain');
  const [error, setError] = useState(null);

  const draft = useMemo(() => createTestDesign({
    id: existingDesign?.id ?? `test-design-${hypothesis.id}`,
    hypothesisId: hypothesis.id,
    baselineExperimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id,
    intervention: option ? {
      factorKind: option.factorKind,
      semanticPath: option.semanticPath,
      operationType: option.operationType,
      controlKey: option.controlKey,
      path: option.path,
      requiresRegenerate: option.requiresRegenerate,
      fromValue: option.currentValue,
      ...(option.operationType !== 'RESAMPLE_WORLD' ? { toValue: optionTarget(option, toValue) } : {}),
    } : null,
    heldConstantFactors: held,
    outcomeObservableIds: outcomes,
    prediction: { choice: prediction },
  }), [existingDesign?.id, hypothesis.id, snapshot?.experimentWorkspace?.activeExperimentId, snapshot?.experiment?.id, option, toValue, held, outcomes, prediction]);
  const validation = validateTestDesign(draft, { capabilities });
  const toggle = (setter, id) => setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const save = () => {
    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }
    setError(null);
    onSave?.(validation.design);
  };

  return <section data-test-designer="true" className="test-designer mt-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide text-orange-700">{t('playground.testDesign.kicker')}</p>
        <h4 className="text-sm font-black text-orange-950">{t('playground.testDesign.title')}</h4>
      </div>
      <button type="button" onClick={onCancel} className="hypothesis-action hypothesis-action-neutral">{t('playground.testDesign.cancel')}</button>
    </div>
    <p className="mt-2 break-words text-xs text-slate-700">{t('playground.testDesign.hypothesis', { statement: hypothesis.statement })}</p>
    <label className="mt-3 block text-[11px] font-black text-slate-700" htmlFor="test-design-change">{t('playground.testDesign.change')}</label>
    <select id="test-design-change" value={option?.id ?? ''} onChange={(event) => { setOptionId(event.target.value); const next = options.find((item) => item.id === event.target.value); setToValue(inputValue(next?.defaultToValue)); setHeld((current) => current.filter((id) => id !== next?.semanticPath)); }} className="mt-1 min-h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200">
      {options.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)} ({valueLabel(item.currentValue)})</option>)}
    </select>
    {option?.operationType !== 'RESAMPLE_WORLD' && <label className="mt-2 block text-[11px] font-black text-slate-700" htmlFor="test-design-to">{t('playground.testDesign.to')}</label>}
    {option?.operationType !== 'RESAMPLE_WORLD' && option?.type === 'boolean' && <select id="test-design-to" value={toValue} onChange={(event) => setToValue(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs"><option value="true">true</option><option value="false">false</option></select>}
    {option?.operationType !== 'RESAMPLE_WORLD' && option?.type === 'select' && <select id="test-design-to" value={toValue} onChange={(event) => setToValue(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs">{(option.options ?? []).map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>}
    {option?.operationType !== 'RESAMPLE_WORLD' && option?.type !== 'boolean' && option?.type !== 'select' && <input id="test-design-to" type="number" value={toValue} min={option?.min} max={option?.max} step={option?.step ?? 'any'} onChange={(event) => setToValue(event.target.value)} className="mt-1 min-h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs" />}
    <fieldset className="mt-3">
      <legend className="text-[11px] font-black text-slate-700">{t('playground.testDesign.hold')}</legend>
      <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">{(capabilities?.heldOptions ?? []).filter((id) => id !== option?.semanticPath).map((id) => <label key={id} className="flex min-w-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] text-slate-700"><input type="checkbox" checked={held.includes(id)} onChange={() => toggle(setHeld, id)} className="accent-orange-500" /><span className="truncate">{t(factorLabelKey(id))}</span></label>)}</div>
    </fieldset>
    <fieldset className="mt-3">
      <legend className="text-[11px] font-black text-slate-700">{t('playground.testDesign.observe')}</legend>
      <div className="mt-1 space-y-1">{(capabilities?.outcomes ?? []).map((item) => <label key={item.id} className="flex min-w-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] text-slate-700"><input type="checkbox" checked={outcomes.includes(item.id)} onChange={() => toggle(setOutcomes, item.id)} className="accent-cyan-500" /><span className="truncate">{item.labelKey ? t(item.labelKey) : item.id}</span></label>)}</div>
    </fieldset>
    <fieldset className="mt-3">
      <legend className="text-[11px] font-black text-slate-700">{t('playground.testDesign.prediction')}</legend>
      <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">{TEST_DESIGN_PREDICTION_CHOICES.map((choice) => <button key={choice} type="button" aria-pressed={prediction === choice} onClick={() => setPrediction(choice)} className={`rounded-lg border px-2 py-1 text-[10px] font-black ${prediction === choice ? 'border-orange-500 bg-orange-200 text-orange-950' : 'border-orange-200 bg-white text-slate-700'}`}>{t(`playground.hypothesis.predictionChoice.${choice}`)}</button>)}</div>
    </fieldset>
    {error && <p role="alert" className="mt-2 text-[11px] font-bold text-red-700">{t(errorKey(error))}</p>}
    <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={save} className="hypothesis-action hypothesis-action-primary">{t('playground.testDesign.save')}</button></div>
  </section>;
}
