"""Read-only probe of echook's hook runner, used by scripts/bake-product-data.mjs.

Imports the product's own `hooks/hook_runner.py` and calls its pure string-building
functions. It never plays a sound, raises a toast or touches the network:
`send_webhook` is run with `subprocess.Popen` replaced by a recorder, so the real
payload-building code runs and the request is captured instead of sent.

usage: python -B bake-probe-runner.py <product-repo>   (JSON request on stdin, JSON result on stdout)
The caller must have pointed CLAUDE_PLUGIN_DATA / CLAUDE_AUDIO_HOOKS_DATA / HOME at a throwaway dir.
"""
import ast
import json
import os
import re
import sys

product = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(product, "hooks"))
sys.dont_write_bytecode = True

import hook_runner as hr  # noqa: E402
import notification_context  # noqa: E402
import runner_core  # noqa: E402
import webhook_dispatch  # noqa: E402

req = json.load(sys.stdin)
src_path = os.path.join(product, "hooks", "hook_runner.py")
with open(src_path, encoding="utf-8") as fh:
    src_lines = fh.read().splitlines()


def find_line(pattern):
    for i, line in enumerate(src_lines, 1):
        if pattern in line:
            return i, line.strip()
    raise SystemExit("probe: source line not found: " + pattern)


out = {"runnerVersion": hr.HOOK_RUNNER_VERSION}

# ---- sound mapping and effective defaults ------------------------------------
out["defaultAudioFiles"] = dict(hr.DEFAULT_AUDIO_FILES)
out["customAudioFiles"] = dict(hr.CUSTOM_AUDIO_FILES)
out["syntheticEventMap"] = {k: [v[0], v[1]] for k, v in hr.SYNTHETIC_EVENT_MAP.items()}
eff = {}
for name in req["events"]:
    eff[name] = bool(hr.is_hook_enabled(name))
for name in req["variants"]:
    parent = hr.SYNTHETIC_EVENT_MAP[name][0]
    eff[name] = bool(hr.is_hook_enabled(parent, name))
out["effectiveDefault"] = eff

# ---- toast strings ------------------------------------------------------------
ln, urgency_line = find_line('urgency = "critical" if hook_type in')
critical = ast.literal_eval(re.search(r"hook_type in (\([^)]*\))", urgency_line).group(1))
_, title_line = find_line("notif_sent = desktop_notification.send_desktop_notification(runner_core._invoker_display_name(), context, urgency)")
detail_level = "standard"
toasts = []
for ev in req["toastEvents"]:
    stdin_data = ev["stdin"]
    hook_type = ev["hookType"]
    body = notification_context.get_notification_context(hook_type, stdin_data, detail_level)
    body += notification_context._format_context_suffix(stdin_data, detail_level)
    toasts.append({
        "event": ev["event"],
        "hookType": hook_type,
        "detailLevel": detail_level,
        "title": runner_core._invoker_display_name(),
        "body": body,
        "urgency": "critical" if hook_type in critical else "normal",
        "stdin": stdin_data,
    })
out["toasts"] = toasts
out["toastDerivation"] = {
    "title": "runner_core._invoker_display_name()",
    "body": "notification_context.get_notification_context(hook_type, stdin, detail_level) + notification_context._format_context_suffix(...)",
    "urgency": {
        "derivedBy": "source-read",
        "file": "hooks/hook_runner.py",
        "line": ln,
        "text": urgency_line,
        "criticalHookTypes": list(critical),
    },
    "dispatch": {"derivedBy": "source-read", "file": "hooks/hook_runner.py",
                 "line": find_line("notif_sent = desktop_notification.send_desktop_notification(runner_core._invoker_display_name(), context, urgency)")[0],
                 "text": title_line},
}

# ---- webhook payloads (real builder, request captured not sent) ---------------
captured = []


class _FakeStdin:
    def __init__(self, box):
        self.box = box

    def write(self, data):
        self.box["body"] = data

    def close(self):
        pass


class _FakePopen:
    def __init__(self, args, **kw):
        box = {"argv": list(args)}
        captured.append(box)
        self.stdin = _FakeStdin(box)


webhook_dispatch.subprocess.Popen = _FakePopen
webhooks = []
for ev in req["toastEvents"]:
    stdin_data = ev["stdin"]
    hook_type = ev["hookType"]
    context = notification_context.get_notification_context(hook_type, stdin_data, detail_level) + notification_context._format_context_suffix(stdin_data, detail_level)
    for fmt in req["webhookFormats"]:
        captured.clear()
        cfg = {"webhook_settings": {"enabled": True, "url": "https://example.invalid/echook-bake-probe", "format": fmt}}
        webhook_dispatch.send_webhook(hook_type, context, stdin_data, cfg)
        if len(captured) != 1 or "body" not in captured[0]:
            raise SystemExit("probe: webhook capture failed for %s/%s" % (ev["event"], fmt))
        box = captured[0]
        body_text = box["body"].decode("utf-8")
        entry = {
            "event": ev["event"],
            "format": fmt,
            "headers": json.loads(box["argv"][4]),
            "volatileFields": [],
        }
        if fmt == "raw":
            payload = json.loads(body_text)
            # the one field that differs on every call; blanked so the bake is byte-stable
            payload["timestamp"] = None
            entry["volatileFields"] = ["timestamp"]
            entry["payload"] = payload
        else:
            try:
                entry["payload"] = json.loads(body_text)
            except ValueError:
                entry["payload"] = body_text
        webhooks.append(entry)
out["webhooks"] = webhooks

json.dump(out, sys.stdout, ensure_ascii=False)
