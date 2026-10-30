#!/usr/bin/env node
/**
 * Bake echook's own data into the film.
 *
 * Reads the product repo (READ-ONLY) by running its real CLI, status-line script and hook
 * runner against a throwaway home under .cache/bake-home/, and writes
 *   src/replica/data/product.generated.json   (byte-stable: no timestamps, sorted inputs)
 *   public/audio/product/*.mp3                (only the files the film plays)
 * Nothing the film shows is typed here except the DEMO INPUTS (payloads, the demo repo) that
 * are fed to the real code; they are recorded in the output under `demo` so one file owns them.
 *
 *   node scripts/bake-product-data.mjs [--check]
 *   ECHOOK_PRODUCT_DIR=<path>   product repo (default ../claude-code-audio-hooks)
 *
 * Safety: every child process gets CLAUDE_PLUGIN_DATA, CLAUDE_AUDIO_HOOKS_DATA, HOME and
 * USERPROFILE pointed at the throwaway dir, CLAUDE_PLUGIN_ROOT / CLAUDE_CONFIG_DIR removed,
 * TZ=UTC. It never runs install/uninstall/upgrade/test or the hook runner's dispatch path, so
 * no sound plays and no toast appears. The environment is never printed.
 *
 * OUTPUT SHAPE (product.generated.json)
 * {
 *   source:   { repo, commit, version, runnerVersion, derivedBy: {...} },
 *   counts:   { events, variants, slots, soundsPerTheme:{default,custom}, filesPerTheme:{default,custom},
 *               defaultOnEvents, defaultOnVariants, statuslineSegments, statuslineDefaultSegments,
 *               themes, editors }            // every number derived; see `derivedBy`
 *   crossCheck: { projectStatus: {states, documented:{..}, matches:{..}}, notes:[...] },
 *   themes:   ["default","custom"], editors:["claude-code","cursor","codex"],
 *   events:   [{ name, kind:"event"|"variant", parent|null, defaultOn, description,
 *                audioFile:{default,custom}, voiceText, chimePrompt }],   // 39 + 47, manifest order
 *   audio:    { "<theme>/<file>.mp3": { durationSec, peaks:[64 floats 0..1, normalised per file] } },
 *   filmSounds: [{ event, theme, file, publicPath, sha256, bytes, durationSec, onsetSec }],
 *               // onsetSec = start of the first 5 ms window whose peak >= 25% of the file's peak
 *   statusline: { palette:{ "<sgr code>": hex }, demoNotes, payloads:{state:payload},
 *                 renders:[{ state, width, columns, raw, rows:[[{text,fg,bg,bold,dim}]] }] }
 *               // fg/bg null = terminal default. Basic SGR colours resolved through `palette`
 *               // (VS Code Dark+ terminal palette); 256/truecolor are exact.
 *   talk:     { hooksList, steps:[{said, command, argv, exitCode, stdout, parsed, volatileFields}] }
 *   channels: { toasts:[{event,hookType,title,body,urgency,stdin,...}], toastDerivation,
 *               webhooks:[{event,format,headers,payload,volatileFields}], notes }
 * }
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PRODUCT = resolve(ROOT, process.env.ECHOOK_PRODUCT_DIR ?? "../claude-code-audio-hooks");
const OUT = join(ROOT, "src", "replica", "data", "product.generated.json");
const PUBLIC_AUDIO = join(ROOT, "public", "audio", "product");
const CACHE = join(ROOT, ".cache");
const BAKE_HOME = join(CACHE, "bake-home");
const DATA_DIR = join(BAKE_HOME, "data");
const CHECK = process.argv.includes("--check");

const fail = (msg) => { console.error(`bake: ${msg}`); process.exit(1); };
if (!existsSync(join(PRODUCT, "bin", "audio-hooks.py"))) fail(`product repo not found at ${PRODUCT}`);

// ── throwaway home + child environment ───────────────────────────────────────
function freshHome() {
  if (!BAKE_HOME.startsWith(CACHE) || !BAKE_HOME.endsWith("bake-home")) fail("refusing to wipe an unexpected path");
  rmSync(BAKE_HOME, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
}
const childEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const k of ["CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "PLUGIN_DATA", "CLAUDE_CONFIG_DIR", "CLAUDE_AUDIO_HOOKS_PROJECT", "CURSOR_VERSION", "CLAUDE_HOOKS_DEBUG"]) delete env[k];
  Object.assign(env, {
    CLAUDE_PLUGIN_DATA: DATA_DIR, CLAUDE_AUDIO_HOOKS_DATA: DATA_DIR, HOME: BAKE_HOME, USERPROFILE: BAKE_HOME,
    TZ: "UTC", PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1",
  });
  return Object.assign(env, extra);
};
const FORBIDDEN = new Set(["install", "uninstall", "upgrade", "test"]);
function run(cmd, args, { input, env, cwd, allowFail } = {}) {
  const r = spawnSync(cmd, args, { input, env: env ?? childEnv(), cwd: cwd ?? ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) fail(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) fail(`${cmd} ${args.slice(0, 3).join(" ")} exited ${r.status}: ${(r.stderr || "").slice(0, 400)}`);
  return r;
}
const cli = (...args) => {
  if (FORBIDDEN.has(args[0])) fail(`refusing to run audio-hooks ${args[0]}`);
  return run("python", ["-B", join(PRODUCT, "bin", "audio-hooks.py"), ...args], { allowFail: true });
};
const cliJson = (...args) => {
  const r = cli(...args);
  if (r.status !== 0) fail(`audio-hooks ${args.join(" ")} exited ${r.status}`);
  return JSON.parse(r.stdout);
};

// ── product facts ─────────────────────────────────────────────────────────────
const git = (...a) => run("git", ["-C", PRODUCT, ...a], { env: process.env }).stdout.trim();
const commit = git("rev-parse", "HEAD");

freshHome();
const manifest = cliJson("manifest");
const hooksList = cliJson("hooks", "list", "--variants");
const segments = cliJson("statusline", "segments");

const events = manifest.hooks;                // 39 canonical
const variants = manifest.variants;           // 47 variants
const audioManifest = JSON.parse(readFileSync(join(PRODUCT, "config", "audio_manifest.json"), "utf8"));
const voiceText = {}, chimePrompt = {};
for (const f of audioManifest.files) (f.theme === "default" ? voiceText : chimePrompt)[f.filename] = f.text;

// the runner's own mapping and effective defaults (pure functions, fresh data dir)
const probeReq = {
  events: events.map((e) => e.name),
  variants: variants.map((v) => v.name),
  webhookFormats: ["raw", "ntfy"],
  toastEvents: [
    { event: "stop", hookType: "stop",
      stdin: { session_id: "demo-session", hook_event_name: "Stop", cwd: "~/code/checkout-service",
               last_assistant_message: "Added a retry queue to the checkout webhook handler. 14 tests pass." } },
    { event: "permission_request", hookType: "permission_request",
      stdin: { session_id: "demo-session", hook_event_name: "PermissionRequest", cwd: "~/code/checkout-service",
               tool_name: "Bash", tool_input: { command: "npm test -- --run" } } },
    { event: "notification_idle_prompt", hookType: "notification",
      stdin: { session_id: "demo-session", hook_event_name: "Notification", cwd: "~/code/checkout-service",
               notification_type: "idle_prompt", message: "Claude is waiting for your input" } },
  ],
};
const probe = JSON.parse(run("python", ["-B", join(HERE, "bake-probe-runner.py"), PRODUCT], { input: JSON.stringify(probeReq) }).stdout);

const customFileFor = (e) => {
  if (e.kind === "variant") return "chime-" + e.defaultFile;
  return probe.customAudioFiles[e.name] ?? e.defaultFile;
};
const list = [
  ...events.map((e) => ({ name: e.name, kind: "event", parent: null, description: e.description, defaultFile: e.audio })),
  ...variants.map((v) => ({ name: v.name, kind: "variant", parent: v.variant_of, description: null, defaultFile: v.audio_file })),
].map((e) => ({
  name: e.name, kind: e.kind, parent: e.parent,
  defaultOn: probe.effectiveDefault[e.name],
  description: e.description,
  audioFile: { default: e.defaultFile, custom: customFileFor(e) },
  voiceText: voiceText[e.defaultFile] ?? null,
  chimePrompt: chimePrompt[customFileFor(e)] ?? null,
}));

// ── audio: every mp3 in both themes ──────────────────────────────────────────
const PEAKS = 64, ONSET_WINDOW = 0.005, ONSET_FRACTION = 0.25, RATE = 16000;
const r3 = (x) => Math.round(x * 1000) / 1000;
function analyse(file) {
  const dur = parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { env: process.env }).stdout);
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (raw.status !== 0) fail(`ffmpeg failed on ${file}`);
  const b = raw.stdout;
  const s = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
  const n = s.length;
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a; }
  const buckets = new Array(PEAKS).fill(0);
  for (let k = 0; k < PEAKS; k++) {
    let m = 0;
    for (let i = Math.floor((k * n) / PEAKS); i < Math.floor(((k + 1) * n) / PEAKS); i++) { const a = Math.abs(s[i]); if (a > m) m = a; }
    buckets[k] = m;
  }
  const bm = Math.max(...buckets) || 1;
  const win = Math.round(ONSET_WINDOW * RATE);
  let onset = 0;
  for (let w = 0; w * win < n; w++) {
    let m = 0;
    for (let i = w * win; i < Math.min(n, (w + 1) * win); i++) { const a = Math.abs(s[i]); if (a > m) m = a; }
    if (peak > 0 && m >= ONSET_FRACTION * peak) { onset = w * ONSET_WINDOW; break; }
  }
  return { durationSec: r3(dur), peaks: buckets.map((x) => r3(x / bm)), onsetSec: r3(onset) };
}
const audio = {}, onsets = {};
for (const theme of ["default", "custom"]) {
  const dir = join(PRODUCT, "audio", theme);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mp3")).sort()) {
    const a = analyse(join(dir, f));
    audio[`${theme}/${f}`] = { durationSec: a.durationSec, peaks: a.peaks };
    onsets[`${theme}/${f}`] = a.onsetSec;
  }
}
for (const e of list) for (const th of ["default", "custom"]) {
  if (!audio[`${th}/${e.audioFile[th]}`]) fail(`event ${e.name}: ${th} sound ${e.audioFile[th]} not in audio/${th}`);
}

// ── counts (derived) and cross-check against docs/PROJECT_STATUS.md ──────────
const distinct = (th) => new Set(list.map((e) => e.audioFile[th])).size;
const counts = {
  events: events.length,
  variants: variants.length,
  slots: list.length,
  soundsPerTheme: { default: distinct("default"), custom: distinct("custom") },
  filesPerTheme: {
    default: Object.keys(audio).filter((k) => k.startsWith("default/")).length,
    custom: Object.keys(audio).filter((k) => k.startsWith("custom/")).length,
  },
  defaultOnEvents: list.filter((e) => e.kind === "event" && e.defaultOn).length,
  defaultOnVariants: list.filter((e) => e.kind === "variant" && e.defaultOn).length,
  statuslineSegments: segments.segments.length,
  statuslineDefaultSegments: segments.segments.filter((s) => s.default).length,
  themes: manifest.themes.length,
  editors: Object.keys(manifest.supported_editors).length,
};
const manifestDefaultOn = events.filter((e) => e.default).length;
const status = readFileSync(join(PRODUCT, "docs", "PROJECT_STATUS.md"), "utf8");
const claim = (re) => { const m = re.exec(status); return m ? Number(m[1]) : null; };
const documented = {
  events: claim(/Canonical hook events \| (\d+)/),
  variants: claim(/Matcher variants \| (\d+)/),
  soundsPerTheme: claim(/Distinct sounds \| (\d+) per theme/),
  filesPerTheme: claim(/(\d+) mp3 files per theme/),
  statuslineSegments: claim(/Status line segments \| (\d+)/),
  statuslineDefaultSegments: claim(/of which (\d+) are in the default set/),
};
const matches = {
  events: documented.events === counts.events,
  variants: documented.variants === counts.variants,
  soundsPerTheme: documented.soundsPerTheme === counts.soundsPerTheme.default && documented.soundsPerTheme === counts.soundsPerTheme.custom,
  filesPerTheme: documented.filesPerTheme === counts.filesPerTheme.default && documented.filesPerTheme === counts.filesPerTheme.custom,
  statuslineSegments: documented.statuslineSegments === counts.statuslineSegments,
  statuslineDefaultSegments: documented.statuslineDefaultSegments === counts.statuslineDefaultSegments,
  defaultOnEvents: counts.defaultOnEvents === manifestDefaultOn && counts.defaultOnEvents === 3,
};
const crossCheck = { documented, matches, allMatch: Object.values(matches).every(Boolean),
  notes: [
    "defaultOnEvents documented value (3) comes from AGENTS.md / the 'hooks enabled by default' set; compared with manifest.hooks[].default and hook_runner.is_hook_enabled on a fresh data dir.",
    `defaultOnVariants = ${counts.defaultOnVariants}: variants of an on-by-default parent that are on with no user config (the runner's own is_hook_enabled). They are not counted in the '3 on by default'.`,
  ] };
if (!crossCheck.allMatch) console.warn("bake: WARNING counts disagree with docs/PROJECT_STATUS.md:", JSON.stringify(matches));

// ── film sounds ──────────────────────────────────────────────────────────────
const FILM = [
  ["stop", "default"], ["permission_request", "default"], ["notification_idle_prompt", "default"],
  ["notification", "default"], ["stop_failure_rate_limit", "default"],
  ["stop", "custom"], ["permission_request", "custom"],
];
mkdirSync(PUBLIC_AUDIO, { recursive: true });
const filmSounds = FILM.map(([event, theme]) => {
  const e = list.find((x) => x.name === event);
  if (!e) fail(`film sound event ${event} unknown`);
  const file = e.audioFile[theme];
  const src = join(PRODUCT, "audio", theme, file);
  copyFileSync(src, join(PUBLIC_AUDIO, file));
  const buf = readFileSync(src);
  return {
    event, theme, file, publicPath: `audio/product/${file}`,
    sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length,
    durationSec: audio[`${theme}/${file}`].durationSec, onsetSec: onsets[`${theme}/${file}`],
  };
});
const filmNames = new Set(filmSounds.map((f) => f.file));
for (const f of readdirSync(PUBLIC_AUDIO)) if (f.endsWith(".mp3") && !filmNames.has(f)) rmSync(join(PUBLIC_AUDIO, f)); // keep the dir exactly the film's set

// ── demo repo (real git state for the git-derived segments) ──────────────────
const REPO = join(BAKE_HOME, "code", "checkout-service");
mkdirSync(join(REPO, "src"), { recursive: true });
const g = (...a) => run("git", ["-C", REPO, ...a], { env: childEnv({ GIT_AUTHOR_NAME: "demo", GIT_AUTHOR_EMAIL: "demo@example.invalid", GIT_COMMITTER_NAME: "demo", GIT_COMMITTER_EMAIL: "demo@example.invalid", GIT_CONFIG_NOSYSTEM: "1" }) });
g("init", "-q", "-b", "feat/retry-queue");
g("remote", "add", "origin", "https://github.com/acme/checkout-service.git");
writeFileSync(join(REPO, "README.md"), "# checkout-service\n");
writeFileSync(join(REPO, "src", "webhook.js"), "export const handle = () => {};\n");
g("add", "-A");
g("-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
writeFileSync(join(REPO, "src", "webhook.js"), "export const handle = () => retry();\n"); // modified
writeFileSync(join(REPO, "src", "retry-queue.js"), "export const retry = () => {};\n");  // untracked
writeFileSync(join(REPO, "src", "retry-queue.test.js"), "// test\n");                    // untracked
const DEMO_CWD = BAKE_HOME.replaceAll("\\", "/") + "/code/checkout-service"; // abbreviates to ~/code/checkout-service

// ── status line: real script, demo payloads ───────────────────────────────────
const DEMO = {
  model: { id: "claude-sonnet-5-5", display_name: "Sonnet 5.5" },
  repo: { owner: "acme", name: "checkout-service" },
  branch: "feat/retry-queue",
  ccVersion: "2.1.314",
  // 5 h window resets "today 9pm" (UTC clock, TZ pinned); weekly resets on a fixed far date so the date text is byte-stable
  fiveHourResetsAt: (() => { const n = new Date(); return Math.floor(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 21, 0, 0) / 1000); })(),
  weeklyResetsAt: Math.floor(Date.UTC(2030, 0, 4, 21, 0, 0) / 1000),
  states: {
    green:  { ctx: 38, five: 23, week: 31 },
    yellow: { ctx: 62, five: 47, week: 52 },
    red:    { ctx: 85, five: 74, week: 72 },
  },
};
const payload = (st) => ({
  session_id: "demo-session",
  model: DEMO.model,
  effort: { level: "high" },
  version: DEMO.ccVersion,
  cwd: DEMO_CWD,
  workspace: { current_dir: DEMO_CWD, project_dir: DEMO_CWD, git_worktree: DEMO.branch, repo: DEMO.repo },
  context_window: {
    used_percentage: st.ctx, context_window_size: 200000,
    current_usage: { input_tokens: 1200, cache_read_input_tokens: 71000, cache_creation_input_tokens: 3800 },
  },
  cost: { total_cost_usd: 1.84, total_lines_added: 156, total_lines_removed: 23, total_duration_ms: 1380000, total_api_duration_ms: 410000 },
  rate_limits: {
    five_hour: { used_percentage: st.five, resets_at: 0 },
    seven_day: { used_percentage: st.week, resets_at: 0 },
  },
});
const payloads = {};
for (const [name, st] of Object.entries(DEMO.states)) {
  const p = payload(st);
  p.rate_limits.five_hour.resets_at = DEMO.fiveHourResetsAt;
  p.rate_limits.seven_day.resets_at = DEMO.weeklyResetsAt;
  payloads[name] = p;
}
payloads.snooze = payloads.green;

// ── the viewed agent: the real script, fed what Claude Code and view-sensor.ts leave on disk ──
// Since 7.2.0 a status line follows the agent in view. The transcript and sidecar below are demo
// inputs; the row that comes out is the script's own, so `~200K` and the marks are never typed.
const AGENT = { id: "a7f3c1e2d4b6", type: "Explore", model: "claude-haiku-5-5", effort: "low" };
const SCRATCH_TEMP = join(BAKE_HOME, "temp");
const TRANSCRIPT = join(BAKE_HOME, "projects", "demo.jsonl");
const AGENT_DIR = join(BAKE_HOME, "projects", "demo", "subagents");
mkdirSync(AGENT_DIR, { recursive: true });
mkdirSync(join(SCRATCH_TEMP, "claude_audio_hooks_queue"), { recursive: true });
writeFileSync(join(AGENT_DIR, `agent-${AGENT.id}.jsonl`), JSON.stringify({
  type: "assistant", effort: AGENT.effort, requestedModel: AGENT.model,
  message: { model: AGENT.model, usage: { input_tokens: 1200, cache_read_input_tokens: 26500, cache_creation_input_tokens: 1300, output_tokens: 420 } },
}) + "\n");
payloads.cardAgent = { ...payloads.green, transcript_path: TRANSCRIPT };
payloads.stripAgent = payloads.cardAgent;
const VIEWED = new Set(["cardAgent", "stripAgent"]);
for (const [label, base] of Object.entries({ card: "green", cardSnooze: "green", stripMain: "green" })) payloads[label] = payloads[base];

const PALETTE = { // VS Code Dark+ integrated-terminal colours
  30: "#000000", 31: "#cd3131", 32: "#0dbc79", 33: "#e5e510", 34: "#2472c8", 35: "#bc3fbc", 36: "#11a8cd", 37: "#e5e5e5",
  90: "#666666", 91: "#f14c4c", 92: "#23d18b", 93: "#f5f43d", 94: "#3b8eea", 95: "#d670d6", 96: "#29b8db", 97: "#ffffff",
};
const hex = (r, g2, b) => "#" + [r, g2, b].map((v) => v.toString(16).padStart(2, "0")).join("");
function xterm256(n) {
  if (n < 16) return PALETTE[n < 8 ? 30 + n : 90 + (n - 8)];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return hex(v, v, v); }
  const c = n - 16, lv = (x) => (x === 0 ? 0 : 55 + x * 40);
  return hex(lv(Math.floor(c / 36)), lv(Math.floor((c % 36) / 6)), lv(c % 6));
}
function parseAnsi(line) {
  let st = { fg: null, bg: null, bold: false, dim: false };
  const spans = [];
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0, m;
  const push = (text) => {
    if (!text) return;
    const prev = spans[spans.length - 1];
    if (prev && prev.fg === st.fg && prev.bg === st.bg && prev.bold === st.bold && prev.dim === st.dim) prev.text += text;
    else spans.push({ text, ...st });
  };
  while ((m = re.exec(line))) {
    push(line.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) st = { fg: null, bg: null, bold: false, dim: false };
      else if (c === 1) st = { ...st, bold: true };
      else if (c === 2) st = { ...st, dim: true };
      else if (c === 22) st = { ...st, bold: false, dim: false };
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) st = { ...st, fg: PALETTE[c] };
      else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) st = { ...st, bg: PALETTE[c - 10] };
      else if (c === 39) st = { ...st, fg: null };
      else if (c === 49) st = { ...st, bg: null };
      else if (c === 38 || c === 48) {
        let col;
        if (codes[i + 1] === 5) { col = xterm256(codes[i + 2]); i += 2; }
        else if (codes[i + 1] === 2) { col = hex(codes[i + 2], codes[i + 3], codes[i + 4]); i += 4; }
        st = c === 38 ? { ...st, fg: col } : { ...st, bg: col };
      } else fail(`unhandled SGR code ${c} in status line output`);
    }
  }
  push(line.slice(last));
  return spans;
}
const WIDTHS = { wide: 150, medium: 110, narrow: 58 };
function renderStatus(state, label) {
  const out = [];
  for (const [wname, cols] of Object.entries(WIDTHS)) {
    const script = join(PRODUCT, "bin", "audio-hooks-statusline.py");
    const sid = `demo-${label}-${wname}`;
    const env = childEnv({ COLUMNS: String(cols), TEMP: SCRATCH_TEMP, TMP: SCRATCH_TEMP, TMPDIR: SCRATCH_TEMP });
    if (VIEWED.has(state)) writeFileSync(join(SCRATCH_TEMP, "claude_audio_hooks_queue", `viewed_agent.${sid}.json`), JSON.stringify({ agent_id: AGENT.id, type: AGENT.type }));
    // Since 7.2.0 a render only reads its caches, and a detached process fills them; a bake cannot wait on that.
    run("python", ["-B", script, "--refresh-cache", sid, DEMO_CWD], { env, cwd: REPO });
    const r = run("python", ["-B", script], { input: JSON.stringify({ ...payloads[state], session_id: sid }), env, cwd: REPO });
    const raw = r.stdout.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (!raw) fail(`status line produced no output for ${label}/${wname}`);
    out.push({ state: label, width: wname, columns: cols, raw, rows: raw.split("\n").map(parseAnsi) });
  }
  return out;
}
const renders = [];
for (const s of ["green", "yellow", "red"]) renders.push(...renderStatus(s, s));

// ── TALK: the commands SKILL.md maps the spoken requests to, run for real ─────
const skill = readFileSync(join(PRODUCT, "plugins", "audio-hooks", "skills", "audio-hooks", "SKILL.md"), "utf8");
const mapping = (said, cmd) => {
  const row = skill.split(/\r?\n/).find((l) => l.includes(said) && l.includes(cmd));
  if (!row) fail(`SKILL.md no longer maps "${said}" to ${cmd}`);
};
const volatile = { snooze: ["until", "until_iso"], "snooze-status": ["until", "until_iso", "remaining_seconds"] };
function talk(said, skillSaid, argv, volKey) {
  if (skillSaid) mapping(skillSaid, argv[0]); // the skill words the command, not each argument
  const r = cli(...argv);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* keep null */ }
  const vol = volKey ? volatile[volKey] : [];
  let stdout = r.stdout.trim(), parsedOut = parsed;
  if (parsed && vol.length) { // blank only fields that differ on every run, and say so
    parsedOut = { ...parsed }; for (const k of vol) if (k in parsedOut) parsedOut[k] = null;
    stdout = JSON.stringify(parsedOut);
  }
  return { said, skillSaid, command: "audio-hooks " + argv.join(" "), argv, exitCode: r.status, stdout, parsed: parsedOut, volatileFields: vol };
}
const talkHooksList = hooksList; // captured before any TALK command mutates the throwaway data dir
const snoozeStep = talk("mute audio for an hour", "- mute:", ["snooze", "1h"], "snooze");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); // let the countdown tick past 1h so it reads 59m on every run
const snoozeStatus = talk("(status after muting)", null, ["snooze", "status"], "snooze-status");
renders.push(...renderStatus("snooze", "snooze"));
// The README card carries no version number: a picture cannot be re-baked on every release, and it went stale.
const CARD_HIDDEN = '["version","cc_version"]';
cli("set", "statusline_settings.hidden_segments", CARD_HIDDEN);
renders.push(...renderStatus("cardSnooze", "cardSnooze"));
const themeStep = talk("switch to chimes", "- theme, webhook", ["theme", "set", "custom"]);
const themeAfter = cliJson("theme", "list");
cli("snooze", "off"); cli("theme", "set", "default"); // leave the throwaway dir tidy (it is wiped next bake anyway)
renders.push(...renderStatus("card", "card"), ...renderStatus("cardAgent", "cardAgent"));
// The one row of the README's feature strip: what changes when the view does.
cli("set", "statusline_settings.visible_segments", '["model","agent","effort","context"]');
renders.push(...renderStatus("stripMain", "stripMain"), ...renderStatus("stripAgent", "stripAgent"));

// ── assemble ──────────────────────────────────────────────────────────────────
const out = {
  $comment: "GENERATED by scripts/bake-product-data.mjs from the product repo. Do not edit; re-bake.",
  source: {
    repo: "ChanMeng666/echook", commit, version: manifest.version, runnerVersion: probe.runnerVersion,
    derivedBy: {
      events: "audio-hooks manifest .hooks", variants: "audio-hooks manifest .variants",
      defaultOn: "hook_runner.is_hook_enabled on a fresh data dir (+ manifest .default)",
      sounds: "distinct audioFile per theme over events+variants; mp3 counts from audio/<theme>/",
      statusline: "audio-hooks statusline segments; renders from bin/audio-hooks-statusline.py",
      editors: "audio-hooks manifest .supported_editors",
    },
  },
  counts, crossCheck,
  themes: manifest.themes,
  editors: Object.keys(manifest.supported_editors),
  events: list,
  audio,
  filmSounds,
  statusline: {
    palette: PALETTE,
    demoNotes: [
      "Payloads are demo inputs fed to the real status-line script; every rendered character is the script's output.",
      "cwd, repo owner/name and branch are demo values; git state (±3 changes) is from a real throwaway repo with remote https://github.com/acme/checkout-service.git on branch feat/retry-queue.",
      "TZ=UTC; the 5 h reset is '9pm' on the render day, the weekly reset is a fixed far date, so the output is byte-stable.",
      "The 'branch' segment shows workspace.git_worktree exactly as the product reads it.",
      "States card, cardSnooze and cardAgent hide the version and cc_version segments; stripMain and stripAgent show only model, agent, effort and context. cardAgent and stripAgent run with a demo sidecar and subagent transcript, as Claude Code and hooks/view-sensor.ts would leave them.",
      "Not rendered: remote, prompt_cache (opt-in segments), pr, worktree, session_name, agent, vim, thinking, output_style, spend_limit, added_dirs, exceeds_200k (optional payload fields, not part of the demo).",
    ],
    payloads,
    viewedAgent: AGENT,
    renders,
  },
  talk: {
    hooksList: talkHooksList,
    steps: [snoozeStep, snoozeStatus, themeStep],
    themeListAfter: themeAfter,
  },
  channels: {
    toasts: probe.toasts,
    toastDerivation: probe.toastDerivation,
    webhooks: probe.webhooks,
    syntheticEventMap: Object.fromEntries(Object.entries(probe.syntheticEventMap).filter(([k]) => k === "notification_idle_prompt")),
    notes: [
      "The stop toast body is the product's own wording and begins 'Task completed' (hook_runner.get_notification_context); Stop fires at the end of EVERY turn.",
      "Webhook payloads were built by the real send_webhook with subprocess.Popen replaced by a recorder; nothing was sent. 'timestamp' is blanked (volatile).",
    ],
  },
};

const text = JSON.stringify(out, null, 2) + "\n";
if (CHECK) {
  const have = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (have !== text) {
    console.error("bake --check: src/replica/data/product.generated.json is STALE against the product repo. Run `npm run bake`.");
    process.exit(1);
  }
  console.log(`bake --check: ok — product ${manifest.version} @ ${commit.slice(0, 7)}`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`bake: wrote ${OUT}`);
  console.log(`  product ${manifest.version} @ ${commit.slice(0, 7)} · ${counts.events} events · ${counts.variants} variants · ${JSON.stringify(counts.soundsPerTheme)} sounds/theme · ${counts.statuslineSegments} segments (${counts.statuslineDefaultSegments} default) · default-on ${counts.defaultOnEvents}`);
  console.log(`  cross-check vs docs/PROJECT_STATUS.md: ${crossCheck.allMatch ? "all match" : "MISMATCH " + JSON.stringify(matches)}`);
}
