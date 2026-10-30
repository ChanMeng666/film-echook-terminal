/**
 * The demo session: the film's INPUTS, and the only invented content in it (C7).
 *
 * A terminal session has to contain something: a request, files being read
 * and edited. A real session would be the maintainer's own work, which must
 * never appear in a film, so this one is fictional, generic, and lives in this
 * one file. Everything else on screen is either the product's own string
 * (src/replica/data/product.generated.json) or the film's voice (src/copy.ts).
 *
 * The repo and working directory match the demo payload the bake feeds to the
 * product's real status-line script; `npm run verify` checks that the line
 * counts below add up to the +/- the status line shows.
 */

export type ToolVerb = "read" | "edit" | "write" | "run";
export interface ToolLine { verb: ToolVerb; target: string; added?: number; removed?: number }

export const DEMO = {
  repo: "acme/checkout-service",
  cwd: "~/code/checkout-service",
  /** the window's title: the working directory and nothing else */
  title: "~/code/checkout-service",
  /** an earlier turn of the same session, so the screen is a working terminal from the first frame */
  earlier: {
    request: "where do we verify webhook signatures?",
    tools: [
      { verb: "read", target: "src/webhooks/router.ts" },
      { verb: "read", target: "src/webhooks/signature.ts" },
      { verb: "read", target: "docs/webhooks.md" },
    ] as ToolLine[],
    answer: "Verified in src/webhooks/signature.ts, before the handler.",
  },
  /** what the user asked the agent for, before the film starts */
  request: "add a retry queue to the checkout webhook handler",
  /** the agent's work, in order */
  tools: [
    { verb: "read", target: "package.json" },
    { verb: "read", target: "src/webhooks/handler.ts" },
    { verb: "read", target: "src/webhooks/signature.ts" },
    { verb: "read", target: "src/queue/index.ts" },
    { verb: "read", target: "src/queue/worker.ts" },
    { verb: "read", target: "test/webhooks.test.ts" },
    { verb: "edit", target: "src/webhooks/handler.ts", added: 42, removed: 7 },
    { verb: "write", target: "src/queue/retry.ts", added: 61 },
    { verb: "edit", target: "test/webhooks.test.ts", added: 53, removed: 16 },
  ] as ToolLine[],
  /** what the agent says while it works, and after the user's spoken request in TALK */
  working: "working",
  approved: "approved",
  mutedReply: "Muted for an hour.",
  /** the lock screen's clock: the conventional demo time, not a real one */
  phoneClock: "9:41",
  phoneDay: "Tuesday 6 October",
  /** the subagent the README card opens: its first request, and what it reads */
  agentTask: "find how retries are configured",
  agentRead: "src/queue/worker.ts",
  agentNote: "Retries are set in src/queue/worker.ts.",
  /** the other app in CHANNELS: a document, drawn as grey bars with one heading */
  otherAppTitle: "Q4 planning",
} as const;

export const demoStrings = (): string[] => [
  DEMO.repo, DEMO.cwd, DEMO.title, DEMO.request, DEMO.working, DEMO.approved, DEMO.mutedReply,
  DEMO.phoneClock, DEMO.phoneDay, DEMO.otherAppTitle, DEMO.agentTask, DEMO.agentRead, DEMO.agentNote, ...DEMO.tools.map((t) => `${t.verb} ${t.target}`),
  DEMO.earlier.request, DEMO.earlier.answer, ...DEMO.earlier.tools.map((t) => `${t.verb} ${t.target}`),
];
