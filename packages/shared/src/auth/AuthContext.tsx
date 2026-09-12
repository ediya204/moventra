import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, browserPopupRedirectResolver, signInWithPopup, getMultiFactorResolver, onIdTokenChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, TotpMultiFactorGenerator, type MultiFactorError, type MultiFactorResolver, type User } from 'firebase/auth';
import { clearAccessToken, setAccessToken } from '../api/client';
import { login as legacyLogin } from '../api/queries';
import { getFirebaseAuth } from '../firebase';
import { isDemoMode } from '../utils/dataMode';
import { isAdminSite, sessionPath } from './site';
import { liveGet, SessionError, type LiveSession } from './liveApi';
import type { SessionProfile } from '../types';

export const usesFirebaseAuth = !(import.meta.env.DEV && isDemoMode);
type AuthContextValue = {
  profile: SessionProfile | null; authenticated: boolean; user: User | null;
  ready: boolean; session: LiveSession | null; sessionError: unknown; loginError: unknown;
  factors: { uid: string; name: string }[];
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  completeMfa: (factorId: string, code: string) => Promise<void>;
  refreshSession: () => Promise<void>; signOut: () => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [loginError, setLoginError] = useState<unknown>(null);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [ready, setReady] = useState(!usesFirebaseAuth);
  const [factors, setFactors] = useState<{ uid: string; name: string }[]>([]);
  const resolver = useRef<MultiFactorResolver | null>(null);
  const generation = useRef(0);
  const loadSession = useCallback(async (current: User | null) => {
    const request = ++generation.current;
    setReady(false); setUser(isAdminSite ? null : current); setProfile(null); setSession(null); setSessionError(null);
    try {
      if (!current) return;
      if (!current.emailVerified) { setUser(current); setSessionError({ code: 'email_unverified' }); return; }
      const data = await liveGet<LiveSession>(sessionPath);
      if (request !== generation.current || getFirebaseAuth().currentUser !== current) return;
      if (data.role !== (isAdminSite ? 'admin' : 'customer')) throw new SessionError(isAdminSite ? 'operator_required' : 'customer_required', 403);
      setUser(current); setSession(data);
      if (!isAdminSite || data.mfaVerified === true) setProfile({ username: current.email || '', nickname: current.displayName || undefined, roles: [data.role], permissions: [] });
    } catch (error) {
      if (request !== generation.current) return;
      if (isAdminSite || (error instanceof SessionError && error.code === 'customer_required')) {
        // Firebase identity alone is never an admitted admin session.
        setLoginError(error); setUser(null); setSession(null); setProfile(null);
        if (getFirebaseAuth().currentUser === current) await firebaseSignOut(getFirebaseAuth());
      } else setSessionError(error);
    }
    finally { if (request === generation.current) setReady(true); }
  }, []);
  useEffect(() => {
    if (!usesFirebaseAuth) return;
    const unsubscribe = onIdTokenChanged(getFirebaseAuth(), current => { void loadSession(current); });
    return () => { generation.current++; unsubscribe(); };
  }, [loadSession]);
  const refreshSession = useCallback(async () => {
    const current = getFirebaseAuth().currentUser;
    if (current) { await current.reload(); await current.getIdToken(true); }
    await loadSession(current);
  }, [loadSession]);
  const handleMfaError = useCallback((error: unknown) => {
      if ((error as {code?: string}).code !== 'auth/multi-factor-auth-required') throw error;
      const pending = getMultiFactorResolver(getFirebaseAuth(), error as MultiFactorError);
      const hints = pending.hints.filter(f => f.factorId === TotpMultiFactorGenerator.FACTOR_ID).map(f => ({ uid: f.uid, name: f.displayName || '验证器' }));
      if (!hints.length) throw new Error('Unsupported MFA factor');
      resolver.current = pending; setFactors(hints);
  }, []);
  const signIn = useCallback(async (email: string, password: string) => {
    if (!usesFirebaseAuth) {
      const result = await legacyLogin(email, password); setAccessToken(result.accessToken);
      setProfile({ username: result.username || email, nickname: result.nickname, avatar: result.avatar, roles: result.roles || [], permissions: result.permissions || [] }); return;
    }
    setLoginError(null); resolver.current = null; setFactors([]); clearAccessToken();
    try { await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password); }
    catch (error) {
      handleMfaError(error);
    }
  }, [handleMfaError]);
  const signInWithGoogle = useCallback(async () => {
    if (isAdminSite) throw new SessionError('admin_password_required', 403);
    if (!usesFirebaseAuth) throw new Error('Google login is unavailable in Demo mode');
    setLoginError(null); resolver.current = null; setFactors([]); clearAccessToken();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      // Pass the resolver explicitly because Auth uses initializeAuth with memory persistence.
      await signInWithPopup(getFirebaseAuth(), provider, browserPopupRedirectResolver);
    } catch (error) { handleMfaError(error); }
  }, [handleMfaError]);
  const completeMfa = useCallback(async (factorId: string, code: string) => {
    const pending = resolver.current;
    if (!pending || !pending.hints.some(f => f.uid === factorId && f.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw new Error('MFA session expired');
    await pending.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(factorId, code));
    resolver.current = null; setFactors([]);
  }, []);
  const signOut = useCallback(() => {
    generation.current++; resolver.current = null; setFactors([]); clearAccessToken(); setProfile(null); setSession(null); setUser(null); setSessionError(null);
    if (usesFirebaseAuth) void firebaseSignOut(getFirebaseAuth());
  }, []);
  const value = useMemo(() => ({ profile, authenticated: Boolean(profile), user, ready, session, sessionError, loginError, factors, signIn, signInWithGoogle, completeMfa, refreshSession, signOut }), [profile,user,ready,session,sessionError,loginError,factors,signIn,signInWithGoogle,completeMfa,refreshSession,signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 中使用');
  return value;
}
