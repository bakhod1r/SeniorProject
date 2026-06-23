# 8.5 `os` — Optimize

> Performance characteristics of the `os`, `os/exec`, and `os/signal`
> APIs: where the cost lives, what the syscall budget looks like, and
> what to do when subprocess overhead, env access, or signal latency
> shows up in a profile.

## 1. The cost of `os.Getenv`

`os.Getenv` looks like a map lookup but isn't. Internally it walks
the `os.Environ()` slice, comparing each `"KEY=VALUE"` entry. Worse,
on some platforms it locks an internal mutex. Some implementations
copy the value before returning it.

For a single call, fine. On a hot path, deadly. Real numbers from a
laptop benchmark (Go 1.22, Linux):

```
BenchmarkGetenv-12    ~80 ns/op    16 B/op
BenchmarkMapLookup-12  ~5 ns/op     0 B/op
```

10–20× slower than a map lookup, plus an allocation per call.

**Pattern: snapshot at startup.**

```go
type Config struct {
    Addr     string
    LogLevel string
    DBURL    string
}

var cfg *Config

func init() {
    cfg = &Config{
        Addr:     env("LISTEN_ADDR", ":8080"),
        LogLevel: env("LOG_LEVEL", "info"),
        DBURL:    env("DATABASE_URL", ""),
    }
}

// On the hot path:
func handler(w http.ResponseWriter, r *http.Request) {
    if cfg.LogLevel == "debug" { /* ... */ }
}
```

Reading from a struct field is sub-nanosecond. The first call to
`Getenv` is fine; the millionth call per second is not.

For tests that vary env, use `t.Setenv(...)` and re-init the
snapshot. The runtime cost moves out of production code.

## 2. `os.Environ()` allocates

```go
for _, kv := range os.Environ() {
    // ...
}
```

This allocates a fresh `[]string` containing copies of every
environment entry. For a process with 200 env vars, that's 200
string allocations. Don't do it on a hot path.

If you need to enumerate env vars repeatedly, snapshot once into a
`map[string]string` at startup.

## 3. `Cmd` allocation cost

`exec.Command` allocates a `*Cmd`. `Start` does additional work:
duplicating the env slice, building the argv array, calling the
fork+exec syscalls, and spawning up to three goroutines for stdin/
stdout/stderr piping.

A fork+exec on Linux costs roughly 100–500 µs depending on how big
the parent process is (it has to copy the page table). On macOS,
similar order. So:

| Operation | Order of magnitude |
|-----------|--------------------|
| Function call | ns |
| Channel send | ~10–100 ns |
| Goroutine creation | ~µs |
| Cmd construction | ~µs |
| `Cmd.Start` (fork+exec) | 100s of µs to several ms |
| `Cmd.Wait` | depends on child |

For tasks where you'd otherwise do this in-process, exec is
ridiculously expensive. Reach for `exec.Command` when there's no
in-process option, not as a default.

## 4. The cost of `CombinedOutput` buffering

`CombinedOutput` allocates a `bytes.Buffer` and grows it as data
arrives. For 10 MiB of output, that's roughly:
- `bytes.Buffer.Write` triggers reallocs as it grows; the standard
  doubling growth means total allocated memory is ~20 MiB peak (the
  old slice plus the new one before GC reclaims).
- Garbage to GC after the call.

For known-small commands (`git rev-parse HEAD` returns 41 bytes),
this is fine. For unknown-size or large output, stream:

```go
cmd := exec.Command("./tool")
cmd.Stdout = io.Discard            // we don't care about output
err := cmd.Run()
```

Or write to a file directly:

```go
out, err := os.Create("output.bin")
if err != nil { return err }
defer out.Close()

cmd.Stdout = out                   // child writes straight to file via FD
err = cmd.Run()
```

When `cmd.Stdout` is an `*os.File`, the runtime hands the FD to the
child. There's no in-process buffering at all.

## 5. The exec syscall: fork vs vfork vs posix_spawn

Go's `exec.Cmd` uses `clone` (Linux) or `fork+exec` (other Unix) to
create the child. On Linux with very large processes, this can be
expensive because the kernel must copy the page table — even with
copy-on-write, the metadata cost is proportional to the parent's
address space.

The classic mitigation, `vfork`, suspends the parent until the child
calls `exec`. Go does not use `vfork` because it's hostile to
multi-threaded runtimes (the suspended threads break invariants).

What you can do:

1. **Fork early.** Spawn a small helper process at startup, then
   have it spawn children on demand. This is the "init worker"
   pattern; it amortizes the address-space cost.
2. **Reuse the child.** If you're going to call `git` 100 times, run
   `git` once with `--batch` mode if it has one, or open a long-lived
   subprocess and feed it commands via stdin.
3. **Use the in-process equivalent.** Need to count lines? Don't
   `exec.Command("wc", "-l")`; do it in Go.

## 6. The 32 KiB pipe buffer

The pipe between Go and a child has a kernel-side buffer. On Linux
it's 64 KiB by default (controllable via `/proc/sys/fs/pipe-max-size`).
On macOS, 16 KiB. The Go runtime uses an internal buffer of 32 KiB
for the goroutine that pumps data through.

Implications:
- Small reads/writes thrash. If you set `cmd.Stdout = aWriter` and
  `aWriter` flushes per Write, you're flushing a lot.
- Large writes (>32 KiB) are split.

For high-throughput piping, wrap your writer in `bufio.Writer` so
the runtime's pump batches into your slow writer:

```go
out := bufio.NewWriterSize(slowWriter, 256<<10) // 256 KiB
defer out.Flush()
cmd.Stdout = out
err := cmd.Run()
```

## 7. Fork cost on large processes

Linux's `clone` has to copy the parent's page-table metadata (not
the pages — copy-on-write handles those). For a parent with a 4 GiB
heap, the page table is roughly 4 GiB / 4 KiB × 8 bytes = 8 MiB of
metadata, which costs ~1–10 ms to copy.

Real numbers from a benchmark of a Go server with 4 GiB resident:
`exec.Command("/bin/true").Run()` takes 5–15 ms instead of the
sub-millisecond it would take for a small parent.

Mitigations for hot-path forks in big processes:
- **Use a small-process forker.** Spawn a helper at boot (when the
  parent is small), keep it alive, IPC tasks to it.
- **Switch to `posix_spawn` if available.** Go doesn't, but some
  third-party packages wrap it. (Not in the stdlib.)
- **Avoid forking from the big process.** This is often the right
  answer: the in-process version is faster than any fork can be.

## 8. `prctl(PR_SET_PDEATHSIG)` for child cleanup

A common Linux pattern for "if I die, kill my children":

```go
cmd := exec.Command("./worker")
cmd.SysProcAttr = &syscall.SysProcAttr{
    Pdeathsig: syscall.SIGTERM,
}
```

When the parent process dies (cleanly or not), the kernel sends the
named signal to the child immediately. No need for the parent to
`Wait` or for an external supervisor.

This is *not* a performance optimization per se — it's a correctness
fix that prevents leaked processes. But it removes the need for a
supervisor goroutine that polls the parent's PID and kills the child
on termination, which is its own overhead and complexity.

`Pdeathsig` is Linux-only; on other Unix you have to roll your own.

## 9. Signal-handling latency

When a signal arrives, the kernel marks the thread; on the next safe
point, the thread runs Go's signal handler, which sends on the
registered channel. Total latency: typically a few hundred ns to a
µs, dominated by the OS's signal-delivery path, not Go.

For programs that need *bounded* response times to signals (e.g.,
real-time-ish things), the variability of the channel-receive
goroutine being scheduled matters more than the kernel latency:
- The receiver goroutine has to be scheduled.
- If the runtime is busy, the wakeup can be deferred ms.

`signal.NotifyContext` adds the overhead of context cancellation
plumbing — a few extra ns per goroutine that's listening on the
context.

For latency-sensitive use cases, keep the signal-handling goroutine
otherwise idle and dedicated.

## 10. Context cancellation overhead

`context.WithCancel` and `context.WithTimeout` build a tree of
contexts; cancellation walks the tree and notifies every child. For
small trees (a request → a few subrequests), the cost is microseconds.

For services that create thousands of contexts per request,
cancellation can show up. The mitigation is *don't*: most contexts
don't need cancellation propagation, and `context.Background()` is
free.

For `exec.CommandContext` specifically, the runtime starts a goroutine
that watches `ctx.Done()` and triggers `Cancel`. That goroutine is
cheap (~µs) but it's per-command — a service that runs 10000 commands
at once has 10000 of these goroutines.

## 11. `os.Stat` and `os.Stat`-likes

Discussed at length in the file-handling leaf
([`01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md)).
Quick summary for `os`-leaf relevance: `os.Executable()` calls the
syscall every time. Cache it.

```go
var (
    exeOnce sync.Once
    exePath string
    exeErr  error
)

func executable() (string, error) {
    exeOnce.Do(func() {
        exePath, exeErr = os.Executable()
    })
    return exePath, exeErr
}
```

The path of the running binary doesn't change while the process
runs. Cache once.

## 12. `runtime.GOOS` is a constant

`runtime.GOOS` and `runtime.GOARCH` are compile-time constants. The
compiler can constant-fold branches based on them, eliminating
unreachable code. So:

```go
if runtime.GOOS == "linux" {
    doLinuxThing()
}
```

On a Linux build, the `if` is gone after compilation. On a Windows
build, the body is gone. There's no runtime cost.

This is also how `//go:build linux` works at file granularity:
the compiler simply doesn't see files for other platforms.

## 13. Avoid allocating in hot signal handlers

The goroutine handling signals from `signal.Notify` runs after the
runtime hands off the signal. Anything it does is on the regular
heap, scheduled like any other goroutine. But many people put
allocation-heavy code (logging, JSON marshaling) in the handler:

```go
go func() {
    for sig := range sigs {
        log.Printf("got signal: %v", sig)         // allocates
        notifyMonitoring(sig.String())             // more allocations
    }
}()
```

For most services, fine. For latency-critical paths (a hot reload
that must happen in <1 ms), this is enough to miss the budget. The
fix is to push work onto another goroutine and return immediately:

```go
go func() {
    for sig := range sigs {
        select {
        case work <- sig:
        default:
            // drop or buffer; don't block the signal loop
        }
    }
}()
```

The signal-handling goroutine becomes a thin dispatcher.

## 14. Subprocess output: streaming vs capture cost

| Approach | Memory | CPU | Use when |
|----------|--------|-----|----------|
| `cmd.Output()` | proportional to output size | low | small expected output |
| `cmd.Stdout = os.Stdout` | constant | very low (kernel does copy) | pass-through |
| `cmd.Stdout = bufio.NewWriter(f)` | bounded by buffer | low | writing to file |
| `cmd.StdoutPipe` + `bufio.Scanner` | bounded by token size | medium (goroutine + parsing) | line-by-line processing |

Pick by the kind of consumption you actually do. Don't `CombinedOutput`
and then immediately write the result to a file — wire `cmd.Stdout`
to the file directly.

## 15. Process-group kill is one syscall

`syscall.Kill(-pid, sig)` delivers `sig` to every process in the
group. One syscall, many recipients. Compare with iterating
`syscall.Kill(individualPid, sig)` for each known child:
- `kill(2)` costs ~µs.
- A subtree of 100 children: 1 syscall vs 100 syscalls.

For supervisors that kill subtrees on shutdown, the group form
matters when N is large.

## 16. The `ps`-walk anti-pattern

A common operational hack: shell out to `ps` and grep its output to
find a process. Each `ps` call is a fork+exec, which costs hundreds
of µs to ms. Done in a loop, you can spend most of your CPU budget
just spawning `ps`.

In Go, walk `/proc` directly on Linux:

```go
entries, _ := os.ReadDir("/proc")
for _, e := range entries {
    pid, err := strconv.Atoi(e.Name())
    if err != nil { continue }
    // read /proc/<pid>/stat or /proc/<pid>/comm
    _ = pid
}
```

Two orders of magnitude faster than `ps | grep`.

## 17. Measuring what matters

Before optimizing any of the above, profile:

```sh
go test -bench=. -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -http=:8080 cpu.out
```

For exec-heavy code, also measure with `strace -c`:

```sh
strace -c -e trace=clone,execve,wait4 ./your-program
```

`strace -c` summarizes syscalls by count and time. If you see
millions of `clone`s, you're forking too much. If you see seconds in
`wait4`, your subprocess management is the bottleneck.

## 18. Cross-references

- [`01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md)
  for file-related optimizations: `bufio` sizes, `sendfile`,
  `copy_file_range`.
- [`03-time/optimize.md`](../03-time/junior.md) for context cancellation
  cost in detail.
- [senior.md](senior.md) for the correctness flip side of fast
  exec: `WaitDelay`, `Pdeathsig`, process groups.
