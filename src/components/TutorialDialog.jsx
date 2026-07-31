import React, { useState } from 'react';
import { tutorialFor } from '../core/tutorials.js';
import VisualGlyph from './VisualGlyph.jsx';

const points = [
  [22, 108], [42, 94], [62, 88], [82, 66], [102, 72], [122, 48], [142, 42], [162, 26],
];

function GridVisual({ kind }) {
  const cells = Array.from({ length: kind === 'shape' ? 12 : 16 }, (_, index) => index + 1);
  return <div className="flex items-center justify-center gap-5">
    <div className={`grid gap-1 ${kind === 'shape' ? 'grid-cols-4' : 'grid-cols-4'}`}>
      {cells.map((value, index) => <span key={value} className={`grid h-8 w-8 place-items-center rounded-lg text-[10px] font-bold ${kind === 'pool' && index === 5 ? 'bg-violet-600 text-white' : kind === 'normalize' ? index % 4 === 0 ? 'bg-blue-200 text-blue-800' : 'bg-blue-50 text-blue-500' : 'bg-white text-slate-500 shadow-sm'}`}>{kind === 'dropout' && index % 4 === 1 ? '×' : value}</span>)}
    </div>
    {(kind === 'shape' || kind === 'pool' || kind === 'embedding') && <><span className="text-2xl text-slate-300">→</span><div className="rounded-2xl bg-slate-950 px-5 py-4 font-mono text-sm font-bold text-white">{kind === 'pool' ? 'max = 6' : kind === 'embedding' ? '[0.2, −0.7, …]' : '[1, 2, …, 12]'}</div></>}
  </div>;
}

function CurveVisual({ kind }) {
  const paths = {
    relu: 'M12 118 L94 118 L174 24',
    sigmoid: 'M12 112 C52 112 62 98 88 72 C114 46 126 30 174 30',
    tanh: 'M12 116 C48 116 64 96 88 70 C112 44 130 24 174 24',
    'smooth-curve': 'M12 112 C48 112 62 96 84 76 C104 58 122 38 174 24',
  };
  return <svg viewBox="0 0 190 140" className="h-48 w-full" role="img">
    <path d="M10 120 H180 M92 10 V132" stroke="#cbd5e1" strokeWidth="2" />
    <path d={paths[kind] ?? paths['smooth-curve']} fill="none" stroke="#2563eb" strokeLinecap="round" strokeWidth="6" />
  </svg>;
}

function ScatterVisual({ neighbors = false }) {
  return <svg viewBox="0 0 190 140" className="h-48 w-full" role="img">
    <path d="M12 124 H180 M18 132 V12" stroke="#cbd5e1" strokeWidth="2" />
    {!neighbors && <path d="M20 116 L172 20" stroke="#2563eb" strokeLinecap="round" strokeWidth="5" />}
    {points.map(([x, y], index) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill={neighbors ? index % 3 === 0 ? '#f97316' : '#2563eb' : '#7c3aed'} />)}
    {neighbors && <><circle cx="102" cy="70" r="31" fill="none" stroke="#0f172a" strokeDasharray="5 4" strokeWidth="2" /><circle cx="102" cy="70" r="7" fill="#10b981" stroke="white" strokeWidth="3" /></>}
  </svg>;
}

function FlowVisual({ kind }) {
  const labels = {
    flow: ['x', 'fθ(x)', 'ŷ'],
    tensor: ['[xᵢ]', '(d₁,…,dₖ)', 'X'],
    network: ['x', 'Wx + b', 'h'],
    sequence: ['xₜ', 'hₜ', 'hₜ₊₁'],
    attention: ['QKᵀ', 'α', 'αV'],
    merge: ['a, b', '⊕', 'y'],
    composite: ['A', 'σ', 'R'],
    residual: ['x', 'F(x)', 'x + F(x)'],
  }[kind] ?? ['x', 'f(x)', 'y'];
  return <div className="flex w-full items-center justify-center gap-2 sm:gap-4">
    {labels.map((label, index) => <React.Fragment key={label}><div className={`grid min-h-16 min-w-16 place-items-center rounded-2xl border px-3 text-center font-mono text-xs font-bold shadow-sm ${index === 1 ? 'border-blue-300 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{label}</div>{index < labels.length - 1 && <span className="text-xl text-slate-300">→</span>}</React.Fragment>)}
  </div>;
}

function BarsVisual({ kind }) {
  const values = kind === 'split' ? [80, 20] : kind === 'probability' ? [67, 24, 9] : [34, 70, 48];
  return <div className="flex h-48 items-end justify-center gap-4">
    {values.map((value, index) => <div key={`${value}-${index}`} className="flex flex-col items-center gap-2"><span className="text-xs font-bold text-slate-500">{value}{kind === 'split' || kind === 'probability' ? '%' : ''}</span><div style={{ height: `${Math.max(28, value * 1.35)}px` }} className={`${index === 0 ? 'bg-blue-500' : index === 1 ? 'bg-violet-400' : 'bg-emerald-400'} w-12 rounded-t-xl`} /></div>)}
  </div>;
}

function LandscapeVisual() {
  return <svg viewBox="0 0 190 140" className="h-48 w-full" role="img">
    <path d="M10 24 C48 24 48 116 94 116 C140 116 140 24 180 24" fill="none" stroke="#cbd5e1" strokeWidth="8" />
    <circle cx="54" cy="70" r="8" fill="#f97316" />
    <path d="M58 76 L80 105" stroke="#2563eb" strokeLinecap="round" strokeWidth="4" />
    <path d="M74 102 L81 106 L80 97" fill="#2563eb" />
  </svg>;
}

function TutorialVisual({ kind, label }) {
  let content;
  if (['relu', 'sigmoid', 'tanh', 'smooth-curve'].includes(kind)) content = <CurveVisual kind={kind} />;
  else if (kind === 'scatter' || kind === 'neighbors') content = <ScatterVisual neighbors={kind === 'neighbors'} />;
  else if (['table', 'grid', 'pool', 'shape', 'dropout', 'normalize', 'embedding'].includes(kind)) content = <GridVisual kind={kind} />;
  else if (['split', 'bars', 'probability'].includes(kind)) content = <BarsVisual kind={kind} />;
  else if (['descent', 'loss'].includes(kind)) content = <LandscapeVisual />;
  else content = <FlowVisual kind={kind} />;
  return <div aria-label={label} className="grid min-h-56 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 to-violet-100 p-5">{content}</div>;
}

export default function TutorialDialog({ manifest, onClose, t }) {
  const [playing, setPlaying] = useState(false);
  if (!manifest) return null;
  const tutorial = tutorialFor(manifest);
  if (!tutorial) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={onClose}>
    <section className="max-h-[94vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">{t('tutorial.title')}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{t(manifest.name)}</h2><p className="mt-1 text-sm text-slate-500">{t(`category.${manifest.category}`)}</p></div>
        <button aria-label={t('common.close')} onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 font-bold hover:bg-slate-200">✕</button>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <button onClick={() => setPlaying((value) => !value)} className="w-full text-left">
            <div aria-label={t('tutorial.visual')} className="grid min-h-56 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 to-violet-100 p-5">
              <VisualGlyph kind={tutorial.visual} animated={playing} className="h-56 w-full" />
            </div>
            <span className="mt-2 block text-center text-xs font-bold text-blue-600">{playing ? t('tutorial.pauseAnimation') : t('tutorial.playAnimation')}</span>
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">{t('tutorial.visualHint')}</p>
          <div className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('tutorial.formula')}</p><p className="mt-2 whitespace-nowrap font-mono text-sm font-bold text-sky-300">{t(tutorial.formula)}</p></div>
        </div>
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-blue-600">{t('tutorial.purpose')}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{t(manifest.description)}</p></section>
          <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-violet-600">{t('tutorial.intuition')}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{t(tutorial.intuition)}</p></section>
          <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-emerald-600">{t('tutorial.principle')}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{t(tutorial.principle)}</p></section>
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="text-xs font-black uppercase tracking-wider text-amber-700">{t('tutorial.example')}</h3><p className="mt-2 text-sm leading-6 text-amber-950">{t(tutorial.example)}</p></section>
        </div>
      </div>
    </section>
  </div>;
}
