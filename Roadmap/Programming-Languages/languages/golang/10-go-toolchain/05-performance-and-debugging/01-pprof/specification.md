# pprof — Specification

> **Focus:** Precise reference for `go tool pprof`, the `net/http/pprof` HTTP surface, the `runtime/pprof` API, and the on-disk profile format.
>
> **Sources:**
> - `go tool pprof -h`
> - `cmd/pprof` documentation: https://pkg.go.dev/cmd/pprof
> - `runtime/pprof`: https://pkg.go.dev/runtime/pprof
> - `net/http/pprof`: https://pkg.go.dev/net/http/pprof
> - `google/pprof` README: https://github.com/google/pprof/blob/main/doc/README.md
> - `profile.proto`: https://github.com/google/pprof/blob/main/proto/profile.proto

---

## 1. Synopsis

```
go tool pprof [options] source
go tool pprof [options] -base=baseProfile source
go tool pprof [options] -diff_base=baseProfile source
go tool pprof -http=[host]:port [options] source
go tool pprof -<format> [options] source > out.<format>
```

`source` is one of:

| Form | Meaning |
|------|---------|
| `file.pprof` | A profile file on disk (gzipped protobuf) |
| `http://host:port/debug/pprof/<kind>` | Fetch the profile over HTTP from a live process |
| `http://host:port/debug/pprof/profile?seconds=N` | Fetch a CPU profile of length `N` seconds |
| `binary file.pprof` | Binary + profile (needed when the profile is not self-symbolized) |

---

## 2. Profile sources from `net/http/pprof`

Importing `_ "net/http/pprof"` registers handlers on `http.DefaultServeMux`:

| Endpoint | Returns | Notes |
|----------|---------|-------|
| `/debug/pprof/` | Index page listing all profiles | HTML |
| `/debug/pprof/profile` | CPU profile (protobuf) | Accepts `?seconds=N` (default 30) |
| `/debug/pprof/heap` | Heap profile (live + alloc counters) | Triggers GC for accuracy |
| `/debug/pprof/allocs` | Allocation profile (cumulative) | Same shape as heap |
| `/debug/pprof/goroutine` | All goroutine stacks | `?debug=0` proto, `?debug=1` summary, `?debug=2` full text |
| `/debug/pprof/block` | Stack traces of blocking events | Requires `SetBlockProfileRate(>0)` |
| `/debug/pprof/mutex` | Stack traces of contended mutexes | Requires `SetMutexProfileFraction(>0)` |
| `/debug/pprof/threadcreate` | Stack traces of OS thread creation | Always available |
| `/debug/pprof/cmdline` | The process command line | Text |
| `/debug/pprof/symbol` | Symbol lookup for raw PCs | Used by pprof when remote symbolization is needed |
| `/debug/pprof/trace` | Execution trace (not pprof — for `go tool trace`) | Accepts `?seconds=N` |

---

## 3. `runtime/pprof` API

| Function | Purpose |
|----------|---------|
| `StartCPUProfile(w io.Writer) error` | Begin CPU profiling. Returns error if already started |
| `StopCPUProfile()` | Stop profiling and flush. Idempotent |
| `WriteHeapProfile(w io.Writer) error` | Snapshot the heap profile |
| `Lookup(name string) *Profile` | Get a named profile (`heap`, `goroutine`, `block`, etc.) |
| `Profile.WriteTo(w io.Writer, debug int) error` | Serialize a profile (`debug=0` proto, `1` text, `2` verbose) |
| `Do(ctx, labels, f)` | Run `f` with labels attached to all samples captured during it |
| `Labels(k, v, ...)` | Build a `LabelSet` for `Do` |
| `SetGoroutineLabels(ctx)` | Apply labels to the current goroutine |
| `WithLabels(ctx, labels)` | Derive a context with labels |

`runtime` package controls related to sampling:

| Function/Var | Effect |
|--------------|--------|
| `runtime.SetCPUProfileRate(hz int)` | CPU sample rate; default 100. Must be called before `StartCPUProfile` to take effect |
| `runtime.MemProfileRate int` | Bytes between heap samples (default 524288). Set before allocations |
| `runtime.SetBlockProfileRate(rate int)` | Block profile rate in nanoseconds (0 = off) |
| `runtime.SetMutexProfileFraction(rate int)` | Sample 1 in `rate` mutex contention events (0 = off) |

---

## 4. Interactive commands (terminal pprof)

After `go tool pprof file.prof`:

| Command | Effect |
|---------|--------|
| `top [N] [-flat\|-cum]` | Top N functions (default 10) by flat (default) or cumulative samples |
| `list <regex>` | Annotated source for functions matching `<regex>` |
| `peek <regex>` | Callers/callees around the function with sample counts |
| `web` | Render the full call graph as SVG and open in a browser (requires Graphviz) |
| `tree [N]` | Text call tree |
| `disasm <regex>` | Annotated assembly for the function |
| `traces` | Dump individual samples (stack + value), useful for tagged samples |
| `tags` | List label keys and values present in the profile |
| `sample_index=<i>` | Switch between the profile's value columns (e.g., `inuse_space` ↔ `alloc_space`) |
| `focus=<regex>` / `ignore=<regex>` | Filter samples in/out by stack matching |
| `hide=<regex>` / `show=<regex>` | Hide/show specific functions in views |
| `tagfocus=<key:value>` | Restrict to samples carrying the label |
| `quit` (or `q`, Ctrl-D) | Exit |

---

## 5. `-http` web UI

`go tool pprof -http=:8080 file.prof` starts a local web server with:

- **Top** view — sortable table of functions.
- **Graph** view — clickable call graph (SVG).
- **Flame Graph** view — d3-flame-graph rendering.
- **Peek** view — combined callers/callees.
- **Source** view — annotated source per function.
- **Disassembly** view — annotated machine code.
- **Refine** menu — apply focus/ignore/hide/show/tagfocus interactively.
- **View → Sample** — switch sample index for heap profiles.

The server is local-only by default. Specify a host (`-http=0.0.0.0:8080`) to bind elsewhere — usually a bad idea.

---

## 6. Output formats (non-interactive)

| Flag | Output |
|------|--------|
| `-top` | Plain-text top list |
| `-list <regex>` | Annotated source |
| `-peek <regex>` | Callers/callees |
| `-tree` | Text call tree |
| `-traces` | Per-sample dump |
| `-text` | Same as `-top` |
| `-dot` | DOT format (graphviz source) |
| `-svg`, `-pdf`, `-png`, `-gif` | Rendered graphs (require Graphviz) |
| `-callgrind` | Callgrind format (kcachegrind) |
| `-raw` | Decompressed protobuf in human-readable form |
| `-proto` | Re-emit the protobuf (useful with filters to produce a stripped profile) |

Combine with filter flags (next section) to produce a focused artifact.

---

## 7. Filter flags

| Flag | Effect |
|------|--------|
| `-focus=<regex>` | Keep only samples whose stack matches |
| `-ignore=<regex>` | Drop samples whose stack matches |
| `-hide=<regex>` | Hide matching frames from views (samples remain) |
| `-show=<regex>` | Inverse of `-hide`; show only matching frames |
| `-show_from=<regex>` | Show only the part of stacks above the first match |
| `-tagfocus=<key:value>` | Keep only samples with the label |
| `-tagignore=<key:value>` | Drop samples with the label |
| `-nodecount=N` | Limit graph/flame node count |
| `-nodefraction=f` | Drop nodes with less than fraction `f` of total |
| `-edgefraction=f` | Drop edges below fraction `f` |
| `-cum` | Sort/print by cumulative time |
| `-flat` | Sort/print by flat time |
| `-sample_index=<name\|index>` | Choose which value column to view |

---

## 8. Comparison flags

| Flag | Effect |
|------|--------|
| `-base=<file>` | Subtract `<file>` from the source profile (absolute delta) |
| `-diff_base=<file>` | Subtract `<file>` after normalizing totals (relative delta) |
| `-normalize` | Normalize the profile before display |

`-base` is appropriate when both profiles came from the same workload (regression testing). `-diff_base` is appropriate when sizes differ (different load levels).

---

## 9. Environment variables

| Variable | Role |
|----------|------|
| `PPROF_BINARY_PATH` | Directories searched for binaries when symbolizing non-self-symbolized profiles |
| `PPROF_TMPDIR` | Where intermediate render artifacts (SVG, etc.) are written; default system temp |
| `PPROF_TOOLS` | Path to `addr2line`, `objdump`, `nm` for foreign binary symbolization |
| `BROWSER` | Browser to open for `-http` and `web` views |
| `GOPATH`, `GOMODCACHE` | Source code lookup when annotating with `list` |

---

## 10. The profile file format

Every pprof file is **gzipped `Profile` protobuf** as defined in `google/pprof/proto/profile.proto`. Key fields:

| Field | Purpose |
|-------|---------|
| `sample_type` | One `ValueType` per value column (e.g., `cpu/nanoseconds`, `alloc_space/bytes`) |
| `sample` | Each sample: `location_id[]`, `value[]`, `label[]` |
| `location` | A program counter; references a `mapping` and one or more `Line` entries (for inlining) |
| `function` | Function name, system name, file, start line |
| `mapping` | A range of memory mapped from a binary (path, build ID, offsets) |
| `string_table` | Deduplicated strings referenced by integer index from elsewhere |
| `period_type`, `period` | Sample weighting (e.g., 10ms for 100Hz CPU) |
| `time_nanos`, `duration_nanos` | When the profile was taken and for how long |

A file is self-symbolized if every `Function.name` is populated; foreign profiles often store only `Location.address` and require the matching binary to symbolize.

---

## 11. Exit codes and behavior

| Situation | Behavior |
|-----------|----------|
| Source file missing or not a valid profile | Non-zero exit, error to stderr |
| `-http` started successfully | Process blocks serving until interrupted |
| One-shot output flag (`-top`, `-svg`, etc.) | Writes to stdout, exits 0 on success |
| Interactive mode | Exit 0 on `quit`/EOF |
| Symbolization fails (missing binary) | Continues with raw PCs; warning to stderr |

---

## 12. Behavioral guarantees

- The on-disk format is **stable** and language-agnostic; any tool that reads `profile.proto` can read a Go-produced profile and vice versa.
- `go tool pprof` versions are forward-compatible with older Go profiles.
- `net/http/pprof` handlers are **dormant** until requested; per-request cost is paid only when a profile is captured.
- CPU profiling on POSIX uses SIGPROF and incurs ~1-3% overhead at the default 100 Hz.
- Heap profiling adds per-allocation overhead proportional to `1 / MemProfileRate`.
- Block and mutex profiling are **off by default**; enabling adds overhead proportional to the configured rate.

---

## 13. Non-goals / limitations

- pprof is a **sampling** profiler, not a tracer. For exact per-call data use `go test -trace` and `go tool trace`.
- It does not show wall-clock time for blocked goroutines in the CPU profile — use the block profile.
- It does not symbolize cgo code without `addr2line` and the matching shared library.
- The profile format is not designed for line-by-line execution timing; granularity is the function (with `list` source attribution as a UI feature, not a stored field).

---

## 14. Related references
- `cmd/pprof`: https://pkg.go.dev/cmd/pprof
- `runtime/pprof`: https://pkg.go.dev/runtime/pprof
- `net/http/pprof`: https://pkg.go.dev/net/http/pprof
- pprof README and CLI reference: https://github.com/google/pprof/blob/main/doc/README.md
- `profile.proto`: https://github.com/google/pprof/blob/main/proto/profile.proto
- Go blog — Profiling Go programs: https://go.dev/blog/pprof
