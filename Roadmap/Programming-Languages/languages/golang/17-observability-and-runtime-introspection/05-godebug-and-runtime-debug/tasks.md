# GODEBUG & `runtime/debug` — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Turn on GC tracing

Take any allocation-heavy Go program (or write a `main` that appends a million 1 KiB slices). Run it with:

```bash
GODEBUG=gctrace=1 ./app 2> gc.log
```

Open `gc.log` and identify, on one line: the cycle number, the cumulative GC CPU `%`, and the `a->b->c MB` triple. Point to the live-heap number.

**Goal.** Read a `gctrace` line fluently and find the live heap (the third number).

---

### Task 2 — Set the GC percent in code and observe the difference

Write a program that allocates in a loop. Run it once normally with `gctrace=1`, then add `debug.SetGCPercent(20)` at the top of `main` and run again. Compare the number of GC cycles in each run.

**Goal.** See that a lower GC percent means more frequent GC (less memory, more CPU).

---

### Task 3 — Apply a soft memory limit two ways

Set a memory limit on the same program twice: once via the environment (`GOMEMLIMIT=64MiB ./app`) and once via code (`debug.SetMemoryLimit(64 << 20)`). With `gctrace=1`, observe that the GC frequency rises as the heap nears the limit.

**Goal.** Internalise that `GOMEMLIMIT` and `SetMemoryLimit` set the same soft dial.

---

### Task 4 — Print build info

Write a program that calls `debug.ReadBuildInfo()`, checks `ok`, and prints the module path, Go version, and the `vcs.revision`/`vcs.time`/`vcs.modified` settings. Build it with `go build` from inside a git repo and run it. Then run it with `go run main.go` and note the difference.

**Goal.** Read VCS provenance and observe `ok=false` (or missing VCS settings) under `go run`.

---

### Task 5 — Dump a goroutine stack on panic

Write a function that panics, wrapped in a `defer`/`recover` that calls `debug.PrintStack()`. Confirm the stack is printed and the program continues rather than crashing.

**Goal.** Use `debug.Stack`/`PrintStack` in a recovery path.

---

## Medium

### Task 6 — Compare `go version -m` with `ReadBuildInfo`

Build your Task 4 binary. Run `go version -m ./app` and compare its output to what your program prints from `ReadBuildInfo`. Confirm they report the same module versions and VCS stamps.

**Goal.** Understand that `ReadBuildInfo` is the in-process form of `go version -m`.

---

### Task 7 — Time package init with `inittrace`

Add an `init()` to your `main` package that does something measurable (e.g., builds a large map). Run with `GODEBUG=inittrace=1 ./app` and find your package's `init` line — note its `clock` time and `bytes` allocated.

**Goal.** Use `inittrace` to attribute slow startup to a specific package's init.

---

### Task 8 — Read a `schedtrace` summary

Run a program that spawns many goroutines doing CPU work with `GODEBUG=schedtrace=1000 ./app`. Read one `SCHED` line: identify `gomaxprocs`, `idleprocs`, `threads`, and `runqueue`. Then add `scheddetail=1` and observe the per-P/G detail.

**Goal.** Read the scheduler summary and know when to escalate to `scheddetail`.

---

### Task 9 — Inspect non-default-behavior counters

Write a program with `//go:debug panicnil=1` in `package main` that does `panic(nil)` inside a recovered goroutine. After the panic, enumerate `runtime/metrics` for `/godebug/non-default-behavior/` counters and print any that are nonzero.

**Goal.** Observe the compatibility system measuring your reliance on old behavior.

---

### Task 10 — Demonstrate the `go` line selecting defaults

Create a module with `go 1.20` in `go.mod`, build it with a modern toolchain, and confirm `panic(nil)` delivers `nil` to `recover`. Bump the `go` line to `1.21+`, rebuild, and confirm `panic(nil)` now raises `*runtime.PanicNilError`. Do not change any code.

**Goal.** See that the `go` line, not the toolchain version, selects compatibility behavior.

---

## Hard

### Task 11 — Find the GC death spiral

Write a program that holds a live working set of ~200 MB. Set `GOMEMLIMIT=100MiB` (below the working set). Run with `gctrace=1` and observe the GC running back-to-back and the cumulative `%` climbing. Then raise the limit above the working set and confirm the spiral stops.

**Goal.** Reproduce and recognise the death spiral; understand that RSS alone would not reveal it.

---

### Task 12 — Build a `/version` endpoint

Write an HTTP server with a `/version` handler that returns the running commit, Go version, and module version from `ReadBuildInfo`, plus a `build_info`-style Prometheus gauge with those as labels. Gate the full dependency list behind a header/auth check.

**Goal.** Wire build provenance into a real service the way production code does.

---

### Task 13 — Durable crash capture (Go 1.23+)

Write a program that registers `debug.SetCrashOutput` to a file and `debug.SetTraceback("all")`, then deliberately triggers a fatal crash (e.g., an unrecovered panic in a goroutine). Confirm the crash file contains the full traceback of all goroutines, separate from stderr.

**Goal.** Capture unrecoverable crashes to durable storage.

---

### Task 14 — RSS vs `MADV_FREE`

Allocate and free a large slice, then call `debug.FreeOSMemory()`. Watch RSS (e.g., `ps`/`/proc/self/status`) before and after. Run once with default settings and once with `GODEBUG=madvdontneed=1` and compare how promptly RSS drops.

**Goal.** Understand why RSS can look high under `MADV_FREE` and how `madvdontneed` changes it.

---

### Task 15 — `GOGC=off` plus a limit

Configure a throughput-bound batch program with `GOGC=off` (or `SetGCPercent(-1)`) and a `GOMEMLIMIT`. With `gctrace=1`, confirm GC runs *only* as memory approaches the limit and the heap is otherwise allowed to grow freely. Compare total GC CPU to the default-`GOGC` run.

**Goal.** Use the documented "let it grow, but never past N" configuration.

---

## Bonus / Stretch

### Task 16 — Diff `DefaultGODEBUG` across builds

Build the same program from a `go 1.20` module and a `go 1.23` module. Run `go version -m` on each and diff the `DefaultGODEBUG` build setting. Explain each difference.

**Goal.** See the resolved compatibility defaults baked into the binary.

---

### Task 17 — Extract build info from an artifact without the toolchain

Write a tool using `debug/buildinfo.ReadFile(path)` that reads module versions and VCS stamps out of *another* binary on disk. Run it against several binaries. Compare to `go version -m`.

**Goal.** Build SBOM-style provenance extraction without invoking `go`.

---

### Task 18 — Guardrail with `SetMaxThreads`

Write a program that leaks goroutines blocked in a syscall (each consuming an OS thread). Set `debug.SetMaxThreads(50)` and confirm the program aborts with a clear message once the cap is hit, instead of silently exhausting host threads.

**Goal.** Use a `runtime/debug` guardrail to bound blast radius.

---

### Task 19 — Pin and then unpin a compatibility setting

Take Task 10's `go 1.23` module that now raises on `panic(nil)`. Add `//go:debug panicnil=1` to restore the old behavior. Confirm via the non-default-behavior counter that the old path is exercised. Then refactor the code to not `panic(nil)`, remove the pin, and confirm the counter no longer increments.

**Goal.** Practice the pin-as-a-bridge workflow with measurement.

---

### Task 20 — Decide GOMEMLIMIT for a real container

For a real service, measure its steady-state live heap (the third `gctrace` number), estimate non-Go memory (cgo, mmap, caches), and compute `GOMEMLIMIT = container limit − non-Go − 10% headroom`. Set it, run under load, and confirm GC CPU stays reasonable (no spiral) and RSS stays under the container limit. Write a one-paragraph justification.

**Goal.** Turn the memory-limit sizing rule into a defensible production setting.

---

## Solutions (sketched)

### Solution 1
The triple is `before -> at-mark-term -> live-after`; the last number is the live heap. The `%` is cumulative GC CPU, not per-cycle.

### Solution 2
Lower `SetGCPercent` → smaller heap goal → GC triggers sooner → more cycles in `gc.log`. Memory footprint shrinks; GC CPU rises.

### Solution 3
Both forms hit the same pacer dial. Near the limit, GC frequency climbs as the limit goal beats the ratio goal. If you set both, the later setter (the in-code call) wins.

### Solution 4
```go
info, ok := debug.ReadBuildInfo()
if !ok { /* go run, or no build info */ }
for _, s := range info.Settings {
    if strings.HasPrefix(s.Key, "vcs.") { fmt.Println(s.Key, "=", s.Value) }
}
```
Under `go run`, `ok` may be false or VCS settings absent.

### Solution 5
```go
defer func() {
    if r := recover(); r != nil { debug.PrintStack() }
}()
```
The stack prints to stderr; the program continues.

### Solution 6
`go version -m` parses the build block from the file on disk; `ReadBuildInfo` reads the same block from the running process. Versions and VCS stamps match.

### Solution 7
The fat `init` line shows `@start ms`, `clock` duration, and `bytes`/`allocs`. A slow startup is usually one dominant `init` line.

### Solution 8
`gomaxprocs` = logical CPUs, `idleprocs` = idle Ps now, `threads` = OS threads created, `runqueue` = goroutines in the global queue. `scheddetail=1` adds per-P/M/G state — use it only when the summary is insufficient.

### Solution 9
```go
for _, d := range metrics.All() {
    if strings.HasPrefix(d.Name, "/godebug/non-default-behavior/") { /* sample */ }
}
```
`/godebug/non-default-behavior/panicnil:events` is nonzero after the recovered `panic(nil)`.

### Solution 10
With `go 1.20`, default `panicnil=1` (old behavior). With `go 1.21+`, the new behavior raises `*runtime.PanicNilError`. The toolchain is identical; only the `go` line moved.

### Solution 11
Limit below working set → the limit goal can never be met → GC runs continuously, cumulative `%` climbs. RSS stays capped, so an RSS-only view hides it. Raising the limit above the working set stops it. The runtime's ~50% GC-CPU guard eventually lets memory overshoot instead.

### Solution 12
```go
info, _ := debug.ReadBuildInfo()
// expose revision/goversion publicly; gate info.Deps behind auth.
```
Emit a `build_info{revision=...,go_version=...} 1` gauge too.

### Solution 13
```go
f, _ := os.OpenFile("crash.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
debug.SetCrashOutput(f, debug.CrashOptions{})
debug.SetTraceback("all")
```
The fatal traceback lands in `crash.log` with all goroutines, surviving even if app logs didn't flush.

### Solution 14
Default `MADV_FREE` leaves pages counted in RSS until kernel pressure; `madvdontneed=1` returns them eagerly so RSS drops promptly — at some CPU cost. `FreeOSMemory` forces the GC and eager return.

### Solution 15
`GOGC=off` disables the ratio goal; only the limit triggers GC. The heap grows freely until near the limit, minimising GC cycles and total GC CPU for throughput-bound work, while still capping memory.

### Solution 16
The `DefaultGODEBUG` build setting lists the resolved compatibility defaults. The `go 1.20` build will show old-behavior settings (e.g., `panicnil=1`) that the `go 1.23` build omits.

### Solution 17
```go
bi, err := buildinfo.ReadFile("./app")
```
`debug/buildinfo.ReadFile` extracts the build block from any binary — the library form of `go version -m`, no `go` tool needed.

### Solution 18
Each goroutine blocked in a syscall pins an OS thread. `SetMaxThreads(50)` makes the runtime abort with a clear "thread exhaustion" message at the cap, turning silent host exhaustion into a loud, early failure.

### Solution 19
Pin `//go:debug panicnil=1`, confirm the counter increments, fix the code, remove the pin, confirm the counter stays zero. The pin is a measured bridge, not a destination.

### Solution 20
`GOMEMLIMIT = container − non-Go − 10%`. Validate under load: GC CPU stays moderate (no spiral), RSS stays under the container limit. The live heap (`gctrace` third number) must be comfortably below the limit, or you've created a spiral.

---

## Checkpoints

After the easy tasks: you can read `gctrace`, set the GC percent and memory limit, print build info, and dump a stack on panic.
After the medium tasks: you can use `inittrace`/`schedtrace`, read non-default-behavior counters, and demonstrate the `go` line selecting compatibility defaults.
After the hard tasks: you can reproduce and recognise the GC death spiral, wire build provenance and durable crash capture into a service, and reason about RSS vs `MADV_FREE`.
After the bonus tasks: you can diff `DefaultGODEBUG` across builds, extract provenance without the toolchain, apply runtime guardrails, run the pin-then-unpin workflow with measurement, and size `GOMEMLIMIT` for a real container with justification.
