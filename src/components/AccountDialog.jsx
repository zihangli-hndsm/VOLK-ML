import { useEffect, useState } from 'react';
import { useVolkCloud } from '../services/volkCloud/VolkCloudContext.jsx';
import { createRecoveryPresentationState, transitionRecoveryPresentation } from '../services/volkCloud/recoveryPresentation.js';

const errorKey = (code) => ({
  VOLK_CLOUD_AUTH_REQUIRED: 'account.error.authRequired', VOLK_CLOUD_INSUFFICIENT_CREDITS: 'account.error.insufficientCredits',
  VOLK_CLOUD_ENTITLEMENT_REQUIRED: 'account.error.entitlementRequired', VOLK_CLOUD_ENTITLEMENT_EXPIRED: 'account.error.entitlementExpired',
  VOLK_CLOUD_PROVIDER_UNAVAILABLE: 'account.error.providerUnavailable', VOLK_CLOUD_REQUEST_TIMEOUT: 'account.error.timeout',
  VOLK_CLOUD_UNREACHABLE: 'account.error.unreachable', VOLK_CLOUD_INVALID_ACCESS_CODE: 'account.error.invalidCode',
}[code] ?? 'account.error.generic');

export default function AccountDialog({ t, open, onClose }) {
  const cloud = useVolkCloud();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [recoveryPresentation, setRecoveryPresentation] = useState(createRecoveryPresentationState);
  const visibleRecoveryCode = recoveryPresentation.code;
  const clearRecovery = (type = 'LEAVE_CONTEXT') => setRecoveryPresentation((state) => transitionRecoveryPresentation(state, { type }));
  const [code, setCode] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!cloud.session && !recoveryMode && recoveryPresentation.code) clearRecovery('AUTH_INVALIDATED');
  }, [cloud.session, cloud.accountStatus, recoveryMode, recoveryPresentation.code]);
  if (!open) return null;
  const submitAuth = async (event) => {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null); clearRecovery();
    try {
      const result = registerMode ? await cloud.register({ username, password }) : await cloud.login({ username, password });
      setPassword('');
      if (registerMode) setRecoveryPresentation((state) => transitionRecoveryPresentation(state, { type: 'ISSUED', code: result.recoveryCode }));
    } catch (nextError) { setError(nextError); } finally { setBusy(false); }
  };
  const submitReissue = async (event) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { const result = await cloud.reissueRecoveryCode({ currentPassword }); setCurrentPassword(''); setRecoveryPresentation((state) => transitionRecoveryPresentation(state, { type: 'REISSUED', code: result.recoveryCode })); } catch (nextError) { setError(nextError); } finally { setBusy(false); }
  };
  const submitReset = async (event) => {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try { const result = await cloud.resetPassword({ username, recoveryCode, newPassword }); setRecoveryCode(''); setNewPassword(''); setRecoveryPresentation((state) => transitionRecoveryPresentation(state, { type: 'RESET_COMPLETED', code: result.recoveryCode })); setNotice('account.resetSuccess'); } catch (nextError) { setError(nextError); } finally { setBusy(false); }
  };
  const redeem = async (event) => {
    event.preventDefault(); if (!code.trim()) return;
    const stableRequestId = requestId ?? `redeem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setRequestId(stableRequestId); setBusy(true); setError(null); setNotice(null);
    try { await cloud.redeemLumiKey({ code: code.trim(), requestId: stableRequestId }); setCode(''); setRequestId(null); setNotice('account.redeemSuccess'); } catch (nextError) { setError(nextError); } finally { setBusy(false); }
  };
  const copyRecovery = async () => { if (!visibleRecoveryCode) return; try { await navigator.clipboard?.writeText(visibleRecoveryCode); setNotice('account.recoveryCopied'); } catch { setNotice('account.recoveryCopyUnavailable'); } };
  const downloadRecovery = () => { if (!visibleRecoveryCode) return; const blob = new Blob([visibleRecoveryCode], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'volk-recovery-code.txt'; anchor.click(); URL.revokeObjectURL(url); setNotice('account.recoveryDownloaded'); };
  const close = () => { clearRecovery('DISMISS'); setError(null); setNotice(null); setRecoveryMode(false); onClose(); };
  const signOut = () => { clearRecovery('SIGN_OUT'); setRecoveryMode(false); void cloud.logout(); };
  const wipeNotice = <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t('account.wipeNotice')}</p>;
  const recoveryPanel = visibleRecoveryCode && <section className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" aria-live="polite"><h3 className="font-black text-amber-950">{t('account.recoveryTitle')}</h3><p className="mt-1 text-xs leading-5 text-amber-900">{t('account.recoveryOnce')}</p><code className="mt-3 block break-all rounded-xl bg-white p-3 font-mono text-sm font-black text-slate-900">{visibleRecoveryCode}</code><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={copyRecovery} className="rounded-xl bg-white px-3 py-2 text-xs font-bold">{t('account.copyRecovery')}</button><button type="button" onClick={downloadRecovery} className="rounded-xl bg-white px-3 py-2 text-xs font-bold">{t('account.downloadRecovery')}</button></div></section>;
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-4" onMouseDown={close}><section role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h2 id="account-dialog-title" className="text-2xl font-black">{t('account.title')}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t('account.description')}</p></div><button aria-label={t('common.close')} onClick={close} className="rounded-full bg-slate-100 px-3 py-2 font-bold">×</button></div>
      {!cloud.isConfigured ? <p className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{t('account.unavailable')}</p> : recoveryMode ? <>{wipeNotice}<form className="mt-4 grid gap-3" onSubmit={submitReset}><label className="text-xs font-bold text-slate-600">{t('account.username')}<input value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-xl border p-2" autoComplete="username" required /></label><label className="text-xs font-bold text-slate-600">{t('account.recoveryCode')}<input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} className="mt-1 w-full rounded-xl border p-2 font-mono" autoComplete="off" required /></label><label className="text-xs font-bold text-slate-600">{t('account.newPassword')}<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-xl border p-2" autoComplete="new-password" minLength={12} required /></label><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? t('account.loading') : t('account.resetPassword')}</button><button type="button" onClick={() => { setRecoveryMode(false); clearRecovery(); }} className="text-xs font-bold text-slate-600 underline">{t('account.backToSignIn')}</button></form></> : !cloud.session ? <>{wipeNotice}<form className="mt-4 grid gap-3" onSubmit={submitAuth}><label className="text-xs font-bold text-slate-600">{t('account.username')}<input value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-xl border p-2" autoComplete="username" required /></label><label className="text-xs font-bold text-slate-600">{t('account.password')}<input type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border p-2" minLength={registerMode ? 12 : undefined} required /></label><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? t('account.loading') : registerMode ? t('account.register') : t('account.signIn')}</button><button type="button" onClick={() => { setRegisterMode((value) => !value); setError(null); clearRecovery(); }} className="text-xs font-bold text-slate-600 underline">{registerMode ? t('account.switchToSignIn') : t('account.switchToRegister')}</button><button type="button" onClick={() => { setRecoveryMode(true); setError(null); clearRecovery(); }} className="text-xs font-bold text-slate-600 underline">{t('account.forgotPassword')}</button></form></> : <div className="mt-5 grid gap-4"><div className="rounded-2xl bg-emerald-50 p-4"><p className="font-black">{cloud.account?.username}</p><p className="mt-1 text-xs text-emerald-800">{t(`account.status.${cloud.accountStatus}`)}</p></div><div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{t('account.availableCredits')}</p><p className="mt-1 text-lg font-black">{cloud.wallet?.availableCredits ?? '—'}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{t('account.reservedCredits')}</p><p className="mt-1 text-lg font-black">{cloud.wallet?.reservedCredits ?? '—'}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{t('account.spentCredits')}</p><p className="mt-1 text-lg font-black">{cloud.wallet?.spentCredits ?? '—'}</p></div></div>{wipeNotice}<form className="grid gap-2" onSubmit={redeem}><label className="text-xs font-bold text-slate-600">{t('account.redeemKey')}<input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-xl border p-2 font-mono" autoComplete="off" /></label><button disabled={busy || !code.trim()} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? t('account.loading') : t('account.redeem')}</button></form><form className="grid gap-2 rounded-2xl bg-slate-50 p-3" onSubmit={submitReissue}><label className="text-xs font-bold text-slate-600">{t('account.currentPassword')}<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 w-full rounded-xl border p-2" autoComplete="current-password" required /></label><button disabled={busy} className="rounded-xl bg-white px-3 py-2 text-xs font-bold">{t('account.reissueRecovery')}</button></form><button onClick={signOut} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold">{t('account.signOut')}</button></div>}
    {recoveryPanel}{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{t(errorKey(error.code))}</p>}{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800" role="status">{t(notice)}</p>}</section></div>;
}
