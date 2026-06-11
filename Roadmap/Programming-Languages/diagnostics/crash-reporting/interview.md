# Crash Reporting — Interview Questions

> **Topic:** [Crash Reporting Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about auto-capturing crashes, symbolicating traces, grouping/dedup, crash-free metrics, PII scrubbing, signal-handler safety, and operating a reporting pipeline at scale.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Symbolication](#symbolication)
4. [Grouping, Fingerprinting & Dedup](#grouping-fingerprinting--dedup)
5. [Signal-Handler & In-Process Safety](#signal-handler--in-process-safety)
6. [Metrics: Crash-Free Rate & Release Health](#metrics-crash-free-rate--release-health)
7. [PII, Privacy & Compliance](#pii-privacy--compliance)
8. [Tricky / Trap Questions](#tricky--trap-questions)
9. [System / Design Scenarios](#system--design-scenarios)
10. [Behavioral / Experience](#behavioral--experience)
11. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
12. [Cheat Sheet](#cheat-sheet)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Crash-reporting interviews split into three flavours. The first is "do you know the moving parts" — what a dSYM is, what a minidump contains, what `beforeSend` does, why a release name has to match a symbol upload. The second is "do you understand the failure modes" — why a dashboard has 9,000 issues that are really 40, why your `malloc`-inside-a-signal-handler line is a bug, why crash-free *sessions* and crash-free *users* tell different stories. The third, for senior and staff, is "can you operate this as a system" — sampling, quota, symbol servers, regression alerting, privacy posture, the build pipeline that gates on symbol upload.

This file is the question bank. Trap questions explain *why* the obvious instinct is wrong, because in crash reporting the wrong instinct (capture everything, scrub with one regex, symbolicate at report time) is the expensive part — it costs you quota, leaks PII, or hands you an unreadable dashboard at exactly the moment you have a production fire. The behavioural section is for roles where the interviewer wants stories with shape — a real incident the reporter caught (or missed), and what you changed.

---

## Conceptual / Foundational

### Q: What is a crash reporter, and what does it do that logging doesn't?

A crash reporter automatically **captures the state of a process at the moment of an unrecoverable failure** — the faulting thread's stack, all threads, registers, loaded module addresses, OS/device/app metadata — packages it, and delivers it to a backend that **symbolicates, groups, and triages** it.

The difference from logging: logging is something *you* decided to emit ahead of time, from inside running code. A crash, by definition, happens at a point you didn't anticipate — often where no log line exists, sometimes where the process is too broken to run normal code (a segfault, an OOM kill, a native heap corruption). The reporter installs *out-of-band* capture (signal handlers, uncaught-exception hooks, an out-of-process monitor) so it works precisely when the in-process world has fallen apart. It also does the post-capture work logging never does: turn addresses into `file:line`, collapse thousands of occurrences into one issue, and track per-release crash rates.

Said shortly: logs are intentional and in-process; crash capture is automatic and survives the process dying.

### Q: Walk me through the lifecycle of a crash report, from fault to fixable issue.

1. **Fault.** The app hits an unrecoverable condition: an uncaught exception (managed runtimes), a fatal signal like `SIGSEGV`/`SIGABRT` (native), an OOM, an ANR/watchdog kill.
2. **Capture.** An installed handler or out-of-process monitor snapshots the stacks, registers, threads, and metadata. On native platforms this often becomes a **minidump**.
3. **Enrich.** Breadcrumbs, tags, user/device context, release, and environment are attached (collected *before* the crash, flushed *with* it).
4. **Scrub.** A `beforeSend`-style hook redacts PII *before the payload leaves the process*.
5. **Queue & upload.** Written to disk first (the process may be dying), then uploaded with retry/backoff — usually on *next launch* for hard native crashes, since you can't reliably upload from inside a segfault.
6. **Symbolicate (server-side).** The backend maps addresses to source using the **symbols you uploaded for that exact build**.
7. **Group.** A fingerprint collapses the event into an issue with other occurrences of the same bug.
8. **Triage.** Assignee, release-health regression detection, alerting, dedup against already-known issues.

The two steps engineers most often get wrong are 6 (symbols never uploaded / release mismatch) and 7 (fingerprint includes a dynamic ID).

### Q: Why can't you reliably symbolicate at the moment of capture, on the device?

Three reasons. **You usually don't ship symbols to production** — release binaries are stripped (no DWARF), JS is minified, Android is R8-obfuscated; the symbol tables that map address → name live only in your build artifacts, not on the user's device. **You're inside a broken process** — after a `SIGSEGV` the heap may be corrupt; doing symbol-table lookups (which allocate and walk data structures) is exactly the unsafe work you must avoid in a crash handler. And **it's wasteful** — symbolication is a backend job you do once per unique build, against uploaded symbols, not N times on N devices.

So the device captures *addresses + module load offsets*; the backend does the address→source resolution later. This is also *why* symbol upload at build time is non-negotiable: without those uploaded symbols, the backend has only numbers.

### Q: Crash vs error vs ANR vs OOM — distinguish them.

- **Crash:** the process terminates abnormally and cannot continue — uncaught exception, fatal signal, `panic`/`abort`. The reporter's core case.
- **Error (handled):** something failed but the program recovered — a caught exception, a returned error value. You may *deliberately* report these (`captureException`) but they are not crashes and shouldn't drown out crashes.
- **ANR (Application Not Responding) / watchdog / hang:** the process is alive but unresponsive (main thread blocked > N seconds). Android's ANR, iOS's watchdog `0x8badf00d` kill. Captured differently — by a watchdog timer, not a fatal signal.
- **OOM:** the OS kills the process for exceeding memory (`SIGKILL` on Linux/Android, jetsam on iOS). The killer is uncatchable — you get *no* in-process handler chance — so OOMs are usually *inferred* (the app died without a recorded crash, and last-session memory was high) rather than directly captured.

The interview point: a good reporter handles all four, but only the first gives you a clean in-process stack. The other three need indirect mechanisms.

### Q: What's in a minidump, and how is it different from a full core dump?

A **minidump** (Microsoft format, also produced by Breakpad/Crashpad on Linux/macOS) is a *compact* snapshot: the faulting thread's stack and all thread stacks, register state, the list of loaded modules with their versions and load addresses, and selected memory regions — typically tens to hundreds of KB. A **core dump** is the *entire* process address space — every mapped page, the whole heap — often hundreds of MB or GB.

Trade-off: a minidump is small enough to upload from a user's phone over a cellular connection and contains *enough* to symbolicate the stacks (because it carries module IDs + offsets, which you resolve against your `.sym`/PDB/DWARF). A core dump gives you full heap inspection (you can read every variable) but is impractical to ship from the field and may contain far more PII. You use minidumps for fleet crash reporting; you reach for core dumps in a controlled environment when you need to inspect heap state a minidump didn't capture.

### Q: Name the major crash-reporting tools and where each fits.

- **Sentry** — general-purpose: web, backend, mobile, native. The de facto standard; self-hostable; rich grouping config; symbolicates source maps, dSYM, PDB, ProGuard, DWARF.
- **Firebase Crashlytics** — mobile-first (iOS/Android), free, deep release-health integration, Google-owned.
- **Bugsnag (SmartBear)** — mobile + web with a stability-score framing.
- **Breakpad / Crashpad** — Google's native crash capture for C/C++ (Chrome, games, desktop). Produces minidumps. Crashpad is the newer, out-of-process successor to the in-process Breakpad. These are the *engine* under many native integrations.
- **sentry-native** — bridges native minidumps (via Crashpad/Breakpad) into Sentry's backend.
- **PLCrashReporter** — Apple-platform in-process signal handling, used by several mobile SDKs.

If asked "why Crashpad over Breakpad," the answer is **out-of-process**: Crashpad runs a separate handler process so capture survives even severe in-process corruption, where in-process Breakpad might not.

### Q: Why does crash upload usually happen on the *next* launch, not at crash time?

Because at crash time the process is, by definition, in an undefined or dying state. After a `SIGSEGV` you cannot safely allocate, take locks, or run a TLS networking stack — all of which a normal HTTP upload needs (see the signal-safety question). So the safe pattern is: in the handler, write a *minimal* dump to disk using only async-signal-safe operations, then let the process die. On the **next launch**, the SDK finds the dump on disk and uploads it through the normal (now-healthy) network path.

Consequence for metrics: there's inherent latency and loss. A device that crashes and never launches again (uninstall after a fatal crash) never reports — which biases crash-free numbers slightly optimistic. Out-of-process monitors (Crashpad) mitigate this by uploading from the *separate* handler process that didn't crash.

---

## Symbolication

### Q: Explain symbolication. Walk through it for one platform end to end.

Symbolication is mapping a raw runtime address (or minified/obfuscated name) back to human-readable `function (file:line)`. The captured frame is essentially "module `libapp.so`, offset `0x000123ab`." The backend looks up which symbol file corresponds to that module's **build ID / UUID**, finds the function and line whose address range contains that offset, and rewrites the frame.

iOS end to end:
1. Xcode compiles Swift/ObjC and emits a **`.dSYM`** bundle containing the DWARF debug info — a mapping from address ranges to `file:line` — keyed by the binary's **UUID**.
2. The release binary shipped to the App Store is stripped; the `.dSYM` stays in your build artifacts.
3. At build time, CI uploads the `.dSYM` to the reporter (`sentry-cli upload-dif`, Fastlane, or the Crashlytics run-script).
4. A device crashes; the report carries the binary UUID + frame offsets.
5. The backend matches that UUID to the uploaded dSYM and resolves each offset to `file:line`.

The single failure point: the UUID in the report must match an uploaded dSYM. App Store bitcode recompilation historically broke this (the UUID changed), which is why you fetch the *App Store–recompiled* dSYMs from App Store Connect.

### Q: dSYM vs PDB vs DWARF vs source map vs ProGuard mapping — match each to its platform and what it undoes.

| Artifact | Platform | Undoes |
|---|---|---|
| **dSYM** | iOS / macOS (Apple) | Stripped native addresses → Swift/ObjC `file:line`, keyed by binary UUID |
| **PDB** | Windows (native C/C++, .NET) | Addresses → symbols for the matching build GUID |
| **DWARF** | Linux/native (Go, Rust, C/C++), and the format *inside* dSYM | Addresses → source; lives in the binary or split `.debug` files |
| **Source map** (`.js.map`) | JS (web/Node) | Minified `t.n.a:1:4821` → original `file:line:col` |
| **ProGuard/R8 mapping** (`mapping.txt`) | Android (Java/Kotlin) | Obfuscated `a.b.c` → real class/method names ("retrace") |

Two things candidates miss: DWARF is both a standalone Linux format *and* the payload inside a dSYM; and Android needs **two** symbol artifacts for a typical app — `mapping.txt` for the obfuscated Java/Kotlin layer *and* the NDK `.so` debug symbols for any native code.

### Q: Why does the release name have to match between the SDK and the symbol upload, exactly?

Because symbolication matches symbols to events **by build identity**, and the release string is part (or the entirety) of that identity. The SDK stamps every event with `release` (e.g. `myapp@4.2.0+abc123`); the symbol upload registers symbols under a `--release`. If they differ by even a character, the backend has the symbols but cannot associate them with the event — so the trace stays minified while CI shows a green "upload succeeded." This is the single most common "I uploaded symbols and traces are still gibberish" cause. The fix is structural: derive the release from **one** source of truth (e.g. `VERSION + git SHA`) and inject the same value into both the SDK build config and the upload command.

**What-if — the release matches but traces are still minified?** Then suspect the secondary cause: for source maps, the `--url-prefix` doesn't match how files are actually served (uploaded path `~/static/app.js` vs served `/assets/app.js`), so the backend can't line up the map with the stack frame's reported URL. For native, the build ID/UUID in the binary differs from the uploaded symbol's (a rebuild between shipping and uploading).

### Q: What is `dump_syms` and the Breakpad symbol workflow?

For native (Breakpad/Crashpad) you don't upload DWARF directly. You run **`dump_syms`** over your *unstripped* binary at build time; it produces a Breakpad **`.sym`** text file — a normalized symbol format keyed by the module's debug ID. You upload those `.sym` files to your symbol store. When a minidump arrives, the server tool (`minidump_stackwalk`, or the reporter's pipeline) walks the minidump's stack, reads each frame's module + offset, looks up the matching `.sym` by debug ID, and produces a symbolicated trace.

The discipline: keep your unstripped binaries (or the generated `.sym`) for **every** build you ship, indexed by debug ID, effectively forever — a crash can arrive from a months-old version still in the field. That archive is your **symbol server**.

### Q: Why must you NOT serve source maps publicly, and how do you keep them out of the bundle?

A source map *is your source code* — it maps the minified bundle back to readable original files, function names, and often the full source content. If you deploy `app.js.map` next to `app.js` on a public CDN, anyone with DevTools can reconstruct your codebase. The correct flow: build the bundle and maps, **upload the maps to the reporter** (so it can symbolicate), then **strip the `.map` files from the deploy artifact** (`rm dist/**/*.map`) before publishing. Some teams additionally remove the `//# sourceMappingURL=` comment so browsers don't even look. The reporter still symbolicates because it has its own copy; the public gets only the minified bundle.

---

## Grouping, Fingerprinting & Dedup

### Q: How does default grouping work, and what are its two failure modes?

Default grouping fingerprints by **exception type + a normalized stack trace** (usually the top N *in-app* frames). Same exception from the same call path → same issue. It's right ~80% of the time and wrong in two predictable directions:

- **Under-grouping (one bug → thousands of issues):** the fingerprint includes the **message**, and the message carries a dynamic value — `failed to load order 8831`, `9027`, `4410`. Each unique message becomes its own issue. One bug, thousands of "issues."
- **Over-grouping (many bugs → one issue):** a *generic* top frame — a shared `assert` helper, a logging wrapper, a `panic`/`abort` helper — sits at the top of unrelated crashes, so they all collapse into one giant issue. You fix one cause, the issue keeps firing, and it won't auto-resolve.

Fixes respectively: normalize the message or set an explicit `fingerprint`; mark the generic frames "not in-app" so grouping keys off *your* code, or split the fingerprint by a distinguishing field.

### Q: What makes a good fingerprint? Give the rule.

A good fingerprint is **stable across all occurrences of the same bug** and **distinct across different bugs**. Compose it from *stable categorical* parts: the failing subsystem, the exception type, the logical operation — `["payments", "gateway-timeout", gateway_name]`. Never include per-request entropy: IDs, timestamps, user names, request bodies, memory addresses. The mental test: "if this bug happens 10,000 times tomorrow, will all 10,000 produce the identical fingerprint? And will a *different* bug produce a different one?" If yes to both, it's good.

### Q: What's the relationship between symbolication and grouping?

Grouping **depends on** symbolication. If you group on *minified/obfuscated* frames, every new build mangles names differently (`t.n.a` this release, `q.x.b` next release) — so the "same" bug gets new frames and a brand-new fingerprint *every release*, and your dashboard re-shatters on every deploy. You must symbolicate *first*, then group on the stable symbolicated frames. The corollary catches teams out: "my fingerprints are perfect but the dashboard is chaotic after every release" is almost always an unresolved symbol problem, not a fingerprint problem.

### Q: Dedup — what does a reporter dedup, and what does it not?

A reporter dedups in layers:
- **Event → issue grouping** (the fingerprint) collapses many *occurrences* of one bug into one *issue*. This is the primary dedup.
- **Within an issue**, it counts occurrences and tracks affected users rather than showing 50,000 identical rows.
- **Cross-build dedup** keeps the same logical bug as one issue across releases (when frames are stable and symbolicated), so a regression shows as "this issue reappeared in v4.3" rather than a new issue.

What it does *not* dedup automatically: **semantically identical bugs with structurally different stacks** — the same root cause reached via two code paths produces two issues, and a human has to merge them. And it can't dedup across the **symbol boundary**: if one build symbolicated and another didn't, the same bug appears twice. Dedup is fingerprint-driven; it's only as good as the fingerprint and the symbols feeding it.

### Q: A fix shipped, but the issue won't auto-resolve. Walk me through diagnosing it.

Auto-resolve relies on "this issue stopped occurring in the release that contains the fix." If it won't resolve, either the bug is still firing or the issue is **over-grouped** — two distinct bugs share one fingerprint (typically a generic top frame merged them). Your fix killed bug A; bug B still fires under the same issue, so the issue never goes quiet. Diagnose by opening recent events *within* the issue and checking whether their full stacks actually match: if you see two distinct stacks, split the fingerprint (mark the shared wrapper not-in-app, or add a distinguishing key) so the two bugs separate — then the fixed one can resolve and the other surfaces on its own.

---

## Signal-Handler & In-Process Safety

### Q: Why is writing a crash handler dangerous? What is async-signal-safety?

When a fatal signal (`SIGSEGV`, `SIGABRT`, `SIGBUS`) fires, your handler runs in an **interrupted, possibly corrupt** context: the thread was stopped mid-operation, perhaps holding the `malloc` lock, perhaps with a corrupted heap (the very corruption that caused the crash). Only a small set of operations are **async-signal-safe** — guaranteed to work when called from a signal handler. POSIX defines the list: `write`, `_exit`, `read`, `sigaction`, `signalfd`-style primitives, and a few dozen others. Notably **not** safe: `malloc`/`free`, `printf` (it locks and allocates), most of the C library, anything that takes a lock, anything that allocates.

So a crash handler that calls `malloc`, formats a string with `printf`, or makes an HTTP call can **deadlock** (re-acquiring the `malloc` lock the crashing thread already held) or **double-fault** (touching corrupt heap). The professional reporters work around this by doing the absolute minimum in-handler — write a pre-allocated buffer to a pre-opened file descriptor with `write()` — or, better, by handling the crash **out of process** (Crashpad), where the handler isn't running in the corrupt process at all.

### Q: List concretely what you must NOT do inside a signal handler, and what the safe alternative is.

| Don't | Why | Do instead |
|---|---|---|
| `malloc`/`new` | Crashing thread may hold the allocator lock → deadlock | Pre-allocate all buffers *before* the crash |
| `printf`/`fprintf` | Locks + allocates internally | `write()` to a pre-opened fd with preformatted bytes |
| Take a mutex | The held lock may be the one that crashed | Lock-free / signal-safe primitives only |
| HTTP upload (TLS, DNS) | Allocates, locks, needs a healthy runtime | Write a minidump to disk; upload on next launch |
| Run the GC / managed runtime callbacks | Heap may be corrupt | Capture native state only; defer managed work |
| Re-enter the same handler | Recursive fault → infinite loop / stack overflow | Reset handler to default (`SA_RESETHAND`) or guard with a flag |

The unifying rule: **the handler's only job is to persist a minimal snapshot using async-signal-safe calls, then re-raise/exit.** Everything rich and unsafe happens out of process or on next launch.

### Q: How does Crashpad's out-of-process model avoid these problems?

Crashpad runs a **separate handler process** that is *not* in the crashing process's address space. The app process, on startup, spawns this handler and registers with the OS (via an exception port on macOS, a `WER`/exception mechanism on Windows, a `ptrace`/pipe arrangement on Linux) so that when the app faults, the OS notifies the *handler* process. The handler then reads the crashed process's memory **from outside**, writes the minidump, and (often) uploads it — all from a healthy process with an uncorrupted heap and working allocator/network stack.

This sidesteps the entire async-signal-safety minefield: you're no longer trying to do complex work inside a broken process. The trade-off is operational complexity (a second process to manage) and a small always-on resource cost. It's why Chrome and modern native stacks moved from in-process Breakpad to out-of-process Crashpad.

### Q: How do you handle a crash that happens in one of many threads, or in a goroutine?

You capture **all threads**, not just the faulting one — the minidump records every thread's stack, because the root cause is frequently in a *different* thread than the one that faulted (thread A corrupted memory; thread B dereferenced it and died). The faulting thread is marked, but a triager needs the whole picture.

For Go specifically: a `panic` is *not* a signal — it unwinds and, if unrecovered, the runtime prints all goroutine stacks and exits. The sentry-go SDK installs a `recover`-based hook, but **each goroutine needs its own `defer recover()`** because a panic in goroutine X cannot be recovered by a `defer` in goroutine Y. A common bug: wiring recovery only on the main goroutine and losing every crash that originates in a worker. For true native faults under Go (`SIGSEGV` from cgo), set `GOTRACEBACK=crash` and capture the core/minidump.

---

## Metrics: Crash-Free Rate & Release Health

### Q: Define crash-free sessions vs crash-free users. When do they diverge, and which do you alert on?

- **Crash-free sessions** = (sessions without a crash) / (total sessions). A *session* is one app run/foreground period.
- **Crash-free users** = (users who experienced no crash) / (total users).

They diverge when crashes are **concentrated**. If one bug crashes a small group of users *repeatedly*, crash-free *sessions* can look terrible (many crashed sessions) while crash-free *users* looks fine (few affected people) — or the reverse: a crash on first launch that hits *every* new user once tanks crash-free *users* while barely denting *sessions*.

Which to alert on: **both, for different questions.** Crash-free *users* answers "how many people are hurt" — the customer-impact and release-go/no-go metric. Crash-free *sessions* answers "how unstable is a typical run" and is more sensitive to high-frequency-but-narrow bugs. A mature SLO tracks crash-free *users* as the headline (e.g. "≥ 99.5% crash-free users") and watches *sessions* for early/concentrated signals.

### Q: What's "release health," and how does it catch a bad deploy?

Release health attributes crashes (and sessions) to the **release** that produced them, giving each build its own crash-free rate, adoption curve, and regression status. It catches a bad deploy by comparing the new release's crash-free rate against the baseline *as adoption ramps*: if v4.3 is at 98.1% crash-free users while v4.2 sat at 99.6%, that's a regression even though absolute numbers look "high." The key is **per-release attribution + adoption-weighting** — early in a staged rollout you have few v4.3 sessions, so the reporter weights confidence by adoption to avoid alerting on noise from the first 50 installs. This is what powers "halt the rollout" automation.

### Q: Why is a raw crash *count* a misleading health metric?

Because it's not normalized to usage. Crash count rises when your user base grows, when traffic peaks (Monday morning), or when one user hits a loop — none of which means your app got *less* stable. A flat count during a 3× traffic spike actually means stability *improved*. You normalize: crashes **per session** (or per user, per release). The rate is comparable across time, releases, and cohorts; the count is not. The corollary trap: a dropping crash *count* after a release can be a *worse* product — if the new build crashes on launch so users can't even reach the screens that used to crash, count falls while the product is more broken.

### Q: How do you account for OOMs and ANRs in crash-free numbers, given they're uncatchable?

You can't capture them in-process, so you **infer** them. For OOM: on each launch, the SDK checks whether the *previous* session ended without a recorded crash *and* the app was foregrounded with high memory pressure / was killed by the OS — and attributes a probable OOM. For ANR: a watchdog thread (or the OS's ANR signal on Android, the `0x8badf00d` watchdog code on iOS) records a hang when the main thread is unresponsive past a threshold. The honest caveat: these are *estimates* — an OOM inferred from "died without a crash record" can be confounded by force-quits, OS updates, or battery death. Good reporters label them as such and let you see catchable crashes and inferred kills separately so you don't mistake a noisy estimate for a hard fact.

---

## PII, Privacy & Compliance

### Q: What are the three layers of PII scrubbing, and why three?

1. **Don't collect it.** The cheapest, most reliable scrubbing is never attaching the email/token/card in the first place — default to hashed IDs and "describe, don't reveal" data.
2. **`beforeSend` (client-side, before upload).** A hook that runs on every event in-process: redact known-sensitive fields, drop dangerous breadcrumbs, regex out card/token patterns from messages. This is the last chance before data leaves your boundary.
3. **Server-side scrubbers (defense in depth).** The backend (e.g. Sentry Data Scrubbers, `sensitive_fields`) strips known patterns *again* on receipt, catching anything the client missed.

Three layers because each is fallible: you'll forget to not-collect some field; `beforeSend` regexes are lossy (a card number split across a string won't match); server-side scrubbing is a backstop, not a wall. Defense in depth means a single miss in one layer doesn't become a leak. And the framing that matters: **enrichment and scrubbing are the same decision** — the moment you attach the user object "to know who's affected," you've created the obligation to decide which of its fields are safe.

### Q: PII leaked into a crash report. Your `beforeSend` strips `user.email`. How did it get through?

It wasn't in `user.email`. PII has many channels into a report, and a single-field denylist guards exactly one of them:
- An **exception message** that interpolated the email (`f"no account for {email}"`).
- An **HTTP breadcrumb** URL with `?token=...` or `?email=...` in the query string.
- An **HTTP breadcrumb body** or response snippet.
- A **context field** someone added (`set_context("user_form", {...})`).
- An **auto-attached** field because `sendDefaultPii` wasn't `false`.

The fix is structural, not another denylist line: switch the user object (and other structured objects) to an **allowlist** of safe keys, scrub breadcrumb URLs/bodies and exception *message text* with regex, set `sendDefaultPii: false`, enable server-side scrubbers — and, upstream, stop interpolating PII into messages at all.

### Q: Allowlist vs denylist for scrubbing — which, and why?

For **structured objects** (the user object, context blocks), use an **allowlist** — enumerate the keys that *may* pass (`{id, plan, segment}`), drop everything else. A denylist ("strip `email`") protects against the fields you thought of and silently leaks the *next* sensitive field a teammate adds six months later. An allowlist fails *closed*: a new field is excluded by default until someone deliberately adds it to the safe set.

For **free text** (exception messages, log lines) you can't allowlist — you don't control the shape — so there you fall back to a **denylist of patterns** (regex for PANs, `Bearer` tokens, emails). It's lossy and best-effort; that's why "don't collect / don't interpolate PII into messages" upstream is the real defense and the regex is just the net.

### Q: Why is `sendDefaultPii: false` the right default even though it drops useful data?

Because the asymmetry is brutal. Accidentally shipping PII (IP, cookies, headers, request bodies) to a third-party SaaS is a **regulatory and reputational** event — GDPR for personal data, PCI-DSS scope explosion for card data. The benefit it costs you is *convenience* — auto-attached request context. Default-deny, then **consciously add back** only the safe subset you actually need (a hashed user ID for affected-user counts, a token-stripped URL, a plan tier). It is far easier to *deliberately add* one safe field than to *notice* one sensitive field you've been leaking by default to everyone for months.

---

## Tricky / Trap Questions

### Q: CI is green, symbol upload "succeeded," but production traces are still minified. First suspect?

Wrong instinct: "the upload must have failed, re-run it." It succeeded — the symbols are *there*.

The symbols exist but aren't being **applied**, almost always because the **release name the SDK stamps doesn't match the release the symbols were uploaded under**. Symbolication associates symbols to events by build identity; a one-character drift means the backend has both and joins neither. Wire `release` from one source into both the SDK and the upload. Second suspect (JS): `--url-prefix` doesn't match how files are served, so the map can't be lined up with the stack's reported URL. Third (native): the binary was rebuilt between shipping and symbol generation, so the debug ID/UUID differs.

### Q: Your dashboard has 9,000 issues. You believe there are about 40 real bugs. What's happening and what do you do?

Wrong instinct: "we have a lot of bugs, file 9,000 tickets" — or "delete old issues."

This is **under-grouping**: fingerprints include a dynamic value (an order ID, a timestamp, a user name in the message), so one bug shatters into thousands of "issues." Audit the top issues: titles that differ only by digits are the tell. Fix by normalizing the dynamic part of the message or setting an explicit `fingerprint` of stable categorical parts. Separately check for the *opposite* — a few suspiciously huge issues spanning unrelated stacks (over-grouping from a generic top frame), which you split. After both, 9,000 collapses toward the real ~40.

### Q: You added the user's email to reports "so we know who's affected." Why is that a mistake, and what do you do instead?

Wrong instinct: "we need to identify affected users, so attach the email."

You've just put PII into a third-party SaaS, in GDPR scope, replicated across every event, breadcrumb, and backup. You don't need the email to *count* affected users — you need a **stable, opaque identifier**. Attach a **hashed user ID** (`hash(user.id)` with a shared, stable scheme across services). That gives you exact affected-user counts and crash-free-users math with **zero** stored identity. Add a low-cardinality `segment`/`plan` tag if you want to slice by tier. If a human truly needs to contact the user, they look the hash up in *your* system, where the identity belongs — it never lives in the crash tool.

### Q: A crash only happens in release builds, never in debug. Why might the crash *report* also be useless?

Wrong instinct: "can't reproduce in debug, so I can't fix it."

Two things differ in release. First, the bug itself: optimizer reordering, dead-store elimination, or undefined behavior that only manifests with `-O2` — a use-after-free that debug's allocator padding hid. Second, the *report*: release binaries are **stripped/minified/obfuscated**, so without uploaded symbols the trace is `t.n.a` gibberish — useless precisely when you need it. So you fix *both*: ensure symbol upload for release builds is wired and the release names match (so the report becomes readable), *and* treat the debug-vs-release behavior gap as a UB/optimization signal. The report being useless is often a missing-symbols problem masquerading as a "hard bug."

### Q: Crash-free rate is 99.9% and stable, but support is flooded with crash complaints. What's wrong?

Wrong instinct: "the metric says we're fine, it must be user error."

Several real explanations: (1) **OOMs/ANRs aren't counted** — your 99.9% is *catchable crashes only*, and the flood is uncatchable kills your metric doesn't see. (2) **Reporting loss** — users who crash on launch and uninstall never report, biasing the number optimistic (survivorship). (3) **Sampling** — someone applied trace/error sampling to crashes, so you're measuring a fraction. (4) **Wrong denominator** — crash-free *sessions* at 99.9% can still mean a meaningful slice of *users* is hit if crashes concentrate. (5) The crashes are on an **old release** still widely installed that your "current" dashboard view filters out. Check each; the metric isn't lying, it's answering a narrower question than support is asking.

### Q: You set `traces_sample_rate` and now you're losing crashes. What happened?

Wrong instinct: "sampling is sampling, it applies to everything proportionally."

You conflated **performance-trace sampling** with **error/crash sampling**. `traces_sample_rate` controls how many *performance transactions* are kept — it should not drop errors. But misconfiguration (or using a single sample rate, or an `error_sampler`/`sample_rate` set low) can throw away crashes. **Crash capture should default to 1.0.** If you *deliberately* sample *handled* exceptions to control quota, do it explicitly and separately, never via the perf knob, and never sample *unhandled* crashes — those are the events you most need every one of.

### Q: After a release, every issue in the dashboard is brand new. The code barely changed. Why?

Wrong instinct: "the new build introduced a ton of regressions."

The fingerprints are computed on **minified/obfuscated frames** because symbols aren't being applied (not uploaded, or release mismatch). Each build mangles names differently, so the same bugs get new frames → new fingerprints → "new" issues, every single release. It's not regressions; it's symbol resolution. Fix symbol upload + release matching and the issues will start persisting across builds, and real regressions will stand out instead of being buried in noise.

### Q: Your `beforeSend` hook throws an exception. What happens to the event, and what's the broader lesson?

Wrong instinct: "the SDK will just skip my hook and send the event."

In several SDKs, if `beforeSend` throws, the event is **dropped silently** — you lose the crash *and* get no error about it. Worse, if the throw is consistent, you lose *all* crashes and your dashboard goes quiet, which reads as "we're stable" when you're actually blind. Lesson: the scrubbing hook runs on the hottest, most fragile path (a process that may already be crashing) and must be **simple, defensive, and total** — wrap its body in a try/catch that fails *open to a safe-redacted event* (or a minimal event), never crashes, and is itself unit-tested. The hook that protects your privacy must not become the hook that blinds your monitoring.

### Q: A native crash report symbolicates 4 frames, then shows `???` for the rest of the stack. Why?

Wrong instinct: "the minidump is corrupt."

More likely the stack walk **lost the frame chain**. Native stack unwinding needs either frame pointers or CFI/unwind tables; in optimized builds (frame-pointer omission, `-O2`) the walker relies on **unwind info** that must be present in the symbols you uploaded. If a module on the stack is a **third-party/system library** whose symbols you don't have, or whose `.sym`/debug info wasn't uploaded, the walker can't continue past it → `???`. Or the symbols uploaded are for a *different build* of that module (debug-ID mismatch). Fixes: upload symbols (including system symbols where the platform allows), preserve frame pointers for better unwinding, or accept that some system frames stay opaque. It's a *missing-unwind-info* problem, not corruption.

---

## System / Design Scenarios

### Q: Design the crash-reporting setup for a new mobile app from scratch.

**Capture.** SDK (Crashlytics or Sentry) initialized as the *first* thing in app launch — before any code that could fail. Native + managed handlers; ANR/watchdog detection; OOM inference on next launch.

**Symbols.** Symbol upload (`.dSYM`, NDK `.so`, `mapping.txt`) wired into the **release build in CI**, gated so the build *fails* if upload fails. Release name derived from `versionName + build number + git SHA`, the *same* value stamped in the SDK and the upload. Fetch App Store–recompiled dSYMs if bitcode is in play.

**Grouping.** Accept defaults initially; after first real traffic, audit for under/over-grouping and add explicit fingerprints where the default is wrong — never preemptively.

**Context.** Breadcrumbs at navigation and network boundaries (URLs token-stripped). Tags for `release`, `os`, `device`, key feature flags. Hashed user ID for affected-user counts.

**Privacy.** `sendDefaultPii: false`; allowlist `beforeSend` for the user object; regex scrub of messages; server-side scrubbers on; a CI smoke test that emits a fake-PII crash and asserts redaction.

**Metrics/alerting.** Crash-free *users* as the headline SLO with release-health regression alerting that can halt a staged rollout; crash-free sessions watched for concentrated bugs.

**Verify.** A synthetic crash in a staging build that must arrive symbolicated, correctly grouped, and redacted — run in CI so a regression in the pipeline is caught before an incident.

### Q: Design crash reporting for a fleet of native C++ desktop apps (think a game or an IDE).

**Capture out-of-process** with **Crashpad** — a separate handler process so capture survives heap corruption; on fault, it writes a **minidump** and (optionally) uploads it. This avoids the async-signal-safety minefield entirely.

**Symbols.** At build time, run `dump_syms` over the unstripped binaries to produce `.sym` files keyed by debug ID; push them to a **symbol server**. Retain symbols for *every* shipped build indefinitely — months-old versions still crash in the field.

**Backend.** sentry-native (or a self-hosted minidump pipeline using `minidump_stackwalk`) that symbolicates against the symbol server by debug ID.

**Scale concerns.** Minidumps are small (KB) but a popular app generates millions; you sample *uploads* (not capture) for high-frequency known issues, dedup aggressively by fingerprint, and tier retention. Privacy: minidumps capture memory — scope which memory regions are included and scrub, because user data can land in captured stack memory.

**Self-host vs SaaS.** If the binary is sensitive or volume makes per-event SaaS pricing brutal, self-host; accept that you now operate symbolication, storage, and scaling yourself.

### Q: Your crash-reporting bill exploded. How do you cut cost without going blind?

1. **Find the volume drivers.** Almost always a handful of issues account for most events — one chatty handled-exception capture, one breadcrumb storm. Pull the top issues by event count.
2. **Stop capturing routine errors.** 404s, validation failures, expected timeouts captured as exceptions are quota you're paying to bury real crashes. Move them to metrics/logs.
3. **Sample handled captures, not crashes.** Apply sampling to high-frequency *handled* exceptions (keep 1/100); keep *unhandled* crashes at 1.0.
4. **Fix under-grouping** — paradoxically, fixing fingerprints can reduce ingestion if the SDK or backend rate-limits per-issue, and it definitely cuts the *human* cost.
5. **Rate-limit / spike-protect** at the SDK so one device in a crash loop doesn't send 10,000 events/minute.
6. **Tier retention** — shorter retention for low-severity, longer for crashes.
7. **Drop noise in `beforeSend`** — return `null` for known-junk events (a third-party SDK's benign `BrokenPipeError`).

The principle: cut **handled-exception and noise volume**, never your unhandled-crash fidelity.

### Q: Design a CI gate that guarantees every shipped build has working symbolication.

The gate has three checks, all build-failing:
1. **Symbols were generated** for the artifact being shipped (dSYM/`.sym`/source map exists and is non-empty).
2. **Symbols uploaded successfully** — `sentry-cli` (or equivalent) exited zero *and* a verification call confirms the backend has them for this debug ID/release.
3. **Release identity is consistent** — the release string injected into the SDK build config byte-equals the one used in the upload command, both derived from a single `RELEASE=app@$VERSION+$GIT_SHA` variable.

Then a **post-deploy smoke test**: a canary build deliberately crashes (a hidden trigger), and an automated check asserts the resulting issue arrives **symbolicated** (real `file:line`, not gibberish) and **redacted** (a fake card number planted in the message comes back `[card]`). If the smoke crash doesn't symbolicate, fail the pipeline — because the *next* real crash won't either, and you'll discover it during an incident.

### Q: A regression shipped and the reporter didn't alert. Walk through why, and how you'd fix the alerting.

Several failure modes: (1) **Over-grouping** folded the new bug into an existing issue, so no "new issue" alert fired — fix by alerting on *event-rate changes within* issues, not only new issues. (2) **Symbol mismatch** made the new build's crashes form throwaway minified issues that nobody's alert rules matched. (3) The alert was on **raw count** and traffic happened to be low, so the rate-spike didn't cross a count threshold — switch to crash-free-*rate* per release. (4) **Adoption weighting** suppressed it as noise during early rollout — tune the confidence threshold. (5) The alert routed to a dead channel. The durable fix is **release-health regression alerting**: per-release crash-free rate vs baseline, adoption-weighted, alerting on *within-issue* rate increases and crash-free-rate drops — not just first-seen issues.

---

## Behavioral / Experience

### Q: Tell me about a crash the reporter caught that you'd never have found otherwise.

The interviewer wants arc, evidence, and the role the *tooling* played — not "I'm great at crashes."

Example skeleton:
- **Signal.** Crash-free users dipped from 99.6% to 99.1% on a staged rollout, on one device model only.
- **What the report gave us.** The breadcrumb timeline showed a camera-permission prompt immediately before every crash; the tag slice showed it was Android 14 on one OEM.
- **Root cause.** A vendor camera HAL returned a null surface the SDK didn't guard; only that OEM's firmware did it.
- **Resolution.** Guarded the null path, shipped a hotfix, watched the issue's per-release event rate drop to zero on the build with the fix.
- **Why the tool mattered.** No repro existed — we had the device model in *zero* of our test labs. Breadcrumbs + per-release health + device tags replaced a reproduction we could never have done.

Tell *one* crash, with concrete numbers and the specific field that cracked it.

### Q: Describe a time symbolication was broken and how you found it.

"Post-release, every crash issue was `t.n.a`. CI was green — uploads 'succeeded.' I diffed the release string the SDK stamped (`app@4.2.0`) against the one the upload used (`app@4.2.0+abc123`); they differed by the git SHA suffix because two scripts computed it independently. The symbols existed in the backend, keyed to a release no event ever carried. Fix: a single `RELEASE` variable in CI feeding both the SDK build arg and the upload flag, plus a post-deploy smoke crash that asserts a *readable* trace. Lesson: 'upload succeeded' is not 'symbols applied' — verify with a real symbolicated event, not the upload exit code."

### Q: Tell me about a PII leak you caught (or caused) in crash reporting.

"Compliance flagged an email in a crash report. Our `beforeSend` stripped `user.email`, so I was confused. The email was in the *exception message* — a `ValueError(f"no account for {email}")` somewhere upstream. The field-level scrub never had a chance. I switched the user object to an allowlist, added a message-text regex scrub, enabled server-side scrubbers, and — the real fix — stopped interpolating user data into exception messages in the offending module. Then I added a CI test that plants a fake email in a thrown message and asserts it arrives redacted. Lesson: a denylist on one field is theater; PII has many channels, and 'don't collect/don't interpolate' beats scrubbing."

### Q: When did a crash-free metric mislead you?

"We celebrated 99.9% crash-free sessions while support drowned in crash reports. The metric only counted *catchable* crashes; the flood was OOM kills the SDK couldn't capture in-process. Once we added OOM inference (previous-session-died-with-high-memory), the *real* crash-free users dropped to 98.7% and matched support volume. Lesson: a crash-free number is only as honest as the failure classes it can observe — always ask what it *can't* see (OOM, ANR, launch-crash-then-uninstall) before trusting it."

### Q: Tell me about operating crash reporting at scale — a cost or noise problem you solved.

"Our Sentry bill 4×'d in a month. The top issue was a single handled `capture_exception` in a retry path firing on every transient network blip — millions of events, all benign. I sampled that *handled* capture to 1/100 with a stable fingerprint, kept unhandled crashes at 1.0, added SDK-side spike protection so one looping device couldn't flood us, and dropped a known-benign third-party `BrokenPipeError` to `null` in `beforeSend`. Volume fell 80%, crash fidelity unchanged. Lesson: cost problems in crash reporting are almost always *handled-exception and noise* problems — never solve them by sampling unhandled crashes."

---

## What I'd Ask a Candidate Now

Questions that separate "configured an SDK once" from "operates crash reporting."

### Q: How do you verify your crash pipeline actually works, end to end?

Listening for **deliberate verification**, not "the SDK just works." Strong answer: a CI/staging smoke test that triggers a synthetic crash *with a planted fake-PII payload* and asserts the resulting issue arrives **symbolicated** (real `file:line`), **correctly grouped**, and **redacted**. Bonus: doing it per-release so a pipeline regression is caught before an incident. Weak answer: "I threw an error once and saw it in the dashboard."

### Q: Why does symbol upload belong in CI and not a human's checklist?

Listening for the failure-mode insight: a manual step gets skipped on the **hotfix release** — the one you most need readable. The answer should land on *automated, non-optional, build-gated* upload (fail the build if symbols don't upload) with release identity from a single source. Candidates who say "we just remember to run the upload script" have lived the pain or are about to.

### Q: A junior wants to attach the full request and user object to every crash "for context." What do you tell them?

Listening for: respect (context is good and replaces the repro) *plus* the privacy reflex (enrichment *is* a scrubbing decision). The answer should reach allowlist the user object, hash the ID, token-strip URLs, `sendDefaultPii: false`, and "describe, don't reveal" — not a flat "no context."

### Q: When would you self-host the crash backend instead of using a SaaS?

Listening for trade-off reasoning, not dogma: data residency/privacy (sensitive binaries, regulated data that can't leave the network), cost at high event volume vs per-event SaaS pricing, vendor lock-in — *weighed against* the operational burden you take on (symbolication, storage, scaling, retention). A staff answer notes that self-hosting Sentry/GlitchTip means *you* now operate the symbol server and ingestion scaling.

### Q: What's the difference between in-process and out-of-process crash capture, and when does it matter?

Reveals depth on signal safety. In-process handlers run in the corrupt, dying process and are constrained to async-signal-safe operations (deadlock/double-fault risk). Out-of-process (Crashpad) captures from a *separate* healthy process, sidestepping the minefield, at the cost of a second process. It matters most for **native** apps where heap corruption is the *cause* of the crash and an in-process handler may not survive to record it.

### Q: How do you decide what to put in a fingerprint?

Strong answer states the rule crisply — stable across occurrences of one bug, distinct across bugs; compose from *categorical* parts (subsystem, error type, logical op); **never** IDs/timestamps/addresses — and connects it to the two failure modes (under/over-grouping) and to the symbolication dependency. Candidates who say "the SDK handles grouping" haven't met a 9,000-issue dashboard.

### Q: What failure classes can your crash-free metric NOT see?

Listening for honesty about observability limits: uncatchable OOM kills, ANRs/hangs, launch-crash-then-uninstall (survivorship loss), anything sampled away, crashes on releases your dashboard view filters out. A candidate who treats crash-free rate as ground truth rather than a *lower-bound estimate of one failure class* will be surprised in production.

---

## Cheat Sheet

Top-10 must-know questions for any crash-reporting interview:

```
┌──────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW CRASH-REPORTING QUESTIONS                                  │
├──────────────────────────────────────────────────────────────────────┤
│  1. Lifecycle of a crash report?                                     │
│      → fault → capture → enrich → scrub → queue → upload →           │
│        symbolicate → group → triage                                  │
│                                                                      │
│  2. What is symbolication, and why server-side?                      │
│      → addr→source via uploaded symbols; device is broken/stripped.  │
│                                                                      │
│  3. dSYM / PDB / DWARF / source map / ProGuard — which platform?     │
│      → iOS / Windows / Linux-native / JS / Android.                  │
│                                                                      │
│  4. Why must SDK release == symbol-upload release?                   │
│      → symbolication joins by build identity; mismatch = gibberish.  │
│                                                                      │
│  5. Two grouping failure modes?                                      │
│      → Under (dynamic message → 1000s issues), Over (generic frame). │
│      → Good fingerprint = stable, categorical, NO ids.              │
│                                                                      │
│  6. Why is a signal handler dangerous?                               │
│      → corrupt/interrupted context; only async-signal-safe calls.    │
│      → No malloc/printf/locks/HTTP. Write minidump, upload next run. │
│                                                                      │
│  7. Crash-free sessions vs users?                                    │
│      → sessions = per-run; users = per-person. Alert on both.        │
│      → Count is misleading; normalize per session/user/release.      │
│                                                                      │
│  8. Three layers of PII scrubbing?                                   │
│      → don't collect → beforeSend (allowlist) → server-side.        │
│      → sendDefaultPii:false; hash user id; describe ≠ reveal.        │
│                                                                      │
│  9. Minidump vs core dump?                                           │
│      → minidump = compact (stacks/regs/modules), shippable.          │
│      → core = whole address space; lab-only.                        │
│                                                                      │
│ 10. How do you verify the pipeline works?                            │
│      → synthetic crash + fake PII → assert symbolicated & redacted.  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **Sentry "Debug Information Files" / "Source Maps"** — the canonical symbol-upload reference. <https://docs.sentry.io/platforms/javascript/sourcemaps/>
- **Sentry "Event Grouping"** — how fingerprints and grouping work. <https://docs.sentry.io/concepts/data-management/event-grouping/>
- **Sentry "Scrubbing Sensitive Data"** — `beforeSend`, server-side scrubbers. <https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/>
- **Google Crashpad documentation** — out-of-process capture, minidumps, the handler model. <https://chromium.googlesource.com/crashpad/crashpad/>
- **Mozilla Breakpad / `minidump_stackwalk` & `dump_syms`** — the native symbol workflow. <https://chromium.googlesource.com/breakpad/breakpad/>
- **POSIX async-signal-safe functions** — `man 7 signal-safety` (the list of what's safe in a handler).
- **Firebase Crashlytics "Customize crash reports"** — keys, logs, user IDs, release health. <https://firebase.google.com/docs/crashlytics/customize-crash-reports>
- **Android R8 retrace / ProGuard mapping** — <https://developer.android.com/build/shrink-code>
- **Apple "Adding identifiable symbol names to a crash report"** — dSYM and symbolication on Apple platforms.
- **GDPR / PCI-DSS primers** — *why* scrubbing is a legal requirement, not a nicety.

---

## Related Topics

- [Crash Reporting — Junior](junior.md)
- [Crash Reporting — Middle](middle.md)
- [Crash Reporting — Senior](senior.md)
- [Crash Reporting — Professional](professional.md)
- [Crash Reporting — Tasks](tasks.md)
- [Debugging — Interview](../debugging/interview.md) — reading stack traces, core dumps, Heisenbugs.
- [Error Handling — Interview](../error-handling/interview.md) — typed/wrapped errors group better and read cleaner.
- [Logging — Interview](../logging/interview.md) — structured logs and correlation IDs that pair with breadcrumbs.
- [Tracing](../tracing/) — `traceparent`/trace IDs that link a crash to its distributed request.
- [Telemetry Cost and Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the cost dimension of crash events.
