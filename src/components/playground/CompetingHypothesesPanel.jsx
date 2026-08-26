import { useState } from 'react';
import {
  deriveDiscriminationStructure,
  discriminationStatusMessageKey,
} from '../../core/exploration/competingHypotheses.js';
import { HYPOTHESIS_PREDICTION_CHOICES } from '../../core/exploration/hypothesis.js';
import Lumi from './Lumi.jsx';

function observedDirection(result) {
  const outcome = result?.outcomes?.find((item) => item.before !== null && item.after !== null);
  if (!outcome) return null;
  if (outcome.after > outcome.before) return 'increase';
  if (outcome.after < outcome.before) return 'decrease';
  return 'similar';
}

function predictionLabel(choice, t) {
  return t(`playground.hypothesis.predictionChoice.${choice}`);
}

export default function CompetingHypothesesPanel({ hypotheses = [], groups = [], plans = [], testDesigns = [], testDesignResults = {}, compact = false, t, onCreateGroup, onCreatePlan }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [question, setQuestion] = useState('');
  const [drafts, setDrafts] = useState({});
  if (hypotheses.length < 2 && groups.length === 0) return null;

  const toggleHypothesis = (id) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id].slice(0, 4));
  const createGroup = () => {
    const created = onCreateGroup?.({ question, hypothesisIds: selectedIds });
    if (created) {
      setQuestion('');
      setSelectedIds([]);
    }
  };
  const updateDraft = (groupId, patch) => setDrafts((current) => ({ ...current, [groupId]: { ...(current[groupId] ?? {}), ...patch } }));
  const createPlan = (group) => {
    const draft = drafts[group.id] ?? {};
    const predictedOutcomes = group.hypothesisIds.map((hypothesisId) => ({
      hypothesisId,
      prediction: draft.predictions?.[hypothesisId] ?? 'uncertain',
    }));
    onCreatePlan?.({ groupId: group.id, testDesignId: draft.testDesignId, predictedOutcomes });
  };

  return <section data-competing-hypotheses="true" className={`rounded-2xl border border-violet-200 bg-violet-50/60 p-3 ${compact ? 'text-sm' : ''}`} aria-label={t('playground.discrimination.ariaLabel')}>
    <div className="flex items-start gap-2">
      <Lumi presence="contextual" mode="explore" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">{t('playground.discrimination.kicker')}</p>
        <h3 className="text-sm font-black text-slate-950">{t('playground.discrimination.title')}</h3>
        <p className="mt-1 text-xs text-violet-950">{t('playground.discrimination.boundary')}</p>
      </div>
    </div>

    {hypotheses.length >= 2 && <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
      <p className="text-xs font-black text-slate-800">{t('playground.discrimination.choose')}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {hypotheses.map((hypothesis) => <label key={hypothesis.id} className="flex min-w-0 items-start gap-2 rounded-lg border border-violet-100 bg-violet-50/50 px-2 py-2 text-xs text-slate-800">
          <input type="checkbox" checked={selectedIds.includes(hypothesis.id)} onChange={() => toggleHypothesis(hypothesis.id)} className="mt-1 accent-violet-600" />
          <span className="min-w-0 break-words">{hypothesis.statement}</span>
        </label>)}
      </div>
      <label className="mt-2 block text-[11px] font-black text-slate-700" htmlFor="competing-hypothesis-question">{t('playground.discrimination.questionLabel')}</label>
      <input id="competing-hypothesis-question" value={question} maxLength={240} onChange={(event) => setQuestion(event.target.value)} placeholder={t('playground.discrimination.questionPlaceholder')} className="mt-1 min-h-9 w-full rounded-lg border border-violet-200 bg-white px-2 text-xs text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200" />
      <button type="button" disabled={selectedIds.length < 2} onClick={createGroup} className="mt-2 rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{t('playground.discrimination.createGroup')}</button>
    </div>}

    {groups.map((group) => {
      const draft = drafts[group.id] ?? {};
      const groupPlans = plans.filter((plan) => plan.hypothesisGroupId === group.id);
      return <article key={group.id} className="mt-3 rounded-xl border border-violet-200 bg-white p-3" data-hypothesis-group={group.id}>
        <p className="text-xs font-black text-slate-950">{group.question || t('playground.discrimination.untitledGroup')}</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-700">{group.hypothesisIds.map((hypothesisId) => <li key={hypothesisId} className="rounded-lg bg-violet-50 px-2 py-1">{hypotheses.find((item) => item.id === hypothesisId)?.statement ?? hypothesisId}</li>)}</ul>
        {testDesigns.length > 0 && <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50/60 p-2">
          <label className="block text-[11px] font-black text-slate-700" htmlFor={`discrimination-test-${group.id}`}>{t('playground.discrimination.testLabel')}</label>
          <select id={`discrimination-test-${group.id}`} value={draft.testDesignId ?? ''} onChange={(event) => updateDraft(group.id, { testDesignId: event.target.value })} className="mt-1 min-h-9 w-full rounded-lg border border-orange-200 bg-white px-2 text-xs text-slate-900">
            <option value="">{t('playground.discrimination.testPlaceholder')}</option>
            {testDesigns.map((design) => <option key={design.id} value={design.id}>{design.intervention?.semanticPath ?? design.id}</option>)}
          </select>
          <div className="mt-2 space-y-2">{group.hypothesisIds.map((hypothesisId) => <div key={hypothesisId} className="rounded-lg border border-orange-100 bg-white p-2">
            <p className="break-words text-[11px] font-bold text-slate-700">{hypotheses.find((item) => item.id === hypothesisId)?.statement ?? hypothesisId}</p>
            <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">{HYPOTHESIS_PREDICTION_CHOICES.map((choice) => <button key={choice} type="button" aria-pressed={draft.predictions?.[hypothesisId] === choice} onClick={() => updateDraft(group.id, { predictions: { ...(draft.predictions ?? {}), [hypothesisId]: choice } })} className={`rounded-lg border px-1 py-1 text-[10px] font-black ${draft.predictions?.[hypothesisId] === choice ? 'border-orange-500 bg-orange-200 text-orange-950' : 'border-orange-100 bg-white text-slate-700'}`}>{predictionLabel(choice, t)}</button>)}</div>
          </div>)}</div>
          <button type="button" disabled={!draft.testDesignId} onClick={() => createPlan(group)} className="mt-2 rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{t('playground.discrimination.createPlan')}</button>
        </div>}
        {groupPlans.map((plan) => {
          const result = testDesignResults[plan.testDesignId];
          const structure = deriveDiscriminationStructure({ plan, group, observedPrediction: observedDirection(result) });
          return <div key={plan.id} className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50/70 p-2" data-discrimination-plan={plan.id}>
            <p className="text-xs font-black text-cyan-950">{t(discriminationStatusMessageKey(structure.status))}</p>
            {structure.status === 'predictions-diverge' && <p className="mt-1 text-[11px] text-cyan-900">{t('playground.discrimination.lumiDiverge')}</p>}
            {structure.status === 'predictions-overlap' && <p className="mt-1 text-[11px] text-cyan-900">{t('playground.discrimination.lumiOverlap')}</p>}
            {structure.predictions.map((prediction) => <p key={prediction.hypothesisId} className="mt-1 text-[10px] text-slate-700">{hypotheses.find((item) => item.id === prediction.hypothesisId)?.statement ?? prediction.hypothesisId}: {predictionLabel(prediction.prediction, t)}{prediction.matchesObservedDirection ? ` · ${t('playground.discrimination.matchesObserved')}` : ''}</p>)}
            {structure.observedPrediction && <p className="mt-1 text-[10px] font-black text-cyan-950">{t('playground.discrimination.observed', { prediction: predictionLabel(structure.observedPrediction, t) })}</p>}
          </div>;
        })}
      </article>;
    })}
  </section>;
}
