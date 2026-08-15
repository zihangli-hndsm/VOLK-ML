import { useState } from 'react';

const factorKeys = {
  world: 'playground.experiment.factor.world',
  trainTest: 'playground.experiment.factor.trainTest',
  model: 'playground.experiment.factor.model',
  learning: 'playground.experiment.factor.learning',
  evaluation: 'playground.experiment.factor.evaluation',
  randomness: 'playground.experiment.factor.randomness',
};

function metricRows(results) {
  const metrics = results?.metrics ?? {};
  const model = results?.model ?? {};
  return [
    ['trainMse', metrics.trainMse ?? metrics.mse],
    ['testMse', metrics.testMse],
    ['slope', model.weight],
    ['bias', model.bias],
  ].filter(([, value]) => value !== undefined && value !== null && Number.isFinite(Number(value)));
}

export default function ExperimentBar({ snapshot, onDispatch, t, highlightedAffordances = [] }) {
  const [repeatCount, setRepeatCount] = useState(snapshot.repeatEvidence?.trialCount ?? 5);
  const highlight = (id) => highlightedAffordances.includes(id) ? ' ring-2 ring-amber-400 ring-offset-1' : '';
  const workspace = snapshot.experimentWorkspace;
  if (!workspace) return null;
  const comparison = workspace.comparison;
  const diff = comparison?.diff;
  const activeId = workspace.activeExperimentId;
  const targetId = comparison?.againstExperimentId;
  const active = workspace.experiments.find((item) => item.id === activeId);
  const target = workspace.experiments.find((item) => item.id === targetId);
  const changed = diff?.changed ?? [];
  const unchanged = diff?.unchanged ?? [];
  const generatorChanged = diff?.details?.worldGenerator?.changed ?? [];
  const generatorUnchanged = diff?.details?.worldGenerator?.unchanged ?? [];
  const resultRows = comparison?.results?.active && comparison?.results?.against
    ? metricRows(comparison.results.active).map(([key, value]) => ({
      key,
      active: value,
      against: metricRows(comparison.results.against).find(([otherKey]) => otherKey === key)?.[1],
    }))
    : [];
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3" aria-label={t('playground.experiment.ariaLabel')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{t('playground.experiment.title')}</p>
        <p className="mt-1 text-sm font-black text-slate-900">{t('playground.experiment.instruction')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button data-affordance-id="experiment.duplicate" type="button" onClick={() => onDispatch({ type: 'DUPLICATE_EXPERIMENT' })} className={`rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white${highlight('experiment.duplicate')}`}>{t('playground.experiment.duplicate')}</button>
        <button type="button" onClick={() => onDispatch({ type: 'RESET' })} className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-black text-slate-700">{t('playground.experiment.reset')}</button>
        {snapshot.capabilities?.canUndoExperiment && <button type="button" onClick={() => onDispatch({ type: 'UNDO_EXPERIMENT_ACTION' })} className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-black text-slate-700">{t('playground.experiment.undo')}</button>}
        {snapshot.model && <div data-affordance-id="experiment.repeat" className={`flex items-center gap-1 rounded-xl bg-amber-100 px-2 py-1 text-xs font-black text-amber-800${highlight('experiment.repeat')}`}><label htmlFor="repeat-trials">{t('playground.experiment.repeat')}</label><select id="repeat-trials" value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="rounded-lg border border-amber-200 bg-white px-1 py-1"><option value="2">2</option><option value="3">3</option><option value="5">5</option><option value="10">10</option><option value="20">20</option></select><button type="button" onClick={() => onDispatch({ type: 'REPEAT_EXPERIMENT', trials: repeatCount })} className="rounded-lg bg-amber-500 px-2 py-1 text-white">{t('playground.experiment.runRepeat')}</button></div>}
        {target && <button data-affordance-id="experiment.compare" type="button" aria-pressed={Boolean(comparison.enabled)} onClick={() => onDispatch({ type: 'SET_COMPARE', enabled: !comparison.enabled, againstExperimentId: target.id })} className={`rounded-xl px-3 py-2 text-xs font-black ${comparison.enabled ? 'bg-violet-700 text-white' : 'bg-violet-100 text-violet-800'}${highlight('experiment.compare')}`}>{comparison.enabled ? t('playground.experiment.compareOn') : t('playground.experiment.compare')}</button>}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('playground.experiment.switchLabel')}>
      {workspace.experiments.map((experiment) => <button key={experiment.id} type="button" aria-pressed={experiment.id === activeId} onClick={() => onDispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experiment.id })} className={`rounded-xl px-3 py-2 text-xs font-black ${experiment.id === activeId ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{experiment.name}</button>)}
      <span className="text-xs font-bold text-slate-500">{active?.name ?? ''}{target ? ` ${t('playground.experiment.comparingWith')} ${target.name}` : ''}</span>
    </div>
    {comparison.enabled && diff && <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <p className="text-xs font-black uppercase tracking-wider text-rose-600">{t('playground.experiment.changed')}</p>
        <p className="mt-2 text-sm font-bold text-slate-700">{changed.length ? changed.map((factor) => t(factorKeys[factor])).join(', ') : t('playground.experiment.none')}</p>
        {generatorChanged.length > 0 && <p className="mt-2 text-xs font-bold text-rose-700">{t('playground.experiment.worldDetails')}: {generatorChanged.map((key) => t(`playground.experiment.generator.${key}`)).join(', ')}</p>}
      </div>
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <p className="text-xs font-black uppercase tracking-wider text-emerald-600">{t('playground.experiment.heldConstant')}</p>
        <p className="mt-2 text-sm font-bold text-slate-700">{unchanged.length ? unchanged.map((factor) => t(factorKeys[factor])).join(', ') : t('playground.experiment.none')}</p>
        {generatorUnchanged.length > 0 && <p className="mt-2 text-xs font-bold text-emerald-700">{t('playground.experiment.worldDetails')}: {generatorUnchanged.map((key) => t(`playground.experiment.generator.${key}`)).join(', ')}</p>}
      </div>
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <p className="text-xs font-black uppercase tracking-wider text-violet-700">{t('playground.experiment.clarity')}</p>
        <p className="mt-2 text-sm font-black text-slate-800">{t(`playground.experiment.clarity.${diff.clarity}`)}</p>
        <p className="mt-1 text-xs text-slate-500">{t('playground.experiment.seedRelationship', { relationship: workspace.repeat?.policy === 'fixed-seed' ? t('playground.experiment.seed.matched') : t('playground.experiment.seed.unspecified') })}</p>
      </div>
      {resultRows.length > 0 && <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 lg:col-span-3">
        <p className="text-xs font-black uppercase tracking-wider text-blue-600">{t('playground.experiment.results')}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {resultRows.map(({ key, active: activeValue, against: againstValue }) => <div key={key} className="rounded-lg bg-slate-50 p-2 text-xs"><span className="block font-bold text-slate-500">{t(`playground.experiment.metric.${key}`)}</span><span className="font-mono font-black text-slate-800">{Number(activeValue).toFixed(3)} / {againstValue === undefined ? '—' : Number(againstValue).toFixed(3)}</span></div>)}
        </div>
      </div>}
    </div>}
  </section>;
}
