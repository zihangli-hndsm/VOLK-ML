import PlaygroundControlField from './PlaygroundControlField.jsx';

const GROUPS = [
  ['world', 'playground.layer.world'],
  ['model', 'playground.layer.model'],
  ['learning', 'playground.layer.learning'],
  ['evaluation', 'playground.layer.evaluation'],
];

export default function TunePanel({ playground, snapshot, onDispatch, onOpenWorldTools, t }) {
  const controls = playground?.controls ?? [];
  return <div data-ui-layer="tune" className="space-y-3" aria-label={t('playground.layer.tuneLabel')}>
    <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
      <h4 className="text-xs font-black uppercase tracking-wider text-blue-800">{t('playground.layer.world')}</h4>
      <p className="mt-1 text-xs leading-5 text-slate-600">{t('playground.layer.worldHint')}</p>
      {onOpenWorldTools && <button type="button" onClick={onOpenWorldTools} className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.phenomenon.moreWorldTools')}</button>}
    </section>
    {GROUPS.slice(1).map(([domain, labelKey]) => {
      const group = controls.filter((control) => (control.domain === domain) || (domain === 'evaluation' && control.domain === 'view'));
      if (!group.length) return null;
      return <section key={domain} data-ui-control-group={domain} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">{t(labelKey)}</h4>
        <div className="mt-3 space-y-3">{group.map((control) => <PlaygroundControlField key={control.key} control={control} snapshot={snapshot} onDispatch={onDispatch} t={t} />)}</div>
      </section>;
    })}
  </div>;
}
