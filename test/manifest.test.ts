import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installPack } from "../src/manifest";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function listBackupFiles(root: string): Promise<string[]> {
  const backupRoot = join(root, ".xiv", "backups");
  try {
    const timestamps = await readdir(backupRoot);
    const files: string[] = [];
    for (const timestamp of timestamps) {
      const entries = await readdir(join(backupRoot, timestamp), { recursive: true });
      for (const entry of entries) {
        files.push(String(entry));
      }
    }
    return files.sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

describe("installPack", () => {
  test("copies managed files and writes a manifest", async () => {
    const packRoot = await makeTempDir("xiv-pack-");
    const smithersHome = await makeTempDir("xiv-home-");
    await writeFile(join(packRoot, "package.json"), "{\"name\":\"pack\"}\n");
    await writeFile(join(packRoot, "workflow.tsx"), "export default {}\n");

    const result = await installPack({ packRoot, smithersHome, runInstall: false });

    expect(result.copied).toBe(2);
    expect(result.backups).toBe(0);
    expect(await readFile(join(smithersHome, "workflow.tsx"), "utf8")).toBe("export default {}\n");
    expect(await readFile(join(smithersHome, ".xiv", "manifest.json"), "utf8")).toContain("\"source\": \"xiv\"");
  });

  test("backs up drifted managed files before overwrite", async () => {
    const packRoot = await makeTempDir("xiv-pack-");
    const smithersHome = await makeTempDir("xiv-home-");
    await writeFile(join(packRoot, "agents.ts"), "export const value = 1;\n");

    await installPack({ packRoot, smithersHome, runInstall: false });
    await writeFile(join(smithersHome, "agents.ts"), "local edit\n");

    const result = await installPack({ packRoot, smithersHome, runInstall: false });
    const backups = await listBackupFiles(smithersHome);

    expect(result.backups).toBe(1);
    expect(backups).toEqual(["agents.ts"]);
    expect(await readFile(join(smithersHome, "agents.ts"), "utf8")).toBe("export const value = 1;\n");
  });
});
