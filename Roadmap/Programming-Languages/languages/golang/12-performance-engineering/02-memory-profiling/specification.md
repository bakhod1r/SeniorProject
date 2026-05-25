# Memory Profiling in Go — Specification

> **Focus:** Precise reference for capturing, sampling, and interpreting Go heap profiles — the APIs in `runtime/pprof` and `net/http/pprof`, the four profile metrics, the sampling math behind `runtime.MemProfileRate`, and the `go tool pprof` commands that read the output.
>
> **Sources:**
> - `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
> - `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
> - `runtime.MemProfileRate`: https://pkg.go.dev/runtime#MemProfileRate
> - `go tool pprof` docs: https://github.com/google/pprof/blob/main/doc/README.md
> - Profiling Go programs: https://go.dev/blog/pprof

---

## 1. What a memory profile actually contains

A Go heap profile is a list of **sampled allocation records**. Each record carries:

| Field | Meaning |
|-------|---------|
| Stack trace | The call stack at the moment of the allocation |
| `alloc_objects` | Number of objects allocated through this site (cumulative) |
| `alloc_space` | Bytes allocated through this site (cumulative) |
| `inuse_objects` | Subset of those still live at profile time |
| `inuse_space` | Bytes of those still live at profile time |

Each record represents the **scaled-up** estimate inferred from the samples actually recorded. The profile is statistical, not exact — see §5.

---

## 2. The four metrics, paired

| Metric | Counts | Resets on GC? | Use when |
|--------|--------|---------------|----------|
| `inuse_space` | Bytes currently live | Yes (drops as objects die) | Diagnosing **leaks** and steady-state heap |
| `inuse_objects` | Object count currently live | Yes | Finding many-small-object problems |
| `alloc_space` | Bytes ever allocated | No (monotonic per process) | Diagnosing **allocation rate** / GC pressure |
| `alloc_objects` | Object count ever allocated | No | Finding hot allocation sites |

A site that allocates a million 16-byte structs and a site that allocates ten 1 MiB buffers may have the same `alloc_space` but very different `alloc_objects`. The GC cost is roughly per-object, so `alloc_objects` is the better signal for GC CPU; `alloc_space` is the better signal for heap pressure.

---

## 3. Capture APIs in `runtime/pprof`

| Function | What it writes | Default sample type |
|----------|----------------|---------------------|
| `pprof.WriteHeapProfile(w)` | Heap profile to writer | `inuse_space` |
| `pprof.Lookup("heap").WriteTo(w, debug)` | Heap profile | `inuse_space`, all four available |
| `pprof.Lookup("allocs").WriteTo(w, debug)` | Allocations since start | `alloc_space` (cumulative) |
| `pprof.Lookup("goroutine").WriteTo(w, debug)` | Stacks of every goroutine | n/a |
| `pprof.Lookup("threadcreate").WriteTo(w, debug)` | OS-thread create sites | n/a |

`debug=0` writes the binary protobuf consumed by `go tool pprof`. `debug=1` writes a human-readable text dump. `debug=2` writes a goroutine dump in the same format as a panic.

```go
import (
    "os"
    "runtime"
    "runtime/pprof"
)

f, _ := os.Create("heap.pb.gz")
defer f.Close()
runtime.GC()                     // get a clean live set first
pprof.WriteHeapProfile(f)        // writes inuse_* metrics
```

The leading `runtime.GC()` is a deliberate trade: it makes `inuse_*` reflect only what survived a full collection, eliminating "garbage we haven't swept yet" from the profile.

---

## 4. The HTTP endpoint surface

Importing `net/http/pprof` registers handlers on `http.DefaultServeMux`:

| URL | Body |
|-----|------|
| `/debug/pprof/heap` | Heap profile, default `inuse_space` |
| `/debug/pprof/heap?gc=1` | Same, with a forced GC first |
| `/debug/pprof/allocs` | Allocations since process start |
| `/debug/pprof/profile?seconds=30` | 30-second CPU profile |
| `/debug/pprof/goroutine` | Goroutine profile |
| `/debug/pprof/block` | Blocking profile (requires `SetBlockProfileRate`) |
| `/debug/pprof/mutex` | Mutex profile (requires `SetMutexProfileFraction`) |
| `/debug/pprof/trace?seconds=5` | Execution trace |

```go
import _ "net/http/pprof"
import "net/http"

go http.ListenAndServe("127.0.0.1:6060", nil)
```

Then:

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
go tool pprof http://localhost:6060/debug/pprof/allocs
```

---

## 5. Sampling: `runtime.MemProfileRate`

| Property | Value |
|----------|-------|
| Default | `512 * 1024` bytes (512 KiB) |
| Type | `int` (variable, not const) |
| Semantics | Approximate: one sample recorded per `MemProfileRate` bytes allocated, on average |
| Set at startup | Yes; setting after first allocation may produce inconsistent data |

The runtime decides whether to record an allocation by drawing from a geometric distribution with mean `MemProfileRate`. So a 64-byte object has about a 64/524288 ≈ 0.012% chance of being recorded, while a 1 MiB object will almost certainly be recorded.

| `MemProfileRate` | Overhead | When to use |
|------------------|----------|-------------|
| `512*1024` (default) | Negligible | Production |
| `4096` | Small | Local debugging |
| `1` | High (every allocation logged) | Tests, microbenchmarks where exactness matters |
| `0` | Profiling disabled entirely | Production where overhead is forbidden |

```go
import "runtime"

func init() {
    runtime.MemProfileRate = 1   // tests only
}
```

The runtime scales recorded samples back up by the sampling rate when generating the profile. The output bytes look "correct"; the per-site numbers are estimates with variance proportional to 1/√samples.

---

## 6. `go test` profiling flags

| Flag | Effect |
|------|--------|
| `-memprofile=mem.out` | Write a heap profile at test exit |
| `-memprofilerate=N` | Set `runtime.MemProfileRate` for the test run |
| `-benchmem` | Print allocs/op and B/op for each benchmark |
| `-cpuprofile=cpu.out` | CPU profile of the test |
| `-blockprofile=block.out` | Blocking profile |
| `-mutexprofile=mutex.out` | Mutex contention profile |

```bash
go test -bench=. -benchmem -memprofile=mem.out -memprofilerate=1 ./pkg
go tool pprof mem.out
```

`-benchmem` is a per-benchmark report computed from `runtime.MemStats` deltas, not from sampled profiles. Its numbers are exact for that benchmark, regardless of `MemProfileRate`.

---

## 7. `go tool pprof` commands you actually use

Once inside the interactive shell:

| Command | Purpose |
|---------|---------|
| `top` | Top functions by current focus (`flat`, then `cum`) |
| `top -cum` | Sort by cumulative |
| `list <regex>` | Source view with per-line samples |
| `peek <regex>` | Callers and callees of a function |
| `web` | SVG callgraph in browser |
| `traces` | Show every sampled stack |
| `sample_index=inuse_space` | Switch metric |
| `sample_index=alloc_objects` | Switch metric |
| `tree` | Text callgraph |
| `disasm` | Disassembly with per-instruction samples |
| `granularity=lines` | Aggregate by source line, not function |

Out of the shell:

```bash
go tool pprof -http=:8080 heap.pb.gz                 # web UI with flame graph
go tool pprof -top -sample_index=alloc_objects heap.pb.gz
go tool pprof -base old.pb.gz new.pb.gz              # diff profile
```

The web UI (`-http`) is the modern default — it ships a flame graph, a callgraph, a top list, and a source view in one page.

---

## 8. Flame graphs

| Read this way | Meaning |
|---------------|---------|
| **Width** of a frame | Total samples (bytes or objects) attributed to that call site, including children |
| **Height** | Stack depth |
| **Color** | Arbitrary (helps distinguish frames; not semantic) |
| **Top frames** | Leaf allocators — these are where the bytes actually came from |

A wide frame near the top is "this leaf allocates a lot directly". A wide frame near the bottom that narrows quickly is "lots of paths converge into one entry point". Use `granularity=lines` for line-level resolution.

---

## 9. Diff profiles

```bash
go tool pprof -base before.pb.gz after.pb.gz
(pprof) top
```

The `top` view now shows **delta** allocations: `after - before`. Positive values are sites that allocated more after the baseline; negative values, less. Useful for:

| Use case | What you compare |
|----------|------------------|
| Leak hunting | Two heap profiles 30 minutes apart on the same process |
| Regression detection | Old release vs. new release under identical load |
| Optimization verification | Before vs. after a refactor in benchmarks |

```bash
curl -o t0.pb.gz http://prod:6060/debug/pprof/heap
sleep 1800
curl -o t1.pb.gz http://prod:6060/debug/pprof/heap
go tool pprof -base t0.pb.gz -http=:8080 t1.pb.gz
```

---

## 10. Relationship to escape analysis

A profile tells you **where** allocations happened. `-gcflags=-m` tells you **why** a particular variable escaped. They're complementary:

| Question | Tool |
|----------|------|
| "Which function allocates the most bytes?" | `pprof -alloc_space` |
| "Why does line 47 allocate?" | `go build -gcflags="-m -m" ./...` |
| "Did my refactor reduce allocations?" | `pprof -base` |
| "Which variable escaped to the heap?" | `go build -gcflags="-m"` |

Typical workflow: profile picks the hot site; escape report explains why it's hot; you change the code; profile confirms the change.

---

## 11. Continuous heap profiling

| Tool | Approach |
|------|----------|
| Pyroscope (Grafana) | Agent pulls `/debug/pprof/heap` every 10–15 s, stores in TSDB |
| Parca | Same model; ships flame graphs and diffs in a web UI |
| Datadog Profiler | SDK uploads profiles directly; ties to APM traces |
| Google Cloud Profiler | SDK; integrates with Cloud Trace |

The shared idea: scrape sampled profiles at a low cadence, store them, let an operator query "what changed between this hour and last hour" without ever logging into a box. Overhead is negligible because the default `MemProfileRate=512KiB` is already cheap.

---

## 12. Non-goals and limits

- The heap profile **does not** show stack allocations — escape analysis decides that, and stack allocations are invisible to pprof.
- The heap profile **does not** show C allocations (`malloc` via cgo) — those are below the Go runtime and require a separate tool (`jemalloc`'s `MALLOC_CONF=prof:true`, `heaptrack`, `valgrind`).
- `inuse_*` is a snapshot at profile time; it cannot reconstruct who held a reference. Use `goroutine` profile or a heap dump tool for that.
- Sample bias: very small allocations under `MemProfileRate` may not appear at all in any single profile.

---

## 13. Related references

- The pprof README: https://github.com/google/pprof/blob/main/doc/README.md
- `runtime/pprof` source: https://github.com/golang/go/tree/master/src/runtime/pprof
- Flame graphs (Brendan Gregg): https://www.brendangregg.com/flamegraphs.html
- Profiling Go programs (Go blog): https://go.dev/blog/pprof
- Memory profiling internals (Felix Geisendörfer): https://github.com/DataDog/go-profiler-notes/blob/main/heap.md
