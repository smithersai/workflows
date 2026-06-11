import type { AbsolutePath } from "./types";

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
