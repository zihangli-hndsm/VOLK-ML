import { useEffect, useState } from 'react';
import { changeAiProtocol, defaultAiConfig, endpointSafety } from '../core/ai/aiSettings.js';
import { getProviderProtocol, listProviderProtocols } from '../core/ai/providerRegistry.js';
import { getProviderPreset, listProviderPresets } from '../core/ai/providerPresets.js';
import { probeProviderConnection } from '../core/ai/connectionProbe.js';
import { createAiDiagnostic, diagnosticText } from '../core/ai/diagnostics.js';
import { useAiProvider } from './ai/AiProviderContext.jsx';

export default function AiSettingsDialog({ t }) {
  const { config, gateway, settingsOpen, closeSettings, setConfig, clearKey, clearConfig } = useAiProvider();
  const [draft, setDraft] = useState(defaultAiConfig());
  const [advanced, setAdvanced] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settingsOpen) {
      const next = config ?? defaultAiConfig();
      setDraft(next);
      setCustomModel(!getProviderPreset(next.vendorId)?.models.some((item) => item.id === next.model));
      setDiagnostic(null);
    }
  }, [settingsOpen, config]);

  if (!settingsOpen) return null;
  const selectedPreset = getProviderPreset(draft.vendorId);
  const selectedProtocol = getProviderProtocol(draft.protocol) ?? getProviderProtocol('openai-compatible');
  const safety = endpointSafety(draft.endpoint);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const selectPreset = (vendorId) => {
    if (vendorId === '__custom__') {
      setDraft((current) => ({ ...current, vendorId: null, presetId: null, protocol: 'openai-compatible' }));
      setCustomModel(true);
      setDiagnostic(null);
      return;
    }
    const preset = getProviderPreset(vendorId);
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      vendorId: preset.vendorId,
      presetId: preset.vendorId,
      protocol: preset.protocolId,
      endpoint: preset.endpoint,
      model: preset.models[0]?.id ?? '',
      apiKey: '',
    }));
    setCustomModel(false);
    setDiagnostic(null);
  };
  const selectModel = (modelId) => {
    if (modelId === '__custom__') {
      setCustomModel(true);
      update('model', '');
      return;
    }
    setCustomModel(false);
    update('model', modelId);
  };
  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await probeProviderConnection({ gateway, config: draft });
      setDiagnostic(result);
    } catch (error) {
      setDiagnostic({ version: 1, status: 'failed', stages: [{ id: 'failed', status: 'failed', diagnostic: createAiDiagnostic({ error, config: draft, stage: 'failed' }) }] });
    } finally {
      setTesting(false);
    }
  };
  const copyDiagnostics = async () => {
    const failed = diagnostic?.stages?.find((item) => item.status === 'failed')?.diagnostic;
    if (failed && navigator.clipboard?.writeText) await navigator.clipboard.writeText(diagnosticText(failed));
  };

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-4" onMouseDown={closeSettings}>
    <section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-2xl font-black">{t('ai.settingsTitle')}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t('ai.settingsDescription')}</p></div>
        <button aria-label={t('common.close')} onClick={closeSettings} className="rounded-full bg-slate-100 px-3 py-2 font-bold">×</button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-600">{t('ai.vendor')}
          <select value={draft.vendorId ?? '__custom__'} onChange={(event) => selectPreset(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
            {!draft.vendorId && <option value="__custom__">{t('ai.provider.openaiCompatible')}</option>}
            {listProviderPresets().map((preset) => <option key={preset.vendorId} value={preset.vendorId}>{t(preset.labelKey)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">{t('ai.modelPreset')}
          {!customModel && selectedPreset ? <select value={draft.model} onChange={(event) => selectModel(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
            {selectedPreset.models.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}
            <option value="__custom__">{t('ai.customModel')}</option>
          </select> : <input value={draft.model} onChange={(event) => update('model', event.target.value)} placeholder={selectedProtocol.defaultModel} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />}
        </label>
        <label className="text-xs font-bold text-slate-600">{t('ai.apiKey')}
          <input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => update('apiKey', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs" />
        </label>
        <label className="text-xs font-bold text-slate-600">{t('ai.displayName')}
          <input value={draft.displayName} onChange={(event) => update('displayName', event.target.value)} placeholder={t('ai.displayNamePlaceholder')} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <div className="sm:col-span-2">
          <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)} className="rounded-lg px-2 py-1 text-xs font-black text-slate-600 hover:bg-slate-100">{t('ai.advanced')}</button>
          {advanced && <div className="mt-2 grid gap-3 rounded-2xl bg-slate-50 p-3">
            <label className="text-xs font-bold text-slate-600">{t('ai.protocol')}
              <select value={draft.protocol} onChange={(event) => setDraft((current) => ({ ...changeAiProtocol(current, event.target.value), vendorId: current.vendorId, presetId: current.presetId, apiKey: current.apiKey }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                {listProviderProtocols().map((protocol) => <option key={protocol.id} value={protocol.id}>{t(protocol.labelKey)}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">{t('ai.endpoint')}
              <input value={draft.endpoint} onChange={(event) => update('endpoint', event.target.value)} placeholder={selectedProtocol.defaultEndpoint} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs" />
            </label>
          </div>}
        </div>
        {safety.kind === 'insecure' && <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">{t('ai.endpointWarning')}</p>}
        {safety.kind === 'invalid' && <p className="sm:col-span-2 rounded-xl bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{t('ai.endpointInvalid')}</p>}
      </div>
      {diagnostic && <section className={`mt-4 rounded-2xl p-3 text-xs ${diagnostic.status === 'ready' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`} aria-live="polite">
        <p className="font-black">{diagnostic.status === 'ready' ? t('ai.connectionReady') : t('ai.connectionFailed')}</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">{diagnostic.stages.map((item) => <div key={item.id} className="flex items-center justify-between gap-2"><span>{t(`ai.stage.${item.id}`)}</span><span className="font-black">{t(`ai.stage.${item.status}`)}</span></div>)}</div>
        {diagnostic.status !== 'ready' && <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={copyDiagnostics} className="rounded-lg bg-white px-2 py-1 font-black">{t('ai.copyDiagnostics')}</button><details><summary className="cursor-pointer px-2 py-1 font-black">{t('ai.showDetails')}</summary><pre className="mt-2 max-w-full whitespace-pre-wrap">{diagnostic.stages.find((item) => item.status === 'failed')?.diagnostic?.providerMessage ?? ''}</pre></details></div>}
      </section>}
      <p className="mt-4 rounded-2xl bg-slate-100 p-3 text-xs leading-5 text-slate-600">{t('ai.memoryBoundary')}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { clearKey(); setDraft((current) => ({ ...current, apiKey: '' })); }} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{t('ai.clearKey')}</button>
          <button onClick={() => { clearConfig(); closeSettings(); }} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{t('ai.clearConfig')}</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={testing || !draft.model.trim() || !draft.apiKey.trim() || !safety.safe} onClick={testConnection} className="rounded-xl bg-violet-100 px-4 py-2 text-sm font-bold text-violet-800 disabled:opacity-40">{testing ? t('ai.testingConnection') : t('ai.testConnection')}</button>
          <button onClick={closeSettings} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">{t('common.cancel')}</button>
          <button disabled={!draft.model.trim() || !draft.apiKey.trim() || !safety.safe} onClick={() => { setConfig(draft); closeSettings(); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t('ai.save')}</button>
        </div>
      </div>
    </section>
  </div>;
}
