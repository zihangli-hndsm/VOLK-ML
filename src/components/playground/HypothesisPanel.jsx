import { useState } from 'react';
import { getInquiryConcept } from '../../core/exploration/learnerInquiry.js';
import { getEvidenceInstance } from '../../core/exploration/evidenceProvenance.js';
import { HYPOTHESIS_PREDICTION_CHOICES, HYPOTHESIS_STATUSES } from '../../core/exploration/hypothesis.js';
import Lumi from './Lumi.jsx';
import TestDesigner from './TestDesigner.jsx';

function conceptTitle(id, t) {
  const concept = getInquiryConcept(id);
  return concept?.titleKey ? t(concept.titleKey) : id;
}

function evidenceProvenance(instance, t) {
  const experiment = instance.experimentIds.length
    ? instance.experimentIds.join(', ')
    : t('playground.hypothesis.unknownExperiment');
  return <span className="hypothesis-evidence-provenance">
    <span className="block">{instance.messageKey ? t(instance.messageKey) : instance.reasonCode}</span>
    <span className="block text-[10px] text-slate-500">{t('playground.hypothesis.evidenceExperiment', { experiment })}</span>
    {instance.semanticSequence && <span className="block text-[10px] text-slate-500">{t('playground.hypothesis.evidenceSequence', { sequence: instance.semanticSequence })}</span>}
  </span>;
}

function statusClass(status) {
  if (status === HYPOTHESIS_STATUSES.TESTING) return 'hypothesis-status-testing';
  if (status === HYPOTHESIS_STATUSES.SUPPORTED) return 'hypothesis-status-supported';
  if (status === HYPOTHESIS_STATUSES.REJECTED) return 'hypothesis-status-rejected';
  if (status === HYPOTHESIS_STATUSES.REVISED) return 'hypothesis-status-revised';
  return 'hypothesis-status-proposed';
}

function HypothesisCard({ hypothesis, evidenceInstances, selected, t, onSelect, onSetStatus, onOpenPicker, onOpenEvidence, onOpenExperiment, onDesignTest, testDesigns = [], testDesignResults = {}, onRunTestDesign }) {
  const canAttach = evidenceInstances.some((instance) => instance.available);
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
        {hypothesis.prediction?.choice && <div className="rounded-lg border border-orange-100 bg-orange-50 px-2 py-2 text-xs text-orange-950">
          <span className="font-black">{t('playground.hypothesis.predictionLabel')}: </span>
          {t(`playground.hypothesis.predictionChoice.${hypothesis.prediction.choice}`)}
        </div>}
        {(hypothesis.experimentId || hypothesis.threadId) && <p className="mt-2 text-[10px] text-slate-500">
          {hypothesis.experimentId && t('playground.hypothesis.lineageExperiment', { experiment: hypothesis.experimentId })}
          {hypothesis.experimentId && hypothesis.threadId ? ' · ' : ''}
          {hypothesis.threadId && t('playground.hypothesis.lineageThread', { thread: hypothesis.threadId })}
        </p>}
      </div>
      <div>
        <p className="hypothesis-section-label">{t('playground.hypothesis.evidence')}</p>
        {hypothesis.evidenceIds.length > 0
          ? <ul className="space-y-1 text-xs text-slate-700">{hypothesis.evidenceIds.map((id) => {
            const instance = getEvidenceInstance(evidenceInstances, id);
            return <li key={id} className="rounded-lg bg-cyan-50 px-2 py-1">{instance?.available ? evidenceProvenance(instance, t) : <span>{t('playground.hypothesis.unavailableEvidence')}</span>}</li>;
          })}</ul>
          : <p className="text-xs text-slate-500">{t('playground.hypothesis.noEvidence')}</p>}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {hypothesis.status === HYPOTHESIS_STATUSES.PROPOSED && <button type="button" onClick={() => { onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.TESTING); onOpenExperiment?.(); }} className="hypothesis-action hypothesis-action-primary">{t('playground.hypothesis.startTesting')}</button>}
        <button type="button" onClick={() => onDesignTest?.(hypothesis.id)} className="hypothesis-action hypothesis-action-primary">{t('playground.testDesign.designTest')}</button>
        <button type="button" disabled={!canAttach} onClick={() => onOpenPicker?.(hypothesis.id)} className="hypothesis-action hypothesis-action-cyan disabled:cursor-not-allowed disabled:opacity-50">{t('playground.hypothesis.attachEvidence')}</button>
        <button type="button" onClick={onOpenEvidence} className="hypothesis-action hypothesis-action-neutral">{t('playground.hypothesis.reviewEvidence')}</button>
        {hypothesis.status === HYPOTHESIS_STATUSES.TESTING && <>
          <button type="button" onClick={() => onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.SUPPORTED)} className="hypothesis-action hypothesis-action-cyan">{t('playground.hypothesis.markSupported')}</button>
          <button type="button" onClick={() => onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.REJECTED)} className="hypothesis-action hypothesis-action-neutral">{t('playground.hypothesis.markRejected')}</button>
        </>}
        {(hypothesis.status === HYPOTHESIS_STATUSES.TESTING || hypothesis.status === HYPOTHESIS_STATUSES.SUPPORTED || hypothesis.status === HYPOTHESIS_STATUSES.REJECTED) && <button type="button" onClick={() => onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.REVISED)} className="hypothesis-action hypothesis-action-primary">{t('playground.hypothesis.markRevised')}</button>}
      </div>
      {testDesigns.filter((design) => design.hypothesisId === hypothesis.id).map((design) => <div key={design.id} className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-2 py-2 text-[11px] text-orange-950">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-black">{t('playground.testDesign.saved')} · {t(`playground.testDesign.status.${design.status}`)}</span><button type="button" disabled={design.status === 'executed'} onClick={() => onRunTestDesign?.(design)} className="hypothesis-action hypothesis-action-cyan disabled:cursor-not-allowed disabled:opacity-50">{t('playground.testDesign.run')}</button></div>
        <p className="mt-1 break-words">{t('playground.testDesign.changeSummary', { change: design.intervention.semanticPath ?? design.intervention.controlKey ?? design.intervention.path })}</p>
        {testDesignResults[design.id]?.comparisonClass && <div className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-2 text-cyan-950">
          <p className="font-bold">{t('playground.testDesign.result', { result: t(`playground.testDesign.class.${testDesignResults[design.id].comparisonClass}`), changed: testDesignResults[design.id].changedPaths?.join(', ') || '—' })}</p>
          {testDesignResults[design.id].outcomes?.map((outcome) => <p key={outcome.id} className="mt-1 text-[10px]">{t('playground.testDesign.outcome', { outcome: t(`playground.evidence.${outcome.id.split('.').pop()}`), before: outcome.before ?? '—', after: outcome.after ?? '—', direction: outcome.before !== null && outcome.after !== null && outcome.after > outcome.before ? t('playground.testDesign.direction.increase') : outcome.before !== null && outcome.after !== null && outcome.after < outcome.before ? t('playground.testDesign.direction.decrease') : t('playground.testDesign.direction.similar') })}</p>)}
          <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-[10px] font-black">{t('playground.testDesign.whatDoYouThink')}</span><button type="button" onClick={() => onSelect?.(hypothesis.id)} className="hypothesis-action hypothesis-action-neutral">{t('playground.testDesign.keepTesting')}</button><button type="button" onClick={() => onSetStatus?.(hypothesis.id, HYPOTHESIS_STATUSES.REVISED)} className="hypothesis-action hypothesis-action-primary">{t('playground.testDesign.revise')}</button></div>
        </div>}
      </div>)}
    </div>
  </article>;
}

export default function HypothesisPanel({ attention, graph, evidenceInstances = [], hypotheses = [], compact = false, t, onCreate, onSetStatus, onAttachEvidence, onOpenEvidence, onOpenExperiment, onSelectHypothesis, snapshot, capabilities, testDesigns = [], testDesignResults = {}, onSaveTestDesign, onRunTestDesign }) {
  const [statement, setStatement] = useState('');
  const [predictionChoice, setPredictionChoice] = useState(null);
  const [pickerHypothesisId, setPickerHypothesisId] = useState(null);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState([]);
  const [designHypothesisId, setDesignHypothesisId] = useState(null);
  const prompt = attention?.hypothesisPrompt;
  const availableEvidence = evidenceInstances.filter((instance) => instance.available);
  if (!prompt && hypotheses.length === 0) return null;
  const create = () => {
    const created = onCreate?.({ statement, prediction: predictionChoice ? { choice: predictionChoice } : null, linkedConceptIds: [prompt?.conceptId].filter(Boolean) });
    if (created) {
      setStatement('');
      setPredictionChoice(null);
    }
  };
  const openPicker = (hypothesisId) => {
    setPickerHypothesisId(hypothesisId);
    setSelectedEvidenceIds([]);
  };
  const closePicker = () => {
    setPickerHypothesisId(null);
    setSelectedEvidenceIds([]);
  };
  const attachSelected = () => {
    if (!pickerHypothesisId || selectedEvidenceIds.length === 0) return;
    onAttachEvidence?.(pickerHypothesisId, selectedEvidenceIds);
    closePicker();
  };
  const saveTestDesign = (design) => {
    onSaveTestDesign?.(design);
    setDesignHypothesisId(null);
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
      <fieldset className="mt-3">
        <legend className="text-[11px] font-black text-slate-700">{t('playground.hypothesis.predictionPrompt')}</legend>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {HYPOTHESIS_PREDICTION_CHOICES.map((choice) => <button key={choice} type="button" aria-pressed={predictionChoice === choice} onClick={() => setPredictionChoice((current) => current === choice ? null : choice)} className={`rounded-lg border px-2 py-2 text-[11px] font-black transition ${predictionChoice === choice ? 'border-orange-500 bg-orange-100 text-orange-950' : 'border-orange-200 bg-white text-slate-700 hover:border-orange-400'}`}>{t(`playground.hypothesis.predictionChoice.${choice}`)}</button>)}
        </div>
      </fieldset>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-purple-800">{t('playground.hypothesis.linkedConceptHint', { concept: conceptTitle(prompt.conceptId, t) })}</span>
        <button type="button" disabled={!statement.trim()} onClick={create} className="rounded-xl bg-purple-700 px-3 py-2 text-xs font-black text-white hover:bg-purple-800 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50">{t('playground.hypothesis.create')}</button>
      </div>
    </div>}
    {hypotheses.length > 0 && <div className="mt-3 space-y-2" role="list" aria-label={t('playground.hypothesis.listLabel')}>
      {hypotheses.map((hypothesis) => <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} evidenceInstances={evidenceInstances} selected={graph?.selectedHypothesisId === hypothesis.id} t={t} onSelect={onSelectHypothesis} onSetStatus={onSetStatus} onOpenPicker={openPicker} onOpenEvidence={onOpenEvidence} onOpenExperiment={onOpenExperiment} onDesignTest={setDesignHypothesisId} testDesigns={testDesigns} testDesignResults={testDesignResults} onRunTestDesign={onRunTestDesign} />)}
    </div>}
    {designHypothesisId && (() => { const hypothesis = hypotheses.find((item) => item.id === designHypothesisId); return hypothesis ? <TestDesigner hypothesis={hypothesis} snapshot={snapshot} capabilities={capabilities} t={t} onSave={saveTestDesign} onCancel={() => setDesignHypothesisId(null)} existingDesign={testDesigns.find((design) => design.hypothesisId === hypothesis.id)} /> : null; })()}
    {pickerHypothesisId && <fieldset data-hypothesis-evidence-picker="true" className="hypothesis-evidence-picker mt-3 rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
      <legend className="px-1 text-xs font-black text-cyan-950">{t('playground.hypothesis.evidencePickerTitle')}</legend>
      {availableEvidence.length > 0
        ? <div className="mt-1 space-y-2">{availableEvidence.map((instance) => <label key={instance.id} className="flex min-w-0 items-start gap-2 rounded-lg border border-cyan-100 bg-white px-2 py-2 text-xs text-slate-800">
          <input type="checkbox" checked={selectedEvidenceIds.includes(instance.id)} onChange={(event) => setSelectedEvidenceIds((current) => event.target.checked ? [...new Set([...current, instance.id])] : current.filter((id) => id !== instance.id))} className="mt-1 accent-cyan-600" />
          {evidenceProvenance(instance, t)}
        </label>)}</div>
        : <p className="mt-2 text-xs text-slate-600">{t('playground.hypothesis.noAvailableEvidence')}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={closePicker} className="hypothesis-action hypothesis-action-neutral">{t('playground.hypothesis.cancelPicker')}</button>
        <button type="button" disabled={selectedEvidenceIds.length === 0} onClick={attachSelected} className="hypothesis-action hypothesis-action-cyan disabled:cursor-not-allowed disabled:opacity-50">{t('playground.hypothesis.attachSelected')}</button>
      </div>
    </fieldset>}
    <p className="mt-3 text-[11px] text-slate-500">{t('playground.hypothesis.boundary')}</p>
  </section>;
}
