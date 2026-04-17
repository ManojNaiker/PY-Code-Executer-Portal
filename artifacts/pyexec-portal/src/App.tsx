import { useEffect, useRef, useState } from "react";
import { ClerkProvider, SignUp, Show, useClerk, useSignIn } from '@clerk/react';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Home from "./pages/home";
import Dashboard from "./pages/dashboard";
import ScriptsList from "./pages/scripts";
import ScriptDetail from "./pages/script-detail";
import Upload from "./pages/upload";
import AdminDepartments from "./pages/admin-departments";
import AdminUsers from "./pages/admin-users";
import AdminAudit from "./pages/admin-audit";
import NotFound from "./pages/not-found";
import { Layout } from "./components/layout";
import { useAuthSync } from "./hooks/use-auth-sync";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

function AuthPageLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex min-h-[100dvh] bg-white" style={{ fontFamily: "'Segoe UI', Inter, sans-serif" }}>
      <div className="hidden lg:flex lg:w-[45%] bg-[#0f1e3c] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-64 h-64 bg-blue-400 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-600 rounded-full translate-x-1/4 translate-y-1/4" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-[#0078d4] rounded-sm flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 2h2v2h2v-2h2v2h-2v2h2v2h-2v-2h-2v2h-2v-2h2v-2h-2v-2z"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-semibold text-lg leading-tight">PyExec Portal</div>
              <div className="text-blue-300 text-xs">Enterprise Platform</div>
            </div>
          </div>

          <h1 className="text-white text-3xl font-semibold leading-tight mb-4">
            Secure Python<br />Execution Platform
          </h1>
          <p className="text-blue-200 text-sm leading-relaxed mb-10">
            Run Python scripts securely from your browser.<br />
            Department-based access control and full audit trail.
          </p>

          <div className="space-y-5">
            {[
              { icon: "🔒", label: "Role-based access control" },
              { icon: "🏢", label: "Department-level script isolation" },
              { icon: "📋", label: "Complete audit logging" },
              { icon: "⚡", label: "Instant browser execution" },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#0078d4]/20 rounded-sm flex items-center justify-center text-sm">{f.icon}</div>
                <span className="text-blue-100 text-sm">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-blue-400 text-xs">
          © {new Date().getFullYear()} PyExec Portal. Enterprise Edition.
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 bg-white">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-[#0078d4] rounded-sm flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 2h2v2h2v-2h2v2h-2v2h2v2h-2v-2h-2v2h-2v-2h2v-2h-2v-2z"/>
              </svg>
            </div>
            <span className="font-semibold text-[#0f1e3c]">PyExec Portal</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-[#0f1e3c] mb-1">{title}</h2>
            <p className="text-sm text-gray-500">{subtitle}</p>
          </div>

          {children}

          <div className="mt-8 pt-6 border-t border-gray-100 text-center text-xs text-gray-400">
            By signing in, you agree to our Terms of Service.
          </div>
        </div>
      </div>
    </div>
  );
}

function SignInPage() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Invalid email or password");
        setLoading(false);
        return;
      }

      const result = await signIn.create({
        strategy: "ticket",
        ticket: data.ticket,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation("/dashboard");
      } else {
        setError("Sign in could not be completed. Please try again.");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageLayout title="Sign In" subtitle="Corporate access only">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Enter your email"
            required
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-60 text-white font-normal py-2 px-4 rounded-sm text-sm transition-colors"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <a href={`${basePath}/sign-up`} className="text-[#0078d4] hover:underline">
            Sign up
          </a>
        </p>
      </form>
    </AuthPageLayout>
  );
}

function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <AuthPageLayout title="Create account" subtitle="Register for access">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthPageLayout>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  useAuthSync();
  return (
    <>
      <Show when="signed-in">
        <Layout>{children}</Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      localization={{
        signIn: {
          start: {
            title: "PyExec Portal Sign In",
            subtitle: "Corporate access only",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <Route path="/dashboard">
              <AuthGuard><Dashboard /></AuthGuard>
            </Route>
            <Route path="/scripts">
              <AuthGuard><ScriptsList /></AuthGuard>
            </Route>
            <Route path="/scripts/:id">
              <AuthGuard><ScriptDetail /></AuthGuard>
            </Route>
            <Route path="/upload">
              <AuthGuard><Upload /></AuthGuard>
            </Route>

            <Route path="/admin/departments">
              <AuthGuard><AdminDepartments /></AuthGuard>
            </Route>
            <Route path="/admin/users">
              <AuthGuard><AdminUsers /></AuthGuard>
            </Route>
            <Route path="/admin/audit">
              <AuthGuard><AdminAudit /></AuthGuard>
            </Route>

            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
