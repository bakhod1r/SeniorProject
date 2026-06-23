# Detecting Goroutine Leaks — Specification

This file collects the precise contracts of the standard library functions, the `goleak` library, and the pprof profile format relevant to goroutine leak detection. Where the Go language spec is silent (it does not define "leak"), the binding contract is the package documentation. Quotes are paraphrased to be self-contained; refer to `go doc` for canonical wording.

---

## Table of Contents
1. [The Go Spec on Goroutines](#the-go-spec-on-goroutines)
2. [`runtime.NumGoroutine`](#runtimenumgoroutine)
3. [`runtime.Stack`](#runtimestack)
4. [`runtime.Goexit`](#runtimegoexit)
5. [`runtime.GC`](#runtimegc)
6. [`runtime/pprof.Lookup`](#runtimepproflookup)
7. [`runtime/pprof.Profile`](#runtimepprofprofile)
8. [`runtime/pprof.SetGoroutineLabels` and `Do`](#runtimepprofsetgoroutinelabels-and-do)
9. [`net/http/pprof`](#nethttppprof)
10. [`goleak` Contract](#goleak-contract)
11. [Profile Format — `profile.proto`](#profile-format--profileproto)
12. [HTTP Endpoint Contract](#http-endpoint-contract)
13. [`runtime/trace` Contract](#runtimetrace-contract)
14. [`gops` Agent Contract](#gops-agent-contract)
15. [References](#references)

---

## The Go Spec on Goroutines

The Go Programming Language Specification (section "Go statements") states:

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or *goroutine*, within the same address space.
> The function value and parameters are evaluated as usual in the calling goroutine, but unlike with a regular call, program execution does not wait for the invoked function to complete.
> ...
> The function's value and parameters are evaluated as usual; in particular, side effects in those evaluations occur before the new goroutine begins execution.

The spec is silent on:

- When (or whether) a goroutine ends. It only describes how one starts.
- Goroutine identity. There is no spec-level goroutine ID.
- Leaks. The word "leak" does not appear in the language spec.

All leak-related semantics are runtime-defined, not language-defined.

---

## `runtime.NumGoroutine`

```go
// NumGoroutine returns the number of goroutines that currently exist.
func NumGoroutine() int
```

Contract:

- Returns a snapshot count. Subsequent calls may return larger or smaller values without intervening user-visible spawn/exit, because the runtime spawns and reaps system goroutines.
- Includes the calling goroutine.
- Includes runtime-internal goroutines (sysmon, GC workers, finalisers, etc.).
- Excludes goroutines that have called `runtime.Goexit` or returned from their function.
- Threadsafe; may be called concurrently.

The count is observational; the spec does not promise consistency between `NumGoroutine` and a follow-up `pprof.Lookup("goroutine")` taken at a different instant.

---

## `runtime.Stack`

```go
// Stack formats a stack trace of the calling goroutine into buf and returns
// the number of bytes written to buf. If all is true, Stack formats stack
// traces of all other goroutines into buf after the trace for the current
// goroutine.
func Stack(buf []byte, all bool) int
```

Contract:

- Writes at most `len(buf)` bytes; truncates silently if the trace is longer.
- With `all=true`, briefly pauses other goroutines so it can collect their stacks coherently. The pause is short but not zero.
- The returned text is human-readable but the exact format is not part of the API. The format includes a `goroutine N [state]:` header followed by frames in `func\nfile:line +0xNN` format.
- Argument values are best-effort; printed as `0xNNNN` and may be `?` when registers cannot be recovered.

Use a generous buffer — 1 MB is reasonable; 4 MB is safe at 100k goroutines.

---

## `runtime.Goexit`

```go
// Goexit terminates the goroutine that calls it. No other goroutine is affected.
// Goexit runs all deferred calls before terminating the goroutine.
func Goexit()
```

Contract:

- Calling `Goexit` from the main goroutine terminates that goroutine without crashing the program — the program continues with other goroutines, but `main`'s return path is now gone.
- If `Goexit` is called and there are no other goroutines, the program crashes with `"no goroutines"`.
- Deferred functions run in LIFO order. A `recover()` inside a deferred function called via `Goexit` returns `nil` — `Goexit` is not a panic.

For leak detection, a goroutine that returns via `Goexit` does not appear in profiles taken afterward.

---

## `runtime.GC`

```go
// GC runs a garbage collection and blocks the caller until the garbage
// collection is complete.
func GC()
```

Calling `GC()` before a profile capture is a *hygiene* practice. It does not affect goroutine count directly (the GC does not reclaim live goroutines), but it ensures that any pending finalisers have a chance to fire and that the heap profile (if taken in parallel) reflects a settled state.

---

## `runtime/pprof.Lookup`

```go
// Lookup returns the profile with the given name, or nil if no such profile
// exists.
func Lookup(name string) *Profile
```

The built-in profiles are: `goroutine`, `threadcreate`, `heap`, `allocs`, `block`, `mutex`. For leak detection, `Lookup("goroutine")` is the one of interest.

---

## `runtime/pprof.Profile`

```go
type Profile struct { /* opaque */ }

// Count returns the number of execution stacks currently in the Profile.
func (p *Profile) Count() int

// WriteTo writes a pprof-formatted snapshot of the profile to w.
// If a write to w returns an error, WriteTo returns that error.
// Otherwise WriteTo returns nil.
//
// The debug parameter enables additional output. Passing debug=0 writes the
// gzip-compressed protocol buffer; passing debug=1 writes the legacy text
// format with comments translating addresses to function names and line
// numbers, so that a programmer can read the profile without tools.
// debug=2 is supported only by the "goroutine" profile; it writes the
// stack traces in the same form as a Go panic.
func (p *Profile) WriteTo(w io.Writer, debug int) error
```

Contract:

- `Count()` for the goroutine profile equals `runtime.NumGoroutine()` (modulo a possible difference of 1–3 due to the call boundary).
- `WriteTo(w, 0)` writes a gzipped protobuf — the input expected by `go tool pprof`.
- `WriteTo(w, 1)` writes counts + unique stacks in text form.
- `WriteTo(w, 2)` writes every goroutine individually in panic-stack format.

---

## `runtime/pprof.SetGoroutineLabels` and `Do`

```go
// SetGoroutineLabels sets the current goroutine's labels to match ctx.
// New goroutines spawned from this goroutine inherit no labels.
func SetGoroutineLabels(ctx context.Context)

// Labels takes an even number of strings representing key-value pairs and
// makes a context.Context containing the labels.
func Labels(args ...string) LabelSet

// Do calls f with a context whose Goroutine labels are set to the given labels
// added to those already on ctx. The labels are propagated to any goroutines
// spawned during f's call via go.
func Do(ctx context.Context, labels LabelSet, f func(context.Context))
```

Contract:

- Labels are attached to a goroutine; the runtime stores them in the goroutine struct.
- Labels appear in `debug=0` (protobuf) profiles. They do *not* appear in `debug=2` text profiles.
- `pprof.Do` propagates labels to goroutines spawned via `go` *inside* the callback. The propagation is cooperative — it uses the context.
- Labels are inherited only within `pprof.Do`'s callback; bare `go f()` outside of `Do` does not propagate.

---

## `net/http/pprof`

Importing `net/http/pprof` registers handlers on `http.DefaultServeMux`:

| URL | Handler | Effect |
|------|---------|--------|
| `/debug/pprof/` | `Index` | HTML index of available profiles |
| `/debug/pprof/goroutine` | `Handler("goroutine").ServeHTTP` | Returns `WriteTo(w, debug)` of the goroutine profile |
| `/debug/pprof/heap` | `Handler("heap")` | Heap profile |
| `/debug/pprof/profile` | `Profile` | 30-second CPU profile (configurable via `seconds`) |
| `/debug/pprof/trace` | `Trace` | Execution trace (configurable via `seconds`) |
| `/debug/pprof/cmdline` | `Cmdline` | Process command line |
| `/debug/pprof/symbol` | `Symbol` | Symbol resolution for pprof |

The `debug` query parameter (0/1/2) is passed through to `WriteTo`. Default is 0.

The package documentation explicitly warns:

> The package is typically only imported for the side effect of registering its HTTP handlers. The handled paths all begin with /debug/pprof/.

And:

> ... be careful when exposing the pprof HTTP endpoints publicly, as they expose internal program data.

---

## `goleak` Contract

`go.uber.org/goleak` (v1.x):

```go
// VerifyNone fails the test if any goroutine is leaked.
func VerifyNone(t TestingT, options ...Option)

// VerifyTestMain runs all tests in m and verifies no goroutines are leaked
// after all tests run. Designed to be called from TestMain.
func VerifyTestMain(m TestingM, options ...Option) // calls os.Exit
```

Contract:

- A goroutine is considered "leaked" if it exists at the verification time and is not on the ignore list.
- The default ignore list includes the runtime-internal goroutines (`runtime.gopark`-based runtime helpers, `runtime.bgsweep`, `runtime.forcegchelper`, etc.) and the test framework itself (`testing.(*T).Run`).
- `VerifyTestMain` calls `m.Run()`, then checks goroutines. If any non-ignored goroutine is alive, it prints the offenders and calls `os.Exit(1)`.
- `VerifyNone` may be called from any test; it polls for up to `~100ms` to allow goroutines to exit before reporting.

Options:

- `IgnoreCurrent()` — snapshot the goroutines alive at this call; treat them as the baseline.
- `IgnoreTopFunction(name)` — drop goroutines whose top frame is `name`.
- `IgnoreAnyFunction(name)` — drop goroutines whose stack mentions `name` at any frame.
- `Cleanup(cleanup func(error))` — run a callback on detection.

---

## Profile Format — `profile.proto`

The pprof profile is defined in `github.com/google/pprof/proto/profile.proto`:

```proto
message Profile {
    repeated ValueType sample_type = 1;
    repeated Sample sample = 2;
    repeated Mapping mapping = 3;
    repeated Location location = 4;
    repeated Function function = 5;
    repeated string string_table = 6;
    // ... timestamps, period, etc.
}

message Sample {
    repeated uint64 location_id = 1;
    repeated int64 value = 2;
    repeated Label label = 3;
}

message Location {
    uint64 id = 1;
    uint64 mapping_id = 2;
    uint64 address = 3;
    repeated Line line = 4;
}

message Line {
    uint64 function_id = 1;
    int64 line = 2;
}

message Function {
    uint64 id = 1;
    int64 name = 2;          // index into string_table
    int64 system_name = 3;
    int64 filename = 4;
    int64 start_line = 5;
}

message Label {
    int64 key = 1;           // index into string_table
    int64 str = 2;           // string value
    int64 num = 3;           // numeric value
    int64 num_unit = 4;
}
```

For the goroutine profile:

- `sample_type` is `[{Type: "goroutine", Unit: "count"}]`.
- Each `Sample.value` is a single int64: the number of goroutines sharing that stack.
- `Sample.location_id` is the stack from innermost frame outward.
- `Sample.label` carries any `pprof.Labels` set via `SetGoroutineLabels`/`Do`.

---

## HTTP Endpoint Contract

For `/debug/pprof/goroutine`:

| Param | Type | Default | Effect |
|-------|------|---------|--------|
| `debug` | int | 0 | 0 = protobuf, 1 = text counts, 2 = text per-goroutine |
| `seconds` | int | 0 | Not applicable for goroutine endpoint |
| `gc` | int | 0 | If non-zero on heap profile, runs GC first; ignored for goroutine |

Status codes:

- 200 — profile delivered.
- 5xx — runtime busy or panicking.

Headers:

- `Content-Type: application/octet-stream` for `debug=0`.
- `Content-Type: text/plain; charset=utf-8` for `debug=1` and `debug=2`.

---

## `runtime/trace` Contract

```go
// Start enables tracing for the current program. It returns an error if
// tracing is already enabled.
func Start(w io.Writer) error

// Stop stops the current tracing, if any. Stop only returns after all the
// writes for the trace have completed.
func Stop()
```

Contract:

- Only one trace can be active at a time.
- The output is the binary trace format defined in `internal/trace/`. Parse via `golang.org/x/exp/trace` or `go tool trace`.
- Events recorded include goroutine create/start/block/unblock/end, network/syscall enter/exit, GC events, and user-defined regions via `trace.WithRegion`.
- The performance cost is non-trivial; expect 10-30% overhead while tracing.

---

## `gops` Agent Contract

`github.com/google/gops/agent`:

```go
func Listen(opts Options) error
func Close()
```

Contract:

- `Listen` starts an HTTP server (or Unix socket on Linux) on `127.0.0.1:0` by default.
- A `~/.config/gops/<pid>` file records the port so the CLI can find it.
- Commands supported: `stack`, `gc`, `memstats`, `version`, `stats`, `pprof-heap`, `pprof-cpu`, `trace`.
- Each command serialises the request and reads the response over the local socket; no authentication is required, so do not expose the socket externally.

---

## References

- The Go Programming Language Specification — "Go statements", "Concurrency".
- `runtime` package documentation: `go doc runtime.NumGoroutine`, `go doc runtime.Stack`, `go doc runtime.Goexit`.
- `runtime/pprof` package documentation: `go doc runtime/pprof`, especially `Lookup` and `Profile`.
- `net/http/pprof` package documentation.
- `go.uber.org/goleak` README and source.
- `github.com/google/pprof/proto/profile.proto`.
- `runtime/trace` and `go tool trace` documentation.
- `github.com/google/gops` agent source.
