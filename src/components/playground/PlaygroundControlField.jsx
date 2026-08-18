export default function PlaygroundControlField({ control, snapshot, onDispatch, t }) {
  const value = snapshot.controls[control.key];
  const label = t(`playground.control.${control.key}`);
  const dispatch = (nextValue) => onDispatch({ type: 'SET_CONTROL', key: control.key, value: nextValue });
  if (control.type === 'boolean') {
    return <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => dispatch(event.target.checked)} className="h-5 w-5 accent-blue-600" />
    </label>;
  }
  if (control.type === 'select') {
    const options = control.options ?? snapshot.scene?.featureOptions ?? [];
    return <label className="block rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
      <span className="block">{label}</span>
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
  return <label className="block rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
    <span className="flex justify-between gap-2"><span>{label}</span><span className="font-mono text-blue-700">{Number(value).toFixed(3)}</span></span>
    <input type="range" min={min} max={max} step={step} value={Number(value)} onChange={(event) => dispatch(Number(event.target.value))} className="mt-3 w-full accent-blue-600" />
  </label>;
}
