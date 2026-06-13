import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbsolutePath } from "./types";

export function repoRoot(): AbsolutePath {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function packagedPackRoot(): AbsolutePath {
  return join(repoRoot(), "pack");
}

/** Root directory under SMITHERS_HOME where per-repo stack maps live. */
export function stacksRoot(smithersHome: AbsolutePath): AbsolutePath {
  return join(smithersHome, "stacks");
}

/** Path to a single feature's stack map: `<SMITHERS_HOME>/stacks/<repoSlug>/<feature>.json`. */
export function stackMapPath(smithersHome: AbsolutePath, repoSlug: string, feature: string): AbsolutePath {
  return join(stacksRoot(smithersHome), repoSlug, `${feature}.json`);
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
