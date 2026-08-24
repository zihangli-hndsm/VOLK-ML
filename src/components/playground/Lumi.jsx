import { normalizeLumiMode, normalizeLumiPresence } from '../../core/ui/lumiSemantics.js';

// Literal URL references let Vite fingerprint and rewrite these assets for
// both the root app and GitHub Pages' relative `base: './'` deployment. Keep
// the paths literal so Vite does not leave an incorrect runtime traversal.
const idleAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-idle.svg' : new URL('../../assets/lumi/lumi-idle.svg', import.meta.url).href;
const observeAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-observe.svg' : new URL('../../assets/lumi/lumi-observe.svg', import.meta.url).href;
const guideAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-guide.svg' : new URL('../../assets/lumi/lumi-guide.svg', import.meta.url).href;
const illuminateAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-illuminate.svg' : new URL('../../assets/lumi/lumi-illuminate.svg', import.meta.url).href;

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
