# GODEBUG & `runtime/debug` — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is `GODEBUG`?" and "What can the `runtime/debug` package do for me?"

Go programs run on top of a runtime — the part of Go that schedules goroutines, manages memory, and runs the garbage collector. Most of the time you never think about it; it just works. But occasionally you want to *peek inside* it ("why is the GC running so often?") or *nudge* it ("use less memory, please"). Go gives you two doors into that runtime, and this topic is about both.

The first door is the **`GODEBUG` environment variable**. You set it *outside* your program, before it starts:

```bash
GODEBUG=gctrace=1 ./myserver
```

That one setting makes the runtime print a line every time the garbage collector runs. You did not change a single line of code or recompile anything — you flipped an external switch and the runtime started talking.

The second door is the **`runtime/debug` package**. You import it *inside* your program and call functions:

```go
import "runtime/debug"

debug.SetGCPercent(50)        // run GC more aggressively
debug.SetMemoryLimit(512 << 20) // aim to stay under 512 MiB
```

That is the same kind of control, but programmatic — your code decides, at runtime, how the runtime should behave.

After reading this file you will:
- Understand what `GODEBUG` is and how to set it
- Read a `gctrace=1` line and a `schedtrace` line out loud
- Call the most common `runtime/debug` functions
- Print your binary's build information with `ReadBuildInfo`
- Know the one big rule: `GODEBUG` is read at *startup*, not later

You do **not** yet need the Go 1.21 GODEBUG *compatibility* system, `//go:debug` directives, or `runtime/metrics` counters. Those are middle-level. This file is the moment you say "I want to *see* what the runtime is doing, and *adjust* it a little."

---

## Prerequisites

- **Required:** A working Go installation, 1.19 or newer (`SetMemoryLimit` landed in 1.19). Check with `go version`. For the GODEBUG compatibility material in later files, 1.21+.
- **Required:** Comfort running a Go program from the terminal and setting environment variables (`GODEBUG=... ./prog`).
- **Required:** A rough idea of what a garbage collector does — it reclaims memory you are no longer using. You do not need to know *how*.
- **Helpful:** Having seen a program use "too much memory" or "spend too much time in GC" — the problem these tools help you investigate.
- **Helpful:** Familiarity with the sibling topic [01-runtime-metrics-package](../01-runtime-metrics-package/junior.md), the structured way to read the same runtime numbers.

If `go version` prints `go1.19` or higher, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`GODEBUG`** | An environment variable holding a comma-separated list of `name=value` settings that tweak runtime/stdlib behavior. Read once, at program startup. |
| **`gctrace=1`** | A `GODEBUG` setting that prints one line to stderr every GC cycle, summarising timing and heap sizes. |
| **`schedtrace=N`** | A `GODEBUG` setting that prints a scheduler summary every `N` milliseconds. |
| **`runtime/debug`** | A standard-library package exposing functions to control the GC, set a memory limit, dump stacks, and read build info. |
| **GC (garbage collector)** | The runtime subsystem that frees memory no longer reachable by your program. |
| **`GOGC` / `SetGCPercent`** | The knob controlling how much the heap may grow before the next GC. `GOGC=100` (default) means "let the heap double." |
| **`GOMEMLIMIT` / `SetMemoryLimit`** | A *soft* limit on total memory the runtime targets. The env var and the function set the same thing. |
| **Build info** | Metadata baked into a Go binary: module path, dependency versions, and VCS stamps (commit, time, dirty flag). Read with `debug.ReadBuildInfo()`. |
| **Soft limit** | A target the runtime works hard to respect but does not *guarantee*. It will GC more aggressively rather than crash. |
| **stderr** | Standard error — where the runtime writes its trace output, separate from your program's normal output. |

---

## Core Concepts

### `GODEBUG` is a list of switches, set before the program runs

The value of `GODEBUG` is just text: comma-separated `name=value` pairs.

```bash
GODEBUG=gctrace=1,schedtrace=1000 ./myserver
```

That sets two switches at once: print a GC line every cycle (`gctrace=1`) *and* print a scheduler summary every 1000 ms (`schedtrace=1000`). The runtime reads this string once, when it starts. Setting or changing the variable *after* the program is running does nothing — the program already read it.

You do not recompile. You do not change code. The same binary behaves differently depending on the environment it is launched in. That is the whole appeal: it is a diagnostic dial you can turn on a binary you already shipped.

### Reading a `gctrace=1` line

Turn on `gctrace=1` and you get lines like this on stderr:

```
gc 1 @0.012s 3%: 0.018+1.5+0.005 ms clock, 0.14+0.5/1.4/0+0.040 ms cpu, 4->4->1 MB, 5 MB goal, 8 P
```

Read it left to right:

- `gc 1` — this is GC cycle number 1.
- `@0.012s` — it started 0.012 seconds after the program began.
- `3%` — 3% of total CPU time so far has been spent on GC.
- `0.018+1.5+0.005 ms clock` — wall-clock time in the three GC phases (sweep termination + mark/scan + mark termination).
- `4->4->1 MB` — heap size **before** GC, **at** the start of mark termination, and **live** heap **after**. So the heap was 4 MB, and 1 MB survived.
- `5 MB goal` — the heap-size goal that triggered this GC.
- `8 P` — the number of processors (logical CPUs / `GOMAXPROCS`).

The two numbers you will look at most: the `4->4->1 MB` triple (how big is my live heap?) and the leading `%` (how much CPU is GC eating?).

### `schedtrace` shows the scheduler

```bash
GODEBUG=schedtrace=1000 ./myserver
```

Every second you get a summary like:

```
SCHED 1001ms: gomaxprocs=8 idleprocs=6 threads=12 spinningthreads=1 idlethreads=4 runqueue=0 [0 0 0 0 0 0 0 0]
```

- `gomaxprocs=8` — logical processors available to the scheduler.
- `idleprocs=6` — how many were idle at this instant.
- `threads=12` — OS threads the runtime has created.
- `runqueue=0` — goroutines waiting in the global run queue.
- `[0 0 ...]` — per-P local run-queue lengths.

Add `scheddetail=1` alongside it for a much more verbose, per-goroutine dump. As a junior you mostly want the high-level `schedtrace`; `scheddetail` is for deep investigations.

### `runtime/debug` is the same idea, from inside the program

Where `GODEBUG` is an external switch, `runtime/debug` is a set of function calls. The most common ones:

- `debug.SetGCPercent(50)` — make GC kick in sooner (lower number = more frequent GC, less memory).
- `debug.SetMemoryLimit(512 << 20)` — tell the runtime to target staying under 512 MiB.
- `debug.FreeOSMemory()` — force a GC *and* hand freed memory back to the OS now.
- `debug.Stack()` — return the current goroutine's stack trace as bytes.
- `debug.PrintStack()` — print that stack to stderr.
- `debug.ReadBuildInfo()` — read the module/version/VCS metadata baked into the binary.

### `GODEBUG` and `runtime/debug` overlap on purpose

Some controls exist in both worlds. The classic example: heap-growth percentage. You can set it externally with `GOGC=50 ./prog`, or internally with `debug.SetGCPercent(50)`. Same with the memory limit: `GOMEMLIMIT=512MiB ./prog` equals `debug.SetMemoryLimit(512 << 20)`. The rule of thumb: use the *environment variable* when you want operators to control it without recompiling; use the *function* when your program needs to decide for itself.

---

## Real-World Analogies

**1. The dashboard light vs. the dial.** `GODEBUG=gctrace=1` is like a warning light you can flip on — it makes the engine *report* what it is doing. `debug.SetGCPercent` is the dial that actually changes how the engine runs. One observes, one controls.

**2. A flight recorder you enable at the gate.** You cannot rewire a plane mid-flight, but before takeoff you can arm extra recorders. `GODEBUG` is set before the program "takes off"; once airborne (running), the configuration is fixed.

**3. The thermostat with a target.** `SetMemoryLimit` is a thermostat: "try to keep the room under 22°C." The runtime works harder (runs GC more often) as it approaches the limit — just as a thermostat runs the AC harder near the set point. It is a *target*, not a hard wall.

**4. The label on the back of an appliance.** `ReadBuildInfo` is the spec sticker: model number, manufacture date, parts list. It tells you exactly *what* you are running — which commit, which dependency versions — without opening the box.

---

## Mental Models

### Model 1 — Two doors into one runtime

There is exactly one runtime. `GODEBUG` is the door you open from *outside* (the environment, at startup). `runtime/debug` is the door you open from *inside* (your code, at any time). Many rooms have a door on both sides.

### Model 2 — Read-once vs. call-anytime

`GODEBUG` is read **once**, at startup. `runtime/debug` functions can be called **anytime** the program is running, repeatedly. If you need to change behavior *during* execution, you need `runtime/debug`, not `GODEBUG`.

### Model 3 — Observe knobs vs. control knobs

Some settings only *report* (`gctrace`, `schedtrace`, `inittrace`). Others *change behavior* (`SetGCPercent`, `SetMemoryLimit`). Keep them separate in your head: turning on a trace is safe and reversible by restarting; changing a control knob can affect performance and memory.

### Model 4 — The memory limit is a target, the GC percent is a ratio

`SetGCPercent(100)` means "let the heap grow to 2× the live set before collecting" — a *ratio*. `SetMemoryLimit(N)` means "keep total runtime memory near N bytes" — an *absolute target*. They cooperate: when memory approaches the limit, the runtime ignores the ratio and collects more often.

### Model 5 — Build info is frozen at compile time

`ReadBuildInfo()` does not compute anything at runtime — it reads a block the *compiler* embedded. The commit hash and module versions were fixed the moment `go build` ran. That is why it is reliable provenance: the binary cannot lie about which versions it was built from.

---

## Pros & Cons

### Pros

- **No recompile to investigate.** `GODEBUG` turns on diagnostics on a binary you already shipped.
- **Cheap to try.** A trace flag is a one-line change to a launch command, easy to add and remove.
- **In-process control.** `runtime/debug` lets a program tune its own GC and memory based on what it knows.
- **Reliable provenance.** `ReadBuildInfo` gives you exact version/commit info with no external service.
- **Standard and stable.** Both are part of the standard toolchain; no dependencies to add.

### Cons

- **`GODEBUG` is startup-only.** You cannot change it on a running process; you must restart.
- **Trace output is noisy and on stderr.** `gctrace` and `schedtrace` are for humans reading logs, not structured metrics. (For structured numbers, use `runtime/metrics`.)
- **Easy to misuse the controls.** A too-low `SetGCPercent` or an over-tight `SetMemoryLimit` can make the program slower or even thrash.
- **`FreeOSMemory` is expensive.** It forces a full GC; calling it in a loop hurts.
- **`ReadBuildInfo` can return `ok=false`.** In `go run` and some test contexts the build info is not embedded.

---

## Use Cases

You reach for **`GODEBUG`** when:

- You want to see *why* the GC is busy on a production binary — flip on `gctrace=1`.
- You suspect a scheduling problem (goroutines piling up) — `schedtrace=1000`.
- You want to see how long package `init()` functions take — `inittrace=1`.
- You hit a behavior change after upgrading Go and need to restore the old behavior temporarily (the compatibility system — covered in middle.md).

You reach for **`runtime/debug`** when:

- Your service should cap its own memory — `SetMemoryLimit`.
- You want a periodic background trim of OS memory after a big batch job — `FreeOSMemory`.
- You build a panic handler or health endpoint that dumps the current stack — `Stack` / `PrintStack`.
- You expose a `/version` endpoint listing the commit and dependency versions — `ReadBuildInfo`.

---

## Code Examples

### Example 1 — Turning on `gctrace` (no code change)

Given any Go program `./app`:

```bash
GODEBUG=gctrace=1 ./app
```

You will see GC lines on stderr. To save them separately:

```bash
GODEBUG=gctrace=1 ./app 2> gc.log
```

Now `gc.log` holds every GC cycle's summary while normal output stays on stdout.

### Example 2 — Setting the GC percent in code

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    old := debug.SetGCPercent(50) // returns the previous value
    fmt.Println("previous GOGC was:", old)
    // ... allocation-heavy work; GC now runs about twice as often ...
}
```

`SetGCPercent` returns the old value, so you can restore it later if you want.

### Example 3 — Setting a soft memory limit

```go
package main

import "runtime/debug"

func main() {
    // Target staying under 512 MiB total.
    debug.SetMemoryLimit(512 << 20) // 512 * 1024 * 1024 bytes
    // ... your server ...
}
```

The same effect from the outside, no code:

```bash
GOMEMLIMIT=512MiB ./app
```

### Example 4 — Dumping the current goroutine's stack

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    fmt.Println("stack at this point:")
    fmt.Printf("%s\n", debug.Stack())
}
```

`debug.Stack()` returns `[]byte`. `debug.PrintStack()` writes the same thing straight to stderr — handy inside a `recover()`:

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
        debug.PrintStack()
    }
}()
```

### Example 5 — Forcing memory back to the OS

```go
package main

import "runtime/debug"

func runBigBatch() { /* allocates a lot */ }

func main() {
    runBigBatch()
    debug.FreeOSMemory() // GC now, and return freed pages to the OS
    // memory footprint as seen by the OS should drop
}
```

Use this *sparingly* — typically once after a big one-off allocation spike, not on a hot path.

### Example 6 — Reading build info

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    info, ok := debug.ReadBuildInfo()
    if !ok {
        fmt.Println("no build info (built with `go run` or `go test`?)")
        return
    }
    fmt.Println("module path:", info.Main.Path)
    fmt.Println("go version:", info.GoVersion)
    for _, setting := range info.Settings {
        if setting.Key == "vcs.revision" || setting.Key == "vcs.time" || setting.Key == "vcs.modified" {
            fmt.Printf("%s = %s\n", setting.Key, setting.Value)
        }
    }
}
```

Build and run it:

```bash
go build -o app . && ./app
```

You will see the commit (`vcs.revision`), the commit time (`vcs.time`), and whether the tree was dirty (`vcs.modified=true`). This is the same information `go version -m ./app` prints.

---

## Coding Patterns

### Pattern: configure the runtime once, at the top of `main`

```go
func main() {
    debug.SetMemoryLimit(memLimitFromEnvOrDefault())
    // ... rest of startup ...
}
```

Keep runtime configuration in one obvious place, not scattered through the program.

### Pattern: a `/version` handler from build info

```go
func versionHandler(w http.ResponseWriter, r *http.Request) {
    info, ok := debug.ReadBuildInfo()
    if !ok {
        http.Error(w, "no build info", http.StatusInternalServerError)
        return
    }
    fmt.Fprintf(w, "module: %s\ngo: %s\n", info.Main.Path, info.GoVersion)
}
```

### Pattern: dump stack on panic in a worker

```go
func safeRun(job func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("job panicked: %v\n%s", r, debug.Stack())
        }
    }()
    job()
}
```

---

## Clean Code

- **Prefer the environment variable for operator-tunable settings.** Memory limits that ops should adjust belong in `GOMEMLIMIT`, not hard-coded.
- **Call `SetMemoryLimit` / `SetGCPercent` once, early.** Repeated calls scattered around are confusing.
- **Always check the `ok` from `ReadBuildInfo`.** It can be `false`; ignoring it leads to a nil-ish surprise.
- **Do not log `gctrace` output as your application logs.** It is on stderr for a reason; keep it separate.
- **Name the units.** Write `512 << 20 // 512 MiB`, not a bare `536870912`.

---

## Product Use / Feature

These tools show up in real products as:

- **A `/healthz` or `/debug/version` endpoint** that reports the running commit via `ReadBuildInfo` — invaluable when "which build is actually deployed?" comes up during an incident.
- **A memory cap** set with `SetMemoryLimit` so a service plays nicely in a container with a fixed memory allotment.
- **On-demand diagnostics**: an operator restarts one replica with `GODEBUG=gctrace=1` to investigate a GC-pressure complaint without touching the others.
- **Crash forensics**: panic handlers that attach `debug.Stack()` to error reports so support can see exactly where a goroutine failed.

---

## Error Handling

There are few "errors" here in the `error`-return sense; the gotchas are mostly silent.

### `ReadBuildInfo` returns `ok == false`

This is the one you will hit. Causes:

- The program was started with `go run` (no embedded build info).
- A test binary in some configurations.

Always branch on `ok`:

```go
info, ok := debug.ReadBuildInfo()
if !ok {
    // fall back to a build-time ldflags variable, or report "unknown"
}
```

### A bad `GODEBUG` setting name is silently ignored

If you typo `gctrace=1`, nothing happens — no error, no output. Double-check the spelling against the docs if a trace does not appear.

### `SetMemoryLimit` with a tiny value

Setting the limit absurdly low (e.g., a few MB) makes the GC run almost constantly. The program does not error; it just gets very slow. Treat "the limit is too tight" as a tuning problem, not a crash.

### `SetGCPercent(-1)` disables GC

Passing `-1` turns the GC *off* entirely. That is occasionally intentional (very short-lived tools) but is a footgun in a long-running service — memory will grow without bound.

---

## Security Considerations

- **Build info can leak internal details.** `ReadBuildInfo` exposes your module path and dependency versions. Do not expose a `/version` endpoint that dumps the full settings list to the public internet — attackers can map your dependencies to known CVEs. Gate it behind auth or strip it to a short commit hash.
- **`vcs.modified=true` is a signal.** A binary built from a dirty tree should not normally reach production. Surfacing this in build info helps catch unofficial builds.
- **Trace output may contain paths.** `gctrace` is benign, but some debug traces include file paths or addresses; keep stderr logs out of untrusted hands.
- **Do not let users set `GODEBUG`.** It is an operator/deployment concern. A web user should never influence the runtime configuration of your process.

---

## Performance Tips

- **`gctrace` and `schedtrace` are cheap but not free.** They write to stderr each cycle; leave them off in steady-state production unless investigating.
- **`SetMemoryLimit` trades CPU for memory.** Approaching the limit means more GC cycles — watch the GC `%` in `gctrace` when you tighten it.
- **`FreeOSMemory` forces a full, stop-the-world-ish GC.** Never call it in a request handler or tight loop. Once after a batch is fine.
- **`SetGCPercent` lower = less memory, more CPU.** Higher = more memory, less CPU. There is no free lunch; measure.
- **Prefer one runtime-config call at startup** over repeated re-tuning, which itself costs work.

---

## Best Practices

1. **Use `GOMEMLIMIT` in containers.** Set it a bit below the container's hard limit so the GC reacts before the OOM killer does.
2. **Set runtime config once, in `main`.** Keep it discoverable.
3. **Always handle `ReadBuildInfo`'s `ok`.** Fall back gracefully.
4. **Keep trace flags out of steady-state prod.** Enable them deliberately, during an investigation, then turn them off.
5. **Document which `GODEBUG` flags your deployment uses** in your runbook.
6. **Do not disable GC (`SetGCPercent(-1)`) in long-lived services.**
7. **Send `gctrace` to its own log stream**, separate from app logs.
8. **Expose version via build info**, not a hand-maintained constant that drifts.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Changing `GODEBUG` after the program starts

Setting the variable in a running shell, or with `os.Setenv` after `main` begins, has no effect on already-read settings. You must restart the process.

### Pitfall 2 — `ReadBuildInfo` empty under `go run`

`go run .` does not embed VCS info. Test with a real `go build` binary.

### Pitfall 3 — Forgetting `gctrace` goes to stderr

If you redirect only stdout (`> out.log`), the GC lines still hit your terminal. Redirect stderr (`2> gc.log`).

### Pitfall 4 — Reading the `gctrace` triple backwards

`4->4->1 MB` is *heap-before* `->` *heap-at-mark-term* `->` *live-after*. The **last** number is the live heap. People often misread the first as "live."

### Pitfall 5 — `SetMemoryLimit` is soft, not hard

It does not guarantee you will never exceed the limit; the runtime targets it. A sudden huge allocation can still overshoot. It is not a substitute for the container's hard limit.

### Pitfall 6 — `GOMEMLIMIT` and `SetMemoryLimit` are the same dial

If both are set, the *function call wins* because it runs after the env var was read at startup. Do not set both and expect them to add up.

### Pitfall 7 — `FreeOSMemory` in a hot path

Tempting after "I freed a big slice," but it forces a full GC. In a loop it can dominate your CPU time.

---

## Common Mistakes

- **Expecting `GODEBUG` changes to take effect live.** It is startup-only.
- **Redirecting the wrong stream** and wondering where the GC output went.
- **Setting `SetGCPercent` very low "to save memory"** and accidentally doubling CPU usage.
- **Ignoring `ok` from `ReadBuildInfo`** and printing empty/garbage version strings.
- **Calling `FreeOSMemory` "just in case"** on every request.
- **Confusing `gctrace`'s before/after numbers.**
- **Exposing full build settings publicly**, leaking dependency versions.
- **Setting both `GOMEMLIMIT` and `SetMemoryLimit` to different values** and expecting predictable arithmetic.

---

## Common Misconceptions

> *"`GODEBUG` requires a special debug build."*

No. Any Go binary reads `GODEBUG`. It is a standard runtime feature, not a build mode.

> *"`SetMemoryLimit` will make my program crash if it exceeds the limit."*

No. It is a *soft* target. The runtime collects more aggressively as it approaches; it does not panic.

> *"`runtime/debug` is only for debugging during development."*

No. `SetMemoryLimit`, `SetGCPercent`, and `ReadBuildInfo` are production-grade tools used in real services.

> *"`gctrace` slows everything down a lot."*

Not really. The cost is a small write per GC cycle. It is fine to use during an investigation; you just turn it off afterward to keep logs clean.

> *"Build info is computed at runtime."*

No. It is embedded by the compiler at build time. That is exactly what makes it trustworthy.

> *"I can set `GODEBUG` from inside my Go code."*

You can set the env var with `os.Setenv`, but the runtime already read it at startup, so it will not retroactively change settings. Use `runtime/debug` for in-process control.

---

## Tricky Points

- **The leading `%` in `gctrace` is cumulative**, not the cost of that single cycle.
- **`SetGCPercent` returns the previous value** — capture it if you want to restore.
- **`-1` disables GC**; any value `< -1` is treated like `-1` historically — do not rely on it, just use `-1`.
- **`GOMEMLIMIT` accepts unit suffixes** (`MiB`, `GiB`, `B`); `SetMemoryLimit` takes raw bytes as an `int64`.
- **`schedtrace` and `scheddetail` combine**: `scheddetail=1` only produces useful output alongside a nonzero `schedtrace`.
- **`debug.Stack()` shows only the *current* goroutine**; to dump *all* goroutines you use a different mechanism (`runtime.Stack(buf, true)` or `SIGQUIT`).
- **`ReadBuildInfo` works best on `go build` / `go install` binaries**, not `go run`.

---

## Test

Try this in a scratch folder.

```bash
mkdir gdbg && cd gdbg
go mod init example.com/gdbg
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    info, ok := debug.ReadBuildInfo()
    fmt.Println("build info ok:", ok)
    if ok {
        fmt.Println("module:", info.Main.Path, "go:", info.GoVersion)
    }
    // allocate to provoke some GC
    var s [][]byte
    for i := 0; i < 100000; i++ {
        s = append(s, make([]byte, 1024))
    }
    fmt.Println("allocated", len(s), "slices")
}
EOF
go build -o app .
GODEBUG=gctrace=1 ./app 2> gc.log
cat gc.log
```

Expected: at least one `gc N @...` line in `gc.log`, and `build info ok: true` with your module path.

Now answer:
1. Why does `gc.log` have the GC lines and not the terminal? (Answer: `gctrace` writes to stderr, which we redirected.)
2. If you change the run to `go run main.go`, what does `build info ok` print? (Answer: likely `false` — no VCS info under `go run`.)
3. In `4->4->1 MB`, which number is the live heap? (Answer: the last, `1 MB`.)
4. What does `GODEBUG=gctrace=1,schedtrace=500 ./app` add? (Answer: a scheduler summary every 500 ms.)

---

## Tricky Questions

**Q1.** I set `GODEBUG=gctrace=1` but see nothing. Why?

A. Likely you redirected stdout, not stderr, or the program exited before any GC ran. Add `2>&1` and ensure the program allocates enough to trigger GC.

**Q2.** `ReadBuildInfo` returns `ok=false`. Is my code wrong?

A. Probably not. You are likely running under `go run` or a test binary. Build a real binary with `go build` and the info appears.

**Q3.** Is `SetMemoryLimit(256<<20)` a hard cap?

A. No. It is a soft target. The runtime GCs harder near it but can still overshoot on a large allocation. Keep a hard limit at the container level too.

**Q4.** What is the difference between `GOGC` and `GOMEMLIMIT`?

A. `GOGC` is a *ratio* (how much the heap may grow before GC). `GOMEMLIMIT` is an *absolute* memory target. They work together; the limit overrides the ratio near the ceiling.

**Q5.** Can I turn `gctrace` on for a running process?

A. No. `GODEBUG` is read once at startup. Restart the process with the variable set.

**Q6.** Why would I call `FreeOSMemory`?

A. To return freed memory to the OS *now*, e.g., after a large one-off batch, so the resident size drops. Do not call it routinely.

**Q7.** What does `debug.Stack()` give me versus a full goroutine dump?

A. `debug.Stack()` is just the *current* goroutine. For all goroutines, use `runtime.Stack(buf, true)` or send the process `SIGQUIT`.

**Q8.** I set both `GOMEMLIMIT` and called `SetMemoryLimit`. Which wins?

A. The function call, because it executes after the env var was applied at startup. The last setter wins.

**Q9.** Does `gctrace` change how the program runs?

A. Only marginally — it adds a small write per GC cycle. It does not change GC tuning. It is safe to use during investigation.

**Q10.** Is `runtime/debug` the same as the `debug/...` packages (like `debug/elf`)?

A. No. `runtime/debug` controls the live runtime. `debug/elf`, `debug/dwarf`, etc. parse binary *file formats*. Different packages, different jobs.

---

## Cheat Sheet

```bash
# Turn on GC tracing (output to a file)
GODEBUG=gctrace=1 ./app 2> gc.log

# Scheduler summary every second
GODEBUG=schedtrace=1000 ./app

# Detailed per-goroutine scheduler dump
GODEBUG=schedtrace=1000,scheddetail=1 ./app

# Time package init() functions
GODEBUG=inittrace=1 ./app

# Soft memory target (no recompile)
GOMEMLIMIT=512MiB ./app

# Heap-growth ratio (no recompile)
GOGC=50 ./app

# Inspect build info of a binary
go version -m ./app
```

```go
import "runtime/debug"

debug.SetGCPercent(50)            // ratio: lower = more GC, less memory
debug.SetMemoryLimit(512 << 20)   // absolute soft target in bytes
debug.FreeOSMemory()              // GC now + return pages to OS
buf := debug.Stack()              // current goroutine stack
debug.PrintStack()                // same, straight to stderr
info, ok := debug.ReadBuildInfo() // module/version/VCS metadata
```

```
gctrace line:
  gc 1 @0.012s 3%: 0.018+1.5+0.005 ms clock, ... , 4->4->1 MB, 5 MB goal, 8 P
      │   │     │   └─ phase timings                  │   │  │      │       └ #procs
      │   │     └─ cumulative GC CPU %                │   │  └ live after     └ goal
      │   └─ time since start              heap before ┘   └ heap at mark term
      └─ cycle number
```

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Set a `GODEBUG` value with two settings at once
- [ ] Explain why `GODEBUG` cannot be changed on a running process
- [ ] Read every field of a `gctrace=1` line out loud
- [ ] Identify the live-heap number in the `a->b->c MB` triple
- [ ] Read the top-line fields of a `schedtrace` summary
- [ ] Call `SetGCPercent`, `SetMemoryLimit`, and `FreeOSMemory` correctly
- [ ] Explain the difference between `GOGC` and `GOMEMLIMIT`
- [ ] Print build info and handle the `ok=false` case
- [ ] Dump the current goroutine's stack
- [ ] State that `SetMemoryLimit` is soft, not a hard cap

---

## Summary

`GODEBUG` is an environment variable — a comma-separated list of `name=value` switches the runtime reads **once at startup** — that lets you observe and tweak runtime/stdlib behavior without recompiling. The everyday flags are `gctrace=1` (a line per GC cycle), `schedtrace=N` (a scheduler summary every N ms), and `inittrace=1` (init timing). `runtime/debug` is the in-process counterpart: `SetGCPercent` and `SetMemoryLimit` tune the GC and memory target, `FreeOSMemory` returns pages to the OS, `Stack`/`PrintStack` dump goroutine stacks, and `ReadBuildInfo` reads the module/version/VCS provenance the compiler embedded.

Think of them as two doors into one runtime: `GODEBUG` from outside at startup, `runtime/debug` from inside at any time. The memory limit is a *soft* target, the GC percent is a *ratio*, and build info is *frozen at compile time*. Master the `gctrace` line, remember the startup-only rule, and you have the foundation for the deeper compatibility and tuning material that follows.

---

## What You Can Build

After learning this:

- **A `/version` endpoint** that reports the exact deployed commit and Go version from build info.
- **A memory-capped service** that sets `SetMemoryLimit` to fit its container.
- **A GC-pressure investigation workflow**: launch one replica with `gctrace=1`, read the lines, decide on a fix.
- **A robust panic handler** that attaches the goroutine stack to error reports.
- **A batch job** that trims OS memory with `FreeOSMemory` after a heavy phase.

You cannot yet:
- Use the Go 1.21 GODEBUG *compatibility* system to restore old behavior (next: middle.md)
- Pin GODEBUG defaults via `//go:debug` and the `go` line (middle.md)
- Read `/godebug/non-default-behavior/*` counters from `runtime/metrics` (middle/professional)
- Install a crash-output sink with `SetCrashOutput` (senior.md)

---

## Further Reading

- [`runtime/debug` package documentation](https://pkg.go.dev/runtime/debug) — the authoritative API reference.
- [GODEBUG documentation](https://go.dev/doc/godebug) — what GODEBUG is and the compatibility system.
- [Runtime environment variables (`GODEBUG`, `GOGC`, `GOMEMLIMIT`)](https://pkg.go.dev/runtime#hdr-Environment_Variables) — the full list of runtime knobs.
- [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) — explains `GOGC`, `GOMEMLIMIT`, and `gctrace` in depth.
- [Go 1.19 release notes — soft memory limit](https://go.dev/doc/go1.19#runtime) — where `SetMemoryLimit` arrived.

---

## Related Topics

- [17.1 runtime/metrics Package](../01-runtime-metrics-package/junior.md) — structured runtime numbers; the modern complement to `gctrace`
- [17.2 expvar](../02-expvar/junior.md) — exposing runtime variables over HTTP
- [17.3 runtime/trace](../03-runtime-trace-application-tracing/junior.md) — execution tracing for deep timing analysis
- 17.6 pprof — heap and CPU profiling, which pairs with these knobs

---

## Diagrams & Visual Aids

```
Two doors into one runtime:

   OUTSIDE (environment)            INSIDE (your code)
   ────────────────────            ──────────────────
   GODEBUG=gctrace=1               import "runtime/debug"
   GOGC=50                         debug.SetGCPercent(50)
   GOMEMLIMIT=512MiB               debug.SetMemoryLimit(512<<20)
        │                                   │
        │  read ONCE at startup             │  callable ANYTIME
        ▼                                   ▼
            ┌───────────────────────┐
            │     Go runtime        │
            │  scheduler · GC · mem │
            └───────────────────────┘
```

```
gctrace=1 line anatomy:

  gc 1 @0.012s 3%: 0.018+1.5+0.005 ms clock, ... , 4->4->1 MB, 5 MB goal, 8 P
     │     │    │        │                          │  │  │       │        │
   cycle  time cum.%  phase timings        heap before │  │     goal    #procs
                                              at mark term┘  └ live after
```

```
Memory limit vs GC percent:

   SetGCPercent(100): "let heap grow to 2x live, then GC"   (a RATIO)

      live ──────► 2x live ──► GC
                    grows freely until the ratio

   SetMemoryLimit(N): "keep total memory near N"            (a TARGET)

      memory rises toward N ──► GC runs MORE often near N ──► stays ≈ N
                                (ratio overridden near ceiling)
```

```
Build info is frozen at compile time:

   go build ──► compiler embeds { module, versions, vcs.revision, vcs.time, vcs.modified }
                                          │
                                          ▼
   at runtime: debug.ReadBuildInfo() reads the embedded block (no computation)
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ok=true on `go build`/`go install` binaries      ok=false under `go run`
```
