# pprof — Professional

## 1. The two halves of "pprof"

The word `pprof` refers to two related pieces:

- **The runtime profiler** in `runtime` and `runtime/pprof` that records samples and writes profile files. Lives in the Go source tree.
- **The viewer**: `go tool pprof`, which is a small wrapper around `github.com/google/pprof`. Lives outside the Go runtime; vendored into the toolchain.

The profile **file format** is shared between the two and with non-Go languages: it is a protobuf described by `google/pprof/proto/profile.proto`. Any language can write a profile in that format and `go tool pprof` will read it.

---

## 2. The `profile.proto` format

The protobuf schema (paraphrased):

```
message Profile {
  repeated ValueType sample_type = 1;
  repeated Sample    sample      = 2;
  repeated Mapping   mapping     = 3;
  repeated Location  location    = 4;
  repeated Function  function    = 5;
  repeated string    string_table= 6;
  int64 time_nanos = 9;
  int64 duration_nanos = 10;
  ValueType period_type = 11;
  int64 period = 12;
  ...
}
message Sample { repeated uint64 location_id = 1; repeated int64 value = 2; repeated Label label = 3; }
message Location { uint64 id = 1; uint64 mapping_id = 2; uint64 address = 3; repeated Line line = 4; }
message Function { uint64 id = 1; int64 name = 2; int64 system_name = 3; int64 filename = 4; int64 start_line = 5; }
```

Key ideas:

- A **sample** is a tuple of `(stack, values, labels)`. Values are counters — e.g., for CPU profiles `[count, nanoseconds]`; for heap `[alloc_objects, alloc_space, inuse_objects, inuse_space]`.
- Stacks are stored as **location IDs**. Locations point at functions. Strings live in a deduplicated `string_table` indexed by the rest of the structure. This is what keeps the file small even with deep stacks.
- `period` and `period_type` describe the sampling unit (e.g., `cpu` measured in `nanoseconds`, period 10000000 = 10ms = 100Hz).
- The file is gzip-compressed protobuf. `go tool pprof` transparently decompresses.

Once you know the schema, you can write programs that **synthesize** or **post-process** profiles — strip noise, merge, redact identifiers, etc. The `github.com/google/pprof/profile` Go package is the canonical reader/writer.

---

## 3. How the runtime samples CPU

On POSIX systems the CPU profiler uses **signals**:

1. `runtime.StartCPUProfile` installs a SIGPROF handler.
2. `setitimer(ITIMER_PROF)` is set to deliver SIGPROF every 10ms (per OS-thread on Linux; this is why the profiler measures **on-CPU time across all threads**).
3. The handler runs in the context of whatever goroutine was on-CPU. It unwinds the stack (using the Go runtime's own unwinder — no libunwind, no DWARF at runtime) and writes a `(stack, period)` sample into a lock-free ring buffer.
4. A dedicated goroutine drains the buffer and writes samples into the profile file.

On Windows the equivalent is `GetThreadTimes` polling combined with stack walking via a profiler thread; signals are not available. Either way, the result is the same protobuf format.

Implications:

- Time spent in **C code** or in syscalls that don't return to Go can attribute weirdly — the unwinder gives up at the cgo/syscall boundary.
- Goroutines **not on CPU** (waiting on a channel, sleeping, blocked on I/O) are invisible. That is by design — use the block profile.
- The signal handler is async-signal-safe code in the runtime. Bugs there are extremely rare but extremely fun. Source: `runtime/cpuprof.go`, `runtime/proc.go` (SIGPROF handler), `runtime/traceback.go`.

---

## 4. How heap profiling works

`runtime.MemProfileRate` (default `512 * 1024`) controls sampling: roughly every Nth byte allocated triggers a record. Each record stores the **stack at the allocation site**, the size, and whether the allocation is currently live.

Implementation lives in `runtime/mprof.go`. The runtime keeps a hash table keyed by `(stack, size class)`; each entry has counters for `alloc_objects/space` and `inuse_objects/space`. When a sampled allocation is freed, `inuse_*` is decremented. When the GC sweeps, it walks live objects and reconciles.

`pprof.WriteHeapProfile` snapshots that table and serializes it. The four sample types (`alloc_objects`, `alloc_space`, `inuse_objects`, `inuse_space`) are columns of the same table.

Two practical consequences:

- A `heap` profile right after startup may be **empty** — nothing has been allocated yet relative to the rate. Either lower `MemProfileRate` (in tests) or capture under load.
- Setting `MemProfileRate = 1` records every allocation. This is **expensive** (overhead grows with allocation rate) and you should only do it in benchmarks or short captures.

---

## 5. How `net/http/pprof` works

The package is ~200 lines. On import, its `init()` calls `http.HandleFunc("/debug/pprof/...", ...)` for each profile kind on `http.DefaultServeMux`. Each handler is a thin adapter over `runtime/pprof`:

- `/debug/pprof/profile` calls `pprof.StartCPUProfile(w)`, sleeps `seconds`, calls `StopCPUProfile`.
- `/debug/pprof/heap` calls `pprof.Lookup("heap").WriteTo(w, 0)`.
- `/debug/pprof/goroutine?debug=2` calls `Lookup("goroutine").WriteTo(w, 2)` — which goes through the human-readable formatter in `runtime/pprof/pprof.go`.

That is why the blank import works at all: `_ "net/http/pprof"` runs `init()`, which mutates the global mux. Remove the blank `_` and the import is dead-code-eliminated; the handlers never register.

---

## 6. How `go tool pprof` is built

`go tool pprof` is `cmd/pprof` in the Go source tree. The file `src/cmd/pprof/pprof.go` is essentially:

```go
package main

import "github.com/google/pprof/driver"

func main() {
    driver.PProf(&driver.Options{ ... })
}
```

All the parsing, CLI, web UI, and graph rendering live in the vendored `github.com/google/pprof` repository. That is why the same tool works for non-Go profiles — `cmd/pprof` is a 50-line glue.

The `-http` mode embeds a tiny web server (`net/http`) and serves an HTML/JS UI that calls back into the driver to render SVG. Flame graphs are rendered by the `d3-flame-graph` library bundled into the binary.

Symbolization is done from the binary's **DWARF** debug info. The pprof file records function and file names that the runtime resolved at profile-write time (from `runtime.FuncForPC`), so for a Go profile of a Go binary you usually do not need the binary at view time. For raw stack addresses (cgo, foreign profiles), pprof will ask for the binary via `--symbolize` or `PPROF_BINARY_PATH`.

---

## 7. The pprof Go writer

`runtime/pprof/pprof.go` and `runtime/pprof/proto.go` implement the writer:

- A `profileBuilder` accumulates locations, functions, and string-table entries.
- For each sample, the stack PCs are translated via `runtime.CallersFrames` into function names. Inlined frames are expanded — one PC can produce multiple frames.
- The protobuf is written incrementally and gzipped.

Knowing this explains many odd behaviors. For example, **the same PC always produces the same frames** in one profile, so labeling work via `pprof.Do` is the only way to differentiate two callers of the same function on the same call path. Labels are stored on each sample (not on the location), which is why they survive the dedup of stacks.

---

## 8. Environment, file paths, and operational knobs

| Variable | Effect |
|----------|--------|
| `PPROF_BINARY_PATH` | Where the pprof viewer looks for binaries to symbolize foreign profiles |
| `PPROF_TMPDIR` | Where intermediate files (e.g., rendered SVGs) are written |
| `PPROF_TOOLS` | Path to `addr2line`, `objdump`, `nm` for non-Go symbolization |
| `runtime.MemProfileRate` | Heap profile sampling rate (bytes per sample) |
| `runtime.SetBlockProfileRate(n)` | Block profile rate (nanoseconds between sampled events) |
| `runtime.SetMutexProfileFraction(n)` | Sample 1 of every n contention events |
| `runtime.SetCPUProfileRate(hz)` | CPU profile rate (Hz) |

`MemProfileRate` must be set **before** allocations happen for it to be meaningful for those allocations.

---

## 9. Building your own profile viewer

Because the format is a public protobuf, you can:

```go
import (
    "os"
    "github.com/google/pprof/profile"
)

f, _ := os.Open("cpu.prof")
p, _ := profile.Parse(f)
for _, s := range p.Sample {
    // s.Location is the stack; s.Value the counters
}
```

This is the basis of internal tooling at large Go shops: custom dashboards, automatic top-N reports per release, regression alerts, anonymization filters for sharing profiles externally.

---

## 10. Edge cases worth knowing

- **`pprof.StartCPUProfile` is single-instance.** A second call without `StopCPUProfile` returns an error. Wrappers must respect this.
- **Profiles are not safe to write concurrently** to the same writer. Coordinate.
- **Cgo stacks** stop at the C boundary. To profile inside C you need `perf` + `perf script` + pprof's `--proto` ingestion.
- **Profile granularity is the function**, not the basic block. Two hot lines in the same function need `list func` to disentangle.
- **Sample weighting.** For CPU, value[1] is nanoseconds, not raw counts; the period scales it. Code that aggregates samples by hand must respect `period_type` and `period`.

---

## 11. Summary

At the professional level, pprof is a protobuf format, a runtime that produces it via signals or polling, and a viewer that is mostly `google/pprof` wrapped in 50 lines. Knowing the format unlocks custom tooling; knowing the runtime mechanism explains every "why doesn't this show up" question; knowing the viewer's symbolization path explains every "wrong function names" question. Read `runtime/cpuprof.go`, `runtime/mprof.go`, and `runtime/pprof/proto.go` once — they are surprisingly short and they make everything above this layer feel obvious afterwards.

---

## Further reading
- `profile.proto`: https://github.com/google/pprof/blob/main/proto/profile.proto
- `google/pprof` repo: https://github.com/google/pprof
- Go source — `runtime/cpuprof.go`, `runtime/mprof.go`, `runtime/pprof/pprof.go`, `runtime/pprof/proto.go`
- `cmd/pprof`: https://pkg.go.dev/cmd/pprof
- `runtime.CallersFrames` and inlining: https://pkg.go.dev/runtime#CallersFrames
