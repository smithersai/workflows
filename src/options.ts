import { Options } from "@effect/cli";

/**
 * A boolean flag whose default is TRUE, with a working `--no-<name>` to opt out.
 *
 * `Options.boolean(name).pipe(Options.withDefault(true))` reads correctly and is wrong: a boolean
 * option *always* parses successfully (false when absent), so `withDefault` never fires and the
 * flag silently defaults to **false**. `--no-<name>` is not implied either — it fails as an unknown
 * argument. That combination is silent in the worst way: the help text says one thing, the parser
 * does the opposite, and nothing errors. It shipped here once already, on `xiv stack push --draft`,
 * which opened ready-for-review PRs for months while documenting draft-by-default.
 *
 * The fix is to let the NEGATIVE flag carry the default (`ifPresent: false` means "present ⇒
 * false", absent ⇒ the `withDefault`), and keep the positive flag as an explicit no-op opt-in so
 * anyone already passing `--<name>` in a script keeps working.
 *
 * Covered by `test/options.test.ts` — if you change this, that test is the contract.
 */
export function defaultTrueFlag(name: string, description: string): Options.Options<boolean> {
  return Options.all([
    Options.boolean(`no-${name}`, { ifPresent: false }).pipe(Options.withDefault(true)),
    Options.boolean(name),
  ]).pipe(
    Options.map(([enabled, forced]) => enabled || forced),
    Options.withDescription(description),
  );
}
