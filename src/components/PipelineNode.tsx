import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNode } from '../types';
import { useVividTranslation } from '../context/LanguageContext';

export function PipelineNode({ data, selected }: NodeProps<PipelineNode>) {
  const { t } = useVividTranslation();
  return (
    <div className={`min-w-56 max-w-72 rounded-2xl border bg-white p-4 shadow-lg ${selected ? 'border-blue-500' : 'border-slate-200'}`}>
      {data.manifest.inputs.map((input, index) => (
        <Handle key={input.name} type="target" position={Position.Left} id={input.name} style={{ top: 44 + index * 22 }} />
      ))}
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{data.manifest.category}</p>
      <h3 className="mt-1 break-words text-base font-bold text-slate-900">{t(data.label)}</h3>
      <p className="mt-2 break-words text-sm text-slate-600">{t(data.manifest.description)}</p>
      <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-slate-500">
        {data.manifest.outputs.map((output) => <span className="rounded-full bg-slate-100 px-2 py-1" key={output.name}>{output.name}: {output.type}</span>)}
      </div>
      {data.manifest.outputs.map((output, index) => (
        <Handle key={output.name} type="source" position={Position.Right} id={output.name} style={{ top: 44 + index * 22 }} />
      ))}
    </div>
  );
}
