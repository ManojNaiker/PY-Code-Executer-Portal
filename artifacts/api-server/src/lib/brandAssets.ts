import path from "node:path";
import fs from "node:fs";

/**
 * Absolute filesystem path to the bundled brand logo PNG. The api-server
 * always runs with cwd = `artifacts/api-server`, so this resolves to the
 * server-managed copy at `artifacts/api-server/assets/brand-logo.png`.
 *
 * Used as the default value injected into any GUI form field that asks for a
 * logo / icon path — so the user never has to type a path themselves and the
 * Python script can open the file directly via `Image.open(...)` /
 * `PhotoImage(file=...)` etc. against the same filesystem.
 */
export const BRAND_LOGO_ABS_PATH = path.resolve(process.cwd(), "assets/brand-logo.png");

export function brandLogoExists(): boolean {
  try {
    return fs.statSync(BRAND_LOGO_ABS_PATH).isFile();
  } catch {
    return false;
  }
}

const LOGO_OR_ICON_LABEL_RE = /\b(logo|icon)\b.*\b(path|file|location|image|src)\b|\b(path|file|location|image|src)\b.*\b(logo|icon)\b|^\s*(logo|icon)\s*$/i;

/**
 * True when a form field's label looks like it's asking the user for a
 * logo / icon file path (e.g. "Logo Path", "Icon File", "Brand Logo Image",
 * "Path to Logo", or just "Logo").
 */
export function looksLikeLogoOrIconField(label: string | undefined | null): boolean {
  if (!label) return false;
  return LOGO_OR_ICON_LABEL_RE.test(label.trim());
}
