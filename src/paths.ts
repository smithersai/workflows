import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbsolutePath } from "./types";

export function repoRoot(): AbsolutePath {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function packagedPackRoot(): AbsolutePath {
  return join(repoRoot(), "pack");
}

export function defaultSmithersHome(env: NodeJS.ProcessEnv = process.env): AbsolutePath {
  const configured = env.SMITHERS_HOME;
  if (configured !== undefined && configured.trim() !== "") {
    return resolve(configured);
  }

  const home = env.HOME;
  if (home === undefined || home.trim() === "") {
    throw new Error("HOME is not set; set SMITHERS_HOME explicitly.");
  }

  return join(home, ".smithers");
}
