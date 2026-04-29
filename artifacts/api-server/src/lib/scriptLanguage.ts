export type ScriptLanguageId =
  | "python"
  | "bash"
  | "javascript"
  | "typescript"
  | "powershell"
  | "batch"
  | "vbscript"
  | "vba"
  | "html"
  | "sql"
  | "ruby"
  | "perl"
  | "php"
  | "unknown";

export interface ScriptLanguage {
  id: ScriptLanguageId;
  displayName: string;
  fenceTag: string;
  interpreter: string | null;
  interpreterArgs: string[];
  runnable: boolean;
  unrunnableReason?: string;
  filePrefix: string;
  fileExt: string;
  comment: string;
}

const LANGS: Record<ScriptLanguageId, ScriptLanguage> = {
  python: {
    id: "python",
    displayName: "Python",
    fenceTag: "python",
    interpreter: "python3",
    interpreterArgs: ["-u"],
    runnable: true,
    filePrefix: "script",
    fileExt: ".py",
    comment: "#",
  },
  bash: {
    id: "bash",
    displayName: "Bash / Shell",
    fenceTag: "bash",
    interpreter: "bash",
    interpreterArgs: [],
    runnable: true,
    filePrefix: "script",
    fileExt: ".sh",
    comment: "#",
  },
  javascript: {
    id: "javascript",
    displayName: "JavaScript (Node.js)",
    fenceTag: "javascript",
    interpreter: "node",
    interpreterArgs: [],
    runnable: true,
    filePrefix: "script",
    fileExt: ".js",
    comment: "//",
  },
  typescript: {
    id: "typescript",
    displayName: "TypeScript",
    fenceTag: "typescript",
    interpreter: "npx",
    interpreterArgs: ["-y", "tsx"],
    runnable: true,
    filePrefix: "script",
    fileExt: ".ts",
    comment: "//",
  },
  powershell: {
    id: "powershell",
    displayName: "PowerShell",
    fenceTag: "powershell",
    interpreter: "pwsh",
    interpreterArgs: ["-NoProfile", "-NonInteractive", "-File"],
    runnable: true,
    unrunnableReason:
      "PowerShell Core (pwsh) may not be installed in this environment. Light AI can still review and fix the script.",
    filePrefix: "script",
    fileExt: ".ps1",
    comment: "#",
  },
  batch: {
    id: "batch",
    displayName: "Windows Batch",
    fenceTag: "batch",
    interpreter: null,
    interpreterArgs: [],
    runnable: false,
    unrunnableReason:
      "Windows .bat / .cmd files require cmd.exe and cannot run on this Linux server. Light AI can still analyze, fix and enhance the script — copy the result and run it on a Windows machine.",
    filePrefix: "script",
    fileExt: ".bat",
    comment: "REM",
  },
  vbscript: {
    id: "vbscript",
    displayName: "VBScript",
    fenceTag: "vbscript",
    interpreter: null,
    interpreterArgs: [],
    runnable: false,
    unrunnableReason:
      "VBScript needs Windows Script Host (cscript.exe) and cannot run on this Linux server. Light AI can still analyze, fix and enhance the script.",
    filePrefix: "script",
    fileExt: ".vbs",
    comment: "'",
  },
  vba: {
    id: "vba",
    displayName: "VBA / Office Macro",
    fenceTag: "vb",
    interpreter: null,
    interpreterArgs: [],
    runnable: false,
    unrunnableReason:
      "VBA / Office macros only run inside Microsoft Office (Excel, Word, Access). Light AI can still analyze, fix and enhance the macro — paste the result into the VBA editor.",
    filePrefix: "macro",
    fileExt: ".bas",
    comment: "'",
  },
  html: {
    id: "html",
    displayName: "HTML",
    fenceTag: "html",
    interpreter: null,
    interpreterArgs: [],
    runnable: false,
    unrunnableReason:
      "HTML files are rendered in a browser, not executed on the server. Light AI can still validate, fix and enhance the markup, JavaScript and CSS inside the file.",
    filePrefix: "page",
    fileExt: ".html",
    comment: "<!--",
  },
  sql: {
    id: "sql",
    displayName: "SQL",
    fenceTag: "sql",
    interpreter: null,
    interpreterArgs: [],
    runnable: false,
    unrunnableReason:
      "SQL needs a target database connection to execute. Light AI can still review the query for syntax, performance and safety issues.",
    filePrefix: "query",
    fileExt: ".sql",
    comment: "--",
  },
  ruby: {
    id: "ruby",
    displayName: "Ruby",
    fenceTag: "ruby",
    interpreter: "ruby",
    interpreterArgs: [],
    runnable: true,
    filePrefix: "script",
    fileExt: ".rb",
    comment: "#",
  },
  perl: {
    id: "perl",
    displayName: "Perl",
    fenceTag: "perl",
    interpreter: "perl",
    interpreterArgs: [],
    runnable: true,
    filePrefix: "script",
    fileExt: ".pl",
    comment: "#",
  },
  php: {
    id: "php",
    displayName: "PHP",
    fenceTag: "php",
    interpreter: "php",
    interpreterArgs: [],
    runnable: true,
    filePrefix: "script",
    fileExt: ".php",
    comment: "//",
  },
  unknown: {
    id: "unknown",
    displayName: "Plain text / Unknown",
    fenceTag: "",
    interpreter: null,
    interpreterArgs: [],
    runnable: false,
    unrunnableReason:
      "Light AI could not determine the language of this file. Rename the file with a recognised extension (.py, .sh, .ps1, .bat, .vbs, .html, .js, .sql, …) so it can be analysed correctly.",
    filePrefix: "file",
    fileExt: ".txt",
    comment: "#",
  },
};

const EXT_TO_LANG: Record<string, ScriptLanguageId> = {
  ".py": "python",
  ".pyw": "python",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".bat": "batch",
  ".cmd": "batch",
  ".vbs": "vbscript",
  ".vba": "vba",
  ".bas": "vba",
  ".cls": "vba",
  ".frm": "vba",
  ".html": "html",
  ".htm": "html",
  ".sql": "sql",
  ".rb": "ruby",
  ".pl": "perl",
  ".php": "php",
};

export function detectLanguageFromFilename(filename: string | null | undefined): ScriptLanguageId {
  if (!filename) return "unknown";
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "unknown";
  const ext = lower.slice(dot);
  return EXT_TO_LANG[ext] ?? "unknown";
}

export function detectLanguageFromContent(code: string): ScriptLanguageId {
  const head = code.slice(0, 600);
  const lower = head.toLowerCase();
  // Shebangs
  const shebang = head.startsWith("#!") ? head.split("\n", 1)[0] : "";
  if (shebang) {
    if (/python/.test(shebang)) return "python";
    if (/bash|sh\b|zsh/.test(shebang)) return "bash";
    if (/node/.test(shebang)) return "javascript";
    if (/pwsh|powershell/.test(shebang)) return "powershell";
    if (/ruby/.test(shebang)) return "ruby";
    if (/perl/.test(shebang)) return "perl";
    if (/php/.test(shebang)) return "php";
  }
  // HTML
  if (lower.includes("<!doctype html") || /<html[\s>]/.test(lower)) return "html";
  // Batch
  if (/^@echo\s+off|^echo\s+off/im.test(head) || /%~dp0|%errorlevel%/i.test(head)) return "batch";
  // PowerShell
  if (/(^|\n)\s*param\s*\(/i.test(head) || /\$psitem|\$_\.|write-host|get-childitem|set-executionpolicy/i.test(lower)) return "powershell";
  // VBA / VBScript
  if (/(^|\n)\s*(sub|function)\s+\w+\s*\(/i.test(head) && /\bend\s+(sub|function)\b/i.test(code)) return "vba";
  if (/createobject\s*\(/i.test(lower) && /wscript\./i.test(lower)) return "vbscript";
  // SQL
  if (/^\s*(select|insert|update|delete|create|alter|drop|with)\b/i.test(head)) return "sql";
  // Python
  if (/(^|\n)\s*(def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import)/.test(head)) return "python";
  // JS
  if (/(^|\n)\s*(const|let|var|function|import|export)\s/.test(head) && /[;{}]/.test(head)) return "javascript";
  return "unknown";
}

export function detectLanguage(filename: string | null | undefined, code: string): ScriptLanguage {
  const fromName = detectLanguageFromFilename(filename);
  if (fromName !== "unknown") return LANGS[fromName];
  const fromCode = detectLanguageFromContent(code ?? "");
  return LANGS[fromCode];
}

export function getLanguageById(id: ScriptLanguageId): ScriptLanguage {
  return LANGS[id];
}
