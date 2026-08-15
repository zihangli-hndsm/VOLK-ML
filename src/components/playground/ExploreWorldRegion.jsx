import { useMemo, useState } from 'react';
import { derivePhenomenonCapabilities } from '../../core/ui/phenomenon.js';
import PlaygroundStage from './PlaygroundStage.jsx';
import PlaygroundInspector from './PlaygroundInspector.jsx';
import DataWorkspace from './DataWorkspace.jsx';
import WorldBuilder from './WorldBuilder.jsx';
import { usePresentationCapabilities } from './usePresentationCapabilities.jsx';

export default function ExploreWorldRegion({ snapshot, modelPlayground, bigIdea, activeTab, onTabChange, onDispatch, t, highlightedAffordances = [] }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fullWorldToolsOpen, setFullWorldToolsOpen] = useState(false);
  const { responsive } = usePresentationCapabilities();
  const compact = responsive.band === 'compact';
  const phenomenon = useMemo(() => derivePhenomenonCapabilities(snapshot), [snapshot]);
  const phenomenonQuestion = bigIdea ? t(bigIdea.questionKey) : t('playground.phenomenon.question');
  const detailsPanelClass = compact
    ? 'fixed inset-x-0 bottom-0 z-[90] max-h-[78dvh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-3 shadow-2xl'
    : 'absolute right-0 top-0 z-20 max-h-full w-[min(300px,calc(100%-1rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl';

  if (phenomenon.available && !fullWorldToolsOpen) {
    return <section data-ui-region="world-region" data-phenomenon-available="true" aria-label={t('playground.phenomenon.regionLabel')} className="relative min-w-0 space-y-3">
      <DataWorkspace snapshot={snapshot} onDispatch={onDispatch} t={t} question={phenomenonQuestion} variant="phenomenon" onOpenFullWorkspace={() => openFullWorldTools()} highlightedAffordances={highlightedAffordances} />
      <div className="flex justify-end">
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{detailsOpen ? t('playground.explore.hideDetails') : t('playground.explore.details')}</button>
      </div>
      {detailsOpen && <ModelDetailsPanel id="phenomenon-model-details" detailsPanelClass={detailsPanelClass} snapshot={snapshot} modelPlayground={modelPlayground} onDispatch={onDispatch} onClose={() => setDetailsOpen(false)} t={t} />}
    </section>;
  }

  return <section data-ui-region="world-region" data-phenomenon-available={phenomenon.available ? 'true' : 'false'} aria-label={t('playground.explore.worldRegionLabel')} className="relative min-w-0 space-y-3">
    {phenomenon.available && <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-3 py-2">
      <span className="text-xs font-bold text-blue-800">{t('playground.phenomenon.fullToolsHint')}</span>
      <button type="button" onClick={() => setFullWorldToolsOpen(false)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">{t('playground.phenomenon.backToPhenomenon')}</button>
    </div>}
    <div role="tablist" aria-label={t('playground.lab.tabs')} className="flex gap-2 border-b border-slate-200 pb-2">
      {['data', 'model'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => onTabChange(tab)} className={`rounded-xl px-4 py-2 text-sm font-black focus:outline-none focus:ring-2 focus:ring-blue-500 ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t(`playground.lab.${tab}`)}</button>)}
    </div>
    {activeTab === 'data' ? <div role="tabpanel" className="space-y-4"><WorldBuilder snapshot={snapshot} onDispatch={onDispatch} t={t} highlightedAffordances={highlightedAffordances} /><DataWorkspace snapshot={snapshot} onDispatch={onDispatch} t={t} highlightedAffordances={highlightedAffordances} /></div> : <div role="tabpanel" className="space-y-3">
      {!snapshot.model ? <ModelEmptyState snapshot={snapshot} onDispatch={onDispatch} t={t} /> : <>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><PlaygroundStage snapshot={snapshot} t={t} /></div>
        <div className="flex items-center justify-end">
          <button type="button" aria-expanded={detailsOpen} aria-controls="explore-model-details" onClick={() => setDetailsOpen((open) => !open)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{detailsOpen ? t('playground.explore.hideDetails') : t('playground.explore.details')}</button>
        </div>
        {detailsOpen && <ModelDetailsPanel id="explore-model-details" detailsPanelClass={detailsPanelClass} snapshot={snapshot} modelPlayground={modelPlayground} onDispatch={onDispatch} onClose={() => setDetailsOpen(false)} t={t} />}
      </>}
    </div>}
  </section>;

  function openFullWorldTools() {
    setFullWorldToolsOpen(true);
    onTabChange('data');
  }
}

function ModelDetailsPanel({ id, detailsPanelClass, snapshot, modelPlayground, onDispatch, onClose, t }) {
  return <div id={id} role="dialog" aria-label={t('playground.controlsTitle')} className={detailsPanelClass}>
    <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-2">
      <h3 className="text-sm font-black text-slate-900">{t('playground.controlsTitle')}</h3>
      <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.explore.hideDetails')}</button>
    </div>
    <PlaygroundInspector playground={modelPlayground} snapshot={snapshot} onDispatch={onDispatch} t={t} />
  </div>;
}

function ModelEmptyState({ snapshot, onDispatch, t }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
    <h3 className="text-lg font-black text-slate-900">{t('playground.model.emptyTitle')}</h3>
    <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">{t('playground.model.emptyBody')}</p>
    {snapshot.availableModels?.length ? <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">{snapshot.availableModels.map((model) => <button key={model.id} type="button" onClick={() => onDispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: model.id })} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="block font-black text-slate-900">{t(model.titleKey)}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{t(model.descriptionKey)}</span></button>)}</div> : <p className="mt-5 text-sm font-bold text-amber-700">{t('playground.model.noCompatible')}</p>}
  </section>;
}
