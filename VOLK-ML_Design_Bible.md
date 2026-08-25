# VOLK-ML Design Bible v1.0

## Vision

VOLK-ML is an explorable learning environment for understanding machine
learning through:

Observe → Intervene → Discover → Understand

It is not an AI assistant or a traditional AutoML tool. It makes
invisible ML concepts visible through interaction.

## Architecture Principle

Semantic hierarchy:

World ↓ Experiment ↓ Evidence ↓ Concept ↓ Journey Projection ↓ LUMI
Presentation

Rules: - UI does not create truth. - LUMI does not create evidence. -
Understanding is not inferred from model performance. - Animation must
represent real semantic changes.

## Evidence Principle

Observation answers: What happened?

Concept answers: What does it mean?

Understanding answers: What has the learner connected?

Evidence != Understanding.

## World, Observation, and Data

World is not Data. A World describes a possible mechanism or finite setting;
an observation process produces one finite Dataset from it. Resampling changes
the observed Dataset while preserving the generated World's identity. A model
is an evidence-limited approximation, and a learner hypothesis is a separate
working idea rather than a second machine model.

The explicit learning loop is:

World → Observe/Sample → Data → Predict → Intervene → Compare → Revise

These transitions are projections of existing World, Experiment, Evidence,
Concept, and Journey state. They do not infer causality, mastery, or truth.

## LUMI

LUMI is a fictional firefly-inspired guide creature.

LUMI represents: - attention - curiosity - exploration - guidance

LUMI is not: - a chatbot - a teacher replacement - an autonomous
decision maker

Core idea:

"LUMI is a living cursor for understanding."

## Color Language

### LUMI colors

Deep Navy: - structure - stability - foundation

Light Cyan: - observation - attention - information flow

Orange: - intervention - experiment - discovery

### Concept colors

Purple: - unexplored concept - possibility - frontier - hypothesis space

Green: - explored concept - illuminated understanding - validated
connection

Purple becomes Green through exploration, not automatic prediction.

## Learning Loop

Observe (Cyan) ↓ Predict (Purple) ↓ Intervene (Orange) ↓ Compare evidence ↓ Explore
concepts (Purple) ↓ Illuminate understanding (Green)

## Exploration Journey

Journey records how understanding was constructed.

Events: - Observe - Intervene - Connect - Illuminate

It is: - session-local - semantic - derived from existing states

It is not: - permanent memory - learner profiling - autonomous tutoring
history

## Concept World

VOLK should represent concepts as a connected world, not only a list.

Future concept structures may include: - relationships - prerequisites -
evidence links - exploration paths

## Agent Direction

Agents should be built on top of: - world state - experiment history -
evidence - journey traces - concept graph

The environment comes before the agent.

## Final Principle

VOLK-ML should help learners answer:

"Why did this happen?"

Not only:

"What happened?"
