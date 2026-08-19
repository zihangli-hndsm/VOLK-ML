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
import { REDUCED_MOTION_QUERY } from './motion.js';
import { openFullWorldWorkspacePresentation } from '../../core/ui/layerNavigation.js';

export default function UnifiedPlaygroundDialog({ open, playgroundId, host, agent, onClose, t, initialTab = 'model', telemetry = NOOP_EXPLORATION_TELEMETRY }) {
  const [snapshot, setSnapshot] = useState(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [playbackError, setPlaybackError] = useState(null);
  const [guidance, setGuidance] = useState(null);
  const [activeDepth, setActiveDepth] = useState(null);
  const [fullWorldToolsOpen, setFullWorldToolsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const sessionSequenceRef = useRef(0);
  const readySessionRef = useRef(null);
  const meaningfulManipulationTrackerRef = useRef(null);
  if (!meaningfulManipulationTrackerRef.current) meaningfulManipulationTrackerRef.current = createFirstMeaningfulManipulationTracker();
  const openTrackerRef = useRef(null);
  if (!openTrackerRef.current) openTrackerRef.current = createExplorationOpenTracker();
  const playground = useMemo(() => (playgroundId ? getPlayground(playgroundId) : null), [playgroundId]);
  const modelPlayground = useMemo(
    () => getPlayground(snapshot?.modelPlaygroundId ?? snapshot?.playgroundId ?? playgroundId) ?? playground,
    [snapshot?.modelPlaygroundId, snapshot?.playgroundId, playgroundId, playground],
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
    const sessionKey = `${++sessionSequenceRef.current}:${playgroundId}`;
    readySessionRef.current = null;
    meaningfulManipulationTrackerRef.current.reset();
    let active = true;
    let unsubscribe = () => {};
    setSnapshot(null);
    setPlaybackError(null);
    setGuidance(null);
    setActiveDepth(null);
    setFullWorldToolsOpen(false);
    setAgentOpen(false);
    setPresentationMode(false);
    setActiveTab(initialTab);
    host.ensureOpen(playgroundId).then(() => {
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
      host.close().catch(() => {});
    };
  }, [open, playgroundId, host]);

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
    if (['PLAY', 'SCRIPT_PLAY', 'STEP', 'SCRIPT_STEP', 'RESET', 'SCRIPT_RESET'].includes(action.type)) {
      setPlaybackError(null);
    }
    return dispatchWithFirstMeaningfulManipulation({
      action,
      dispatch: (nextAction) => host.dispatch(nextAction),
      tracker: meaningfulManipulationTrackerRef.current,
      telemetry,
    }).then((result) => {
      trackCommittedExperimentAction(action, result, telemetry);
      return result;
    });
  };

  const changeDepth = (nextDepth) => {
    setAgentOpen(false);
    const telemetryType = depthTelemetryType(nextDepth);
    if (telemetryType) safeTrackExplorationEvent({ version: 1, type: telemetryType, payload: {} }, telemetry);
    setActiveDepth(nextDepth);
  };

  const openAgent = () => {
    setActiveDepth(null);
    setAgentOpen(true);
  };

  const openFullWorldWorkspaceFromTune = () => {
    const next = openFullWorldWorkspacePresentation({ fullWorldToolsOpen, activeTab, activeDepth });
    setFullWorldToolsOpen(next.fullWorldToolsOpen);
    setActiveTab(next.activeTab);
    setActiveDepth(next.activeDepth);
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
  const experimentRegion = <ExploreExperimentRegion playground={modelPlayground} snapshot={snapshot} onDispatch={dispatchAction} t={t}><ExperimentBar snapshot={snapshot} onDispatch={dispatchAction} t={t} highlightedAffordances={guidance?.affordances ?? []} /></ExploreExperimentRegion>;
  const detailsRegion = <ExploreDetailsRegion snapshot={snapshot} modelPlayground={modelPlayground} bigIdea={bigIdea} agent={agent} host={host} activeDepth={activeDepth} onDepthChange={changeDepth} agentOpen={agentOpen} onAgentOpen={openAgent} onAgentClose={() => setAgentOpen(false)} onDispatch={dispatchAction} onGuidanceChange={setGuidance} formulaPrimitive={formulaPrimitive} onOpenWorldTools={openFullWorldWorkspaceFromTune} t={t} />;
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
