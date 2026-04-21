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
  kind: "excel" | "csv" | "json" | "text";
  label: string;
  hint: string;
} | null;

export type ScriptInputsSchema = {
  args: DetectedArg[];
  needsStdin: boolean;
  stdinPrompt: string | null;
  file: DetectedFile;
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

export function parseScriptInputs(code: string): ScriptInputsSchema {
  const args: DetectedArg[] = [];

  if (/argparse\.ArgumentParser|ArgumentParser\s*\(/.test(code)) {
    const calls = findAddArgumentCalls(code);
    for (const c of calls) {
      const a = parseAddArgumentCall(c);
      if (a) args.push(a);
    }
  }

  const inputCalls = [...code.matchAll(/(?<![a-zA-Z0-9_])input\s*\(\s*(?:(['"])([^'"\\]*)\1)?/g)];
  let needsStdin = false;
  let stdinPrompt: string | null = null;
  if (inputCalls.length > 0) {
    needsStdin = true;
    const prompts = inputCalls.map((m) => m[2]).filter((x): x is string => !!x);
    if (prompts.length > 0) stdinPrompt = prompts.join(" / ");
  }
  if (/sys\.stdin\.(read|readline|readlines)|fileinput\./.test(code)) {
    needsStdin = true;
  }

  let file: DetectedFile = null;
  const excelHit = /pd\.read_excel|openpyxl|xlrd|load_workbook|\.xlsx|\.xls\b/.test(code);
  const csvHit = /pd\.read_csv|csv\.reader|csv\.DictReader|\.csv\b/.test(code);
  const jsonFileHit = /json\.load\s*\(|\.json['"]/.test(code);
  if (excelHit) {
    file = { required: false, kind: "excel", label: "Excel file (.xlsx, .xls)", hint: "Bulk data via Excel — file path will be passed to your script." };
  } else if (csvHit) {
    file = { required: false, kind: "csv", label: "CSV file (.csv)", hint: "Bulk data via CSV — file path will be passed to your script." };
  } else if (jsonFileHit) {
    file = { required: false, kind: "json", label: "JSON file (.json)", hint: "File path will be passed to your script." };
  }

  if (file) {
    const looksRequired =
      args.some((a) => /file|path|input|excel|csv|sheet/i.test(a.name)) ||
      /sys\.argv\[1\]|sys\.argv\[-1\]/.test(code);
    if (looksRequired || args.length === 0) {
      file.required = excelHit || csvHit;
    }
  }

  return { args, needsStdin, stdinPrompt, file };
}
