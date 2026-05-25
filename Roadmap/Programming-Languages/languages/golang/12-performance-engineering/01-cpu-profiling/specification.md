# CPU Profiling in Go — Specification

> **Focus:** Precise reference for how Go captures CPU profiles — the sampling mechanism, the public APIs, the wire format, and the tools that read them.
>
> **Sources:**
> - `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
> - `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
> - `testing` package profiling flags: https://pkg.go.dev/testing
> - `pprof` tool: https://github.com/google/pprof
> - pprof profile format: https://github.com/google/pprof/blob/main/proto/profile.proto

---

## 1. What a CPU profile is

A CPU profile is a **statistical sample** of program execution. The runtime periodically interrupts the program and records the call stack of whichever goroutine was running on each thread. The resulting set of stacks is aggregated into a weighted call graph: each frame's weight is proportional to the number of samples in which it appeared.

| Property | Value |
|----------|-------|
| Mechanism | OS timer signal (`SIGPROF` on Linux/macOS) sent to threads |
| Default rate | 100 Hz (one sample every 10 ms) |
| Resolution | The duration of a sample — 10 ms by default |
| Scope | One profile per process; covers all goroutines on all threads |
| Output | `pprof` protobuf (gzipped), file extension `.pprof` or `.pb.gz` |
| Cost | ~1–5% CPU overhead at 100 Hz; negligible memory |

A 30-second profile at 100 Hz on 8 cores yields up to 24,000 samples — enough resolution to find any function consuming ≥0.5% of CPU.

---

## 2. How sampling works under the hood

```
kernel → SIGPROF → signal handler → record stack of current goroutine → continue
```

1. The runtime calls `setitimer(ITIMER_PROF, ...)` to request a periodic signal.
2. On each tick, the kernel delivers `SIGPROF` to **one thread at a time** (round-robin).
3. The signal handler walks the goroutine's stack using compiler-emitted metadata and writes an entry to the lock-free profile buffer.
4. A reader goroutine drains the buffer and writes a `pprof` profile to the output writer.

Because the signal is delivered per-thread, the sampling rate scales with `GOMAXPROCS`: at 100 Hz with 8 threads, expect ~800 samples/second across all cores.

---

## 3. Public APIs

### `runtime/pprof`

| Function | Purpose |
|----------|---------|
| `pprof.StartCPUProfile(w io.Writer) error` | Begin writing the CPU profile to `w` |
| `pprof.StopCPUProfile()` | Stop the current CPU profile and flush |
| `pprof.Profile.WriteTo(w, debug)` | For non-CPU profiles (heap, goroutine, etc.) |
| `pprof.Lookup(name)` | Get a named profile (`"goroutine"`, `"heap"`, `"allocs"`, ...) |
| `pprof.Do(ctx, labels, fn)` | Tag samples with `runtime/pprof` labels |
| `pprof.SetGoroutineLabels(ctx)` | Attach labels to the current goroutine |

Only **one** CPU profile may be active at a time. A second `StartCPUProfile` returns an error.

### `runtime`

| Function | Purpose |
|----------|---------|
| `runtime.SetCPUProfileRate(hz int)` | Override the default 100 Hz (call before `StartCPUProfile`) |
| `runtime.CPUProfile()` | Deprecated; returns the next chunk of profile data (use `pprof.StartCPUProfile`) |

`SetCPUProfileRate(0)` disables profiling. Rates above 1000 Hz are clamped on most platforms because the kernel will not deliver `SIGPROF` faster than that.

### `net/http/pprof`

Importing `_ "net/http/pprof"` registers these handlers on `http.DefaultServeMux`:

| Endpoint | Profile |
|----------|---------|
| `/debug/pprof/profile?seconds=N` | CPU profile over N seconds (default 30) |
| `/debug/pprof/heap` | In-use heap profile |
| `/debug/pprof/allocs` | All allocations since process start |
| `/debug/pprof/goroutine` | Goroutine stacks |
| `/debug/pprof/block` | Blocking profile (after `runtime.SetBlockProfileRate`) |
| `/debug/pprof/mutex` | Mutex contention (after `runtime.SetMutexProfileFraction`) |
| `/debug/pprof/trace?seconds=N` | Execution trace (not a pprof; see `go tool trace`) |
| `/debug/pprof/cmdline` | Process command line |
| `/debug/pprof/symbol` | Address-to-symbol lookup |

### `testing`

| Flag | Effect |
|------|--------|
| `-cpuprofile=cpu.out` | Write a CPU profile from `TestMain` or `go test -bench` |
| `-blockprofile=block.out` | Write a block profile |
| `-mutexprofile=mutex.out` | Write a mutex profile |
| `-memprofile=mem.out` | Write a heap profile at the end |
| `-trace=trace.out` | Write an execution trace |

These are honored by the standard `testing.M` flow without any code changes.

---

## 4. Profile file format

The on-disk format is a gzipped `profile.proto` (https://github.com/google/pprof/blob/main/proto/profile.proto).

```
Profile {
  repeated SampleType sample_type;  // e.g., "samples/count", "cpu/nanoseconds"
  repeated Sample sample;           // each sample: location stack + values
  repeated Location location;       // PC -> function + line
  repeated Function function;
  repeated Mapping mapping;         // module mappings
  repeated string string_table;
  int64 time_nanos;
  int64 duration_nanos;
  int64 period;                     // sampling period in nanoseconds (e.g., 10000000 for 100 Hz)
}
```

Two sample values per sample for a CPU profile: **count** (number of samples that hit this stack) and **CPU nanoseconds** (count × period). Tools display either; default is CPU time.

---

## 5. The `go tool pprof` interface

```
go tool pprof [flags] [binary] profile.pprof
```

| Command | Effect |
|---------|--------|
| `top` | Top N functions by flat CPU |
| `top -cum` | Top N by cumulative CPU |
| `list <regex>` | Source-level annotation of matching functions |
| `web` | Open SVG call graph in a browser (needs Graphviz) |
| `peek <regex>` | Show callers/callees of matching functions |
| `disasm <regex>` | Annotated disassembly |
| `tree` | Indented caller/callee tree |
| `traces` | Show individual sample stacks |
| `tags` | Show pprof labels and their values |
| `help` | Full command list |

Flags:

| Flag | Effect |
|------|--------|
| `-http=:8080` | Launch the interactive web UI (top, source, flame graph) |
| `-base=old.pprof` | Subtract `old` from the profile (regression diff) |
| `-diff_base=old.pprof` | Show only positive differences (where `new > old`) |
| `-output=out.svg` | Write graph/flame to a file |
| `-focus=<regex>` | Keep only samples passing through matching nodes |
| `-ignore=<regex>` | Drop samples passing through matching nodes |
| `-nodecount=N` | Limit nodes in graph output |

The web UI (`-http`) is the modern default; the interactive REPL remains useful in CI and ssh sessions.

---

## 6. Flat vs cumulative time

| Term | Meaning |
|------|---------|
| **Flat** (self) | Time spent in the function itself, excluding calls it made |
| **Cumulative** (cum) | Time spent in the function plus everything it called |

A leaf function (e.g., `runtime.memmove`) has `flat ≈ cum`. A wrapper function (`http.serverHandler.ServeHTTP`) has tiny flat but huge cum.

The first question to ask of any profile: "What has high flat?" Those are real hotspots. Functions with only high cum are not where the work happens — they are where it is *organized*.

---

## 7. Runtime functions you will see

| Function | Meaning |
|----------|---------|
| `runtime.mallocgc` | Heap allocation slow path |
| `runtime.gcBgMarkWorker` | Background GC worker |
| `runtime.gcAssistAlloc1` | Mutator assisting GC (allocation-bound) |
| `runtime.futex` / `runtime.semasleep` | Goroutine sleeping for a lock or semaphore |
| `runtime.findrunnable` / `runtime.schedule` | Scheduler looking for work (often idle CPU) |
| `runtime.memmove` / `runtime.memclrNoHeapPointers` | Bulk copy/clear |
| `runtime.mapaccess1` / `runtime.mapassign` | Map operations |
| `runtime.growslice` | Slice reallocation on append |
| `runtime.convT*` | Boxing a value into an interface |
| `runtime.duffcopy` / `runtime.duffzero` | Inline copy/zero loops |
| `syscall.Syscall6` | Time spent in kernel calls |

Seeing many seconds in `runtime.findrunnable` is **idle CPU**, not work — the profile counts on-CPU time for whatever the kernel scheduled. Filter with `-ignore=runtime\\.findrunnable`.

---

## 8. Profile labels (`pprof.Do`)

```go
pprof.Do(ctx, pprof.Labels("endpoint", "/api/v1/users"), func(ctx context.Context) {
    handleUsers(ctx)
})
```

Samples taken while the goroutine carries these labels record them. `go tool pprof` can then group:

```
(pprof) tags endpoint
(pprof) -tagfocus=endpoint=/api/v1/users
```

Labels are propagated across `go` statements that capture the labeled context. Cost: a few words per `Do` call. Use to attribute CPU to logical units (request types, tenants, batch jobs).

---

## 9. Sample bias and limitations

| Issue | Effect |
|-------|--------|
| **Signal delivery skew** | Functions that often have `SIGPROF` masked (CGO, syscalls) under-sample |
| **Inlined functions** | The inliner removes frames; profiles attribute work to the caller (use `-gcflags="-l"` to disable for analysis) |
| **Tail calls / TCO** | Not used by Go; not an issue |
| **Short-lived programs** | Fewer than ~1000 samples → noisy results; raise rate or extend duration |
| **CGO time** | Recorded as `_cgoexp_*` / `runtime.cgocall`; in-C time is opaque |
| **Goroutine starvation** | Profile shows what *ran*, not what *waited*; combine with block/mutex profiles |

A CPU profile answers "where did CPU go", not "why was the request slow". For latency questions, use traces (`go tool trace`) plus block/mutex profiles.

---

## 10. Non-goals

- pprof CPU profiling is **not** a code coverage tool. Cold paths are absent from the profile.
- It is **not** a wall-clock latency profile. Off-CPU time (sleeping on I/O, locks) is invisible.
- It cannot attribute time inside C libraries beyond the entry point.
- It cannot tell you why memory was allocated — that is the heap profile's job.

---

## 11. Related references

- pprof README: https://github.com/google/pprof/blob/main/doc/README.md
- "Profiling Go Programs" (Go blog, classic): https://go.dev/blog/pprof
- `runtime/pprof` source: https://github.com/golang/go/tree/master/src/runtime/pprof
- Continuous profiling overview: https://grafana.com/oss/pyroscope/
