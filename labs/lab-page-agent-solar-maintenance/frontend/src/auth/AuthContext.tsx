import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiFetch } from "../api/client.js";

export interface Session {
  token: string;
  user: { id: string; name: string };
}

interface AuthValue {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  getToken: () => string | null;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const tokenRef = useRef<string | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const next = await apiFetch<Session>("/api/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    tokenRef.current = next.token;
    setSession(next);
  }, []);

  const getToken = useCallback(() => tokenRef.current, []);
  const value = useMemo(
    () => ({ session, login, getToken }),
    [session, login, getToken],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthCtx);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
