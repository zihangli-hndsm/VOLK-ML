import React from 'react';
import { listPlaygrounds } from '../core/playgrounds/registry.js';

export default function BuildToolbar({
  projectName,
  setProjectName,
  autosavedAt,
  leftOpen,
  setLeftOpen,
  rightOpen,
  setRightOpen,
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
  setPlaygroundInitialTab,
  setPlaygroundId,
  setPlaygroundOpen,
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
      <button type="button" data-build-primary="blocks" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setLeftOpen((value) => !value)}>☰ <span className="hidden sm:inline">{t('nav.blocks')}</span></button>
      <button type="button" data-build-primary="parameters" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setRightOpen((value) => !value)}>⚙ <span className="hidden sm:inline">{t('nav.parameters')}</span></button>
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
        setPlaygroundInitialTab={setPlaygroundInitialTab}
        setPlaygroundId={setPlaygroundId}
        setPlaygroundOpen={setPlaygroundOpen}
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
  setPlaygroundInitialTab,
  setPlaygroundId,
  setPlaygroundOpen,
  t,
}) {
  const [open, setOpen] = React.useState(false);
  return <div className="relative">
    <button type="button" aria-expanded={open} aria-controls="build-more-actions" className="rounded-xl bg-slate-100 px-3 py-2 font-bold" onClick={() => setOpen((value) => !value)}>⋯ <span className="hidden sm:inline">{t('surface.more')}</span></button>
    {open && <div id="build-more-actions" data-build-more-actions className="absolute right-0 top-full z-50 mt-2 grid min-w-64 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
      <button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => setViewMode((value) => value === 'canvas' ? 'architecture' : 'canvas')}>{viewMode === 'canvas' ? '⌘' : '⌁'} {t(`nav.${viewMode === 'canvas' ? 'architecture' : 'canvas'}`)}</button>
      <button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { setExplanationOpen(true); setOpen(false); }}>✦ {t('nav.explain')}</button>
      <button type="button" disabled={selectedNodes.length < 2} className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100 disabled:opacity-40" onClick={() => { setCompositeOpen(true); setOpen(false); }}>▣ {t('nav.group')}</button>
      <button type="button" aria-pressed={multiSelectMode} className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => setMultiSelectMode((value) => !value)}>☑ {t('nav.multiSelect')}</button>
      <button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { setExamplesOpen(true); setOpen(false); }}>◇ {t('nav.examples')}</button>
      <button type="button" className={`rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100 ${dataset ? 'text-blue-700' : ''}`} onClick={() => { setDataOpen(true); setOpen(false); }}>▦ {t('nav.data')}</button>
      <button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { setPlaygroundInitialTab('data'); setPlaygroundId('data-lab'); setPlaygroundOpen(true); setOpen(false); }}>▤ {t('nav.exploreData')}</button>
      <button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => { exportProject(); setOpen(false); }}>↓ JSON</button>
      <button type="button" className="rounded-xl px-3 py-2 text-left font-bold hover:bg-slate-100" onClick={() => importRef.current?.click()}>↑ {t('nav.import')}</button>
      <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { importProject(event); setOpen(false); }} />
      <label className="mt-1 border-t border-slate-100 px-3 pt-2">
        <span className="sr-only">{t('nav.playground')}</span>
        <select defaultValue="" aria-label={t('nav.playground')} onChange={(event) => { const id = event.target.value; if (id) { setPlaygroundInitialTab('model'); setPlaygroundId(id); setPlaygroundOpen(true); } event.target.value = ''; }} className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm font-bold">
          <option value="">{t('nav.playground')}</option>
          {listPlaygrounds().map((playground) => <option key={playground.id} value={playground.id}>{t(playground.titleKey)}</option>)}
        </select>
      </label>
    </div>}
  </div>;
}
