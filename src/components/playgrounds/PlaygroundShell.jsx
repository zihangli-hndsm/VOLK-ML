import PlaygroundControls from './PlaygroundControls.jsx';
import PlaygroundStage from './PlaygroundStage.jsx';
import PlaygroundTimeline from './PlaygroundTimeline.jsx';
import { playgroundViews } from './viewRegistry.jsx';

const formatMetric = (value) => (
  typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(4)) : String(value)
);

export default function PlaygroundShell({ playground, snapshot, onDispatch, onClose, t }) {
  const View = playgroundViews[playground.id];
  const editHandlers = playground.id === 'linear-regression'
    ? {
      onAddPoint: (x, y) => onDispatch({ type: 'ADD_POINT', x, y }),
      onMovePoint: (id, x, y) => onDispatch({ type: 'MOVE_POINT', pointId: id, x, y }),
      onRemovePoint: (id) => onDispatch({ type: 'REMOVE_POINT', pointId: id }),
    }
    : {
      onAddPoint: (x, y, label) => onDispatch({ type: 'ADD_TRAINING_POINT', x, y, label }),
      onMovePoint: (id, x, y) => onDispatch({ type: 'MOVE_TRAINING_POINT', pointId: id, x, y }),
    };
  const sourceLabel = snapshot.source.kind === 'workspace-dataset'
    ? t('playground.source.workspace', { name: snapshot.source.name })
    : t('playground.source.example');
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-black text-slate-950">{t(playground.titleKey)}</h2>
        <p className="mt-1 text-sm text-slate-500">{t(playground.descriptionKey)}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          {sourceLabel}
          {snapshot.source.stale && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{t('playground.source.stale')}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => onDispatch({ type: 'RESET' })} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('playground.timeline.reset')}</button>
        <button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold text-slate-700">✕</button>
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <PlaygroundStage playgroundId={playground.id} snapshot={snapshot} t={t} {...editHandlers} />
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 p-3"><h3 className="text-xs font-black uppercase tracking-wider text-blue-600">{t('playground.controlsTitle')}</h3><div className="mt-3"><PlaygroundControls playground={playground} snapshot={snapshot} onDispatch={onDispatch} t={t} /></div></div>
        {snapshot.observation && <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3"><h3 className="text-xs font-black uppercase tracking-wider text-violet-700">{t('playground.observationTitle')}</h3><p className="mt-2 text-sm font-bold text-slate-900">{t(snapshot.observation.titleKey)}</p><p className="mt-1 text-sm leading-6 text-slate-700">{t(snapshot.observation.bodyKey, snapshot.observation.params)}</p></div>}
        <div className="rounded-2xl border border-slate-200 p-3"><h3 className="text-xs font-black uppercase tracking-wider text-emerald-600">{t('playground.metricsTitle')}</h3><dl className="mt-2 space-y-1">{Object.entries(snapshot.metrics).map(([key, value]) => <div key={key} className="flex items-center justify-between gap-2 text-sm"><dt className="text-slate-500">{t(`playground.metric.${key}`)}</dt><dd className="font-mono font-bold text-slate-900">{formatMetric(value)}</dd></div>)}</dl></div>
      </div>
    </div>
    <PlaygroundTimeline snapshot={snapshot} onDispatch={onDispatch} t={t} />
    <div className="rounded-2xl bg-slate-950 p-4 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.formulaTitle')}</p>
      {snapshot.formula && <p className="mt-2 font-mono text-sm font-bold text-sky-300">
        {snapshot.formula.key === 'playground.formula.linear'
          ? <>y = <span className={snapshot.formula.highlight === 'weight' ? 'text-amber-300' : ''}>{snapshot.formula.params.weight}</span> · x {snapshot.formula.params.operator} <span className={snapshot.formula.highlight === 'bias' ? 'text-amber-300' : ''}>{snapshot.formula.params.bias}</span></>
          : <>{t('playground.formula.knn', snapshot.formula.params)}</>}
      </p>}
    </div>
  </section>;
}
