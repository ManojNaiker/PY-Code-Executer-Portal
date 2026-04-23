import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Save, Loader2 } from "lucide-react";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure platform-wide settings. Changes apply immediately.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email (SMTP)
          </CardTitle>
          <CardDescription>
            Used to send notifications such as new-user welcome emails. Leave password blank to keep the saved one.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>When SMTP is enabled, the following events trigger emails:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>New user created — welcome email with login credentials sent to the new user.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
