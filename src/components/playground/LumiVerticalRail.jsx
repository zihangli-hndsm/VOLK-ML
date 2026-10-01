import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Lumi from './Lumi.jsx';
import { REDUCED_MOTION_QUERY } from './motion.js';
import { resolveRailPromptLayout } from '../../core/ui/railPromptLayout.js';

const POSES = Object.freeze({ AMBIENT: 'ambient', OBSERVE: 'observe', THINK: 'think', GUIDE: 'guide', NOTICE: 'notice', ILLUMINATE: 'illuminate' });

function derivePose({ hidden, paused, askBusy, eligibleConcept, targetStatus, guidanceAvailable, recentObservation }) {
  if (hidden || paused) return POSES.AMBIENT;
  if (askBusy) return POSES.THINK;
  if (eligibleConcept) return POSES.ILLUMINATE;
  if (targetStatus === 'ready' && guidanceAvailable) return POSES.GUIDE;
  if (targetStatus === 'offscreen' && guidanceAvailable) return POSES.NOTICE;
  if (recentObservation) return POSES.OBSERVE;
  return POSES.AMBIENT;
}

export default function LumiVerticalRail({
  runtime,
  semanticEvents,
  resolvedTarget,
  actionLabelKey = null,
  guidanceAvailable = false,
  presentation = null,
  paused = false,
  guidanceDismissed = false,
  explicitPromptRequest = null,
  onDismissGuidance,
  onOpenGuidance,
  t,
}) {
  const railRef = useRef(null);
  const avatarRef = useRef(null);
  const promptRef = useRef(null);
  const controlsRef = useRef(null);
  const suppressedIdentityRef = useRef(null);
  const consumedPromptRequestRef = useRef(0);
  const [position, setPosition] = useState(null);
  const [promptLayout, setPromptLayout] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const target = resolvedTarget?.target ?? null;
  const status = resolvedTarget?.status ?? 'missing';
  const targetIdentity = [runtime?.contractId ?? '', target?.key ?? '', target?.controlId ?? ''].join('|');
  const eligibleConcept = runtime?.evidence?.status === 'evidenced' && runtime?.candidateConcepts?.includes('SAMPLING_VARIABILITY');
  const lastEvent = semanticEvents?.events?.at?.(-1) ?? null;
  const recentObservation = ['observation.detected', 'comparison.completed'].includes(lastEvent?.type);
  const pose = derivePose({ hidden, paused, askBusy: Boolean(presentation?.activeRequest), eligibleConcept, targetStatus: status, guidanceAvailable, recentObservation });
  const promptAllowed = !hidden && guidanceAvailable && !paused && !guidanceDismissed && !presentation?.activeRequest && ['ready', 'offscreen'].includes(status) && Boolean(targetIdentity);
  const promptVisible = prompt === targetIdentity && promptAllowed;
  const targetDirectionKey = target?.direction === 'up' ? 'lumi.track.direction.up' : 'lumi.track.direction.down';
  const promptText = status === 'offscreen'
    ? t(targetDirectionKey)
    : actionLabelKey ? t('lumi.track.tryAction', { action: t(actionLabelKey) }) : t('lumi.track.attention');
  const viewportScroll = resolvedTarget?.updateSource === 'scroll';

  useEffect(() => {
    const requestSequence = Number(explicitPromptRequest?.sequence) || 0;
    const requestIsCurrent = requestSequence > consumedPromptRequestRef.current
      && explicitPromptRequest?.identity === targetIdentity;
    if (requestIsCurrent && promptAllowed) {
      consumedPromptRequestRef.current = requestSequence;
      if (suppressedIdentityRef.current === targetIdentity) suppressedIdentityRef.current = null;
      setPrompt(targetIdentity);
      const timer = window.setTimeout(() => {
        suppressedIdentityRef.current = targetIdentity;
        setPrompt(null);
      }, 6000);
      return () => window.clearTimeout(timer);
    }
    if (!promptAllowed || suppressedIdentityRef.current === targetIdentity) {
      setPrompt(null);
      return undefined;
    }
    setPrompt(targetIdentity);
    const timer = window.setTimeout(() => {
      suppressedIdentityRef.current = targetIdentity;
      setPrompt(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [promptAllowed, targetIdentity, explicitPromptRequest?.identity, explicitPromptRequest?.sequence]);

  useEffect(() => {
    if (guidanceDismissed && targetIdentity) suppressedIdentityRef.current = targetIdentity;
  }, [guidanceDismissed, targetIdentity]);

  useEffect(() => {
    const rail = railRef.current;
    const avatar = avatarRef.current;
    if (!rail || status !== 'ready' || !target?.geometry) {
      setPosition(null);
      return undefined;
    }
    const measure = () => {
      const railRect = rail.getBoundingClientRect();
      const avatarRect = avatar?.getBoundingClientRect();
      if (!railRect.height || !avatarRect?.height) return;
      const desired = target.geometry.top + target.geometry.height / 2 - railRect.top - avatarRect.height / 2;
      const safe = Math.min(24, railRect.height * 0.08);
      const clamped = Math.max(safe, Math.min(railRect.height - avatarRect.height - safe, desired));
      setPosition(Math.round(clamped));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(rail);
    if (avatar) observer?.observe(avatar);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [status, pose, target?.geometry?.top, target?.geometry?.height]);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const avatar = avatarRef.current;
    const promptElement = promptRef.current;
    const controls = controlsRef.current;
    if (!rail || !avatar || !promptElement || !controls) {
      setPromptLayout(null);
      return undefined;
    }
    const measure = () => {
      if (window.matchMedia('(max-width: 767px)').matches) {
        setPromptLayout(null);
        return;
      }
      const railRect = rail.getBoundingClientRect();
      const avatarRect = avatar.getBoundingClientRect();
      const avatarImageRect = avatar.querySelector('img.lumi-visual')?.getBoundingClientRect() ?? avatarRect;
      const promptRect = promptElement.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      if (!railRect.height || !promptRect.height) return;
      setPromptLayout(resolveRailPromptLayout({
        railTop: railRect.top,
        railLeft: railRect.left,
        railHeight: railRect.height,
        avatarTop: avatarRect.top,
        avatarLeft: avatarImageRect.left,
        avatarRight: avatarImageRect.right,
        avatarHeight: avatarRect.height,
        promptHeight: promptRect.height,
        controlsTop: controlsRect.top,
      }));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(rail);
    observer?.observe(avatar);
    observer?.observe(promptElement);
    observer?.observe(controls);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [promptVisible, promptText, status, pose, position]);

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches;
  const revealTarget = () => {
    if (target?.reveal?.type !== 'scroll' || target.reveal.learnerInitiated !== true) return;
    target.element?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
  };
  const dismissPrompt = () => {
    suppressedIdentityRef.current = targetIdentity;
    setPrompt(null);
    onDismissGuidance?.();
  };
  const motionClass = motionPaused || reducedMotion ? ' lumi-guide-motion-paused' : '';
  return <aside ref={railRef} data-lumi-vertical-rail="true" data-lumi-rail-target-identity={targetIdentity} data-lumi-rail-control-id={target?.controlId ?? ''} data-lumi-track-pose={pose} data-lumi-track-status={status} data-lumi-track-direction={target?.direction ?? 'none'} data-lumi-track-update={viewportScroll ? 'scroll' : 'layout'} className={`lumi-vertical-rail${motionClass}`} aria-label={t('lumi.track.label')}>
    {hidden ? <button type="button" data-lumi-rail-show onClick={() => setHidden(false)} className="lumi-rail-show">{t('lumi.track.show')}</button> : <>
      <div ref={avatarRef} data-lumi-rail-avatar="true" className={`lumi-rail-avatar lumi-rail-pose-${pose}`} style={position === null ? undefined : { top: `${position}px`, transition: viewportScroll ? 'none' : undefined }}>
        <Lumi presence="contextual" mode={pose} />
        {pose === POSES.NOTICE && <span className="lumi-rail-notice-mark" aria-hidden="true">!</span>}
      </div>
      {promptVisible && <div ref={promptRef} data-lumi-rail-prompt="true" data-lumi-rail-prompt-placement="sidecar" data-lumi-rail-prompt-compact={promptLayout?.compact ? 'true' : 'false'} data-lumi-rail-prompt-identity={targetIdentity} className="lumi-rail-prompt" style={promptLayout ? { insetInlineStart: `${promptLayout.left}px`, top: `${promptLayout.top}px`, maxHeight: `${promptLayout.maxHeight}px` } : undefined} role="group" aria-label={promptText}>
        <p className="text-xs font-black leading-5 text-slate-800">{promptText}</p>
        {status === 'offscreen' && <button type="button" data-lumi-rail-reveal onClick={revealTarget} className="mt-2 w-full rounded-lg bg-cyan-700 px-2 py-2 text-xs font-black text-white focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('lumi.track.bringMeThere')}</button>}
        {status === 'ready' && onOpenGuidance && <button type="button" data-lumi-rail-ask onClick={onOpenGuidance} className="mt-2 w-full rounded-lg border border-cyan-200 bg-white px-2 py-2 text-xs font-black text-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('lumi.track.ask')}</button>}
        <button type="button" data-lumi-rail-dismiss onClick={dismissPrompt} aria-label={t('lumi.track.close')} className="lumi-rail-dismiss">×</button>
      </div>}
      <div ref={controlsRef} className="lumi-rail-controls" style={promptLayout ? { insetInlineStart: `${promptLayout.left}px` } : undefined}>
        <button type="button" data-lumi-rail-motion aria-pressed={motionPaused} onClick={() => setMotionPaused((value) => !value)}>{t(motionPaused ? 'lumi.track.resumeMotion' : 'lumi.track.pauseMotion')}</button>
        <button type="button" data-lumi-rail-hide onClick={() => { setHidden(true); setPrompt(null); }}>{t('lumi.track.hide')}</button>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{targetIdentity && status === 'ready' && promptVisible ? promptText : ''}</span>
    </>}
  </aside>;
}
