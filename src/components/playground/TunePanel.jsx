import { useState } from 'react';
import PlaygroundControlField from './PlaygroundControlField.jsx';
import { deriveTuneControlGroups, deriveTuneControlState } from '../../core/ui/contextualTune.js';

const GROUPS = [
  ['model', 'playground.layer.moreModel'],
  ['learning', 'playground.layer.moreLearning'],
  ['evaluation', 'playground.layer.moreEvaluation'],
];

export default function TunePanel({ playground, snapshot, onDispatch, onOpenWorldTools, t }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { primary, more, comparisonDiff } = deriveTuneControlGroups(playground, snapshot);
  const renderControl = (control, showHint) => {
    const state = deriveTuneControlState(control, comparisonDiff ?? {});
    return <PlaygroundControlField key={control.key} control={control} snapshot={snapshot} onDispatch={onDispatch} t={t} showHint={showHint} changed={state.changed} held={state.held} />;
  };
  const groupedMore = GROUPS.map(([domain, labelKey]) => [domain, labelKey, more.filter((control) => control.domain === domain || (domain === 'evaluation' && control.domain === 'view'))]).filter(([, , controls]) => controls.length);
  const ungrouped = more.filter((control) => !['model', 'learning', 'evaluation', 'view'].includes(control.domain));
  return <div data-ui-layer="tune" className="space-y-3" aria-label={t('playground.layer.tuneLabel')}>
    <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
      <h4 className="text-xs font-black uppercase tracking-wider text-blue-800">{t('playground.layer.world')}</h4>
      <p className="mt-1 text-xs leading-5 text-slate-600">{t('playground.layer.worldHint')}</p>
      {onOpenWorldTools && <button type="button" onClick={onOpenWorldTools} className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.phenomenon.moreWorldTools')}</button>}
    </section>
    {primary.length > 0 && <section data-ui-control-group="primary" className="rounded-2xl border border-slate-200 bg-white p-3">
      <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">{t('playground.layer.primaryControls')}</h4>
      <div className="mt-3 space-y-3">{primary.map((control) => renderControl(control, true))}</div>
    </section>}
    {more.length > 0 && <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <button type="button" aria-expanded={moreOpen} aria-controls="tune-more-controls" onClick={() => setMoreOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 rounded-xl text-left text-xs font-black uppercase tracking-wider text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
        <span>{t('playground.layer.moreControls')}</span><span aria-hidden="true">{moreOpen ? '−' : '+'}</span>
      </button>
      {moreOpen && <div id="tune-more-controls" className="ui-motion-reveal mt-3 space-y-3">
        {groupedMore.map(([domain, labelKey, controls]) => <section key={domain} data-ui-control-group={domain} className="rounded-2xl border border-slate-200 bg-white p-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">{t(labelKey)}</h4>
          <div className="mt-3 space-y-3">{controls.map((control) => renderControl(control, false))}</div>
        </section>)}
        {ungrouped.length > 0 && <section data-ui-control-group="other" className="rounded-2xl border border-slate-200 bg-white p-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">{t('playground.layer.moreControls')}</h4>
          <div className="mt-3 space-y-3">{ungrouped.map((control) => renderControl(control, false))}</div>
        </section>}
      </div>}
    </section>}
  </div>;
}
