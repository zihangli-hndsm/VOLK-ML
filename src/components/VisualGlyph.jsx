import React from 'react';
import { activationValue, mseLandscapeValue } from '../core/visualLanguage.js';

const Svg = ({ children, viewBox = '0 0 120 76' }) => (
  <svg viewBox={viewBox} className="h-full w-full" aria-hidden="true">{children}</svg>
);

const arrow = (x1, y1, x2, y2, color = '#64748b') => <g>
  <path d={`M${x1} ${y1} L${x2} ${y2}`} stroke={color} strokeWidth="2" strokeLinecap="round" />
  <path d={`M${x2 - 5} ${y2 - 4} L${x2} ${y2} L${x2 - 5} ${y2 + 4}`} fill="none" stroke={color} strokeWidth="2" />
</g>;

function activationGeometry(op) {
  const xMin = -3;
  const xMax = 3;
  const ranges = {
    relu: [-1, 3.2],
    gelu: [-1, 3.2],
    sigmoid: [-0.1, 1.1],
    tanh: [-1.2, 1.2],
  };
  const [yMin, yMax] = ranges[op];
  const point = (x) => ({
    x: 8 + ((x - xMin) / (xMax - xMin)) * 84,
    y: 70 - ((activationValue(op, x) - yMin) / (yMax - yMin)) * 62,
  });
  const samples = Array.from({ length: 61 }, (_, index) => xMin + index * 0.1);
  const path = samples.map((x, index) => {
    const p = point(x);
    return `${index ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }).join(' ');
  return { path, origin: point(0), xAxisY: point(0).y + ((activationValue(op, 0) - 0) / (yMax - yMin)) * 62 };
}

function mseLandscapeGeometry() {
  const point = (parameter) => ({
    x: 8 + ((parameter + 1) / 2) * 104,
    y: 68 - mseLandscapeValue(parameter) * 58,
  });
  const samples = Array.from({ length: 41 }, (_, index) => -1 + index * 0.05);
  const path = samples.map((parameter, index) => {
    const sample = point(parameter);
    return `${index ? 'L' : 'M'}${sample.x.toFixed(2)} ${sample.y.toFixed(2)}`;
  }).join(' ');
  return { path, minimum: point(0), example: point(-0.55) };
}

function Activation({ op, animated }) {
  const geometry = activationGeometry(op);
  return <Svg viewBox="0 0 100 78">
    <path d={`M6 ${geometry.xAxisY} H96 M${geometry.origin.x} 5 V74`} stroke="#cbd5e1" strokeWidth="1.5" />
    <path d={geometry.path} fill="none" stroke="#2563eb" strokeLinecap="round" strokeWidth="4" strokeDasharray={animated ? 180 : undefined}>
      {animated && <animate attributeName="stroke-dashoffset" values="180;0;0" dur="2.8s" repeatCount="indefinite" />}
    </path>
    <circle cx={geometry.origin.x} cy={geometry.origin.y} r="3.2" fill="#f97316" stroke="white" strokeWidth="1.5" />
    {animated && <circle r="3" fill="#10b981"><animateMotion path={geometry.path} dur="3s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function Table({ animated }) {
  return <Svg><rect x="12" y="9" width="82" height="58" rx="7" fill="white" stroke="#10b981" strokeWidth="2" />
    {[34, 58, 78].map((x) => <line key={x} x1={x} y1="9" x2={x} y2="67" stroke="#a7f3d0" />)}
    {[24, 38, 52].map((y) => <line key={y} x1="12" y1={y} x2="94" y2={y} stroke="#a7f3d0" />)}
    <rect x="13" y="10" width="80" height="13" rx="5" fill="#d1fae5" />
    <rect x="13" y="25" width="80" height="12" fill="#bfdbfe" opacity="0.75">
      {animated && <animate attributeName="y" values="25;39;53;25" dur="2.4s" repeatCount="indefinite" />}
    </rect>
  </Svg>;
}

function Split({ animated }) {
  const rows = Array.from({ length: 10 }, (_, index) => index);
  return <Svg>{rows.map((row) => <rect key={row} x="8" y={5 + row * 6.5} width="24" height="5" rx="2" fill={row < 8 ? '#60a5fa' : '#f59e0b'} />)}
    {arrow(37, 25, 60, 20)}{arrow(37, 52, 60, 58)}
    <rect x="64" y="6" width="42" height="37" rx="7" fill="#dbeafe" stroke="#3b82f6" />
    <rect x="64" y="50" width="42" height="18" rx="7" fill="#fef3c7" stroke="#f59e0b" />
    <text x="85" y="28" textAnchor="middle" fontSize="12" fontWeight="800" fill="#1d4ed8">80%</text>
    <text x="85" y="63" textAnchor="middle" fontSize="10" fontWeight="800" fill="#b45309">20%</text>
    {animated && <circle r="3" fill="#10b981"><animateMotion path="M20 35 C45 35 48 20 76 20 C48 20 48 58 76 58" dur="2.4s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

const scatterPoints = [[17, 60], [29, 54], [39, 49], [49, 45], [61, 35], [73, 30], [87, 20]];

function LinearRegression({ animated }) {
  return <Svg viewBox="0 0 100 76"><path d="M8 68 H96 M12 72 V7" stroke="#cbd5e1" strokeWidth="1.5" />
    {scatterPoints.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill="#8b5cf6" />)}
    <g>{scatterPoints.slice(1, 6).map(([x, y]) => <line key={x} x1={x} y1={y} x2={x} y2={68 - x * 0.55} stroke="#fca5a5" strokeWidth="1.5" strokeDasharray="2 2" />)}</g>
    <path d="M14 62 L91 18" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round">
      {animated && <animate attributeName="d" values="M14 35 L91 45;M14 62 L91 18;M14 62 L91 18" dur="2.8s" repeatCount="indefinite" />}
    </path>
  </Svg>;
}

function Knn({ animated }) {
  const points = [[19, 57, 0], [29, 50, 0], [37, 61, 0], [69, 20, 1], [79, 28, 1], [86, 17, 1], [61, 43, 1]];
  return <Svg viewBox="0 0 100 76">{points.map(([x, y, cls]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill={cls ? '#f97316' : '#3b82f6'} />)}
    <circle cx="52" cy="43" r="5" fill="#10b981" stroke="white" strokeWidth="2" />
    <circle cx="52" cy="43" r="24" fill="none" stroke="#334155" strokeDasharray="4 3" strokeWidth="2">
      {animated && <animate attributeName="r" values="5;26;24" dur="2.2s" repeatCount="indefinite" />}
    </circle>
    {animated && points.slice(1, 6).map(([x, y], index) => <line key={`vote-${x}`} x1={x} y1={y} x2="52" y2="43" stroke={index > 2 ? '#f97316' : '#3b82f6'} opacity="0"><animate attributeName="opacity" values="0;0.8;0" begin={`${index * 0.15}s`} dur="2.2s" repeatCount="indefinite" /></line>)}
  </Svg>;
}

function Descent({ variant, animated }) {
  const colors = variant === 'adamw_optimizer' ? ['#8b5cf6', '#f97316'] : variant === 'adam_optimizer' ? ['#10b981', '#2563eb'] : ['#f97316', '#2563eb'];
  const path = variant === 'sgd_optimizer' ? 'M18 14 L31 34 L42 27 L51 49 L61 43 L72 61' : variant === 'adam_optimizer' ? 'M18 14 C31 19 34 43 51 48 C62 52 65 61 75 62' : 'M18 14 C33 24 38 45 53 51 C64 57 69 61 77 62';
  const motionPath = variant === 'sgd_optimizer' ? 'M0 0 L13 20 L24 13 L33 35 L43 29 L54 47' : variant === 'adam_optimizer' ? 'M0 0 C13 5 16 29 33 34 C44 38 47 47 57 48' : 'M0 0 C15 10 20 31 35 37 C46 43 51 47 59 48';
  return <Svg><path d="M7 13 C29 9 31 66 58 66 C83 66 87 13 112 13" fill="none" stroke="#fed7aa" strokeWidth="8" />
    <path d={path} fill="none" stroke={colors[1]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {variant === 'adam_optimizer' && <><path d="M22 66 H45" stroke="#10b981" strokeWidth="2" /><path d="M22 71 H35" stroke="#10b981" strokeWidth="2" /></>}
    {variant === 'adamw_optimizer' && <circle cx="96" cy="27" r="11" fill="none" stroke="#8b5cf6" strokeWidth="3">{animated && <animate attributeName="r" values="11;6;11" dur="2s" repeatCount="indefinite" />}</circle>}
    <circle cx="18" cy="14" r="5" fill={colors[0]}>{animated && <animateMotion path={motionPath} dur="2.4s" repeatCount="indefinite" />}</circle>
  </Svg>;
}

function Evaluation({ classification, animated }) {
  if (classification) return <Svg>{[[0, 0, 26], [1, 0, 5], [0, 1, 4], [1, 1, 25]].map(([col, row, value]) => <g key={`${col}-${row}`}><rect x={18 + col * 34} y={9 + row * 28} width="30" height="24" rx="5" fill={col === row ? '#bbf7d0' : '#fee2e2'} /><text x={33 + col * 34} y={25 + row * 28} textAnchor="middle" fontSize="10" fontWeight="800" fill="#334155">{value}</text></g>)}
    <circle cx="94" cy="38" r="17" fill="none" stroke="#e2e8f0" strokeWidth="7" /><path d="M94 21 A17 17 0 1 1 79 47" fill="none" stroke="#10b981" strokeWidth="7" strokeLinecap="round" strokeDasharray={animated ? '80' : undefined}>{animated && <animate attributeName="stroke-dashoffset" values="80;9;9" dur="2.2s" repeatCount="indefinite" />}</path><text x="94" y="41" textAnchor="middle" fontSize="9" fontWeight="800" fill="#047857">85%</text>
  </Svg>;
  return <Svg>{[11, 24, 14, 30, 18].map((error, index) => <g key={index}><line x1={15 + index * 16} y1="20" x2={15 + index * 16} y2={20 + error} stroke="#fca5a5" strokeWidth="4" strokeLinecap="round">{animated && <animate attributeName="y2" values={`20;${20 + error};${20 + error}`} dur={`${1.4 + index * 0.12}s`} repeatCount="indefinite" />}</line><circle cx={15 + index * 16} cy="20" r="3" fill="#3b82f6" /><circle cx={15 + index * 16} cy={20 + error} r="3" fill="#8b5cf6" /></g>)}
    {arrow(88, 38, 107, 38)}<text x="98" y="30" textAnchor="middle" fontSize="7" fill="#64748b">√Σe²/n</text>
  </Svg>;
}

function Predictor({ animated }) {
  return <Svg>{['6', '8'].map((label, index) => <g key={label}><rect x="6" y={14 + index * 32} width="26" height="22" rx="6" fill="#dbeafe" /><text x="19" y={29 + index * 32} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1d4ed8">{label}</text></g>)}
    {arrow(35, 38, 52, 38)}<rect x="54" y="18" width="29" height="40" rx="8" fill="#2563eb" /><text x="68.5" y="42" textAnchor="middle" fontSize="11" fontWeight="800" fill="white">fθ</text>{arrow(84, 38, 101, 38)}<circle cx="109" cy="38" r="10" fill="#d1fae5" /><text x="109" y="42" textAnchor="middle" fontSize="9" fontWeight="800" fill="#047857">ŷ</text>
    {animated && <circle cy="38" r="3" fill="#f97316"><animate attributeName="cx" values="24;50;68;98;108" dur="2.2s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function TensorInput({ animated }) {
  return <Svg>{[0, 1, 2].map((layer) => <rect key={layer} x={18 + layer * 7} y={13 + layer * 7} width="45" height="38" rx="5" fill={layer === 2 ? '#dbeafe' : '#eff6ff'} stroke="#3b82f6" />)}
    <text x="45" y="40" textAnchor="middle" fontSize="10" fontWeight="800" fill="#1d4ed8">B×H×W</text>{arrow(72, 39, 99, 39)}<text x="106" y="43" textAnchor="middle" fontSize="13" fontWeight="800" fill="#8b5cf6">X</text>
    {animated && <rect x="32" y="27" width="5" height="5" fill="#f97316"><animate attributeName="x" values="32;57;32" dur="1.8s" repeatCount="indefinite" /><animate attributeName="y" values="27;48;27" dur="1.8s" repeatCount="indefinite" /></rect>}
  </Svg>;
}

function ModelOutput({ animated }) {
  return <Svg><rect x="7" y="25" width="28" height="26" rx="7" fill="#dbeafe" /><text x="21" y="42" textAnchor="middle" fontSize="10" fontWeight="800" fill="#1d4ed8">H</text>
    {[13, 38, 63].map((y, index) => <g key={y}><path d={`M35 38 C55 38 54 ${y} 72 ${y}`} fill="none" stroke={index === 1 ? '#8b5cf6' : '#cbd5e1'} strokeWidth={index === 1 ? 3 : 2} /><circle cx="84" cy={y} r="9" fill={index === 1 ? '#ede9fe' : '#f1f5f9'} /><text x="84" y={y + 3} textAnchor="middle" fontSize="8" fontWeight="800" fill={index === 1 ? '#7c3aed' : '#94a3b8'}>{index === 1 ? 'ŷ' : '·'}</text></g>)}
    {animated && <circle cx="84" cy="38" r="12" fill="none" stroke="#8b5cf6" strokeWidth="2"><animate attributeName="r" values="9;14;9" dur="1.6s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function Dense({ animated }) {
  const left = [13, 29, 45, 61];
  const right = [20, 38, 56];
  return <Svg>{left.flatMap((y, i) => right.map((targetY, j) => <line key={`${i}-${j}`} x1="23" y1={y} x2="83" y2={targetY} stroke="#60a5fa" strokeWidth={(i + j) % 3 + 0.8} opacity="0.55">{animated && <animate attributeName="opacity" values="0.15;0.95;0.15" begin={`${(i + j) * 0.1}s`} dur="1.7s" repeatCount="indefinite" />}</line>))}
    {left.map((y) => <circle key={y} cx="20" cy={y} r="5" fill="#3b82f6" />)}{right.map((y) => <circle key={y} cx="86" cy={y} r="6" fill="#8b5cf6" />)}
    <text x="53" y="73" textAnchor="middle" fontSize="8" fontWeight="800" fill="#64748b">y = Wx + b</text>
  </Svg>;
}

const gridValues = [1, 2, 1, 0, 2, 5, 3, 1, 0, 1, 4, 2, 1, 0, 2, 3];

function Conv({ animated }) {
  return <Svg>{gridValues.map((value, index) => <rect key={index} x={5 + (index % 4) * 12} y={12 + Math.floor(index / 4) * 12} width="11" height="11" rx="2" fill={value > 3 ? '#93c5fd' : '#eff6ff'} stroke="#93c5fd" />)}
    <rect x="5" y="12" width="23" height="23" rx="3" fill="none" stroke="#f97316" strokeWidth="3">{animated && <><animate attributeName="x" values="5;29;29;5" dur="2.4s" repeatCount="indefinite" /><animate attributeName="y" values="12;12;36;12" dur="2.4s" repeatCount="indefinite" /></>}</rect>
    {arrow(57, 37, 71, 37)}{[0, 1, 2, 3].map((cell) => <rect key={cell} x={78 + (cell % 2) * 13} y={24 + Math.floor(cell / 2) * 13} width="12" height="12" rx="2" fill={cell === 3 ? '#34d399' : '#d1fae5'} stroke="#10b981" />)}
  </Svg>;
}

function Pool({ animated }) {
  const values = [1, 5, 2, 3];
  return <Svg>{values.map((value, index) => <g key={value}><rect x={10 + (index % 2) * 24} y={15 + Math.floor(index / 2) * 24} width="22" height="22" rx="5" fill={value === 5 ? '#c4b5fd' : '#ede9fe'} stroke="#8b5cf6" /><text x={21 + (index % 2) * 24} y={30 + Math.floor(index / 2) * 24} textAnchor="middle" fontSize="10" fontWeight="800" fill="#5b21b6">{value}</text></g>)}
    {arrow(61, 38, 80, 38)}<rect x="85" y="24" width="26" height="28" rx="7" fill="#8b5cf6" /><text x="98" y="42" textAnchor="middle" fontSize="12" fontWeight="800" fill="white">5</text>
    {animated && <rect x="34" y="15" width="22" height="22" rx="5" fill="none" stroke="#f97316" strokeWidth="3"><animate attributeName="stroke-width" values="1;5;1" dur="1.6s" repeatCount="indefinite" /></rect>}
  </Svg>;
}

function Shape({ reshape, animated }) {
  const values = [1, 2, 3, 4, 5, 6];
  return <Svg>{reshape ? values.map((value, index) => <g key={value}><rect x={5 + index * 10} y="30" width="9" height="16" rx="2" fill="#dbeafe" /><text x={9.5 + index * 10} y="41" textAnchor="middle" fontSize="6" fill="#1e40af">{value}</text></g>) : values.map((value, index) => <g key={value}><rect x={8 + (index % 3) * 15} y={21 + Math.floor(index / 3) * 15} width="14" height="14" rx="3" fill="#dbeafe" /><text x={15 + (index % 3) * 15} y={31 + Math.floor(index / 3) * 15} textAnchor="middle" fontSize="7" fill="#1e40af">{value}</text></g>)}
    {arrow(61, 38, 76, 38)}
    {reshape ? values.map((value, index) => <g key={`o-${value}`}><rect x={82 + (index % 3) * 10} y={24 + Math.floor(index / 3) * 14} width="9" height="13" rx="2" fill="#d1fae5" /><text x={86.5 + (index % 3) * 10} y={33 + Math.floor(index / 3) * 14} textAnchor="middle" fontSize="6" fill="#047857">{value}</text></g>) : values.map((value, index) => <rect key={`o-${value}`} x={79 + index * 6} y="33" width="5" height="11" rx="1" fill="#d1fae5" stroke="#34d399" />)}
    {animated && <circle r="2.5" fill="#f97316"><animateMotion path="M15 28 C55 7 70 66 95 38" dur="1.8s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function Softmax({ animated }) {
  const logits = [2, 1, 0];
  const probs = [67, 24, 9];
  return <Svg>{logits.map((value, index) => <g key={value}><rect x="6" y={9 + index * 20} width="24" height="15" rx="4" fill="#dbeafe" /><text x="18" y={20 + index * 20} textAnchor="middle" fontSize="8" fontWeight="800" fill="#1d4ed8">{value}</text></g>)}{arrow(33, 38, 51, 38)}<text x="58" y="42" textAnchor="middle" fontSize="10" fontWeight="800" fill="#7c3aed">eᶻ/Σ</text>
    {probs.map((value, index) => <g key={value}><rect x={76 + index * 13} y={67 - value * 0.65} width="10" height={value * 0.65} rx="3" fill={['#3b82f6', '#8b5cf6', '#10b981'][index]}>{animated && <animate attributeName="height" values={`2;${value * 0.65};${value * 0.65}`} dur={`${1.5 + index * 0.2}s`} repeatCount="indefinite" />}</rect><text x={81 + index * 13} y="74" textAnchor="middle" fontSize="6" fill="#64748b">{value}%</text></g>)}
  </Svg>;
}

function Dropout({ animated }) {
  const nodes = Array.from({ length: 8 }, (_, index) => ({ x: 13 + index * 13, y: 38 + (index % 2 ? 10 : -10) }));
  return <Svg>{nodes.map(({ x, y }, index) => <g key={index}><circle cx={x} cy={y} r="6" fill={index % 3 === 1 ? '#e2e8f0' : '#3b82f6'} opacity={index % 3 === 1 ? 0.45 : 1}>{animated && index % 3 === 1 && <animate attributeName="opacity" values="1;0.15;1" dur={`${1.3 + index * 0.1}s`} repeatCount="indefinite" />}</circle>{index % 3 === 1 && <path d={`M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`} stroke="#ef4444" strokeWidth="2" />}</g>)}<text x="60" y="68" textAnchor="middle" fontSize="8" fontWeight="800" fill="#64748b">m ⊙ x /(1−p)</text></Svg>;
}

function Normalize({ variant, animated }) {
  if (variant === 'batch_norm2d') return <Svg>{[0, 1, 2].map((channel) => <g key={channel}><rect x={8 + channel * 25} y={13 + channel * 3} width="30" height="38" rx="5" fill={['#fee2e2', '#dbeafe', '#dcfce7'][channel]} stroke={['#f87171', '#60a5fa', '#4ade80'][channel]} /><text x={23 + channel * 25} y={35 + channel * 3} textAnchor="middle" fontSize="8" fontWeight="800" fill="#334155">C{channel + 1}</text></g>)}{arrow(83, 38, 101, 38)}<text x="108" y="34" textAnchor="middle" fontSize="7" fill="#64748b">μC=0</text><text x="108" y="45" textAnchor="middle" fontSize="7" fill="#64748b">σC=1</text></Svg>;
  const rows = variant === 'layer_norm' ? [[12, 31, 22, 53], [62, 45, 70, 55]] : [[14, 19, 22, 27], [48, 57, 63, 70]];
  return <Svg>{rows.flatMap((row, rowIndex) => row.map((x, index) => <circle key={`${rowIndex}-${index}`} cx={x} cy={25 + rowIndex * 26} r="4" fill={rowIndex ? '#8b5cf6' : '#3b82f6'}>{animated && <animate attributeName="cx" values={`${x};${22 + index * 12};${22 + index * 12}`} dur="2s" repeatCount="indefinite" />}</circle>))}<path d="M10 64 H80" stroke="#cbd5e1" /><text x="99" y="30" textAnchor="middle" fontSize="8" fontWeight="800" fill="#047857">μ→0</text><text x="99" y="47" textAnchor="middle" fontSize="8" fontWeight="800" fill="#047857">σ→1</text></Svg>;
}

function Embedding({ animated }) {
  const rows = [[.2, -.7, .4], [.8, .1, -.3], [-.4, .6, .9]];
  return <Svg><rect x="5" y="25" width="25" height="26" rx="6" fill="#dbeafe" /><text x="17.5" y="42" textAnchor="middle" fontSize="10" fontWeight="800" fill="#1d4ed8">id 42</text>{arrow(32, 38, 47, 38)}{rows.map((row, r) => row.map((value, c) => <rect key={`${r}-${c}`} x={53 + c * 17} y={10 + r * 18} width="15" height="16" rx="3" fill={r === 1 ? '#c4b5fd' : '#ede9fe'} stroke="#8b5cf6" />))}<rect x="51" y="27" width="53" height="20" rx="4" fill="none" stroke="#f97316" strokeWidth="3">{animated && <animate attributeName="y" values="9;27;45;27" dur="2.2s" repeatCount="indefinite" />}</rect></Svg>;
}

function Recurrent({ gru, animated }) {
  return <Svg><path d="M8 20 H111" stroke="#8b5cf6" strokeWidth="4" strokeLinecap="round" />
    {[18, 52, 86].map((x, index) => <g key={x}><rect x={x - 10} y="33" width="28" height="27" rx="7" fill="#dbeafe" stroke="#3b82f6" /><text x={x + 4} y="50" textAnchor="middle" fontSize="8" fontWeight="800" fill="#1e40af">{gru ? (index === 0 ? 'rₜ' : index === 1 ? 'zₜ' : 'hₜ') : (index === 0 ? 'fₜ' : index === 1 ? 'iₜ' : 'oₜ')}</text><path d={`M${x + 4} 33 V22`} stroke="#64748b" strokeWidth="2" /></g>)}
    {!gru && <text x="60" y="15" textAnchor="middle" fontSize="8" fontWeight="800" fill="#6d28d9">cₜ₋₁ → cₜ</text>}
    {gru && <path d="M17 60 C35 75 73 75 95 60" fill="none" stroke="#10b981" strokeWidth="2" />}
    {animated && <circle cy="20" r="4" fill="#f97316"><animate attributeName="cx" values="8;42;76;111" dur="2.3s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function Attention({ animated }) {
  return <Svg>{['Q', 'K', 'V'].map((label, index) => <g key={label}><rect x={4 + index * 25} y="6" width="20" height="17" rx="5" fill={index === 2 ? '#ddd6fe' : '#dbeafe'} /><text x={14 + index * 25} y="18" textAnchor="middle" fontSize="9" fontWeight="800" fill="#334155">{label}</text></g>)}
    <path d="M14 24 L48 35 M39 24 L48 35" stroke="#64748b" strokeWidth="2" /><rect x="35" y="34" width="29" height="18" rx="5" fill="#2563eb" /><text x="49.5" y="46" textAnchor="middle" fontSize="7" fontWeight="800" fill="white">QKᵀ/√d</text>
    {arrow(66, 43, 80, 43)}<rect x="84" y="31" width="31" height="26" rx="6" fill="#8b5cf6" /><text x="99.5" y="42" textAnchor="middle" fontSize="7" fontWeight="800" fill="white">softmax</text><text x="99.5" y="51" textAnchor="middle" fontSize="7" fontWeight="800" fill="white">× V</text>
    {animated && <circle r="3" fill="#f97316"><animateMotion path="M14 24 L48 35 L64 43 L99 43" dur="1.8s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function Merge({ concatenate, animated }) {
  const leftA = concatenate ? '[a,b]' : '[1,2]';
  const leftB = concatenate ? '[c,d]' : '[3,4]';
  const result = concatenate ? '[a,b,c,d]' : '[4,6]';
  return <Svg>{[leftA, leftB].map((label, index) => <g key={label}><rect x="5" y={11 + index * 34} width="35" height="23" rx="6" fill={index ? '#ede9fe' : '#dbeafe'} /><text x="22.5" y={26 + index * 34} textAnchor="middle" fontSize="8" fontWeight="800" fill="#334155">{label}</text></g>)}<path d="M41 22 C55 22 52 38 65 38 M41 56 C55 56 52 38 65 38" fill="none" stroke="#64748b" strokeWidth="2" /><circle cx="69" cy="38" r="10" fill="#2563eb" /><text x="69" y="42" textAnchor="middle" fontSize="12" fontWeight="800" fill="white">{concatenate ? '‖' : '+'}</text>{arrow(80, 38, 91, 38)}<text x="106" y="42" textAnchor="middle" fontSize={concatenate ? 7 : 9} fontWeight="800" fill="#047857">{result}</text>{animated && <circle cx="69" cy="38" r="13" fill="none" stroke="#f97316"><animate attributeName="r" values="9;14;9" dur="1.5s" repeatCount="indefinite" /></circle>}</Svg>;
}

function Loss({ kind, animated }) {
  if (kind === 'mse_loss') {
    const geometry = mseLandscapeGeometry();
    return <Svg><path d={geometry.path} fill="none" stroke="#2563eb" strokeWidth="4" /><line x1={geometry.example.x} y1={geometry.example.y} x2={geometry.example.x} y2="20" stroke="#f97316" strokeWidth="4" strokeLinecap="round">{animated && <animate attributeName="y2" values={`${geometry.example.y};20;${geometry.example.y}`} dur="2s" repeatCount="indefinite" />}</line><text x={geometry.example.x} y="15" textAnchor="middle" fontSize="8" fill="#c2410c">e²</text><circle cx={geometry.minimum.x} cy={geometry.minimum.y} r="4" fill="#10b981" /></Svg>;
  }
  if (kind === 'cross_entropy_loss') return <Svg><path d="M10 10 C35 14 52 30 65 47 C77 61 92 67 111 69" fill="none" stroke="#ef4444" strokeWidth="4" /><text x="58" y="17" textAnchor="middle" fontSize="9" fontWeight="800" fill="#64748b">−log pᵧ</text><circle cx="10" cy="10" r="5" fill="#2563eb">{animated && <animateMotion path="M0 0 C25 4 42 20 55 37 C67 51 82 57 101 59" dur="2.4s" repeatCount="indefinite" />}</circle></Svg>;
  return <Svg><path d="M8 8 C27 20 48 51 112 68" fill="none" stroke="#3b82f6" strokeWidth="4" /><path d="M8 68 C72 51 93 20 112 8" fill="none" stroke="#f97316" strokeWidth="4" /><text x="25" y="18" textAnchor="middle" fontSize="8" fontWeight="800" fill="#1d4ed8">y=1</text><text x="95" y="18" textAnchor="middle" fontSize="8" fontWeight="800" fill="#c2410c">y=0</text>{animated && <line x1="60" y1="8" x2="60" y2="68" stroke="#10b981" strokeWidth="2"><animate attributeName="x1" values="20;100;20" dur="2.4s" repeatCount="indefinite" /><animate attributeName="x2" values="20;100;20" dur="2.4s" repeatCount="indefinite" /></line>}</Svg>;
}

function Composite({ kind, animated }) {
  const blocks = kind === 'conv_block' ? ['K', 'μσ', 'ReLU', 'max'] : kind === 'residual_mlp_block' ? ['x', 'F(x)', '+'] : kind === 'mlp_block' ? ['W', 'ReLU', 'mask'] : ['A', 'B', 'C'];
  return <Svg>{blocks.map((label, index) => <g key={label}><rect x={4 + index * (kind === 'conv_block' ? 29 : 38)} y="25" width={kind === 'conv_block' ? 24 : 30} height="27" rx="7" fill={index % 2 ? '#dbeafe' : '#ede9fe'} /><text x={16 + index * (kind === 'conv_block' ? 29 : 38)} y="42" textAnchor="middle" fontSize="7" fontWeight="800" fill="#334155">{label}</text>{index < blocks.length - 1 && <path d={`M${28 + index * (kind === 'conv_block' ? 29 : 38)} 38 H${33 + index * (kind === 'conv_block' ? 29 : 38)}`} stroke="#64748b" strokeWidth="2" />}</g>)}
    {kind === 'residual_mlp_block' && <path d="M19 25 C24 5 86 5 94 25" fill="none" stroke="#f97316" strokeWidth="3" />}
    {animated && <circle cy="38" r="3" fill="#10b981"><animate attributeName="cx" values="16;50;88;112" dur="2.1s" repeatCount="indefinite" /></circle>}
  </Svg>;
}

function Unknown({ animated }) {
  return <Composite kind="custom_composite" animated={animated} />;
}

export default function VisualGlyph({ kind, animated = false, className = '' }) {
  let visual;
  if (['relu', 'gelu', 'sigmoid', 'tanh'].includes(kind)) visual = <Activation op={kind} animated={animated} />;
  else {
    switch (kind) {
      case 'tabular_data': visual = <Table animated={animated} />; break;
      case 'train_test_split': visual = <Split animated={animated} />; break;
      case 'linear_regression': visual = <LinearRegression animated={animated} />; break;
      case 'knn_classifier': visual = <Knn animated={animated} />; break;
      case 'gradient_descent': visual = <Descent variant={kind} animated={animated} />; break;
      case 'evaluate_regression': visual = <Evaluation animated={animated} />; break;
      case 'evaluate_classification': visual = <Evaluation classification animated={animated} />; break;
      case 'interactive_predictor': visual = <Predictor animated={animated} />; break;
      case 'tensor_input': visual = <TensorInput animated={animated} />; break;
      case 'model_output': visual = <ModelOutput animated={animated} />; break;
      case 'dense': visual = <Dense animated={animated} />; break;
      case 'conv2d': visual = <Conv animated={animated} />; break;
      case 'max_pool2d': visual = <Pool animated={animated} />; break;
      case 'flatten': visual = <Shape animated={animated} />; break;
      case 'reshape': visual = <Shape reshape animated={animated} />; break;
      case 'softmax': visual = <Softmax animated={animated} />; break;
      case 'dropout': visual = <Dropout animated={animated} />; break;
      case 'batch_norm1d': visual = <Normalize variant={kind} animated={animated} />; break;
      case 'batch_norm2d': visual = <Normalize variant={kind} animated={animated} />; break;
      case 'layer_norm': visual = <Normalize variant={kind} animated={animated} />; break;
      case 'embedding': visual = <Embedding animated={animated} />; break;
      case 'lstm': visual = <Recurrent animated={animated} />; break;
      case 'gru': visual = <Recurrent gru animated={animated} />; break;
      case 'multihead_attention': visual = <Attention animated={animated} />; break;
      case 'add': visual = <Merge animated={animated} />; break;
      case 'concatenate': visual = <Merge concatenate animated={animated} />; break;
      case 'mse_loss': visual = <Loss kind={kind} animated={animated} />; break;
      case 'cross_entropy_loss': visual = <Loss kind={kind} animated={animated} />; break;
      case 'binary_cross_entropy_loss': visual = <Loss kind={kind} animated={animated} />; break;
      case 'sgd_optimizer': visual = <Descent variant={kind} animated={animated} />; break;
      case 'adam_optimizer': visual = <Descent variant={kind} animated={animated} />; break;
      case 'adamw_optimizer': visual = <Descent variant={kind} animated={animated} />; break;
      case 'mlp_block': visual = <Composite kind={kind} animated={animated} />; break;
      case 'conv_block': visual = <Composite kind={kind} animated={animated} />; break;
      case 'residual_mlp_block': visual = <Composite kind={kind} animated={animated} />; break;
      case 'custom_composite': visual = <Composite kind={kind} animated={animated} />; break;
      default: visual = <Unknown animated={animated} />;
    }
  }
  return <div className={`overflow-hidden ${className}`}>{visual}</div>;
}
