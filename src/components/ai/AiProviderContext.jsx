import { createContext, useContext, useMemo, useState } from 'react';
import { clearAiKey, isAiConfigured, normalizeAiConfig } from '../../core/ai/aiSettings.js';
import { createProviderGateway } from '../../core/ai/providerRegistry.js';

const AiProviderContext = createContext(null);

export function AiProvider({ children }) {
  const [config, setConfigState] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gateway = useMemo(() => createProviderGateway(), []);
  const value = useMemo(() => ({
    config,
    gateway,
    isConfigured: isAiConfigured(config),
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    setConfig: (next) => setConfigState(normalizeAiConfig(next)),
    clearKey: () => setConfigState((current) => clearAiKey(current)),
    clearConfig: () => setConfigState(null),
  }), [config, gateway, settingsOpen]);
  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider() {
  const value = useContext(AiProviderContext);
  if (!value) throw new Error('useAiProvider must be used inside AiProvider');
  return value;
}
