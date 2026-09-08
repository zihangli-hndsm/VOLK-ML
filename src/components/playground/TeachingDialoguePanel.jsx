import { useState } from 'react';
import { isTeachingDialoguePilotEnabled } from '../../core/exploration/teachingDialoguePilot.js';

export default function TeachingDialoguePanel({ snapshot, host, t, language = 'en' }) {
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [response, setResponse] = useState(null);
  const pilot = snapshot?.teachingDialogue;
  if (!isTeachingDialoguePilotEnabled() || snapshot?.bigIdea?.id !== 'episode-1-sampling-variability') return null;

  const ask = async (preferredMove = null, allowTransferHelp = false) => {
    if (busy) return;
    setBusy(true);
    try { setResponse(await host.requestTeachingDialogue?.({ requestId: `ui-${Date.now()}`, language, preferredMove, allowTransferHelp })); } finally { setBusy(false); }
  };
  const submitReply = async () => {
    if (!reply.trim()) return;
    const kind = response?.expectedReplyKind === 'reason' ? 'reason' : response?.expectedReplyKind === 'teach-back' ? 'teach-back' : 'statement';
    host.recordTeachingDialogueTurn?.({ kind, text: reply });
    setReply('');
    await ask();
  };
  const optIn = () => { host.optInTeachingDialogue?.({ language }); };
  const stop = () => { host.stopTeachingDialogue?.(); setResponse(null); };
  const tryAlone = () => { host.beginTeachingTransfer?.(); setResponse(null); };
  if (!pilot?.optedIn) return <section data-teaching-dialogue-pilot className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-3">
    <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('episode.one.teachingDialogue.title')}</p>
    <p className="mt-1 text-xs text-cyan-950">{t('episode.one.teachingDialogue.intro')}</p>
    <button type="button" onClick={optIn} className="mt-2 rounded-xl bg-cyan-700 px-3 py-1.5 text-xs font-black text-white focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('episode.one.teachingDialogue.start')}</button>
  </section>;

  return <section data-teaching-dialogue-pilot className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-3">
    <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">{t('episode.one.teachingDialogue.title')}</p><p className="mt-1 text-xs text-cyan-950">{t('episode.one.teachingDialogue.boundary')}</p></div><button type="button" onClick={stop} className="rounded-lg border border-cyan-200 bg-white px-2 py-1 text-[11px] font-bold text-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-500">{t('episode.one.teachingDialogue.stop')}</button></div>
    {response && <div className="mt-2 rounded-xl border border-cyan-100 bg-white p-2" aria-live="polite"><p className="text-sm font-bold text-slate-900">{t(response.content.key)}</p>{response.expectedReplyKind !== 'none' && <div className="mt-2 flex gap-2"><input value={reply} maxLength={240} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitReply(); }} aria-label={t('episode.one.teachingDialogue.replyLabel')} placeholder={t('episode.one.teachingDialogue.replyPlaceholder')} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-cyan-500 focus:outline-none" /><button type="button" disabled={!reply.trim()} onClick={submitReply} className="rounded-lg bg-cyan-700 px-2 py-1.5 text-xs font-black text-white disabled:opacity-40">{t('episode.one.teachingDialogue.reply')}</button></div>}</div>}
    {pilot?.transferReady && <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 p-2 text-xs text-amber-950" role="status"><p>{t('episode.one.teachingDialogue.transfer')}</p><button type="button" disabled={busy} onClick={() => ask(null, true)} className="mt-2 rounded-lg border border-amber-200 bg-white px-2 py-1.5 font-bold">{t('episode.one.teachingDialogue.askForHelp')}</button></div>}
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || pilot?.assistanceDisabled} onClick={() => ask('OFFER_HINT')} className="rounded-xl border border-cyan-200 bg-white px-3 py-1.5 text-xs font-black text-cyan-900 disabled:opacity-40">{t('episode.one.teachingDialogue.hintAction')}</button><button type="button" disabled={busy || pilot?.assistanceDisabled} onClick={() => ask('EXPLAIN_WITH_EVIDENCE')} className="rounded-xl border border-cyan-200 bg-white px-3 py-1.5 text-xs font-black text-cyan-900 disabled:opacity-40">{t('episode.one.teachingDialogue.explainAction')}</button><button type="button" disabled={pilot?.transferReady} onClick={tryAlone} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">{t('episode.one.teachingDialogue.tryAlone')}</button><button type="button" onClick={stop} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">{t('episode.one.teachingDialogue.stop')}</button></div>
  </section>;
}
