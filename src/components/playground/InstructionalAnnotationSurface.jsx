import { useCallback, useEffect, useState } from 'react';

const MAX_SELECTED_QUOTE = 280;

export function instructionalAnchor({ surface, contentId, messageId = null, localizationKey = null } = {}) {
  return {
    surface,
    contentId,
    ...(messageId ? { messageId } : {}),
    ...(localizationKey ? { localizationKey } : {}),
  };
}

export function selectedTextWithin(target) {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return '';
  const selection = window.getSelection();
  const text = String(selection?.toString() ?? '').trim().slice(0, MAX_SELECTED_QUOTE);
  if (!text || !selection?.anchorNode || !target?.contains?.(selection.anchorNode)) return '';
  return text;
}

export function useInstructionalSelection({ surface, contentId, messageId = null, localizationKey = null, initialSelection = null } = {}) {
  const [selection, setSelection] = useState(initialSelection ?? null);
  const captureSelection = useCallback((event) => {
    const quote = selectedTextWithin(event?.currentTarget);
    if (!quote) return null;
    const next = { messageId, anchor: instructionalAnchor({ surface, contentId, messageId, localizationKey }), quote };
    setSelection(next);
    return next;
  }, [contentId, localizationKey, messageId, surface]);
  useEffect(() => {
    setSelection(initialSelection ?? null);
  }, [initialSelection?.messageId, initialSelection?.quote, initialSelection?.anchor?.contentId]);
  useEffect(() => {
    if (initialSelection?.anchor?.contentId === contentId && initialSelection?.messageId === messageId) return;
    setSelection(null);
  }, [contentId, initialSelection?.anchor?.contentId, initialSelection?.messageId, messageId, surface]);
  return { selection, captureSelection, clearSelection: () => setSelection(null) };
}

export function InstructionalAnnotationActions({ selection, agent, onAskAbout, t }) {
  const [message, setMessage] = useState('');
  if (!selection?.quote) return null;
  const annotate = (kind) => {
    try {
      agent?.addLearnerAnnotation?.({ kind, anchor: selection.anchor, quote: selection.quote });
      setMessage(t('ai.annotationSaved'));
    } catch {
      setMessage(t('ai.annotationUnavailable'));
    }
  };
  return <div className="mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-950" data-annotation-actions="true">
    <p className="font-bold">{selection.quote}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={() => annotate('understood')} className="rounded-lg bg-white px-2 py-1 font-bold ring-1 ring-violet-200">{t('ai.annotationUnderstood')}</button>
      <button type="button" onClick={() => annotate('unclear')} className="rounded-lg bg-white px-2 py-1 font-bold ring-1 ring-violet-200">{t('ai.annotationUnclear')}</button>
      <button type="button" onClick={() => onAskAbout?.(selection)} className="rounded-lg bg-white px-2 py-1 font-bold ring-1 ring-violet-200">{t('ai.annotationAsk')}</button>
    </div>
    {message && <p className="mt-2 font-bold text-emerald-700">{message}</p>}
  </div>;
}

export default function InstructionalAnnotationSurface({ surface, contentId, messageId = null, localizationKey = null, initialSelection = null, agent, onAskAbout, t, children, className = '' }) {
  const { selection, captureSelection } = useInstructionalSelection({ surface, contentId, messageId, localizationKey, initialSelection });
  return <div className={className} onMouseUp={captureSelection} onTouchEnd={captureSelection}>
    {children}
    <InstructionalAnnotationActions selection={selection} agent={agent} onAskAbout={onAskAbout} t={t} />
  </div>;
}
