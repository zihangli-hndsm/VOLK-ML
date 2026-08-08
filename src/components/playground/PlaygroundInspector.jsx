import { rendererByPrimitiveType } from './rendererRegistry.jsx';
import { buildLabelColorMap } from './visualEncoding.js';

// Side panel: model controls plus the JSON primitives declared for the side
// layout (vote bars, metrics, observation, ...).
export default function PlaygroundInspector({ playground, snapshot, onDispatch, t }) {
  const { primitives, script, visualState } = snapshot;
  const layout = script?.layout?.side ?? [];
  const side = primitives.filter((primitive) => (
    layout.includes(primitive.id) && primitive.type !== 'formula' && visualState[primitive.id] !== false
  ));
  const scatter = primitives.find((primitive) => primitive.type === 'scatter');
  const colorByLabel = buildLabelColorMap(scatter?.props?.points);
  return <div className="space-y-4">
    <div className="rounded-2xl border border-slate-200 p-3">
      <h3 className="text-xs font-black uppercase tracking-wider text-blue-600">{t('playground.controlsTitle')}</h3>
      <div className="mt-3 space-y-3">
        {playground.controls.map((control) => {
          const value = snapshot.controls[control.key];
          const label = t(`playground.control.${control.key}`);
          if (control.type === 'boolean') {
            return <label key={control.key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
              <span>{label}</span>
              <input type="checkbox" checked={Boolean(value)} onChange={(event) => onDispatch({ type: 'SET_CONTROL', key: control.key, value: event.target.checked })} className="h-5 w-5 accent-blue-600" />
            </label>;
          }
          if (control.type === 'select') {
            const options = control.options ?? snapshot.scene?.featureOptions ?? [];
            return <label key={control.key} className="block rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
              <span className="block">{label}</span>
              <select value={value} onChange={(event) => onDispatch({ type: 'SET_CONTROL', key: control.key, value: event.target.value })} className="mt-2 w-full rounded-xl border bg-white p-2">
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
          return <label key={control.key} className="block rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
            <span className="flex justify-between gap-2"><span>{label}</span><span className="font-mono text-blue-700">{Number(value).toFixed(3)}</span></span>
            <input type="range" min={min} max={max} step={step} value={Number(value)}
              onChange={(event) => onDispatch({ type: 'SET_CONTROL', key: control.key, value: Number(event.target.value) })}
              className="mt-3 w-full accent-blue-600" />
          </label>;
        })}
      </div>
    </div>
    {side.map((primitive) => {
      const Renderer = rendererByPrimitiveType[primitive.type];
      if (!Renderer) return null;
      return <Renderer key={primitive.id} props={primitive.props} t={t} colorByLabel={colorByLabel} />;
    })}
  </div>;
}
