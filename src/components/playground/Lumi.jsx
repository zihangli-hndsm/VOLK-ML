import { normalizeLumiMode, normalizeLumiPresence } from '../../core/ui/lumiSemantics.js';

const resolveAsset = (path) => typeof document === 'undefined' ? path : new URL(path, import.meta.url).href;
const idleAsset = resolveAsset('../../assets/lumi/lumi-idle.svg');
const observeAsset = resolveAsset('../../assets/lumi/lumi-observe.svg');
const guideAsset = resolveAsset('../../assets/lumi/lumi-guide.svg');
const illuminateAsset = resolveAsset('../../assets/lumi/lumi-illuminate.svg');

const MODE_LABELS = Object.freeze({
  idle: 'idle',
  observe: 'observe',
  guide: 'guide',
  intervene: 'intervene',
  illuminate: 'illuminate',
  explore: 'explore',
});

const MODE_ASSETS = Object.freeze({
  idle: idleAsset,
  observe: observeAsset,
  guide: guideAsset,
  intervene: guideAsset,
  illuminate: illuminateAsset,
  explore: guideAsset,
});

export default function Lumi({ mode = 'idle', presence = 'ambient', label, onClick, className = '' }) {
  const normalizedPresence = normalizeLumiPresence(presence);
  if (normalizedPresence === 'hidden') return null;
  const normalizedMode = normalizeLumiMode(mode);
  const content = <span className={`lumi lumi-${normalizedPresence} lumi-${normalizedMode} ${className}`.trim()} data-lumi-presence={normalizedPresence} data-lumi-mode={normalizedMode} data-lumi-asset={normalizedMode} aria-hidden={onClick ? undefined : 'true'}>
    <img className="lumi-visual" src={MODE_ASSETS[normalizedMode]} alt={onClick ? label : ''} draggable="false" />
    {(normalizedMode === 'intervene' || normalizedMode === 'illuminate') && <span className="lumi-pulse" aria-hidden="true" />}
    {onClick && <span className="sr-only">{label}</span>}
  </span>;
  return onClick
    ? <button type="button" className="lumi-button" onClick={onClick} aria-label={label}>{content}</button>
    : content;
}

export { MODE_ASSETS, MODE_LABELS };
