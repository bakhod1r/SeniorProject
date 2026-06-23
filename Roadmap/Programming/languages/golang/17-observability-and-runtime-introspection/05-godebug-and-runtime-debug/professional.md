# GODEBUG & `runtime/debug` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How GODEBUG Is Parsed and Wired](#how-godebug-is-parsed-and-wired)
3. [The Compatibility-Default Pipeline](#the-compatibility-default-pipeline)
4. [Where Defaults Are Baked: Build-Time Synthesis](#where-defaults-are-baked-build-time-synthesis)
5. [The `internal/godebug` Setting Mechanism](#the-internalgodebug-setting-mechanism)
6. [Non-Default-Behavior Counters in Detail](#non-default-behavior-counters-in-detail)
7. [`SetGCPercent` and `SetMemoryLimit` Internals](#setgcpercent-and-setmemorylimit-internals)
8. [`FreeOSMemory`, `madvdontneed`, and OS Return](#freeosmemory-madvdontneed-and-os-return)
9. [`ReadBuildInfo` and the Embedded Build Block](#readbuildinfo-and-the-embedded-build-block)
10. [Crash Output and Traceback Internals](#crash-output-and-traceback-internals)
11. [Programmatic Inspection Without the `go` Tool](#programmatic-inspection-without-the-go-tool)
12. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

The professional level treats `GODEBUG` and `runtime/debug` as the observable interface to two runtime subsystems — the GODEBUG setting registry and the GC/memory manager — plus the compiler/linker machinery that synthesises defaults and embeds the build block. Most teams use these features as opaque knobs; the professional engineer knows where each value comes from, how it is plumbed from `go.mod` through the linker into the runtime, and why a given setting did or did not take effect.

This file is for engineers who own runtime tuning, build observability tooling, maintain the upgrade process for a large fleet, or debug "why is this GODEBUG ignored" from first principles. After reading you will:

- Trace a GODEBUG value from `go.mod` to its in-process effect
- Explain how compatibility defaults are computed at build time from the `go` line
- Read the `internal/godebug` setting and metric machinery accurately
- Reason about `SetMemoryLimit`/`SetGCPercent` against the GC pacer
- Parse the embedded build block the way `ReadBuildInfo` and `go version -m` do
- Build provenance and upgrade-safety tooling without re-implementing the toolchain

The APIs are small. The machinery behind them — default synthesis, the setting registry, the GC pacer, the build block — is where the real understanding lives.

---

## How GODEBUG Is Parsed and Wired

The runtime reads the `GODEBUG` environment variable once during startup, before `main` runs, and parses it into a settings table. The parsing is a straightforward split on `,` then `=`; unknown names are ignored silently (which is why a typo produces no error).

The mechanism the standard library uses to *consume* those settings is the `internal/godebug` package. Each setting is represented by a `godebug.Setting` value, created with `godebug.New("name")`. Library code that gates behavior on a setting calls `setting.Value()` to read the current string value and `setting.IncNonDefault()` when it takes the non-default path.

Crucially, `GODEBUG` is *layered*. The runtime composes the effective value of each setting from:

1. The compiler-synthesised defaults (from the `go` line and any `//go:debug`/`godebug` directives), embedded in the binary.
2. The `GODEBUG` environment variable, parsed at startup, which overrides the embedded defaults for any setting it names.

So `setting.Value()` returns "env var if present, else the baked-in default." The baked-in default is itself the resolved precedence of go-line → go.mod `godebug` → `//go:debug`. By the time runtime code reads a setting, all four precedence levels have collapsed into one effective value.

The runtime also supports *runtime-mutable* settings via `godebug.Setting` change notifications, but the canonical model — and the only one that applies to the diagnostic and compatibility settings discussed here — is "resolved once at startup."

---

## The Compatibility-Default Pipeline

The end-to-end pipeline for a compatibility setting like `panicnil`:

1. **Authoring.** A change in the standard library that alters behavior introduces a setting via `godebug.New("panicnil")`. The code reads `panicnilSetting.Value()` and branches: old behavior if `"1"`, new behavior otherwise. When it takes the old path it calls `IncNonDefault()`.
2. **Default registration.** The toolchain knows, per Go release, what the default value of each setting should be. This mapping ("for `go 1.20`, `panicnil` defaults to `1`; for `go 1.21+`, it defaults to off") lives in the toolchain's GODEBUG default table.
3. **Build-time resolution.** When you build, the compiler reads the main module's `go` line, the `godebug` directives in `go.mod`, and any `//go:debug` lines in `package main`, resolves them against the default table, and produces the *effective embedded default* for every setting.
4. **Linking.** The linker writes those defaults into the binary as part of the build metadata, so the runtime can read them without re-deriving anything.
5. **Startup.** The runtime overlays the `GODEBUG` env var on top of the embedded defaults.
6. **Runtime.** Library code reads the resolved value and branches.

The design goal of this pipeline is that **behavior is a pure function of (source + go.mod + GODEBUG env)** and is *independent of the toolchain version* for any gated setting. That independence is the whole compatibility guarantee, and it is enforced by computing defaults from the `go` line rather than from the compiler's own version.

---

## Where Defaults Are Baked: Build-Time Synthesis

A subtlety worth internalising: the defaults are computed at *build* time, not run time. The binary carries the resolved defaults; the runtime does not re-derive them from the `go` line at startup (it cannot — the `go.mod` is not present at runtime).

You can observe the baked defaults. `go version -m ./binary` prints the build settings, including the resolved `GODEBUG` defaults under a `DefaultGODEBUG` build setting when non-empty:

```
$ go version -m ./app
./app: go1.23.0
        path    example.com/app
        mod     example.com/app  (devel)
        build   -buildmode=exe
        build   DefaultGODEBUG=panicnil=1,httplaxcontentlength=1
        build   vcs.revision=abc123...
        build   vcs.time=2026-01-15T10:00:00Z
        build   vcs.modified=false
```

The `DefaultGODEBUG` line is the resolved precedence of the `go` line and the directives, frozen into the binary. This is the authoritative answer to "what defaults does this binary actually use," and it is also surfaced in `ReadBuildInfo().Settings` as the `DefaultGODEBUG` key. For provenance tooling, this is a more reliable source than re-parsing `go.mod`, because it reflects exactly what was built.

---

## The `internal/godebug` Setting Mechanism

The `internal/godebug` package (internal, so not directly importable, but readable and conceptually important) is the registry every gated setting flows through. Its shape:

```go
// conceptual; from src/internal/godebug
type Setting struct {
    name  string
    // cached, atomically-updated current value and metric handle
}

func New(name string) *Setting { /* registers the setting */ }

func (s *Setting) Value() string        { /* effective value */ }
func (s *Setting) IncNonDefault()        { /* bump the metric */ }
```

Two properties matter for professionals:

- **`Value()` is cheap and cached.** It is safe to call on a hot path; the package caches the resolved value and only re-reads on change notification. Gating real behavior on `Value()` does not impose a parse cost per call.
- **`IncNonDefault()` is the source of the metrics.** The `/godebug/non-default-behavior/<name>:events` counter exists precisely because each gated site calls `IncNonDefault()` when it takes the old path. The metric is not magic introspection — it is explicit instrumentation in the standard library, one call per setting per non-default decision.

This is why only *some* settings have non-default-behavior counters: a counter exists if and only if the standard-library author wired an `IncNonDefault()` call. Purely diagnostic settings (`gctrace`) have no such counter because there is no "non-default behavior" to count — they only emit output.

---

## Non-Default-Behavior Counters in Detail

The counters are exposed through `runtime/metrics`, which is the stable, structured API (the `gctrace` text format is not stable; these counters are). Enumerate and read them:

```go
package main

import (
    "fmt"
    "runtime/metrics"
    "strings"
)

func nonDefaultBehavior() map[string]uint64 {
    all := metrics.All()
    var samples []metrics.Sample
    for _, d := range all {
        if strings.HasPrefix(d.Name, "/godebug/non-default-behavior/") &&
            strings.HasSuffix(d.Name, ":events") {
            samples = append(samples, metrics.Sample{Name: d.Name})
        }
    }
    metrics.Read(samples)
    out := make(map[string]uint64, len(samples))
    for _, s := range samples {
        if s.Value.Kind() == metrics.KindUint64 {
            out[s.Name] = s.Value.Uint64()
        }
    }
    return out
}

func main() {
    for name, v := range nonDefaultBehavior() {
        fmt.Printf("%-60s %d\n", name, v)
    }
}
```

Semantics to be precise about:

- **The set of counters is version-dependent.** `metrics.All()` returns whatever counters this Go version registered; do not hard-code names. Discover them.
- **Monotonic, per-process.** Each is a cumulative `events` counter from process start. Rate-of-change is the interesting signal; absolute value matters only as "zero vs nonzero."
- **Nonzero = the old path was taken at least once.** It does not say which call site or with what frequency beyond the count.
- **Zero ≠ safe.** It means "not exercised in this process," not "not depended upon." Inputs that trigger the path may not have occurred.

For fleet tooling, scrape these alongside the rest of `runtime/metrics` and alert on any counter transitioning zero → nonzero, especially right after a deploy or dependency bump.

---

## `SetGCPercent` and `SetMemoryLimit` Internals

Both functions feed the **GC pacer** — the runtime component that decides when to start a GC cycle and how much background scan work to schedule.

`SetGCPercent(p)`:

- Updates the pacer's heap-growth target. The next-cycle heap goal is roughly `liveHeap * (1 + p/100)`.
- Returns the previous percent.
- `p = -1` sets the percent to "off": ratio-driven GC is disabled, and only the memory limit (if set) can trigger a cycle.
- Calling it may trigger an immediate GC if the new, lower goal is already exceeded.

`SetMemoryLimit(n)`:

- Sets the pacer's memory-limit target in bytes. The pacer now has *two* goals — the ratio goal and the limit goal — and starts a cycle to satisfy whichever is reached first.
- The limit accounts for the runtime's *total* mapped, non-released memory: heap objects, stacks, and runtime metadata. It does not account for cgo or mmap.
- Returns the previous limit. `n = math.MaxInt64` means "no limit."
- The limit is soft and bounded by a CPU guard: the pacer will not let GC consume more than ~50% of CPU to chase the limit. Past that, it permits the limit to be exceeded rather than starve the mutator — the documented escape hatch from a total death spiral.

The interaction in one sentence: the pacer triggers GC at `min(ratioGoal, limitGoal)`, so a tight limit makes the limit goal dominate, raising GC frequency until either memory is contained or the CPU guard relents. This is the mechanism behind the senior-level death-spiral model.

`ReadGCStats(&s)` reads pacer/collector history: `NumGC`, `PauseTotal`, the `Pause` and `PauseEnd` ring buffers, and `PauseQuantiles` if you pre-size the slice. It is the legacy structured view; `runtime/metrics` is the modern, richer one, but `ReadGCStats` remains the quickest way to get pause history in a few lines.

---

## `FreeOSMemory`, `madvdontneed`, and OS Return

`FreeOSMemory()` does two things: forces a full GC, then asks the OS to reclaim as much freed heap memory as possible *immediately*, rather than on the runtime's lazy schedule.

The "return to OS" half interacts with `GODEBUG=madvdontneed`:

- On Linux, the runtime by default uses `MADV_FREE` to release pages — fast, but the pages count against RSS until the kernel reclaims them under pressure. This makes RSS look high even though the memory is logically free.
- `GODEBUG=madvdontneed=1` switches to `MADV_DONTNEED`, which returns pages eagerly so RSS drops promptly, at some CPU cost (page faults on next use).

This matters professionally because of *RSS-based accounting*: container memory dashboards and OOM-killer decisions often read RSS, and `MADV_FREE` makes a healthy Go process look memory-heavy. Teams running under cgroup limits frequently set `madvdontneed=1` so RSS reflects actual usage and the OOM killer is not misled. The trade-off is real CPU; measure it.

`FreeOSMemory` forces the eager return regardless of the `madvdontneed` setting for the pages it reclaims, which is why it is the lever after a known one-off spike — but it pays a full-GC cost each call, so it is a deliberate, occasional operation, not a routine one.

---

## `ReadBuildInfo` and the Embedded Build Block

`ReadBuildInfo` parses a block the linker embeds in the binary. The block is the canonical serialization of module and build metadata; `go version -m` parses the same block from the file on disk, while `ReadBuildInfo` reads it from within the running process.

The structure:

```go
type BuildInfo struct {
    GoVersion string         // e.g. "go1.23.0"
    Path      string         // main package import path
    Main      Module         // { Path, Version, Sum, Replace }
    Deps      []*Module      // transitive module list with versions and sums
    Settings  []BuildSetting // { Key, Value }
}
```

The `Settings` keys you care about:

- `vcs` — the VCS system (`git`, `hg`).
- `vcs.revision` — full commit hash.
- `vcs.time` — commit time, RFC3339.
- `vcs.modified` — `"true"` if the build tree had uncommitted changes.
- `GOOS`, `GOARCH`, `GOAMD64`, `CGO_ENABLED` — target/build config.
- `-ldflags`, `-tags`, `-trimpath`, `-buildmode` — build flags.
- `DefaultGODEBUG` — the resolved GODEBUG defaults (when non-empty).

`BuildInfo` also has a `String()` method that reproduces the `go version -m` format, useful for a `/debug/buildinfo`-style endpoint. The VCS stamps are populated by `go build`/`go install` when building from a VCS checkout and `-buildvcs` is not disabled; `ok=false` (or absent VCS settings) under `go run`, `go test` in some modes, or `-buildvcs=false`. Provenance tooling must handle the absent case rather than assume the stamps exist.

---

## Crash Output and Traceback Internals

`SetTraceback(level)` controls how much the runtime prints when it crashes (and overrides the `GOTRACEBACK` env var):

| Level | Behavior on crash |
|-------|-------------------|
| `none` / `0` | No goroutine stacks. |
| `single` / `1` | The crashing goroutine only (default). |
| `all` / `2` | All user goroutines. |
| `system` | All goroutines including runtime-internal ones. |
| `crash` | Like `system`, then aborts in a way that lets the OS write a core dump. |

`SetCrashOutput(f *os.File, opts CrashOptions)` (Go 1.23) registers an additional file descriptor that receives the crash report, in parallel with stderr. The runtime writes the traceback to this fd during the crash path. Because it is written by the crash handler — not the logging library — it survives a logging buffer that never flushed.

Professional uses:

- **Durable crash capture.** Point it at a file or pipe that a sidecar tails; you get crash tracebacks even when the process dies before flushing app logs.
- **Combine with `SetTraceback("all")`** so the captured report includes every goroutine — essential for diagnosing deadlocks and leaked goroutines visible only at crash time.
- **Multiple sinks** are supported across calls per the API contract; route to both a local file and a monitoring pipe.

This complements the recoverable-panic path (`recover()` + `debug.Stack()`): `SetCrashOutput`/`SetTraceback` are for the *fatal*, unrecoverable crash; `debug.Stack` is for the *handled* panic.

---

## Programmatic Inspection Without the `go` Tool

When tooling must inspect a binary or process without shelling out:

- **`debug.ReadBuildInfo()`** reads the running process's own build block.
- **`debug/buildinfo.ReadFile(path)`** (the `debug/buildinfo` package) reads the build block out of *another* binary on disk — the library form of `go version -m`. This is how SBOM and provenance scanners extract module versions from artifacts without invoking the toolchain.
- **`runtime/metrics`** is the structured, stable source for GC, scheduler, and non-default-behavior data. Prefer it over parsing `gctrace`/`ReadGCStats` text for anything automated.
- **`internal/godebug`** is not importable, but its observable effects (the metrics and the `DefaultGODEBUG` build setting) give you everything a tool needs.

The rule mirrors the modules world: do not re-implement the toolchain's resolution. Read the *outputs* it embedded — the build block and the metrics — rather than re-deriving GODEBUG defaults from `go.mod`, which would drift from the actual binary across Go releases.

---

## Edge Cases the Source Reveals

- **Unknown GODEBUG names are silently dropped.** No error, no warning. A typoed setting is a no-op; verify spelling against the GODEBUG history table.
- **`GODEBUG` env overrides embedded defaults per-setting, not wholesale.** Setting one name in the env does not reset the others to their zero value; unnamed settings keep their embedded defaults.
- **`DefaultGODEBUG` build setting is omitted when empty.** A binary whose `go` line implies all-modern defaults and has no directives shows no `DefaultGODEBUG` line. Absence means "all defaults," not "unknown."
- **The memory limit's CPU guard (~50%)** means a too-tight limit may *not* present as 100% GC CPU forever — beyond the guard, memory exceeds the limit. The symptom can flip between high-GC-CPU and limit-overshoot.
- **`SetMemoryLimit` ignores cgo/mmap memory.** A cgo-heavy process can exceed its container limit while the Go memory limit is satisfied, because the runtime does not see the C allocations.
- **`vcs.modified=true` does not change `vcs.revision`.** The revision is the last commit; the dirty flag is the only signal that the tree differed. A revision alone does not prove reproducibility.
- **`ReadGCStats` `PauseQuantiles` requires a pre-sized slice.** If you pass a zero-length slice you get no quantiles; size it to the number of quantiles you want (e.g., len 5 for min/25/50/75/max).
- **`FreeOSMemory` returns memory subject to the OS's own lazy reclaim under `MADV_FREE`**; RSS may not drop until pressure unless `madvdontneed` is set.

These are pointers to *reach for the source and the metrics* when behavior surprises you. The relevant code — `runtime/mgc*.go` for the pacer, `internal/godebug`, `runtime/debug` — is readable and the metrics make the runtime's decisions observable.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Confirm a binary's GODEBUG defaults | `go version -m ./app` and read the `DefaultGODEBUG` line. |
| Cap memory in a container | `GOMEMLIMIT=<90% of limit − non-Go mem>`; verify with `gctrace`. |
| Make RSS reflect real usage under cgroups | `GODEBUG=madvdontneed=1`; measure CPU cost. |
| Find a slow startup | `GODEBUG=inittrace=1`; read the fat `init` line. |
| Detect reliance on old behavior | Scrape `/godebug/non-default-behavior/*`; alert on zero→nonzero. |
| Capture fatal crashes durably | `SetTraceback("all")` + `SetCrashOutput(file, ...)`. |
| Extract module versions from an artifact | `debug/buildinfo.ReadFile(path)` (no toolchain needed). |
| Report running build | `debug.ReadBuildInfo()` → log + metric + auth-gated endpoint. |
| Investigate GC pressure | per-replica `GODEBUG=gctrace=1` to a dedicated stream; or `runtime/metrics`. |
| Cap thread blast radius | `debug.SetMaxThreads(n)` defensively at startup. |
| Verify a Go upgrade is behavior-neutral | Keep `go` line; bump toolchain; confirm no `DefaultGODEBUG` diff. |

---

## Summary

`GODEBUG` and `runtime/debug` are thin APIs over deep machinery. A GODEBUG setting's effective value is a build-time-resolved precedence of the `go` line, `go.mod` `godebug` directives, and `//go:debug` lines — frozen into the binary as the `DefaultGODEBUG` build setting — overlaid at startup by the environment variable, and consumed by the standard library through the `internal/godebug` registry (`Value()` to read, `IncNonDefault()` to drive the `/godebug/non-default-behavior/*` counters). Because defaults are computed from the `go` line and not the toolchain version, behavior is a pure function of source plus go.mod plus environment — the mechanism behind Go's compatibility guarantee.

On the `runtime/debug` side, `SetGCPercent` and `SetMemoryLimit` feed the GC pacer, which collects at `min(ratioGoal, limitGoal)` under a ~50% GC-CPU guard; `FreeOSMemory` forces a full GC and eager OS return, entangled with the `madvdontneed` RSS-accounting choice; `ReadBuildInfo` and `debug/buildinfo.ReadFile` parse the linker-embedded build block (including VCS stamps and `DefaultGODEBUG`); and `SetTraceback`/`SetCrashOutput` route fatal crashes to durable sinks. The professional move throughout is to read the toolchain's *outputs* — the build block and `runtime/metrics` — rather than re-derive them, so tooling stays correct across Go releases.
