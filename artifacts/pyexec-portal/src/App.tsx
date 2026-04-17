import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
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

const clerkAppearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(217, 91%, 60%)",
    colorBackground: "hsl(222, 47%, 11%)",
    colorInputBackground: "hsl(215, 28%, 22%)",
    colorText: "hsl(210, 40%, 98%)",
    colorTextSecondary: "hsl(215, 20%, 65%)",
    colorInputText: "hsl(210, 40%, 98%)",
    colorNeutral: "hsl(215, 28%, 22%)",
    borderRadius: "0.25rem",
    fontFamily: "'Inter', sans-serif",
    fontFamilyButtons: "'Inter', sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "border border-[hsl(215,28%,22%)] shadow-xl rounded-lg w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none border-t border-[hsl(215,28%,22%)]",
    headerTitle: { color: "hsl(210, 40%, 98%)" },
    headerSubtitle: { color: "hsl(215, 20%, 65%)" },
    socialButtonsBlockButtonText: { color: "hsl(210, 40%, 98%)" },
    formFieldLabel: { color: "hsl(210, 40%, 98%)" },
    footerActionLink: { color: "hsl(217, 91%, 60%)" },
    footerActionText: { color: "hsl(215, 20%, 65%)" },
    dividerText: { color: "hsl(215, 20%, 65%)" },
    identityPreviewEditButton: { color: "hsl(217, 91%, 60%)" },
    formFieldSuccessText: { color: "hsl(210, 40%, 98%)" },
    alertText: { color: "hsl(210, 40%, 98%)" },
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
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
      appearance={clerkAppearance}
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
  // Always dark mode for corporate aesthetic
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
