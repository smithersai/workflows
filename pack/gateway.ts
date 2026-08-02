import { Gateway, mdxPlugin } from "smthrs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

mdxPlugin();

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);

const parsedPort = Number(process.env.PORT ?? "7331");
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 7331;
const host = process.env.HOST ?? "127.0.0.1";

const gateway = new Gateway({ heartbeatMs: 15_000 });

async function mountWorkflow(key: string): Promise<void> {
  try {
    const mod = await import("./workflows/" + key + ".tsx");
    gateway.register(key, mod.default);
    console.log("  " + key + " -> http://" + host + ":" + port + "/workflows/" + key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[gateway] skipped " + key + ": " + message);
  }
}

console.log("Workflows:");
await mountWorkflow("linear-implement");
await mountWorkflow("pr-review-loop");
await mountWorkflow("pr-fix");
await mountWorkflow("linear-to-pr");

await gateway.listen({ host, port });
console.log("Smithers Gateway listening on http://" + host + ":" + port);
