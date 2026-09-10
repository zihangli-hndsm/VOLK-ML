import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearAiKey, isAiConfigured, normalizeAiConfig } from '../../core/ai/aiSettings.js';
import { createProviderGateway } from '../../core/ai/providerRegistry.js';
import { useVolkCloudOptional } from '../../services/volkCloud/VolkCloudContext.jsx';

const AiProviderContext = createContext(null);

export function AiProvider({ children }) {
  const cloud = useVolkCloudOptional() ?? { canUseCloudAi: false, cloudAiGateway: null, cloudStatus: { status: 'not-configured' }, accountStatus: 'unconfigured', wallet: null };
  const [config, setConfigState] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fundingMode, setFundingMode] = useState('byok');
  const byokGateway = useMemo(() => createProviderGateway(), []);
  const [usageSummary, setUsageSummary] = useState(() => byokGateway.getUsageSummary?.() ?? null);
  useEffect(() => byokGateway.subscribeUsage?.(setUsageSummary), [byokGateway]);
  const gateway = fundingMode === 'cloud' && cloud.canUseCloudAi ? cloud.cloudAiGateway : byokGateway;
  const value = useMemo(() => ({
    config,
    gateway,
    byokGateway,
    cloudGateway: cloud.cloudAiGateway,
    fundingMode,
    setFundingMode: (next) => setFundingMode(next === 'cloud' && cloud.canUseCloudAi ? 'cloud' : 'byok'),
    cloudAccountState: cloud.accountStatus,
    cloudStatus: cloud.cloudStatus,
    cloudWallet: cloud.wallet,
    canUseCloudAi: cloud.canUseCloudAi,
    usageSummary: usageSummary ?? byokGateway.getUsageSummary?.() ?? null,
    isConfigured: fundingMode === 'cloud' ? cloud.canUseCloudAi : isAiConfigured(config),
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    setConfig: (next) => { byokGateway.resetUsage?.(); setConfigState(normalizeAiConfig(next)); setFundingMode('byok'); },
    clearKey: () => { byokGateway.resetUsage?.(); setConfigState((current) => clearAiKey(current)); },
    clearConfig: () => { byokGateway.resetUsage?.(); setConfigState(null); setFundingMode('byok'); },
  }), [config, gateway, byokGateway, cloud, fundingMode, settingsOpen, usageSummary]);
  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider() {
  const value = useContext(AiProviderContext);
  if (!value) throw new Error('useAiProvider must be used inside AiProvider');
  return value;
}
