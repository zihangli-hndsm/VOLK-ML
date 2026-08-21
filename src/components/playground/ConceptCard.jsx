import React from 'react';
import { getConcept } from '../../core/exploration/concepts.js';
import InstructionalAnnotationSurface from './InstructionalAnnotationSurface.jsx';

function factText(fact, t) {
  if (fact.before === undefined || fact.after === undefined) return t('playground.pedagogical.heldFixed');
  return `${t(fact.labelKey)}: ${fact.before} → ${fact.after}`;
}

export default function ConceptCard({ signal, observation, nextQuestion, t, onNextQuestion, agent, onAskAbout }) {
  if (!signal || !observation?.available) return null;
  const concept = getConcept(signal.id);
  if (!concept) return null;
  return <InstructionalAnnotationSurface surface="concept-card" contentId={`concept-${signal.id}`} messageId={`concept-${signal.id}`} localizationKey={concept.titleKey} agent={agent} onAskAbout={onAskAbout} t={t} className="mt-3">
    <section data-ui-concept-card="true" className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3 text-sm text-blue-950" aria-label={t('playground.concept.cardTitle')}>
    <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">{t('playground.concept.cardTitle')}</p>
    <h4 className="mt-1 text-base font-black">{t(concept.titleKey)}</h4>
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-blue-700">{t('playground.concept.whatHappened')}</p>
    <p className="mt-1">{t(observation.summaryKey)}</p>
    {observation.facts.slice(0, 3).map((fact) => <p key={fact.id} className="mt-1 text-xs">{factText(fact, t)}</p>)}
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-blue-700">{t('playground.concept.definition')}</p>
    <p className="mt-1 text-xs">{t(concept.definitionKey)}</p>
    <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-blue-700">{t('playground.concept.tryNext')}</p>
    {nextQuestion ? <button type="button" onClick={onNextQuestion} className="mt-1 rounded-lg bg-white px-3 py-2 text-left text-xs font-black text-blue-800 ring-1 ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500">{t(nextQuestion.questionKey)}</button> : <p className="mt-1 text-xs">{t(concept.questionKey)}</p>}
    </section>
  </InstructionalAnnotationSurface>;
}
