import React from 'react';
import { architectureLayout, stageForManifest, stageStyles, visualKindForManifest } from '../core/visualLanguage.js';
import VisualGlyph from './VisualGlyph.jsx';

export default function ArchitectureView({ nodes, edges, onSelect, t }) {
  const layers = architectureLayout(nodes, edges);
  return <div className="h-full overflow-auto bg-slate-50 p-5">
    <div className="mb-4 flex flex-wrap gap-2">
      {['data', 'model', 'training', 'output'].map((stage) => <span key={stage} className={`rounded-full px-3 py-1 text-xs font-bold ${stageStyles[stage].soft} ${stageStyles[stage].text}`}>{t(`stage.${stage}`)}</span>)}
    </div>
    <div className="flex min-w-max items-stretch gap-5">
      {layers.map((layer, index) => <React.Fragment key={index}><section className="w-64 rounded-3xl border border-slate-200 bg-white/80 p-3 shadow-sm">
        <p className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">{t('architecture.layer', { index: index + 1 })}</p>
        <div className="space-y-3">{layer.map((node) => {
          const stage = stageForManifest(node.data.manifest);
          const style = stageStyles[stage];
          return <button key={node.id} onClick={() => onSelect(node.id)} className={`flex w-full items-center gap-3 rounded-2xl border-l-4 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${style.border}`}>
            <VisualGlyph kind={visualKindForManifest(node.data.manifest)} className={`h-14 w-20 shrink-0 rounded-xl ${style.soft}`} />
            <span className="min-w-0"><span className={`block text-[10px] font-black uppercase ${style.text}`}>{t(`stage.${stage}`)}</span><span className="block break-words text-sm font-bold text-slate-900">{t(node.data.manifest.name)}</span></span>
          </button>;
        })}</div>
      </section>{index < layers.length - 1 && <div className="grid w-7 shrink-0 place-items-center text-3xl font-light text-slate-300">→</div>}</React.Fragment>)}
    </div>
  </div>;
}
