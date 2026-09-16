import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createCloudAiGateway, createVolkCloudClientForConfig, entitlementStatus, resolveVolkCloudConfig, checkVolkCloudHealth, CLOUD_AVAILABILITY } from './index.js';

const VolkCloudContext = createContext(null);

export function VolkCloudProvider({ children }) {
  const config = useMemo(() => resolveVolkCloudConfig(), []);
  const client = useMemo(() => createVolkCloudClientForConfig(config), [config]);
  const [cloudStatus, setCloudStatus] = useState({ status: client ? CLOUD_AVAILABILITY.CHECKING : CLOUD_AVAILABILITY.NOT_CONFIGURED });
  const [session, setSession] = useState(null);
  const [accountSnapshot, setAccountSnapshot] = useState(null);
  const [accountStatus, setAccountStatus] = useState(config.configured && client ? 'signed-out' : 'unconfigured');
  const [accountError, setAccountError] = useState(null);

  useEffect(() => {
    if (!client) return undefined;
    let active = true;
    checkVolkCloudHealth(client).then((next) => { if (active) setCloudStatus(next); });
    return () => { active = false; };
  }, [client]);

  const refreshAccount = async (token = session?.accessToken) => {
    if (!client || !token) return null;
    setAccountStatus('loading');
    try {
      const snapshot = await client.getAccountSnapshot({ accessToken: token });
      setAccountSnapshot(snapshot);
      setAccountStatus(entitlementStatus(snapshot));
      setAccountError(null);
      return snapshot;
    } catch (error) {
      setAccountError(error);
      if (error?.code === 'VOLK_CLOUD_AUTH_REQUIRED') { setSession(null); setAccountSnapshot(null); setAccountStatus('signed-out'); }
      else setAccountStatus('error');
      return null;
    }
  };

  const login = async ({ username, password }) => {
    if (!client) throw Object.assign(new Error('VOLK_CLOUD_UNAVAILABLE'), { code: 'VOLK_CLOUD_UNAVAILABLE' });
    setAccountStatus('loading');
    try {
      const result = await client.login({ username, password });
      setSession({ accessToken: result.accessToken, tokenType: result.tokenType, account: result.account });
      await refreshAccount(result.accessToken);
      return result;
    } catch (error) {
      setAccountError(error); setAccountStatus('error'); throw error;
    }
  };

  const register = async ({ username, password }) => {
    if (!client) throw Object.assign(new Error('VOLK_CLOUD_UNAVAILABLE'), { code: 'VOLK_CLOUD_UNAVAILABLE' });
    setAccountStatus('loading');
    try {
      const result = await client.register({ username, password });
      setSession({ accessToken: result.accessToken, tokenType: result.tokenType, account: result.account });
      await refreshAccount(result.accessToken);
      return result;
    } catch (error) {
      setAccountError(error); setAccountStatus('error'); throw error;
    }
  };

  const reissueRecoveryCode = async ({ currentPassword }) => {
    if (!client || !session?.accessToken) throw Object.assign(new Error('VOLK_CLOUD_AUTH_REQUIRED'), { code: 'VOLK_CLOUD_AUTH_REQUIRED' });
    return client.reissueRecoveryCode({ accessToken: session.accessToken, currentPassword });
  };

  const resetPassword = async ({ username, recoveryCode, newPassword }) => {
    if (!client) throw Object.assign(new Error('VOLK_CLOUD_UNAVAILABLE'), { code: 'VOLK_CLOUD_UNAVAILABLE' });
    const result = await client.resetPassword({ username, recoveryCode, newPassword });
    setSession(null); setAccountSnapshot(null); setAccountError(null); setAccountStatus(config.configured && client ? 'signed-out' : 'unconfigured');
    return result;
  };

  const logout = async () => {
    const token = session?.accessToken;
    try { await client?.logout({ accessToken: token }); } catch { /* Session is cleared locally even if Cloud is unreachable. */ }
    setSession(null); setAccountSnapshot(null); setAccountError(null); setAccountStatus(config.configured && client ? 'signed-out' : 'unconfigured');
  };

  const redeemLumiKey = async ({ code, requestId }) => {
    if (!client || !session?.accessToken) throw Object.assign(new Error('VOLK_CLOUD_AUTH_REQUIRED'), { code: 'VOLK_CLOUD_AUTH_REQUIRED' });
    const result = await client.redeemLumiKey({ accessToken: session.accessToken, code, requestId });
    await refreshAccount();
    return result;
  };

  const cloudAiGateway = useMemo(() => createCloudAiGateway({ client, getAccessToken: () => session?.accessToken, onSettled: () => { refreshAccount(); } }), [client, session?.accessToken]);
  const wallet = accountSnapshot?.wallet ?? null;
  const value = useMemo(() => ({
    config, client, cloudStatus, isConfigured: Boolean(config.configured && client), isAvailable: cloudStatus.status === CLOUD_AVAILABILITY.AVAILABLE,
    session, accountStatus, accountError, accountSnapshot, account: accountSnapshot?.account ?? session?.account ?? null,
    entitlements: accountSnapshot?.entitlements ?? [], redemptions: accountSnapshot?.redemptions ?? [], wallet,
    canUseCloudAi: cloudStatus.status === CLOUD_AVAILABILITY.AVAILABLE && accountStatus === 'authenticated' && Number(wallet?.availableCredits) > 0,
    login, register, reissueRecoveryCode, resetPassword, logout, refreshAccount, redeemLumiKey, cloudAiGateway,
  }), [config, client, cloudStatus, session, accountStatus, accountError, accountSnapshot, wallet, cloudAiGateway]);
  return <VolkCloudContext.Provider value={value}>{children}</VolkCloudContext.Provider>;
}

export function useVolkCloud() {
  const value = useContext(VolkCloudContext);
  if (!value) throw new Error('useVolkCloud must be used inside VolkCloudProvider');
  return value;
}

export function useVolkCloudOptional() {
  return useContext(VolkCloudContext);
}
