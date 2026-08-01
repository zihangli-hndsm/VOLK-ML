import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  leastSquaresFit,
  meanSquaredError,
  playgroundRanges,
  regressionPointsFromDataset,
} from '../core/linearRegressionPlayground.js';

const numberLabel = (value) => {
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) return value.toExponential(2);
  return value.toFixed(2);
};

export default function LinearRegressionPlayground({ dataset, t }) {
  const sample = useMemo(() => regressionPointsFromDataset(dataset), [dataset]);
  const ranges = useMemo(() => playgroundRanges(sample.points), [sample.points]);
  const optimum = useMemo(() => leastSquaresFit(sample.points), [sample.points]);
  const initialBias = useMemo(() => (
    sample.points.reduce((sum, point) => sum + point.y, 0) / sample.points.length
  ), [sample.points]);
  const [weight, setWeight] = useState(0);
  const [bias, setBias] = useState(initialBias);
  const clipId = useId().replace(/:/g, '');

  useEffect(() => {
    setWeight(0);
    setBias(initialBias);
  }, [initialBias]);

  const loss = meanSquaredError(sample.points, weight, bias);
  const plot = { left: 58, right: 620, top: 20, bottom: 320 };
  const xToSvg = (x) => plot.left + ((x - ranges.xMin) / (ranges.xMax - ranges.xMin)) * (plot.right - plot.left);
  const yToSvg = (y) => plot.bottom - ((y - ranges.yMin) / (ranges.yMax - ranges.yMin)) * (plot.bottom - plot.top);
  const lineStart = { x: xToSvg(ranges.xMin), y: yToSvg(weight * ranges.xMin + bias) };
  const lineEnd = { x: xToSvg(ranges.xMax), y: yToSvg(weight * ranges.xMax + bias) };
  const setBestFit = () => {
    setWeight(optimum.weight);
    setBias(optimum.bias);
  };

  return <section className="mt-6 rounded-3xl border border-blue-200 bg-blue-50/70 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-black text-slate-950">{t('playground.title')}</h3><p className="mt-1 text-xs text-slate-600">{sample.usingDataset ? t('playground.currentData', { feature: sample.feature, target: sample.target }) : t('playground.exampleData')}</p></div>
      <div className="rounded-2xl bg-slate-950 px-4 py-2 text-right text-white"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('playground.loss')}</p><p className="font-mono text-lg font-black text-sky-300">{numberLabel(loss)}</p></div>
    </div>
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <svg viewBox="0 0 640 360" className="block h-auto w-full" role="img" aria-label={t('playground.chartLabel')}>
        <defs><clipPath id={clipId}><rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} /></clipPath></defs>
        <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="#f8fafc" />
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={`grid-${ratio}`}>
          <line x1={plot.left} y1={plot.top + ratio * (plot.bottom - plot.top)} x2={plot.right} y2={plot.top + ratio * (plot.bottom - plot.top)} stroke="#e2e8f0" />
          <line x1={plot.left + ratio * (plot.right - plot.left)} y1={plot.top} x2={plot.left + ratio * (plot.right - plot.left)} y2={plot.bottom} stroke="#e2e8f0" />
        </g>)}
        <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} fill="none" stroke="#475569" strokeWidth="2" />
        <g clipPath={`url(#${clipId})`}>
          {sample.points.map((point, index) => <line key={`residual-${index}`} x1={xToSvg(point.x)} y1={yToSvg(point.y)} x2={xToSvg(point.x)} y2={yToSvg(weight * point.x + bias)} stroke="#fca5a5" strokeWidth="1.2" opacity="0.5" />)}
          <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y} stroke="#2563eb" strokeWidth="5" strokeLinecap="round" />
          {sample.points.map((point, index) => <circle key={`point-${index}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="4.5" fill="#7c3aed" stroke="white" strokeWidth="1.5" />)}
        </g>
        {[0, 0.5, 1].map((ratio) => <React.Fragment key={`label-${ratio}`}>
          <text x={plot.left + ratio * (plot.right - plot.left)} y="344" textAnchor="middle" fontSize="12" fill="#64748b">{numberLabel(ranges.xMin + ratio * (ranges.xMax - ranges.xMin))}</text>
          <text x="49" y={plot.bottom - ratio * (plot.bottom - plot.top) + 4} textAnchor="end" fontSize="12" fill="#64748b">{numberLabel(ranges.yMin + ratio * (ranges.yMax - ranges.yMin))}</text>
        </React.Fragment>)}
        <text x="334" y="358" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{sample.feature}</text>
        <text x="15" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 15 170)">{sample.target}</text>
      </svg>
    </div>
    <p className="mt-2 text-xs text-slate-500">{sample.total > sample.points.length ? t('playground.sampled', { shown: sample.points.length, total: sample.total }) : t('playground.pointCount', { count: sample.points.length })}</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="rounded-2xl bg-white p-3 font-bold text-slate-700 shadow-sm"><span className="flex justify-between gap-2 text-sm"><span>{t('playground.weight')}</span><span className="font-mono text-blue-700">{numberLabel(weight)}</span></span><input type="range" min={ranges.weightMin} max={ranges.weightMax} step={ranges.weightStep} value={weight} onChange={(event) => setWeight(Number(event.target.value))} className="mt-3 w-full accent-blue-600" /></label>
      <label className="rounded-2xl bg-white p-3 font-bold text-slate-700 shadow-sm"><span className="flex justify-between gap-2 text-sm"><span>{t('playground.bias')}</span><span className="font-mono text-violet-700">{numberLabel(bias)}</span></span><input type="range" min={ranges.biasMin} max={ranges.biasMax} step={ranges.biasStep} value={bias} onChange={(event) => setBias(Number(event.target.value))} className="mt-3 w-full accent-violet-600" /></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="font-mono text-sm font-black text-slate-800">{t('playground.equation', { weight: numberLabel(weight), operator: bias < 0 ? '−' : '+', bias: numberLabel(Math.abs(bias)) })}</p><button onClick={setBestFit} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">{t('playground.bestFit')}</button></div>
  </section>;
}
