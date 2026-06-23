# Crash Reporting — Junior Level

> **Topic:** [Crash Reporting Roadmap](README.md)
> **Focus:** What a crash report is, the anatomy of a captured stack trace, installing your first unhandled-exception handler in each language, and why a minified or stripped trace is useless until it is symbolicated.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Crash vs Error vs Warning](#crash-vs-error-vs-warning)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Anatomy of a Crash Report](#anatomy-of-a-crash-report)
9. [The First Toolkit](#the-first-toolkit)
10. [Code Examples](#code-examples)
11. [Why Symbolication Matters](#why-symbolication-matters)
12. [Pros & Cons of Logging vs Crash Reporting](#pros--cons-of-logging-vs-crash-reporting)
13. [Use Cases](#use-cases)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Tricky Points](#tricky-points)
20. [Test Yourself](#test-yourself)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a crash report, really?** and **What does a beginner wire up so that a crash on a stranger's phone reaches your screen?**

A **crash report** is the machine-generated obituary of a program that died — or of an exception that escaped every handler you wrote. It is *not* a log line you chose to write. It is the runtime saying, on its way down, *"here is exactly where I was, what I was doing, and the chain of calls that led me here."* Crash reporting is the discipline of **catching that obituary automatically, on every machine running your code, and getting it to a place where you can read it.**

The reason this is its own skill — separate from [logging](../logging/junior.md) and [debugging](../debugging/junior.md) — is that the crash you care about almost never happens on *your* machine. It happens on a user's three-year-old Android phone, on a backend pod at 4 a.m. under load you can't reproduce, in a desktop app on an OS locale you've never tested. You will never attach a debugger to it. The *only* artifact you will ever get is the report. So the report has to be complete, it has to arrive reliably, and — critically — it has to be *readable*, which on production builds means it has to be **symbolicated**.

This page covers the day-one version: what's inside a report, how to read a stack trace, how to install the one-line handler in Go, Java, Python, Node, and Rust that turns an uncaught exception into a report, and why the trace `0x4a3f → 0x91b2 → 0x0c10` is worthless until you turn it back into `chargeCard → processOrder → main`. The next level (`middle.md`) covers wiring a real reporter (Sentry, Crashlytics), grouping, breadcrumbs, and scrubbing PII. `senior.md` and `professional.md` cover sampling, crash-free SLOs, and operating the pipeline at scale.

> 🎓 **Why this matters for a junior:** The bugs that hurt most are the ones no user reports. People don't file tickets — they uninstall. A crash reporter is the difference between *"reviews say the app is buggy and we don't know why"* and *"3,412 sessions hit a `NullPointerException` in `CartView.render`, all on Android 9, since v4.2.0."* One of those is a mystery; the other is a ticket you can close before lunch.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to read a stack trace. If a traceback is wallpaper to you, read [`../debugging/junior.md`](../debugging/junior.md) first — crash reports *are* stack traces plus context.
- **Required:** What an exception / panic / error value is in at least one language. See [`../error-handling/junior.md`](../error-handling/junior.md).
- **Required:** Basic command line: running a program, setting an environment variable, installing a package (`pip`, `go get`, `npm install`).
- **Helpful:** The idea of a *build* — that the code you write (`processOrder`) becomes a binary or a minified bundle where that name may be gone or scrambled. Symbolication only makes sense once you've seen that gap.
- **Helpful:** Exposure to a SaaS dashboard (Sentry, Firebase). You don't need an account yet; just know the shape of "errors land in a web UI."

---

## Glossary

| Term | Definition |
|------|-----------|
| **Crash** | The program terminated abnormally — a segfault, an unhandled panic, an uncaught exception that reached the top of the stack, an OOM kill. The process is *gone*. |
| **Unhandled exception** | An exception/error that no `catch`/`recover`/handler intercepted, so it propagated to the runtime's last-resort handler (and usually killed the process). |
| **Crash report** | The structured record of a crash: stack trace + context (OS, app version, device, user, breadcrumbs). The unit of work in this roadmap. |
| **Stack trace** | The ordered list of function calls active at the moment of failure, innermost (where it broke) to outermost (entry point), or vice versa by language. |
| **Frame** | One entry in a stack trace: one function call in progress, ideally with file and line. |
| **Crash reporter / SDK** | The library you embed (Sentry, Crashlytics, Bugsnag) that captures crashes and uploads reports. |
| **Symbolication** | Turning machine addresses or minified names (`0x4a3f`, `a.b.c`) back into human names (`chargeCard`, `cart.js:212`). Needs debug symbols. |
| **Debug symbols** | The mapping from addresses/minified names to source: DWARF (Linux/C/C++/Rust/Go), dSYM (Apple), PDB (Windows), source maps (JS), ProGuard/R8 mapping (Android). |
| **Minified / stripped** | A production build with names removed or shortened to save size — which is exactly why raw production traces are unreadable. |
| **Breadcrumb** | A small recorded event ("user tapped Checkout", "GET /cart 200") logged *before* the crash, giving context to *what led up to it*. (Detail in `middle.md`.) |
| **Fingerprint / grouping** | The key that decides "this crash is the same as that one." Lets the dashboard show *1 issue × 3,412 events* instead of 3,412 separate items. (Detail in `middle.md`.) |
| **Release** | The version of your app a crash came from (`v4.2.0`, git SHA). Crashes are meaningless until tied to a release. |
| **PII** | Personally Identifiable Information — emails, names, tokens. Must be kept *out* of reports. (Detail in `middle.md`.) |
| **Panic** | Go/Rust term for an unrecoverable runtime fault. In Go, recoverable via `recover()`; in Rust, via a panic hook or `catch_unwind`. |

---

## Core Concepts

### 1. A Crash Report Is an Obituary, Not a Log

A log line is something *you* decided to write, in advance, because you guessed you might want it. A crash report is something the *runtime* writes, automatically, because something you did *not* anticipate just killed the program. You cannot `console.log` a bug you didn't know existed. That is the whole point of crash reporting: it catches the *unknown unknowns* — the exceptions you never wrote a handler for.

### 2. The Crash You Care About Is on Someone Else's Machine

Internalize this early. You will rarely debug a production crash by reproducing it. The user is gone, the state is gone, the device is in a pocket on another continent. **The report is all you get.** Everything in this roadmap exists to make that one artifact as rich and as reliably delivered as possible — because there is no second chance to collect it.

### 3. Capture Has to Be Automatic and Total

If catching crashes depended on you remembering to wrap every function in `try/catch`, you'd miss the ones that matter — the ones in code you forgot about. The correct design installs **one global handler** at the top of the program that catches *anything* that escapes everything else. One handler, installed once, at startup. That's the spine of capture.

### 4. A Raw Production Trace Is Often Unreadable

Your dev build says `chargeCard (billing.go:88)`. Your *production* build — stripped to ship smaller, minified to load faster, obfuscated to deter reverse-engineering — says `0x000000010a3f` or `t.n.a (bundle.js:1:90412)`. Same crash, useless trace. **Symbolication** is the step that maps it back. Skipping it is the single most common reason teams stare at crash dashboards full of gibberish.

### 5. A Crash Is Worthless Without Its Release

`NullPointerException in CartView` tells you almost nothing. `NullPointerException in CartView, only on v4.2.0, started 2 hours ago` tells you *which deploy broke it* and lets you roll back. Always tag the report with the app version. We'll go deeper in `senior.md`; for now, just know: **untagged crashes are noise.**

### 6. Volume ≠ Severity (Dedup First)

The same crash can fire ten thousand times in a minute. You do *not* want ten thousand dashboard entries — you want **one entry that says it happened ten thousand times.** That collapse is **deduplication / grouping**, and it's what separates a usable crash tool from a firehose. Junior takeaway: a good reporter groups by default; a naive "log it" approach drowns you.

---

## Crash vs Error vs Warning

Not everything is worth a crash report. Confusing these three is how dashboards become unusable.

| Class | What it is | Reach the crash reporter? |
|---|---|---|
| **Warning** | Something suboptimal but handled: a deprecated API, a retried request, a slow query. | No. Goes to logs/metrics. |
| **Handled error** | An error your code *expected and dealt with*: a 404, a validation failure, a network timeout you retried. | Usually no — it's normal operation. Optionally captured as a "handled exception" if it's surprising. |
| **Unhandled exception / crash** | An error that escaped *every* handler and reached the runtime. The program was about to die (or did). | **Yes.** This is the core target of crash reporting. |
| **Panic / fatal** | An unrecoverable runtime fault (segfault, OOM, Go panic, Rust panic). | **Yes**, with highest priority. |

The mental rule: **report what you did not expect.** A timeout you retried is a warning. A timeout that threw an exception nobody caught is a crash. The first belongs in metrics; the second belongs in your face.

> Caveat for `middle.md`/`senior.md`: many SDKs let you *also* capture "handled" exceptions deliberately (`captureException(e)` after a `catch`). That's useful for "this shouldn't happen but I survived it" cases. The discipline is the same: capture the *surprising*, not the *routine*.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Crash report** | A flight data recorder ("black box") — survives the crash, records the final moments for investigators who weren't on board. |
| **Unhandled-exception handler** | The catch-net under a trapeze. You hope no one falls, but it's there for everyone, every time, automatically. |
| **Stack trace** | A trail of breadcrumbs through the forest, showing the exact path taken to where someone got lost. |
| **Symbolication** | Translating coordinates `(40.7N, 74.0W)` back into "Manhattan." The numbers were always correct — they were just unreadable. |
| **Debug symbols (dSYM/PDB)** | The codebook that decodes an encrypted message. Without it, the intercept is gibberish. |
| **Breadcrumbs** | The security-camera footage from the minutes *before* the incident, not just the moment of impact. |
| **Deduplication** | A hospital admitting "47 people with the same food poisoning" as *one outbreak*, not 47 unrelated cases. |
| **Release tagging** | The lot number on a recalled product — tells you exactly which batch is poisoned. |
| **Crash-free rate** | A restaurant's "no one got sick this week" percentage — the single number that says "are we okay?" |

---

## Mental Models

### 1. The Funnel: Many Crashes In, Few Issues Out

Picture a funnel. At the wide top, thousands of raw crash *events* pour in from every device. As they fall, identical ones merge (grouping), trivial ones get sampled out, PII gets scrubbed. At the narrow bottom, a handful of distinct *issues* land on your dashboard, each labeled with how often it happened, which release, which devices. Crash reporting is that funnel. A junior who thinks "more events = more information" has the funnel upside down.

### 2. The Two Halves: Capture and Symbolicate

Every crash-reporting system has two jobs that happen at different times:

- **Capture** (on the user's device, at crash time): grab the stack, the context, queue it for upload.
- **Symbolicate** (on the server, after upload): take the raw addresses and the debug symbols *you uploaded at build time* and produce a readable trace.

These are separate because the device usually doesn't *have* the symbols (they're huge, and shipping them would leak your source). The device sends raw addresses; the server holds the codebook. If you forget to upload symbols at build time, capture still works — but every trace is gibberish forever, because the codebook for *that build* is gone.

### 3. The Report Is the Repro

In normal debugging, the first step is "reproduce it." In crash reporting, you often *can't* — so the report has to *be* the reproduction. The richer the report (stack + OS + version + breadcrumbs + the input that triggered it), the closer you get to "I can see exactly what happened without ever running it." Every field you add to a report is a question you won't have to ask the (long-gone) user.

---

## Anatomy of a Crash Report

A real crash report is a stack trace surrounded by context. Here's the shape, annotated:

```text
┌─ EXCEPTION ────────────────────────────────────────────────┐
│ TypeError: Cannot read properties of null (reading 'total')│  ← type + message
├─ STACK TRACE ──────────────────────────────────────────────┤
│   at renderCart        (CartView.tsx:212:18)   ← innermost  │  ← where it broke
│   at OrderPage         (OrderPage.tsx:88:7)                 │
│   at mountComponent    (react-dom.js:1840:5)                │  ← library frame
│   at main              (index.tsx:14:1)        ← outermost  │  ← entry point
├─ CONTEXT ──────────────────────────────────────────────────┤
│ release:    v4.2.0 (build 5510, sha a1b2c3d)   ← which deploy│
│ environment: production                                     │
│ os:         iOS 17.4 / device iPhone13,2                    │
│ user:       id=u_8831 (hashed; no email!)      ← no PII     │
├─ BREADCRUMBS (most recent last) ───────────────────────────┤
│ 12:03:41  navigation   /products → /cart                   │  ← what led up to it
│ 12:03:48  http         GET /api/cart  200  120ms           │
│ 12:03:49  ui.click     button#checkout                     │
│ 12:03:49  ← CRASH                                          │
└────────────────────────────────────────────────────────────┘
```

Read it the way you read any trace ([`../debugging/junior.md`](../debugging/junior.md)): start at the exception, find the innermost *your-code* frame (`renderCart`), and look there first. The context tells you *who* and *where*; the breadcrumbs tell you *what they were doing*. Notice what is **not** there: no email, no password, no card number. That omission is deliberate and covered in `middle.md`.

---

## The First Toolkit

Your day-one crash-reporting toolkit is small:

1. **Install one global handler** per process that catches anything uncaught.
2. **Format the captured exception** into type + message + stack.
3. **Attach the release version** so the crash is tied to a deploy.
4. **Send it somewhere** — at first, just `stderr` or a file; later, a real SDK.
5. **Symbolicate** when the build is stripped/minified (so the trace is readable).
6. **Read the report** like a stack trace: innermost-your-code frame first.

The handler is the spine. Everything else is enrichment. Let's wire the handler in every language.

---

## Code Examples

The same idea — *install a last-resort handler, turn the uncaught failure into a report* — in each language the README names.

### Python — `sys.excepthook`

`sys.excepthook` is Python's global hook for uncaught exceptions. The runtime calls it instead of printing the default traceback.

```python
# crash_reporter.py
import sys
import traceback
import platform

APP_VERSION = "4.2.0"

def report_crash(exc_type, exc_value, exc_tb):
    # In real life this POSTs to Sentry/your backend. Here we format it.
    report = {
        "type": exc_type.__name__,
        "message": str(exc_value),
        "stack": "".join(traceback.format_exception(exc_type, exc_value, exc_tb)),
        "release": APP_VERSION,
        "python": platform.python_version(),
        "os": platform.platform(),
    }
    # send(report)  <-- upload to your crash backend
    print("=== CRASH REPORT ===")
    for k in ("type", "message", "release", "os"):
        print(f"{k}: {report[k]}")
    print(report["stack"], file=sys.stderr)

sys.excepthook = report_crash

def charge(order):
    return order["price"] * order["qty"]   # KeyError if "price" missing

if __name__ == "__main__":
    charge({"qty": 2})   # boom: KeyError 'price'
```

> **Threading gotcha:** `sys.excepthook` only fires for the main thread. For threads, set `threading.excepthook` (Python 3.8+). For `asyncio`, set a loop exception handler. A "global" handler is only global if you cover every place exceptions can escape.

### Go — `recover()` then report, plus the panic fallback

Go has no exceptions; it has **panics**. A panic that reaches the top of a goroutine crashes the program. You catch it with `recover()` inside a deferred function — but only in the *same goroutine*.

```go
// crashreport.go
package main

import (
	"fmt"
	"os"
	"runtime/debug"
)

const appVersion = "4.2.0"

func reportPanic(r any) {
	// In real life: send to Sentry via sentry-go's recover integration.
	fmt.Fprintln(os.Stderr, "=== CRASH REPORT ===")
	fmt.Fprintf(os.Stderr, "panic: %v\n", r)
	fmt.Fprintf(os.Stderr, "release: %s\n", appVersion)
	fmt.Fprintf(os.Stderr, "stack:\n%s\n", debug.Stack())
}

// guard wraps a unit of work so a panic becomes a report, not a crash.
func guard(work func()) {
	defer func() {
		if r := recover(); r != nil {
			reportPanic(r)
		}
	}()
	work()
}

func charge(order map[string]int) int {
	return order["price"] * order["qty"]
}

func main() {
	guard(func() {
		// Real panic: nil map write, index OOB, etc. Here, force one:
		var orders []map[string]int
		_ = charge(orders[3]) // index out of range -> panic
	})
	fmt.Println("survived; report was sent")
}
```

> **The goroutine trap (critical):** `recover()` only catches panics in *its own* goroutine. A panic in a bare `go func(){ ... }()` with no deferred recover **crashes the whole process**, full stop. Every goroutine you spawn needs its own guard. This is the #1 Go crash-reporting mistake. See [`../panic-and-recovery/`](../panic-and-recovery/).

### Java / Kotlin — `Thread.setDefaultUncaughtExceptionHandler`

The JVM gives every thread a last-resort handler. Set the *default* one and you cover threads that don't override it.

```java
// CrashReporter.java
public final class CrashReporter {
    static final String APP_VERSION = "4.2.0";

    public static void install() {
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            // Real impl: hand to Sentry/Crashlytics SDK.
            System.err.println("=== CRASH REPORT ===");
            System.err.println("thread:  " + thread.getName());
            System.err.println("type:    " + throwable.getClass().getName());
            System.err.println("message: " + throwable.getMessage());
            System.err.println("release: " + APP_VERSION);
            // Full stack, including the "Caused by:" chain:
            throwable.printStackTrace(System.err);
        });
    }

    public static void main(String[] args) {
        install();
        int[] xs = new int[3];
        System.out.println(xs[5]); // ArrayIndexOutOfBoundsException -> handler fires
    }
}
```

> On Android, you usually let Crashlytics/Sentry chain its handler in *front* of yours so it can capture, then still call the previous handler. Don't blindly replace an existing handler — *wrap* it. (More in `middle.md`.)

### Node.js — `uncaughtException` and `unhandledRejection`

Node has **two** escape routes you must cover: synchronous throws (`uncaughtException`) and rejected promises nobody `.catch`-ed (`unhandledRejection`). Miss the second and async crashes vanish silently.

```js
// crash-reporter.js
const APP_VERSION = "4.2.0";

function report(kind, err) {
  // Real impl: Sentry.captureException(err)
  console.error("=== CRASH REPORT ===");
  console.error("kind:    ", kind);
  console.error("type:    ", err && err.name);
  console.error("message: ", err && err.message);
  console.error("release: ", APP_VERSION);
  console.error(err && err.stack);
}

process.on("uncaughtException", (err) => {
  report("uncaughtException", err);
  process.exit(1); // a process in an unknown state should not keep serving
});

process.on("unhandledRejection", (reason) => {
  report("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)));
});

// Sync crash:
JSON.parse("{ not valid json");           // throws -> uncaughtException

// Async crash (no .catch):
Promise.reject(new Error("db connection lost")); // -> unhandledRejection
```

> **Why `process.exit(1)` after an uncaught exception?** After an uncaught throw, Node's state is undefined — half-finished work, leaked handles. The honest move is to report, then exit and let your supervisor (systemd, Kubernetes) restart a clean process. Limping along corrupts data. More on this in `senior.md`.

### Rust — the panic hook

Rust's `std::panic::set_hook` installs a global callback that runs on *every* panic, before the program unwinds or aborts.

```rust
// src/main.rs
use std::panic;

const APP_VERSION: &str = "4.2.0";

fn install_crash_handler() {
    panic::set_hook(Box::new(|info| {
        // Real impl: sentry::integrations::panic forwards this upstream.
        eprintln!("=== CRASH REPORT ===");
        eprintln!("release: {APP_VERSION}");
        // `info` gives the panic message and the location (file:line).
        if let Some(loc) = info.location() {
            eprintln!("location: {}:{}", loc.file(), loc.line());
        }
        eprintln!("payload: {info}");
        // A real backtrace needs RUST_BACKTRACE=1 and the `backtrace` crate.
    }));
}

fn charge(prices: &[u32], idx: usize) -> u32 {
    prices[idx] // panics on out-of-bounds
}

fn main() {
    install_crash_handler();
    let prices = vec![100, 200, 300];
    println!("{}", charge(&prices, 9)); // index out of bounds -> hook fires
}
```

> The hook fires *whether or not* the panic is later caught by `catch_unwind`. To get file/line and a real backtrace symbolicated, you also need debug info in the binary (don't fully strip) and `RUST_BACKTRACE=1`. More in `professional.md`.

---

## Why Symbolication Matters

Here is the entire argument for symbolication in one before/after. A minified JavaScript production crash arrives looking like this:

```text
TypeError: undefined is not an object (evaluating 'n.total')
    at t (https://app.example.com/static/main.4f9c.js:1:90412)
    at o (https://app.example.com/static/main.4f9c.js:1:88210)
    at https://app.example.com/static/main.4f9c.js:1:1204
```

That is *technically* a stack trace. It is also *completely useless* — `t`, `o`, "line 1 column 90412" tell you nothing. The build minified `renderCart` into `t` and collapsed the file to one line.

Now apply the **source map** (`main.4f9c.js.map`, generated at build time):

```text
TypeError: Cannot read properties of undefined (reading 'total')
    at renderCart   (src/components/CartView.tsx:212:18)
    at OrderPage    (src/pages/OrderPage.tsx:88:7)
    at main         (src/index.tsx:14:1)
```

*Now* you can fix it. Same crash, same bytes on the wire — the only difference is whether you uploaded the source map so the server could decode it.

| Platform | What ships to users | The "codebook" you must keep/upload |
|---|---|---|
| **JavaScript (web/Node)** | Minified bundle (`main.4f9c.js`) | **Source map** (`.js.map`) |
| **Android (Java/Kotlin)** | R8/ProGuard-obfuscated APK | **`mapping.txt`** (ProGuard/R8 mapping) |
| **iOS / macOS (Swift/ObjC)** | Stripped binary | **`.dSYM`** files |
| **Windows (C/C++/.NET)** | Stripped `.exe`/`.dll` | **`.pdb`** files |
| **Linux / Go / Rust / C++** | Stripped binary | **DWARF** debug info (kept binary or split debug file) |

The iron rule: **the codebook is generated at build time and is unique to that build.** Lose it, and every crash from that build is permanently unreadable. So uploading symbols is a *build step*, not an afterthought. (Wiring the upload is the job of `middle.md`.)

---

## Pros & Cons of Logging vs Crash Reporting

A junior often asks: *"I already have logs — why do I need a crash reporter?"* Here's the honest comparison.

| Aspect | Logging | Crash Reporting |
|---|---|---|
| **What it captures** | Whatever you wrote in advance | The unexpected — exceptions you never anticipated |
| **Grouping** | None — every line is separate; you `grep` | Automatic — identical crashes collapse into one issue |
| **First occurrence** | Buried among millions of lines | Surfaced and timestamped: "first seen in v4.2.0" |
| **Stack + context** | Only if you logged it | Always: full stack, OS, device, release, breadcrumbs |
| **Symbolication** | You're on your own | Built in, given uploaded symbols |
| **Cost model** | Pay per byte; crashes are a fraction | Pay per event/issue; cheap because of dedup |
| **Best for** | "What did the code *say*?" | "What *broke*, how often, on which release?" |

They are complementary, not rivals. Logs and breadcrumbs *enrich* a crash report; the crash report *frames* the logs. See [`../logging/junior.md`](../logging/junior.md). The wrong move is "I'll just log exceptions and grep them" — that's a firehose with no grouping, no symbolication, and no first-occurrence signal.

---

## Use Cases

| Situation | What crash reporting gives you |
|---|---|
| Mobile app, 1-star reviews say "crashes a lot," no detail | The exact crash, count, OS/device breakdown, and release it started in |
| Backend service panicking intermittently in production | The panic stack + the request/breadcrumbs that led to it, without reproducing |
| Desktop app crashing on machines you don't own | A minidump/report uploaded on next launch, even though the app died |
| You shipped a release and want to know if it's healthy | Crash-free rate per release; a regression jumps out (covered in `senior.md`) |
| A library you depend on throws deep in its own code | The full stack up to *your* call site, so you see how you triggered it |

---

## Coding Patterns

### Pattern 1 — Install the Handler First, Before Anything Can Fail

```python
# main.py — the FIRST thing main does
import crash_reporter   # sets sys.excepthook on import
crash_reporter.install()   # before config load, before DB connect — anything can crash
```

If you install the handler *after* your config loader, a crash *in* the config loader escapes uncaught. Initialize crash reporting as the very first line of `main`.

### Pattern 2 — Wrap Every Goroutine / Thread / Async Boundary

```go
func spawn(name string, work func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				reportPanic(r) // never let a goroutine die silently
			}
		}()
		work()
	}()
}
```

A global handler is only global if it covers every escape route. Bare `go func()`, raw threads, and uncaught promise rejections are the leaks.

### Pattern 3 — Always Tag the Release

```js
const event = {
  exception: err,
  release: process.env.APP_VERSION || "unknown", // never "unknown" in prod
  environment: process.env.NODE_ENV,
};
```

An untagged crash is a crash you can't roll back from. Bake the version (or git SHA) into the build and stamp every report.

### Pattern 4 — Capture, Then Re-Raise (for "Handled but Surprising")

```python
try:
    risky()
except UnexpectedError as e:
    crash_reporter.capture(e)  # tell the dashboard
    raise                       # but don't swallow — let it propagate
```

Capturing an exception is *not* the same as handling it. Report it, then decide separately whether to recover or re-raise. Swallowing-to-report is how bugs hide. See [`../error-handling/junior.md`](../error-handling/junior.md).

---

## Clean Code

- **Install crash reporting at the very top of `main`**, before any other initialization. A crash before the handler is installed is a crash you'll never see.
- **Never `catch (e) {}` to silence a crash.** A bare catch that does nothing is a deleted crash report. If you catch, either handle meaningfully or `capture(e)` and re-raise.
- **Tag every build with a version/SHA at compile time** (linker flag, env var, build constant) — not hand-typed, not "unknown."
- **Keep PII out of reports from day one.** Don't log the email into the breadcrumb "for convenience"; you'll regret it. (Scrubbing detail in `middle.md`.)
- **Treat symbol upload as part of the build, not a manual step.** If a human has to remember to upload the dSYM, some builds won't have one.
- **Don't fork your own crash format when a battle-tested SDK exists.** Sentry/Crashlytics handle offline queueing, retries, and grouping you'll get wrong by hand. The hand-rolled examples above are for *understanding*, not production.

---

## Best Practices

1. **Cover every capture surface.** Main-thread handler *and* thread/goroutine handler *and* async/promise handler. List them per language; verify each fires.
2. **Symbolicate production builds.** Upload source maps / dSYM / mapping.txt / PDB on every release build. Verify by reading a real report's trace — if it's gibberish, the symbols didn't upload.
3. **Tag release + environment** on every report. No exceptions.
4. **Add breadcrumbs for the big events** — navigation, network calls, key user actions. They turn "it crashed" into "it crashed right after checkout." (Detail in `middle.md`.)
5. **Exit after an uncaught exception in a server** rather than limping; let the supervisor restart a clean process.
6. **Scrub PII before sending.** Hash user IDs; never send emails, tokens, card numbers.
7. **Read your dashboard weekly even when nothing's on fire.** A slow-rising new crash is easier to fix at 50 occurrences than at 50,000.
8. **Test the pipeline by triggering a fake crash** in staging and confirming it arrives, symbolicated, tagged. A crash reporter you've never seen fire is a crash reporter that doesn't work.

---

## Edge Cases & Pitfalls

- **The crash that happens before the handler installs** — config load, static initializers, module top-level code. Install as early as physically possible.
- **The handler itself crashes.** If your `reportCrash` does network I/O and *that* throws, you can loop or lose the report. Keep the handler dead simple; queue to disk, upload later.
- **Out-of-memory crashes** can't allocate to build a report. Native reporters pre-allocate buffers for exactly this; pure-language handlers often can't capture an OOM. (Covered in `professional.md`.)
- **A stack overflow** leaves no stack to walk. Some handlers run on an alternate signal stack to survive it.
- **Goroutine/async leaks** (Go, Node): the most common silent crash. A panic in an uncovered goroutine kills the process with *no report* if you only set the main handler.
- **Stripped builds with no uploaded symbols** = permanently unreadable traces. The symbols for that build are gone; you can't regenerate them later.
- **Clock skew on the device** makes the report's timestamp wrong. Prefer the server receive-time for ordering.
- **Crashes in offline mode** (mobile/desktop) need on-device queueing and upload-on-next-launch — or they're lost. (Detail in `senior.md`.)

---

## Common Mistakes

1. **Only setting the main-thread handler.** The crash hides in a goroutine, worker thread, or unhandled promise rejection — and never reaches you.
2. **Shipping stripped/minified builds without uploading symbols.** The dashboard fills with `0x4a3f` and `t.n.a`. Useless.
3. **Forgetting to tag the release.** Every crash looks the same; you can't tell which deploy broke things or whether your fix worked.
4. **Swallowing exceptions to "stop the crash."** `catch (e) {}` doesn't fix the bug — it deletes the evidence and lets corrupt state spread. See [`../error-handling/junior.md`](../error-handling/junior.md).
5. **Treating crash reports like logs** — no grouping, just dumping every event into a log stream and grepping. You drown.
6. **Putting PII in the report** — email in the user field, full request body in a breadcrumb. Now your crash backend is a compliance liability.
7. **Letting a Node server keep running after `uncaughtException`** in an unknown state, corrupting data, instead of reporting and restarting.
8. **Never verifying the pipeline.** Wiring it up and *assuming* it works. Trigger a test crash and confirm it lands, readable.
9. **Reusing dev symbols for a prod build.** Symbols are per-build; the wrong dSYM symbolicates to the wrong lines, which is worse than no symbols.
10. **Capturing handled errors at full volume.** Reporting every 404 and timeout buries the real crashes. Report the *surprising*, not the routine.

---

## Tricky Points

1. **`recover()` is per-goroutine in Go.** A deferred recover in `main` will *not* catch a panic in a goroutine you spawned. Each goroutine needs its own. This trips up nearly everyone.
2. **Node has two handlers, not one.** `uncaughtException` (sync) and `unhandledRejection` (async). Promise-based crashes only fire the second; cover both.
3. **`sys.excepthook` ignores threads.** Use `threading.excepthook` (3.8+) and an `asyncio` loop handler too. "Global" is a lie unless you cover all three.
4. **Symbols are build-specific and one-way.** You can't symbolicate a v4.2.0 crash with v4.3.0's symbols. Upload per build; keep them.
5. **A panic and an exception are not the same severity.** A Go panic / segfault means the process is dying; a caught exception you chose to report means it survived. The reporter should distinguish them.
6. **Capturing ≠ handling.** `captureException(e)` tells the dashboard; it does *not* recover the program. You still must decide whether to re-raise.
7. **The "Caused by:" chain matters.** Java/Python wrap exceptions; the *root* cause is the deepest link. A report that drops the chain hides the real bug. See [`../debugging/junior.md`](../debugging/junior.md).
8. **`debug.Stack()` in Go captures the *current* goroutine's stack**, not all of them. For a full picture you need the runtime's crash dump — but for *your* recovered panic, the current stack is what you want.

---

## Test Yourself

For your own honest assessment — no answer key.

1. Take a small program of yours. Install the global uncaught-exception handler for its language. Force a crash (index out of bounds). Confirm your handler — not the default printer — produced the output.
2. In Go (or Node), spawn a goroutine/promise that panics/rejects *without* a recover/catch. Watch the process die with no report. Now add per-goroutine/per-promise coverage and watch the report appear. Feel the difference.
3. Build your program in release/stripped mode. Crash it. Read the trace. Is it readable? If not, you've just experienced *why* symbolication exists.
4. Sketch the anatomy of a crash report from memory: exception, stack, context, breadcrumbs. Which fields are PII you must *not* include?
5. Classify ten recent errors from a real log: which are warnings, which are handled errors, which are true crashes? Only the last group belongs in a crash reporter.
6. Tag a build with its git SHA at compile time (linker flag / env var). Crash it. Confirm the SHA appears in the report.
7. Explain to a teammate, in one sentence each, the difference between a crash report and a log line, and why you need both.

---

## Tricky Questions

**Q1: You set `sys.excepthook` / the default uncaught handler, but a crash in a background thread still killed the app silently. Why?**

Because the global hook only covers the *main* thread. Threads have their own escape route. In Python, set `threading.excepthook`; on the JVM, the *default* uncaught handler does cover threads (use `setDefaultUncaughtExceptionHandler`, not the per-thread one); in Go, each goroutine needs its own deferred `recover`. "Global" is only as global as the surfaces you wired.

**Q2: Your production crash dashboard is full of entries like `at t (main.js:1:90412)`. Capture is clearly working. What's broken?**

Symbolication. Capture grabbed the trace from the *minified* build, but you never uploaded the source map, so the server can't decode `t` back to `renderCart`. Fix the build to upload the `.js.map` (or dSYM / mapping.txt) on every release. The crashes were always readable in principle — you just threw away the codebook.

**Q3: A teammate "fixed the crashes" by wrapping the risky code in `try/catch` with an empty body. Did they fix anything?**

No — they *deleted the crash report*. The bug still happens; now it happens silently, the program continues with bad state, and the real failure surfaces later somewhere unrelated and unrecoverable. Either handle the exception meaningfully or `capture(e)` and re-raise. An empty catch is sedation, not surgery.

**Q4: Why is `release` such an important field on a crash report? It's just a version string.**

Because it answers the two questions you'll always ask: *"which deploy introduced this?"* (so you can roll back) and *"did my fix actually work?"* (the crash count should drop to zero after the release containing the fix). Without it, every crash is contextless and you can't connect cause (a deploy) to effect (a spike). See `senior.md` on release health.

**Q5: Your Node server caught an `uncaughtException`, reported it, and kept running. Is that the right call?**

Usually no. After an uncaught exception, the process is in an undefined state — half-completed work, possibly corrupt in-memory data. The safe pattern is: report, flush, `process.exit(1)`, and let your supervisor restart a clean process. Staying up risks serving wrong data to users. (Handled-error recovery is different; this is for the *uncaught* case.)

**Q6: A crash report shows a stack trace entirely inside a third-party library. Is the bug in the library?**

Probably not — same logic as reading any stack trace. Walk *up* the trace until you reach *your* code. The likely cause is that you called the library with input it didn't expect. The breadcrumbs and the surrounding frames usually show how you got there. Only after ruling out your call site should you suspect a real library bug.

**Q7: What's the difference between deduplication and sampling, and why do you need the first more than the second as a junior?**

Deduplication *merges identical crashes* into one issue so 10,000 occurrences show as one entry — you almost always want this on. Sampling *drops some events on purpose* to control cost/volume (a `senior.md` concern). As a junior on a small app you rarely need sampling, but you *always* need dedup, or your dashboard is unreadable from day one.

---

## Cheat Sheet

```text
┌─────────────────────────── CRASH REPORTING — JUNIOR CHEAT SHEET ───────────────────────────┐
│                                                                                            │
│  WHAT IT IS                                                                                │
│    Crash report = stack trace + context, captured AUTOMATICALLY when an exception/panic    │
│    escapes every handler. The runtime's obituary. Your only artifact from a far-off crash. │
│                                                                                            │
│  CRASH vs ERROR vs WARNING                                                                 │
│    Warning  → logs/metrics            (suboptimal, handled)                                │
│    Error    → usually logs            (expected, handled: 404, retry)                      │
│    UNHANDLED/PANIC → CRASH REPORTER    (surprising, escaped everything)                    │
│                                                                                            │
│  INSTALL THE GLOBAL HANDLER (cover EVERY surface)                                          │
│    Python:  sys.excepthook  +  threading.excepthook  +  asyncio loop handler              │
│    Go:      defer recover() in EACH goroutine (recover is per-goroutine!)                  │
│    Java:    Thread.setDefaultUncaughtExceptionHandler(...)                                 │
│    Node:    process.on('uncaughtException') AND process.on('unhandledRejection')          │
│    Rust:    std::panic::set_hook(...)                                                      │
│                                                                                            │
│  ANATOMY                                                                                   │
│    exception (type+msg) · stack (innermost-your-code first) · context (release/os/device)  │
│    · user (HASHED, no PII) · breadcrumbs (what led up to it)                               │
│                                                                                            │
│  SYMBOLICATION — keep the codebook PER BUILD                                               │
│    JS → .js.map   Android → mapping.txt   iOS → .dSYM   Windows → .pdb   Go/Rust → DWARF   │
│    Raw prod trace = gibberish (0x4a3f / t.n.a) until symbolicated. Upload at BUILD time.   │
│                                                                                            │
│  GOLDEN RULES                                                                              │
│    • Install the handler FIRST, before anything can crash.                                 │
│    • Tag every report with the RELEASE/SHA.                                                │
│    • Never catch-and-swallow — that deletes the report.                                    │
│    • Keep PII OUT.                                                                          │
│    • Verify the pipeline: trigger a test crash, confirm it lands readable.                 │
│    • Dedup is mandatory; sampling is later.                                                │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **crash report** is the runtime's automatic record of a failure that escaped every handler: stack trace + context. It is the *only* artifact you get from a crash on someone else's machine.
- Crash reporting catches **unknown unknowns** — exceptions you never anticipated — which is why it's distinct from [logging](../logging/junior.md) (what you chose to record) and [debugging](../debugging/junior.md) (reproducing locally).
- Classify before you report: **warnings and handled errors** go to logs/metrics; **unhandled exceptions and panics** go to the crash reporter. Report the *surprising*, not the routine.
- **Capture is total and automatic**: install one global handler per process, at the top of `main`, covering *every* surface — main thread, worker threads/goroutines, and async/promise rejections.
- Per language: `sys.excepthook` (+ `threading.excepthook`) in Python; per-goroutine `recover()` in Go; `Thread.setDefaultUncaughtExceptionHandler` on the JVM; `uncaughtException` **and** `unhandledRejection` in Node; `panic::set_hook` in Rust.
- A raw **production trace is unreadable** (`0x4a3f`, `t.n.a`) until **symbolicated** with the build-specific codebook: source map / dSYM / PDB / ProGuard mapping / DWARF. Upload symbols at build time, every build, or the trace is gibberish forever.
- A crash report's **anatomy**: exception, stack (read innermost-your-code first), context (release, OS, device), hashed user, and breadcrumbs (what led up to it). Keep **PII out**.
- Always **tag the release** — it's how you find which deploy broke things and whether your fix worked.
- **Dedup** so 10,000 identical crashes become one issue; never treat crashes like ungrouped log lines.
- **Verify the pipeline** by triggering a real crash and confirming it arrives, symbolicated and tagged. An untested reporter is a non-functioning reporter.

---

## What You Can Build

- A **minimal crash reporter library** for one language: installs the global handler(s), formats the exception into type + message + stack + release, and writes a JSON report to a file. Then make it cover *every* surface (threads/goroutines/promises) and prove each fires.
- A **"surface coverage" test harness**: a program that deliberately crashes the main thread, a worker thread, and an async task, and asserts that all three produced a report. Run it in CI so a regression that loses goroutine coverage gets caught.
- A **symbolication demo**: ship a minified JS bundle + its source map. Crash it, capture the raw `t.n.a` trace, then write a tiny script using the `source-map` library to resolve it back to `renderCart (CartView.tsx:212)`. Seeing it click is the lesson.
- A **crash-vs-log classifier** worksheet: take 50 real log lines and sort each into warning / handled-error / crash. Calibrate your instinct for what belongs in a reporter.
- A **release-tagging build step**: a Makefile/CI snippet that injects the git SHA into the binary at compile time and prints it on crash. Now every report is rollback-actionable.

---

## Further Reading

- **Docs (read once, refer often)**
  - Sentry "Getting Started" for your platform — the canonical modern flow. <https://docs.sentry.io/>
  - Firebase Crashlytics "Get started" — the mobile reference. <https://firebase.google.com/docs/crashlytics>
  - Python `sys.excepthook` / `threading.excepthook` — <https://docs.python.org/3/library/sys.html#sys.excepthook>
  - Node "Uncaught Exceptions" — <https://nodejs.org/api/process.html#event-uncaughtexception>
  - Go `runtime/debug.Stack` and panic/recover — <https://pkg.go.dev/runtime/debug>
  - Rust `std::panic::set_hook` — <https://doc.rust-lang.org/std/panic/fn.set_hook.html>
- **Concepts**
  - "What are source maps?" (web.dev) — why minified traces need them.
  - ProGuard/R8 retrace docs (Android) — deobfuscating mobile stacks.
- **Adjacent**
  - [`../debugging/junior.md`](../debugging/junior.md) — reading stack traces is the prerequisite skill.
  - [`../error-handling/junior.md`](../error-handling/junior.md) — why swallowing exceptions deletes crash reports.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — wiring a real reporter, grouping/fingerprinting, breadcrumbs & context, symbol upload, PII scrubbing.
- **Senior level:** [senior.md](senior.md) — sampling, crash-free-rate SLOs, release health, dedup strategy, signal-handler safety, mobile vs backend.
- **Professional level:** [professional.md](professional.md) — building/operating crash pipelines at scale, async-signal-safety, minidumps, symbol servers, cost.
- **Interview prep:** [interview.md](interview.md) — questions you'll be asked about crash reporting.
- **Practice:** [tasks.md](tasks.md) — graduated hands-on labs.

**Sibling diagnostic topics:**

- [Error Handling — Junior](../error-handling/junior.md) — handled vs unhandled; why an empty catch deletes a report.
- [Logging — Junior](../logging/junior.md) — logs and breadcrumbs enrich a crash report.
- [Debugging — Junior](../debugging/junior.md) — reading the stack trace inside the report.
- [Panic and Recovery](../panic-and-recovery/) — the Go/Rust mechanics behind capture.
- [Post-Mortem Analysis](../post-mortem-analysis/) — the *human* process *after* a crash (distinct from the automated capture here).

**Cross-roadmap links:**

- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — clean error handling makes crashes rarer and reports cleaner.

---

## Diagrams & Visual Aids

### The Crash-Reporting Flow (junior view)

```text
   USER'S DEVICE                          YOUR BACKEND / SAAS
 ┌───────────────────┐                  ┌──────────────────────┐
 │  code runs        │                  │                      │
 │     │             │                  │                      │
 │     ▼             │   raw report     │   symbolicate using  │
 │  EXCEPTION ───────┼─── (addresses) ──┼─► uploaded symbols   │
 │  escapes handlers │   over network   │   (.map/.dSYM/.pdb)  │
 │     │             │                  │        │             │
 │     ▼             │                  │        ▼             │
 │  GLOBAL HANDLER   │                  │   GROUP identical    │
 │  captures stack   │                  │   crashes (dedup)    │
 │  + context        │                  │        │             │
 │  + release tag    │                  │        ▼             │
 └───────────────────┘                  │   DASHBOARD:         │
                                        │   1 issue × 3,412    │
                                        │   v4.2.0 · iOS 17    │
                                        └──────────────────────┘
```

### What Symbolication Does

```text
   RAW (production build)                SYMBOLICATED (after applying symbols)
   ─────────────────────                ─────────────────────────────────────
   at t  (main.4f9c.js:1:90412)   ──►   at renderCart (CartView.tsx:212:18)
   at o  (main.4f9c.js:1:88210)   ──►   at OrderPage  (OrderPage.tsx:88:7)
   0x000000010a3f                 ──►   at main       (index.tsx:14:1)

   Same bytes on the wire. The only difference: did you upload the codebook?
```

### Coverage Map — Don't Leave a Surface Uncovered

```text
                    ┌─────────────────────────────┐
                    │  GLOBAL UNCAUGHT HANDLER     │
                    └─────────────┬───────────────┘
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
      main thread           worker threads          async / promises
      ✓ excepthook          ✓ threading.excepthook  ✓ unhandledRejection
      ✓ default JVM handler ✓ per-goroutine recover ✓ asyncio loop handler
            │                     │                     │
            └─── miss any one ────┴── and the crash ────┘
                       vanishes with NO report
```

---
