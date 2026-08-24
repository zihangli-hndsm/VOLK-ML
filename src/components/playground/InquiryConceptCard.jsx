import React, { useState } from 'react';
import InstructionalAnnotationSurface from './InstructionalAnnotationSurface.jsx';

export default function InquiryConceptCard({ card, onDismiss, onOpenEvidence, agent, onAskAbout, t }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!card) return null;
  return <InstructionalAnnotationSurface surface="inquiry-card" contentId={`inquiry-${card.conceptId}`} messageId={`inquiry-${card.conceptId}`} localizationKey={card.titleKey} agent={agent} onAskAbout={onAskAbout} t={t}>
    <section data-ui-inquiry-concept-card="true" data-concept-state="active" className="rounded-2xl border border-purple-200 bg-purple-50/70 p-3 text-sm text-purple-950" aria-label={t('playground.inquiry.card.ariaLabel')}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-wide text-purple-700">{t('playground.inquiry.card.eyebrow')}</p>
        <h3 className="mt-1 text-base font-black">{t(card.titleKey)}</h3>
      </div>
      <button type="button" aria-label={t('playground.inquiry.card.dismiss')} onClick={onDismiss} className="ui-motion-interactive min-h-10 rounded-xl px-2 text-xs font-black text-purple-800 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500">{t('playground.inquiry.card.dismiss')}</button>
    </div>
    <p className="mt-2 text-xs">{t(card.summaryKey)}</p>
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-purple-700">{t('playground.inquiry.card.whyNow')}</p>
    <ul className="mt-1 list-inside list-disc space-y-1 text-xs">{card.whyKeys.map((key) => <li key={key}>{t(key)}</li>)}</ul>
    <details className="mt-3">
      <summary onClick={() => setDetailsOpen(!detailsOpen)} className="cursor-pointer rounded-lg text-xs font-black text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500">{t('playground.inquiry.card.deeper')}</summary>
      {detailsOpen && <p className="mt-1 text-xs text-blue-900">{t('playground.inquiry.card.deeperBody')}</p>}
    </details>
    {card.action && <button type="button" onClick={onOpenEvidence} className="ui-motion-interactive mt-3 rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-800 ring-1 ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500">{t(card.action.labelKey)}</button>}
    </section>
  </InstructionalAnnotationSurface>;
}
