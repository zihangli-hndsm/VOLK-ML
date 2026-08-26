import { LEARNING_PATH_STATES } from '../../core/exploration/learningPath.js';

const stateClass = {
  [LEARNING_PATH_STATES.AVAILABLE]: 'border-violet-200 bg-violet-50 text-violet-950',
  [LEARNING_PATH_STATES.EXPLORED]: 'border-cyan-200 bg-cyan-50 text-cyan-950',
  [LEARNING_PATH_STATES.ILLUMINATED]: 'border-emerald-200 bg-emerald-50 text-emerald-950',
};

export default function LearningPathPanel({ path, compact = false, t, onIlluminate }) {
  const nodes = path?.nodes ?? [];
  if (nodes.length === 0) return null;
  return <section data-learning-path="true" className={`rounded-2xl border border-purple-200 bg-white p-3 ${compact ? 'text-[11px]' : ''}`} aria-label={t('playground.learningPath.ariaLabel')}>
    <div><p className="text-[10px] font-black uppercase tracking-wide text-purple-700">{t('playground.learningPath.kicker')}</p><h3 className="text-sm font-black text-slate-950">{t('playground.learningPath.title')}</h3><p className="mt-1 text-xs text-slate-600">{t('playground.learningPath.boundary')}</p></div>
    <ol className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={t('playground.learningPath.listLabel')}>
      {nodes.map((node, index) => <li key={node.id} data-learning-path-node={node.id} className={`rounded-xl border px-3 py-2 ${stateClass[node.state]}`}><div className="flex items-start gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 text-[10px] font-black">{index + 1}</span><div className="min-w-0 flex-1"><p className="text-xs font-black">{t(node.titleKey)}</p><p className="mt-1 text-[10px] opacity-80">{t(node.descriptionKey)}</p><span className="mt-2 inline-flex rounded-full border border-current px-2 py-0.5 text-[10px] font-black">{t(`playground.learningPath.state.${node.state}`)}</span></div></div>{node.state === LEARNING_PATH_STATES.EXPLORED && <button type="button" onClick={() => onIlluminate?.(node.id)} className="mt-2 rounded-lg border border-emerald-300 bg-white/80 px-2 py-1 text-[10px] font-black text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('playground.learningPath.illuminate')}</button>}</li>)}
    </ol>
  </section>;
}
