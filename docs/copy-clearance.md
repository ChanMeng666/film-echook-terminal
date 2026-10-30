# Copy clearance

Every word on screen is one of three kinds, and each kind has one home:

| kind | home | how it is held |
|---|---|---|
| the product's own strings and numbers | `src/replica/data/product.generated.json` (written by `npm run bake` from the product repo) | `strings` and `numbers` gates: every text node painted by the scenes is traced to the baked data |
| the film's voice (cards, captions, labels) | `src/copy.ts` | this table; the `copy` gate fails on a line with no row here, or one that matches a banned pattern (C2, C3, C4) |
| the demo session (what a user typed, the files an agent touched) | `src/replica/demo.ts` | the second table; same gate, same banned patterns |

The gate looks for each line between backticks, exactly as written in the source.

**Status of the film-voice rows: written for this film on 2026-10-06, approved by the maintainer 2026-10-06**
(all 23 lines; the approval was relayed to the film package by the commander the same day).
The demo-session rows further down are not claims and were not part of that approval.

## Film voice (`src/copy.ts`)

| line | where | derives from |
|---|---|---|
| `Your agent is working.` | HOOK, first line | The picture: a terminal in which an agent is reading and editing files. Says nothing about the product. |
| `You don't have to watch.` | HOOK, second line | README, Key Features: echook "tells you what just happened in your AI session when you're not watching the window". |
| `echook calls you back.` | AWAY | README: "so you can walk away and trust you'll be called back". Shown as the product's `stop` sound plays; the line does not say what the sound means (C2). |
| `Every event has its own sound.` | EVENTS | AGENTS.md: "Every event and every variant owns a distinct sound (86 slots ... 86 distinct files, in both themes)", pinned by the product's `TestAudioUniqueness`. |
| `events` | EVENTS, count line | Unit word for `counts.events` (39 canonical hook events; `audio-hooks manifest`). The number is rendered from the baked data. |
| `variants` | EVENTS, count line | Unit word for `counts.variants` (47 matcher variants). The number is rendered from the baked data. |
| `on by default` | EVENTS, count line | Unit words for `counts.defaultOnEvents` (3: `notification`, `stop`, `permission_request` — AGENTS.md gating rule 5, "built-in default set"). The wall lights exactly those three tiles. |
| `Voice or chimes.` | THEMES | README: "Two themes — voice or chimes." |
| `Voice` | THEMES, switch label | The product's own name for the `default` theme (its status line prints "Theme: Voice"). |
| `Chimes` | THEMES, switch label | The product's own name for the `custom` theme (its status line prints "Theme: Chimes"; README "switch to chimes"). |
| `At your desk.` | CHANNELS, panel 1 | README channel table: Audio — "A sound at your desk the instant something needs you." |
| `In another window.` | CHANNELS, panel 2 | README channel table: Desktop toast — "A glanceable popup when you're in another window." |
| `On your phone.` | CHANNELS, panel 3 | README channel table: Webhook — "get alerts on your phone". The phone shows the product's real ntfy-format title and body. |
| `Set it up by asking your agent.` | TALK | README: "You configure it by talking to your agent — every setting is one sentence, not a JSON edit." The sentence typed and the command run are the product's own mapping (SKILL.md), baked. |
| `A status line that keeps context and quota in view.` | STATUSLINE | README: a status line that "adds real-time context-window and quota bars". |
| `Context and quota in view.` | STATUSLINE, 15 s cut only | The same claim as the line above, in five words, for a one-bar beat. |
| `Works in` | END | Introduces the three editors. |
| `Claude Code` | END | README: "Audio and out-of-band notifications for Claude Code, Cursor IDE, and Codex CLI." Plain words, no logo (C5). |
| `Cursor` | END | As above. |
| `Codex` | END | As above. |
| `Hear your agent.` | END | README: "Hear when your agent finishes, needs permission, or hits a rate limit". |
| `MIT · open source` | END | The product repo's LICENSE file is the MIT licence; the repository is public. |
| `Interface recreated in code · sounds are echook's own files · demo session` | EVENTS, the honesty caption (C6) | Brief, constraint C6, verbatim. True of the film: the terminal, toast and phone are drawn in code; every event sound is the product's own mp3; the session, model, cost and quota figures are a demo payload. |

## Demo session (`src/replica/demo.ts`)

Invented, generic, and in one file (C7). None of it is a claim about the product.

| line | where | note |
|---|---|---|
| `acme/checkout-service` | terminal | The demo repository named in C7; the same value is in the payload the bake feeds the product's status-line script. |
| `~/code/checkout-service` | terminal title, status line | The demo working directory named in C7. |
| `where do we verify webhook signatures?` | terminal | An earlier request in the same fictional session, so the screen is busy from the first frame. |
| `read src/webhooks/router.ts` | terminal | Agent activity (earlier turn). |
| `read docs/webhooks.md` | terminal | Agent activity (earlier turn). |
| `Verified in src/webhooks/signature.ts, before the handler.` | terminal | The fictional agent's answer to the earlier request. |
| `add a retry queue to the checkout webhook handler` | terminal | What the fictional user asked the agent for. |
| `read package.json` | terminal | Agent activity. |
| `read src/webhooks/handler.ts` | terminal | Agent activity. |
| `read src/webhooks/signature.ts` | terminal | Agent activity. |
| `read src/queue/index.ts` | terminal | Agent activity. |
| `read src/queue/worker.ts` | terminal | Agent activity. |
| `read test/webhooks.test.ts` | terminal | Agent activity. |
| `edit src/webhooks/handler.ts` | terminal | Agent activity. The +/- line counts add up to the figure in the baked status line (`numbers` gate). |
| `write src/queue/retry.ts` | terminal | Agent activity. |
| `edit test/webhooks.test.ts` | terminal | Agent activity. |
| `working` | terminal | The agent's busy indicator. |
| `approved` | terminal | The user allowing the command the agent asked to run. |
| `Muted for an hour.` | terminal, TALK | The agent's reply after running the real `audio-hooks snooze 1h`; the real result above it reads `"remaining_seconds": 3600`. |
| `9:41` | phone | A conventional demo clock, not a real time. |
| `Tuesday 6 October` | phone | The day this film was made. |
| `find how retries are configured` | README card | The fictional subagent's task. |
| `src/queue/worker.ts` | README card | A file the fictional subagent reads, already in the demo session. |
| `Retries are set in src/queue/worker.ts.` | README card | The fictional subagent's reply. |
| `Q4 planning` | the other app in CHANNELS | A heading in a stylised, blurred document that carries no claim. |

## Product strings that look like copy

These are on screen but are **not** the film's words; they are read from the baked data and
are listed here only so a reviewer is not surprised by them.

- `"Task complete"`, `"Permission requested"`, `"Waiting for you"`, `"Rate limited"` — what the
  product's voice files say (`config/audio_manifest.json`), shown as each sound's name (C2
  allows the first as the product's own asset label).
- `Permission needed: Bash — npm test -- --run`, `Idle prompt: Claude is waiting for your input`
  — the toast / webhook bodies the product's runner builds for the demo payloads. The film
  deliberately does not show the `stop` toast, whose body begins "Task completed".
- `Claude Code` as the toast and notification title — the runner's `_invoker_display_name()`.
- Everything in the status line, including the model name, version numbers, percentages,
  reset times and cost: the real status-line script's output for a demo payload.
