import React from 'react';
import { getConcept } from '../../core/exploration/concepts.js';
import { CONCEPT_STATES, normalizeConceptState } from '../../core/ui/lumiSemantics.js';
import InstructionalAnnotationSurface from './InstructionalAnnotationSurface.jsx';
import Lumi from './Lumi.jsx';

function factText(fact, t) {
  if (fact.before === undefined || fact.after === undefined) return t('playground.pedagogical.heldFixed');
  return `${t(fact.labelKey)}: ${fact.before} → ${fact.after}`;
}

const stateClasses = Object.freeze({
  [CONCEPT_STATES.UNEXPLORED]: 'border-purple-200 bg-purple-50/70 text-purple-950',
  [CONCEPT_STATES.ACTIVE]: 'border-cyan-200 bg-cyan-50/70 text-cyan-950',
  [CONCEPT_STATES.ILLUMINATED]: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
});

export default function ConceptCard({ signal, observation, nextQuestion, t, onNextQuestion, agent, onAskAbout, state = CONCEPT_STATES.ACTIVE, onIlluminate }) {
  if (!signal || !observation?.available) return null;
  const concept = getConcept(signal.id);
  if (!concept) return null;
  const normalizedState = normalizeConceptState(state);
  return <InstructionalAnnotationSurface surface="concept-card" contentId={`concept-${signal.id}`} messageId={`concept-${signal.id}`} localizationKey={concept.titleKey} agent={agent} onAskAbout={onAskAbout} t={t} className="mt-3">
    <section data-ui-concept-card="true" data-concept-state={normalizedState} className={`ui-motion-surface rounded-2xl border p-3 text-sm ${stateClasses[normalizedState]}`} aria-label={t('playground.concept.cardTitle')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2"><Lumi presence="contextual" mode={normalizedState === CONCEPT_STATES.ILLUMINATED ? 'illuminate' : 'guide'} /><p className="text-[10px] font-black uppercase tracking-wide">{t('playground.concept.cardTitle')}</p></div>
      <span className="rounded-full border border-current px-2 py-0.5 text-[10px] font-black">{t(`playground.concept.state.${normalizedState}`)}</span>
    </div>
    <h4 className="mt-1 text-base font-black">{t(concept.titleKey)}</h4>
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide">{t('playground.concept.whatHappened')}</p>
    <p className="mt-1">{t(observation.summaryKey)}</p>
    {observation.facts.slice(0, 3).map((fact) => <p key={fact.id} className="mt-1 text-xs">{factText(fact, t)}</p>)}
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide">{t('playground.concept.definition')}</p>
    <p className="mt-1 text-xs">{t(concept.definitionKey)}</p>
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide">{t('playground.concept.tryNext')}</p>
    {nextQuestion ? <button type="button" onClick={onNextQuestion} className="mt-1 rounded-lg bg-white px-3 py-2 text-left text-xs font-black text-blue-800 ring-1 ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500">{t(nextQuestion.questionKey)}</button> : <p className="mt-1 text-xs">{t(concept.questionKey)}</p>}
    {normalizedState === CONCEPT_STATES.ACTIVE && onIlluminate && <button type="button" onClick={() => onIlluminate(signal.id)} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-800 ring-1 ring-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('playground.concept.illuminate')}</button>}
    </section>
  </InstructionalAnnotationSurface>;
}
