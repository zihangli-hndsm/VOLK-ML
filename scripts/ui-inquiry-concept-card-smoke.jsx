import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import InquiryConceptCard from '../src/components/playground/InquiryConceptCard.jsx';

const t = (key) => ({
  'playground.inquiry.card.ariaLabel': 'Concept from this exploration',
  'playground.inquiry.card.eyebrow': 'You just noticed',
  'playground.inquiry.card.dismiss': 'Dismiss',
  'playground.inquiry.card.whyNow': 'Why this appeared',
  'playground.inquiry.card.deeper': 'Why this matters',
  'playground.inquiry.card.showEvidence': 'See the evidence',
  'playground.concept.controlledComparison.title': 'Controlled comparison',
  'playground.concept.controlledComparison.definition': 'Change one intended factor while keeping relevant others fixed so the comparison is easier to interpret.',
  'playground.inquiry.why.duplicated': 'You kept a copied baseline.',
  'playground.inquiry.why.oneFactor': 'The current comparison has one changed factor.',
  'playground.inquiry.why.compared': 'You compared the two experiments.',
}[key] ?? key);

export async function runInquiryConceptCardSmoke({ card }) {
  const markup = renderToStaticMarkup(<InquiryConceptCard card={card} onDismiss={() => {}} onOpenEvidence={() => {}} t={t} />);
  assert.equal((markup.match(/data-ui-inquiry-concept-card/g) ?? []).length, 1, 'one candidate renders one quiet Concept Card');
  assert.ok(markup.includes('Controlled comparison'), 'card renders the deterministic catalog title');
  assert.ok(markup.includes('Why this appeared'), 'card separates why-now evidence from the general description');
  assert.ok(markup.includes('See the evidence'), 'the only next action is the existing Evidence depth');
  assert.equal(markup.includes('overflow-x'), false, 'compact card introduces no horizontal overflow contract');
  assert.equal(renderToStaticMarkup(<InquiryConceptCard card={null} t={t} />), '', 'no candidate renders no placeholder');
  return { passed: true };
}
