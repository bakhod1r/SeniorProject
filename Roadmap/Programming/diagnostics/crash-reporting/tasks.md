# Crash Reporting — Hands-On Exercises

> **Topic:** [Crash Reporting Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can wire an unhandled-exception handler" to "I can stand up a symbolicated, deduplicated, PII-safe crash pipeline and read a minidump by hand."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

Crash reporting is one of those skills that looks done the moment a crash shows up in a dashboard — and is actually 10% done at that point. The capture is the easy part. The hard parts are the ones you only feel when the dashboard has 9,000 issues that are really 40, when every production trace reads `t.n.a` because nobody wired symbol upload, when legal finds a customer's email in an exception message, or when a signal handler you wrote allocates memory inside a `SIGSEGV` and deadlocks the very crash you were trying to capture. The exercises below are tiered to walk you through all of that.

The **Warm-Up** band builds reflexes: install the global handlers in each language, trigger every flavor of crash, read a report's anatomy. The **Core** band makes the pipeline *trustworthy* — symbolication, fingerprinting, deduplication, breadcrumbs, PII scrubbing — the four pillars from `middle.md`, but built by hand so you understand what the SDK is doing for you. The **Advanced** band drops you into the situations that separate middle from senior: writing an async-signal-safe handler, capturing and walking a minidump, computing crash-free rate, deduplicating at scale. The **Capstone** band stops being about a single tool and starts being about operating a pipeline: designing a symbol server, a release-health rollout gate, a compliance-grade scrubbing audit.

Do not skip ahead. The Capstone tasks assume you can already symbolicate a minified trace and write a fingerprint that survives a release. If you are still wiring `process.on('uncaughtException')` from memory mid-exercise, you will not finish the minidump walk. Work each band end-to-end, and if a task takes more than the budgeted time, write down what blocked you — that note is worth more than the answer.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the basic capture mechanics — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of `junior.md`.

### Task 1: Wire an unhandled-exception reporter in Node.js

**Problem.** You have a small Node.js script that throws an uncaught `TypeError` deep in a callback and also has a `Promise` that rejects with no `.catch`. Right now both kill the process with a bare stack trace on stderr and nothing is recorded. Install global handlers so that *both* an uncaught exception and an unhandled rejection get written to a structured JSON crash file before the process exits.

**Constraints.**
- Handle both `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)`.
- Write a JSON file to `/tmp/crash-<timestamp>.json` containing: `type`, `message`, `stack`, `timestamp`, and `pid`.
- After writing, exit with code `1` for `uncaughtException` (the process state is now untrusted).
- Do not use a third-party SDK — hand-roll it.

**Hints.**
- An uncaught exception leaves the process in an undefined state; log, flush, and exit. Do *not* try to "resume."
- `unhandledRejection` gives you the rejection reason, which may not be an `Error` — guard for that.
- Use the *synchronous* `fs.writeFileSync` in the handler; an async write may not flush before `process.exit`.

**Self-check.**
- [ ] Triggering the uncaught `TypeError` produces a crash file and exit code `1`.
- [ ] Triggering the unhandled rejection produces a crash file.
- [ ] The JSON has a real stack string, not `[object Object]`.

**Sample Solution.**

```js
const fs = require("fs");

function writeCrash(type, err) {
  const e = err instanceof Error ? err : new Error(String(err));
  const report = {
    type,
    message: e.message,
    stack: e.stack,
    timestamp: new Date().toISOString(),
    pid: process.pid,
  };
  // synchronous — async would not flush before exit
  fs.writeFileSync(`/tmp/crash-${Date.now()}.json`, JSON.stringify(report, null, 2));
}

process.on("uncaughtException", (err) => {
  writeCrash("uncaughtException", err);
  process.exit(1); // process state is untrusted; do not resume
});

process.on("unhandledRejection", (reason) => {
  writeCrash("unhandledRejection", reason);
  // a rejection alone does not corrupt the process; do not force-exit here
});
```

### Task 2: Read the anatomy of a crash report

**Problem.** You are handed a single JSON crash event exported from Sentry (~120 lines). Without any tooling, locate and name these six parts: the **exception type**, the **culprit/top in-app frame**, the **release**, the **environment**, the most recent **breadcrumb**, and any **tag** that looks filterable.

**Constraints.**
- Reading only — no code, no SDK.
- Write your answer as six labelled lines.
- For the breadcrumb, quote its `category` and `message`.

**Hints.**
- The `exception.values[]` array holds the type/value and the `stacktrace.frames[]`.
- Frames are ordered oldest-first; the *last* frame is where it threw.
- `in_app: true` marks your code vs library code — that's the culprit candidate.
- `breadcrumbs.values[]` is ordered oldest-first too; the smoking gun is usually near the end.

**Self-check.**
- [ ] You named a concrete exception class, not "some error."
- [ ] Your culprit frame is `in_app: true`, not a library frame.
- [ ] You distinguished a tag (indexed) from a context field (freeform).

### Task 3: Trigger and distinguish every crash flavor in Go

**Problem.** Write a Go program with four subcommands that each produce a *different* kind of failure: (a) a `panic(...)` on the main goroutine, (b) a `panic` inside a spawned goroutine with no `recover`, (c) a `nil` map write (runtime panic), (d) a deliberate `os.Exit(2)`. Observe which ones a top-level `defer recover()` in `main` can catch and which it cannot.

**Constraints.**
- One binary, selected by `os.Args[1]`.
- Put a single `defer func(){ recover() }()` in `main`.
- For each case, record in a comment: caught or not caught, and *why*.

**Hints.**
- `recover` only catches panics on the *same goroutine* that deferred it.
- A panic in a spawned goroutine with no recover crashes the whole process — `main`'s recover never sees it.
- `os.Exit` skips all deferred functions entirely.

**Self-check.**
- [ ] You can state which two of the four `main`'s recover cannot catch.
- [ ] You can explain why the goroutine panic escapes (different stack).
- [ ] You confirmed `os.Exit(2)` produced exit code 2 with no recover firing.

### Task 4: Install a Python excepthook and a threading hook

**Problem.** Python's `sys.excepthook` catches uncaught exceptions on the *main* thread only. Exceptions in `threading.Thread` workers vanish silently by default. Wire both `sys.excepthook` and `threading.excepthook` so an uncaught exception on *any* thread gets logged with thread name and full traceback.

**Constraints.**
- Use `sys.excepthook` for the main thread.
- Use `threading.excepthook` (Python 3.8+) for worker threads.
- Each handler logs `thread_name`, exception type, and the formatted traceback.
- Demonstrate by raising on the main thread and inside a worker.

**Hints.**
- `traceback.format_exception(exc_type, exc_value, exc_tb)` gives the full text.
- `threading.excepthook` receives an `args` object with `.thread`, `.exc_type`, `.exc_value`, `.exc_traceback`.
- The default main-thread name is `MainThread`; spawned ones are `Thread-N` unless you `name=` them.

**Self-check.**
- [ ] A raise on the main thread is captured with the traceback.
- [ ] A raise inside a worker thread is *also* captured (default behavior would have swallowed it).
- [ ] Each log line names the originating thread.

### Task 5: Chain a handler instead of replacing it

**Problem.** A platform already installs a top-level handler (imagine a framework's `uncaughtException` listener, or an existing JVM `Thread.setDefaultUncaughtExceptionHandler`). You must add *your* reporting without breaking theirs. Capture the existing handler, install yours, and call the original after you finish.

**Constraints.**
- Pick one language (Node or Java/JVM).
- Save the previous handler before installing yours.
- Your handler must call the previous one (chain), not silently drop it.
- Prove both run: yours logs "reported," the original still logs its message.

**Hints.**
- JVM: `Thread.getDefaultUncaughtExceptionHandler()` returns the current one (may be `null`).
- Node: `process.listeners('uncaughtException')` shows what's already attached.
- Chaining order matters — usually report first, then let the platform do its thing (often a forced exit).

**Self-check.**
- [ ] The original handler still runs.
- [ ] Yours runs too, and runs *first*.
- [ ] You handled the case where there was no previous handler (`null`).

### Task 6: Read a minified JS stack trace and feel the pain

**Problem.** You're given a production stack trace from a minified bundle:

```
TypeError: Cannot read properties of null (reading 'total')
    at t (https://cdn.app.com/main.4f2a.js:1:48201)
    at n.a (https://cdn.app.com/main.4f2a.js:1:51022)
    at https://cdn.app.com/main.4f2a.js:1:9183
```

**Constraints.**
- Reading only.
- Answer two questions in writing: (1) Can you tell which source function `t` is? (2) What single build artifact would make this trace readable?

**Hints.**
- Minification collapses everything onto `1:` (line 1) with a column offset — that's the giveaway.
- The function names `t`, `n.a` are mangled identifiers, not your source names.
- The fix is *not* in the trace; it's a build-time upload.

**Self-check.**
- [ ] You correctly concluded you *cannot* identify `t` from this trace alone.
- [ ] You named the source map (`main.4f2a.js.map`) as the missing artifact.
- [ ] You can explain why this must be uploaded out-of-band, not served publicly.

---

## Core

These tasks are 1-to-3 hours each. They require you to combine mechanics, build real pipeline pieces, and produce a written explanation. If you can do all of them comfortably, you're at the middle level.

### Task 7: Symbolicate a minified JS trace by hand

**Problem.** Build a tiny tool that takes the minified frame from Task 6 (`main.4f2a.js:1:48201`) plus the corresponding `main.4f2a.js.map` source map, and resolves it to the original file, function, line, and column.

**Constraints.**
- Use Mozilla's `source-map` library (Node) — but you call the API yourself; no Sentry.
- Input: a `{line, column}` from the generated file. Output: `{source, name, line, column}` in the original.
- Demonstrate on at least three frames.

**Hints.**
- `await new SourceMapConsumer(rawSourceMapJson)` then `consumer.originalPositionFor({ line, column })`.
- Source map columns are **0-based**; stack traces are usually **1-based** — adjust or your lookup is off by one.
- `consumer.destroy()` when done (the WASM consumer holds memory).

**Self-check.**
- [ ] You resolved the minified column to a real source file and line.
- [ ] You got a real function `name`, not `null`.
- [ ] You can explain the 0-based vs 1-based column gotcha.

**Sample Solution.**

```js
const { SourceMapConsumer } = require("source-map");
const fs = require("fs");

async function symbolicate(mapPath, frames) {
  const raw = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const consumer = await new SourceMapConsumer(raw);
  try {
    return frames.map((f) => {
      // stack columns are 1-based; the source map API is 0-based
      const pos = consumer.originalPositionFor({ line: f.line, column: f.column - 1 });
      return { source: pos.source, name: pos.name, line: pos.line, column: pos.column };
    });
  } finally {
    consumer.destroy();
  }
}

symbolicate("./main.4f2a.js.map", [
  { line: 1, column: 48201 },
  { line: 1, column: 51022 },
  { line: 1, column: 9183 },
]).then((r) => console.log(JSON.stringify(r, null, 2)));
```

### Task 8: Wire the CI symbol-upload step and prove release matching

**Problem.** Take a small JS app with a production bundle and a generated source map. Write the build script that uploads the source map to a reporter (real Sentry project, or a local mock that records what release it received), strips the `.map` from the deploy artifact, and stamps the SDK with the *same* release string. Then deliberately break the match and observe the failure.

**Constraints.**
- The release string must be derived *once*: `myapp@$(cat VERSION)+$(git rev-parse --short HEAD)`.
- The SDK's `release` and the upload's `--release` must read from that single variable.
- After upload, the `.map` must not exist in the deployed directory.
- Part B: change the SDK release by one character, redeploy, crash it, and confirm the trace stays minified.

**Hints.**
- `sentry-cli sourcemaps upload ./dist --release "$RELEASE" --url-prefix '~/static/'`.
- `--url-prefix` must match how the browser requests the file, or resolution silently fails *even with a matching release*.
- Gate the build: if `sentry-cli` exits non-zero, `exit 1` — a green deploy with no symbols is the trap.

**Self-check.**
- [ ] A real crash resolves to readable source in the dashboard.
- [ ] After Part B (mismatched release), the *same* crash stays minified — you've felt why "single source of truth" matters.
- [ ] No `.map` file remains in the deployed artifact.

### Task 9: Build a fingerprinting function from scratch

**Problem.** Given a stream of raw exception events (type, message, and a stack of frames), write a `fingerprint(event) -> string` that groups *the same bug* together and keeps *different bugs* apart. The catch: messages contain dynamic IDs (`failed to load order 8831`) and some stacks have a generic top frame (`assertFailed`, `logAndThrow`).

**Constraints.**
- Normalize the message: replace digit runs, UUIDs, and hex with placeholders before hashing.
- Skip known generic/wrapper frames when selecting the grouping frames.
- Key off: exception type + top *N* in-app frames (file + function) + normalized message.
- Output a stable hash (e.g. SHA-1 of the joined key).

**Hints.**
- `re.sub(r'\b[0-9a-f]{8}-[0-9a-f]{4}-...', '<uuid>', msg)` for UUIDs; `\b\d+\b -> <num>`; `0x[0-9a-f]+ -> <hex>`.
- Maintain a denylist of wrapper frames to skip (`assertFailed`, `panic`, `logAndThrow`).
- Use file+function, not line number — lines shift between releases and would re-shatter groups.

**Self-check.**
- [ ] Three "failed to load order N" events (different N) produce *one* fingerprint.
- [ ] Two genuinely different bugs that share an `assertFailed` top frame produce *two* fingerprints.
- [ ] The fingerprint is stable when only the line numbers shift (simulate a reformat).

**Sample Solution.**

```python
import hashlib
import re

WRAPPER_FRAMES = {"assertFailed", "logAndThrow", "panic", "must"}

def normalize_message(msg: str) -> str:
    msg = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "<uuid>", msg)
    msg = re.sub(r"0x[0-9a-fA-F]+", "<hex>", msg)
    msg = re.sub(r"\b\d+\b", "<num>", msg)
    return msg.strip()

def grouping_frames(frames, n=3):
    # drop wrapper/generic frames, keep in-app frames by (file, function) — NOT line
    useful = [
        (f["file"], f["function"])
        for f in frames
        if f.get("in_app") and f["function"] not in WRAPPER_FRAMES
    ]
    return useful[-n:]  # top of the stack = last frames

def fingerprint(event) -> str:
    parts = [
        event["type"],
        normalize_message(event.get("message", "")),
        *[f"{file}:{fn}" for file, fn in grouping_frames(event["frames"])],
    ]
    key = "|".join(parts)
    return hashlib.sha1(key.encode()).hexdigest()[:16]
```

### Task 10: Build a dedup/aggregation layer on top of the fingerprint

**Problem.** Using your `fingerprint()` from Task 9, build an in-memory aggregator that turns a stream of 10,000 raw events into a list of *issues*. Each issue tracks: fingerprint, representative event, `count`, `first_seen`, `last_seen`, and the set of affected user hashes.

**Constraints.**
- One pass over the event stream; O(1) per event lookup (hash map keyed by fingerprint).
- Track affected-user *count* via a set of opaque user IDs — never store raw identity.
- Sort the output by `count` descending and print the top 10.
- Bonus: approximate the affected-user count with a HyperLogLog instead of an exact set, and compare memory.

**Hints.**
- The structure is `dict[fingerprint] -> Issue`. First event of a fingerprint creates the issue; later ones increment.
- `first_seen = min`, `last_seen = max` of event timestamps.
- For the bonus, an exact `set` of 1M user IDs is megabytes; HLL is ~1.5KB for ~2% error — that's the production tradeoff.

**Self-check.**
- [ ] 10,000 events collapse to a small number of issues.
- [ ] The top issue's `count` matches a manual grep for that fingerprint.
- [ ] Affected-user count is by *distinct* user, not by event.

### Task 11: Add breadcrumbs and reconstruct the precondition

**Problem.** Build a ring-buffer breadcrumb recorder (last 100 events) and attach it to crashes. Instrument a small "checkout" flow so that navigation, HTTP calls, and clicks each drop a breadcrumb. Trigger a crash where the cart is `null`, and show that the breadcrumb trail reveals *why* (a prior `500` from `/api/cart`) where the stack trace alone could not.

**Constraints.**
- Fixed-size ring buffer (deque with `maxlen=100`); oldest breadcrumbs roll off.
- Each breadcrumb: `timestamp`, `category`, `message`, optional `data`.
- On crash, attach the *current* buffer snapshot to the report.
- The HTTP breadcrumb records method, path, status, and duration — but **not** the response body.

**Hints.**
- `collections.deque(maxlen=100)` is the whole ring buffer.
- The smoking gun is the `GET /api/cart 500` immediately before the crash.
- Describe, don't reveal: record `item_count`, not cart contents.

**Self-check.**
- [ ] The crash report carries the last ~100 breadcrumbs in order.
- [ ] You can point at the breadcrumb that explains the null cart.
- [ ] No breadcrumb contains a response body or PII.

### Task 12: Build a PII scrubber and test it adversarially

**Problem.** Write a `before_send(event) -> event | None` hook that scrubs an event before it leaves the process. It must handle four leak channels: the user object, HTTP-breadcrumb URLs/headers, the exception message, and a freeform context block. Then write a test harness that injects a fake card number, an `Authorization: Bearer` header, and a real-looking email through *each* channel and asserts every copy comes back redacted.

**Constraints.**
- Use an **allowlist** for the structured user object (`{id, plan, segment}` pass; everything else dropped).
- Use a **denylist regex** for free text (messages, exception values): card-number pattern, `Bearer <token>`, emails.
- Strip query-string tokens (`?token=`, `?key=`) from breadcrumb URLs.
- Return `None` to drop a known-noisy event type entirely (demonstrate with `BrokenPipeError`).
- The test must fail loudly if *any* channel leaks.

**Hints.**
- Allowlist for objects beats denylist — a denylist misses the *next* sensitive field someone adds.
- Card regex `\b\d{13,16}\b` is naive on purpose; note in a comment that it's a net, not a wall.
- Test the *email-in-the-exception-message* channel specifically — that's the one a `delete user.email` denylist misses.

**Self-check.**
- [ ] A fake card number injected via the message is redacted on output.
- [ ] An email set on `user.email` is gone, but `user.id` survives.
- [ ] A `?token=secret` in a breadcrumb URL is `[redacted]`.
- [ ] The test fails if you comment out any one scrub rule.

**Sample Solution.**

```python
import re

SAFE_USER_KEYS = {"id", "plan", "segment"}
CARD = re.compile(r"\b\d{13,16}\b")
BEARER = re.compile(r"Bearer\s+[A-Za-z0-9._-]+")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
URL_TOKEN = re.compile(r"([?&](token|key|sig)=)[^&]+", re.IGNORECASE)

def scrub_text(s: str) -> str:
    if not s:
        return s
    s = CARD.sub("[card]", s)
    s = BEARER.sub("Bearer [redacted]", s)
    s = EMAIL.sub("[email]", s)
    return s

def before_send(event):
    # 0. drop known-noisy events entirely
    exc = (event.get("exception") or {}).get("values") or []
    if exc and exc[0].get("type") == "BrokenPipeError":
        return None

    # 1. user object: ALLOWLIST, not denylist
    if event.get("user"):
        event["user"] = {k: v for k, v in event["user"].items() if k in SAFE_USER_KEYS}

    # 2. breadcrumbs: strip tokens from URLs, redact auth headers
    for b in (event.get("breadcrumbs") or {}).get("values", []):
        data = b.get("data") or {}
        if isinstance(data.get("url"), str):
            data["url"] = URL_TOKEN.sub(r"\1[redacted]", data["url"])
        headers = data.get("headers") or {}
        if "Authorization" in headers:
            headers["Authorization"] = "[redacted]"

    # 3. free text: message + exception values
    if event.get("message"):
        event["message"] = scrub_text(event["message"])
    for ex in exc:
        ex["value"] = scrub_text(ex.get("value", ""))

    # 4. freeform context: scrub all string leaves
    for ctx in (event.get("contexts") or {}).values():
        for k, v in list(ctx.items()):
            if isinstance(v, str):
                ctx[k] = scrub_text(v)
    return event
```

### Task 13: Symbolicate an Android trace with the ProGuard mapping

**Problem.** You have an obfuscated Android stack trace (classes/methods renamed to `a.b.c`) and the corresponding `mapping.txt` from an R8/ProGuard build. Use the `retrace` tool to recover the original class and method names.

**Constraints.**
- Use the `retrace` CLI (ships with the Android SDK build-tools / R8).
- Input: the obfuscated trace + `mapping.txt`. Output: the deobfuscated trace.
- Confirm the `mapping.txt` you use is from the *exact* build that produced the trace.

**Hints.**
- `retrace mapping.txt obfuscated_trace.txt` prints the recovered trace.
- The `mapping.txt` is per-build — a mismatched one gives wrong or partial names.
- This is exactly what Crashlytics/Sentry do server-side when the Gradle plugin uploads `mapping.txt` for you.

**Self-check.**
- [ ] The output shows real class/method names, not `a.b.c`.
- [ ] You can explain why a build-specific mapping is mandatory.
- [ ] You know which Gradle plugin would automate the upload in CI.

### Task 14: Capture handled exceptions without flooding the dashboard

**Problem.** Take a flow with a fallback path: parsing a third-party response that occasionally fails schema validation. You *recover* (use a fallback) but you *want to know* it happened. Wire deliberate `captureException` so you see these, then add the guardrails that keep them from drowning real crashes.

**Constraints.**
- Capture the handled exception, then *recover* — never capture-and-swallow without a fallback.
- Give it a **stable fingerprint** (it shares a generic call site).
- Apply client-side **sampling** (e.g. report 1 in 20) so a frequent handled error doesn't dominate quota.
- Prove you never capture a *routine* error (a 404, a validation failure) — those go to metrics/logs.

**Hints.**
- The fingerprint is `[subsystem, "schema-error", source_name]` — categorical, no per-request IDs.
- Sampling: `if random.random() < 0.05: capture_exception(e)`.
- The litmus test: "would I page someone for this?" If no, it's not a crash capture — it's a log/metric.

**Self-check.**
- [ ] Handled exceptions appear in the dashboard, grouped into one issue.
- [ ] At ~5% sampling, the count is roughly 1/20 of occurrences.
- [ ] A 404 in the same flow produces *zero* captured events.

### Task 15: Compute crash-free rate from an event stream

**Problem.** Given a session log (each line: `session_id`, `user_id`, `crashed` boolean, `release`) compute two metrics that release-health dashboards live by: **crash-free sessions** and **crash-free users**, broken down per release.

**Constraints.**
- Crash-free sessions = `1 - (crashed_sessions / total_sessions)`.
- Crash-free users = `1 - (users_with_at_least_one_crash / total_users)`.
- Output per release, sorted by release.
- Explain in writing why crash-free *users* is always ≥ crash-free *sessions* for the same data (or construct a counterexample if you think otherwise).

**Hints.**
- A single user with 10 sessions and 1 crash counts as 1 crashed user but only 1 crashed session out of 10.
- Crash-free users is the *kinder* number — one user's repeated crashes count once.
- This is the metric you gate a rollout on: "halt the release if crash-free sessions < 99.5%."

**Self-check.**
- [ ] Your two percentages are computed per release.
- [ ] You correctly reasoned about the users-vs-sessions relationship.
- [ ] You can state which metric you'd put on a rollout gate and why.

### Task 16: Offline queue with retry and backoff

**Problem.** A mobile/desktop app crashes while offline; the report must survive a restart and upload later. Build a persistent crash queue: on capture, write the event to disk; on next startup (or reconnect), drain the queue to the "server" with retry and exponential backoff, deleting each only after a confirmed upload.

**Constraints.**
- Events persist to disk (one file per event, or an append-only log).
- Upload uses exponential backoff with jitter on failure; cap the retries.
- An event is deleted *only* after a `200` — at-least-once delivery, never lose on crash mid-upload.
- Demonstrate: kill the process mid-drain and confirm no event is lost or double-deleted.

**Hints.**
- Write-then-upload-then-delete; never delete before the ack, or a crash loses the event.
- At-least-once means the server may see a duplicate — that's why dedup (Task 10) lives server-side.
- Jitter prevents a thundering herd when many clients reconnect at once.

**Self-check.**
- [ ] An event captured offline uploads after "reconnect."
- [ ] Killing the process mid-drain loses nothing (re-drains on restart).
- [ ] A duplicate upload is possible — and you note that dedup absorbs it.

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical work over speed. Several have no single right answer — they have defensible writeups.

### Task 17: Write an async-signal-safe crash handler in C

**Problem.** Write a `SIGSEGV`/`SIGABRT` handler in C that captures a backtrace and writes it to a file descriptor — using *only* async-signal-safe operations. Then deliberately break it (call `printf` or `malloc` inside the handler) and observe the deadlock/corruption that signal-handler safety exists to prevent.

**Constraints.**
- Install via `sigaction` with `SA_SIGINFO` on an alternate signal stack (`sigaltstack`) — a stack overflow can't be handled on the overflowed stack.
- Inside the handler use *only* async-signal-safe calls: `backtrace`, `backtrace_symbols_fd`, `write`. **No** `malloc`, `printf`, `fprintf`, or locks.
- Part B: add a `printf` inside the handler, trigger a crash *while* the main thread holds the stdio lock, and document the hang.
- Re-raise the default handler at the end so the process still produces a core dump.

**Hints.**
- `man 7 signal-safety` lists the exact set of permitted functions — memorize that `malloc`/`printf` are *not* on it.
- `backtrace_symbols` allocates (forbidden); `backtrace_symbols_fd` writes directly (allowed).
- After handling, `signal(sig, SIG_DFL); raise(sig);` so the OS still dumps core.
- The deadlock in Part B happens because the crash interrupted code holding the malloc/stdio lock, and the handler tries to take the same lock.

**Self-check.**
- [ ] The safe handler writes a backtrace on `SIGSEGV` without crashing the crash handler.
- [ ] It runs on the alternate stack (prove it survives a stack-overflow crash).
- [ ] Part B reproduces the hang, and you can explain the re-entrant-lock cause.
- [ ] After your handler, a core file is still produced.

**Sample Solution.**

```c
#include <execinfo.h>
#include <signal.h>
#include <unistd.h>
#include <stdlib.h>

static char alt_stack[SIGSTKSZ];

static void handler(int sig, siginfo_t *info, void *ucontext) {
    void *frames[64];
    int n = backtrace(frames, 64);            // async-signal-safe
    const char msg[] = "\n=== CRASH ===\n";
    write(STDERR_FILENO, msg, sizeof(msg) - 1); // safe
    backtrace_symbols_fd(frames, n, STDERR_FILENO); // safe: writes, does NOT malloc
    // re-raise default so the OS still dumps core
    signal(sig, SIG_DFL);
    raise(sig);
}

void install_crash_handler(void) {
    stack_t ss = { .ss_sp = alt_stack, .ss_size = sizeof(alt_stack), .ss_flags = 0 };
    sigaltstack(&ss, NULL);                   // handle on a separate stack
    struct sigaction sa = {0};
    sa.sa_sigaction = handler;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK;    // use the alt stack
    sigemptyset(&sa.sa_mask);
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGABRT, &sa, NULL);
}
// Part B: add fprintf(stderr, ...) inside handler, crash while another
// thread holds the stdio lock -> hang. THIS is why the rule exists.
```

### Task 18: Capture and walk a Linux core dump

**Problem.** Configure the system to produce a core dump for a crashing C/C++ (or Go) program, then walk it in `gdb` to recover the faulting instruction, the backtrace, and the value of a local variable at the crash site.

**Constraints.**
- Enable cores: `ulimit -c unlimited`, and know where `core_pattern` sends them (`/proc/sys/kernel/core_pattern` — possibly `systemd-coredump`).
- Build with debug info (`-g`, and for Go `GOTRACEBACK=crash`).
- In `gdb`: load the core, run `bt`, `frame`, `info locals`, and `x/i $pc` at the faulting address.
- Produce a one-paragraph writeup of the crash chain.

**Hints.**
- If `core_pattern` starts with `|`, cores go to `systemd-coredump`; retrieve with `coredumpctl gdb <pid>`.
- `gdb ./binary core.12345` then `bt full` for locals at every frame.
- The faulting instruction at `$pc` usually shows the bad dereference (e.g. `mov (%rax),%rdx` with `$rax == 0`).

**Self-check.**
- [ ] You produced a core file (or retrieved it via `coredumpctl`).
- [ ] `bt` shows your source frames, not just `??`.
- [ ] You named the faulting instruction and the null/garbage register behind it.

### Task 19: Capture and parse a minidump with Breakpad/Crashpad

**Problem.** Use Google Breakpad (or Crashpad) to make a native app emit a **minidump** on crash, generate `.sym` symbol files from your binary with `dump_syms`, and symbolicate the minidump with `minidump_stackwalk` to get a readable stack.

**Constraints.**
- Integrate the Breakpad `ExceptionHandler` so a crash writes a `.dmp` file.
- `dump_syms ./your_binary > your_binary.sym`, then place it under the expected `symbols/<name>/<id>/` layout.
- `minidump_stackwalk crash.dmp ./symbols/` produces the symbolicated walk.
- Write down *why* a minidump is far smaller than a full core dump.

**Hints.**
- A minidump is a compact, structured subset of memory (thread stacks, registers, loaded modules) — not the whole address space, so it's KBs–MBs, not GBs.
- The symbol directory layout is `symbols/<module>/<debug-id>/<module>.sym`; the debug-id must match the build.
- This is the engine under Chrome, many games, and `sentry-native` — same minidump, symbolicated server-side.

**Self-check.**
- [ ] A crash produces a `.dmp` file on disk.
- [ ] `minidump_stackwalk` prints a stack with your function names.
- [ ] You can explain the minidump-vs-core size difference and why it matters for upload.

### Task 20: Diagnose and fix an over-grouping regression

**Problem.** You're handed an aggregator (or a real Sentry project) where a *new* bug folded silently into an existing issue because both share a generic top frame. The new regression is invisible — no new issue appeared, and nobody noticed the event rate climb. Detect it, then fix the grouping so the two bugs separate.

**Constraints.**
- Detect over-grouping by analysis, not luck: scan issues for a sudden event-rate change *within* an issue, or for stacks under one fingerprint whose *deeper* frames diverge.
- Confirm two distinct bugs are merged (different deep frames, different fix).
- Fix by excluding the generic frame from grouping (mark not-in-app) or splitting the fingerprint on a distinguishing deeper frame.
- Re-run and confirm the two bugs now occupy two issues.

**Hints.**
- Over-grouping symptom from `middle.md`: "fix shipped but the issue won't auto-close" — because the *other* bug still fires under it.
- Watch event-rate *within* an issue, not just the count of new issues — that's how a regression hides.
- The generic frame (`assertFailed`, a logging wrapper) is the merge culprit; grouping must key off *your* frames.

**Self-check.**
- [ ] You detected the merge by evidence, not by being told.
- [ ] You confirmed the two underlying bugs differ (different deep frames/fix).
- [ ] After the fix, the regression has its own issue and the original can resolve.

### Task 21: Build a server-side symbolication service

**Problem.** Build a small service that accepts raw (unsymbolicated) crash events plus a release identifier, looks up the matching debug artifact from a symbol store, and returns a symbolicated stack. Support at least one format (JS source maps *or* Breakpad `.sym`).

**Constraints.**
- A symbol store keyed by `(release, debug-id)` — reject events whose symbols aren't present rather than returning gibberish.
- Cache loaded symbol files (consumers are expensive to construct — see Task 7's `SourceMapConsumer`).
- Return a clear error when the release doesn't match any uploaded symbols (the #1 real-world failure).
- Handle concurrent requests without re-parsing the same map for every event.

**Hints.**
- The lookup key is the release/debug-id — exactly the match that breaks in Task 8 Part B.
- An LRU cache of consumers keyed by debug-id avoids O(events) parses.
- "Symbols not found for release X" is a *useful* error; silently returning minified frames is the trap.

**Self-check.**
- [ ] Events with a known release symbolicate correctly.
- [ ] Events with an unknown release return an explicit "no symbols" error, not garbage.
- [ ] Repeated events for one release don't re-parse the symbol file each time.

### Task 22: Reproduce and fix a handler that loses the crash

**Problem.** You're given a crash reporter that *sometimes* fails to record the crash that killed the process — the report is empty or truncated. Find the cause (async write not flushed before exit, handler that itself throws, re-entrant crash, or unflushed buffer) and ship a fix that records the crash reliably.

**Constraints.**
- Reproduce the loss deterministically (it may need a fast-exit path or a second crash inside the handler).
- The fix must guarantee the report is durable before the process dies.
- Add a guard so a crash *inside* the handler can't take down the reporting itself.

**Hints.**
- Async `fs.writeFile` / buffered `logger.error` may not flush before `process.exit` — use sync writes or an explicit flush.
- A handler that throws can crash the crash handler; wrap it and fall back to a bare `write(2)`.
- Re-entrancy: a second signal during handling — set a flag and `_exit` on the second hit.

**Self-check.**
- [ ] You reproduced the dropped report reliably.
- [ ] The fixed handler always produces a complete report before exit.
- [ ] A crash inside the handler no longer loses everything (re-entrancy guard works).

### Task 23: Cross-platform dedup at scale with a sketch

**Problem.** Your fingerprint-based dedup (Task 10) works in memory but the pipeline now sees 50M events/day across many workers — an exact per-fingerprint user set won't fit. Re-implement affected-user counting with a probabilistic sketch and make the per-issue counters *mergeable* across workers.

**Constraints.**
- Replace exact user sets with HyperLogLog per fingerprint; merge HLLs across workers for the global count.
- Quantify the accuracy/memory tradeoff (HLL standard error ≈ `1.04/sqrt(m)`).
- Keep `count`, `first_seen`, `last_seen` exact (cheap), only approximate the distinct-user cardinality.
- Show that merging two workers' HLLs for the same issue gives ~the union cardinality, not the sum.

**Hints.**
- HLL registers are mergeable by element-wise max — that's what makes distributed counting work.
- ~12KB of registers gives ~0.4% error for millions of distinct users vs megabytes for an exact set.
- Exact counters (event count) are fine to keep — it's the *distinct-user* count that needs the sketch.

**Self-check.**
- [ ] Distinct-user counts are within the predicted error of the exact answer.
- [ ] Merging two workers' sketches yields the union, not the sum.
- [ ] You can state the memory you saved versus exact sets, with numbers.

---

## Capstone

These are open-ended scenarios. The point is not one correct answer but to design and defend a complete approach. Treat each as a design review with a staff engineer.

### Task 24: Design the symbol-upload pipeline for a polyglot release

**Problem.** Your company ships a web app (JS), an Android app (Kotlin + NDK), an iOS app (Swift), and a native desktop client (C++) — all from one CI on one release cadence. Design the symbol-upload pipeline so that *every* surface's production traces are readable, with zero manual steps, and a build that fails to upload symbols cannot ship.

**Constraints.**
- One release identifier, derived once, threaded into *every* SDK and *every* symbol upload.
- Per-surface artifacts: JS `.map`, Android `mapping.txt` + NDK `.so`, iOS `.dSYM`, desktop Breakpad `.sym`.
- Source maps must be uploaded *and* stripped from the deployed bundle.
- The build must *fail* if any upload fails — gate, don't warn.

**Hints.**
- The single release string is the linchpin: `app@$VERSION+$GIT_SHA`, computed once, exported to every step.
- Each surface has its own tool (`sentry-cli sourcemaps`/`upload-dif`, Gradle plugin, `dump_syms`) but the *release* must be identical.
- The most common failure (`middle.md`) is release mismatch and serving `.map` publicly — design both out.

**What "done" looks like.** You have a written design with a per-surface table (artifact, tool, upload step, gate) and a diagram showing the one release string flowing into both the SDK init and each upload. You specify the CI gate that fails the build on any non-zero upload, and the step that strips `.map` from the deploy. You can demo (even with one surface) a crash that symbolicates end-to-end, and you can articulate exactly what breaks if the release string diverges by one character.

### Task 25: Design a release-health rollout gate

**Problem.** Design an automated rollout gate that halts (or rolls back) a staged release when its crash-free rate degrades versus the prior release. The gate must avoid both false alarms (noise on low traffic) and false confidence (missing a real regression).

**Constraints.**
- Define the metric (crash-free sessions vs users — pick and justify) and the threshold.
- Handle the cold-start problem: a brand-new release has few sessions; don't gate on 5 data points.
- Define the comparison baseline (prior release? trailing 7-day?) and the action (pause rollout, page, auto-rollback).
- Account for the over-grouping trap: a *new* crash hiding inside an old issue shouldn't slip the gate.

**Hints.**
- Crash-free *sessions* is more sensitive; crash-free *users* is kinder — state which you gate on and why.
- Require a minimum session count before the gate is "armed," or you'll roll back on statistical noise.
- Compare adoption-matched cohorts (same % of traffic) so you don't compare a 1%-rollout to a 100% baseline.

**What "done" looks like.** A written design naming the gated metric, the threshold, the minimum-sample arming rule, the baseline, and the automated action. It explicitly handles low-traffic noise and the over-grouping blind spot (e.g. watch new fingerprints *and* per-issue event-rate spikes). You can walk a reviewer through three scenarios — clean release, real regression, noisy-but-fine — and show the gate does the right thing in each.

### Task 26: Compliance-grade scrubbing audit

**Problem.** Legal needs proof that your crash pipeline cannot ship PII to your SaaS reporter. Design and build the audit: a repeatable test that injects every category of sensitive data through every channel and proves redaction, plus the layered controls that make a single missed regex non-fatal.

**Constraints.**
- Enumerate the channels (user object, breadcrumb URL/headers/body, exception message, context, tags) and the categories (email, card, token, IP, full request body).
- Three layers of defense: don't-collect (`sendDefaultPii: false` + allowlists), client `beforeSend`, server-side scrubbers.
- The audit runs in CI and *fails the build* if any synthetic secret arrives un-redacted.
- Produce an artifact legal can read: a coverage matrix of channel × category × result.

**Hints.**
- A denylist on `user.email` misses the email interpolated into an exception *message* — your matrix must cover that cell.
- Allowlist structured objects; regex-scrub free text; enable server-side scrubbers as the backstop — defense in depth because regex is lossy.
- The honest caveat (from `middle.md`): not-collecting beats scrubbing; scrubbing is the net, not the wall — say so in the writeup.

**What "done" looks like.** You have a running CI test that emits synthetic events with fake secrets through every channel and asserts each lands redacted, failing the build on any leak. You produced the channel × category coverage matrix with pass/fail per cell. You documented the three-layer model and named what's *out* of scope (e.g. PII the app deliberately collects elsewhere). A reviewer can read the matrix in five minutes and trust it, and you can demo a single intentionally-broken scrub rule turning the build red.

### Task 27: Operate the pipeline at scale — design doc

**Problem.** You own crash reporting for a fleet producing 50M+ events/day. Write the design doc for operating it: ingestion, deduplication, symbol storage, retention, cost control, and regression alerting — at a scale where naive choices fall over.

**Constraints.**
- Ingestion must survive spikes (a bad release can 100× the event rate in minutes) without losing the *first* occurrences.
- Dedup and affected-user counting must be distributed and mergeable (Task 23's sketch).
- Symbol storage keyed by debug-id, with retention tied to how long releases stay in the field.
- Cost control: sampling strategy for *handled* events, full capture for crashes, and what you drop.
- Regression alerting that catches a *new* fingerprint and an *over-grouped* spike.

**Hints.**
- A bad release spikes volume; prioritize keeping the *first* event of each new fingerprint over the millionth duplicate.
- Sample handled captures, never crashes — and keep error capture distinct from perf-trace sampling (the classic confusion).
- Symbol retention must outlive the oldest release still running in production, or old crashes go unreadable.

**What "done" looks like.** A design doc covering ingestion (queue, backpressure, spike handling), dedup/aggregation (distributed sketches), symbol storage and retention policy, a sampling/cost model (full crashes, sampled handled), and regression alerting (new-fingerprint + per-issue rate spike). It states explicit SLOs (e.g. "first occurrence of any new crash visible within 60s even during a 100× spike") and the tradeoffs you accepted to hit them. You can present it in 15 minutes and a staff engineer understands every gate, sketch, and cost lever.

---

## If you can do all of these, you have the senior level

You can wire crash capture in any of Node, Python, Go, Java/Android, or native C/C++, and you understand what the SDK does because you've built each piece by hand: the handlers, the fingerprint, the dedup, the scrubber, the offline queue. You can symbolicate a minified JS trace, retrace an obfuscated Android stack, and walk a minidump or a core dump without a tutorial open. You can write an async-signal-safe handler and explain exactly why `malloc` in a signal handler deadlocks. You can stand up the CI symbol pipeline, the release-health gate, and the compliance audit that make the whole thing trustworthy at scale. The next step is not more capture exercises — it's operating this pipeline through a real bad-release incident, and designing systems whose crashes are rare enough that the pipeline mostly sits quiet.

---

## Related Topics

- [Crash Reporting — Junior](junior.md)
- [Crash Reporting — Middle](middle.md)
- [Crash Reporting — Senior](senior.md)
- [Crash Reporting — Professional](professional.md)
- [Crash Reporting — Interview](interview.md)
- Sibling diagnostic topics: [Debugging](../debugging/README.md), [Error Handling](../error-handling/README.md), [Logging](../logging/README.md), [Tracing](../tracing/)
- Cousins: [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md), [Refactoring — Tooling & Automation](../../code-craft/refactoring/05-tooling-and-automation/)
