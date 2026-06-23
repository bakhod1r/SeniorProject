# GODEBUG & `runtime/debug` — Find the Bug

> Each snippet contains a real-world bug related to `GODEBUG` or the `runtime/debug` package. `GODEBUG` is a comma-separated list of `name=value` settings the runtime reads **once at startup**; since Go 1.21 it also gates backward-incompatible behavior changes whose defaults come from the module's `go` line. `runtime/debug` exposes programmatic GC/memory controls, stack/heap dumps, and build-info access. Find the bug, explain it, fix it.

---

## Bug 1 — Expecting `GODEBUG` to change a running process

```go
func enableTracing() {
    os.Setenv("GODEBUG", "gctrace=1") // turn on GC tracing now
}

func main() {
    runWorkload()      // already running; no GC trace appears
    enableTracing()    // too late
    runMoreWorkload()  // still no GC trace
}
```

**Bug:** `GODEBUG` is parsed **once, at program startup**, before `main` runs. Calling `os.Setenv("GODEBUG", ...)` afterward does nothing for already-resolved settings — the runtime never re-reads it.

**Fix:** set it in the environment *before* launching the process. For in-process control of the GC, use `runtime/debug` instead (though `gctrace` itself has no programmatic equivalent — you must set it at launch):

```bash
GODEBUG=gctrace=1 ./app
```

---

## Bug 2 — `//go:debug` in a library package

```go
// package logging (NOT main)

//go:debug panicnil=1
package logging
```

```bash
$ go build ./...
./logging.go:1: //go:debug line only valid in package main
```

**Bug:** `//go:debug` directives configure an *executable's* default behavior. They are permitted **only in `package main`**. Placing one in a library is a compile error — and even if it compiled, it would not affect consumers.

**Fix:** move the directive to a file in `package main`, or set the module-wide default with a `godebug` directive in `go.mod`:

```
// go.mod
go 1.23
godebug panicnil=1
```

---

## Bug 3 — `//go:debug` separated from `package` by a blank line

```go
//go:debug tlsrsakex=1

package main

import "fmt"
func main() { fmt.Println("hi") }
```

**Bug:** A `//go:debug` directive must be in the comment block **immediately** preceding the `package` clause, with no blank line between. The blank line here detaches the comment from the package, so the directive is treated as an ordinary comment and silently ignored.

**Fix:** remove the blank line:

```go
//go:debug tlsrsakex=1
package main
```

---

## Bug 4 — Memory limit set below the working set

```go
func main() {
    debug.SetMemoryLimit(64 << 20) // 64 MiB "to be safe"
    cache := loadHugeCache()       // live set is ~300 MiB
    serve(cache)                   // GC runs nonstop, latency collapses
}
```

**Bug:** The soft memory limit is below the program's live working set. The runtime cannot reach the target, so it GCs back-to-back — the **GC death spiral**: high GC CPU, terrible latency, but no OOM (so RSS dashboards look fine).

**Fix:** size the limit above the working set, derived from the container limit:

```go
debug.SetMemoryLimit(int64(float64(containerLimitBytes) * 0.9))
```

Alert on GC CPU fraction, not just RSS, to catch this class of problem.

---

## Bug 5 — In-code `SetMemoryLimit` silently overrides the operator's `GOMEMLIMIT`

```go
func main() {
    debug.SetMemoryLimit(2 << 30) // hard-coded 2 GiB
    // ...
}
```

```bash
# ops sets a smaller limit for a constrained node — and it does nothing
GOMEMLIMIT=512MiB ./app
```

**Bug:** `GOMEMLIMIT` (env) and `SetMemoryLimit` (call) set the *same* dial; the later setter wins. The hard-coded call runs after the env var was applied at startup, so the operator's `GOMEMLIMIT` is overridden and ignored.

**Fix:** pick one source of truth. If ops should control it, don't hard-code a call — read from the environment, or only call `SetMemoryLimit` when the env var is absent:

```go
if _, ok := os.LookupEnv("GOMEMLIMIT"); !ok {
    debug.SetMemoryLimit(defaultLimit)
}
```

---

## Bug 6 — Disabling GC in a long-lived service

```go
func main() {
    debug.SetGCPercent(-1) // "maximize throughput"
    runForeverHTTPServer() // memory grows without bound → OOM
}
```

**Bug:** `SetGCPercent(-1)` **disables** the garbage collector. In a short-lived tool that is fine; in a long-running server the heap grows without bound until the process is OOM-killed.

**Fix:** keep GC enabled. To favor throughput while still capping memory, disable the *ratio* but set a *limit* — GC then runs only as memory approaches the ceiling:

```go
debug.SetGCPercent(-1)
debug.SetMemoryLimit(int64(float64(containerLimitBytes) * 0.9))
```

---

## Bug 7 — Ignoring `ok` from `ReadBuildInfo`

```go
func version() string {
    info, _ := debug.ReadBuildInfo() // ignored ok
    return info.Main.Version          // panics when info is nil
}
```

**Bug:** `ReadBuildInfo` returns `(nil, false)` when no build info is embedded — under `go run`, some test binaries, or `-buildvcs=false`. Dereferencing `info` then panics with a nil pointer.

**Fix:** branch on `ok`:

```go
func version() string {
    info, ok := debug.ReadBuildInfo()
    if !ok {
        return "unknown"
    }
    return info.Main.Version
}
```

---

## Bug 8 — `gctrace` output redirected to the wrong stream

```bash
$ GODEBUG=gctrace=1 ./app > gc.log
$ cat gc.log
# only the program's normal stdout — no GC lines
```

**Bug:** `gctrace` (and the other runtime traces) write to **stderr**, not stdout. Redirecting only stdout (`>`) sends the GC lines to the terminal instead of the file.

**Fix:** redirect stderr:

```bash
$ GODEBUG=gctrace=1 ./app 2> gc.log
# or merge both:
$ GODEBUG=gctrace=1 ./app > out.log 2>&1
```

---

## Bug 9 — `FreeOSMemory` on a hot path

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    resp := buildResponse(r)
    w.Write(resp)
    debug.FreeOSMemory() // "keep memory low" — on every request
}
```

**Bug:** `FreeOSMemory` forces a full GC and an eager OS return on *every request*. Under load this dominates CPU and tanks throughput — it is one of the most expensive things you can call per-request.

**Fix:** remove it from the request path. For steady-state memory control use `GOMEMLIMIT`; if RSS accounting matters, set `GODEBUG=madvdontneed=1`. Reserve `FreeOSMemory` for a one-off after a large batch:

```go
runNightlyBatch()
debug.FreeOSMemory() // once, after the spike
```

---

## Bug 10 — Misreading the `gctrace` heap triple

```go
// alerting rule, pseudo-code, parsing "50->52->30 MB"
liveHeapMB := parseFirst(gctraceTriple) // takes 50, the WRONG number
if liveHeapMB > threshold { alert() }
```

**Bug:** The triple is `heap-before -> heap-at-mark-termination -> live-after`. The **live heap is the third number** (30), not the first (50). The alert reads the pre-GC size and fires on transient peaks, not on actual live memory.

**Fix:** parse the third value — and better, stop parsing `gctrace` text entirely (it is not a stable API) and read `runtime/metrics` (`/gc/heap/live:bytes` or the heap-goal metrics) instead.

---

## Bug 11 — Assuming the toolchain version sets compatibility behavior

```
// go.mod
module example.com/app
go 1.20
```

```go
func mayPanicNil() {
    defer func() {
        r := recover()
        useRecovered(r) // expects nil sometimes
    }()
    panic(nil)
}
```

A teammate "upgrades to Go 1.23" by installing the new toolchain and expects `panic(nil)` to now raise `*runtime.PanicNilError`. It still delivers `nil`.

**Bug:** Compatibility defaults come from the **`go` line**, not the toolchain version. With `go 1.20` in `go.mod`, the binary keeps Go 1.20's `panicnil=1` behavior even when built by Go 1.23. The toolchain upgrade is deliberately behavior-neutral.

**Fix:** to opt into the new behavior, raise the `go` line (and review the change as a behavior change):

```
go 1.23
```

Or, to opt in without raising the whole baseline, set `//go:debug panicnil=0` in `package main`. To keep the old behavior on a new `go` line, set `panicnil=1`.

---

## Bug 12 — Pinned compatibility setting left to rot

```go
//go:debug x509sha1=1   // added 3 years ago "to unblock a deploy"
package main
```

```bash
$ go build ./...
# years later, after a toolchain upgrade:
panic: godebug: unknown setting "x509sha1"
```

**Bug:** Compatibility GODEBUG settings are **removed** after a deprecation window. A setting pinned years ago and never revisited eventually stops existing; the build (or runtime) then fails because the setting is gone — and the old behavior with it.

**Fix:** treat every pin as debt with an expiry. Track it to a removal date, fix the root cause (here: stop relying on SHA-1 certificates), and remove the pin. Use the `/godebug/non-default-behavior/x509sha1:events` counter to confirm whether the old path is still exercised before removing.

---

## Bug 13 — `SetMemoryLimit` blind to cgo memory

```go
func main() {
    // container hard limit is 1 GiB
    debug.SetMemoryLimit(950 << 20) // leave 74 MiB headroom
    runImageProcessor()             // uses a cgo library allocating ~400 MiB off-heap
}
// process is OOM-killed despite the limit
```

**Bug:** The soft memory limit accounts only for **runtime-managed** memory — heap, stacks, runtime metadata. It is blind to cgo and mmap allocations. The cgo library's ~400 MiB is invisible to the limit, so total cgroup memory blows past 1 GiB and the OOM killer fires even though the Go limit is "satisfied."

**Fix:** subtract non-Go memory when sizing the limit:

```go
// limit ≈ container − non-Go memory − headroom
debug.SetMemoryLimit((1 << 30) - (450 << 20))
```

Track cgo allocations separately; the Go limit cannot do it for you.

---

## Bug 14 — `debug.Stack()` used to debug a deadlock across goroutines

```go
func dumpOnSignal() {
    <-sigChan
    log.Printf("goroutines:\n%s", debug.Stack()) // only ONE goroutine
}
```

**Bug:** `debug.Stack()` returns only the **current** goroutine's stack. To diagnose a deadlock you need *all* goroutines' stacks; this dumps just the signal handler's, which is useless for the investigation.

**Fix:** use `runtime.Stack` with `all=true`, or send the process `SIGQUIT` (the runtime dumps every goroutine):

```go
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true) // all goroutines
log.Printf("goroutines:\n%s", buf[:n])
```

---

## Bug 15 — Parsing `gctrace` as a stable metrics source

```go
// scrapes gctrace lines into Prometheus
re := regexp.MustCompile(`gc \d+ @[\d.]+s (\d+)%`)
// breaks after a Go upgrade changes the line format
```

**Bug:** The `gctrace` text format is **not a stable API**. It changes between Go releases. A dashboard built on parsing it silently breaks (or produces wrong numbers) after a toolchain upgrade.

**Fix:** read the structured, stable `runtime/metrics` API instead:

```go
samples := []metrics.Sample{{Name: "/gc/cycles/total:gc-cycles"}}
metrics.Read(samples)
```

Use `gctrace` for ad-hoc human investigation only; never as a programmatic data source.

---

## Bug 16 — Shipping a dirty-tree build to production

```go
func main() {
    info, _ := debug.ReadBuildInfo()
    log.Printf("revision=%s", revisionOf(info)) // logs a commit hash, looks fine
    // ... but vcs.modified=true and nobody checks it
}
```

**Bug:** The logged `vcs.revision` looks authoritative, but `vcs.modified=true` means the binary was built from a tree with uncommitted changes. The revision does **not** fully describe the binary — it is unreproducible — and this build reached production unnoticed.

**Fix:** check `vcs.modified` and refuse/flag dirty builds:

```go
for _, s := range info.Settings {
    if s.Key == "vcs.modified" && s.Value == "true" {
        log.Fatal("refusing to run a dirty-tree build in production")
    }
}
```

Better, enforce it in the deploy pipeline, not just at runtime.

---

## Bug 17 — Exposing the full dependency list publicly

```go
func versionHandler(w http.ResponseWriter, r *http.Request) {
    info, _ := debug.ReadBuildInfo()
    fmt.Fprint(w, info.String()) // dumps every module and version, unauthenticated
}
```

**Bug:** `BuildInfo.String()` (and `info.Deps`) lists every dependency and its exact version. Served unauthenticated on the public internet, it is a ready-made inventory for matching your dependencies against known CVEs.

**Fix:** expose only a short revision publicly; gate the full build info behind authentication:

```go
func versionHandler(w http.ResponseWriter, r *http.Request) {
    info, _ := debug.ReadBuildInfo()
    if !authorized(r) {
        fmt.Fprintln(w, shortRevision(info)) // commit only
        return
    }
    fmt.Fprint(w, info.String())
}
```

---

## Bug 18 — Treating `non-default-behavior` zero as proof of safety

```go
// pre-upgrade check
if nonDefaultBehavior("/godebug/non-default-behavior/panicnil:events") == 0 {
    raiseGoLineTo("1.21") // "nothing depends on the old behavior"
}
```

**Bug:** A zero counter means the old code path was **not exercised in this process's lifetime**, not that no code depends on it. A `panic(nil)` reachable only under rare inputs may never have run during the short check window — so the counter is zero while the dependency is real.

**Fix:** treat zero as "no evidence of reliance," not "proof of safety." Run the check across representative load and a long window, combine it with tests and code review, and raise the `go` line as a staged, reversible change with pins available as a bridge.

---

## Bug 19 — `madvdontneed` confusion: RSS "leak" that isn't

```bash
$ ./app   # RSS sits at 800 MiB long after a spike freed most of it
# team concludes there's a memory leak and adds FreeOSMemory everywhere
```

**Bug:** On Linux, the runtime defaults to `MADV_FREE`, which lets freed pages count against RSS until the kernel reclaims them under pressure. The memory is logically free; RSS just lags. Concluding "leak" and sprinkling `FreeOSMemory` adds expensive full GCs to fight a non-problem.

**Fix:** if RSS must reflect freed memory promptly (e.g., for cgroup accounting), set `GODEBUG=madvdontneed=1` to use `MADV_DONTNEED`:

```bash
$ GODEBUG=madvdontneed=1 ./app
```

Confirm it's not a real leak first via heap profiling (`pprof`), not RSS.

---

## Bug 20 — Misspelled GODEBUG setting, silently ignored

```bash
$ GODEBUG=gctrace=1 ./app   # typo: gctRAce
# no GC output; engineer assumes the program has no GC activity
```

**Bug:** Unknown `GODEBUG` names are **silently ignored** — no error, no warning. The typo `gctrace` → `gctrace` (here `gctrace`) produces no output, leading to the false conclusion that GC isn't running.

**Fix:** verify the exact name against the docs / GODEBUG history table, and double-check spelling when expected output is missing:

```bash
$ GODEBUG=gctrace=1 ./app 2>&1 | head
```

---

## Bug 21 — Crash traceback lost because only stderr was used

```go
func main() {
    // logs go through a buffered, async logger
    log.SetOutput(asyncBufferedWriter)
    runServer() // a goroutine panics fatally; the traceback never reaches durable storage
}
```

**Bug:** A fatal crash's traceback goes to stderr via the runtime's crash path, which may be lost or truncated when the process dies — especially if stderr is wired into a buffered/async logger that never flushes. The most important diagnostic is exactly the one lost.

**Fix:** route crash output to a durable sink with `SetCrashOutput` (Go 1.23) and widen the traceback:

```go
f, _ := os.OpenFile("/var/log/app/crash.log",
    os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
debug.SetCrashOutput(f, debug.CrashOptions{})
debug.SetTraceback("all")
```

A sidecar tails `crash.log`; the traceback now survives the crash.

---

## Bug 22 — Bumping the `go` line and toolchain in one unreviewed commit

```diff
- go 1.20
+ go 1.23
```

Committed as part of "chore: update Go", merged with a rubber stamp. A week later, TLS handshakes to a legacy partner start failing because Go 1.21+ dropped the RSA key-exchange cipher suites by default.

**Bug:** Raising the `go` line flips *every* compatibility default at once. Conflating it with a routine toolchain update hides a real behavior change (here, `tlsrsakex` defaulting off) behind an innocuous-looking diff, with no instrumentation or canary.

**Fix:** treat `go`-line changes as a distinct risk class. Upgrade the toolchain first (behavior-neutral), then raise the `go` line as its own reviewed change, instrumented with the `non-default-behavior` counters and rolled out via canary. Pin individual settings as a temporary bridge if needed:

```go
//go:debug tlsrsakex=1   // bridge: legacy partner still needs RSA kex; ticket APP-1234
package main
```

---

## Summary

`GODEBUG` and `runtime/debug` are small surfaces with sharp edges. Most bugs come from one of four habits:

1. **Forgetting `GODEBUG` is startup-only and external.** It cannot be changed on a running process, unknown names are silently ignored, traces go to stderr, and `//go:debug` only works in `package main` with no detaching blank line.
2. **Mishandling the soft memory limit.** It is a target, not a cap; set below the working set it causes a GC death spiral (invisible to RSS alerts); it ignores cgo/mmap memory; and an in-code call silently overrides the operator's `GOMEMLIMIT`.
3. **Misusing the controls.** `SetGCPercent(-1)` in a long-lived service leaks memory; `FreeOSMemory` on a hot path is ruinous; `debug.Stack()` is one goroutine, not all.
4. **Misunderstanding the compatibility system.** The `go` line (not the toolchain) selects defaults; pinned settings expire; `non-default-behavior` zero is not proof of safety; and `go`-line bumps are behavior changes deserving review.

Read structured `runtime/metrics`, not `gctrace` text; check `ok` from `ReadBuildInfo`; never ship a dirty build or expose the full dependency list; and route fatal crashes to durable storage. With those habits the rest is straightforward.
