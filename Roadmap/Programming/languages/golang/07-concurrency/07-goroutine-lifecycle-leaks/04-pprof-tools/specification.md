# pprof and Profiling Tools — Specification

## Table of Contents
1. [Scope](#scope)
2. [HTTP Endpoints](#http-endpoints)
3. [Profile Types](#profile-types)
4. [Goroutine Debug Levels](#goroutine-debug-levels)
5. [`runtime/pprof` API Surface](#runtimepprof-api-surface)
6. [`net/http/pprof` API Surface](#nethttppprof-api-surface)
7. [`runtime/trace` API Surface](#runtimetrace-api-surface)
8. [`go tool pprof` CLI](#go-tool-pprof-cli)
9. [Runtime Knobs](#runtime-knobs)
10. [Reference Tables](#reference-tables)

---

## Scope

This file is the reference. It enumerates every endpoint, every profile type, every runtime knob, and every CLI flag relevant to goroutine analysis with pprof. It does not teach concepts — see `junior.md` through `professional.md` for that. Use it as a lookup.

Versions covered: Go 1.21 through 1.25.

---

## HTTP Endpoints

All endpoints under `/debug/pprof/`. Registered automatically by `import _ "net/http/pprof"` on `http.DefaultServeMux`. Must be registered manually on custom muxes.

| Path | Method | Query parameters | Response |
|------|--------|------------------|----------|
| `/debug/pprof/` | GET | — | HTML index listing available profiles |
| `/debug/pprof/cmdline` | GET | — | text, NUL-separated argv |
| `/debug/pprof/profile` | GET | `seconds=N` (default 30) | binary CPU profile |
| `/debug/pprof/trace` | GET | `seconds=N` (default 1) | binary execution trace |
| `/debug/pprof/symbol` | GET, POST | `[+]PC` list | text, address-to-symbol map |
| `/debug/pprof/goroutine` | GET | `debug=0\|1\|2` | binary or text |
| `/debug/pprof/heap` | GET | `debug=0\|1`, `gc=1` | binary or text |
| `/debug/pprof/allocs` | GET | `debug=0\|1` | binary or text |
| `/debug/pprof/threadcreate` | GET | `debug=0\|1` | binary or text |
| `/debug/pprof/block` | GET | `debug=0\|1` | binary or text |
| `/debug/pprof/mutex` | GET | `debug=0\|1` | binary or text |
| `/debug/pprof/<custom>` | GET | `debug=0\|1` | profile by name |

All `debug` parameters default to `0` when called by `go tool pprof` (which sets `Accept: application/octet-stream`).

---

## Profile Types

| Name | Always-on | Enabled how | What it samples |
|------|-----------|-------------|-----------------|
| `goroutine` | yes | — | Live goroutines and their stacks |
| `heap` | yes | `runtime.MemProfileRate > 0` (default 512KB) | Sampled allocations still in use |
| `allocs` | yes | same as heap | Sampled allocations total |
| `threadcreate` | yes | — | OS thread creation sites |
| `block` | no | `runtime.SetBlockProfileRate(n)` | Blocking events |
| `mutex` | no | `runtime.SetMutexProfileFraction(n)` | Contended mutex holders |
| `profile` (CPU) | on demand | `pprof.StartCPUProfile` / HTTP `seconds=` | Periodic stack sampling |
| `trace` | on demand | `trace.Start` / HTTP `seconds=` | Full execution event log |

Custom profiles created with `pprof.NewProfile(name)` are added to the registry and exposed at `/debug/pprof/<name>`.

---

## Goroutine Debug Levels

| `debug=` | Content-Type | Format | Use case |
|----------|--------------|--------|----------|
| `0` | `application/octet-stream` | pprof protobuf | feed to `go tool pprof` |
| `1` | `text/plain` | grouped stacks with counts | quick visual triage |
| `2` | `text/plain` | every goroutine, full stack, state | per-goroutine forensics |

### `debug=1` output structure

```
goroutine profile: total <N>
<count> @ <pc1> <pc2> ...
#       <pc>     <function>+<offset>    <file>:<line>
#       ...

<count> @ ...
```

### `debug=2` output structure

```
goroutine <id> [<state>, <duration>]:
<function>(<args>)
        <file>:<line> +<offset>
<caller>(<args>)
        ...
created by <function> in goroutine <id>
        <file>:<line> +<offset>

goroutine <id> [<state>]:
...
```

### Goroutine states reported in `debug=2`

| State | Meaning |
|-------|---------|
| `running` | currently on a P |
| `runnable` | ready to run, waiting for a P |
| `syscall` | in a system call |
| `chan send` | blocked sending to a channel |
| `chan receive` | blocked receiving from a channel |
| `IO wait` | waiting on the network poller |
| `select` | blocked in a `select` |
| `sleep` | inside `time.Sleep` |
| `sync.Mutex.Lock` | blocked acquiring a mutex |
| `sync.WaitGroup.Wait` | blocked on a WaitGroup |
| `semacquire` | blocked on the runtime semaphore |
| `GC sweep wait` | waiting for GC sweeper |
| `finalizer wait` | finalizer goroutine idle |

A duration in brackets (`[chan receive, 12 minutes]`) appears when the goroutine has been in that state for longer than a runtime threshold (about 1 minute). It is the single strongest leak signal.

---

## `runtime/pprof` API Surface

```go
package pprof

func StartCPUProfile(w io.Writer) error
func StopCPUProfile()

type Profile struct{}
func NewProfile(name string) *Profile
func Lookup(name string) *Profile
func Profiles() []*Profile

func (*Profile) Name() string
func (*Profile) Count() int
func (*Profile) Add(value any, skip int)
func (*Profile) Remove(value any)
func (*Profile) WriteTo(w io.Writer, debug int) error

func WriteHeapProfile(w io.Writer) error

type LabelSet struct{}
func Labels(args ...string) LabelSet
func WithLabels(ctx context.Context, labels LabelSet) context.Context
func Label(ctx context.Context, key string) (string, bool)
func ForLabels(ctx context.Context, f func(key, value string) bool)
func SetGoroutineLabels(ctx context.Context)
func Do(ctx context.Context, labels LabelSet, f func(context.Context))
```

Key facts:

- `Labels(args...)` takes an even number of strings (key, value, key, value, ...).
- `SetGoroutineLabels` overwrites all labels on the current goroutine.
- `Do` is the safe pattern: scoped lifetime, automatic restore.
- Labels are not propagated to spawned goroutines automatically.

---

## `net/http/pprof` API Surface

```go
package pprof

func Index(w http.ResponseWriter, r *http.Request)
func Cmdline(w http.ResponseWriter, r *http.Request)
func Profile(w http.ResponseWriter, r *http.Request)
func Symbol(w http.ResponseWriter, r *http.Request)
func Trace(w http.ResponseWriter, r *http.Request)
func Handler(name string) http.Handler
```

`Handler(name)` returns the handler for a named profile (`goroutine`, `heap`, etc.). Use it to register on a custom mux.

```go
mux.Handle("/debug/pprof/goroutine", pprof.Handler("goroutine"))
mux.Handle("/debug/pprof/heap", pprof.Handler("heap"))
// etc.
```

The package's `init()` registers all routes on `http.DefaultServeMux`. There is no programmatic way to undo this; once imported, the routes are present.

---

## `runtime/trace` API Surface

```go
package trace

func Start(w io.Writer) error
func Stop()
func IsEnabled() bool

type Task struct{}
func NewTask(pctx context.Context, taskType string) (context.Context, *Task)
func (*Task) End()

type Region struct{}
func StartRegion(ctx context.Context, regionType string) *Region
func (*Region) End()
func WithRegion(ctx context.Context, regionType string, f func())

func Log(ctx context.Context, category, message string)
func Logf(ctx context.Context, category, format string, args ...any)
```

Behaviour notes:

- Only one trace at a time. Calling `Start` while a trace is running returns an error.
- Trace events are attributed to the current goroutine.
- `Task` and `Region` survive `go f()` only if the new goroutine continues to use the parent context.

---

## `go tool pprof` CLI

```
go tool pprof [options] [binary] <profile-source>
```

`profile-source` is a file path, an HTTP URL, or `http://host:port/debug/pprof/<name>`.

### Selected options

| Flag | Description |
|------|-------------|
| `-http=addr` | Start the web UI on `addr` |
| `-proto` | Output the profile as protobuf (use with redirection) |
| `-text` | Print top in text |
| `-top` | Same as `-text` for current top |
| `-svg`, `-png`, `-pdf` | Render a graph in the given format |
| `-list=regex` | Print annotated source for matching functions |
| `-seconds=N` | For CPU/trace endpoints |
| `-symbolize=mode` | `none`, `local`, `fastlocal`, `remote`, `force` |
| `-tools=path` | Where to find `addr2line`, `nm`, `objdump` |
| `-focus=regex` | Limit to samples whose stack contains a match |
| `-ignore=regex` | Drop samples whose stack contains a match |
| `-hide=regex` | Suppress function display, retain cost in callers |
| `-show=regex` | Inverse of hide |
| `-tagfocus=key=val` | Limit to samples with this label |
| `-tagignore=key=val` | Drop samples with this label |
| `-base=profile` | Subtract base from current profile |
| `-diff_base=profile` | Diff against base, keep negative samples |
| `-alloc_space`, `-alloc_objects`, `-inuse_space`, `-inuse_objects` | Switch heap view |
| `-sample_index=name` | Switch sample type in any profile |

### Interactive REPL commands

| Command | Purpose |
|---------|---------|
| `top [N]` | Top N entries by current sort |
| `top -cum` | Sort by cumulative |
| `top -flat` | Sort by flat |
| `list <regex>` | Annotated source listing |
| `peek <regex>` | Print callers of matching functions |
| `traces` | Print all unique stacks with counts |
| `tags` | Print tag (label) summaries |
| `tagfocus=k=v` | Set tag focus interactively |
| `web [regex]` | Open graph in browser (graphviz required) |
| `svg`, `pdf`, `png` | Render graph to file |
| `disasm <regex>` | Print disassembly |
| `weblist <regex>` | Source + assembly in browser |
| `sample_index=name` | Switch sample type |
| `unit=type` | Change display unit |
| `help` | Show all commands |
| `quit` | Exit |

---

## Runtime Knobs

| Function | Default | Purpose |
|----------|---------|---------|
| `runtime.MemProfileRate` | 524288 (512 KB) | Bytes between sampled allocations |
| `runtime.SetMutexProfileFraction(n)` | 0 (off) | Sample 1 in n contention events |
| `runtime.SetBlockProfileRate(rate)` | 0 (off) | Sample blocking events lasting >= rate ns |
| `runtime.SetCPUProfileRate(hz)` | 100 | CPU samples per second |
| `runtime.SetGoroutineProfileLimit(n)` | unlimited | Cap on goroutines in a single profile (Go 1.25+) |
| `runtime.GOMAXPROCS(n)` | NumCPU | Number of P contexts |

Environment variables affecting profiling:

| Var | Effect |
|-----|--------|
| `GODEBUG=asyncpreemptoff=1` | Disable async preemption (reverts profile reliability) |
| `GODEBUG=gctrace=1` | Print GC events to stderr |
| `GODEBUG=schedtrace=N` | Print scheduler state every N ms |
| `GODEBUG=scheddetail=1` | Verbose scheduler trace |

---

## Reference Tables

### Profile size estimates (typical)

| Profile | Idle service (10 goroutines) | Busy service (50k goroutines) |
|---------|------------------------------|--------------------------------|
| `goroutine` (debug=0) | ~2 KB | ~500 KB |
| `goroutine` (debug=1) | ~3 KB | ~2 MB |
| `goroutine` (debug=2) | ~5 KB | ~30 MB |
| `heap` | ~20 KB | ~200 KB |
| `profile` (30s) | ~10 KB | ~100 KB |
| `trace` (5s) | ~500 KB | ~50 MB |

### CLI quick reference

```bash
# fetch and analyse
go tool pprof http://host:6060/debug/pprof/goroutine

# fetch, save, analyse
curl -o g.prof http://host:6060/debug/pprof/goroutine
go tool pprof g.prof

# web UI
go tool pprof -http=:9090 g.prof

# diff
go tool pprof -base before.prof after.prof

# tag filter
go tool pprof -tagfocus=tenant=acme g.prof

# CPU profile, 30 seconds
go tool pprof http://host:6060/debug/pprof/profile?seconds=30

# trace
curl -o trace.out http://host:6060/debug/pprof/trace?seconds=5
go tool trace trace.out
```

### Label propagation matrix

| Operation | Labels carried? |
|-----------|-----------------|
| `pprof.Do(ctx, labels, f)` | Yes, while `f` runs |
| `pprof.SetGoroutineLabels(ctx)` | Yes, for current goroutine |
| `go f()` inside a labelled goroutine | No, unless `f` re-applies |
| `ctx` passed to a child function | Yes if child calls `SetGoroutineLabels` |
| `context.WithCancel(ctx)` | Labels remain attached to the new ctx |

### Endpoint security checklist

| Layer | Setting |
|-------|---------|
| Bind address | `127.0.0.1` only |
| Mux | Separate admin mux |
| Authentication | Required if public-facing |
| `seconds=` clamp | Max 60 for CPU, max 10 for trace |
| Concurrency | One CPU profile, one trace at a time |
| Logging | Log all profile fetches with caller identity |
