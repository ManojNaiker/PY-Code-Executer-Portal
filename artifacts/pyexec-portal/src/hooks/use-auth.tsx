import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  departmentId: number | null;
};

type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (email: string, password: string, firstName?: string, lastName?: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
};

const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const AuthContext = createContext<AuthState | null>(null);

async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${basePath}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await apiPost<AuthUser>("/api/auth/login", { email, password });
    setUser(data);
    return data;
  }, []);

  const signUp = useCallback(async (email: string, password: string, firstName?: string, lastName?: string) => {
    const data = await apiPost<AuthUser>("/api/auth/register", { email, password, firstName, lastName });
    setUser(data);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try { await apiPost("/api/auth/logout"); } catch {}
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, refresh, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
