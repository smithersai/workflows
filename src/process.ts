import type { AbsolutePath, ProcessResult } from "./types";

export interface SpawnOptions {
  readonly cmd: readonly string[];
  readonly cwd: AbsolutePath;
  readonly env?: NodeJS.ProcessEnv;
}

export async function runInherited(options: SpawnOptions): Promise<void> {
  const child = Bun.spawn([...options.cmd], {
    cwd: options.cwd,
    env: options.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${options.cmd.join(" ")} exited with ${exitCode}`);
  }
}

/**
 * Run a command and capture its output instead of inheriting the parent streams.
 * A missing binary (ENOENT) is normalized to exit code 127 rather than throwing,
 * so callers can probe for optional tools like jj without a try/catch.
 */
export async function runCaptured(options: SpawnOptions): Promise<ProcessResult> {
  const start = () =>
    Bun.spawn([...options.cmd], {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

  let child: ReturnType<typeof start>;
  try {
    child = start();
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

/** Run a command and return its trimmed stdout, throwing with stderr context on a non-zero exit. */
export async function capture(options: SpawnOptions): Promise<string> {
  const result = await runCaptured(options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
    throw new Error(`${options.cmd.join(" ")} exited with ${result.code}: ${detail}`);
  }
  return result.stdout.trim();
}
