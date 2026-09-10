import { useState } from 'react';
import { useVolkCloud } from '../services/volkCloud/VolkCloudContext.jsx';

const errorKey = (code) => ({
  VOLK_CLOUD_AUTH_REQUIRED: 'account.error.authRequired',
  VOLK_CLOUD_INSUFFICIENT_CREDITS: 'account.error.insufficientCredits',
  VOLK_CLOUD_ENTITLEMENT_REQUIRED: 'account.error.entitlementRequired',
  VOLK_CLOUD_ENTITLEMENT_EXPIRED: 'account.error.entitlementExpired',
  VOLK_CLOUD_PROVIDER_UNAVAILABLE: 'account.error.providerUnavailable',
  VOLK_CLOUD_REQUEST_TIMEOUT: 'account.error.timeout',
  VOLK_CLOUD_UNREACHABLE: 'account.error.unreachable',
  VOLK_CLOUD_INVALID_ACCESS_CODE: 'account.error.invalidCode',
}[code] ?? 'account.error.generic');

export default function AccountDialog({ t, open, onClose }) {
  const cloud = useVolkCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [code, setCode] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  if (!open) return null;
  const submitLogin = async (event) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await (registerMode ? cloud.register({ email, password }) : cloud.login({ email, password })); setPassword(''); } catch (nextError) { setError(nextError); } finally { setBusy(false); }
  };
  const redeem = async (event) => {
    event.preventDefault(); if (!code.trim()) return;
    const stableRequestId = requestId ?? `redeem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setRequestId(stableRequestId); setBusy(true); setError(null); setNotice(null);
    try { await cloud.redeemLumiKey({ code: code.trim(), requestId: stableRequestId }); setCode(''); setRequestId(null); setNotice('account.redeemSuccess'); } catch (nextError) { setError(nextError); } finally { setBusy(false); }
  };
  const close = () => { setError(null); setNotice(null); onClose(); };
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-4" onMouseDown={close}>
    <section role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><h2 id="account-dialog-title" className="text-2xl font-black">{t('account.title')}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t('account.description')}</p></div><button aria-label={t('common.close')} onClick={close} className="rounded-full bg-slate-100 px-3 py-2 font-bold">×</button></div>
      {!cloud.isConfigured ? <p className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{t('account.unavailable')}</p> : !cloud.session ? <form className="mt-5 grid gap-3" onSubmit={submitLogin}><label className="text-xs font-bold text-slate-600">{t('account.email')}<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border p-2" required /></label><label className="text-xs font-bold text-slate-600">{t('account.password')}<input type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border p-2" minLength={registerMode ? 12 : undefined} required /></label><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? t('account.loading') : registerMode ? t('account.register') : t('account.signIn')}</button><button type="button" onClick={() => { setRegisterMode((value) => !value); setError(null); }} className="text-xs font-bold text-slate-600 underline">{registerMode ? t('account.switchToSignIn') : t('account.switchToRegister')}</button></form> : <div className="mt-5 grid gap-4"><div className="rounded-2xl bg-emerald-50 p-4"><p className="font-black">{cloud.account?.email}</p><p className="mt-1 text-xs text-emerald-800">{t(`account.status.${cloud.accountStatus}`)}</p></div><div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{t('account.availableCredits')}</p><p className="mt-1 text-lg font-black">{cloud.wallet?.availableCredits ?? '—'}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{t('account.reservedCredits')}</p><p className="mt-1 text-lg font-black">{cloud.wallet?.reservedCredits ?? '—'}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{t('account.spentCredits')}</p><p className="mt-1 text-lg font-black">{cloud.wallet?.spentCredits ?? '—'}</p></div></div><form className="grid gap-2" onSubmit={redeem}><label className="text-xs font-bold text-slate-600">{t('account.redeemKey')}<input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-xl border p-2 font-mono" autoComplete="off" /></label><button disabled={busy || !code.trim()} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? t('account.loading') : t('account.redeem')}</button></form><button onClick={() => cloud.logout()} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">{t('account.signOut')}</button></div>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{t(errorKey(error.code))}</p>}
      {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800" role="status">{t(notice)}</p>}
    </section>
  </div>;
}
