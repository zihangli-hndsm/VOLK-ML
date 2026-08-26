import { useMemo, useState } from 'react';
import { COUNTERFACTUAL_STATUSES, isCounterfactualStale } from '../../core/exploration/counterfactual.js';
import { HYPOTHESIS_PREDICTION_CHOICES } from '../../core/exploration/hypothesis.js';

function optionLabel(option, t) {
  return option.labelKey ? t(option.labelKey) : option.semanticPath ?? option.controlKey ?? option.path ?? option.id;
}

function statusLabel(status, t) {
  return t(`playground.counterfactual.status.${status}`);
}

export default function CounterfactualExplorationPanel({ snapshot, capabilities, hypotheses = [], questions = [], testDesigns = [], compact = false, t, onCreate, onConvert, conditionFingerprint = null }) {
  const [question, setQuestion] = useState('');
  const [optionId, setOptionId] = useState('');
  const [hypothesisId, setHypothesisId] = useState('');
  const [prediction, setPrediction] = useState(null);
  const [outcomeIds, setOutcomeIds] = useState([]);
  const options = capabilities?.options ?? [];
  const outcomes = capabilities?.outcomes ?? [];
  const fingerprint = conditionFingerprint ?? snapshot?.experiment?.conditionFingerprint ?? snapshot?.experimentWorkspace?.activeConditionFingerprint ?? null;
  const baselineExperimentId = snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id ?? null;
  const selectedOption = options.find((option) => option.id === optionId) ?? null;
  const canCreate = Boolean(question.trim() && selectedOption && baselineExperimentId && fingerprint);
  const create = () => {
    if (!canCreate) return;
    const created = onCreate?.({
      question,
      intervention: selectedOption,
      prediction: prediction ? { choice: prediction } : null,
      outcomeObservableIds: outcomeIds,
      heldConstantFactors: options.filter((option) => option.id !== selectedOption.id).slice(0, 6).map((option) => option.semanticPath ?? option.controlKey ?? option.path),
    });
    if (created) {
      setQuestion('');
      setPrediction(null);
      setOutcomeIds([]);
    }
  };
  const availableHypotheses = useMemo(() => hypotheses.filter(Boolean), [hypotheses]);
  if (!capabilities || (options.length === 0 && questions.length === 0)) return null;
  return <section data-counterfactual-exploration="true" className={`rounded-2xl border border-violet-200 bg-violet-50/50 p-3 ${compact ? 'text-[11px]' : ''}`} aria-label={t('playground.counterfactual.ariaLabel')}>
    <div className="flex items-start gap-2">
      <span className="mt-0.5 rounded-full bg-violet-600 px-2 py-1 text-[10px] font-black text-white">?</span>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">{t('playground.counterfactual.kicker')}</p>
        <h3 className="text-sm font-black text-violet-950">{t('playground.counterfactual.title')}</h3>
        <p className="mt-1 text-xs text-violet-900">{t('playground.counterfactual.boundary')}</p>
      </div>
    </div>
    {options.length > 0 && <div className="mt-3 space-y-2 rounded-xl border border-violet-200 bg-white p-3">
      <label className="block text-[11px] font-black text-slate-700" htmlFor="counterfactual-question">{t('playground.counterfactual.questionLabel')}</label>
      <textarea id="counterfactual-question" value={question} maxLength={240} onChange={(event) => setQuestion(event.target.value)} placeholder={t('playground.counterfactual.questionPlaceholder')} className="min-h-16 w-full resize-y rounded-xl border border-violet-200 px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200" />
      <label className="block text-[11px] font-black text-slate-700" htmlFor="counterfactual-factor">{t('playground.counterfactual.factorLabel')}</label>
      <select id="counterfactual-factor" value={optionId} onChange={(event) => setOptionId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200">
        <option value="">{t('playground.counterfactual.factorPlaceholder')}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{optionLabel(option, t)}</option>)}
      </select>
      {outcomes.length > 0 && <fieldset>
        <legend className="text-[11px] font-black text-slate-700">{t('playground.counterfactual.outcomeLabel')}</legend>
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">{outcomes.map((outcome) => <label key={outcome.id} className="flex items-center gap-2 rounded-lg border border-cyan-100 bg-cyan-50/60 px-2 py-2 text-[11px] text-slate-700"><input type="checkbox" checked={outcomeIds.includes(outcome.id)} onChange={(event) => setOutcomeIds((current) => event.target.checked ? [...new Set([...current, outcome.id])] : current.filter((id) => id !== outcome.id))} className="accent-cyan-600" />{outcome.labelKey ? t(outcome.labelKey) : outcome.id}</label>)}</div>
      </fieldset>}
      <fieldset>
        <legend className="text-[11px] font-black text-slate-700">{t('playground.counterfactual.predictionLabel')}</legend>
        <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">{HYPOTHESIS_PREDICTION_CHOICES.map((choice) => <button key={choice} type="button" aria-pressed={prediction === choice} onClick={() => setPrediction((current) => current === choice ? null : choice)} className={`rounded-lg border px-2 py-2 text-[11px] font-black ${prediction === choice ? 'border-orange-500 bg-orange-100 text-orange-950' : 'border-orange-200 bg-white text-slate-700'}`}>{t(`playground.hypothesis.predictionChoice.${choice}`)}</button>)}</div>
      </fieldset>
      <button type="button" disabled={!canCreate} onClick={create} className="rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white hover:bg-violet-800 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50">{t('playground.counterfactual.save')}</button>
      {!fingerprint && <p className="text-[11px] text-orange-800">{t('playground.counterfactual.noBaseline')}</p>}
    </div>}
    {questions.length > 0 && <div className="mt-3 space-y-2" role="list" aria-label={t('playground.counterfactual.listLabel')}>
      {questions.map((item) => {
        const stale = item.status !== COUNTERFACTUAL_STATUSES.STALE && isCounterfactualStale(item, { baselineExperimentId, conditionFingerprint: fingerprint });
        const displayStatus = stale ? COUNTERFACTUAL_STATUSES.STALE : item.status;
        const design = testDesigns.find((candidate) => candidate.id === `test-design-${item.id}`);
        return <article key={item.id} data-counterfactual-question={item.id} className="rounded-xl border border-violet-200 bg-white px-3 py-2">
          <p className="text-xs font-black text-violet-950">{item.question}</p>
          <p className="mt-1 text-[10px] text-slate-600">{optionLabel(item.intervention, t)} · {statusLabel(displayStatus, t)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!stale && hypotheses.length > 0 && <><select aria-label={t('playground.counterfactual.hypothesisLabel')} value={hypothesisId} onChange={(event) => setHypothesisId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700"><option value="">{t('playground.counterfactual.hypothesisPlaceholder')}</option>{availableHypotheses.map((hypothesis) => <option key={hypothesis.id} value={hypothesis.id}>{hypothesis.statement}</option>)}</select><button type="button" disabled={!hypothesisId || Boolean(design)} onClick={() => { onConvert?.(item, hypothesisId); setHypothesisId(''); }} className="rounded-lg border border-orange-300 bg-orange-50 px-2 py-2 text-[11px] font-black text-orange-950 disabled:cursor-not-allowed disabled:opacity-50">{design ? t('playground.counterfactual.converted') : t('playground.counterfactual.testThis')}</button></>}
            {stale && <span className="text-[11px] text-orange-800">{t('playground.counterfactual.staleHelp')}</span>}
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
