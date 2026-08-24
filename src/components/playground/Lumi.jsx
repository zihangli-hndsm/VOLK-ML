import { normalizeLumiMode, normalizeLumiPresence } from '../../core/ui/lumiSemantics.js';

const MODE_LABELS = Object.freeze({
  idle: 'idle',
  observe: 'observe',
  guide: 'guide',
  intervene: 'intervene',
  illuminate: 'illuminate',
});

export default function Lumi({ mode = 'idle', presence = 'ambient', label, onClick, className = '' }) {
  const normalizedPresence = normalizeLumiPresence(presence);
  if (normalizedPresence === 'hidden') return null;
  const normalizedMode = normalizeLumiMode(mode);
  const content = <span className={`lumi lumi-${normalizedPresence} lumi-${normalizedMode} ${className}`.trim()} data-lumi-presence={normalizedPresence} data-lumi-mode={normalizedMode} aria-hidden={onClick ? undefined : 'true'}>
    <svg viewBox="0 0 96 88" role="img" aria-label={onClick ? label : undefined} focusable="false">
      <ellipse className="lumi-wing lumi-wing-left" cx="20" cy="47" rx="18" ry="24" />
      <ellipse className="lumi-wing lumi-wing-right" cx="76" cy="47" rx="18" ry="24" />
      <path className="lumi-antenna" d="M35 25C32 13 28 9 20 8M61 25C64 13 68 9 76 8" />
      <circle className="lumi-antenna-tip" cx="20" cy="8" r="4" />
      <circle className="lumi-antenna-tip" cx="76" cy="8" r="4" />
      <ellipse className="lumi-body" cx="48" cy="49" rx="24" ry="29" />
      <ellipse className="lumi-core" cx="48" cy="58" rx="12" ry="14" />
      <circle className="lumi-eye" cx="40" cy="42" r="5" />
      <circle className="lumi-eye" cx="56" cy="42" r="5" />
      <path className="lumi-smile" d="M43 51C46 54 50 54 53 51" />
      <path className="lumi-branch" d="M48 55V68M48 61L43 58M48 61L53 58" />
      <circle className="lumi-pulse" cx="48" cy="68" r="3" />
    </svg>
    {onClick && <span className="sr-only">{label}</span>}
  </span>;
  return onClick
    ? <button type="button" className="lumi-button" onClick={onClick} aria-label={label}>{content}</button>
    : content;
}

export { MODE_LABELS };
