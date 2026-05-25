# Runtime Hooks — Tasks

A set of hands-on tasks for building real fluency with runtime hooks. Each lists the goal, the steps, and the acceptance criteria — what you must be able to demonstrate.

---

## Task 1. Build a `/runtime` introspection endpoint

**Goal.** Expose the four operationally important numbers (heap live, goroutines, GC CPU, pause p99) as a JSON endpoint.

**Steps.**
1. Use `runtime/metrics.Read` (not `ReadMemStats`).
2. Read `/memory/classes/heap/objects:bytes`, `/sched/goroutines:goroutines`, `/cpu/classes/gc/total:cpu-seconds`, `/gc/pauses:seconds`.
3. For the pause histogram, compute p99 from buckets and counts.
4. Serve JSON on `127.0.0.1:6060/runtime`.

**Acceptance criteria.**
- Endpoint returns valid JSON in < 1 ms.
- Bound to localhost only.
- p99 calculation handles empty histograms without crashing.

---

## Task 2. Wire `GOMEMLIMIT` from cgroups

**Goal.** At startup, read the container memory limit and call `debug.SetMemoryLimit` with 90% of it.

**Steps.**
1. Detect cgroup version (v1 vs v2).
2. Read `/sys/fs/cgroup/memory.max` (v2) or `memory.limit_in_bytes` (v1).
3. Skip if the value is "max" or unreasonably large (e.g., > 1 TiB).
4. Call `debug.SetMemoryLimit(int64(0.9 * limit))`.
5. Log the applied limit at startup.

**Acceptance criteria.**
- Works in a Docker container with `--memory=512m`.
- Falls back gracefully on non-Linux hosts (logs and continues).
- Verified via `debug.SetMemoryLimit(-1)` matching the expected value.

---

## Task 3. Capture a CPU profile programmatically

**Goal.** A function that captures N seconds of CPU profile and writes it to a file.

**Steps.**
1. `pprof.StartCPUProfile(f)`.
2. `time.Sleep(d)`.
3. `pprof.StopCPUProfile()`.
4. Provide an HTTP variant: `/debug/profile?seconds=30`.

**Acceptance criteria.**
- The output is a valid pprof file (verified with `go tool pprof` opening it).
- The HTTP variant rejects `seconds > 60`.
- The handler returns the bytes inline (Content-Type `application/octet-stream`).

---

## Task 4. Capture a runtime trace via HTTP

**Goal.** Same as Task 3 but for execution traces.

**Steps.**
1. `trace.Start(w)`, sleep, `trace.Stop()`.
2. Bound the duration server-side to ≤ 30 seconds.
3. Serve at `/debug/trace?seconds=N`.

**Acceptance criteria.**
- `go tool trace trace.out` opens the file.
- Trace shows scheduling events for the capture window.
- Excessive duration is rejected (HTTP 400).

---

## Task 5. Signal-driven graceful shutdown

**Goal.** Replace `signal.Notify(c, ...)` boilerplate with `signal.NotifyContext` and a `Shutdown` call.

**Steps.**
1. Build a context that cancels on SIGINT/SIGTERM.
2. Pass to an `http.Server`.
3. On signal, call `srv.Shutdown(ctxWithTimeout)` with 30 s budget.
4. Ensure `flushMetrics()` and `flushLogs()` run via `defer`, not after `os.Exit`.

**Acceptance criteria.**
- Sending SIGTERM causes in-flight requests to complete (within 30 s).
- New connections are refused immediately after the signal.
- Log output proves both flushers ran.

---

## Task 6. Crash output forwarding

**Goal.** Wire `debug.SetCrashOutput` to a local file. On a panic, the traceback ends up in both stderr and the file.

**Steps.**
1. `os.OpenFile("/var/log/myapp-crash.log", O_RDWR|O_CREATE|O_APPEND, 0o600)`.
2. `debug.SetCrashOutput(f, debug.CrashOptions{})`.
3. Write a test that panics and verify the file content.

**Acceptance criteria.**
- After a panic, the file contains a traceback identical to stderr.
- The file is created with mode 0600.
- Multiple panics in a multi-goroutine test all land in the file.

---

## Task 7. Prometheus exporter for `runtime/metrics`

**Goal.** Register the Prometheus Go collector with `runtime/metrics` enabled.

**Steps.**
1. Use `collectors.NewGoCollector(collectors.WithGoCollections(...))`.
2. Enable `GoRuntimeMetricsCollection`.
3. Disable the legacy `GoRuntimeMemStatsCollection` if not needed.
4. Add `/metrics` to your HTTP mux (behind admin auth or localhost).

**Acceptance criteria.**
- `curl localhost:6060/metrics` contains `go_gc_pauses_seconds_bucket`.
- Goroutine count metric appears as `go_sched_goroutines_goroutines`.
- Scraping does not stop the world (verified by lack of latency spikes).

---

## Task 8. Per-handler pprof labels

**Goal.** Wrap an HTTP mux so every CPU profile sample carries a `handler=…` label.

**Steps.**
1. Implement a middleware that calls `pprof.Do(ctx, pprof.Labels("handler", routeName), fn)`.
2. Determine `routeName` from the request (e.g., chi's route pattern).
3. Apply to all handlers via `mux.Use(middleware)` or wrapping.

**Acceptance criteria.**
- Capture a CPU profile under load.
- `go tool pprof -tags cpu.pprof` shows the `handler` label.
- `tagfocus 'handler=/api/v1/foo'` filters to one route.

---

## Task 9. `runtime.AddCleanup` resource finalizer

**Goal.** Replace a `SetFinalizer`-based resource (e.g., file descriptor) with `AddCleanup` (Go 1.24+).

**Steps.**
1. Define a `Resource` struct that holds an `int` fd.
2. Register a cleanup with `runtime.AddCleanup(r, closeFn, fd)`.
3. Provide an explicit `Close()` that calls `Cleanup.Stop()` and closes the fd.
4. Write a test that verifies both paths (explicit Close and finalization).

**Acceptance criteria.**
- Explicit `Close()` does not run the cleanup.
- Letting the resource go out of scope eventually triggers the cleanup (force with `runtime.GC()` in the test).
- No goroutine or fd leaks (verify with `runtime.NumGoroutine` and `/proc/self/fd`).

---

## Task 10. Goroutine leak detector test helper

**Goal.** A test helper that detects goroutine leaks across test cases.

**Steps.**
1. At the start of each test, record `runtime.NumGoroutine()`.
2. At the end (in `t.Cleanup`), poll until the count returns to the recorded value or fail with a stack dump.
3. Use `pprof.Lookup("goroutine").WriteTo(w, 1)` for the dump on failure.

**Acceptance criteria.**
- A test that intentionally leaks a goroutine fails with a useful stack.
- A test with no leak passes within 100 ms.
- The helper handles runtime-internal goroutines (allow ±5 from baseline).

---

## Task 11. `GODEBUG=schedtrace=1000` analysis

**Goal.** Run a benchmark with `schedtrace=1000` and interpret one line.

**Steps.**
1. Build a small CPU-bound benchmark (e.g., compute primes for 30 s).
2. Run with `GODEBUG=schedtrace=1000 ./bench > sched.log 2>&1`.
3. Extract the P/M/G counts from each line.
4. Plot them over time (any tool — even gnuplot).

**Acceptance criteria.**
- You can explain what each field in a `SCHED` line means.
- You identify when work-stealing happens (idle P with runnable G).
- The plot makes it obvious whether you are CPU-bound or contention-bound.

---

## Task 12. Heap profile diff tooling

**Goal.** Capture two heap profiles 5 minutes apart and produce the diff.

**Steps.**
1. `pprof.WriteHeapProfile(f1)` at T0.
2. Generate steady load on the service.
3. `pprof.WriteHeapProfile(f2)` at T0+5m.
4. `go tool pprof -base f1 f2` and `top` / `web`.

**Acceptance criteria.**
- The diff highlights net allocations between the snapshots.
- If you intentionally leak (e.g., add to a global slice), the leak source appears at the top.
- Document the procedure in your team's runbook.

---

## Task 13. Build info on `/version`

**Goal.** Expose `debug.ReadBuildInfo` on a `/version` endpoint, including VCS metadata.

**Steps.**
1. `debug.ReadBuildInfo()`.
2. Extract `Main.Path`, `Main.Version`, and settings: `vcs.revision`, `vcs.time`, `vcs.modified`, `GOOS`, `GOARCH`.
3. Return JSON.

**Acceptance criteria.**
- Built with `-trimpath` from a clean git checkout, the response includes a non-empty `vcs.revision`.
- A test verifies the JSON shape.
- The endpoint is safe to expose publicly (no source paths or env values).

---

## Task 14. Continuous `runtime/metrics` snapshot ring

**Goal.** A background goroutine that snapshots key metrics every second into a ring buffer, exposed at `/snapshots`.

**Steps.**
1. Define a `Snapshot` struct with the fields you care about.
2. A goroutine calls `metrics.Read` once per second.
3. Push into a fixed-size ring (e.g., 600 snapshots = 10 minutes).
4. Expose the most recent N as JSON.

**Acceptance criteria.**
- The snapshot goroutine survives panics in `metrics.Read` (it shouldn't panic, but be defensive).
- Memory usage of the ring is bounded.
- The endpoint returns < 1 ms for `N=60`.

---

## 15. Summary

These tasks build the operational muscle behind every chapter: budgeting memory via `GOMEMLIMIT`, exposing health via `runtime/metrics`, capturing CPU/trace on demand, labeling profiles, replacing `SetFinalizer` with `AddCleanup`, signal-driven shutdown, crash forwarding. Finish them and you can wire runtime observability into any service in an afternoon.

---

## Further reading
- Go diagnostics guide: https://go.dev/doc/diagnostics
- `runtime/pprof` examples: https://pkg.go.dev/runtime/pprof#example-StartCPUProfile
- Prometheus Go collector: https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/collectors
- `automemlimit` source: https://github.com/KimMachineGun/automemlimit
