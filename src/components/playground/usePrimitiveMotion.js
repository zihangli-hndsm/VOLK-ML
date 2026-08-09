import { useEffect, useRef, useState } from 'react';
import { easeMotionProgress, interpolatePrimitiveList } from './motion.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());


const scheduleFrame = (callback) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return { kind: 'raf', id: window.requestAnimationFrame(callback) };
  }
  return { kind: 'timeout', id: setTimeout(() => callback(now()), 16) };
};

const cancelFrame = (frame) => {
  if (!frame) return;
  if (frame.kind === 'raf') window.cancelAnimationFrame(frame.id);
  else clearTimeout(frame.id);
};

export function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reducedMotion;
}

export function usePrimitiveMotion(targetPrimitives, {
  enabled = true,
  durationMs = 320,
  easing = 'ease-out-cubic',
  reducedMotion = false,
} = {}) {
  const [frame, setFrame] = useState({ primitives: targetPrimitives, progress: 1, isAnimating: false });
  const frameRef = useRef(frame);
  const targetRef = useRef(targetPrimitives);
  const animationRef = useRef(null);

  useEffect(() => {
    const previous = frameRef.current.primitives;
    if (targetRef.current === targetPrimitives && previous === targetPrimitives) return undefined;
    targetRef.current = targetPrimitives;
    cancelFrame(animationRef.current);
    animationRef.current = null;
    if (!enabled || reducedMotion || durationMs <= 0) {
      const settled = { primitives: targetPrimitives, progress: 1, isAnimating: false };
      frameRef.current = settled;
      setFrame(settled);
      return undefined;
    }
    const start = now();
    const animate = (timestamp) => {
      const progress = Math.min(1, Math.max(0, (timestamp - start) / durationMs));
      const next = {
        primitives: interpolatePrimitiveList(previous, targetPrimitives, easeMotionProgress(progress, easing)),
        progress,
        isAnimating: progress < 1,
      };
      frameRef.current = next;
      setFrame(next);
      if (progress < 1) animationRef.current = scheduleFrame(animate);
      else animationRef.current = null;
    };
    const initial = { primitives: previous, progress: 0, isAnimating: true };
    frameRef.current = initial;
    setFrame(initial);
    animationRef.current = scheduleFrame(animate);
    return () => cancelFrame(animationRef.current);
  }, [durationMs, easing, enabled, reducedMotion, targetPrimitives]);

  return {
    primitives: frame.primitives,
    motion: {
      enabled,
      durationMs,
      easing,
      reducedMotion,
      progress: frame.progress,
      isAnimating: frame.isAnimating,
    },
  };
}
