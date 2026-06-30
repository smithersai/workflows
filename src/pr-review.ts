import { join } from "node:path";
import * as p from "@clack/prompts";
import type {
  FindingSeverity,
  LocalFinding,
  LocalReview,
  ReviewVerdict,
} from "../pack/components/LocalReview";
import { getDiffLineMap, getPullRequest, listOpenPullRequests, submitReview } from "./github";
import { defaultSmithersHome, packagedPackRoot, reviewScratchDir } from "./paths";
import { runLocalReview } from "./review-agent";
import { ensurePrWorktree, removeWorktree, resolveClone } from "./worktree";
import type {
  DiffLineMap,
  OwnerRepo,
  PrReviewOptions,
  PrWorktree,
  PullRequestNumber,
  ResolvedClone,
  ReviewComment,
  ReviewEvent,
  ReviewSubmission,
} from "./types";

type VerdictChoice = ReviewVerdict | "skip";
type ReviewCommentWithBody = ReviewComment & { readonly body: string };

const SEVERITY_ORDER: readonly FindingSeverity[] = ["blocker", "high", "medium", "low", "nit"];

async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const s = p.spinner();
  s.start(message);
  try {
    const out = await fn();
    s.stop(`${message} — done`);
    return out;
  } catch (error) {
    s.stop(`${message} — failed`);
    throw error;
  }
}

function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : prefix + line))
    .join("\n");
}

function locationLabel(finding: LocalFinding): string {
  if (finding.path === null) return "";
  if (finding.line === null) return ` ${finding.path}`;
  const range = finding.startLine !== null && finding.startLine < finding.line
    ? `${finding.startLine}-${finding.line}`
    : `${finding.line}`;
  return ` ${finding.path}:${range}`;
}

function printFindings(review: LocalReview): void {
  console.log("");
  console.log(`Suggested verdict: ${review.verdict}`);
  console.log("");
  console.log("Summary:");
  console.log(indent(review.summary));
  console.log("");
  if (review.findings.length === 0) {
    console.log("No findings.");
    console.log("");
    return;
  }
  const sorted = [...review.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  console.log(`Findings (${review.findings.length}):`);
  for (const finding of sorted) {
    const inline = finding.inlineable ? " (inline-able)" : "";
    console.log(`  • [${finding.severity}] ${finding.title}${locationLabel(finding)}${inline}`);
    console.log(indent(finding.body, "      "));
  }
  console.log("");
}

function toEvent(verdict: ReviewVerdict): ReviewEvent {
  if (verdict === "approve") return "APPROVE";
  if (verdict === "request_changes") return "REQUEST_CHANGES";
  return "COMMENT";
}

function lineInDiff(map: DiffLineMap, path: string, line: number, startLine: number | null): boolean {
  const set = map.get(path);
  if (set === undefined || !set.has(line)) return false;
  if (startLine !== null && startLine < line && !set.has(startLine)) return false;
  return true;
}

function renderInline(finding: LocalFinding): string {
  return `**[${finding.severity}] ${finding.title}**\n\n${finding.body}`;
}

function renderBullet(finding: LocalFinding): string {
  const loc = finding.path !== null
    ? ` (\`${finding.path}${finding.line !== null ? `:${finding.line}` : ""}\`)`
    : "";
  const oneLine = finding.body.replace(/\s+/g, " ").trim();
  return `- **[${finding.severity}] ${finding.title}**${loc} — ${oneLine}`;
}

function composeBody(summary: string, extra: readonly LocalFinding[]): string {
  const base = summary.trim();
  if (extra.length === 0) return `${base}\n`;
  const bullets = extra.map(renderBullet).join("\n");
  return `${base}\n\n## Additional findings\n\n${bullets}\n`;
}

interface Classified {
  readonly comments: readonly ReviewCommentWithBody[];
  /** Findings that became inline comments (kept so they can be folded into the body on a retry). */
  readonly inlineFindings: readonly LocalFinding[];
  /** Findings that could not be inlined and belong in the top-level body instead. */
  readonly demoted: readonly LocalFinding[];
}

function classifyFindings(
  selected: readonly LocalFinding[],
  inlineOn: boolean,
  diffMap: DiffLineMap,
): Classified {
  const comments: ReviewCommentWithBody[] = [];
  const inlineFindings: LocalFinding[] = [];
  const demoted: LocalFinding[] = [];
  for (const finding of selected) {
    const canInline =
      inlineOn &&
      finding.inlineable &&
      finding.path !== null &&
      finding.line !== null &&
      lineInDiff(diffMap, finding.path, finding.line, finding.startLine);
    if (canInline && finding.path !== null && finding.line !== null) {
      const comment: ReviewCommentWithBody =
        finding.startLine !== null && finding.startLine < finding.line
          ? { path: finding.path, line: finding.line, side: "RIGHT", start_line: finding.startLine, body: renderInline(finding) }
          : { path: finding.path, line: finding.line, side: "RIGHT", body: renderInline(finding) };
      comments.push(comment);
      inlineFindings.push(finding);
    } else {
      demoted.push(finding);
    }
  }
  return { comments, inlineFindings, demoted };
}

interface SubmitArgs {
  readonly cwd: string;
  readonly ownerRepo: OwnerRepo;
  readonly prNumber: PullRequestNumber;
  readonly scratchDir: string;
  readonly event: ReviewEvent;
  readonly body: string;
  readonly classified: Classified;
}

/**
 * Submit the review; if GitHub rejects the inline comments (e.g. a line slipped past the diff-map
 * check), retry once with the comments folded into the body so a review is never lost.
 */
async function submitWithFallback(args: SubmitArgs): Promise<string> {
  const payloadPath = join(args.scratchDir, "review-payload.json");
  const primary: ReviewSubmission = { event: args.event, body: args.body, comments: args.classified.comments };
  const s = p.spinner();
  s.start("Submitting review");
  try {
    const url = await submitReview(args.cwd, args.ownerRepo, args.prNumber, primary, payloadPath);
    s.stop("Review submitted");
    return url;
  } catch (error) {
    if (args.classified.comments.length === 0) {
      s.stop("Submission failed");
      throw error;
    }
    s.message("Inline comments rejected; retrying with findings in the body");
    const foldedBody = composeBody(args.body, args.classified.inlineFindings);
    const fallback: ReviewSubmission = { event: args.event, body: foldedBody, comments: [] };
    const url = await submitReview(args.cwd, args.ownerRepo, args.prNumber, fallback, payloadPath);
    s.stop("Review submitted (inline comments folded into the body)");
    return url;
  }
}

function editorArgv(): readonly string[] {
  const configured = process.env.VISUAL ?? process.env.EDITOR;
  if (configured !== undefined && configured.trim() !== "") return configured.trim().split(/\s+/);
  for (const candidate of ["nvim", "vim", "vi", "nano"]) {
    if (Bun.which(candidate) !== null) return [candidate];
  }
  return ["vi"];
}

async function openEditor(file: string): Promise<void> {
  const child = Bun.spawn([...editorArgv(), file], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  await child.exited;
}

async function pickPrNumber(
  cwd: string,
  clone: ResolvedClone,
  explicit: PullRequestNumber | undefined,
): Promise<PullRequestNumber | null> {
  if (explicit !== undefined) return explicit;
  const prs = await withSpinner(`Fetching open PRs in ${clone.ownerRepo}`, () =>
    listOpenPullRequests(cwd, clone.ownerRepo),
  );
  if (prs.length === 0) return null;
  const choice = await p.select({
    message: `Select a PR to review (${clone.ownerRepo})`,
    options: prs.map((pr) => ({
      value: pr.number,
      label: `#${pr.number}  ${pr.title}`,
      hint: `${pr.author}${pr.isDraft ? " · draft" : ""} +${pr.additions}/-${pr.deletions}`,
    })),
  });
  if (p.isCancel(choice)) return null;
  return choice;
}

async function selectFindings(review: LocalReview): Promise<readonly LocalFinding[] | null> {
  if (review.findings.length === 0) return [];
  const picked = await p.multiselect({
    message: "Findings to include (space to toggle)",
    required: false,
    options: review.findings.map((finding) => ({
      value: finding.id,
      label: `[${finding.severity}] ${finding.title}`,
      hint: locationLabel(finding).trim(),
    })),
    initialValues: review.findings.filter((finding) => finding.severity !== "nit").map((finding) => finding.id),
  });
  if (p.isCancel(picked)) return null;
  const chosen = new Set(picked);
  return review.findings.filter((finding) => chosen.has(finding.id));
}

async function buildAndSubmit(args: {
  readonly cwd: string;
  readonly clone: ResolvedClone;
  readonly prNumber: PullRequestNumber;
  readonly scratchDir: string;
  readonly review: LocalReview;
  readonly autoSubmit: boolean;
}): Promise<void> {
  const { cwd, clone, prNumber, scratchDir, review } = args;

  let verdict: ReviewVerdict = review.verdict;
  let selected: readonly LocalFinding[] = review.findings;
  let inlineOn = review.findings.some((finding) => finding.inlineable);
  let edited = false;

  if (!args.autoSubmit) {
    const chosenVerdict = await p.select<VerdictChoice>({
      message: "Review type",
      initialValue: review.verdict,
      options: [
        { value: "comment", label: "Comment", hint: "feedback without an explicit approval state" },
        { value: "approve", label: "Approve" },
        { value: "request_changes", label: "Request changes" },
        { value: "skip", label: "Don't submit (keep notes only)" },
      ],
    });
    if (p.isCancel(chosenVerdict) || chosenVerdict === "skip") {
      p.outro(`No review submitted. Findings saved at ${join(scratchDir, "findings.json")}`);
      return;
    }
    verdict = chosenVerdict;

    const picked = await selectFindings(review);
    if (picked === null) {
      p.cancel("Cancelled.");
      return;
    }
    selected = picked;

    const inlineableSelected = selected.some(
      (finding) => finding.inlineable && finding.path !== null && finding.line !== null,
    );
    if (inlineableSelected) {
      const confirmInline = await p.confirm({
        message: "Post findings that have a file:line as inline comments?",
        initialValue: true,
      });
      if (p.isCancel(confirmInline)) {
        p.cancel("Cancelled.");
        return;
      }
      inlineOn = confirmInline;
    } else {
      inlineOn = false;
    }
    edited = true;
  }

  const diffMap: DiffLineMap = inlineOn
    ? await withSpinner("Mapping diff lines", () => getDiffLineMap(cwd, clone.ownerRepo, prNumber))
    : new Map<string, ReadonlySet<number>>();
  const classified = classifyFindings(selected, inlineOn, diffMap);

  let body = composeBody(review.summary, classified.demoted);
  if (edited) {
    const bodyPath = join(scratchDir, "review-body.md");
    await Bun.write(bodyPath, body);
    p.note("Opening your editor to finalize the top-level review body…");
    await openEditor(bodyPath);
    body = (await Bun.file(bodyPath).text()).trim();
  }
  if (body.trim() === "" && classified.comments.length === 0 && verdict !== "approve") {
    body = review.summary.trim() === "" ? "Reviewed." : review.summary.trim();
  }

  if (edited) {
    const proceed = await p.confirm({
      message:
        `Submit a "${verdict}" review on #${prNumber}` +
        (classified.comments.length > 0 ? ` with ${classified.comments.length} inline comment(s)?` : "?"),
      initialValue: true,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.outro(`No review submitted. Draft body saved at ${join(scratchDir, "review-body.md")}`);
      return;
    }
  }

  const url = await submitWithFallback({
    cwd,
    ownerRepo: clone.ownerRepo,
    prNumber,
    scratchDir,
    event: toEvent(verdict),
    body,
    classified,
  });
  p.outro(`Review submitted: ${url}`);
}

export async function runPrReview(options: PrReviewOptions): Promise<void> {
  const smithersHome = defaultSmithersHome();
  const cwd = process.cwd();
  const promptFile = options.promptFile ?? join(packagedPackRoot(), "prompts", "local-review.md");

  p.intro("xiv pr review");

  const clone = await withSpinner("Resolving repository", () =>
    resolveClone({ cwd, smithersHome, ownerRepo: options.repo }),
  );

  const prNumber = await pickPrNumber(cwd, clone, options.prNumber);
  if (prNumber === null) {
    p.outro("No PR selected.");
    return;
  }

  const pr = await withSpinner(`Loading PR #${prNumber}`, () => getPullRequest(cwd, clone.ownerRepo, prNumber));
  const scratchDir = reviewScratchDir(smithersHome, clone.ownerRepo, prNumber);

  let worktree: PrWorktree | null = null;
  try {
    const created = await withSpinner("Preparing worktree", () =>
      ensurePrWorktree({ clone, smithersHome, prNumber, baseRefName: pr.baseRefName }),
    );
    worktree = created;

    const review = await withSpinner("Reviewing (agent running — this can take a few minutes)", () =>
      runLocalReview({
        worktreePath: created.path,
        scratchDir,
        ownerRepo: clone.ownerRepo,
        pr,
        baseRef: created.baseRef,
        headSha: created.headSha,
        promptFile,
      }),
    );

    printFindings(review);
    await buildAndSubmit({ cwd, clone, prNumber, scratchDir, review, autoSubmit: options.autoSubmit });
  } finally {
    if (worktree !== null && !options.keep) {
      try {
        await removeWorktree(clone, worktree.path);
      } catch {
        // best-effort cleanup; a leftover worktree can be removed with `git worktree remove`
      }
    }
  }
}
