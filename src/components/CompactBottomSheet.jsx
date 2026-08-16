import { useEffect, useRef, useState } from 'react';
import { MOTION_TOKENS, REDUCED_MOTION_QUERY } from './playground/motion.js';
import { resolveCompactSheetGesture } from '../core/ui/compactSheetGesture.js';

export function useCompactSheetDismissGesture({ compact, open = true, onClose }) {
  const [dragY, setDragY] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const gestureRef = useRef(null);
  const mouseCleanupRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!open) {
      gestureRef.current = null;
      mouseCleanupRef.current?.();
      mouseCleanupRef.current = null;
      setDragY(0);
    }
  }, [open]);

  useEffect(() => () => mouseCleanupRef.current?.(), []);

  const resetGesture = (event) => {
    const gesture = gestureRef.current;
    if (gesture?.captured) event?.currentTarget?.releasePointerCapture?.(gesture.pointerId);
    gestureRef.current = null;
    mouseCleanupRef.current?.();
    mouseCleanupRef.current = null;
    setDragY(0);
  };

  const beginGesture = (event, pointerId, capture) => {
    if (!compact || !open || (event.button !== undefined && event.button !== 0)) return false;
    if (capture) event.currentTarget.setPointerCapture?.(pointerId);
    gestureRef.current = {
      pointerId,
      startY: event.clientY,
      startedFromHandle: true,
      captured: capture,
    };
    return true;
  };

  const updateGesture = (event, pointerId) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return;
    const deltaY = event.clientY - gesture.startY;
    const result = resolveCompactSheetGesture({
      deltaY,
      scrollTop: 0,
      startedFromHandle: gesture.startedFromHandle,
    });
    if (!result.claimed) return;
    event.preventDefault();
    setDragY(Math.max(0, deltaY));
  };

  const finishGesture = (event, pointerId) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return;
    const deltaY = event.clientY - gesture.startY;
    const result = resolveCompactSheetGesture({
      deltaY,
      scrollTop: 0,
      startedFromHandle: gesture.startedFromHandle,
    });
    if (result.dismiss) {
      gestureRef.current = null;
      setDragY(0);
      mouseCleanupRef.current?.();
      mouseCleanupRef.current = null;
      onClose?.();
      return;
    }
    resetGesture(event);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    beginGesture(event, event.pointerId, true);
  };
  const onPointerMove = (event) => updateGesture(event, event.pointerId);
  const onPointerUp = (event) => finishGesture(event, event.pointerId);
  const onMouseDown = (event) => {
    if (gestureRef.current || !beginGesture(event, 'mouse', false) || typeof window === 'undefined') return;
    const move = (moveEvent) => updateGesture(moveEvent, 'mouse');
    const up = (upEvent) => finishGesture(upEvent, 'mouse');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    mouseCleanupRef.current = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  };

  const sheetStyle = {
    transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
    transition: dragY > 0 || reducedMotion ? 'none' : `transform ${MOTION_TOKENS.fast}ms ease-out`,
  };

  return {
    dragSurfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: resetGesture,
      onMouseDown,
      style: { touchAction: 'none' },
    },
    sheetStyle,
  };
}

export default function CompactBottomSheet({ compact, open = true, onClose, className = '', children, style, ...props }) {
  const { dragSurfaceProps, sheetStyle } = useCompactSheetDismissGesture({ compact, open, onClose });
  const mergedClassName = compact
    ? `${className} flex flex-col overflow-hidden overscroll-y-contain`
    : className;
  return <div {...props} className={mergedClassName} style={compact ? { ...style, ...sheetStyle } : style} data-compact-bottom-sheet={compact ? 'true' : undefined}>
    {compact && <div data-compact-sheet-header className="-mx-1 mb-2 flex shrink-0 justify-center py-1" aria-hidden="true" {...dragSurfaceProps}><span data-compact-sheet-handle className="h-1 w-12 rounded-full bg-slate-300" /></div>}
    {compact ? <div data-compact-sheet-scroll-region className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain" style={{ touchAction: 'pan-y' }}>{children}</div> : children}
  </div>;
}
