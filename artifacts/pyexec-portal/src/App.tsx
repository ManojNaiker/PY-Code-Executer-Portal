import { useEffect, useState, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, Link } from 'wouter';
import { QueryClientProvider } from "@tanstack/react-query";
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
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "./hooks/use-auth";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthPageLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex min-h-[100dvh] bg-white" style={{ fontFamily: "'Segoe UI', Inter, sans-serif" }}>
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)" }}>
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-64 h-64 bg-yellow-300 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-300 rounded-full translate-x-1/4 translate-y-1/4 blur-3xl" />
          <div className="absolute top-1/2 left-1/3 w-72 h-72 bg-pink-400 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 2h2v2h2v-2h2v2h-2v2h2v2h-2v-2h-2v2h-2v-2h2v-2h-2v-2z"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-semibold text-lg leading-tight">PyExec Portal</div>
              <div className="text-white/80 text-xs">Enterprise Platform</div>
            </div>
          </div>
          <h1 className="text-white text-3xl font-semibold leading-tight mb-4 drop-shadow">
            Secure Python<br />Execution Platform
          </h1>
          <p className="text-white/90 text-sm leading-relaxed mb-10">
            Run Python scripts securely from your browser.<br />
            Department-based access control and full audit trail.
          </p>
        </div>
        <div className="relative z-10 text-white/70 text-xs">
          © {new Date().getFullYear()} PyExec Portal. Enterprise Edition.
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 bg-white">
        <div className="w-full max-w-[380px]">
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
  const { signIn, user, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && user) return <Redirect to="/dashboard" />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      window.location.href = `${basePath}/dashboard`;
    } catch (err: any) {
      setError(err?.message || "Invalid email or password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout title="Sign In" subtitle="Access your account">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-sm">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900" />
        </div>
        <button type="submit" disabled={submitting}
          className="w-full bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-60 text-white font-normal py-2 px-4 rounded-sm text-sm transition-colors">
          {submitting ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <Link href="/sign-up" className="text-[#0078d4] hover:underline">Sign up</Link>
        </p>
      </form>
    </AuthPageLayout>
  );
}

function SignUpPage() {
  const { signUp, user, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && user) return <Redirect to="/dashboard" />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signUp(email.trim(), password, firstName.trim() || undefined, lastName.trim() || undefined);
      window.location.href = `${basePath}/dashboard`;
    } catch (err: any) {
      setError(err?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout title="Create account" subtitle="Register for access">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-sm">{error}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
            placeholder="At least 6 characters"
            className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] bg-white text-gray-900" />
        </div>
        <button type="submit" disabled={submitting}
          className="w-full bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-60 text-white font-normal py-2 px-4 rounded-sm text-sm transition-colors">
          {submitting ? "Creating account..." : "Create account"}
        </button>
        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-[#0078d4] hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthPageLayout>
  );
}

function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user) return <Redirect to="/dashboard" />;
  return <Home />;
}

function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect to="/sign-in" />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in" component={SignInPage} />
          <Route path="/sign-up" component={SignUpPage} />
          <Route path="/dashboard"><AuthGuard><Dashboard /></AuthGuard></Route>
          <Route path="/scripts"><AuthGuard><ScriptsList /></AuthGuard></Route>
          <Route path="/scripts/:id"><AuthGuard><ScriptDetail /></AuthGuard></Route>
          <Route path="/upload"><AuthGuard><Upload /></AuthGuard></Route>
          <Route path="/admin/departments"><AuthGuard><AdminDepartments /></AuthGuard></Route>
          <Route path="/admin/users"><AuthGuard><AdminUsers /></AuthGuard></Route>
          <Route path="/admin/audit"><AuthGuard><AdminAudit /></AuthGuard></Route>
          <Route component={NotFound} />
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);
  return (
    <WouterRouter base={basePath}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </WouterRouter>
  );
}

export default App;
