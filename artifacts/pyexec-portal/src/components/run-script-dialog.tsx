import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, FileSpreadsheet, Terminal, AlertCircle, CheckCircle2, Clock, Upload, MonitorPlay, Keyboard, Package, Download, Loader2, Sparkles, ShieldAlert, Wand2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

type AiFixProposal = {
  diagnosis: string;
  rootCause: string;
  changes: string[];
  fixedCode: string;
  confidence: "low" | "medium" | "high";
  notes?: string;
  generatedAt: string;
};

const MAX_AUTO_FIX_ATTEMPTS = 3;

type AiFixHistoryEntry = {
  attempt: number;
  diagnosis: string;
  rootCause: string;
  changes: string[];
  confidence: "low" | "medium" | "high";
  provider: string | null;
  outcome: "applied" | "fixed" | "still_failing" | "error";
  error?: string;
};

type DetectedArg = {
  name: string;
  flag: string | null;
  label: string;
  help: string;
  required: boolean;
  type: "string" | "int" | "float" | "bool";
  default: string | null;
  choices: string[] | null;
  positional: boolean;
};

type FileSpec = {
  required: boolean;
  kind: "excel" | "csv" | "json" | "text" | "image" | "any";
  label: string;
  hint: string;
  source: "extension" | "filedialog" | "argparse" | "argv";
} | null;

type DetectedInput = { prompt: string; secret: boolean };

type DetectedGui = {
  framework: string;
  hasMainLoop: boolean;
} | null;

type TkField = {
  label: string;
  kind: "text" | "password" | "number" | "select" | "checkbox" | "textarea";
  choices?: string[];
  default?: string;
  dynamicOptionsFunc?: string;
};

type TkAction = { label: string };

type TkForm = {
  fields: TkField[];
  actions: TkAction[];
  needsFile: boolean;
  fileLabel: string | null;
} | null;

type HardcodedPath = {
  literal: string;
  path: string;
  kind: "excel" | "csv" | "json" | "image" | "text" | "any";
  label: string;
  func: string;
};

type InputsSchema = {
  args: DetectedArg[];
  inputs: DetectedInput[];
  needsStdin: boolean;
  stdinPrompt: string | null;
  file: FileSpec;
  gui: DetectedGui;
  tkForm: TkForm;
  hardcodedPaths: HardcodedPath[];
};

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  deps?: {
    attempted: string[];
    installed: string[];
    failed: { pkg: string; error: string }[];
    log?: string;
  };
};

type DepStatus = { module: string; package: string; installed: boolean };

type AiHint = {
  label: string;
  friendlyLabel?: string;
  description?: string;
  placeholder?: string;
  validation?: string;
  example?: string;
};
type AiActionHint = { label: string; friendlyLabel?: string; description?: string };
type AiPathHint = { literal: string; friendlyLabel?: string; description?: string };
type ReconciledField = {
  label: string;
  kind: "text" | "password" | "number" | "select" | "checkbox" | "textarea";
  source: "parser" | "ai_added";
  friendlyLabel?: string;
  description?: string;
  placeholder?: string;
  example?: string;
  validation?: string;
};
type AiSchema = {
  scriptTitle?: string;
  scriptSummary?: string;
  fields?: AiHint[];
  args?: AiHint[];
  actions?: AiActionHint[];
  paths?: AiPathHint[];
  warnings?: string[];
  reconciledFields?: ReconciledField[];
  codeChanges?: string[];
  codeEnhanced?: boolean;
} | null;

interface Props {
  scriptId: number;
  scriptName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialResult?: ExecResult | null;
  initialSchema?: InputsSchema | null;
}

const ACCEPT_BY_KIND: Record<string, string> = {
  excel: ".xlsx,.xls",
  csv: ".csv",
  json: ".json",
  image: ".png,.jpg,.jpeg,.gif,.bmp,.webp",
  text: "*",
  any: "*",
};

function makeInitArgs(schema: InputsSchema): Record<string, string> {
  const init: Record<string, string> = {};
  for (const a of schema.args) {
    if (a.default != null) init[a.name] = a.default;
    else if (a.type === "bool") init[a.name] = "false";
    else init[a.name] = "";
  }
  return init;
}

export function RunScriptDialog({ scriptId, scriptName, open, onOpenChange, initialResult, initialSchema }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [aiFixOpen, setAiFixOpen] = useState(false);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixApplying, setAiFixApplying] = useState(false);
  // JARVIS Auto-Fix is ON by default for admins (Replit/Grok-style auto error resolver).
  // Non-admins can't write to scripts.code so it stays off for them.
  const [aiFixAutoMode, setAiFixAutoMode] = useState(true);
  const [aiFixProposal, setAiFixProposal] = useState<AiFixProposal | null>(null);
  const [aiFixProvider, setAiFixProvider] = useState<string | null>(null);
  const [aiFixOriginal, setAiFixOriginal] = useState<string | null>(null);
  const [aiFixApplied, setAiFixApplied] = useState(false);
  // Auto-fix loop tracking
  const [aiFixAttempt, setAiFixAttempt] = useState(0);
  const [aiFixHistory, setAiFixHistory] = useState<AiFixHistoryEntry[]>([]);
  const [aiFixGaveUp, setAiFixGaveUp] = useState(false);
  const aiFixHandledForRef = useRef<string | null>(null);
  const [dynamicOptionsLoading, setDynamicOptionsLoading] = useState<Record<string, boolean>>({});
  const [dynamicOptionsError, setDynamicOptionsError] = useState<Record<string, string>>({});
  const [schema, setSchema] = useState<InputsSchema | null>(initialSchema ?? null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [inputValues, setInputValues] = useState<string[]>([]);
  const [extraStdin, setExtraStdin] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pathFiles, setPathFiles] = useState<Record<number, File>>({});
  const [tkValues, setTkValues] = useState<Record<string, string>>({});
  const [tkAction, setTkAction] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(initialResult ?? null);
  const [deps, setDeps] = useState<DepStatus[] | null>(null);
  const [depsLoading, setDepsLoading] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [aiSchema, setAiSchema] = useState<AiSchema>(null);
  const [liveLog, setLiveLog] = useState<Array<{ type: "stdout" | "stderr" | "status"; text: string }>>([]);

  function findFieldHint(label: string): AiHint | undefined {
    return aiSchema?.fields?.find((h) => h.label === label);
  }
  function findArgHint(label: string): AiHint | undefined {
    return aiSchema?.args?.find((h) => h.label === label);
  }
  function findActionHint(label: string): AiActionHint | undefined {
    return aiSchema?.actions?.find((h) => h.label === label);
  }
  function findPathHint(literal: string): AiPathHint | undefined {
    return aiSchema?.paths?.find((h) => h.literal === literal);
  }

  function initTkValues(s: InputsSchema, reconciledFields?: ReconciledField[]): Record<string, string> {
    const init: Record<string, string> = {};
    const fields = reconciledFields ?? s.tkForm?.fields ?? [];
    for (const f of fields) {
      const def = (f as TkField).default;
      if (def != null) init[f.label] = def;
      else if (f.kind === "checkbox") init[f.label] = "false";
      else init[f.label] = "";
    }
    return init;
  }

  useEffect(() => {
    if (!open) {
      setSchema(null);
      setValues({});
      setInputValues([]);
      setExtraStdin("");
      setFile(null);
      setPathFiles({});
      setTkValues({});
      setTkAction("");
      setResult(null);
      setDeps(null);
      setAiSchema(null);
      setLiveLog([]);
      setAiFixProposal(null);
      setAiFixApplied(false);
      setAiFixAutoMode(true);
      setAiFixAttempt(0);
      setAiFixHistory([]);
      setAiFixGaveUp(false);
      aiFixHandledForRef.current = null;
      return;
    }
    setDepsLoading(true);
    fetch(`/api/scripts/${scriptId}/dependencies`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: { deps: DepStatus[] }) => setDeps(data.deps ?? []))
      .catch(() => setDeps([]))
      .finally(() => setDepsLoading(false));
    fetch(`/api/scripts/${scriptId}/ai-schema`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: { aiSchema: AiSchema }) => setAiSchema(data.aiSchema ?? null))
      .catch(() => setAiSchema(null));
    if (initialResult) setResult(initialResult);
    if (initialSchema) {
      setSchema(initialSchema);
      setValues(makeInitArgs(initialSchema));
      setInputValues(new Array(initialSchema.inputs.length).fill(""));
      setTkValues(initTkValues(initialSchema));
      setTkAction(initialSchema.tkForm?.actions?.[0]?.label ?? "");
      return;
    }
    setLoadingSchema(true);
    fetch(`/api/scripts/${scriptId}/inputs`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: InputsSchema) => {
        setSchema(data);
        setValues(makeInitArgs(data));
        setInputValues(new Array(data.inputs.length).fill(""));
        setTkValues(initTkValues(data));
        setTkAction(data.tkForm?.actions?.[0]?.label ?? "");
        loadDynamicOptions(data);
      })
      .catch((e) => {
        toast({ title: "Failed to load script inputs", description: String(e), variant: "destructive" });
        setSchema({ args: [], inputs: [], needsStdin: false, stdinPrompt: null, file: null, gui: null, tkForm: null, hardcodedPaths: [] });
      })
      .finally(() => setLoadingSchema(false));
  }, [open, scriptId, initialResult, initialSchema]);

  async function loadDynamicOptions(s: InputsSchema) {
    const fields = s.tkForm?.fields ?? [];
    const targets = fields.filter((f) => f.kind === "select" && f.dynamicOptionsFunc && (!f.choices || f.choices.length === 0));
    if (targets.length === 0) return;
    setDynamicOptionsLoading((p) => {
      const next = { ...p };
      for (const f of targets) next[f.label] = true;
      return next;
    });
    await Promise.all(targets.map(async (f) => {
      try {
        const r = await fetch(`/api/scripts/${scriptId}/dynamic-options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ func: f.dynamicOptionsFunc }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setDynamicOptionsError((p) => ({ ...p, [f.label]: j.detail || j.error || `HTTP ${r.status}` }));
          return;
        }
        const opts: string[] = Array.isArray(j.options) ? j.options : [];
        setSchema((cur) => {
          if (!cur || !cur.tkForm) return cur;
          return {
            ...cur,
            tkForm: {
              ...cur.tkForm,
              fields: cur.tkForm.fields.map((x) => x.label === f.label ? { ...x, choices: opts } : x),
            },
          };
        });
      } catch (e: any) {
        setDynamicOptionsError((p) => ({ ...p, [f.label]: e?.message || String(e) }));
      } finally {
        setDynamicOptionsLoading((p) => { const next = { ...p }; delete next[f.label]; return next; });
      }
    }));
  }

  // When AI schema loads with reconciledFields, re-initialize tkValues to include AI-added fields
  useEffect(() => {
    if (!schema || !aiSchema?.reconciledFields?.length) return;
    setTkValues((current) => {
      const merged = initTkValues(schema, aiSchema.reconciledFields);
      // Preserve any values the user already typed
      return { ...merged, ...current };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSchema]);

  // The authoritative field list: prefer AI-reconciled fields over raw parser output
  const effectiveFields: (TkField | ReconciledField)[] =
    (aiSchema?.reconciledFields && aiSchema.reconciledFields.length > 0)
      ? aiSchema.reconciledFields
      : (schema?.tkForm?.fields ?? []);

  const hasTkForm = !!schema?.tkForm && (
    effectiveFields.length > 0 ||
    schema.tkForm.actions.length > 0 ||
    schema.tkForm.needsFile
  );

  // Auto-execute when dialog opens for a script that requires no user input.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoRanRef.current = false;
      return;
    }
    if (autoRanRef.current) return;
    if (!schema || loadingSchema) return;
    if (running || result) return;
    const needsAnyInput =
      schema.args.length > 0 ||
      schema.needsStdin ||
      schema.inputs.length > 0 ||
      schema.file != null ||
      hasTkForm ||
      (schema.hardcodedPaths?.length ?? 0) > 0;
    if (!needsAnyInput) {
      autoRanRef.current = true;
      setAiFixAttempt(0);
      setAiFixHistory([]);
      setAiFixGaveUp(false);
      aiFixHandledForRef.current = null;
      executeNow();
    }
  }, [open, schema, loadingSchema, running, result, hasTkForm]);

  const hasInputs = !!schema && (
    schema.args.length > 0 ||
    schema.inputs.length > 0 ||
    schema.needsStdin ||
    schema.file != null ||
    schema.gui != null ||
    hasTkForm ||
    (schema.hardcodedPaths?.length ?? 0) > 0
  );

  function buildArgsList(): string[] {
    if (!schema) return [];
    const out: string[] = [];
    for (const a of schema.args) {
      const v = values[a.name] ?? "";
      if (a.type === "bool") {
        if (v === "true" && a.flag) out.push(a.flag);
        continue;
      }
      if (v === "" || v == null) continue;
      if (a.flag) {
        out.push(a.flag, v);
      } else {
        out.push(v);
      }
    }
    return out;
  }

  // Identify which interactive input() prompt is asking for the uploaded file's path,
  // so we can hide that text field and inject the path automatically.
  const FILE_PATH_SENTINEL = "__PYEXEC_UPLOADED_FILE_PATH__";
  const filePromptIndex = (() => {
    if (!schema || !schema.file) return -1;
    return schema.inputs.findIndex((i) =>
      /file|path|excel|csv|xlsx|xls|sheet|workbook|image|json/i.test(i.prompt),
    );
  })();

  function buildStdin(): string | null {
    if (!schema) return null;
    const lines: string[] = [];
    for (let i = 0; i < inputValues.length; i++) {
      if (i === filePromptIndex && file) {
        lines.push(FILE_PATH_SENTINEL);
      } else {
        lines.push(inputValues[i] ?? "");
      }
    }
    if (extraStdin) lines.push(extraStdin);
    if (lines.length === 0) return null;
    // Each input() call reads one line
    return lines.join("\n") + "\n";
  }

  async function executeNow(opts?: { skipFile?: boolean }) {
    setRunning(true);
    setResult(null);
    setLiveLog([]);
    try {
      const args = buildArgsList();
      const stdin = buildStdin();
      const tkInputsPayload = hasTkForm
        ? { fields: tkValues, action: tkAction }
        : null;
      let res: Response;
      const pathOverrideEntries = schema?.hardcodedPaths
        ? schema.hardcodedPaths
            .map((hp, i) => ({ hp, i, f: pathFiles[i] }))
            .filter((x) => !!x.f)
        : [];
      const useForm = (file && !opts?.skipFile) || pathOverrideEntries.length > 0;
      if (useForm) {
        const fd = new FormData();
        if (file && !opts?.skipFile) fd.append("file", file);
        fd.append("args", JSON.stringify(args));
        if (stdin) fd.append("stdin", stdin);
        if (tkInputsPayload) fd.append("tkInputs", JSON.stringify(tkInputsPayload));
        if (pathOverrideEntries.length > 0) {
          fd.append(
            "pathOverrides",
            JSON.stringify(pathOverrideEntries.map(({ hp, i }) => ({ literal: hp.literal, index: i }))),
          );
          for (const { i, f } of pathOverrideEntries) {
            fd.append(`pathFile_${i}`, f);
          }
        }
        res = await fetch(`/api/scripts/${scriptId}/execute-stream`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
      } else {
        res = await fetch(`/api/scripts/${scriptId}/execute-stream`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            args,
            stdin: stdin || null,
            tkInputs: tkInputsPayload,
          }),
        });
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: ExecResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "stdout" || evt.type === "stderr") {
              setLiveLog((prev) => [...prev, { type: evt.type, text: String(evt.data ?? "") }]);
            } else if (evt.type === "status") {
              setLiveLog((prev) => [...prev, { type: "status", text: String(evt.message ?? "") }]);
            } else if (evt.type === "done") {
              finalResult = evt.result as ExecResult;
            }
          } catch {
            // Ignore malformed line
          }
        }
      }

      if (finalResult) {
        setResult(finalResult);
        if (finalResult.success) {
          toast({ title: "Execution completed" });
        } else {
          toast({ title: "Execution failed", description: `Exit code ${finalResult.exitCode}`, variant: "destructive" });
        }
      } else {
        toast({ title: "Execution ended without final result", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Failed to execute", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
      setAiFixAutoMode(false);
    }
  }

  function validate(): string | null {
    if (!schema) return "Loading...";
    for (const a of schema.args) {
      if (a.required && a.type !== "bool" && !(values[a.name] ?? "").trim()) {
        return `Please provide: ${a.label}`;
      }
    }
    if (schema.file?.required && !file) {
      return `Please upload: ${schema.file.label}`;
    }
    for (let i = 0; i < (schema.inputs?.length ?? 0); i++) {
      // The file-path prompt is auto-filled from the upload; skip its text validation.
      if (i === filePromptIndex && file) continue;
      if (!(inputValues[i] ?? "").length) {
        return `Please answer prompt: "${schema.inputs[i].prompt}"`;
      }
    }
    if (schema.tkForm?.needsFile && !file) {
      return `Please upload: ${schema.tkForm.fileLabel ?? "File"}`;
    }
    if (schema.tkForm && schema.tkForm.actions.length > 0 && !tkAction) {
      return "Please choose an action to run.";
    }
    for (let i = 0; i < (schema.hardcodedPaths?.length ?? 0); i++) {
      if (!pathFiles[i]) {
        const hp = schema.hardcodedPaths[i];
        const hint = findPathHint(hp.literal);
        return `Please upload: ${hint?.friendlyLabel ?? hp.label}`;
      }
    }
    return null;
  }

  async function installDeps() {
    setInstallingDeps(true);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/dependencies/install`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { result: ExecResult["deps"]; deps: DepStatus[] } = await res.json();
      setDeps(data.deps ?? []);
      const r = data.result;
      if (r && r.failed && r.failed.length > 0) {
        toast({
          title: "Some dependencies failed",
          description: r.failed.map((f) => f.pkg).join(", "),
          variant: "destructive",
        });
      } else if (r && r.installed && r.installed.length > 0) {
        toast({ title: "Dependencies installed", description: r.installed.join(", ") });
      } else {
        toast({ title: "All dependencies already installed" });
      }
    } catch (e) {
      toast({ title: "Failed to install dependencies", description: String(e), variant: "destructive" });
    } finally {
      setInstallingDeps(false);
    }
  }

  async function requestAiFix() {
    if (!result) return;
    setAiFixOpen(true);
    setAiFixAutoMode(false);
    setAiFixApplied(false);
    setAiFixProposal(null);
    setAiFixProvider(null);
    setAiFixOriginal(null);
    setAiFixLoading(true);
    try {
      const r = await fetch(`/api/scripts/${scriptId}/ai-fix-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stderr: result.stderr,
          stdout: result.stdout,
          exitCode: result.exitCode,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setAiFixProposal(j.proposal);
      setAiFixProvider(j.provider ?? null);
      setAiFixOriginal(j.originalCode ?? null);
    } catch (e: any) {
      toast({ title: "AI fix failed", description: e?.message || String(e), variant: "destructive" });
      setAiFixOpen(false);
    } finally {
      setAiFixLoading(false);
    }
  }

  async function fixAndRerun() {
    if (!result) return;
    const attemptNo = aiFixAttempt + 1;
    setAiFixAttempt(attemptNo);
    setAiFixAutoMode(true);
    setAiFixApplied(false);
    setAiFixProposal(null);
    setAiFixProvider(null);
    setAiFixOriginal(null);
    setAiFixLoading(true);
    try {
      // Step 1 — JARVIS analyses the latest error and proposes a fix
      const r = await fetch(`/api/scripts/${scriptId}/ai-fix-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stderr: result.stderr,
          stdout: result.stdout,
          exitCode: result.exitCode,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const proposal: AiFixProposal = j.proposal;
      const provider: string | null = j.provider ?? null;
      setAiFixProposal(proposal);
      setAiFixProvider(provider);
      setAiFixOriginal(j.originalCode ?? null);

      // Record this attempt in the timeline (outcome will be updated after re-run)
      setAiFixHistory((prev) => [
        ...prev,
        {
          attempt: attemptNo,
          diagnosis: proposal.diagnosis,
          rootCause: proposal.rootCause,
          changes: proposal.changes,
          confidence: proposal.confidence,
          provider,
          outcome: "applied",
        },
      ]);

      // Step 2 — Auto-apply the fix to the script
      const applyRes = await fetch(`/api/scripts/${scriptId}/ai-fix-error/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fixedCode: proposal.fixedCode }),
      });
      const applyJ = await applyRes.json().catch(() => ({}));
      if (!applyRes.ok) throw new Error(applyJ.error || `HTTP ${applyRes.status}`);
      setAiFixApplied(true);
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast({ title: "JARVIS fix failed", description: msg, variant: "destructive" });
      // Record the error as a terminal entry in the timeline
      setAiFixHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.attempt === attemptNo) {
          return prev.map((h, i) => i === prev.length - 1 ? { ...h, outcome: "error", error: msg } : h);
        }
        return [
          ...prev,
          { attempt: attemptNo, diagnosis: "—", rootCause: "—", changes: [], confidence: "low", provider: null, outcome: "error", error: msg },
        ];
      });
      setAiFixGaveUp(true);
    } finally {
      setAiFixLoading(false);
    }
  }

  // After fixAndRerun applies the fix, re-run ONCE (consume aiFixApplied so we don't loop here).
  useEffect(() => {
    if (aiFixAutoMode && aiFixApplied && !aiFixLoading && !running) {
      setAiFixApplied(false);
      executeNow();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFixAutoMode, aiFixApplied, aiFixLoading]);

  // Auto-fix loop: when a run completes with a failure and auto-mode is on,
  // mark the latest history entry's outcome and chain another JARVIS attempt
  // (up to MAX_AUTO_FIX_ATTEMPTS). This makes JARVIS behave like Replit/Grok —
  // it keeps reading the error, fixing the code, and re-running until smooth.
  useEffect(() => {
    if (!result) return;
    if (!aiFixAutoMode) return;
    if (aiFixLoading || running) return;

    // Update the latest history entry with the outcome of the just-finished run.
    setAiFixHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.outcome !== "applied") return prev;
      return prev.map((h, i) => i === prev.length - 1
        ? { ...h, outcome: result.success ? "fixed" : "still_failing" }
        : h);
    });

    if (result.success) return;
    if (aiFixAttempt >= MAX_AUTO_FIX_ATTEMPTS) {
      setAiFixGaveUp(true);
      return;
    }

    // Dedupe: only kick off one fix per unique result.
    const resultKey = `${result.executionTimeMs}-${result.exitCode}-${aiFixAttempt}`;
    if (aiFixHandledForRef.current === resultKey) return;
    aiFixHandledForRef.current = resultKey;

    // Small delay so the UI can paint the failed result before JARVIS jumps in.
    const t = setTimeout(() => { fixAndRerun(); }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, aiFixAutoMode, aiFixLoading, running]);

  async function applyAiFix() {
    if (!aiFixProposal) return;
    setAiFixApplying(true);
    try {
      const r = await fetch(`/api/scripts/${scriptId}/ai-fix-error/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fixedCode: aiFixProposal.fixedCode }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setAiFixApplied(true);
      toast({ title: "Fix applied", description: "The script code has been updated. Try running it again." });
    } catch (e: any) {
      toast({ title: "Apply failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setAiFixApplying(false);
    }
  }

  function handleSubmit() {
    const err = validate();
    if (err) {
      toast({ title: "Required field missing", description: err, variant: "destructive" });
      return;
    }
    // Fresh user-initiated run — reset the auto-fix budget and timeline
    setAiFixAttempt(0);
    setAiFixHistory([]);
    setAiFixGaveUp(false);
    aiFixHandledForRef.current = null;
    executeNow();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Run: {aiSchema?.scriptTitle ?? scriptName}
          </DialogTitle>
          <DialogDescription>
            {loadingSchema
              ? "Detecting required inputs..."
              : aiSchema?.scriptSummary
                ? aiSchema.scriptSummary
                : hasInputs
                  ? "Provide the required inputs below, then click Execute."
                  : result
                    ? "Execution result:"
                    : "Ready to run."}
          </DialogDescription>
        </DialogHeader>

        {aiSchema && (
          <div className="space-y-2">
            <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
              <span>
                JARVIS has verified this form.{" "}
                {aiSchema.reconciledFields && aiSchema.reconciledFields.length > 0
                  ? `${aiSchema.reconciledFields.filter((f) => f.source === "ai_added").length > 0
                      ? `${aiSchema.reconciledFields.filter((f) => f.source === "ai_added").length} field(s) added, `
                      : ""}${aiSchema.reconciledFields.filter((f) => f.source === "parser").length} field(s) verified.`
                  : "Labels and safety hints are shown below."}
              </span>
            </div>
            {aiSchema.codeEnhanced && aiSchema.codeChanges && aiSchema.codeChanges.length > 0 && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <Wand2 className="h-3.5 w-3.5 shrink-0" />
                  Script enhanced by JARVIS — code has been improved
                </div>
                <ul className="text-xs text-foreground/70 space-y-0.5 pl-5 list-disc">
                  {aiSchema.codeChanges.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {aiSchema?.warnings && aiSchema.warnings.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <ShieldAlert className="h-4 w-4" />
              Safety Warnings
            </div>
            <ul className="text-xs text-foreground/80 space-y-1 pl-6 list-disc">
              {aiSchema.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {loadingSchema && (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!loadingSchema && schema && schema.gui && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex gap-2 text-sm">
            <MonitorPlay className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">GUI application detected ({schema.gui.framework})</div>
              <p className="text-muted-foreground text-xs mt-1">
                {hasTkForm
                  ? "We have rebuilt this desktop window as a web form. Fill the fields below and pick which button to run — the script will execute headlessly on the server."
                  : "This script tries to open a desktop window. The server runs headless, so the native window cannot be displayed in the browser. Any input prompts will be collected from the form below and forwarded to the script."}
              </p>
            </div>
          </div>
        )}

        {(depsLoading || (deps && deps.length > 0)) && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Dependencies</span>
              {deps && deps.length > 0 && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {deps.filter((d) => d.installed).length}/{deps.length} installed
                </Badge>
              )}
            </div>
            {depsLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking dependencies...
              </div>
            ) : deps && deps.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {deps.map((d) => (
                    <Badge
                      key={d.module}
                      variant={d.installed ? "secondary" : "outline"}
                      className={`text-[11px] gap-1 ${d.installed ? "" : "border-amber-500/50 text-amber-600 dark:text-amber-400"}`}
                    >
                      {d.installed ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3" />
                      )}
                      <span className="font-mono">{d.package}</span>
                    </Badge>
                  ))}
                </div>
                {deps.some((d) => !d.installed) ? (
                  <div className="flex items-center gap-2 pt-1">
                    <p className="text-xs text-muted-foreground flex-1">
                      {deps.filter((d) => !d.installed).length} package(s) not yet installed. Install before running.
                    </p>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={installDeps}
                      disabled={installingDeps}
                      data-testid="button-install-deps"
                    >
                      {installingDeps ? (
                        <>
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          Installing...
                        </>
                      ) : (
                        <>
                          <Download className="mr-1.5 h-3 w-3" />
                          Install Dependencies
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    All dependencies are installed and ready.
                  </p>
                )}
              </>
            ) : null}
          </div>
        )}

        {!loadingSchema && schema?.tkForm && hasTkForm && (
          <div className="space-y-4 py-2">
            {effectiveFields.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide flex items-center gap-2">
                  Form Fields
                  {aiSchema?.reconciledFields && (
                    <Badge variant="outline" className="text-[10px] gap-1 normal-case font-normal border-purple-500/40 text-purple-600 dark:text-purple-400">
                      <Sparkles className="h-2.5 w-2.5" /> JARVIS verified
                    </Badge>
                  )}
                </div>
                {effectiveFields.map((f) => {
                  const isAiAdded = (f as ReconciledField).source === "ai_added";
                  const hint = findFieldHint(f.label) ?? (isAiAdded ? (f as ReconciledField) : undefined);
                  const choices = (f as TkField).choices;
                  const dynamicFunc = (f as TkField).dynamicOptionsFunc;
                  const defaultVal = (f as TkField).default;
                  return (
                  <div key={f.label} className={`space-y-1.5 ${isAiAdded ? "p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5" : ""}`}>
                    <Label htmlFor={`tk-${f.label}`} className="flex items-center gap-2 flex-wrap">
                      {hint?.friendlyLabel ?? f.label}
                      <Badge variant="outline" className="text-[10px]">{f.kind}</Badge>
                      {isAiAdded && (
                        <Badge className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
                          <Wand2 className="h-2.5 w-2.5" /> Added by JARVIS
                        </Badge>
                      )}
                      {!isAiAdded && hint && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    {hint?.description && (
                      <p className="text-xs text-muted-foreground">{hint.description}</p>
                    )}
                    {hint?.example && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-semibold">Example:</span>{" "}
                        <span className="font-mono">{hint.example}</span>
                      </p>
                    )}
                    {f.kind === "select" && (choices && choices.length > 0) ? (
                      <select
                        id={`tk-${f.label}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={tkValues[f.label] ?? ""}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      >
                        <option value="">-- Select --</option>
                        {choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : f.kind === "select" && dynamicOptionsLoading[f.label] ? (
                      <div className="w-full h-10 px-3 rounded-md border border-input bg-muted/40 text-sm flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading options from script…
                      </div>
                    ) : f.kind === "select" && dynamicFunc ? (
                      <div className="space-y-1">
                        <Input
                          id={`tk-${f.label}`}
                          value={tkValues[f.label] ?? ""}
                          placeholder={`Type ${f.label.toLowerCase()} (auto-load failed)`}
                          onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                        />
                        {dynamicOptionsError[f.label] && (
                          <p className="text-[11px] text-amber-500">
                            Couldn't auto-load options ({dynamicOptionsError[f.label]}). You can type the value manually.
                          </p>
                        )}
                      </div>
                    ) : f.kind === "select" ? (
                      <Input
                        id={`tk-${f.label}`}
                        value={tkValues[f.label] ?? ""}
                        placeholder={`Type ${f.label.toLowerCase()}`}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      />
                    ) : f.kind === "checkbox" ? (
                      <select
                        id={`tk-${f.label}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={tkValues[f.label] ?? "false"}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    ) : f.kind === "textarea" ? (
                      <Textarea
                        id={`tk-${f.label}`}
                        value={tkValues[f.label] ?? ""}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                        className="font-mono text-sm min-h-[80px]"
                      />
                    ) : (
                      <Input
                        id={`tk-${f.label}`}
                        type={f.kind === "password" ? "password" : f.kind === "number" ? "number" : "text"}
                        value={tkValues[f.label] ?? ""}
                        placeholder={defaultVal ?? hint?.placeholder ?? `Enter ${f.label.toLowerCase()}`}
                        onChange={(e) => setTkValues((v) => ({ ...v, [f.label]: e.target.value }))}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {schema.tkForm.needsFile && (
              <div className="space-y-2 p-4 rounded-lg border border-dashed border-primary/40 bg-primary/5">
                <Label className="flex items-center gap-2 font-semibold">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  {schema.tkForm.fileLabel ?? "File"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  This file replaces the native file dialog the script would normally open.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="cursor-pointer"
                  />
                  {file && (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Upload className="h-3 w-3" />
                      {(file.size / 1024).toFixed(1)} KB
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {schema.tkForm.actions.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="tk-action" className="flex items-center gap-2">
                  Action to Run
                  <span className="text-destructive text-xs">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pick which button from the original GUI you want to trigger.
                </p>
                <select
                  id="tk-action"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={tkAction}
                  onChange={(e) => setTkAction(e.target.value)}
                >
                  {schema.tkForm.actions.map((a) => {
                    const ah = findActionHint(a.label);
                    return (
                      <option key={a.label} value={a.label}>
                        {ah?.friendlyLabel ? `${ah.friendlyLabel} (${a.label})` : a.label}
                      </option>
                    );
                  })}
                </select>
                {tkAction && findActionHint(tkAction)?.description && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1">
                    <Sparkles className="h-3 w-3 text-purple-500 mt-0.5 shrink-0" />
                    {findActionHint(tkAction)?.description}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {!loadingSchema && schema && hasInputs && (
          <div className="space-y-5 py-2">
            {schema.args.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                  Command-line Arguments
                </div>
                {schema.args.map((a) => {
                  const ahint = findArgHint(a.label);
                  return (
                  <div key={a.name} className="space-y-1.5">
                    <Label htmlFor={`arg-${a.name}`} className="flex items-center gap-2">
                      {ahint?.friendlyLabel ?? a.label}
                      {a.required && <span className="text-destructive text-xs">*</span>}
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {a.flag ?? a.name}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                      {ahint && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    {ahint?.description && (
                      <p className="text-xs text-muted-foreground">{ahint.description}</p>
                    )}
                    {!ahint?.description && a.help && (
                      <p className="text-xs text-muted-foreground">{a.help}</p>
                    )}
                    {ahint?.example && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-semibold">Example:</span>{" "}
                        <span className="font-mono">{ahint.example}</span>
                      </p>
                    )}
                    {a.choices ? (
                      <select
                        id={`arg-${a.name}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={values[a.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      >
                        <option value="">-- Select --</option>
                        {a.choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : a.type === "bool" ? (
                      <select
                        id={`arg-${a.name}`}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                        value={values[a.name] ?? "false"}
                        onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    ) : (
                      <Input
                        id={`arg-${a.name}`}
                        type={a.type === "int" || a.type === "float" ? "number" : "text"}
                        step={a.type === "float" ? "any" : undefined}
                        value={values[a.name] ?? ""}
                        placeholder={a.default ?? `Enter ${a.label.toLowerCase()}`}
                        onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {schema.inputs.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide flex items-center gap-2">
                  <Keyboard className="h-4 w-4" />
                  Interactive Prompts
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  The script asks for input. Fill each prompt below — values will be sent in order.
                </p>
                {schema.inputs.map((inp, idx) => {
                  const isFileSlot = idx === filePromptIndex;
                  return (
                  <div key={idx} className="space-y-1.5">
                    <Label htmlFor={`input-${idx}`} className="flex items-center gap-2">
                      {inp.prompt || `Prompt ${idx + 1}`}
                      <span className="text-destructive text-xs">*</span>
                      {inp.secret && <Badge variant="outline" className="text-[10px]">password</Badge>}
                      {isFileSlot && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Upload className="h-3 w-3" /> Auto-filled from upload
                        </Badge>
                      )}
                    </Label>
                    {isFileSlot ? (
                      <div className="text-xs px-3 py-2 rounded-md border border-dashed bg-muted/30 text-muted-foreground">
                        {file
                          ? <>The path of your uploaded file <span className="font-mono">{file.name}</span> will be sent here automatically.</>
                          : <>Upload a file in the section below — its path will be sent in answer to this prompt.</>}
                      </div>
                    ) : (
                      <Input
                        id={`input-${idx}`}
                        type={inp.secret ? "password" : "text"}
                        value={inputValues[idx] ?? ""}
                        onChange={(e) => {
                          const next = [...inputValues];
                          next[idx] = e.target.value;
                          setInputValues(next);
                        }}
                        placeholder="Type your answer..."
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {schema.hardcodedPaths && schema.hardcodedPaths.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-foreground/80 uppercase tracking-wide flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Hard-coded File Paths
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  This script references files by absolute path that won't exist on the server. Upload a replacement for each one — the path in the script will be rewritten to point at your upload.
                </p>
                {schema.hardcodedPaths.map((hp, i) => {
                  const hint = findPathHint(hp.literal);
                  const f = pathFiles[i];
                  return (
                    <div key={i} className="space-y-2 p-4 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5">
                      <Label className="flex items-center gap-2 font-semibold">
                        <FileSpreadsheet className="h-4 w-4 text-amber-600" />
                        {hint?.friendlyLabel ?? hp.label}
                        <span className="text-destructive text-xs">*</span>
                        <Badge variant="outline" className="text-[10px]">{hp.kind}</Badge>
                        <Badge variant="secondary" className="text-[10px] font-mono">{hp.func}()</Badge>
                        {hint && <Sparkles className="h-3 w-3 text-purple-500" />}
                      </Label>
                      {hint?.description && (
                        <p className="text-xs text-muted-foreground">{hint.description}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Original path in script: <span className="font-mono break-all">{hp.path}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          accept={ACCEPT_BY_KIND[hp.kind] ?? "*"}
                          onChange={(e) => {
                            const next = { ...pathFiles };
                            const sel = e.target.files?.[0];
                            if (sel) next[i] = sel;
                            else delete next[i];
                            setPathFiles(next);
                          }}
                          className="cursor-pointer"
                        />
                        {f && (
                          <Badge variant="secondary" className="shrink-0 gap-1">
                            <Upload className="h-3 w-3" />
                            {(f.size / 1024).toFixed(1)} KB
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {schema.file && (
              <div className="space-y-2 p-4 rounded-lg border border-dashed border-primary/40 bg-primary/5">
                <Label className="flex items-center gap-2 font-semibold">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  {schema.file.label}
                  {schema.file.required && <span className="text-destructive text-xs">*</span>}
                </Label>
                <p className="text-xs text-muted-foreground">{schema.file.hint}</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept={ACCEPT_BY_KIND[schema.file.kind] ?? "*"}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="cursor-pointer"
                  />
                  {file && (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Upload className="h-3 w-3" />
                      {(file.size / 1024).toFixed(1)} KB
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {schema.needsStdin && schema.inputs.length === 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="stdin-input" className="flex items-center gap-2">
                  Standard Input
                  {schema.stdinPrompt && (
                    <span className="text-xs text-muted-foreground italic">
                      Prompt: "{schema.stdinPrompt}"
                    </span>
                  )}
                </Label>
                <Textarea
                  id="stdin-input"
                  value={extraStdin}
                  onChange={(e) => setExtraStdin(e.target.value)}
                  placeholder="Type the value(s) the script will read..."
                  className="font-mono text-sm min-h-[80px]"
                />
              </div>
            )}
          </div>
        )}

        {(running || liveLog.length > 0) && (
          <div className="rounded-md border border-primary/30 bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              {running ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              ) : (
                <Terminal className="h-4 w-4 text-primary" />
              )}
              <span className="text-sm font-semibold">
                {running ? "Live Execution Log" : "Execution Log"}
              </span>
              {running && (
                <Badge variant="outline" className="ml-auto text-[10px] gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Streaming
                </Badge>
              )}
            </div>
            <div
              ref={(el) => {
                if (el) el.scrollTop = el.scrollHeight;
              }}
              className="bg-black rounded p-3 font-mono text-xs max-h-72 overflow-auto whitespace-pre-wrap break-all"
            >
              {liveLog.length === 0 ? (
                <span className="text-muted-foreground italic">Waiting for output...</span>
              ) : (
                liveLog.map((entry, i) => (
                  <span
                    key={i}
                    className={
                      entry.type === "stderr"
                        ? "text-red-400"
                        : entry.type === "status"
                          ? "text-cyan-400 italic"
                          : "text-green-400"
                    }
                  >
                    {entry.type === "status" ? `[*] ${entry.text}\n` : entry.text}
                  </span>
                ))
              )}
            </div>
          </div>
        )}

        {result?.deps && (result.deps.installed.length > 0 || result.deps.failed.length > 0) && (
          <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 text-xs space-y-1">
            <div className="font-semibold text-blue-600 dark:text-blue-400">Dependency installation</div>
            {result.deps.installed.length > 0 && (
              <div>Installed: <span className="font-mono">{result.deps.installed.join(", ")}</span></div>
            )}
            {result.deps.failed.length > 0 && (
              <div className="text-destructive">
                Failed: {result.deps.failed.map((f) => (
                  <div key={f.pkg} className="mt-1">
                    <span className="font-mono font-semibold">{f.pkg}</span>
                    <pre className="whitespace-pre-wrap text-[10px] opacity-80 mt-0.5">{f.error.slice(0, 400)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {result && (
          <div className={`rounded-md border p-3 space-y-2 ${result.success ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2">
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm font-semibold">
                {result.success ? "Success" : "Failed"}
              </span>
              <Badge variant="outline" className="ml-auto">
                <Clock className="h-3 w-3 mr-1" />
                {result.executionTimeMs}ms
              </Badge>
              <Badge variant={result.success ? "default" : "destructive"}>
                exit {result.exitCode}
              </Badge>
            </div>
            {result.stdout && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                  <Terminal className="h-3 w-3" /> Output
                </div>
                <pre className="bg-black text-green-400 p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">
                  {result.stdout}
                </pre>
              </div>
            )}
            {result.stderr && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">Errors</div>
                <pre className="bg-black text-red-400 p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto">
                  {result.stderr}
                </pre>
              </div>
            )}
            {!result.stdout && !result.stderr && (
              <p className="text-xs italic text-muted-foreground">No output produced.</p>
            )}
            {(aiFixHistory.length > 0 || (!result.success && (aiFixAutoMode || aiFixLoading))) && (
              <div className="border border-purple-500/30 bg-purple-500/5 rounded-md p-3 space-y-3">
                {/* Header — always shows JARVIS Auto-Fix status + toggle */}
                <div className="flex items-start gap-2">
                  <Wand2 className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">JARVIS Auto-Fix</span>
                      <Badge
                        variant={aiFixAutoMode ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {aiFixAutoMode ? "ON" : "OFF"}
                      </Badge>
                      {aiFixAttempt > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          Attempt {aiFixAttempt}/{MAX_AUTO_FIX_ATTEMPTS}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      JARVIS reads errors, patches the code, and re-runs automatically — up to {MAX_AUTO_FIX_ATTEMPTS} attempts.
                    </p>
                  </div>
                  {!aiFixLoading && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setAiFixAutoMode((v) => !v)}
                    >
                      {aiFixAutoMode ? "Turn off" : "Turn on"}
                    </Button>
                  )}
                </div>

                {/* Live status while JARVIS is working */}
                {aiFixLoading && (
                  <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 border-t border-purple-500/20 pt-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>
                      JARVIS is analyzing the error and patching the code… (attempt {aiFixAttempt} of {MAX_AUTO_FIX_ATTEMPTS})
                    </span>
                  </div>
                )}

                {/* Attempt timeline — every fix JARVIS tried, with diagnosis and outcome */}
                {aiFixHistory.length > 0 && (
                  <div className="space-y-2 border-t border-purple-500/20 pt-2">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-purple-600/80 dark:text-purple-400/80">
                      Auto-Fix Timeline
                    </div>
                    {aiFixHistory.map((h) => {
                      const outcomeBadge =
                        h.outcome === "fixed" ? { label: "Fixed", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" } :
                        h.outcome === "still_failing" ? { label: "Still failing", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" } :
                        h.outcome === "error" ? { label: "JARVIS error", cls: "bg-destructive/15 text-destructive border-destructive/30" } :
                        { label: "Re-running…", cls: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30" };
                      return (
                        <div key={h.attempt} className="rounded border border-purple-500/20 bg-background/40 p-2 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">Attempt {h.attempt}</Badge>
                            <Badge variant="outline" className={`text-[10px] ${outcomeBadge.cls}`}>{outcomeBadge.label}</Badge>
                            {h.outcome !== "error" && (
                              <Badge
                                variant={h.confidence === "high" ? "default" : h.confidence === "medium" ? "secondary" : "outline"}
                                className="text-[10px]"
                              >
                                {h.confidence} confidence
                              </Badge>
                            )}
                            {h.provider && <Badge variant="outline" className="text-[10px]">{h.provider}</Badge>}
                          </div>
                          {h.outcome === "error" ? (
                            <p className="text-xs text-destructive">{h.error || "JARVIS could not produce a fix."}</p>
                          ) : (
                            <>
                              <p className="text-xs text-foreground/80">{h.diagnosis}</p>
                              {h.changes.length > 0 && (
                                <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                                  {h.changes.slice(0, 4).map((c, i) => <li key={i}>{c}</li>)}
                                  {h.changes.length > 4 && (
                                    <li className="list-none text-muted-foreground/60">+{h.changes.length - 4} more changes</li>
                                  )}
                                </ul>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Final state — JARVIS gave up after exhausting attempts */}
                {!aiFixLoading && !result.success && (aiFixGaveUp || aiFixAttempt >= MAX_AUTO_FIX_ATTEMPTS) && (
                  <div className="flex items-start gap-2 border-t border-purple-500/20 pt-2">
                    <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs text-foreground/80">
                      JARVIS could not fully resolve the error after {aiFixAttempt} attempt{aiFixAttempt === 1 ? "" : "s"}.
                      You can review the timeline above, manually open the latest fix, or try again.
                      <div className="flex items-center gap-2 mt-2">
                        <Button size="sm" variant="outline" onClick={requestAiFix} disabled={aiFixLoading}>
                          <Wand2 className="h-3 w-3 mr-1.5" />Open last fix
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setAiFixAttempt(0);
                            setAiFixHistory([]);
                            setAiFixGaveUp(false);
                            aiFixHandledForRef.current = null;
                            executeNow();
                          }}
                          disabled={running || aiFixLoading}
                        >
                          <Play className="h-3 w-3 mr-1.5" />Run again
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Auto-mode is OFF and we have a failed result — give the user manual controls */}
                {!aiFixLoading && !result.success && !aiFixAutoMode && aiFixHistory.length === 0 && (
                  <div className="flex items-center gap-2 border-t border-purple-500/20 pt-2">
                    <Button size="sm" onClick={fixAndRerun} disabled={aiFixLoading}>
                      <Wand2 className="mr-2 h-3 w-3" />Fix &amp; Re-run once
                    </Button>
                    <Button size="sm" variant="outline" onClick={requestAiFix} disabled={aiFixLoading}>
                      Review fix first
                    </Button>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        <Dialog open={aiFixOpen} onOpenChange={(o) => { if (!aiFixApplying) setAiFixOpen(o); }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-amber-500" />
                AI Fix Proposal
                {aiFixProvider && (
                  <Badge variant="outline" className="ml-2 text-xs">{aiFixProvider}</Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                Review the AI's analysis and proposed fix for <span className="font-medium">{scriptName}</span>. Nothing is changed until you click Apply.
              </DialogDescription>
            </DialogHeader>

            {aiFixLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Analysing the error and the script…
              </div>
            )}

            {!aiFixLoading && aiFixProposal && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Diagnosis</div>
                    <p className="text-sm">{aiFixProposal.diagnosis}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Root cause</div>
                    <p className="text-sm">{aiFixProposal.rootCause || "—"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Confidence:</span>
                  <Badge
                    variant={aiFixProposal.confidence === "high" ? "default" : aiFixProposal.confidence === "medium" ? "secondary" : "outline"}
                  >
                    {aiFixProposal.confidence}
                  </Badge>
                  {aiFixOriginal && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {aiFixOriginal.length} → {aiFixProposal.fixedCode.length} chars
                    </span>
                  )}
                </div>

                {aiFixProposal.changes.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Changes</div>
                    <ul className="text-sm list-disc pl-5 space-y-1">
                      {aiFixProposal.changes.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}

                {aiFixProposal.notes && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                    <span className="font-semibold">Notes: </span>{aiFixProposal.notes}
                  </div>
                )}

                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Proposed code</div>
                  <pre className="bg-black text-green-400 p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-80 overflow-auto">
                    {aiFixProposal.fixedCode}
                  </pre>
                </div>

                {aiFixApplied && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" />
                    Fix applied. Close this and click <span className="font-semibold">Run Again</span> to try the new code.
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setAiFixOpen(false)} disabled={aiFixApplying}>
                {aiFixApplied ? "Close" : "Cancel"}
              </Button>
              {aiFixProposal && !aiFixApplied && (
                <>
                  <Button variant="outline" onClick={applyAiFix} disabled={aiFixApplying}>
                    {aiFixApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Apply only
                  </Button>
                  <Button
                    onClick={async () => {
                      await applyAiFix();
                      setAiFixOpen(false);
                      setAiFixAutoMode(true);
                      setAiFixApplied(true);
                      executeNow();
                    }}
                    disabled={aiFixApplying}
                  >
                    <Wand2 className="mr-2 h-4 w-4" />
                    Apply &amp; Re-run
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {hasInputs ? (
            <Button onClick={handleSubmit} disabled={running || loadingSchema}>
              {running ? (
                "Executing..."
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Execute
                </>
              )}
            </Button>
          ) : (
            !loadingSchema && (
              <Button onClick={() => executeNow()} disabled={running}>
                <Play className="mr-2 h-4 w-4" />
                {result ? "Run Again" : "Execute"}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
