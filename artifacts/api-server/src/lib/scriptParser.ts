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

export type ScriptInputsSchema = {
  args: DetectedArg[];
  inputs: DetectedInput[];
  needsStdin: boolean;
  stdinPrompt: string | null;
  file: DetectedFile;
  gui: DetectedGui;
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

  return { args, inputs, needsStdin, stdinPrompt, file, gui };
}
