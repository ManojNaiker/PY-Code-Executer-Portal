import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Save, Loader2, Settings as SettingsIcon, Bot } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type SmtpSettings = {
  id: number;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  fromEmail: string;
  fromName: string | null;
  enabled: boolean;
  hasPassword: boolean;
  updatedAt: string;
} | null;

type AiProvider = "anthropic" | "openai" | "grok";
type AiSettingsResponse = {
  settings: {
    id: number;
    provider: AiProvider;
    baseUrl: string | null;
    model: string | null;
    hasApiKey: boolean;
    updatedAt: string;
  } | null;
  replitDefault: { provider: AiProvider; available: boolean };
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  grok: "xAI Grok",
};
const PROVIDER_DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  grok: "grok-2-latest",
};
const PROVIDER_KEY_HELP: Record<AiProvider, string> = {
  anthropic: "Get a key at console.anthropic.com → API Keys",
  openai: "Get a key at platform.openai.com → API Keys",
  grok: "Get a key at console.x.ai → API Keys",
};

export default function AdminSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [existing, setExisting] = useState<SmtpSettings>(null);

  const [host, setHost] = useState("");
  const [port, setPort] = useState<string>("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [testTo, setTestTo] = useState("");

  // ---------------- AI provider settings ----------------
  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiResp, setAiResp] = useState<AiSettingsResponse | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>("anthropic");
  const [aiModel, setAiModel] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/settings/ai", { credentials: "include" });
        if (r.status === 403) return;
        const j: AiSettingsResponse = await r.json();
        if (cancelled) return;
        setAiResp(j);
        const s = j.settings;
        const provider = (s?.provider as AiProvider) || j.replitDefault.provider || "anthropic";
        setAiProvider(provider);
        setAiModel(s?.model || "");
        setAiBaseUrl(s?.baseUrl || "");
      } catch (e: any) {
        toast({ title: "Failed to load AI settings", description: e?.message || String(e), variant: "destructive" });
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSaveAi() {
    setAiSaving(true);
    try {
      const body: any = {
        provider: aiProvider,
        model: aiModel.trim() || null,
        baseUrl: aiBaseUrl.trim() || null,
      };
      if (aiApiKey.length > 0) body.apiKey = aiApiKey;
      const r = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setAiResp(j as AiSettingsResponse);
      setAiApiKey("");
      toast({ title: "AI settings saved" });
    } catch (e: any) {
      toast({ title: "Failed to save AI settings", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setAiSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/settings/smtp", { credentials: "include" });
        if (r.status === 403) {
          toast({ title: "Admins only", description: "You need admin access to manage settings.", variant: "destructive" });
          return;
        }
        const j = r.status === 200 ? await r.json() : null;
        if (cancelled) return;
        if (j) {
          setExisting(j);
          setHost(j.host || "");
          setPort(String(j.port ?? 587));
          setSecure(Boolean(j.secure));
          setUsername(j.username || "");
          setFromEmail(j.fromEmail || "");
          setFromName(j.fromName || "");
          setEnabled(Boolean(j.enabled));
        }
      } catch (e: any) {
        toast({ title: "Failed to load settings", description: e?.message || String(e), variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const body: any = {
        host: host.trim(),
        port: Number(port),
        secure,
        username: username.trim() || null,
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim() || null,
        enabled,
      };
      if (password.length > 0) body.password = password;
      const r = await fetch("/api/settings/smtp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setExisting(j);
      setPassword("");
      toast({ title: "SMTP settings saved" });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testTo.trim()) {
      toast({ title: "Recipient required", description: "Enter an email address to send the test to.", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const body: any = { to: testTo.trim() };
      if (host.trim()) {
        body.host = host.trim();
        body.port = Number(port);
        body.secure = secure;
        body.username = username.trim() || null;
        if (password.length > 0) body.password = password;
      }
      const r = await fetch("/api/settings/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast({ title: "Test email sent", description: `Sent to ${testTo.trim()}` });
    } catch (e: any) {
      toast({ title: "Test failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure platform-wide settings. Changes apply immediately."
        icon={<SettingsIcon className="h-5 w-5" />}
      />

      <div className="space-y-10 max-w-5xl">
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Email (SMTP)</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Used to send notifications such as new-user welcome emails. Leave password blank to keep the saved one.
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="host">SMTP Host *</Label>
                  <Input id="host" placeholder="smtp.gmail.com" value={host} onChange={e => setHost(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">Port *</Label>
                  <Input id="port" type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" placeholder="you@example.com" value={username} onChange={e => setUsername(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password {existing?.hasPassword && <span className="text-xs text-muted-foreground">(saved — leave blank to keep)</span>}</Label>
                  <Input id="password" type="password" placeholder={existing?.hasPassword ? "••••••••" : "App password or SMTP password"} value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fromEmail">From Email *</Label>
                  <Input id="fromEmail" type="email" placeholder="no-reply@yourcompany.com" value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fromName">From Name</Label>
                  <Input id="fromName" placeholder="PyExec Portal" value={fromName} onChange={e => setFromName(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch id="secure" checked={secure} onCheckedChange={setSecure} />
                  <Label htmlFor="secure" className="cursor-pointer">Use SSL/TLS (port 465)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
                  <Label htmlFor="enabled" className="cursor-pointer">Enable email sending</Label>
                </div>
              </div>

              <div className="border-t pt-5 space-y-3">
                <Label className="text-sm">Send a test email</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input placeholder="recipient@example.com" type="email" value={testTo} onChange={e => setTestTo(e.target.value)} />
                  <Button variant="outline" onClick={handleTest} disabled={testing}>
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Send test
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Uses the form values above (or saved settings if blank).</p>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={saving || !host.trim() || !fromEmail.trim()}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save settings
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="border-t pt-8">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">AI Provider</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Choose which AI to use for the “Enhance with AI” feature. While this app runs on Replit, you can leave the
            API key blank and it will use the built-in Anthropic key automatically. When you self-host or move locally,
            switch to your preferred provider and paste your own API key.
          </p>
          {aiLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-provider">Provider</Label>
                  <select
                    id="ai-provider"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                  >
                    {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => (
                      <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-model">Model <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="ai-model"
                    placeholder={PROVIDER_DEFAULT_MODEL[aiProvider]}
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ai-key">
                    API Key{" "}
                    {aiResp?.settings?.hasApiKey && (
                      <span className="text-xs text-muted-foreground">(saved — leave blank to keep)</span>
                    )}
                  </Label>
                  <Input
                    id="ai-key"
                    type="password"
                    placeholder={
                      aiResp?.settings?.hasApiKey
                        ? "••••••••"
                        : (aiProvider === "anthropic" && aiResp?.replitDefault?.available
                            ? "Optional — Replit Anthropic key is being used by default"
                            : "Paste your API key")
                    }
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{PROVIDER_KEY_HELP[aiProvider]}</p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ai-baseurl">Base URL <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="ai-baseurl"
                    placeholder={
                      aiProvider === "anthropic"
                        ? "https://api.anthropic.com (defaults to Replit proxy when blank)"
                        : aiProvider === "openai"
                          ? "https://api.openai.com/v1"
                          : "https://api.x.ai/v1"
                    }
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                  />
                </div>
              </div>

              {aiProvider === "anthropic" && aiResp?.replitDefault?.available && !aiResp?.settings?.hasApiKey && (
                <div className="text-xs rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-muted-foreground">
                  Currently using the built-in Replit Anthropic key. No setup required while you're on Replit.
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveAi} disabled={aiSaving}>
                  {aiSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save AI settings
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="border-t pt-8">
          <h2 className="text-base font-semibold mb-1">Notifications</h2>
          <p className="text-sm text-muted-foreground mb-3">When SMTP is enabled, the following events trigger emails:</p>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>New user created — welcome email with login credentials sent to the new user.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
