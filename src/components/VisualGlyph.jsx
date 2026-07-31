import React from 'react';

const curvePaths = {
  relu: 'M8 66 L48 66 L90 14',
  sigmoid: 'M8 64 C26 64 31 57 46 42 C61 27 67 18 92 18',
  tanh: 'M8 68 C25 68 33 55 47 41 C61 27 69 14 92 14',
  'smooth-curve': 'M8 66 C26 66 34 55 46 42 C58 29 68 18 92 14',
};

function Curve({ kind, animated }) {
  return <svg viewBox="0 0 100 78" className="h-full w-full" aria-hidden="true">
    <path d="M6 69 H96 M48 7 V74" stroke="#cbd5e1" strokeWidth="1.5" />
    <path d={curvePaths[kind] ?? curvePaths['smooth-curve']} fill="none" stroke="#2563eb" strokeLinecap="round" strokeWidth="4" strokeDasharray={animated ? '140' : undefined}>
      {animated && <animate attributeName="stroke-dashoffset" values="140;0;0" dur="2.4s" repeatCount="indefinite" />}
    </path>
  </svg>;
}

function Dense({ animated }) {
  const left = [16, 30, 44, 58];
  const right = [24, 40, 56];
  return <svg viewBox="0 0 100 76" className="h-full w-full" aria-hidden="true">
    {left.flatMap((y, i) => right.map((targetY, j) => (
      <line key={`${i}-${j}`} x1="24" y1={y} x2="76" y2={targetY} stroke="#60a5fa" strokeWidth={(i + j) % 3 + 0.7} opacity="0.65">
        {animated && <animate attributeName="opacity" values="0.2;0.9;0.2" dur={`${1.2 + (i + j) * 0.12}s`} repeatCount="indefinite" />}
      </line>
    )))}
    {left.map((y) => <circle key={`l-${y}`} cx="22" cy={y} r="5" fill="#3b82f6" />)}
    {right.map((y) => <circle key={`r-${y}`} cx="78" cy={y} r="6" fill="#8b5cf6" />)}
  </svg>;
}

function Scatter({ neighbors, animated }) {
  const points = [[16, 60], [27, 51], [38, 54], [49, 39], [61, 43], [73, 25], [86, 20]];
  return <svg viewBox="0 0 100 76" className="h-full w-full" aria-hidden="true">
    <path d="M9 68 H94 M12 72 V7" stroke="#cbd5e1" strokeWidth="1.5" />
    {!neighbors && <path d="M14 63 L89 15" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round" />}
    {points.map(([x, y], index) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill={neighbors ? index % 3 ? '#3b82f6' : '#f97316' : '#8b5cf6'} />)}
    {neighbors && <circle cx="57" cy="39" r="17" fill="none" stroke="#0f172a" strokeDasharray="3 3">
      {animated && <animate attributeName="r" values="5;20;17" dur="2s" repeatCount="indefinite" />}
    </circle>}
  </svg>;
}

function Table({ animated }) {
  return <svg viewBox="0 0 100 76" className="h-full w-full" aria-hidden="true">
    <rect x="13" y="10" width="74" height="56" rx="7" fill="white" stroke="#10b981" strokeWidth="2" />
    {[28, 46].map((x) => <line key={x} x1={x} y1="10" x2={x} y2="66" stroke="#a7f3d0" />)}
    {[25, 39, 53].map((y) => <line key={y} x1="13" y1={y} x2="87" y2={y} stroke="#a7f3d0" />)}
    <rect x="14" y="11" width="72" height="13" rx="5" fill="#d1fae5">
      {animated && <animate attributeName="y" values="11;39;11" dur="2.4s" repeatCount="indefinite" />}
    </rect>
  </svg>;
}

function Descent({ animated }) {
  return <svg viewBox="0 0 100 76" className="h-full w-full" aria-hidden="true">
    <path d="M6 15 C28 15 29 64 51 64 C73 64 74 15 95 15" fill="none" stroke="#fed7aa" strokeWidth="7" />
    <path d="M25 25 C31 38 36 50 49 59" fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
    <circle cx="25" cy="25" r="5" fill="#f97316">
      {animated && <animateMotion path="M0 0 C6 13 11 25 24 34" dur="2s" repeatCount="indefinite" />}
    </circle>
  </svg>;
}

function Attention({ animated }) {
  return <svg viewBox="0 0 120 76" className="h-full w-full" aria-hidden="true">
    {['Q', 'K', 'V'].map((label, index) => <g key={label}><rect x={5 + index * 29} y="9" width="22" height="18" rx="5" fill={index === 2 ? '#ddd6fe' : '#dbeafe'} /><text x={16 + index * 29} y="22" textAnchor="middle" fontSize="10" fontWeight="700" fill="#334155">{label}</text></g>)}
    <path d="M16 28 L52 44 M45 28 L52 44 M74 28 L73 44" stroke="#94a3b8" strokeWidth="2" />
    <rect x="39" y="43" width="47" height="23" rx="7" fill="#2563eb" />
    <text x="62" y="58" textAnchor="middle" fontSize="9" fontWeight="700" fill="white">H → H′</text>
    {animated && <circle r="3" fill="#f97316"><animateMotion path="M16 28 L52 44 L73 44" dur="1.6s" repeatCount="indefinite" /></circle>}
  </svg>;
}

function GridOperation({ kind, animated }) {
  const cells = Array.from({ length: 16 }, (_, index) => index);
  return <svg viewBox="0 0 110 76" className="h-full w-full" aria-hidden="true">
    {cells.map((cell) => {
      const x = 7 + (cell % 4) * 13;
      const y = 12 + Math.floor(cell / 4) * 13;
      return <rect key={cell} x={x} y={y} width="11" height="11" rx="2" fill={cell % 5 === 0 ? '#bfdbfe' : '#eff6ff'} stroke="#93c5fd" />;
    })}
    <rect x="7" y="12" width="25" height="25" rx="3" fill="none" stroke="#f97316" strokeWidth="3">
      {animated && <animate attributeName="x" values="7;33;7" dur="2s" repeatCount="indefinite" />}
    </rect>
    <path d="M62 37 H75" stroke="#64748b" strokeWidth="2" />
    <path d="M72 33 L77 37 L72 41" fill="none" stroke="#64748b" strokeWidth="2" />
    {kind === 'pool' ? <g><rect x="82" y="24" width="21" height="21" rx="5" fill="#8b5cf6" /><text x="92.5" y="38" textAnchor="middle" fontSize="9" fontWeight="700" fill="white">max</text></g> : <g>{[0, 1, 2, 3].map((cell) => <rect key={cell} x={82 + (cell % 2) * 11} y={24 + Math.floor(cell / 2) * 11} width="10" height="10" rx="2" fill="#d1fae5" stroke="#34d399" />)}</g>}
  </svg>;
}

function Bars({ kind, animated }) {
  const values = kind === 'probability' ? [54, 30, 16] : [34, 61, 45];
  return <svg viewBox="0 0 100 76" className="h-full w-full" aria-hidden="true">
    <path d="M10 67 H92" stroke="#cbd5e1" strokeWidth="2" />
    {values.map((value, index) => <rect key={value} x={18 + index * 25} y={66 - value * 0.75} width="14" height={value * 0.75} rx="4" fill={['#3b82f6', '#8b5cf6', '#10b981'][index]}>
      {animated && <animate attributeName="height" values={`4;${value * 0.75};${value * 0.75}`} dur={`${1.4 + index * 0.2}s`} repeatCount="indefinite" />}
    </rect>)}
  </svg>;
}

function Generic({ kind, animated }) {
  const labels = kind === 'sequence' ? ['xₜ', 'H', 'H′'] : kind === 'composite' ? ['A', 'B', 'C'] : kind === 'output' ? ['H', 'ŷ', '✓'] : ['x', 'f', 'y'];
  return <svg viewBox="0 0 120 76" className="h-full w-full" aria-hidden="true">
    {labels.map((label, index) => <g key={label}>
      <rect x={5 + index * 40} y="24" width="29" height="28" rx="8" fill={index === 1 ? '#3b82f6' : '#e2e8f0'} />
      <text x={19.5 + index * 40} y="42" textAnchor="middle" fontSize="10" fontWeight="700" fill={index === 1 ? 'white' : '#334155'}>{label}</text>
      {index < 2 && <path d={`M${34 + index * 40} 38 H${44 + index * 40}`} stroke="#64748b" strokeWidth="2" />}
    </g>)}
    {animated && <circle cy="38" r="3" fill="#f97316"><animate attributeName="cx" values="20;60;100;20" dur="2.4s" repeatCount="indefinite" /></circle>}
  </svg>;
}

export default function VisualGlyph({ kind, animated = false, className = '' }) {
  let visual;
  if (curvePaths[kind]) visual = <Curve kind={kind} animated={animated} />;
  else if (kind === 'dense') visual = <Dense animated={animated} />;
  else if (kind === 'scatter' || kind === 'neighbors') visual = <Scatter neighbors={kind === 'neighbors'} animated={animated} />;
  else if (['table', 'split', 'grid', 'shape', 'normalize', 'dropout', 'embedding'].includes(kind)) visual = <Table animated={animated} />;
  else if (kind === 'descent' || kind === 'loss') visual = <Descent animated={animated} />;
  else if (kind === 'attention') visual = <Attention animated={animated} />;
  else if (kind === 'convolution' || kind === 'pool') visual = <GridOperation kind={kind} animated={animated} />;
  else if (kind === 'bars' || kind === 'probability') visual = <Bars kind={kind} animated={animated} />;
  else visual = <Generic kind={kind} animated={animated} />;
  return <div className={`overflow-hidden ${className}`}>{visual}</div>;
}
