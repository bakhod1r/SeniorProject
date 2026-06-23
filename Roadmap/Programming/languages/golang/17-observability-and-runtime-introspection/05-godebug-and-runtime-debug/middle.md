# GODEBUG & `runtime/debug` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Two Faces of GODEBUG](#the-two-faces-of-godebug)
3. [The Go 1.21 GODEBUG Compatibility System](#the-go-121-godebug-compatibility-system)
4. [`//go:debug` and the `godebug` go.mod Directive](#godebug-and-the-godebug-gomod-directive)
5. [Where Defaults Come From: the `go` Line](#where-defaults-come-from-the-go-line)
6. [Reading Diagnostic GODEBUG Output](#reading-diagnostic-godebug-output)
7. [`runtime/debug`: GC and Memory Controls](#runtimedebug-gc-and-memory-controls)
8. [`SetMemoryLimit` vs `SetGCPercent` (and `GOMEMLIMIT`)](#setmemorylimit-vs-setgcpercent-and-gomemlimit)
9. [`runtime/debug`: Diagnostics and Build Info](#runtimedebug-diagnostics-and-build-info)
10. [Inspecting Active Settings via `runtime/metrics`](#inspecting-active-settings-via-runtimemetrics)
11. [GODEBUG vs runtime/debug: When to Use Which](#godebug-vs-runtimedebug-when-to-use-which)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
14. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

At the junior level `GODEBUG` was "a switch that turns on traces" and `runtime/debug` was "functions that tune the GC." That mental model is correct but incomplete. The thing that surprises everyone the first time is that, since Go 1.21, `GODEBUG` carries a *second* responsibility: it is the mechanism by which Go ships **backward-incompatible behavior changes** while still letting old programs opt out of them. Understanding that compatibility system — how defaults are derived from your module's `go` line, how `//go:debug` directives pin them, and how `runtime/metrics` reports which non-default behaviors are active — is the heart of this level.

This file covers both faces of `GODEBUG` precisely, then goes deeper on `runtime/debug`: the exact semantics of `SetMemoryLimit` versus `SetGCPercent`, the cost of `FreeOSMemory`, the structure of `BuildInfo`, and how to verify what the runtime is actually doing.

After reading this you will:
- Distinguish *diagnostic* GODEBUG settings from *compatibility* GODEBUG settings
- Explain how a module's `go` line determines GODEBUG defaults
- Use `//go:debug` and the `godebug` go.mod directive to control them
- Reason precisely about `SetMemoryLimit` / `SetGCPercent` interaction
- Read `/godebug/non-default-behavior/*` counters from `runtime/metrics`
- Decide between an environment knob and a programmatic call for each situation

---

## The Two Faces of GODEBUG

`GODEBUG` settings fall into two distinct categories that happen to share one variable.

**1. Diagnostic settings** make the runtime *report* or *change low-level behavior* for investigation. They have existed since early Go. Examples:

| Setting | Effect |
|---------|--------|
| `gctrace=1` | One stderr line per GC cycle. |
| `schedtrace=N` | Scheduler summary every N ms. |
| `scheddetail=1` | Per-P, per-goroutine detail (with `schedtrace`). |
| `inittrace=1` | Timing and allocations of each package `init`. |
| `allocfreetrace=1` | A stack trace at every allocation and free (extremely verbose; debugging only). |
| `madvdontneed=1` | Use `MADV_DONTNEED` instead of `MADV_FREE` on Linux (return memory to OS more eagerly). |
| `cgocheck=0|1|2` | Level of checking for cgo pointer-passing rules. |
| `http2debug=1|2` | Verbose logging in `net/http`'s HTTP/2 implementation. |

**2. Compatibility settings** gate a *specific backward-incompatible behavior change* introduced in some Go release. Each has two states: the new behavior (default for new modules) and the old behavior (opt-in for compatibility). Examples:

| Setting | What it controls |
|---------|------------------|
| `tlsrsakex=1` | Re-enable the RSA key-exchange cipher suites `crypto/tls` removed by default. |
| `x509sha1=1` | Re-allow SHA-1 signatures in certificate verification. |
| `panicnil=1` | Restore the old behavior where `panic(nil)` was allowed (Go 1.21 made it panic with a runtime error). |
| `httplaxcontentlength=1` | Restore lax `Content-Length` parsing in `net/http`. |
| `execerrdot=1` | Restore the old `os/exec` behavior for resolving relative paths. |

The first category is for humans investigating a running program. The second category is a *compatibility contract*: it lets the Go team change a default safely, because anyone broken by the change can set the GODEBUG to get the old behavior back. The rest of this file's GODEBUG material is about category two — it is what is new and what is widely misunderstood.

---

## The Go 1.21 GODEBUG Compatibility System

Go's compatibility promise says a program that works today should keep working with future Go versions. But sometimes a change is necessary — a security fix, a spec correction, a bug. The tension between "do not break programs" and "fix the bug" is resolved by the GODEBUG compatibility system, formalised in Go 1.21.

The rules:

1. **Each incompatible change gets a named GODEBUG setting** with two values: the new behavior and the old behavior. The change is documented in the GODEBUG history table at `go.dev/doc/godebug`.
2. **The default value of each setting is derived from the main module's `go` line.** If your `go.mod` says `go 1.20`, you get the *Go 1.20* defaults for every compatibility setting — even when compiled by a Go 1.23 toolchain. Upgrading the `go` line to `1.23` opts you into the newer defaults.
3. **You can override any setting explicitly**, at three levels of precedence (lowest to highest): the `go` line default → a `godebug` directive in `go.mod` → a `//go:debug` line in the main package → the `GODEBUG` environment variable at runtime.
4. **Settings persist across Go upgrades.** Bumping your toolchain from 1.22 to 1.23 does *not* silently change behavior, because your `go` line still pins the defaults. You change behavior only when you raise the `go` line.

The crucial insight: **the `go` directive is no longer just a minimum-version marker — it selects a behavior baseline.** A binary built by Go 1.23 from a `go 1.20` module behaves, for compatibility-gated decisions, like Go 1.20. This is what lets the toolchain be aggressive about fixing defaults without breaking anyone who has not opted in.

`runtime/debug.SetCrashOutput` (Go 1.23) is part of the same broader story of giving programs explicit, documented control over runtime behavior, though it is an API rather than a GODEBUG setting (covered in senior.md).

---

## `//go:debug` and the `godebug` go.mod Directive

Two source-level mechanisms let you set GODEBUG defaults without relying on the environment.

### The `godebug` directive in `go.mod`

Since Go 1.23 you can list GODEBUG defaults directly in `go.mod`:

```
module example.com/app

go 1.23

godebug (
    panicnil=1
    httplaxcontentlength=1
)
```

These become the *defaults* for the whole module, overriding what the `go` line would otherwise imply, but still overridable by the environment variable at runtime. Use this when your module relies on a specific old behavior and you want that recorded in the module metadata rather than scattered across deployment scripts.

### The `//go:debug` directive in the main package

For settings that belong to a *specific program* rather than the whole module, put a `//go:debug` comment directly above the `package` clause of a file in `package main`:

```go
//go:debug panicnil=1
//go:debug tlsrsakex=1
package main

import "fmt"

func main() { fmt.Println("...") }
```

Rules:

- It must be in the **main package** — these directives configure an executable, not a library. A `//go:debug` line in a library package is an error.
- It must appear in the comment block immediately above `package main`, before any blank line separating it from the package clause.
- It is read at *build* time and baked into the binary's defaults.

### Precedence, end to end

```
go line default  <  godebug directive (go.mod)  <  //go:debug (main pkg)  <  GODEBUG env var (runtime)
   lowest                                                                        highest
```

Each level overrides the ones to its left. The environment variable always has the last word, which is what makes it the operator's emergency lever.

---

## Where Defaults Come From: the `go` Line

Make this concrete. Suppose Go 1.21 changed `panic(nil)` to raise a `*runtime.PanicNilError` instead of delivering a literal `nil` to `recover()`. The compatibility setting is `panicnil`: `panicnil=1` restores the old behavior, the (unset) new default raises the error.

- `go.mod` says `go 1.20`, built with Go 1.23 → default `panicnil=1` (old behavior). Your `panic(nil)` still delivers `nil` to `recover`.
- `go.mod` says `go 1.21` (or higher) → default new behavior. `panic(nil)` now raises `*runtime.PanicNilError`.
- You can flip it either way at any of the four precedence levels.

This is why "we upgraded our toolchain and nothing changed" is the *expected* and *desired* outcome: the toolchain version does not move your baseline; the `go` line does. The deliberate, reviewable act of raising the `go` line is when you accept the newer defaults — and you can do it one setting at a time by overriding the rest.

A practical workflow when raising the `go` line: bump it, run your tests, and if something breaks, pin the specific setting (`//go:debug oldsetting=1`) while you fix the root cause, rather than reverting the whole bump.

---

## Reading Diagnostic GODEBUG Output

The diagnostic settings produce text on stderr. Knowing how to read them is half the value.

### `inittrace=1`

```
init internal/bytealg @0.008 ms, 0 ms clock, 0 bytes, 0 allocs
init runtime @0.040 ms, 0.003 ms clock, 0 bytes, 0 allocs
init main @1.2 ms, 0.45 ms clock, 98304 bytes, 12 allocs
```

Each line: which package's `init` ran, when it started (`@... ms` after process start), how long it took (`clock`), and how much it allocated. A slow startup almost always shows up as one fat `init` line here — this is the fastest way to find a package doing expensive work at import time.

### `scheddetail=1` with `schedtrace`

```
SCHED 1000ms: gomaxprocs=8 idleprocs=0 threads=23 spinningthreads=2 ...
  P0: status=1 schedtick=4412 syscalltick=120 m=4 runqsize=3 ...
  M4: p=0 curg=87 mallocing=0 throwing=0 ...
  G87: status=2(running) m=4 lockedm=-1
```

This drops you below the summary into per-P (processor), per-M (OS thread), per-G (goroutine) state. You reach for it when `schedtrace` alone is not enough — e.g., to confirm goroutines are pinned to a thread (`lockedm`) or stuck in a syscall.

### `allocfreetrace=1`

This prints a stack trace at *every* allocation and free. It is astronomically verbose — only usable on tiny, isolated reproductions. Mentioned for completeness; you will rarely run it.

The general pattern: diagnostic GODEBUG is for *one investigation at a time*, captured to a file, read by a human, then turned off. It is not a metrics pipeline. For continuous numbers, use `runtime/metrics` (sibling topic 17.1).

---

## `runtime/debug`: GC and Memory Controls

The programmatic controls, with precise semantics:

| Function | Semantics |
|----------|-----------|
| `SetGCPercent(p int) int` | Sets the heap-growth target ratio (`GOGC` equivalent). Returns the previous value. `p = -1` disables GC. |
| `SetMemoryLimit(n int64) int64` | Sets the soft memory limit in bytes (`GOMEMLIMIT` equivalent). Returns the previous value. `n = math.MaxInt64` means "no limit." |
| `FreeOSMemory()` | Forces a GC and returns as much freed memory to the OS as possible, immediately. |
| `ReadGCStats(*GCStats)` | Fills a `GCStats` with GC counts, total pause, and the pause history. |
| `SetMaxStack(int) int` | Sets the maximum size a single goroutine's stack may reach before the program aborts. |
| `SetMaxThreads(int) int` | Sets the limit on OS threads; exceeding it aborts the program. A guard against runaway thread creation. |
| `SetPanicOnFault(bool) bool` | Controls whether an unexpected fault (e.g., touching unmapped memory in a mmap) panics instead of crashing. Useful with memory-mapped files. |

A few are guardrails rather than tuners: `SetMaxThreads` and `SetMaxStack` exist to turn "silent runaway" into "loud, early failure." A service that should never exceed, say, 10,000 OS threads can set `SetMaxThreads(10000)` so a goroutine-leak-into-syscalls bug aborts with a clear message instead of exhausting the machine.

`SetPanicOnFault` is the one most people have never used: when you `mmap` a file and the file is truncated underneath you, touching the now-missing page would normally crash the process; with `SetPanicOnFault(true)` it becomes a recoverable panic on that goroutine.

---

## `SetMemoryLimit` vs `SetGCPercent` (and `GOMEMLIMIT`)

This is the interaction interview questions love, because it is genuinely subtle.

`SetGCPercent` sets a *ratio*. With `GOGC=100`, the GC aims to start the next cycle when the heap has grown to roughly 2× the live heap from the last cycle. It says nothing about absolute memory.

`SetMemoryLimit` sets an *absolute soft target* for the runtime's total memory footprint (heap + stacks + runtime structures, roughly). It is a ceiling the GC works to respect.

They operate together:

- **Normally, the GC percent drives collection.** The heap grows by the ratio, GC runs, repeat.
- **As total memory approaches the limit, the limit takes over.** The GC runs *more frequently* than the ratio would dictate, trading CPU to keep memory near the target.
- **The limit is soft.** If live memory genuinely exceeds the limit (e.g., your live set is larger than the limit), the runtime does not crash — it just GCs continuously, which manifests as high GC CPU. This "GC death spiral" is the failure mode to watch for: a limit set below your actual working set turns the program into a GC treadmill.

Recommended configuration for a containerised service:

```go
debug.SetGCPercent(100)                 // or leave default
debug.SetMemoryLimit(int64(float64(containerLimitBytes) * 0.9)) // 90% headroom
```

Or, equivalently, via the environment with no code:

```bash
GOGC=100 GOMEMLIMIT=1800MiB ./app   # for a 2 GiB container
```

Key facts:

- `GOMEMLIMIT` (env) and `SetMemoryLimit` (call) set the *same* thing; the later setter wins, so a call in `main` overrides the env var.
- Setting *only* a memory limit and disabling the ratio (`GOGC=off` / `SetGCPercent(-1)`) is a documented pattern: GC then runs *only* to respect the limit, maximising throughput while still capping memory. This is the "let it grow, but never past N" configuration.
- The limit accounts for total runtime memory, not just heap — so leave headroom below the container's hard limit for non-heap memory and momentary overshoot.

---

## `runtime/debug`: Diagnostics and Build Info

### Stack dumps

```go
buf := debug.Stack()  // current goroutine's stack as []byte
debug.PrintStack()    // writes debug.Stack() to stderr
```

For *all* goroutines you drop to `runtime.Stack(buf, true)` or send `SIGQUIT` (which the runtime handles by dumping every goroutine and exiting). `debug.Stack` is the targeted, single-goroutine tool — ideal inside a `recover()`.

### `WriteHeapDump`

```go
f, _ := os.Create("heap.dump")
debug.WriteHeapDump(f.Fd())
```

Writes a low-level heap dump in the runtime's internal format. It is rarely used directly; `pprof` heap profiles are the usual tool. `WriteHeapDump` exists for tooling that needs the raw object graph.

### `SetTraceback`

```go
debug.SetTraceback("all")  // controls how much detail a crash traceback shows
```

Levels: `"none"`, `"single"` (default), `"all"`, `"system"`, `"crash"`. `"all"` dumps every goroutine on a crash; `"crash"` additionally raises a signal so the OS can produce a core dump. Equivalent to `GOTRACEBACK=...`.

### Build info

`debug.ReadBuildInfo()` returns a `*BuildInfo`:

```go
type BuildInfo struct {
    GoVersion string         // toolchain version, e.g. "go1.23.0"
    Path      string         // import path of the main package
    Main      Module         // the main module
    Deps      []*Module      // dependency modules
    Settings  []BuildSetting // key/value build settings, incl. VCS stamps
}
```

The `Settings` slice carries the VCS stamps and build flags:

```go
info, ok := debug.ReadBuildInfo()
if ok {
    for _, s := range info.Settings {
        switch s.Key {
        case "vcs.revision": // git commit hash
        case "vcs.time":     // commit timestamp (RFC3339)
        case "vcs.modified": // "true" if the working tree was dirty
        case "GOARCH", "GOOS", "-ldflags", "CGO_ENABLED":
            // build configuration
        }
    }
}
```

This is exactly the data `go version -m ./binary` prints — `ReadBuildInfo` is the programmatic equivalent. The VCS stamps are populated automatically by `go build` when building from a clean VCS checkout (controlled by `-buildvcs`). Under `go run` or `go test`, `ok` is often `false` or the VCS settings are absent — always branch on it.

---

## Inspecting Active Settings via `runtime/metrics`

How do you know which compatibility GODEBUG settings are actually in effect — and whether any *non-default* behavior is being triggered? The runtime exposes per-setting counters under `runtime/metrics`:

```
/godebug/non-default-behavior/<name>:events
```

Each counter increments every time a piece of code takes the *non-default* (usually the old, compatibility) path for that setting. A nonzero counter means "something in this process is relying on the old behavior of `<name>`."

```go
package main

import (
    "fmt"
    "runtime/metrics"
    "strings"
)

func main() {
    descs := metrics.All()
    var samples []metrics.Sample
    for _, d := range descs {
        if strings.HasPrefix(d.Name, "/godebug/non-default-behavior/") {
            samples = append(samples, metrics.Sample{Name: d.Name})
        }
    }
    metrics.Read(samples)
    for _, s := range samples {
        if s.Value.Uint64() > 0 {
            fmt.Printf("%s = %d\n", s.Name, s.Value.Uint64())
        }
    }
}
```

Why this matters: when you raise your `go` line, these counters tell you whether your program *would have* relied on the old behavior. If `/godebug/non-default-behavior/panicnil:events` is nonzero while you have `panicnil=1` set, you know that setting is load-bearing and you cannot just drop it — you have real code depending on it. It turns "did upgrading break anything?" from guesswork into a measurable signal. This ties directly into the sibling topic [17.1 runtime/metrics](../01-runtime-metrics-package/middle.md).

---

## GODEBUG vs runtime/debug: When to Use Which

A decision guide:

| You want to... | Use | Why |
|----------------|-----|-----|
| Investigate GC pressure on a deployed binary | `GODEBUG=gctrace=1` | No recompile; flip per-replica. |
| Cap a service's memory to fit its container | `GOMEMLIMIT` env, or `SetMemoryLimit` | Env for ops-tunable; call when the program computes the limit. |
| Restore an old stdlib behavior after a Go bump | `GODEBUG=<name>=<val>` or `//go:debug` | Compatibility system; env for emergencies, directive for permanence. |
| Tune GC ratio from inside the program | `SetGCPercent` | Programmatic, dynamic. |
| Dump a goroutine stack in a panic handler | `debug.Stack` | In-process, targeted. |
| Report the running commit on a `/version` endpoint | `ReadBuildInfo` | Reliable embedded provenance. |
| Detect reliance on old compatibility behavior | `runtime/metrics` `/godebug/non-default-behavior/*` | The only way to measure it. |

The throughline: **`GODEBUG` is external, startup-time, operator-facing; `runtime/debug` is internal, any-time, program-facing.** Compatibility settings live in `GODEBUG` (with source-level pinning via directives); tuning and introspection APIs live in `runtime/debug`.

---

## Common Errors and Their Real Causes

### "My `//go:debug` line is ignored"

Causes: it is not in `package main`; there is a blank line between it and the `package` clause; or you put it in a non-main file. The directive must immediately precede `package main` with no intervening blank line.

### "Bumping the toolchain changed my program's behavior"

This should not happen via the compatibility system — the `go` line pins defaults. If it did, the change was *not* a GODEBUG-gated one (some changes are not gated), or someone raised the `go` line in the same change. Check the diff to `go.mod`.

### "`GOMEMLIMIT` set but the program still OOMs"

The limit is soft and accounts for runtime memory, not just heap. If your *live* working set exceeds the limit, the runtime cannot honor it — it GCs continuously and still grows. The fix is a larger limit or less live memory, not a tighter limit.

### "GC CPU shot up after I set a memory limit"

You set the limit below the working set, triggering the GC death spiral. Watch `gctrace`'s leading `%`; if it climbs toward double digits after setting a limit, the limit is too tight.

### "`ReadBuildInfo` has no `vcs.revision`"

Built with `go run`/`go test`, built outside a VCS checkout, built with `-buildvcs=false`, or the VCS binary was unavailable at build time. For `go build` in a clean git repo, the stamps appear.

### "`GODEBUG=tlsrsakex=1` didn't re-enable the cipher"

Compatibility settings are read at startup; confirm the env var is set in the process's environment (not just your shell), spelled exactly, and that the setting still exists in your Go version (some are removed after a deprecation window — check the GODEBUG history table).

---

## Best Practices for Established Codebases

1. **Pin compatibility behaviors in source, not deployment scripts.** Use `//go:debug` or the `godebug` go.mod directive so the requirement travels with the code and is reviewable.
2. **Raise the `go` line deliberately.** Treat it as accepting newer defaults; run tests, watch the `non-default-behavior` counters, and pin individual settings only as a temporary bridge.
3. **Set `GOMEMLIMIT` in every containerised deployment**, below the hard limit, so the GC reacts before the OOM killer.
4. **Never disable GC in long-lived services.** `SetGCPercent(-1)` is for short-lived tools.
5. **Keep diagnostic GODEBUG out of steady-state.** Enable per-investigation, capture to a file, turn off.
6. **Expose build info, not a hand-maintained version constant.** Wire `ReadBuildInfo` into your `/version` and structured logs.
7. **Add a `non-default-behavior` check to CI or startup logging** so you know which compatibility settings your code actually exercises.
8. **Document every GODEBUG and runtime/debug call in a runbook**, with the reason and the removal condition.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Treating the `go` line as cosmetic

A developer bumps `go 1.20` → `go 1.23` "to use a new feature" and unknowingly flips several compatibility defaults. Tests catch some; subtle runtime ones (TLS cipher availability, `panic(nil)`) slip through. The `go` line is behavior-bearing; review its changes like code.

### Pitfall 2 — `//go:debug` in a library

Someone adds `//go:debug panicnil=1` to a shared library package expecting it to apply to consumers. It is a compile error in a non-main package, and even if it were not, these directives only configure the *main* package of the final binary. Compatibility defaults are an executable-level concern.

### Pitfall 3 — Memory limit set below working set

`SetMemoryLimit` is configured from a fraction of the container limit, but the service's steady-state live heap is larger than that fraction. The result is constant GC and terrible latency, not an OOM. Measure the live heap (the last number in `gctrace`'s triple) before choosing a limit.

### Pitfall 4 — `FreeOSMemory` on a schedule that fights the GC

A team adds a ticker calling `FreeOSMemory` every few seconds to "keep memory low." Each call forces a full GC; under load this dominates CPU. `GOMEMLIMIT` plus `madvdontneed` is almost always the better lever.

### Pitfall 5 — Relying on `gctrace` parsing for metrics

A script tails `gctrace` output and turns it into dashboards. The format is *not* a stable API and changes between Go versions. Use `runtime/metrics` for anything programmatic.

### Pitfall 6 — Env `GOMEMLIMIT` silently overridden

Ops sets `GOMEMLIMIT=1500MiB`, but `main` calls `SetMemoryLimit` with a hard-coded value, overriding it. The operator's knob does nothing. If you read the limit from the environment in code, do not also hard-code a call — pick one source of truth.

### Pitfall 7 — Forgetting `non-default-behavior` resets per process

The counters are per-process and start at zero each run. A short-lived run may not exercise the path that increments them, so a zero counter does not prove "no reliance" — it proves "not exercised in this run." Interpret accordingly.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Classify a GODEBUG setting as diagnostic vs compatibility
- [ ] Explain how the `go` line selects compatibility defaults
- [ ] State the four-level precedence order for GODEBUG settings
- [ ] Add a `//go:debug` directive correctly and say why it must be in `package main`
- [ ] Use the `godebug` directive in `go.mod`
- [ ] Explain `SetMemoryLimit` vs `SetGCPercent` and predict the GC death-spiral failure
- [ ] Read VCS stamps out of `ReadBuildInfo().Settings`
- [ ] Read `/godebug/non-default-behavior/*` counters and interpret them
- [ ] Choose between an env knob and a `runtime/debug` call for a given task
- [ ] Diagnose each error in the "Common Errors" section from its message

---

## Summary

`GODEBUG` has two jobs. As a *diagnostic* tool it exposes `gctrace`, `schedtrace`/`scheddetail`, `inittrace`, and friends — startup-time, stderr-only, for one investigation at a time. As a *compatibility* mechanism (formalised in Go 1.21) it gates every backward-incompatible behavior change behind a named setting whose default is derived from the main module's `go` line; you override it, in increasing precedence, via the `godebug` go.mod directive, a `//go:debug` line in `package main`, or the `GODEBUG` environment variable. The `go` line therefore selects a behavior baseline, which is why upgrading a toolchain does not move your behavior and raising the `go` line does. `runtime/metrics`' `/godebug/non-default-behavior/*` counters tell you which old behaviors your code actually relies on.

`runtime/debug` is the in-process counterpart: `SetGCPercent` (a ratio) and `SetMemoryLimit` (a soft absolute target, identical to `GOMEMLIMIT`) cooperate, with the limit overriding the ratio near the ceiling and degrading into a GC death spiral if set below the working set. `FreeOSMemory` forces a full GC and is costly. `Stack`/`PrintStack` dump the current goroutine; `WriteHeapDump` and `SetTraceback` cover deeper diagnostics; and `ReadBuildInfo` yields the same module/version/VCS provenance as `go version -m`, with an `ok` you must always check. Use `GODEBUG` for external, startup, operator-facing control; use `runtime/debug` for internal, any-time, program-facing control.
