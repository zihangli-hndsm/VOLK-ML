import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { classifyPresentationCapabilities } from '../../core/ui/uiArchitecture.js';

const PresentationCapabilitiesContext = createContext(null);

function readInputCapabilities() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { pointer: 'unknown', hover: 'unknown' };
  }
  const matches = (query) => window.matchMedia(query).matches;
  return {
    pointer: matches('(pointer: coarse)') ? 'coarse' : matches('(pointer: fine)') ? 'fine' : 'unknown',
    hover: matches('(hover: none)') ? 'none' : matches('(hover: hover)') ? 'available' : 'unknown',
  };
}

function readContainer(container) {
  if (!container) return { containerWidth: null, containerHeight: null };
  const rect = container.getBoundingClientRect();
  return {
    containerWidth: Number.isFinite(rect.width) ? Math.round(rect.width) : null,
    containerHeight: Number.isFinite(rect.height) ? Math.round(rect.height) : null,
  };
}

function sameCapabilities(left, right) {
  return left.containerWidth === right.containerWidth
    && left.containerHeight === right.containerHeight
    && left.pointer === right.pointer
    && left.hover === right.hover;
}

export function useMeasuredPresentationCapabilities({ rawCapabilities } = {}) {
  const containerRef = useRef(null);
  const [measured, setMeasured] = useState({
    containerWidth: null,
    containerHeight: null,
    pointer: 'unknown',
    hover: 'unknown',
  });

  useEffect(() => {
    if (rawCapabilities) return undefined;
    const update = (size = readContainer(containerRef.current)) => {
      const next = { ...size, ...readInputCapabilities() };
      setMeasured((current) => sameCapabilities(current, next) ? current : next);
    };
    update();
    const container = containerRef.current;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => update({
        containerWidth: entries[0]?.contentRect?.width ?? null,
        containerHeight: entries[0]?.contentRect?.height ?? null,
      }))
      : null;
    observer?.observe(container);
    const queries = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? ['(pointer: coarse)', '(pointer: fine)', '(hover: none)', '(hover: hover)', '(orientation: portrait)']
        .map((query) => window.matchMedia(query))
      : [];
    const onMediaChange = () => update();
    queries.forEach((query) => query.addEventListener?.('change', onMediaChange));
    window.addEventListener?.('resize', onMediaChange);
    return () => {
      observer?.disconnect();
      queries.forEach((query) => query.removeEventListener?.('change', onMediaChange));
      window.removeEventListener?.('resize', onMediaChange);
    };
  }, [rawCapabilities]);

  const effectiveRaw = rawCapabilities ?? measured;
  const responsive = useMemo(
    () => classifyPresentationCapabilities(effectiveRaw),
    [effectiveRaw.containerWidth, effectiveRaw.containerHeight, effectiveRaw.pointer, effectiveRaw.hover, effectiveRaw.orientation],
  );
  return { containerRef, rawCapabilities: effectiveRaw, responsive };
}

export function PresentationCapabilitiesProvider({ value, children }) {
  return <PresentationCapabilitiesContext.Provider value={value}>{children}</PresentationCapabilitiesContext.Provider>;
}

export function usePresentationCapabilities() {
  return useContext(PresentationCapabilitiesContext) ?? {
    rawCapabilities: { containerWidth: null, containerHeight: null, pointer: 'unknown', hover: 'unknown' },
    responsive: classifyPresentationCapabilities(),
  };
}
