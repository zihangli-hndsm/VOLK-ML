import { useEffect, useMemo, useState } from 'react';
import { deriveLumiShowcaseStage, lumiTargetKey } from '../../core/ui/lumiInteraction.js';
import Lumi from './Lumi.jsx';

function targetLabel(target, t) {
  if (target?.type === 'evidence') return t('playground.lumi.target.evidence');
  if (target?.type === 'concept') return t('playground.lumi.target.concept');
  return t('playground.lumi.target.experiment');
}

export default function LumiAttentionRail({ snapshot, attention, activeDepth, illuminatedConceptIds = [], onOpenEvidence, t }) {
  const [acknowledgedKey, setAcknowledgedKey] = useState(null);
  const attentionKey = [
    lumiTargetKey(attention?.evidenceTarget),
    lumiTargetKey(attention?.conceptTarget),
    lumiTargetKey(attention?.interventionTarget),
    attention?.interventionControlKey ?? '',
  ].join('|');
  useEffect(() => setAcknowledgedKey(null), [attentionKey]);
  const stage = useMemo(() => deriveLumiShowcaseStage({ attention, illuminatedConceptIds }), [attention, illuminatedConceptIds]);
  const hasAttention = Boolean(attention?.evidenceTarget || attention?.conceptTarget || attention?.interventionTarget);
  if (!hasAttention) return null;
  const connectionVisible = Boolean(attention.connection && activeDepth !== 'evidence' && stage !== 'understand' && acknowledgedKey !== attentionKey);
  const acknowledgeEvidence = () => {
    setAcknowledgedKey(attentionKey);
    onOpenEvidence?.();
  };
  const showcase = snapshot?.bigIdea?.id === 'distribution-shift';
  return <section data-lumi-interaction-rail="true" data-lumi-stage={stage} className="lumi-attention-rail rounded-2xl border border-cyan-100 bg-white/90 p-3 shadow-sm" aria-label={t('playground.lumi.attention.ariaLabel')}>
    <div className="flex items-center gap-2">
      <Lumi presence="contextual" mode={attention.mode} />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wider text-cyan-700">{t('playground.lumi.name')}</p>
        <p className="text-xs font-black text-slate-800">{t(attention.interventionTarget ? 'playground.lumi.attention.intervention' : 'playground.lumi.attention.lookHere')}</p>
      </div>
    </div>
    {(attention.evidenceTarget || attention.conceptTarget) && <div className={`lumi-attention-path mt-3 ${connectionVisible ? 'lumi-attention-path-connected' : 'lumi-attention-path-settled'}`}>
      {attention.evidenceTarget && <button type="button" data-lumi-target={`evidence:${attention.evidenceTarget.id}`} onClick={acknowledgeEvidence} className="lumi-target-chip lumi-target-evidence rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-left text-xs font-black text-cyan-950 focus:outline-none focus:ring-2 focus:ring-cyan-500">
        <span className="block text-[10px] uppercase tracking-wide text-cyan-700">{targetLabel(attention.evidenceTarget, t)}</span>
        <span>{t('playground.lumi.attention.evidenceHint')}</span>
      </button>}
      {connectionVisible && <span className="lumi-target-connection" aria-hidden="true"><Lumi presence="event" mode="explore" /></span>}
      {attention.conceptTarget && <span data-lumi-target={`concept:${attention.conceptTarget.id}`} className="lumi-target-chip lumi-target-concept rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-black text-purple-950">
        <span className="block text-[10px] uppercase tracking-wide text-purple-700">{targetLabel(attention.conceptTarget, t)}</span>
        <span>{t('playground.lumi.attention.conceptHint')}</span>
      </span>}
    </div>}
    {attention.interventionTarget && <span data-lumi-target={`experiment:${attention.interventionTarget.id}`} data-lumi-control={attention.interventionControlKey ?? undefined} className="mt-3 block rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black text-orange-950">
      {t('playground.lumi.attention.controlChanged')}
    </span>}
    {showcase && <div data-lumi-showcase="distribution-shift" className="mt-3 flex flex-wrap items-center gap-1 text-[10px] font-black uppercase tracking-wide">
      {['observe', 'intervene', 'understand'].map((item, index) => <span key={item} className={`rounded-full px-2 py-1 ${stage === item ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{index + 1}. {t(`playground.lumi.showcase.${item}`)}</span>)}
    </div>}
  </section>;
}
