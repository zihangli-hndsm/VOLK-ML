import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearAiKey, isAiConfigured, normalizeAiConfig } from '../../core/ai/aiSettings.js';
import { createProviderGateway } from '../../core/ai/providerRegistry.js';

const AiProviderContext = createContext(null);

export function AiProvider({ children }) {
  const [config, setConfigState] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gateway = useMemo(() => createProviderGateway(), []);
  const [usageSummary, setUsageSummary] = useState(() => gateway.getUsageSummary?.() ?? null);
  useEffect(() => gateway.subscribeUsage?.(setUsageSummary), [gateway]);
  const value = useMemo(() => ({
    config,
    gateway,
    usageSummary: usageSummary ?? gateway.getUsageSummary?.() ?? null,
    isConfigured: isAiConfigured(config),
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    setConfig: (next) => { gateway.resetUsage?.(); setConfigState(normalizeAiConfig(next)); },
    clearKey: () => { gateway.resetUsage?.(); setConfigState((current) => clearAiKey(current)); },
    clearConfig: () => { gateway.resetUsage?.(); setConfigState(null); },
  }), [config, gateway, settingsOpen, usageSummary]);
  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider() {
  const value = useContext(AiProviderContext);
  if (!value) throw new Error('useAiProvider must be used inside AiProvider');
  return value;
}
