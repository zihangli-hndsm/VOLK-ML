import { rendererByPrimitiveType } from './rendererRegistry.jsx';
import { buildLabelColorMap } from './visualEncoding.js';
import PlaygroundControlField from './PlaygroundControlField.jsx';

// Side panel: model controls plus the JSON primitives declared for the side
// layout (vote bars, metrics, observation, ...).
export default function PlaygroundInspector({ playground, snapshot, onDispatch, t }) {
  const { primitives, script, visualState } = snapshot;
  const layout = script?.layout?.side ?? [];
  const side = primitives.filter((primitive) => (
    layout.includes(primitive.id) && primitive.type !== 'formula' && visualState[primitive.id] !== false
  ));
  const scatter = primitives.find((primitive) => primitive.type === 'scatter');
  const network = primitives.find((primitive) => primitive.type === 'network-graph' && visualState[primitive.id] !== false);
  const NetworkGraph = rendererByPrimitiveType['network-graph'];
  const colorByLabel = buildLabelColorMap(scatter?.props?.points);
  return <div className="space-y-4">
    <div className="rounded-2xl border border-slate-200 p-3">
      <h3 className="text-xs font-black uppercase tracking-wider text-blue-600">{t('playground.controlsTitle')}</h3>
      <div className="mt-3 space-y-3">
        {playground.controls.map((control) => <PlaygroundControlField key={control.key} control={control} snapshot={snapshot} onDispatch={onDispatch} t={t} />)}
      </div>
    </div>
    {network && NetworkGraph && <section data-representation-network="true" className="rounded-2xl border border-blue-100 bg-blue-50/40 p-2">
      <svg viewBox="0 0 360 340" className="block h-auto w-full" role="img" aria-label={t('playground.networkGraphTitle')}>
        <NetworkGraph props={network.props} t={t} />
      </svg>
    </section>}
    {side.map((primitive) => {
      const Renderer = rendererByPrimitiveType[primitive.type];
      if (!Renderer) return null;
      return <Renderer key={primitive.id} props={primitive.props} t={t} colorByLabel={colorByLabel} />;
    })}
  </div>;
}
