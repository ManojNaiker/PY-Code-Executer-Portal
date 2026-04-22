import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import archiver from "archiver";
import { db } from "@workspace/db";
import { scriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { buildExe } from "../lib/exeBuilder";

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "scripts");

function scriptDir(scriptId: number) {
  return path.join(UPLOAD_ROOT, String(scriptId));
}
function logoDir(scriptId: number) {
  return path.join(scriptDir(scriptId), "logo");
}
function supportDir(scriptId: number) {
  return path.join(scriptDir(scriptId), "support");
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

function safeBaseName(name: string): string {
  const base = path.basename(name);
  return base.replace(/[^A-Za-z0-9._\- ]/g, "_").slice(0, 200);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();

async function loadScriptOrDeny(req: any, res: any, requireAdmin: boolean) {
  const userId = req.userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
  if (!me) {
    res.status(401).json({ error: "User not found" });
    return null;
  }
  const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
  if (!script) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (me.role !== "admin" && script.departmentId !== null && script.departmentId !== me.departmentId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  if (requireAdmin && me.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return null;
  }
  return { id, me, script };
}

// Upload / replace logo (admin only)
router.post("/scripts/:id/logo", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const ctx = await loadScriptOrDeny(req, res, true);
    if (!ctx) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Logo must be an image" });

    await ensureDir(logoDir(ctx.id));
    // Remove existing logo files
    const existing = await fsp.readdir(logoDir(ctx.id)).catch(() => []);
    await Promise.all(existing.map(f => fsp.unlink(path.join(logoDir(ctx.id), f)).catch(() => {})));

    // Preserve the original filename so scripts referencing a specific name
    // (e.g. `alfresco_logo.ico`) find it inside the EXE bundle.
    const fname = safeBaseName(req.file.originalname) || `logo${path.extname(req.file.originalname) || ".png"}`;
    const filepath = path.join(logoDir(ctx.id), fname);
    await fsp.writeFile(filepath, req.file.buffer);

    await db.update(scriptsTable)
      .set({ logoPath: path.relative(process.cwd(), filepath), updatedAt: new Date() })
      .where(eq(scriptsTable.id, ctx.id));

    await logAudit({
      req, userId: ctx.me.clerkId, userEmail: ctx.me.email,
      action: "script.logo.upload", resourceType: "script", resourceId: ctx.id,
      details: { filename: req.file.originalname, size: req.file.size },
    });

    res.json({ ok: true, hasLogo: true });
  } catch (err) {
    req.log.error({ err }, "Error uploading logo");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get logo (any user with access)
router.get("/scripts/:id/logo", requireAuth, async (req, res) => {
  try {
    const ctx = await loadScriptOrDeny(req, res, false);
    if (!ctx) return;
    if (!ctx.script.logoPath) return res.status(404).json({ error: "No logo" });
    const abs = path.resolve(process.cwd(), ctx.script.logoPath);
    if (!abs.startsWith(UPLOAD_ROOT)) return res.status(400).json({ error: "Bad path" });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Missing" });
    res.sendFile(abs);
  } catch (err) {
    req.log.error({ err }, "Error fetching logo");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete logo (admin)
router.delete("/scripts/:id/logo", requireAuth, async (req, res) => {
  try {
    const ctx = await loadScriptOrDeny(req, res, true);
    if (!ctx) return;
    if (ctx.script.logoPath) {
      const abs = path.resolve(process.cwd(), ctx.script.logoPath);
      if (abs.startsWith(UPLOAD_ROOT)) await fsp.unlink(abs).catch(() => {});
    }
    await db.update(scriptsTable)
      .set({ logoPath: null, updatedAt: new Date() })
      .where(eq(scriptsTable.id, ctx.id));
    await logAudit({
      req, userId: ctx.me.clerkId, userEmail: ctx.me.email,
      action: "script.logo.delete", resourceType: "script", resourceId: ctx.id,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting logo");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Upload supporting files (admin) — accepts multiple files under field "files"
router.post("/scripts/:id/supporting-files", requireAuth, upload.array("files", 20), async (req, res) => {
  try {
    const ctx = await loadScriptOrDeny(req, res, true);
    if (!ctx) return;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });

    await ensureDir(supportDir(ctx.id));

    const existing = (ctx.script.supportingFiles ?? []) as Array<{ name: string; path: string; size: number }>;
    const updated = [...existing];

    for (const f of files) {
      const name = safeBaseName(f.originalname);
      const filepath = path.join(supportDir(ctx.id), name);
      await fsp.writeFile(filepath, f.buffer);
      const rel = path.relative(process.cwd(), filepath);
      const idx = updated.findIndex(e => e.name === name);
      const entry = { name, path: rel, size: f.size };
      if (idx >= 0) updated[idx] = entry;
      else updated.push(entry);
    }

    await db.update(scriptsTable)
      .set({ supportingFiles: updated, updatedAt: new Date() })
      .where(eq(scriptsTable.id, ctx.id));

    await logAudit({
      req, userId: ctx.me.clerkId, userEmail: ctx.me.email,
      action: "script.support.upload", resourceType: "script", resourceId: ctx.id,
      details: { count: files.length, names: files.map(f => f.originalname) },
    });

    res.json({ ok: true, supportingFiles: updated.map(f => ({ name: f.name, size: f.size })) });
  } catch (err) {
    req.log.error({ err }, "Error uploading supporting files");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a supporting file (admin)
router.delete("/scripts/:id/supporting-files/:name", requireAuth, async (req, res) => {
  try {
    const ctx = await loadScriptOrDeny(req, res, true);
    if (!ctx) return;
    const target = safeBaseName(decodeURIComponent(req.params.name));
    const existing = (ctx.script.supportingFiles ?? []) as Array<{ name: string; path: string; size: number }>;
    const entry = existing.find(e => e.name === target);
    if (!entry) return res.status(404).json({ error: "File not found" });
    const abs = path.resolve(process.cwd(), entry.path);
    if (abs.startsWith(UPLOAD_ROOT)) await fsp.unlink(abs).catch(() => {});
    const updated = existing.filter(e => e.name !== target);
    await db.update(scriptsTable)
      .set({ supportingFiles: updated, updatedAt: new Date() })
      .where(eq(scriptsTable.id, ctx.id));
    await logAudit({
      req, userId: ctx.me.clerkId, userEmail: ctx.me.email,
      action: "script.support.delete", resourceType: "script", resourceId: ctx.id,
      details: { name: target },
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting supporting file");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Download script as a ZIP bundle (any user with access)
// Bundle contains: <script.py>, run.bat (Windows launcher), all supporting files,
// and logo file (if present). When EXE generation is added later, the .exe replaces .py + run.bat.
router.get("/scripts/:id/download", requireAuth, async (req, res) => {
  try {
    const ctx = await loadScriptOrDeny(req, res, false);
    if (!ctx) return;
    const script = ctx.script;
    const supporting = (script.supportingFiles ?? []) as Array<{ name: string; path: string; size: number }>;

    const baseName = (script.filename || "script.py").replace(/\.py$/i, "");
    const zipName = `${baseName}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      req.log.error({ err }, "archiver error");
      try { res.status(500).end(); } catch {}
    });
    archive.pipe(res);

    // Main script
    archive.append(script.code, { name: script.filename || "script.py" });

    // Windows launcher
    const launcher = `@echo off\r\nREM Auto-generated launcher for ${script.name}\r\npython "%~dp0${script.filename || "script.py"}" %*\r\npause\r\n`;
    archive.append(launcher, { name: "run.bat" });

    // README
    const readme = `# ${script.name}\r\n\r\n${script.description ?? ""}\r\n\r\nSubject: ${script.subject ?? "-"}\r\n\r\nDouble-click run.bat (Python required).\r\n`;
    archive.append(readme, { name: "README.txt" });

    // Logo
    if (script.logoPath) {
      const abs = path.resolve(process.cwd(), script.logoPath);
      if (abs.startsWith(UPLOAD_ROOT) && fs.existsSync(abs)) {
        archive.file(abs, { name: `logo${path.extname(abs)}` });
      }
    }

    // Supporting files
    for (const f of supporting) {
      const abs = path.resolve(process.cwd(), f.path);
      if (abs.startsWith(UPLOAD_ROOT) && fs.existsSync(abs)) {
        archive.file(abs, { name: f.name });
      }
    }

    await logAudit({
      req, userId: ctx.me.clerkId, userEmail: ctx.me.email,
      action: "script.download", resourceType: "script", resourceId: ctx.id,
    });

    await archive.finalize();
  } catch (err) {
    req.log.error({ err }, "Error building download");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// Build & download as EXE (any user with access).
// Returns a single .exe when there are no supporting files,
// otherwise a .zip containing the .exe and the supporting files.
router.get("/scripts/:id/exe", requireAuth, async (req, res) => {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const ctx = await loadScriptOrDeny(req, res, false);
    if (!ctx) return;
    const script = ctx.script;
    const supporting = (script.supportingFiles ?? []) as Array<{ name: string; path: string; size: number }>;

    const baseName = (script.filename || "script.py").replace(/\.py$/i, "") || "script";
    const safeBase = baseName.replace(/[^A-Za-z0-9._\- ]/g, "_") || "script";

    // Resolve absolute supporting file paths.
    const supportAbs = supporting
      .map((f) => ({ name: f.name, absPath: path.resolve(process.cwd(), f.path) }))
      .filter((f) => f.absPath.startsWith(UPLOAD_ROOT) && fs.existsSync(f.absPath));

    let logo: { absPath: string; filename: string } | null = null;
    if (script.logoPath) {
      const abs = path.resolve(process.cwd(), script.logoPath);
      if (abs.startsWith(UPLOAD_ROOT) && fs.existsSync(abs)) {
        logo = { absPath: abs, filename: path.basename(abs) };
      }
    }

    const built = await buildExe({
      scriptId: script.id,
      scriptName: script.name,
      scriptFilename: script.filename || "script.py",
      scriptCode: script.code,
      supportingFiles: supportAbs,
      logo,
    });
    cleanup = built.cleanup;

    await logAudit({
      req, userId: ctx.me.clerkId, userEmail: ctx.me.email,
      action: "script.exe.download", resourceType: "script", resourceId: ctx.id,
      details: { hasSupportingFiles: supportAbs.length > 0 },
    });

    if (supportAbs.length === 0) {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeBase}.exe"`);
      const stream = fs.createReadStream(built.exePath);
      stream.on("close", () => { cleanup?.(); });
      stream.on("error", () => { cleanup?.(); });
      stream.pipe(res);
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeBase}.zip"`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      req.log.error({ err }, "archiver error during exe bundle");
      try { res.status(500).end(); } catch {}
    });
    archive.on("end", () => { cleanup?.(); });
    archive.pipe(res);

    archive.file(built.exePath, { name: `${safeBase}.exe` });
    for (const f of supportAbs) {
      archive.file(f.absPath, { name: f.name });
    }
    if (logo) {
      archive.file(logo.absPath, { name: `logo${path.extname(logo.absPath)}` });
    }
    const readme = `# ${script.name}\r\n\r\nDouble-click ${safeBase}.exe to run. Python must be installed on the target machine.\r\nSupporting files in this folder are made available to the script when it runs.\r\n`;
    archive.append(readme, { name: "README.txt" });

    await archive.finalize();
  } catch (err) {
    req.log.error({ err }, "Error building EXE");
    if (cleanup) await cleanup();
    if (!res.headersSent) res.status(500).json({ error: (err as Error).message || "Internal server error" });
  }
});

export default router;
