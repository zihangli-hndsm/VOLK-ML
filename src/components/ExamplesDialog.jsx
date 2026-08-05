import { useMemo } from 'react';
import { componentById } from '../core/components';
import { exampleMetadata } from '../core/exampleProjects';

const exampleFiles = import.meta.glob('../../examples/*.volkml.json', { eager: true });

export default function ExamplesDialog({ open, onClose, onLoad, t }) {
  const examples = useMemo(() => exampleMetadata
    .map((meta) => ({ ...meta, project: exampleFiles[`../../examples/${meta.file}`]?.default ?? null }))
    .filter((item) => item.project), []);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onMouseDown={onClose}>
    <section className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">{t('examples.title')}</h2><p className="mt-1 text-sm text-slate-500">{t('examples.description')}</p></div><button aria-label={t('common.close')} className="rounded-full p-2 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {examples.map((example) => <article key={example.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black">{t(example.titleKey)}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{t(example.taskKey)}</span>{example.runnable && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{t('examples.runnable')}</span>}{example.exportable && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{t('examples.export')}</span>}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t(example.descriptionKey)}</p>
          <p className="mt-3 text-xs leading-5 text-slate-400">{t('examples.components')}: {example.componentIds.map((id) => t(componentById.get(id)?.name ?? id)).join(' · ')}</p>
          <button onClick={() => onLoad(example.project)} className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2 font-bold text-white">{t('examples.load')}</button>
        </article>)}
      </div>
    </section>
  </div>;
}
