export default function PlaygroundControlField({ control, snapshot, onDispatch, t, showHint = false, changed = false, held = false, compact = false, interventionControlKey = null }) {
  const value = snapshot.controls[control.key];
  const label = t(`playground.control.${control.key}`);
  const dispatch = (nextValue) => onDispatch({ type: 'SET_CONTROL', key: control.key, value: nextValue });
  const status = changed ? t('playground.experiment.changed') : held ? t('playground.experiment.heldConstant') : null;
  const header = <span className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0">{label}</span>{status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${changed ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{status}</span>}</span>;
  const surface = compact ? 'rounded-xl border border-slate-200 bg-white p-2 text-sm font-bold text-slate-700' : 'rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700';
  const controlFocus = interventionControlKey === control.key ? ' lumi-control-focus' : '';
  const hint = showHint && control.presentation?.explanationKey ? <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{t(control.presentation.explanationKey)}</span> : null;
  if (control.type === 'boolean') {
    return <label data-lumi-control={control.key} className={`flex items-center justify-between gap-3 ${surface}${controlFocus}`}>
      <span className="min-w-0">{header}{hint}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => dispatch(event.target.checked)} className="h-5 w-5 accent-blue-600" />
    </label>;
  }
  if (control.type === 'select') {
    const options = control.options ?? snapshot.scene?.featureOptions ?? [];
    return <label data-lumi-control={control.key} className={`block ${surface}${controlFocus}`}>
      {header}{hint}
      <select value={value} onChange={(event) => dispatch(event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-2">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>;
  }
  const ranges = snapshot.scene?.ranges ?? {};
  let min = control.min;
  let max = control.max;
  let step = control.step;
  if (control.key === 'queryX') {
    min = ranges.xMin ?? min;
    max = ranges.xMax ?? max;
    step = (max - min) / 200 || 0.01;
  } else if (control.key === 'queryY') {
    min = ranges.yMin ?? min;
    max = ranges.yMax ?? max;
    step = (max - min) / 200 || 0.01;
  } else {
    min = ranges[`${control.key}Min`] ?? min;
    max = ranges[`${control.key}Max`] ?? max;
    step = ranges[`${control.key}Step`] ?? step;
  }
  return <label data-lumi-control={control.key} className={`block ${surface}${controlFocus}`}>
    <span className="flex justify-between gap-2">{header}<span className="shrink-0 font-mono text-blue-700">{Number(value).toFixed(3)}</span></span>{hint}
    <input type="range" min={min} max={max} step={step} value={Number(value)} onChange={(event) => dispatch(Number(event.target.value))} className={`${compact ? 'mt-2' : 'mt-3'} w-full accent-blue-600`} />
  </label>;
}
