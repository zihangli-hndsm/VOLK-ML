import { useEffect, useState } from 'react';
import { changeAiProtocol, defaultAiConfig, endpointSafety } from '../core/ai/aiSettings.js';
import { getProviderProtocol, listProviderProtocols } from '../core/ai/providerRegistry.js';
import { useAiProvider } from './ai/AiProviderContext.jsx';

export default function AiSettingsDialog({ t }) {
  const { config, settingsOpen, closeSettings, setConfig, clearKey, clearConfig } = useAiProvider();
  const [draft, setDraft] = useState(defaultAiConfig());

  useEffect(() => {
    if (settingsOpen) setDraft(config ?? defaultAiConfig());
  }, [settingsOpen, config]);

  if (!settingsOpen) return null;
  const selectedProtocol = getProviderProtocol(draft.protocol) ?? getProviderProtocol('openai-compatible');
  const safety = endpointSafety(draft.endpoint);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const selectProtocol = (protocol) => setDraft((current) => ({ ...changeAiProtocol(current, protocol), apiKey: '' }));

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-4" onMouseDown={closeSettings}>
    <section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-2xl font-black">{t('ai.settingsTitle')}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t('ai.settingsDescription')}</p></div>
        <button aria-label={t('common.close')} onClick={closeSettings} className="rounded-full bg-slate-100 px-3 py-2 font-bold">×</button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-600">{t('ai.protocol')}
          <select value={draft.protocol} onChange={(event) => selectProtocol(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
            {listProviderProtocols().map((protocol) => <option key={protocol.id} value={protocol.id}>{t(protocol.labelKey)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">{t('ai.displayName')}
          <input value={draft.displayName} onChange={(event) => update('displayName', event.target.value)} placeholder={t('ai.displayNamePlaceholder')} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-600 sm:col-span-2">{t('ai.endpoint')}
          <input value={draft.endpoint} onChange={(event) => update('endpoint', event.target.value)} placeholder={selectedProtocol.defaultEndpoint} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs" />
        </label>
        {safety.kind === 'insecure' && <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">{t('ai.endpointWarning')}</p>}
        {safety.kind === 'invalid' && <p className="sm:col-span-2 rounded-xl bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{t('ai.endpointInvalid')}</p>}
        <label className="text-xs font-bold text-slate-600">{t('ai.model')}
          <input value={draft.model} onChange={(event) => update('model', event.target.value)} placeholder={selectedProtocol.defaultModel} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-600">{t('ai.apiKey')}
          <input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => update('apiKey', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs" />
        </label>
      </div>
      <p className="mt-4 rounded-2xl bg-slate-100 p-3 text-xs leading-5 text-slate-600">{t('ai.memoryBoundary')}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { clearKey(); setDraft((current) => ({ ...current, apiKey: '' })); }} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('ai.clearKey')}</button>
          <button onClick={() => { clearConfig(); closeSettings(); }} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{t('ai.clearConfig')}</button>
        </div>
        <div className="flex gap-2">
          <button onClick={closeSettings} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">{t('common.cancel')}</button>
          <button disabled={!draft.model.trim() || !draft.apiKey.trim() || !safety.safe} onClick={() => { setConfig(draft); closeSettings(); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t('ai.save')}</button>
        </div>
      </div>
    </section>
  </div>;
}
