import React from 'react';
import { createPortal } from 'react-dom';
import { listPlaygrounds } from '../core/playgrounds/registry.js';
import CompactBottomSheet from './CompactBottomSheet.jsx';

export default function BuildToolbar({
  projectName,
  setProjectName,
  autosavedAt,
  onToggleLeft,
  onToggleRight,
  viewMode,
  setViewMode,
  setExplanationOpen,
  selectedNodes,
  setCompositeOpen,
  multiSelectMode,
  setMultiSelectMode,
  setExamplesOpen,
  dataset,
  setDataOpen,
  exportProject,
  importRef,
  importProject,
  onOpenExplorePlayground,
  onExploreCurrentSetup,
  setRunnerOpen,
  t,
}) {
  return <section data-build-toolbar aria-label={t('surface.buildToolbar')} className="z-30 border-b border-white/70 bg-white/80 px-3 py-3 shadow-sm backdrop-blur sm:px-5">
    <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2">
      <label className="mr-auto min-w-0 basis-full sm:basis-auto">
        <span className="sr-only">{t('project.name')}</span>
        <input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 sm:w-56" />
        <span className="mt-0.5 block text-[10px] text-slate-400">{autosavedAt ? t('project.autosaved') : t('project.unsaved')}</span>
      </label>
      <button type="button" data-build-primary="blocks" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={onToggleLeft}>☰ <span className="hidden sm:inline">{t('nav.blocks')}</span></button>
      <button type="button" data-build-primary="parameters" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={onToggleRight}>⚙ <span className="hidden sm:inline">{t('nav.parameters')}</span></button>
      <button type="button" data-build-primary="run" className="rounded-xl bg-emerald-600 px-3 py-2 font-bold text-white" onClick={() => setRunnerOpen(true)}>▶ <span className="hidden sm:inline">{t('nav.run')}</span></button>
      <BuildMoreDisclosure
        viewMode={viewMode}
        setViewMode={setViewMode}
        setExplanationOpen={setExplanationOpen}
        selectedNodes={selectedNodes}
        setCompositeOpen={setCompositeOpen}
        multiSelectMode={multiSelectMode}
        setMultiSelectMode={setMultiSelectMode}
        setExamplesOpen={setExamplesOpen}
        dataset={dataset}
        setDataOpen={setDataOpen}
        exportProject={exportProject}
        importRef={importRef}
        importProject={importProject}
        onOpenExplorePlayground={onOpenExplorePlayground}
        onExploreCurrentSetup={onExploreCurrentSetup}
        t={t}
      />
    </div>
  </section>;
}

function BuildMoreDisclosure({
  viewMode,
  setViewMode,
  setExplanationOpen,
  selectedNodes,
  setCompositeOpen,
  multiSelectMode,
  setMultiSelectMode,
  setExamplesOpen,
  dataset,
  setDataOpen,
  exportProject,
  importRef,
  importProject,
  onOpenExplorePlayground,
  onExploreCurrentSetup,
  t,
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef(null);
  const compactQuery = '(max-width: 639px), (max-height: 480px)';
  const [compact, setCompact] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(compactQuery).matches);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia(compactQuery);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  React.useEffect(() => {
    if (!open || !compact || typeof document === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, compact]);

  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = () => setOpen(false);
  const actionClass = 'rounded-xl px-3 py-2 text-left font-bold whitespace-normal break-words hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const actions = <>
    <button type="button" className={actionClass} onClick={() => { setViewMode((value) => value === 'canvas' ? 'architecture' : 'canvas'); close(); }}>{viewMode === 'canvas' ? '⌘' : '⌁'} {t(`nav.${viewMode === 'canvas' ? 'architecture' : 'canvas'}`)}</button>
    <button type="button" className={actionClass} onClick={() => { setExplanationOpen(true); close(); }}>✦ {t('nav.explain')}</button>
    <button type="button" disabled={selectedNodes.length < 2} className={`${actionClass} disabled:opacity-40`} onClick={() => { setCompositeOpen(true); close(); }}>▣ {t('nav.group')}</button>
    <button type="button" aria-pressed={multiSelectMode} className={actionClass} onClick={() => { setMultiSelectMode((value) => !value); close(); }}>☑ {t('nav.multiSelect')}</button>
    <button type="button" className={actionClass} onClick={() => { setExamplesOpen(true); close(); }}>◇ {t('nav.examples')}</button>
    <button type="button" className={`${actionClass} ${dataset ? 'text-blue-700' : ''}`} onClick={() => { setDataOpen(true); close(); }}>▦ {t('nav.data')}</button>
    <button type="button" className={actionClass} onClick={() => { onOpenExplorePlayground?.('data-lab', { initialTab: 'data' }); close(); }}>▤ {t('nav.exploreData')}</button>
    <button type="button" className={actionClass} onClick={() => { onExploreCurrentSetup?.('data-lab'); close(); }}>✦ {t('nav.exploreCurrentSetup')}</button>
    <button type="button" className={actionClass} onClick={() => { exportProject(); close(); }}>↓ JSON</button>
    <button type="button" className={actionClass} onClick={() => { close(); importRef.current?.click(); }}>↑ {t('nav.import')}</button>
    <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { importProject(event); close(); }} />
    <label className="mt-1 border-t border-slate-100 px-3 pt-2">
      <span className="sr-only">{t('nav.playground')}</span>
      <select defaultValue="" aria-label={t('nav.playground')} onChange={(event) => { const id = event.target.value; if (id) onOpenExplorePlayground?.(id, { initialTab: 'model' }); event.target.value = ''; close(); }} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm font-bold">
        <option value="">{t('nav.playground')}</option>
        {listPlaygrounds().map((playground) => <option key={playground.id} value={playground.id}>{t(playground.titleKey)}</option>)}
      </select>
    </label>
  </>;

  const trigger = <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="build-more-actions" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setOpen((value) => !value)}>⋯ <span className="hidden sm:inline">{t('surface.more')}</span></button>;
  const compactOverlay = compact && open && typeof document !== 'undefined' ? createPortal(<>
    <button type="button" aria-label={t('common.close')} className="fixed inset-0 z-[55] bg-slate-950/35" onClick={close} />
    <CompactBottomSheet compact open onClose={close} id="build-more-actions" data-build-more-actions data-build-more-compact role="dialog" aria-modal="true" aria-labelledby="build-more-title" className="fixed inset-x-2 bottom-2 z-[60] max-h-[calc(100dvh-1rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
        <h2 id="build-more-title" className="text-base font-black text-slate-900">{t('surface.more')}</h2>
        <button type="button" aria-label={t('common.close')} className="rounded-xl px-3 py-2 font-bold hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" onClick={close}>✕</button>
      </div>
      <div className="grid gap-1">{actions}</div>
    </CompactBottomSheet>
  </>, document.body) : null;

  return <div className="relative">
    {trigger}
    {!compact && open && <div id="build-more-actions" data-build-more-actions className="absolute right-0 top-full z-50 mt-2 grid max-h-[calc(100dvh-6rem)] w-[min(20rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] gap-1 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">{actions}</div>}
    {compactOverlay}
  </div>;
}
