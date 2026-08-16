import { useEffect, useRef, useState } from 'react';
import { MOTION_TOKENS, REDUCED_MOTION_QUERY } from './playground/motion.js';
import { resolveCompactSheetGesture } from '../core/ui/compactSheetGesture.js';

export function useCompactSheetDismissGesture({ compact, open = true, onClose, sheetRef }) {
  const [dragY, setDragY] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const gestureRef = useRef(null);

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
      setDragY(0);
    }
  }, [open]);

  const resetGesture = (event) => {
    const gesture = gestureRef.current;
    if (gesture?.captured && event?.currentTarget?.releasePointerCapture?.(gesture.pointerId)) {
      // Pointer capture release is presentation cleanup only.
    }
    gestureRef.current = null;
    setDragY(0);
  };

  const onPointerDown = (event) => {
    if (!compact || !open || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = event.target instanceof Element ? event.target : null;
    const startedFromHandle = Boolean(target?.closest('[data-compact-sheet-handle], [data-compact-sheet-header]'));
    gestureRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startedFromHandle,
      startedScrollTop: sheetRef.current?.scrollTop ?? 0,
      captured: false,
    };
  };

  const onPointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - gesture.startY;
    const result = resolveCompactSheetGesture({
      deltaY,
      scrollTop: sheetRef.current?.scrollTop ?? gesture.startedScrollTop,
      startedFromHandle: gesture.startedFromHandle,
    });
    if (!result.claimed) return;
    if (!gesture.captured) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.captured = true;
    }
    event.preventDefault();
    setDragY(Math.max(0, deltaY));
  };

  const onPointerUp = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - gesture.startY;
    const result = resolveCompactSheetGesture({
      deltaY,
      scrollTop: sheetRef.current?.scrollTop ?? gesture.startedScrollTop,
      startedFromHandle: gesture.startedFromHandle,
    });
    if (result.dismiss) {
      gestureRef.current = null;
      setDragY(0);
      onClose?.();
      return;
    }
    resetGesture(event);
  };

  const style = {
    overscrollBehaviorY: 'contain',
    touchAction: 'pan-y',
    transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
    transition: dragY > 0 || reducedMotion ? 'none' : `transform ${MOTION_TOKENS.fast}ms ease-out`,
  };

  return {
    sheetProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: resetGesture,
      style,
    },
  };
}

export default function CompactBottomSheet({ compact, open = true, onClose, className = '', children, ...props }) {
  const sheetRef = useRef(null);
  const { sheetProps } = useCompactSheetDismissGesture({ compact, open, onClose, sheetRef });
  const mergedClassName = compact
    ? `${className} overflow-y-auto overscroll-y-contain`
    : className;
  return <div ref={sheetRef} {...props} {...(compact ? sheetProps : {})} className={mergedClassName} data-compact-bottom-sheet={compact ? 'true' : undefined}>
    {compact && <div data-compact-sheet-header className="-mx-1 mb-2 flex justify-center py-1" aria-hidden="true"><span data-compact-sheet-handle className="h-1 w-12 rounded-full bg-slate-300" /></div>}
    {children}
  </div>;
}
