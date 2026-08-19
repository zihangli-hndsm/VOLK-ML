import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import ConceptCard from '../src/components/playground/ConceptCard.jsx';

const t = (key) => ({
  'playground.concept.cardTitle': 'You just encountered',
  'playground.concept.whatHappened': 'What happened',
  'playground.concept.definition': 'Concept',
  'playground.concept.tryNext': 'Try next',
  'playground.concept.classSeparation.title': 'Class separation',
  'playground.concept.classSeparation.definition': 'The distance between class groups is measurable.',
  'playground.concept.classSeparation.question': 'What happens if the classes move farther apart again?',
  'playground.pedagogical.observation.classSeparation': 'The classes moved closer.',
  'fact.class-separation-distance': 'Class separation distance',
}[key] ?? key);

export async function runConceptCardSmoke({ signal, observation }) {
  const markup = renderToStaticMarkup(<ConceptCard signal={signal} observation={observation} t={t} />);
  assert.equal((markup.match(/data-ui-concept-card/g) ?? []).length, 1, 'Play surfaces one concept card');
  assert.equal(markup.includes('overflow-x'), false, 'compact concept card has no horizontal overflow contract');
  assert.ok(markup.includes('Class separation'), 'card uses catalog title');
  assert.equal(renderToStaticMarkup(<ConceptCard signal={null} observation={observation} t={t} />), '', 'no signal renders no card');
  return { passed: true };
}
