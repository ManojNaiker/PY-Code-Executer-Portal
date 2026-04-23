export type DetectedArg = {
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

export type DetectedFile = {
  required: boolean;
  kind: "excel" | "csv" | "json" | "text" | "image" | "any";
  label: string;
  hint: string;
  source: "extension" | "filedialog" | "argparse" | "argv";
} | null;

export type DetectedInput = {
  prompt: string;
  secret: boolean;
};

export type DetectedGui = {
  framework: "tkinter" | "pyqt5" | "pyqt6" | "pyside2" | "pyside6" | "wx" | "kivy" | "pysimplegui" | "customtkinter";
  hasMainLoop: boolean;
} | null;

export type TkField = {
  label: string;
  kind: "text" | "password" | "number" | "select" | "checkbox" | "textarea";
  choices?: string[];
  default?: string;
};

export type TkAction = {
  label: string;
};

export type TkForm = {
  fields: TkField[];
  actions: TkAction[];
  needsFile: boolean;
  fileLabel: string | null;
} | null;

export type HardcodedPath = {
  literal: string;
  path: string;
  kind: "excel" | "csv" | "json" | "image" | "text" | "any";
  label: string;
  func: string;
};

export type ScriptInputsSchema = {
  args: DetectedArg[];
  inputs: DetectedInput[];
  needsStdin: boolean;
  stdinPrompt: string | null;
  file: DetectedFile;
  gui: DetectedGui;
  tkForm: TkForm;
  hardcodedPaths: HardcodedPath[];
};

function humanizeName(raw: string): string {
  const cleaned = raw.replace(/^-+/, "").replace(/[-_]+/g, " ").trim();
  if (!cleaned) return raw;
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseAddArgumentCall(callBody: string): DetectedArg | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr: string | null = null;
  for (let i = 0; i < callBody.length; i++) {
    const c = callBody[i];
    const prev = i > 0 ? callBody[i - 1] : "";
    if (inStr) {
      cur += c;
      if (c === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());

  let nameOrFlag: string | null = null;
  const kwargs: Record<string, string> = {};
  for (const p of parts) {
    const eqIdx = (() => {
      let d = 0;
      let sQ: string | null = null;
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (sQ) {
          if (c === sQ && p[i - 1] !== "\\") sQ = null;
          continue;
        }
        if (c === '"' || c === "'") { sQ = c; continue; }
        if (c === "(" || c === "[" || c === "{") d++;
        else if (c === ")" || c === "]" || c === "}") d--;
        if (c === "=" && d === 0 && p[i + 1] !== "=") return i;
      }
      return -1;
    })();
    if (eqIdx === -1) {
      if (!nameOrFlag) nameOrFlag = stripQuotes(p);
    } else {
      const k = p.slice(0, eqIdx).trim();
      const v = p.slice(eqIdx + 1).trim();
      kwargs[k] = v;
    }
  }
  if (!nameOrFlag) return null;

  const isFlag = nameOrFlag.startsWith("-");
  const cleanName = nameOrFlag.replace(/^-+/, "");
  if (!cleanName) return null;

  const helpRaw = kwargs.help ? stripQuotes(kwargs.help) : "";
  const requiredRaw = kwargs.required ? kwargs.required.trim() : "";
  const typeRaw = kwargs.type ? kwargs.type.trim() : "";
  const defaultRaw = kwargs.default ? kwargs.default.trim() : "";
  const choicesRaw = kwargs.choices ? kwargs.choices.trim() : "";
  const actionRaw = kwargs.action ? stripQuotes(kwargs.action) : "";

  let type: DetectedArg["type"] = "string";
  if (typeRaw === "int") type = "int";
  else if (typeRaw === "float") type = "float";
  else if (typeRaw === "bool" || actionRaw === "store_true" || actionRaw === "store_false") type = "bool";

  let choices: string[] | null = null;
  if (choicesRaw && choicesRaw.startsWith("[") && choicesRaw.endsWith("]")) {
    choices = choicesRaw
      .slice(1, -1)
      .split(",")
      .map((x) => stripQuotes(x.trim()))
      .filter(Boolean);
  }

  let defaultVal: string | null = null;
  if (defaultRaw && defaultRaw !== "None") {
    defaultVal = stripQuotes(defaultRaw);
  }

  const required = isFlag ? requiredRaw === "True" : true;

  return {
    name: cleanName,
    flag: isFlag ? nameOrFlag : null,
    label: humanizeName(cleanName),
    help: helpRaw,
    required,
    type,
    default: defaultVal,
    choices,
    positional: !isFlag,
  };
}

function findAddArgumentCalls(code: string): string[] {
  const calls: string[] = [];
  const re = /\.add_argument\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let inStr: string | null = null;
    let body = "";
    while (i < code.length && depth > 0) {
      const c = code[i];
      const prev = i > 0 ? code[i - 1] : "";
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        body += c;
      } else if (c === '"' || c === "'") {
        inStr = c;
        body += c;
      } else if (c === "(") {
        depth++;
        body += c;
      } else if (c === ")") {
        depth--;
        if (depth === 0) break;
        body += c;
      } else {
        body += c;
      }
      i++;
    }
    calls.push(body);
  }
  return calls;
}

function detectGui(code: string): DetectedGui {
  const checks: { fw: NonNullable<DetectedGui>["framework"]; re: RegExp; loop: RegExp }[] = [
    { fw: "customtkinter", re: /\bimport\s+customtkinter|\bfrom\s+customtkinter\b/, loop: /\.mainloop\s*\(/ },
    { fw: "tkinter", re: /\bimport\s+tkinter|\bfrom\s+tkinter\b|\bimport\s+Tkinter\b/, loop: /\.mainloop\s*\(/ },
    { fw: "pyqt6", re: /\bfrom\s+PyQt6\b|\bimport\s+PyQt6\b/, loop: /\.exec(_)?\s*\(/ },
    { fw: "pyqt5", re: /\bfrom\s+PyQt5\b|\bimport\s+PyQt5\b/, loop: /\.exec(_)?\s*\(/ },
    { fw: "pyside6", re: /\bfrom\s+PySide6\b|\bimport\s+PySide6\b/, loop: /\.exec(_)?\s*\(/ },
    { fw: "pyside2", re: /\bfrom\s+PySide2\b|\bimport\s+PySide2\b/, loop: /\.exec(_)?\s*\(/ },
    { fw: "wx", re: /\bimport\s+wx\b|\bfrom\s+wx\b/, loop: /\.MainLoop\s*\(/ },
    { fw: "kivy", re: /\bfrom\s+kivy\b|\bimport\s+kivy\b/, loop: /\.run\s*\(/ },
    { fw: "pysimplegui", re: /\bimport\s+PySimpleGUI|\bfrom\s+PySimpleGUI\b/, loop: /\.read\s*\(|\.Window\s*\(/ },
  ];
  for (const c of checks) {
    if (c.re.test(code)) {
      return { framework: c.fw, hasMainLoop: c.loop.test(code) };
    }
  }
  return null;
}

function detectInputCalls(code: string): DetectedInput[] {
  const out: DetectedInput[] = [];
  const re = /(?<![a-zA-Z0-9_])(input|getpass(?:\.getpass)?)\s*\(\s*(?:(['"])([^'"\\]*)\2)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const fn = m[1];
    const prompt = (m[3] ?? "").trim() || "Input";
    out.push({ prompt, secret: fn.includes("getpass") });
  }
  return out;
}

export function parseScriptInputs(code: string): ScriptInputsSchema {
  const args: DetectedArg[] = [];

  if (/argparse\.ArgumentParser|ArgumentParser\s*\(/.test(code)) {
    const calls = findAddArgumentCalls(code);
    for (const c of calls) {
      const a = parseAddArgumentCall(c);
      if (a) args.push(a);
    }
  }

  const inputs = detectInputCalls(code);
  const needsStdin =
    inputs.length > 0 ||
    /sys\.stdin\.(read|readline|readlines)|fileinput\./.test(code);
  const stdinPrompt = inputs.length > 0
    ? inputs.map((i) => i.prompt).filter(Boolean).join(" / ") || null
    : null;

  let file: DetectedFile = null;

  const fileDialogHit = /filedialog\.(askopenfilename|askopenfilenames|asksaveasfilename|askdirectory)|tkFileDialog\./.test(code);

  // Only consider file inputs when the script READS a file from a path supplied by
  // the user (argparse file-like arg, sys.argv[N], input() that names a path, or
  // filedialog). Plain extension mentions (like a hardcoded output filename) must
  // NOT trigger a required file picker.
  const usesArgvForPath = /sys\.argv\s*\[\s*-?\d+\s*\]/.test(code);
  const fileLikeArg = args.find((a) => /file|path|input|excel|csv|sheet|image|workbook|xlsx|xls|csv/i.test(a.name));
  const inputAsksForPath = inputs.some((i) => /file|path|excel|csv|xlsx|xls|sheet|workbook|image|json/i.test(i.prompt));

  const excelRead = /pd\.read_excel\s*\(|load_workbook\s*\(|openpyxl\.load_workbook|xlrd\.open_workbook/.test(code);
  const csvRead = /pd\.read_csv\s*\(|csv\.reader\s*\(|csv\.DictReader\s*\(/.test(code);
  const jsonRead = /json\.load\s*\(/.test(code);
  const imageRead = /cv2\.imread\s*\(|Image\.open\s*\(|imageio\.imread\s*\(/.test(code);

  const hasUserPathSource = fileDialogHit || usesArgvForPath || !!fileLikeArg || inputAsksForPath;

  if (fileDialogHit) {
    let kind: NonNullable<DetectedFile>["kind"] = "any";
    if (excelRead) kind = "excel";
    else if (csvRead) kind = "csv";
    else if (jsonRead) kind = "json";
    else if (imageRead) kind = "image";
    file = {
      required: true,
      kind,
      label: "Select a file (replaces native file dialog)",
      hint: "The file you upload here will be passed to the script in place of its native file picker.",
      source: "filedialog",
    };
  } else if (hasUserPathSource && (excelRead || csvRead || jsonRead || imageRead)) {
    const kind: NonNullable<DetectedFile>["kind"] =
      excelRead ? "excel" : csvRead ? "csv" : jsonRead ? "json" : "image";
    const label =
      kind === "excel" ? "Excel file (.xlsx, .xls)" :
      kind === "csv" ? "CSV file (.csv)" :
      kind === "json" ? "JSON file (.json)" :
      "Image file";
    file = {
      required: !!(fileLikeArg?.required) || usesArgvForPath || inputAsksForPath,
      kind,
      label,
      hint: "File path will be passed to your script.",
      source: fileLikeArg ? "argparse" : usesArgvForPath ? "argv" : "extension",
    };
  }

  const gui = detectGui(code);
  const tkForm = gui && (gui.framework === "tkinter" || gui.framework === "customtkinter")
    ? parseTkinterForm(code)
    : null;

  const hardcodedPaths = detectHardcodedPaths(code);

  return { args, inputs, needsStdin, stdinPrompt, file, gui, tkForm, hardcodedPaths };
}

// ----------------------------------------------------------------
// Hard-coded file path detection
// ----------------------------------------------------------------

function decodePythonStringLiteral(literal: string): string | null {
  const t = literal.trim();
  // Raw string: r"..." or r'...'
  if (/^[rR]['"]/.test(t)) {
    const q = t[1];
    if (!t.endsWith(q)) return null;
    return t.slice(2, -1);
  }
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0];
    if (!t.endsWith(q)) return null;
    const inner = t.slice(1, -1);
    return inner
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"');
  }
  return null;
}

function looksLikePath(value: string): boolean {
  if (!value) return false;
  // Windows drive letter (e.g. E:\ or C:/) or absolute UNIX path or relative path with extension
  return (
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("\\\\") ||
    /\.[a-zA-Z0-9]{1,5}$/.test(value)
  );
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function detectHardcodedPaths(code: string): HardcodedPath[] {
  const out: HardcodedPath[] = [];
  const seen = new Set<string>();

  type FuncSpec = {
    pattern: RegExp;
    kind: HardcodedPath["kind"];
    func: string;
  };

  const callSpecs: FuncSpec[] = [
    { pattern: /(?:[\w.]*\.)?read_excel\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "excel", func: "read_excel" },
    { pattern: /(?:[\w.]*\.)?ExcelFile\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "excel", func: "ExcelFile" },
    { pattern: /(?:[\w.]*\.)?read_csv\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "csv", func: "read_csv" },
    { pattern: /(?:[\w.]*\.)?read_table\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "csv", func: "read_table" },
    { pattern: /(?:[\w.]*\.)?read_json\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "json", func: "read_json" },
    { pattern: /(?:[\w.]*\.)?read_parquet\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "any", func: "read_parquet" },
    { pattern: /(?:[\w.]*\.)?read_html\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "text", func: "read_html" },
    { pattern: /(?:[\w.]*\.)?read_xml\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "text", func: "read_xml" },
    { pattern: /(?:[\w.]*\.)?load_workbook\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "excel", func: "load_workbook" },
    { pattern: /xlrd\.open_workbook\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "excel", func: "open_workbook" },
    { pattern: /(?:cv2|imageio)\.imread\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "image", func: "imread" },
    { pattern: /cv2\.VideoCapture\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "any", func: "VideoCapture" },
    { pattern: /Image\.open\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "image", func: "Image.open" },
    { pattern: /np\.(?:loadtxt|genfromtxt|load)\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "text", func: "np.loadtxt" },
    { pattern: /(?:[\w.]*\.)?from_csv\s*\(\s*([rR]?['"][^'"\n]+['"])/g, kind: "csv", func: "from_csv" },
  ];

  for (const spec of callSpecs) {
    let m: RegExpExecArray | null;
    spec.pattern.lastIndex = 0;
    while ((m = spec.pattern.exec(code))) {
      const literal = m[1];
      const value = decodePythonStringLiteral(literal);
      if (!value || !looksLikePath(value)) continue;
      const key = `${spec.func}::${literal}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        literal,
        path: value,
        kind: spec.kind,
        func: spec.func,
        label: basenameOf(value),
      });
    }
  }

  const dataExt = /\.(xlsx|xls|csv|tsv|json|txt|xml|yaml|yml|ini|conf|log|html?|parquet|pdf|png|jpe?g|gif|bmp|webp|tiff?|mp4|avi|mov|mkv|wav|mp3|npy|npz|pkl|pickle|h5|hdf5|sqlite|db)$/i;

  // open(path, ...) — only when the file extension suggests a data file
  const openRe = /\bopen\s*\(\s*([rR]?['"][^'"\n]+['"])/g;
  let om: RegExpExecArray | null;
  while ((om = openRe.exec(code))) {
    const literal = om[1];
    const value = decodePythonStringLiteral(literal);
    if (!value || !looksLikePath(value)) continue;
    if (!dataExt.test(value)) continue;
    const key = `open::${literal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ext = value.match(dataExt)?.[1].toLowerCase() ?? "";
    let kind: HardcodedPath["kind"] = "any";
    if (/^xlsx?$/.test(ext)) kind = "excel";
    else if (/^(csv|tsv)$/.test(ext)) kind = "csv";
    else if (ext === "json") kind = "json";
    else if (/^(txt|xml|yaml|yml|ini|conf|log|html?)$/.test(ext)) kind = "text";
    out.push({
      literal,
      path: value,
      kind,
      func: "open",
      label: basenameOf(value),
    });
  }

  // Generic sweep: any string literal in the source that looks like an absolute
  // hard-coded path (Windows drive, UNC, or absolute Unix with a data extension)
  // — covers cases where the path is stored in a CONFIG dict / variable and
  // accessed indirectly later (e.g. CONFIG["EXCEL_FILE"]).
  const litRe = /([rR]?['"][^'"\n]{2,500}['"])/g;
  let lm: RegExpExecArray | null;
  while ((lm = litRe.exec(code))) {
    const literal = lm[1];
    const value = decodePythonStringLiteral(literal);
    if (!value) continue;
    const isWinDrive = /^[a-zA-Z]:[\\/]/.test(value);
    const isUnc = value.startsWith("\\\\");
    const isAbsUnix = value.startsWith("/") && value.length > 3 && dataExt.test(value);
    if (!isWinDrive && !isUnc && !isAbsUnix) continue;

    // Dedup against anything already detected (any func with same literal text)
    const already = out.some((p) => p.literal === literal);
    if (already) continue;
    seen.add(`generic::${literal}`);

    const ext = value.match(dataExt)?.[1]?.toLowerCase() ?? "";
    let kind: HardcodedPath["kind"] = "any";
    if (/^xlsx?$/.test(ext)) kind = "excel";
    else if (/^(csv|tsv)$/.test(ext)) kind = "csv";
    else if (ext === "json") kind = "json";
    else if (/^(png|jpe?g|gif|bmp|webp|tiff?)$/.test(ext)) kind = "image";
    else if (/^(txt|xml|yaml|yml|ini|conf|log|html?)$/.test(ext)) kind = "text";

    out.push({
      literal,
      path: value,
      kind,
      func: "literal",
      label: basenameOf(value),
    });
  }

  return out;
}

// ----------------------------------------------------------------
// Tkinter widget extraction → web form schema
// ----------------------------------------------------------------

function extractKwargs(callBody: string): Record<string, string> {
  // Re-uses the same depth/quote-aware splitter as parseAddArgumentCall
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let cur = "";
  for (let i = 0; i < callBody.length; i++) {
    const c = callBody[i];
    const prev = i > 0 ? callBody[i - 1] : "";
    if (inStr) {
      cur += c;
      if (c === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());

  const kw: Record<string, string> = {};
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]+)$/);
    if (m) kw[m[1]] = m[2].trim();
  }
  return kw;
}

function findCalls(code: string, classNames: string[]): { name: string; body: string; index: number }[] {
  const out: { name: string; body: string; index: number }[] = [];
  const namePattern = classNames
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // Match either bare name (e.g. Entry) or attribute (e.g. ttk.Entry, tk.Button, ctk.CTkButton)
  const re = new RegExp(`(?:[A-Za-z_][A-Za-z0-9_]*\\.)?(${namePattern})\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let inStr: string | null = null;
    let body = "";
    let i = start;
    while (i < code.length && depth > 0) {
      const c = code[i];
      const prev = i > 0 ? code[i - 1] : "";
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        body += c;
      } else if (c === '"' || c === "'") { inStr = c; body += c; }
      else if (c === "(") { depth++; body += c; }
      else if (c === ")") { depth--; if (depth === 0) break; body += c; }
      else body += c;
      i++;
    }
    out.push({ name: m[1], body, index: m.index });
  }
  return out;
}

function lastLabelTextBefore(code: string, beforeIndex: number): string | null {
  // Walk backwards through Label(...) / CTkLabel(...) calls and find the closest
  // text= value that appears before the widget definition.
  const re = /(?:[A-Za-z_][A-Za-z0-9_]*\.)?(?:Label|CTkLabel)\s*\(/g;
  let m: RegExpExecArray | null;
  let lastText: string | null = null;
  while ((m = re.exec(code))) {
    if (m.index >= beforeIndex) break;
    const start = m.index + m[0].length;
    let depth = 1;
    let inStr: string | null = null;
    let body = "";
    let i = start;
    while (i < code.length && depth > 0) {
      const c = code[i];
      const prev = i > 0 ? code[i - 1] : "";
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        body += c;
      } else if (c === '"' || c === "'") { inStr = c; body += c; }
      else if (c === "(") { depth++; body += c; }
      else if (c === ")") { depth--; if (depth === 0) break; body += c; }
      else body += c;
      i++;
    }
    const kw = extractKwargs(body);
    if (kw.text) {
      const t = stripQuotes(kw.text).replace(/[:：]\s*$/, "").trim();
      if (t) lastText = t;
    }
  }
  return lastText;
}

function parseChoicesList(raw: string): string[] | undefined {
  const t = raw.trim();
  if (!(t.startsWith("[") && t.endsWith("]")) && !(t.startsWith("(") && t.endsWith(")"))) return undefined;
  const inner = t.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    const prev = i > 0 ? inner[i - 1] : "";
    if (inStr) { cur += c; if (c === inStr && prev !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(stripQuotes(cur.trim())); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(stripQuotes(cur.trim()));
  return out.filter(Boolean);
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function parseTkinterForm(code: string): TkForm {
  const fields: TkField[] = [];

  // --- Entries / CTkEntry ---
  for (const call of findCalls(code, ["Entry", "CTkEntry"])) {
    const kw = extractKwargs(call.body);
    const showVal = kw.show ? stripQuotes(kw.show) : "";
    const isPassword = showVal === "*" || showVal === "•" || showVal === "●";
    const placeholder = kw.placeholder_text ? stripQuotes(kw.placeholder_text) : "";
    const label =
      lastLabelTextBefore(code, call.index) ||
      placeholder ||
      (kw.name ? stripQuotes(kw.name) : "") ||
      "Input";
    fields.push({
      label,
      kind: isPassword ? "password" : "text",
      default: placeholder || undefined,
    });
  }

  // --- Combobox / OptionMenu / CTkComboBox / CTkOptionMenu ---
  for (const call of findCalls(code, ["Combobox", "OptionMenu", "CTkComboBox", "CTkOptionMenu", "Spinbox", "CTkSpinbox"])) {
    const kw = extractKwargs(call.body);
    const choices = kw.values ? parseChoicesList(kw.values) : undefined;
    const label =
      lastLabelTextBefore(code, call.index) ||
      (kw.name ? stripQuotes(kw.name) : "") ||
      "Select";
    fields.push({
      label,
      kind: choices && choices.length > 0 ? "select" : "text",
      choices,
    });
  }

  // --- Checkbutton / CTkCheckBox / CTkSwitch ---
  for (const call of findCalls(code, ["Checkbutton", "CTkCheckBox", "CTkSwitch"])) {
    const kw = extractKwargs(call.body);
    const label =
      (kw.text ? stripQuotes(kw.text) : "") ||
      lastLabelTextBefore(code, call.index) ||
      "Option";
    fields.push({ label, kind: "checkbox" });
  }

  // --- Text / CTkTextbox blocks (free-form input) ---
  for (const call of findCalls(code, ["Text", "CTkTextbox", "ScrolledText"])) {
    const kw = extractKwargs(call.body);
    // Skip the "Activity Log" style readonly Text widgets — most are output panes.
    // We still expose if the user explicitly bound a textvariable, but in general
    // Text widgets are output, not input, so do not emit unless preceded by a Label.
    const lbl = lastLabelTextBefore(code, call.index);
    if (!lbl) continue;
    fields.push({ label: lbl, kind: "textarea" });
  }

  // --- Buttons → actions ---
  const actions: TkAction[] = [];
  for (const call of findCalls(code, ["Button", "CTkButton"])) {
    const kw = extractKwargs(call.body);
    if (!kw.text || !kw.command) continue;
    const text = stripQuotes(kw.text).trim();
    if (!text) continue;
    // Skip "Browse" / "Cancel" / "Close" / "Exit" buttons — these don't represent a real action.
    if (/^(browse|cancel|close|exit|quit|reset|clear)$/i.test(text)) continue;
    actions.push({ label: text });
  }

  // --- File upload need ---
  const needsFile = /filedialog\.(askopenfilename|askopenfilenames|askopenfile)|tkFileDialog\./.test(code);
  let fileLabel: string | null = null;
  if (needsFile) {
    // Prefer the label associated with a "Browse" button if present
    for (const call of findCalls(code, ["Button", "CTkButton"])) {
      const kw = extractKwargs(call.body);
      if (kw.text && /browse/i.test(stripQuotes(kw.text))) {
        const lbl = lastLabelTextBefore(code, call.index);
        if (lbl) { fileLabel = lbl; break; }
      }
    }
    if (!fileLabel) fileLabel = "File";
  }

  const dedupedFields = dedupeBy(fields, (f) => f.label);
  const dedupedActions = dedupeBy(actions, (a) => a.label);

  if (dedupedFields.length === 0 && dedupedActions.length === 0 && !needsFile) {
    return null;
  }

  return {
    fields: dedupedFields,
    actions: dedupedActions,
    needsFile,
    fileLabel,
  };
}
