import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AbsolutePath, FileHash, InstallOptions, InstallResult, IsoTimestamp, ManagedFile, PackManifest, RelativePath } from "./types";
import { runInherited } from "./process";

const manifestDir = ".xiv";
const manifestName = "manifest.json";
const excludedDirs = new Set(["node_modules", ".git", ".xiv", "executions", "runs", "logs"]);
const excludedFiles = new Set(["accounts.json", "smithers.db", "smithers.db-shm", "smithers.db-wal"]);

function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

function manifestPath(smithersHome: AbsolutePath): AbsolutePath {
  return join(smithersHome, manifestDir, manifestName);
}

function backupRoot(smithersHome: AbsolutePath, timestamp: IsoTimestamp): AbsolutePath {
  return join(smithersHome, manifestDir, "backups", timestamp.replaceAll(":", "-"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedFile(value: unknown): value is ManagedFile {
  return isRecord(value) && typeof value.path === "string" && typeof value.hash === "string";
}

function parseManifest(value: unknown): PackManifest | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 || value.source !== "xiv" || typeof value.updatedAt !== "string") return null;
  if (!Array.isArray(value.files) || !value.files.every(isManagedFile)) return null;
  return {
    version: 1,
    updatedAt: value.updatedAt,
    source: "xiv",
    files: value.files,
  };
}

async function readManifest(smithersHome: AbsolutePath): Promise<PackManifest | null> {
  try {
    const raw = await readFile(manifestPath(smithersHome), "utf8");
    return parseManifest(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function fileExists(path: AbsolutePath): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function hashFile(path: AbsolutePath): Promise<FileHash> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function shouldExclude(relativePath: RelativePath): boolean {
  const parts = relativePath.split("/");
  return parts.some((part) => excludedDirs.has(part)) || excludedFiles.has(parts[parts.length - 1] ?? "");
}

async function listFiles(root: AbsolutePath, current = ""): Promise<RelativePath[]> {
  const dir = join(root, current);
  const entries = await readdir(dir, { withFileTypes: true });
  const files: RelativePath[] = [];

  for (const entry of entries) {
    const relative = current === "" ? entry.name : `${current}/${entry.name}`;
    if (shouldExclude(relative)) continue;
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }

  return files.sort();
}

async function buildManifest(packRoot: AbsolutePath): Promise<PackManifest> {
  const files = await listFiles(packRoot);
  const managedFiles: ManagedFile[] = [];
  for (const path of files) {
    managedFiles.push({ path, hash: await hashFile(join(packRoot, path)) });
  }

  return {
    version: 1,
    updatedAt: nowIso(),
    source: "xiv",
    files: managedFiles,
  };
}

function previousHash(manifest: PackManifest | null, path: RelativePath): FileHash | null {
  return manifest?.files.find((file) => file.path === path)?.hash ?? null;
}

async function backupIfDrifted(options: {
  readonly smithersHome: AbsolutePath;
  readonly relativePath: RelativePath;
  readonly oldHash: FileHash | null;
  readonly backupDir: AbsolutePath;
}): Promise<boolean> {
  const target = join(options.smithersHome, options.relativePath);
  if (!await fileExists(target)) return false;

  const currentHash = await hashFile(target);
  if (options.oldHash !== null && currentHash === options.oldHash) return false;

  const backupPath = join(options.backupDir, options.relativePath);
  await mkdir(dirname(backupPath), { recursive: true });
  await copyFile(target, backupPath);
  return true;
}

async function copyManagedFile(packRoot: AbsolutePath, smithersHome: AbsolutePath, relativePath: RelativePath): Promise<void> {
  const source = join(packRoot, relativePath);
  const target = join(smithersHome, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

export async function installPack(options: InstallOptions): Promise<InstallResult> {
  const timestamp = nowIso();
  const nextManifest = await buildManifest(options.packRoot);
  const previousManifest = await readManifest(options.smithersHome);
  const backupDir = backupRoot(options.smithersHome, timestamp);
  let backups = 0;

  await mkdir(options.smithersHome, { recursive: true });

  for (const file of nextManifest.files) {
    const backedUp = await backupIfDrifted({
      smithersHome: options.smithersHome,
      relativePath: file.path,
      oldHash: previousHash(previousManifest, file.path),
      backupDir,
    });
    if (backedUp) backups += 1;
    await copyManagedFile(options.packRoot, options.smithersHome, file.path);
  }

  await mkdir(dirname(manifestPath(options.smithersHome)), { recursive: true });
  await writeFile(manifestPath(options.smithersHome), JSON.stringify(nextManifest, null, 2) + "\n");

  if (options.runInstall) {
    await runInherited({ cmd: ["bun", "install"], cwd: options.smithersHome });
  }

  return { copied: nextManifest.files.length, backups, smithersHome: options.smithersHome };
}

export async function isInitialized(smithersHome: AbsolutePath): Promise<boolean> {
  return (await readManifest(smithersHome)) !== null;
}

export async function resetManifestForTest(smithersHome: AbsolutePath): Promise<void> {
  const path = manifestPath(smithersHome);
  const backup = join(smithersHome, manifestDir, "manifest.test.bak");
  if (await fileExists(path)) {
    await rename(path, backup);
  }
}
