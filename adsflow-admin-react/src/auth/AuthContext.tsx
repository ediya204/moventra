import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { clearAccessToken, setAccessToken } from '../api/client';
import { login as loginRequest } from '../api/queries';
import type { SessionProfile } from '../types';

type AuthContextValue = {
  profile: SessionProfile | null;
  authenticated: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<SessionProfile | null>(null);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const result = await loginRequest(username, password);
      setAccessToken(result.accessToken);
      setProfile({
        username: result.username || username,
        nickname: result.nickname,
        avatar: result.avatar,
        roles: result.roles || [],
        permissions: result.permissions || [],
      });
    },
    [],
  );

  const signOut = useCallback(() => {
    clearAccessToken();
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ profile, authenticated: Boolean(profile), signIn, signOut }),
    [profile, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 中使用');
  return value;
}
