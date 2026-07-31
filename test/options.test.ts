import { describe, expect, test } from "bun:test";
import { Command } from "@effect/cli";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import { defaultTrueFlag } from "../src/options";

/**
 * Parse `args` through a one-flag command and return what the handler actually received.
 *
 * This asserts on the PARSER's output rather than the Options value, because the bug this guards
 * against is invisible at the type level: the old spelling type-checked fine and produced the
 * wrong runtime value. Only running argv through the real parser catches it.
 */
async function parseFlag(args: readonly string[]): Promise<boolean> {
  let received: boolean | undefined;
  const flag = defaultTrueFlag("thing", "A thing that defaults to on.");
  const command = Command.make("probe", { flag }, (parsed) =>
    Effect.sync(() => {
      received = parsed.flag;
    }),
  );
  await Effect.runPromise(
    // Command.run consumes a process.argv-shaped array: [execPath, scriptPath, ...args].
    Command.run(command, { name: "probe", version: "0.0.0" })(["bun", "probe", ...args]).pipe(
      Effect.provide(BunContext.layer),
    ),
  );
  if (received === undefined) throw new Error("handler never ran — the parser rejected the arguments");
  return received;
}

describe("defaultTrueFlag", () => {
  test("defaults to true when the flag is absent", async () => {
    // The regression: `Options.boolean(n).pipe(withDefault(true))` silently yielded false here.
    expect(await parseFlag([])).toBe(true);
  });

  test("--no-<name> turns it off", async () => {
    // The other half of the regression: this used to fail as an unknown argument.
    expect(await parseFlag(["--no-thing"])).toBe(false);
  });

  test("--<name> stays accepted as an explicit no-op, so existing scripts keep working", async () => {
    expect(await parseFlag(["--thing"])).toBe(true);
  });
});
