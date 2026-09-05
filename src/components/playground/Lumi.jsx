import { normalizeLumiMode, normalizeLumiPresence } from '../../core/ui/lumiSemantics.js';

// Literal URL references let Vite fingerprint and rewrite these assets for
// both the root app and GitHub Pages' relative `base: './'` deployment. Keep
// the paths literal so Vite does not leave an incorrect runtime traversal.
const ambientAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-ambient.png' : new URL('../../assets/lumi/lumi-ambient.png', import.meta.url).href;
const observeAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-observe.png' : new URL('../../assets/lumi/lumi-observe.png', import.meta.url).href;
const thinkAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-think.png' : new URL('../../assets/lumi/lumi-think.png', import.meta.url).href;
const guideAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-guide.png' : new URL('../../assets/lumi/lumi-guide.png', import.meta.url).href;
const illuminateAsset = typeof document === 'undefined' ? '../../assets/lumi/lumi-illuminate.png' : new URL('../../assets/lumi/lumi-illuminate.png', import.meta.url).href;

const MODE_LABELS = Object.freeze({
  idle: 'idle',
  observe: 'observe',
  guide: 'guide',
  intervene: 'intervene',
  illuminate: 'illuminate',
  explore: 'explore',
  think: 'think',
});

const MODE_ASSETS = Object.freeze({
  idle: ambientAsset,
  observe: observeAsset,
  guide: guideAsset,
  intervene: guideAsset,
  illuminate: illuminateAsset,
  explore: guideAsset,
  think: thinkAsset,
});

export default function Lumi({ mode = 'idle', presence = 'ambient', label, onClick, className = '', expanded = undefined }) {
  const normalizedPresence = normalizeLumiPresence(presence);
  if (normalizedPresence === 'hidden') return null;
  const normalizedMode = normalizeLumiMode(mode);
  const content = <span className={`lumi lumi-${normalizedPresence} lumi-${normalizedMode} ${className}`.trim()} data-lumi-presence={normalizedPresence} data-lumi-mode={normalizedMode} data-lumi-asset={normalizedMode} aria-hidden={onClick ? undefined : 'true'}>
    <img className="lumi-visual" src={MODE_ASSETS[normalizedMode]} alt={onClick ? label : ''} draggable="false" />
    {(normalizedMode === 'intervene' || normalizedMode === 'illuminate') && <span className="lumi-pulse" aria-hidden="true" />}
    {onClick && <span className="sr-only">{label}</span>}
  </span>;
  return onClick
    ? <button type="button" className="lumi-button" onClick={onClick} aria-label={label} aria-expanded={expanded}>{content}</button>
    : content;
}

export { MODE_ASSETS, MODE_LABELS };
