import { useEffect, useMemo, useRef, useState } from 'react';
import { getPlayground } from '../../core/playgrounds/registry.js';
import { getBigIdeaEntrance } from '../../core/exploration/bigIdeaRegistry.js';
import PresentationMode from './PresentationMode.jsx';
import ExperimentBar from './ExperimentBar.jsx';
import { createPlaybackScheduler } from '../../core/playgroundHost.js';
import PlaygroundPresentationBoundary from './PlaygroundPresentationBoundary.jsx';
import {
  createExplorationOpenTracker,
  createFirstMeaningfulManipulationTracker,
  dispatchWithFirstMeaningfulManipulation,
  NOOP_EXPLORATION_TELEMETRY,
  safeTrackExplorationEvent,
  trackCommittedExperimentAction,
} from '../../core/telemetry/explorationTelemetry.js';
import { derivePhenomenonCapabilities } from '../../core/ui/phenomenon.js';
import { CONCEPTUAL_DEPTHS } from '../../core/ui/uiArchitecture.js';
import { depthTelemetryType } from '../../core/ui/exploreDepth.js';
import ExploreShell from './ExploreShell.jsx';
import ExploreContextBar from './ExploreContextBar.jsx';
import ExploreWorldRegion from './ExploreWorldRegion.jsx';
import ExploreExperimentRegion from './ExploreExperimentRegion.jsx';
import ExploreDetailsRegion from './ExploreDetailsRegion.jsx';
import InquiryEpisodePanel from './InquiryEpisodePanel.jsx';
import PhaseAOnboardingPanel from './PhaseAOnboardingPanel.jsx';
import { REDUCED_MOTION_QUERY } from './motion.js';
import { openFullWorldWorkspacePresentation } from '../../core/ui/layerNavigation.js';
import { nextInquiryConceptExposure, selectInquiryConceptCard } from '../../core/exploration/inquiryConceptCard.js';
import { transitionConceptState, CONCEPT_STATES } from '../../core/ui/lumiSemantics.js';
import { createLumiTarget } from '../../core/ui/lumiInteraction.js';
import { appendJourneyIllumination, clearJourney } from '../../core/ui/lumiJourney.js';
import {
  appendHypothesis,
  bindHypothesisEvidence,
  clearHypotheses,
  createHypothesis,
  setHypothesisStatus,
  HYPOTHESIS_STATUSES,
} from '../../core/exploration/hypothesis.js';
import { deriveEvidenceInstances } from '../../core/exploration/evidenceProvenance.js';
import {
  appendTestDesign,
  clearTestDesigns,
  createTestDesign,
  deriveTestDesignCapabilities,
  replaceTestDesign,
} from '../../core/exploration/testDesign.js';
import {
  appendDiscriminationPlan,
  appendHypothesisGroup,
  clearDiscriminationPlans,
  clearHypothesisGroups,
  createDiscriminationPlan,
  createHypothesisGroup,
} from '../../core/exploration/competingHypotheses.js';
import {
  appendHypothesisRevision,
  appendLearnerInterpretation,
  clearHypothesisRevisions,
  clearLearnerInterpretations,
  createHypothesisRevision,
  createLearnerInterpretation as createInterpretationRecord,
} from '../../core/exploration/learnerInterpretation.js';
import {
  appendCounterfactualQuestion,
  associateCounterfactualTestDesign,
  clearCounterfactualQuestions,
  counterfactualToTestDesign,
  isCounterfactualStale,
  createCounterfactualQuestion,
  markCounterfactualTested,
  normalizeCounterfactualIntervention,
  setCounterfactualStatus,
} from '../../core/exploration/counterfactual.js';

export default function UnifiedPlaygroundDialog({ open, playgroundId, host, agent, onClose, t, initialTab = 'model', telemetry = NOOP_EXPLORATION_TELEMETRY, preserveSession = false, strictOpen = false }) {
  const [snapshot, setSnapshot] = useState(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [playbackError, setPlaybackError] = useState(null);
  const [guidance, setGuidance] = useState(null);
  const [activeDepth, setActiveDepth] = useState(null);
  const [fullWorldToolsOpen, setFullWorldToolsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [pendingLearningSelection, setPendingLearningSelection] = useState(null);
  const [activeInquiryCard, setActiveInquiryCard] = useState(null);
  const [illuminatedConceptIds, setIlluminatedConceptIds] = useState([]);
  const [journeySession, setJourneySession] = useState(() => clearJourney());
  const [hypothesisSession, setHypothesisSession] = useState(() => clearHypotheses());
  const [testDesignSession, setTestDesignSession] = useState(() => clearTestDesigns());
  const [testDesignResults, setTestDesignResults] = useState({});
  const [hypothesisGroupSession, setHypothesisGroupSession] = useState(() => clearHypothesisGroups());
  const [discriminationPlanSession, setDiscriminationPlanSession] = useState(() => clearDiscriminationPlans());
  const [interpretationSession, setInterpretationSession] = useState(() => clearLearnerInterpretations());
  const [revisionSession, setRevisionSession] = useState(() => clearHypothesisRevisions());
  const [counterfactualSession, setCounterfactualSession] = useState(() => clearCounterfactualQuestions());
  const [learningPathIlluminatedIds, setLearningPathIlluminatedIds] = useState([]);
  const [lumiIntervention, setLumiIntervention] = useState(null);
  const [interventionPulseKey, setInterventionPulseKey] = useState(null);
  const sessionSequenceRef = useRef(0);
  const readySessionRef = useRef(null);
  const activeWorkspaceRef = useRef(null);
  const meaningfulManipulationTrackerRef = useRef(null);
  const lumiPolicyRequestRef = useRef('');
  const autoIlluminationRef = useRef(null);
  if (!meaningfulManipulationTrackerRef.current) meaningfulManipulationTrackerRef.current = createFirstMeaningfulManipulationTracker();
  const openTrackerRef = useRef(null);
  if (!openTrackerRef.current) openTrackerRef.current = createExplorationOpenTracker();
  const playground = useMemo(() => (playgroundId ? getPlayground(playgroundId) : null), [playgroundId]);
  const modelPlayground = useMemo(
    () => getPlayground(snapshot?.modelPlaygroundId ?? snapshot?.playgroundId ?? playgroundId) ?? playground,
    [snapshot?.modelPlaygroundId, snapshot?.playgroundId, playgroundId, playground],
  );
  const evidenceInstances = useMemo(
    () => deriveEvidenceInstances({ semanticEvents: snapshot?.semanticEvents }),
    [snapshot?.semanticEvents],
  );
  const bigIdea = useMemo(
    () => getBigIdeaEntrance(snapshot?.bigIdea?.id),
    [snapshot?.bigIdea?.id],
  );

  useEffect(() => {
    if (!open || !playgroundId || !host) {
      readySessionRef.current = null;
      return undefined;
    }
    const workspaceChanged = activeWorkspaceRef.current?.host !== host
      || activeWorkspaceRef.current?.playgroundId !== playgroundId;
    activeWorkspaceRef.current = { host, playgroundId };
    const sessionKey = `${++sessionSequenceRef.current}:${playgroundId}`;
    readySessionRef.current = null;
    meaningfulManipulationTrackerRef.current.reset();
    let active = true;
    let unsubscribe = () => {};
    setPlaybackError(null);
    if (workspaceChanged) {
      setSnapshot(null);
      setGuidance(null);
      setActiveDepth(null);
      setFullWorldToolsOpen(false);
      setAgentOpen(false);
      setPendingLearningSelection(null);
      setActiveInquiryCard(null);
      setIlluminatedConceptIds([]);
      setJourneySession(clearJourney());
      setHypothesisSession(clearHypotheses());
      setTestDesignSession(clearTestDesigns());
      setTestDesignResults({});
      setHypothesisGroupSession(clearHypothesisGroups());
      setDiscriminationPlanSession(clearDiscriminationPlans());
      setInterpretationSession(clearLearnerInterpretations());
      setRevisionSession(clearHypothesisRevisions());
      setCounterfactualSession(clearCounterfactualQuestions());
      setLearningPathIlluminatedIds([]);
      setLumiIntervention(null);
      setInterventionPulseKey(null);
      autoIlluminationRef.current = null;
      setPresentationMode(false);
    }
    setActiveTab(initialTab);
    host.ensureOpen(playgroundId, { strict: strictOpen }).then(() => {
      if (!active) return;
      try {
        const nextSnapshot = host.getState();
        setSnapshot(nextSnapshot);
        readySessionRef.current = sessionKey;
      } catch {
        setSnapshot(null);
      }
      unsubscribe = host.subscribe((next) => {
        if (active) setSnapshot(next);
      });
    }).catch(() => setSnapshot(null));
    return () => {
      active = false;
      unsubscribe();
      if (!preserveSession) host.close().catch(() => {});
    };
  }, [open, playgroundId, host, preserveSession, strictOpen]);

  useEffect(() => {
    if (!lumiIntervention) return undefined;
    const timer = window.setTimeout(() => setLumiIntervention(null), 1250);
    return () => window.clearTimeout(timer);
  }, [lumiIntervention?.sequence]);

  useEffect(() => {
    if (!snapshot?.learnerInquiry) return;
    const currentStillValid = activeInquiryCard
      && snapshot.learnerInquiry.candidates?.some((candidate) => candidate.conceptId === activeInquiryCard.conceptId
        && candidate.supportingEventIds?.join('|') === activeInquiryCard.supportingEventIds?.join('|'));
    if (currentStillValid) return;
    const next = selectInquiryConceptCard({
      inquiry: snapshot.learnerInquiry,
      shownConceptIds: snapshot.learnerInquiry.conceptsPreviouslySurfaced,
    });
    if (!next) {
      setActiveInquiryCard(null);
      return;
    }
    setActiveInquiryCard(next);
    host.recordInquiryPresentationEvent?.({ type: 'concept-card-surfaced', conceptId: next.conceptId });
    const nextShownConceptIds = nextInquiryConceptExposure(snapshot.learnerInquiry.conceptsPreviouslySurfaced, next.conceptId);
    host.setInquiryPresentationContext?.({ conceptsPreviouslySurfaced: nextShownConceptIds, conceptualDepth: activeDepth });
  }, [snapshot?.learnerInquiry, activeInquiryCard, activeDepth, host]);

  // Episode policy boundary: the Host owns the bounded semantic projection
  // and chooses Cloud v0 when configured, otherwise its local fallback.
  useEffect(() => {
    const runtime = snapshot?.inquiryRuntime;
    if (!runtime || !host?.decideLumiAction) return;
    const sequence = snapshot.semanticEvents?.events?.at(-1)?.sequence ?? 0;
    const key = `${runtime.contractId}:${runtime.stage}:${sequence}`;
    if (lumiPolicyRequestRef.current === key) return;
    lumiPolicyRequestRef.current = key;
    host.decideLumiAction().catch(() => {});
  }, [snapshot?.inquiryRuntime?.contractId, snapshot?.inquiryRuntime?.stage, snapshot?.semanticEvents?.events?.at(-1)?.sequence, host]);

  // Concept eligibility is deterministic runtime evidence. The companion may
  // illuminate that eligible concept once as a presentation notification;
  // this never appends semantic events or changes experiment truth.
  useEffect(() => {
    const runtime = snapshot?.inquiryRuntime;
    const evidenceId = runtime?.evidence?.evidenceId
      ?? runtime?.evidence?.evidence?.id
      ?? (runtime?.evidence?.structure?.experimentIds?.length ? `${runtime.evidence.detectorId}:${runtime.evidence.structure.experimentIds.join(':')}` : null);
    const eligible = runtime?.evidence?.status === 'evidenced'
      && (runtime?.candidateConcepts ?? []).includes('SAMPLING_VARIABILITY');
    if (!eligible || !evidenceId || autoIlluminationRef.current === evidenceId) return;
    autoIlluminationRef.current = evidenceId;
    illuminateConcept('SAMPLING_VARIABILITY');
    const target = createLumiTarget('concept', 'SAMPLING_VARIABILITY');
    if (target) setLumiIntervention((current) => ({ target, sequence: (current?.sequence ?? 0) + 1 }));
  }, [snapshot?.inquiryRuntime, illuminateConcept]);

  useEffect(() => {
    if (!open || !snapshot || snapshot.playgroundId !== playgroundId || !readySessionRef.current) return;
    const sessionKey = readySessionRef.current;
    if (!openTrackerRef.current.claim(sessionKey)) return;
    const bigIdeaId = snapshot.bigIdea?.id;
    safeTrackExplorationEvent({
      version: 1,
      type: 'exploration_opened',
      payload: {
        surface: 'explore',
        playgroundId,
        ...(bigIdeaId ? { bigIdeaId } : {}),
      },
    }, telemetry);
  }, [open, playgroundId, snapshot, telemetry]);

  useEffect(() => {
    if (!snapshot || playbackError) return undefined;
    let active = true;
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches;
    const scheduler = createPlaybackScheduler({
      dispatch: (action) => host.dispatch(action),
      onError: ({ action, error, snapshot: scheduledSnapshot }) => {
        if (!active) return;
        const stepDefinition = scheduledSnapshot.script?.steps?.[scheduledSnapshot.scriptState?.step];
        const operation = stepDefinition?.invoke?.operation || t('playground.playback.operationUnknown');
        const reason = error?.code || error?.message || String(error);
        setPlaybackError({
          action: action.type,
          operation,
          reason,
          step: stepDefinition?.id || String(scheduledSnapshot.scriptState?.step ?? t('playground.playback.stepUnknown')),
        });
        const pauseAction = action.type === 'SCRIPT_STEP' ? { type: 'SCRIPT_PAUSE' } : { type: 'PAUSE' };
        host.dispatch(pauseAction).catch(() => {});
      },
    });
    scheduler.schedule(snapshot, { reducedMotion });
    return () => {
      active = false;
      scheduler.cancel();
    };
  }, [snapshot, host, playbackError, t]);

  const dispatchAction = (action) => {
    if (['RESET_LEARNING', 'RESTORE_ORIGINAL_DATA', 'RESET', 'SCRIPT_RESET'].includes(action?.type)) {
      setIlluminatedConceptIds([]);
      setJourneySession(clearJourney());
      setHypothesisSession(clearHypotheses());
      setTestDesignSession(clearTestDesigns());
      setTestDesignResults({});
      setHypothesisGroupSession(clearHypothesisGroups());
      setDiscriminationPlanSession(clearDiscriminationPlans());
      setInterpretationSession(clearLearnerInterpretations());
      setRevisionSession(clearHypothesisRevisions());
    }
    const humanAction = action?.type === 'APPLY_WORLD_TRANSACTION'
      ? { ...action, transaction: { ...(action.transaction ?? {}), actor: 'human' } }
      : { ...action, actor: 'human' };
    if (['PLAY', 'SCRIPT_PLAY', 'STEP', 'TRAINING_STEP', 'SCRIPT_STEP', 'RESET', 'SCRIPT_RESET'].includes(action.type)) {
      setPlaybackError(null);
    }
    if (action.type === 'SET_CONTROL') {
      const target = createLumiTarget('experiment', snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id);
      if (target) setLumiIntervention((current) => ({ target, controlKey: action.key, sequence: (current?.sequence ?? 0) + 1 }));
    }
    if (['APPLY_WORLD_TRANSACTION', 'SET_WORLD_GENERATOR', 'SET_GENERATOR_PARAMETER', 'SET_GENERATOR_SEED', 'REGENERATE_WORLD', 'RESAMPLE_WORLD', 'FREEZE_AS_SAMPLES', 'SET_CONTROL', 'ATTACH_MODEL'].includes(action.type)) {
      setInterventionPulseKey((value) => (value ?? 0) + 1);
    }
    return dispatchWithFirstMeaningfulManipulation({
      action: humanAction,
      dispatch: (nextAction) => host.dispatch(nextAction?.type === 'APPLY_WORLD_TRANSACTION'
        ? { ...nextAction, transaction: { ...(nextAction.transaction ?? {}), actor: 'human' } }
        : { ...nextAction, actor: 'human' }),
      tracker: meaningfulManipulationTrackerRef.current,
      telemetry,
    }).then((result) => {
      trackCommittedExperimentAction(humanAction, result, telemetry);
      return result;
    });
  };

  function illuminateConcept(conceptId) {
    if (!conceptId) return;
    setIlluminatedConceptIds((current) => {
      if (current.includes(conceptId)) return current;
      const nextState = transitionConceptState(CONCEPT_STATES.ACTIVE, CONCEPT_STATES.ILLUMINATED);
      return nextState === CONCEPT_STATES.ILLUMINATED ? [...current, conceptId] : current;
    });
    setJourneySession((current) => appendJourneyIllumination(current, {
      conceptId,
      timestamp: Date.now(),
      afterSequence: snapshot?.semanticEvents?.events?.at(-1)?.sequence ?? 0,
    }));
  }

  const createLearnerHypothesis = ({ statement, linkedConceptIds = [], prediction = null } = {}) => {
    const id = `hypothesis-${sessionSequenceRef.current}-${hypothesisSession.hypotheses.length + 1}`;
    const hypothesis = createHypothesis({
      id,
      statement,
      linkedConceptIds,
      prediction,
      createdAt: new Date().toISOString(),
      experimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id,
      threadId: snapshot?.activeExplorationThread?.id,
      createdFrom: 'learner',
    });
    if (hypothesis) setHypothesisSession((current) => appendHypothesis(current, hypothesis));
    return hypothesis;
  };

  const updateHypothesisStatus = (hypothesisId, status) => {
    if (!Object.values(HYPOTHESIS_STATUSES).includes(status)) return;
    setHypothesisSession((current) => setHypothesisStatus(current, { hypothesisId, status }));
  };

  const attachHypothesisEvidence = (hypothesisId, evidenceIds = []) => {
    const validEvidenceIds = evidenceInstances.filter((instance) => instance.available).map((instance) => instance.id);
    setHypothesisSession((current) => bindHypothesisEvidence(current, {
      hypothesisId,
      evidenceIds,
      validEvidenceIds,
    }));
  };

  const testDesignCapabilities = useMemo(
    () => snapshot && modelPlayground ? deriveTestDesignCapabilities({ snapshot, playground: modelPlayground }) : null,
    [snapshot, modelPlayground],
  );

  const saveLearnerTestDesign = (design) => {
    let conditionFingerprint = null;
    try { conditionFingerprint = host.inspectContext?.().conditionFingerprint ?? null; } catch { conditionFingerprint = null; }
    const nextDesign = createTestDesign({ ...design, baselineConditionFingerprint: conditionFingerprint, status: 'ready' });
    if (!nextDesign) return null;
    setTestDesignSession((current) => current.designs.some((item) => item.id === nextDesign.id)
      ? replaceTestDesign(current, nextDesign)
      : appendTestDesign(current, nextDesign));
    return nextDesign;
  };

  const runLearnerTestDesign = async (design) => {
    const result = await host.executeTestDesign?.({ design });
    if (!result) return null;
    if (!result.valid) {
      setTestDesignResults((current) => ({ ...current, [design.id]: { error: result.code ?? result.errors?.[0] ?? 'invalid' } }));
      if (result.code === 'TEST_DESIGN_STALE_BASELINE') {
        setCounterfactualSession((current) => {
          const question = current.questions.find((item) => item.testDesignId === design.id);
          return question ? setCounterfactualStatus(current, { questionId: question.id, status: 'stale' }) : current;
        });
      }
      return result;
    }
    setTestDesignSession((current) => replaceTestDesign(current, result.design));
    setTestDesignResults((current) => ({ ...current, [design.id]: { ...result.comparison, outcomes: result.outcomes ?? [] } }));
    setCounterfactualSession((current) => markCounterfactualTested(current, {
      questionId: current.questions.find((question) => question.testDesignId === result.design?.id)?.id,
      testDesignId: result.design?.id ?? design.id,
      executionSucceeded: true,
      observedEvidenceInstanceIds: result.design?.outcomeEvidenceIds ?? result.executionEvidenceIds ?? [],
    }));
    return result;
  };

  const createLearnerHypothesisGroup = ({ question = '', hypothesisIds = [] } = {}) => {
    const id = `hypothesis-group-${sessionSequenceRef.current}-${hypothesisGroupSession.groups.length + 1}`;
    const group = createHypothesisGroup({ id, question, hypothesisIds, hypotheses: hypothesisSession.hypotheses, createdFrom: 'learner' });
    if (group) setHypothesisGroupSession((current) => appendHypothesisGroup(current, group, { hypotheses: hypothesisSession.hypotheses }));
    return group;
  };

  const createLearnerDiscriminationPlan = ({ groupId, testDesignId, predictedOutcomes = [] } = {}) => {
    const id = `discrimination-plan-${sessionSequenceRef.current}-${discriminationPlanSession.plans.length + 1}`;
    const plan = createDiscriminationPlan({
      id,
      hypothesisGroupId: groupId,
      testDesignId,
      predictedOutcomes,
      groups: hypothesisGroupSession.groups,
      hypotheses: hypothesisSession.hypotheses,
      testDesigns: testDesignSession.designs,
      createdFrom: 'learner',
    });
    if (plan) setDiscriminationPlanSession((current) => appendDiscriminationPlan(current, plan, {
      groups: hypothesisGroupSession.groups,
      hypotheses: hypothesisSession.hypotheses,
      testDesigns: testDesignSession.designs,
    }));
    return plan;
  };

  const createLearnerInterpretation = ({ hypothesisIds = [], evidenceInstanceIds = [], testDesignId = null, judgment, note = '' } = {}) => {
    const id = 'interpretation-' + sessionSequenceRef.current + '-' + (interpretationSession.interpretations.length + 1);
    const interpretation = createInterpretationRecord({
      id,
      hypothesisIds,
      evidenceInstanceIds,
      testDesignId,
      judgment,
      note,
      hypotheses: hypothesisSession.hypotheses,
      testDesigns: testDesignSession.designs,
      createdFrom: 'learner',
    });
    if (interpretation) setInterpretationSession((current) => appendLearnerInterpretation(current, interpretation, { hypotheses: hypothesisSession.hypotheses, testDesigns: testDesignSession.designs }));
    return interpretation;
  };

  const createLearnerRevision = ({ parentHypothesisId, interpretationIds = [], statement = '' } = {}) => {
    const parent = hypothesisSession.hypotheses.find((hypothesis) => hypothesis.id === parentHypothesisId);
    if (!parent) return null;
    const child = createHypothesis({
      id: 'hypothesis-' + sessionSequenceRef.current + '-' + (hypothesisSession.hypotheses.length + 1),
      statement,
      linkedConceptIds: parent.linkedConceptIds,
      createdAt: new Date().toISOString(),
      experimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id,
      threadId: snapshot?.activeExplorationThread?.id,
      createdFrom: 'learner',
    });
    if (!child) return null;
    const nextHypotheses = [...hypothesisSession.hypotheses, child];
    const revision = createHypothesisRevision({
      id: `revision-${sessionSequenceRef.current}-${revisionSession.revisions.length + 1}`,
      parentHypothesisId,
      childHypothesisId: child.id,
      interpretationIds,
      hypotheses: nextHypotheses,
      interpretations: interpretationSession.interpretations,
      createdFrom: 'learner',
    });
    if (!revision) return null;
    setHypothesisSession((current) => appendHypothesis(current, child));
    setRevisionSession((current) => appendHypothesisRevision(current, revision, { hypotheses: nextHypotheses, interpretations: interpretationSession.interpretations }));
    return { child, revision };
  };

  const currentConditionFingerprint = useMemo(() => {
    try { return host?.inspectContext?.().conditionFingerprint ?? null; } catch { return null; }
  }, [host, snapshot]);

  const createLearnerCounterfactual = ({ question = '', intervention = null, heldConstantFactors = [], outcomeObservableIds = [], prediction = null } = {}) => {
    const id = `counterfactual-${sessionSequenceRef.current}-${counterfactualSession.questions.length + 1}`;
    const created = createCounterfactualQuestion({
      id,
      question,
      baselineExperimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id,
      baselineConditionFingerprint: currentConditionFingerprint,
      intervention: normalizeCounterfactualIntervention(intervention),
      heldConstantFactors,
      outcomeObservableIds,
      prediction,
      createdFrom: 'learner',
    });
    if (created) setCounterfactualSession((current) => appendCounterfactualQuestion(current, created));
    return created;
  };

  const convertLearnerCounterfactual = (question, hypothesisId) => {
    const design = counterfactualToTestDesign(question, {
      hypothesisId,
      id: `test-design-${question?.id}`,
      currentBaselineExperimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id,
      currentConditionFingerprint,
    });
    if (!design) {
      if (question?.id && isCounterfactualStale(question, { baselineExperimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? snapshot?.experiment?.id, conditionFingerprint: currentConditionFingerprint })) {
        setCounterfactualSession((current) => setCounterfactualStatus(current, { questionId: question.id, status: 'stale' }));
      }
      return null;
    }
    const saved = saveLearnerTestDesign(design);
    if (saved) setCounterfactualSession((current) => associateCounterfactualTestDesign(current, { questionId: question.id, testDesignId: saved.id }));
    return saved;
  };

  const illuminateLearningPath = (pathId) => {
    if (typeof pathId !== 'string' || !pathId.trim()) return;
    setLearningPathIlluminatedIds((current) => current.includes(pathId) ? current : [...current, pathId].slice(-8));
  };

  const acceptLumiSuggestion = (suggestion) => {
    const kind = suggestion?.kind;
    const depth = kind === 'observe' || kind === 'inspect-evidence' || kind === 'interpret'
      ? CONCEPTUAL_DEPTHS.EVIDENCE
      : kind === 'design-test' || kind === 'hold-constant'
        ? CONCEPTUAL_DEPTHS.TUNE
        : null;
    if (depth) changeDepth(depth);
    setTimeout(() => {
      const selector = kind === 'counterfactual'
        ? '[data-counterfactual-exploration]'
        : kind === 'explore-concept'
          ? '[data-concept-map]'
          : '[data-hypothesis-panel]';
      document.querySelector(selector)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  const changeDepth = (nextDepth) => {
    setAgentOpen(false);
    const telemetryType = depthTelemetryType(nextDepth);
    if (telemetryType) safeTrackExplorationEvent({ version: 1, type: telemetryType, payload: {} }, telemetry);
    host.setInquiryPresentationContext?.({ conceptualDepth: nextDepth, conceptsPreviouslySurfaced: snapshot?.learnerInquiry?.conceptsPreviouslySurfaced ?? [] });
    if (nextDepth) host.recordInquiryPresentationEvent?.({ type: 'depth-opened' });
    setActiveDepth(nextDepth);
  };

  const openAgent = () => {
    setActiveDepth(null);
    setPendingLearningSelection(null);
    setAgentOpen(true);
  };

  const openAskAboutSelection = (selection) => {
    if (!selection?.quote) return;
    setActiveDepth(null);
    setPendingLearningSelection(selection);
    setAgentOpen(true);
  };

  const openFullWorldWorkspaceFromTune = () => {
    const next = openFullWorldWorkspacePresentation({ fullWorldToolsOpen, activeTab, activeDepth });
    setFullWorldToolsOpen(next.fullWorldToolsOpen);
    setActiveTab(next.activeTab);
    setActiveDepth(next.activeDepth);
  };

  const dismissInquiryCard = () => setActiveInquiryCard(null);
  const openInquiryEvidence = () => {
    if (activeInquiryCard?.conceptId) host.recordInquiryPresentationEvent?.({ type: 'concept-card-engaged', conceptId: activeInquiryCard.conceptId });
    changeDepth(CONCEPTUAL_DEPTHS.EVIDENCE);
  };

  if (!open || !snapshot || !playground || snapshot.playgroundId !== playgroundId) return null;
  if (presentationMode) {
    return <PresentationMode
      playground={modelPlayground}
      snapshot={snapshot}
      onDispatch={dispatchAction}
      onExit={() => setPresentationMode(false)}
      t={t}
    />;
  }
  const formulaPrimitive = snapshot.primitives.find((primitive) => primitive.type === 'formula');
  const phenomenonFirst = derivePhenomenonCapabilities(snapshot).available;
  const contextBar = <ExploreContextBar playground={playground} snapshot={snapshot} phenomenon={phenomenonFirst} onDispatch={dispatchAction} onPresent={() => setPresentationMode(true)} onClose={onClose} t={t} highlightedAffordances={guidance?.affordances ?? []} />;
  const worldRegion = <ExploreWorldRegion snapshot={snapshot} bigIdea={bigIdea} activeTab={activeTab} onTabChange={setActiveTab} onDispatch={dispatchAction} t={t} highlightedAffordances={guidance?.affordances ?? []} fullWorldToolsOpen={fullWorldToolsOpen} onFullWorldToolsChange={setFullWorldToolsOpen} onOpenFullWorldTools={openFullWorldWorkspaceFromTune} />;
  const experimentRegion = <ExploreExperimentRegion playground={modelPlayground} snapshot={snapshot} inquiryCard={activeInquiryCard} onDismissInquiryCard={dismissInquiryCard} onOpenInquiryEvidence={openInquiryEvidence} onAskAboutSelection={openAskAboutSelection} agent={agent} onDispatch={dispatchAction} t={t} intervention={lumiIntervention}><PhaseAOnboardingPanel snapshot={snapshot} host={host} onDispatch={dispatchAction} onOpenWorldTools={openFullWorldWorkspaceFromTune} t={t} /><InquiryEpisodePanel snapshot={snapshot} host={host} onDispatch={dispatchAction} t={t} /><ExperimentBar snapshot={snapshot} onDispatch={dispatchAction} t={t} highlightedAffordances={guidance?.affordances ?? []} interventionPulseKey={lumiIntervention?.sequence ?? null} interventionTarget={lumiIntervention?.target ?? null} /></ExploreExperimentRegion>;
  const detailsRegion = <ExploreDetailsRegion snapshot={snapshot} modelPlayground={modelPlayground} bigIdea={bigIdea} agent={agent} host={host} activeDepth={activeDepth} onDepthChange={changeDepth} agentOpen={agentOpen} onAgentOpen={openAgent} onAgentClose={() => { setAgentOpen(false); setPendingLearningSelection(null); }} onDispatch={dispatchAction} onGuidanceChange={setGuidance} formulaPrimitive={formulaPrimitive} onOpenWorldTools={openFullWorldWorkspaceFromTune} initialSelection={pendingLearningSelection} onAskAboutSelection={openAskAboutSelection} illuminatedConceptIds={illuminatedConceptIds} journeyIlluminationEvents={journeySession.illuminationEvents} onIlluminateConcept={illuminateConcept} learningPathIlluminatedIds={learningPathIlluminatedIds} onIlluminateLearningPath={illuminateLearningPath} hypotheses={hypothesisSession.hypotheses} evidenceInstances={evidenceInstances} onCreateHypothesis={createLearnerHypothesis} onSetHypothesisStatus={updateHypothesisStatus} onAttachHypothesisEvidence={attachHypothesisEvidence} onOpenHypothesisEvidence={() => changeDepth(CONCEPTUAL_DEPTHS.EVIDENCE)} testDesigns={testDesignSession.designs} testDesignResults={testDesignResults} testDesignCapabilities={testDesignCapabilities} onSaveTestDesign={saveLearnerTestDesign} onRunTestDesign={runLearnerTestDesign} hypothesisGroups={hypothesisGroupSession.groups} discriminationPlans={discriminationPlanSession.plans} onCreateHypothesisGroup={createLearnerHypothesisGroup} onCreateDiscriminationPlan={createLearnerDiscriminationPlan} interpretations={interpretationSession.interpretations} revisions={revisionSession.revisions} onCreateInterpretation={createLearnerInterpretation} onCreateRevision={createLearnerRevision} counterfactualQuestions={counterfactualSession.questions} onCreateCounterfactual={createLearnerCounterfactual} onConvertCounterfactual={convertLearnerCounterfactual} counterfactualConditionFingerprint={currentConditionFingerprint} onAcceptLumiSuggestion={acceptLumiSuggestion} t={t} intervention={lumiIntervention} />;
  return <div className="fixed inset-0 z-[75] grid place-items-center overflow-hidden overscroll-y-contain bg-slate-950/55 p-0 sm:p-5" onMouseDown={onClose}>
    <PlaygroundPresentationBoundary
      snapshot={snapshot}
      depth={activeDepth ?? CONCEPTUAL_DEPTHS.PHENOMENON}
      className="ui-explore-dialog-frame w-full max-w-6xl max-h-[94vh] overflow-auto rounded-3xl bg-white p-3 shadow-2xl sm:p-6"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <section className="relative min-w-0" onMouseDown={(event) => event.stopPropagation()}>
      <ExploreShell contextBar={contextBar} worldRegion={worldRegion} experimentRegion={experimentRegion} detailsRegion={detailsRegion} />
        {playbackError && <div role="alert" className="ui-motion-error mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-black">{t('playground.playback.errorTitle')}</p>
          <p className="mt-1">{t('playground.playback.errorBody', playbackError)}</p>
          <p className="mt-1 text-xs">{t('playground.playback.errorStatePreserved')}</p>
        </div>}
      </section>
    </PlaygroundPresentationBoundary>
  </div>;
}
