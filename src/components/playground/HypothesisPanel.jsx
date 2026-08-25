import { useState } from 'react';
import { getInquiryConcept } from '../../core/exploration/learnerInquiry.js';
import { HYPOTHESIS_STATUSES } from '../../core/exploration/hypothesis.js';
import Lumi from './Lumi.jsx';

function conceptTitle(id, t) {
  const concept = getInquiryConcept(id);
  return concept?.titleKey ? t(concept.titleKey) : id;
}

function evidenceLabel(id, snapshot, t) {
  const observation = (snapshot?.observations ?? []).find((item) => String(item?.id ?? '') === String(id) || String(item?.reasonCode ?? '') === String(id));
  return observation?.messageKey ? t(observation.messageKey) : id;
}

function statusClass(status) {
  if (status === HYPOTHESIS_STATUSES.TESTING) return 'hypothesis-status-testing';
  if (status === HYPOTHESIS_STATUSES.SUPPORTED) return 'hypothesis-status-supported';
  if (status === HYPOTHESIS_STATUSES.REJECTED) return 'hypothesis-status-rejected';
  return 'hypothesis-status-proposed';
}

function HypothesisCard({ hypothesis, snapshot, selected, t, onSelect, onSetStatus, onAttachEvidence, onOpenEvidence, onOpenExperiment }) {
  const canAttach = Boolean(snapshot?.observations?.length);
  return <article data-hypothesis-card={hypothesis.id} className={`hypothesis-card ${selected ? 'hypothesis-card-selected' : ''}`}>
    <button type="button" className="hypothesis-card-heading focus:outline-none focus:ring-2 focus:ring-purple-500" onClick={() => onSelect?.(hypothesis.id)} aria-pressed={selected}>
      <span className="hypothesis-card-marker" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-black text-slate-950">{hypothesis.statement}</span>
        <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusClass(hypothesis.status)}`}>{t(`playground.hypothesis.status.${hypothesis.status}`)}</span>
      </span>
    </button>
    <div className="mt-3 space-y-2 pl-4">
      {hypothesis.linkedConceptIds.length > 0 && <div>
        <p className="hypothesis-section-label">{t('playground.hypothesis.linkedConcepts')}</p>
        <div className="flex flex-wrap gap-1">{hypothesis.linkedConceptIds.map((id) => <span key={id} className="rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-bold text-purple-900">{conceptTitle(id, t)}</span>)}</div>
      </div>}
      <div>
        <p className="hypothesis-section-label">{t('playground.hypothesis.evidence')}</p>
        {hypothesis.evidenceIds.length > 0
          ? <ul className="space-y-1 text-xs text-slate-700">{hypothesis.evidenceIds.map((id) => <li key={id} className="rounded-lg bg-cyan-50 px-2 py-1">{evidenceLabel(id, snapshot, t)}</li>)}</ul>
          : <p className="text-xs text-slate-500">{t('playground.hypothesis.noEvidence')}</p>}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {hypothesis.status === HYPOTHESIS_STATUSES.PROPOSED && <button type="button" onClick={() => { onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.TESTING); onOpenExperiment?.(); }} className="hypothesis-action hypothesis-action-primary">{t('playground.hypothesis.startTesting')}</button>}
        <button type="button" disabled={!canAttach} onClick={() => onAttachEvidence?.(hypothesis.id)} className="hypothesis-action hypothesis-action-cyan disabled:cursor-not-allowed disabled:opacity-50">{t('playground.hypothesis.attachEvidence')}</button>
        <button type="button" onClick={onOpenEvidence} className="hypothesis-action hypothesis-action-neutral">{t('playground.hypothesis.reviewEvidence')}</button>
        {hypothesis.status === HYPOTHESIS_STATUSES.TESTING && <>
          <button type="button" onClick={() => onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.SUPPORTED)} className="hypothesis-action hypothesis-action-cyan">{t('playground.hypothesis.markSupported')}</button>
          <button type="button" onClick={() => onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.REJECTED)} className="hypothesis-action hypothesis-action-neutral">{t('playground.hypothesis.markRejected')}</button>
        </>}
      </div>
    </div>
  </article>;
}

export default function HypothesisPanel({ attention, graph, snapshot, hypotheses = [], compact = false, t, onCreate, onSetStatus, onAttachEvidence, onOpenEvidence, onOpenExperiment, onSelectHypothesis }) {
  const [statement, setStatement] = useState('');
  const prompt = attention?.hypothesisPrompt;
  if (!prompt && hypotheses.length === 0) return null;
  const create = () => {
    const created = onCreate?.({ statement, linkedConceptIds: [prompt?.conceptId].filter(Boolean) });
    if (created) setStatement('');
  };
  return <section data-hypothesis-panel="true" className={`hypothesis-panel rounded-2xl border border-purple-200 bg-white p-3 ${compact ? 'hypothesis-panel-compact' : ''}`} aria-label={t('playground.hypothesis.ariaLabel')}>
    <div className="flex items-center gap-2">
      <Lumi presence="contextual" mode="explore" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide text-purple-700">{t('playground.hypothesis.kicker')}</p>
        <h3 className="text-sm font-black text-slate-950">{t('playground.hypothesis.title')}</h3>
      </div>
    </div>
    {prompt && <div className="hypothesis-composer mt-3 rounded-xl border border-purple-200 bg-purple-50/60 p-3">
      <p className="text-xs font-bold text-purple-950">{t('playground.hypothesis.prompt')}</p>
      <label className="mt-2 block text-[11px] font-black text-slate-700" htmlFor="hypothesis-statement">{t('playground.hypothesis.statementLabel')}</label>
      <textarea id="hypothesis-statement" value={statement} maxLength={240} onChange={(event) => setStatement(event.target.value)} placeholder={t('playground.hypothesis.statementPlaceholder')} className="mt-1 min-h-20 w-full resize-y rounded-xl border border-purple-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-purple-800">{t('playground.hypothesis.linkedConceptHint', { concept: conceptTitle(prompt.conceptId, t) })}</span>
        <button type="button" disabled={!statement.trim()} onClick={create} className="rounded-xl bg-purple-700 px-3 py-2 text-xs font-black text-white hover:bg-purple-800 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50">{t('playground.hypothesis.create')}</button>
      </div>
    </div>}
    {hypotheses.length > 0 && <div className="mt-3 space-y-2" role="list" aria-label={t('playground.hypothesis.listLabel')}>
      {hypotheses.map((hypothesis) => <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} snapshot={snapshot} selected={graph?.selectedHypothesisId === hypothesis.id} t={t} onSelect={onSelectHypothesis} onSetStatus={onSetStatus} onAttachEvidence={onAttachEvidence} onOpenEvidence={onOpenEvidence} onOpenExperiment={onOpenExperiment} />)}
    </div>}
    <p className="mt-3 text-[11px] text-slate-500">{t('playground.hypothesis.boundary')}</p>
  </section>;
}
