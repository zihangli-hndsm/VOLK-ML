import { useEffect, useRef, useState } from 'react';
import { deriveNewExperimentIds } from '../../core/ui/presentationMotion.js';
import { usePresentationCapabilities } from './usePresentationCapabilities.jsx';
import Lumi from './Lumi.jsx';

const factorKeys = {
  world: 'playground.experiment.factor.world',
  observationProcess: 'playground.experiment.factor.observationProcess',
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

function aliasFor(index) {
  return String.fromCharCode(65 + index);
}

function learnerName(index, count, t) {
  if (count === 1) return t('playground.experiment.myExperiment');
  if (index === 0) return t('playground.experiment.original');
  if (count === 2 && index === 1) return t('playground.experiment.myExperiment');
  return t('playground.experiment.experimentNumber', { number: index + 1 });
}

function clarityLabel(diff, t) {
  if (diff?.clarity === 'high') return t('playground.experiment.claritySignal.high');
  if (diff?.clarity === 'mixed') return t('playground.experiment.claritySignal.mixed');
  return t('playground.experiment.claritySignal.identical');
}

export default function ExperimentBar({ snapshot, onDispatch, t, highlightedAffordances = [], interventionPulseKey = null, interventionTarget = null }) {
  const { responsive } = usePresentationCapabilities();
  const compact = responsive.band === 'compact';
  const [repeatCount, setRepeatCount] = useState(snapshot.repeatEvidence?.trialCount ?? 5);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [interventionActive, setInterventionActive] = useState(false);
  useEffect(() => {
    if (interventionPulseKey === null || interventionPulseKey === undefined) return undefined;
    setInterventionActive(true);
    const timer = window.setTimeout(() => setInterventionActive(false), 1100);
    return () => window.clearTimeout(timer);
  }, [interventionPulseKey]);
  const workspace = snapshot.experimentWorkspace;
  const experimentIds = workspace?.experiments?.map((experiment) => experiment.id) ?? [];
  const experimentIdsKey = experimentIds.join('\u0000');
  const previousExperimentIdsRef = useRef(experimentIds);
  const [enteringExperimentId, setEnteringExperimentId] = useState(null);
  useEffect(() => {
    const previousIds = previousExperimentIdsRef.current;
    const newIds = deriveNewExperimentIds(previousIds, experimentIds);
    previousExperimentIdsRef.current = experimentIds;
    if (!newIds.length) return undefined;
    const nextEnteringId = newIds[0];
    // CSS owns the bounded emphasis duration; identity remains stable until
    // the next semantic experiment-set change, so active switching cannot
    // transfer or cancel the newly-created branch's presentation.
    setEnteringExperimentId(nextEnteringId);
  }, [experimentIdsKey]);
  const highlight = (id) => highlightedAffordances.includes(id) ? ' ring-2 ring-amber-400 ring-offset-1' : '';
  if (!workspace) return null;
  const comparison = workspace.comparison ?? {};
  const diff = comparison.diff;
  const activeId = workspace.activeExperimentId;
  const targetId = comparison.againstExperimentId;
  const activeIndex = workspace.experiments.findIndex((item) => item.id === activeId);
  const active = workspace.experiments.find((item) => item.id === activeId);
  const target = workspace.experiments.find((item) => item.id === targetId);
  const hasBranches = workspace.experiments.length > 1;
  const showCompactInitial = workspace.experiments.length === 1 && !comparison.enabled;
  const changed = diff?.changed ?? [];
  const unchanged = diff?.unchanged ?? [];
  const generatorChanged = diff?.details?.worldGenerator?.changed ?? [];
  const generatorUnchanged = diff?.details?.worldGenerator?.unchanged ?? [];
  const resultRows = comparison.results?.active && comparison.results?.against
    ? metricRows(comparison.results.active).map(([key, value]) => ({
      key,
      active: value,
      against: metricRows(comparison.results.against).find(([otherKey]) => otherKey === key)?.[1],
    }))
    : [];

  const dispatchSecondary = (action) => {
    setMoreOpen(false);
    onDispatch(action);
  };

  if (showCompactInitial) {
    return <section data-experiment-compact-initial="true" className="ui-motion-surface min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-2" aria-label={t('playground.experiment.ariaLabel')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-black text-slate-900">
          <span aria-hidden="true" className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-white">A</span>
          <span className="truncate">{t('playground.experiment.myExperiment')}</span>
          {interventionActive && <Lumi presence="event" mode="intervene" label={t('playground.lumi.interventionPulse')} />}
        </div>
        <div className="flex items-center gap-1">
          <button data-affordance-id="experiment.duplicate" type="button" onClick={() => onDispatch({ type: 'DUPLICATE_EXPERIMENT' })} className={`ui-motion-interactive rounded-xl bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600${highlight('experiment.duplicate')}`}>+ {t('playground.experiment.tryAnother')}</button>
          <button type="button" aria-expanded={moreOpen} aria-controls="experiment-more-actions" onClick={() => setMoreOpen((value) => !value)} className="ui-motion-interactive rounded-xl px-2 py-2 text-lg font-black leading-none text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" aria-label={t('playground.experiment.moreActions')}>•••</button>
        </div>
      </div>
      {moreOpen && <div id="experiment-more-actions" className="ui-motion-reveal mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
          {snapshot.capabilities?.canUndoExperiment && <button type="button" onClick={() => dispatchSecondary({ type: 'UNDO_EXPERIMENT_ACTION' })} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">{t('playground.experiment.undo')}</button>}
          <button type="button" onClick={() => dispatchSecondary({ type: 'RESET' })} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">{t('playground.experiment.reset')}</button>
      </div>}
    </section>;
  }

  return <section data-lumi-target={interventionTarget ? `experiment:${interventionTarget.id}` : undefined} className={`ui-motion-surface min-w-0 rounded-2xl border border-slate-200 bg-white p-3${interventionTarget ? ' lumi-control-focus' : ''}`} aria-label={t('playground.experiment.ariaLabel')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {interventionActive && <Lumi presence="event" mode="intervene" label={t('playground.lumi.interventionPulse')} />}
        <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{t('playground.experiment.title')}</p>
        <p className="mt-1 text-sm font-black text-slate-900">{t('playground.experiment.instruction')}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button data-affordance-id="experiment.duplicate" type="button" onClick={() => onDispatch({ type: 'DUPLICATE_EXPERIMENT' })} className={`ui-motion-interactive rounded-xl bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600${highlight('experiment.duplicate')}`}>+ {t('playground.experiment.tryAnother')}</button>
        {target && <button data-affordance-id="experiment.compare" type="button" aria-pressed={Boolean(comparison.enabled)} onClick={() => onDispatch({ type: 'SET_COMPARE', enabled: !comparison.enabled, againstExperimentId: target.id })} className={`ui-motion-interactive rounded-xl px-3 py-2 text-xs font-black ${comparison.enabled ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-800'}${highlight('experiment.compare')}`}>{comparison.enabled ? t('playground.experiment.compareOn') : t('playground.experiment.compare')}</button>}
        <button type="button" aria-expanded={moreOpen} aria-controls="experiment-more-actions" onClick={() => setMoreOpen((value) => !value)} className="ui-motion-interactive rounded-xl px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.experiment.moreActions')}</button>
      </div>
    </div>

    <div className={`mt-3 flex items-center gap-2 ${compact ? 'max-w-full overflow-x-auto pb-1' : 'flex-wrap'}`} role="group" aria-label={t('playground.experiment.switchLabel')}>
      {workspace.experiments.map((experiment, index) => <button
        key={experiment.id}
        type="button"
        aria-pressed={experiment.id === activeId}
        aria-label={`${aliasFor(index)} ${learnerName(index, workspace.experiments.length, t)}`}
        onClick={() => onDispatch({ type: 'SWITCH_EXPERIMENT', experimentId: experiment.id })}
        className={`ui-motion-interactive flex min-w-max items-center gap-2 rounded-xl px-3 py-2 text-xs font-black ${experiment.id === activeId ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}${experiment.id === enteringExperimentId ? ' ui-motion-branch-enter' : ''}`}
      >
        <span aria-hidden="true" className={`rounded-md px-1.5 py-0.5 text-[10px] ${experiment.id === activeId ? 'bg-white/20' : 'bg-slate-100'}`}>{aliasFor(index)}</span>
        <span>{learnerName(index, workspace.experiments.length, t)}</span>
      </button>)}
      {hasBranches && <span className="min-w-0 truncate text-xs font-bold text-slate-500">{aliasFor(activeIndex)} {target ? `${t('playground.experiment.comparingWith')} ${aliasFor(workspace.experiments.findIndex((item) => item.id === target.id))}` : ''}</span>}
    </div>

    {workspace.experiments.length >= 3 && <div className="ui-motion-reveal mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('playground.experiment.compareTargetLabel')}>
      <span className="text-xs font-black text-slate-600">{t('playground.experiment.compareWith')}</span>
      {workspace.experiments.filter((experiment) => experiment.id !== activeId).map((experiment) => {
        const index = workspace.experiments.findIndex((item) => item.id === experiment.id);
        const selected = experiment.id === targetId;
        return <button
          key={`target-${experiment.id}`}
          type="button"
          aria-pressed={selected}
          aria-label={`${t('playground.experiment.compareWith')} ${aliasFor(index)} ${learnerName(index, workspace.experiments.length, t)}`}
          onClick={() => onDispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: experiment.id })}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${selected ? 'bg-orange-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
        >{aliasFor(index)}</button>;
      })}
    </div>}

    {moreOpen && <div id="experiment-more-actions" className="ui-motion-reveal mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <button type="button" onClick={() => dispatchSecondary({ type: 'RESET' })} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.experiment.reset')}</button>
      {snapshot.capabilities?.canUndoExperiment && <button type="button" onClick={() => dispatchSecondary({ type: 'UNDO_EXPERIMENT_ACTION' })} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.experiment.undo')}</button>}
      {snapshot.model && comparison.enabled && <div data-affordance-id="experiment.repeat" className={`flex items-center gap-1 rounded-xl bg-orange-50 px-2 py-1 text-xs font-black text-orange-800${highlight('experiment.repeat')}`}>
        <label htmlFor="repeat-trials">{t('playground.experiment.repeat')}</label>
        <select id="repeat-trials" value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="rounded-lg border border-amber-200 bg-white px-1 py-1">
          <option value="2">2</option><option value="3">3</option><option value="5">5</option><option value="10">10</option><option value="20">20</option>
        </select>
        <button type="button" onClick={() => dispatchSecondary({ type: 'REPEAT_EXPERIMENT', trials: repeatCount })} className="rounded-lg bg-orange-500 px-2 py-1 text-white">{t('playground.experiment.runRepeat')}</button>
      </div>}
    </div>}

    {comparison.enabled && diff && <div data-ui-motion="comparison" className="ui-motion-reveal mt-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="ui-motion-reveal ui-motion-stagger-1 rounded-xl border border-orange-100 bg-orange-50/60 p-3">
          <p className="text-xs font-black uppercase tracking-wider text-orange-700">{t('playground.experiment.changed')}</p>
          <p className="mt-2 text-sm font-bold text-slate-700">{changed.length ? changed.map((factor) => t(factorKeys[factor])).join(', ') : t('playground.experiment.none')}</p>
          {generatorChanged.length > 0 && <p className="mt-2 text-xs font-bold text-orange-700">{t('playground.experiment.worldDetails')}: {generatorChanged.map((key) => t(`playground.experiment.generator.${key}`)).join(', ')}</p>}
        </div>
        <div className="ui-motion-reveal ui-motion-stagger-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <p className="text-xs font-black uppercase tracking-wider text-emerald-700">{t('playground.experiment.heldConstant')}</p>
          <p className="mt-2 text-sm font-bold text-slate-700">{unchanged.length ? unchanged.map((factor) => t(factorKeys[factor])).join(', ') : t('playground.experiment.none')}</p>
          {generatorUnchanged.length > 0 && <p className="mt-2 text-xs font-bold text-emerald-700">{t('playground.experiment.worldDetails')}: {generatorUnchanged.map((key) => t(`playground.experiment.generator.${key}`)).join(', ')}</p>}
        </div>
      </div>
      <div className="ui-motion-reveal ui-motion-stagger-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
        <span className="text-sm font-black text-slate-800"><span aria-hidden="true" className="mr-2 text-violet-600">●</span>{clarityLabel(diff, t)}{diff.clarity === 'mixed' && <span className="ml-2 text-xs font-bold text-slate-500">{t('playground.experiment.clarityFactorCount', { count: changed.length })}</span>}</span>
        <button type="button" aria-expanded={resultsOpen} aria-controls="experiment-results" onClick={() => setResultsOpen((value) => !value)} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{resultsOpen ? t('playground.experiment.hideResults') : t('playground.experiment.viewResults')}</button>
      </div>
      {resultsOpen && <div id="experiment-results" className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-black uppercase tracking-wider text-blue-600">{t('playground.experiment.results')}</p>
        {resultRows.length > 0 ? <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {resultRows.map(({ key, active: activeValue, against: againstValue }) => <div key={key} className="rounded-lg bg-slate-50 p-2 text-xs"><span className="block font-bold text-slate-500">{t(`playground.experiment.metric.${key}`)}</span><span className="font-mono font-black text-slate-800">{Number(activeValue).toFixed(3)} / {againstValue === undefined ? '—' : Number(againstValue).toFixed(3)}</span></div>)}
        </div> : <p className="mt-2 text-sm text-slate-500">{t('playground.experiment.none')}</p>}
      </div>}
    </div>}
  </section>;
}
