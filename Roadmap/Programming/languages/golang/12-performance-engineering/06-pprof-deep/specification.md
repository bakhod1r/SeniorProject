# pprof Deep Dive — Specification

> **Focus:** Precise reference for the `pprof` tool itself — how to invoke it, every profile type it consumes, every interactive command it offers, every flag that changes its output, and the on-disk format it reads.
>
> **Sources:**
> - `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
> - `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
> - `pprof` upstream: https://github.com/google/pprof
> - Profile format: https://github.com/google/pprof/blob/main/proto/profile.proto
> - Go diagnostics guide: https://go.dev/doc/diagnostics

---

## 1. Invocation forms

`go tool pprof` accepts a profile source as the last argument. Everything before it is flags.

| Form | What it does |
|------|--------------|
| `go tool pprof cpu.pb.gz` | Interactive shell, profile loaded from a local file |
| `go tool pprof http://host:6060/debug/pprof/heap` | Fetch the profile over HTTP, then interactive |
| `go tool pprof -seconds=30 http://host:6060/debug/pprof/profile` | Collect a 30-second CPU profile, then interactive |
| `go tool pprof -http=:8080 cpu.pb.gz` | Start a local web UI on port 8080 (flame graph, graph, source, top) |
| `go tool pprof -http=: cpu.pb.gz` | Same, pick a random free port |
| `go tool pprof -base=old.pb.gz new.pb.gz` | Show only the *difference* between two profiles |
| `go tool pprof -diff_base=old.pb.gz new.pb.gz` | Like `-base` but shows new = old + delta (signed) |
| `go tool pprof binary cpu.pb.gz` | Force symbolization with a specific binary (rare) |

The HTTP form requires the target to have the `net/http/pprof` handlers registered, typically by side-effect import:

```go
import _ "net/http/pprof"
go http.ListenAndServe("127.0.0.1:6060", nil)
```

---

## 2. Profile types

The `net/http/pprof` endpoint exposes the following named profiles. All accept `?debug=N` (text format when N>0) and `?seconds=N` where applicable.

| Endpoint | What it samples | Unit | Cost while running |
|----------|-----------------|------|--------------------|
| `/debug/pprof/profile` | CPU samples (default 30 s) | nanoseconds CPU | ~5% during collection |
| `/debug/pprof/heap` | Live heap (current snapshot) | bytes / objects | One STW briefly |
| `/debug/pprof/allocs` | Cumulative allocations since start | bytes / objects | One STW briefly |
| `/debug/pprof/goroutine` | Stacks of every running goroutine | count | One STW briefly |
| `/debug/pprof/block` | Time goroutines spent blocked on sync primitives | nanoseconds | Disabled unless `SetBlockProfileRate>0` |
| `/debug/pprof/mutex` | Contention events on `sync.Mutex` / `sync.RWMutex` | nanoseconds | Disabled unless `SetMutexProfileFraction>0` |
| `/debug/pprof/threadcreate` | Stacks at each new OS thread creation | count | Free, rarely useful |
| `/debug/pprof/trace` | Execution trace (different tool, `go tool trace`) | — | Higher overhead |
| `/debug/pprof/cmdline` | The target's command line | — | Free |
| `/debug/pprof/symbol` | Symbol resolution helper | — | Free |

The `heap` and `allocs` endpoints serve the **same** underlying profile; what differs is the default `sample_index` (in-use vs. allocated).

---

## 3. Sample indices

A profile may carry multiple value columns per sample. `-sample_index` selects which column drives all commands.

| Profile | Available indices |
|---------|-------------------|
| `cpu` | `samples`, `cpu` (cpu nanoseconds; default) |
| `heap` / `allocs` | `alloc_objects`, `alloc_space`, `inuse_objects`, `inuse_space` (heap default `inuse_space`, allocs default `alloc_space`) |
| `block` / `mutex` | `contentions`, `delay` (delay default) |
| `goroutine` | `goroutine` (count) |

```
go tool pprof -sample_index=alloc_objects heap.pb.gz
```

Inside the shell you can switch with `sample_index=alloc_space` at any time.

---

## 4. Interactive commands

After loading a profile, `pprof` drops into a REPL. The core verbs:

| Command | Effect |
|---------|--------|
| `top [N]` | Top N (default 10) by flat self time; appends a `cum` column |
| `top -cum [N]` | Sort by cumulative (own + descendants) |
| `list <regex>` | Annotated source for the function(s) matching the regex |
| `disasm <regex>` | Annotated assembly for matching functions |
| `web` | Render the call graph as SVG and open in a browser |
| `peek <regex>` | Callers and callees of matching functions with edge weights |
| `traces` | Print every sample as a full stack |
| `tree` | Caller→callee tree with per-edge weights |
| `granularity=lines\|files\|functions\|addresses` | Aggregation level for `top`, `list`, etc. |
| `focus=<regex>` | Keep only samples whose stack matches |
| `ignore=<regex>` | Drop samples whose stack matches |
| `hide=<regex>` | Hide frames from output but keep the sample |
| `show=<regex>` | Inverse of `hide`: keep only matching frames |
| `tagfocus=<key>=<val>` | Filter by profile label |
| `tagignore=<key>=<val>` | Drop by profile label |
| `sample_index=<name>` | Switch value column |
| `unit=<unit>` | Re-display amounts in a specific unit (`ms`, `b`, `kb`, `mb`) |
| `nodecount=N` | Show at most N nodes in graph/flame views |
| `nodefraction=F` | Hide nodes whose share is less than F (default 0.005 = 0.5%) |
| `edgefraction=F` | Hide edges whose share is less than F (default 0.001) |
| `cumulative=true\|false` | Default sort order |
| `compact_labels` | Shorter labels in output |
| `o` (or `options`) | Print current settings |
| `quit` (or `exit`, Ctrl-D) | Leave the shell |

Regexes are RE2; they match against the fully qualified function name as `package.Func` or `(*Type).Method`.

---

## 5. Web UI (`-http`)

`-http=addr` starts an embedded HTTP server with four built-in views, each a one-click switch:

| View | URL path | Best for |
|------|----------|----------|
| **Top** | `/ui/top` | Tabular self/cum, same as `top` command |
| **Graph** | `/ui/` (default) | Call graph with edges weighted by transfer; shows hot paths |
| **Flame Graph** | `/ui/flamegraph` | Inverted icicle view; width = share of selected metric |
| **Source** | `/ui/source` | Annotated source for the function clicked from any other view |
| **Peek** | `/ui/peek` | Callers and callees of a function |
| **Disassemble** | `/ui/disasm` | Annotated assembly |

The "View" menu also exposes "Refine" filters (`focus`, `ignore`, `hide`, `show`, `tagfocus`) as URL parameters, so a flame graph URL is shareable.

Useful flags around `-http`:

- `-no_browser` — do not auto-open a browser, just print the URL.
- `-nodecount=N` — initial graph node cap.
- `-edgefraction=F` — initial edge threshold.

---

## 6. Programmatic capture (`runtime/pprof`)

The same profiles are accessible from inside the program without an HTTP server:

```go
import "runtime/pprof"

f, _ := os.Create("cpu.pb.gz")
pprof.StartCPUProfile(f)
defer pprof.StopCPUProfile()
// ... workload ...

g, _ := os.Create("heap.pb.gz")
pprof.Lookup("heap").WriteTo(g, 0)
```

| API | Purpose |
|-----|---------|
| `pprof.StartCPUProfile(w)` / `StopCPUProfile()` | Stream CPU samples to `w` |
| `pprof.Lookup(name).WriteTo(w, debug)` | Snapshot a built-in profile; `debug=0` binary, `>0` text |
| `pprof.NewProfile(name)` | Register a custom profile |
| `pprof.SetGoroutineLabels(ctx)` | Apply labels from `ctx` to the current goroutine |
| `pprof.Do(ctx, labels, fn)` | Run `fn` with `labels` attached to its CPU samples |
| `pprof.WithLabels(parent, labels)` / `pprof.Labels("k","v")` | Build a labeled context |
| `pprof.ForLabels(ctx, fn)` | Iterate the labels currently attached to `ctx` |
| `runtime.SetBlockProfileRate(rate)` | Enable block profiling; sample 1-in-`rate` events |
| `runtime.SetMutexProfileFraction(rate)` | Enable mutex profiling; 1-in-`rate` contention events |
| `runtime.MemProfileRate` | Bytes between heap profile samples (default 512 KiB) |

---

## 7. Custom profiles

```go
var openFiles = pprof.NewProfile("openfiles")

func open(p string) *os.File {
    f, _ := os.Open(p)
    openFiles.Add(f, 2)   // record stack at this point, key = f
    return f
}

func closeOne(f *os.File) {
    openFiles.Remove(f)
    f.Close()
}
```

`Add(key, skip)` records the current stack and increments the `count` for that stack; `Remove(key)` decrements. `WriteTo` produces a standard `.pb.gz` profile that `go tool pprof` reads with no special flags. Used by the standard library for `goroutine`, `threadcreate`, `block`, `mutex`, `heap`.

---

## 8. Profile labels

Labels are key→value strings attached to CPU samples. They let you slice a profile by tenant, request path, route, or any other dimension you choose.

```go
ctx := pprof.WithLabels(r.Context(), pprof.Labels(
    "route", routeName,
    "tenant", tenantID,
))
pprof.Do(ctx, pprof.Labels(), func(ctx context.Context) {
    handle(ctx, r)
})
```

In the shell:

```
tagfocus=route=/api/v1/orders
tagignore=tenant=internal
```

Labels also propagate to descendant goroutines spawned with `pprof.Do`. They do **not** propagate via `go fn()` unless you explicitly call `pprof.SetGoroutineLabels(ctx)` inside the new goroutine.

Only CPU, block, and mutex profiles carry labels; the heap profile does not.

---

## 9. Profile format

`pprof` profiles are gzipped protobuf messages defined by `profile.proto`. Top-level fields:

| Field | Meaning |
|-------|---------|
| `sample_type` | Repeated. Each entry is `(type, unit)`, e.g. `(cpu, nanoseconds)` |
| `sample` | Repeated. Each entry is a stack (list of location IDs) plus N values (one per `sample_type`) plus optional labels |
| `mapping` | The binaries and their address ranges (for symbolization) |
| `location` | Address → list of `Line` (allows for inlined frames) |
| `function` | `name`, `system_name`, `filename`, `start_line` |
| `string_table` | All strings, referenced by index |
| `time_nanos`, `duration_nanos`, `period_type`, `period` | Sampling metadata |
| `default_sample_type` | Which column to display by default |

The format is the **same** for cpu, heap, block, mutex, goroutine, and custom profiles — only `sample_type` differs. That's why one tool drives all of them.

To dump a profile without rendering:

```
go tool pprof -raw cpu.pb.gz | less
go tool pprof -proto cpu.pb.gz > cpu.proto  # textual proto
```

---

## 10. Combining and diffing

```
# straight merge: union of samples with values added
go tool pprof prof1.pb.gz prof2.pb.gz prof3.pb.gz

# diff: show what changed
go tool pprof -base=before.pb.gz after.pb.gz
go tool pprof -diff_base=before.pb.gz after.pb.gz
```

`-base` subtracts and reports the positive delta; `-diff_base` subtracts and reports both positive and negative (red = new cost, green = saved cost in the web UI).

The two profiles must have the **same** `sample_type` (you cannot diff a `cpu` against an `inuse_space`).

---

## 11. Symbolization and source

`pprof` resolves addresses to function names using the `mapping` records inside the profile. For a Go binary built without `-ldflags="-s -w"`, symbols are embedded. If you stripped symbols, supply the original binary explicitly:

```
go tool pprof /path/to/binary http://host:6060/debug/pprof/heap
```

For `list` to show source code, the source paths inside the profile (`function.filename`) must exist on the local filesystem with the same absolute path. Use `-trim_path=PATH` to remove leading directories, or `-source_path=PATH` to add search roots.

---

## 12. Flags reference

| Flag | Purpose |
|------|---------|
| `-seconds=N` | Duration to sample for `/profile` and similar |
| `-output=path` | Save the fetched profile to disk |
| `-cpu`, `-heap`, `-allocs`, etc. | Convenience for the matching endpoint |
| `-symbolize=local\|remote\|fastlocal\|none` | Where to resolve symbols |
| `-trim_path=PATH` | Strip prefix from source filenames |
| `-source_path=PATH` | Add directories for source lookup |
| `-tools=PATH` | Path to `addr2line`, `objdump` if non-default |
| `-nodecount=N` | Initial cap on graph nodes |
| `-nodefraction=F` | Hide tiny nodes |
| `-edgefraction=F` | Hide tiny edges |
| `-sample_index=NAME` | Pick the value column |
| `-call_tree` | Don't merge call paths (preserve each unique stack) |
| `-no_browser` | Don't open a browser in `-http` mode |
| `-relative_percentages` | Percentages relative to the filtered subset |
| `-unit=UNIT` | Force display unit |
| `-show=REGEX`, `-hide=REGEX`, `-focus=REGEX`, `-ignore=REGEX` | Apply at load time |

---

## 13. Defaults that bite

| Knob | Default | Why it matters |
|------|---------|----------------|
| `runtime.MemProfileRate` | 524288 (512 KiB) | Heap profile samples one in every ~512 KiB of allocation. Small allocations are statistically scaled |
| `runtime.SetBlockProfileRate` | 0 (disabled) | Block profile is empty until you enable it |
| `runtime.SetMutexProfileFraction` | 0 (disabled) | Same for mutex |
| CPU sample rate | 100 Hz | A function that takes <10 ms total is invisible |
| `nodefraction` | 0.005 (0.5%) | Functions below this cutoff are folded into their callers in the graph |
| Default `sample_index` for heap | `inuse_space` | Allocation-rate problems look invisible until you switch |

---

## 14. Non-goals / limitations

- `pprof` cannot show scheduling latency, syscall blocking sequences, or goroutine wake-up causality — that's what `go tool trace` is for.
- A CPU profile only sees *on-CPU* time. Goroutines waiting on I/O or channels are absent (use `goroutine` and `block` profiles).
- Heap profiles are sampled; do not use them for exact accounting (see Bug 12 in `find-bug.md`).
- Profile labels do not attach to heap or goroutine profiles, only CPU/block/mutex.
- Diffing requires identical `sample_type` columns.

---

## 15. Related references

- `pprof` README: https://github.com/google/pprof/blob/main/doc/README.md
- `runtime/pprof` API: https://pkg.go.dev/runtime/pprof
- `net/http/pprof` handler set: https://pkg.go.dev/net/http/pprof
- Profile proto: https://github.com/google/pprof/blob/main/proto/profile.proto
- Continuous profiling tools: Pyroscope (https://pyroscope.io), Parca (https://www.parca.dev), GCP Cloud Profiler (https://cloud.google.com/profiler)
