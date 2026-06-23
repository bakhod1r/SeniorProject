# 8.5 `os` — Find the Bug

> Thirteen buggy snippets covering the most common `os`, `os/exec`,
> and `os/signal` mistakes. Each one is a real pattern people ship.
> Read the code, find the bug, then read the analysis. Fixes are
> shown after the analysis.

## Bug 1 — Unbuffered signal channel

```go
func main() {
    sigs := make(chan os.Signal)            // bug
    signal.Notify(sigs, syscall.SIGINT)

    fmt.Println("waiting")
    <-sigs
    fmt.Println("got it")
}
```

**The bug.** `signal.Notify` does a non-blocking send on the
channel. If the channel is unbuffered and the goroutine receiving
from it isn't currently parked in `<-sigs`, the signal is dropped.
In this snippet the receiver *is* ready by the time most signals
arrive, so it usually works in tests — and silently fails in
production where there's a `time.Sleep` or any other work between
`Notify` and the receive.

**Fix.**

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT)
```

A buffer of 1 is enough: if a signal is queued and another arrives,
you only need one wakeup, since the meaning is "something happened."

## Bug 2 — `Wait` before draining `StdoutPipe`

```go
cmd := exec.Command("verbose-tool")
out, _ := cmd.StdoutPipe()
cmd.Start()
err := cmd.Wait()                           // bug: blocks forever
data, _ := io.ReadAll(out)
```

**The bug.** The pipe between parent and child has a fixed kernel
buffer (~64 KiB on Linux). When the child writes more than that, it
blocks in `write(2)` waiting for a reader. The reader doesn't exist
yet — we're in `Wait`, not `ReadAll`. Child blocks, parent blocks,
deadlock.

The package docs say it explicitly: "It is incorrect to call Wait
before all reads from the pipe have completed."

**Fix.**

```go
cmd := exec.Command("verbose-tool")
out, _ := cmd.StdoutPipe()
cmd.Start()
data, errR := io.ReadAll(out)               // drain first
errW := cmd.Wait()                          // then wait
if errR != nil { return errR }
if errW != nil { return errW }
```

For separate `StdoutPipe` and `StderrPipe`, drain both
*concurrently* with two goroutines.

## Bug 3 — `os.Exit` in a defer

```go
func main() {
    defer cleanup()                         // bug: never runs
    if bad() {
        os.Exit(1)
    }
}
```

**The bug.** `os.Exit` does not run deferred functions. Not in the
calling goroutine, not anywhere. The `defer cleanup()` registered at
the top of `main` is silently skipped.

This bites every Go programmer exactly once, often during a debug
session where the cleanup function is `pidFile.Remove()` or
`logger.Sync()`.

**Fix.** Wrap the work in a function that returns an error; let
`main` translate to an exit code:

```go
func run() error {
    defer cleanup()
    if bad() {
        return errors.New("bad happened")
    }
    return nil
}

func main() {
    if err := run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

Now `cleanup` runs on the `return err` path, and `main`'s only job
is exit-code translation.

## Bug 4 — `signal.Notify` on a nil channel

```go
var sigs chan os.Signal                     // bug: nil
signal.Notify(sigs, syscall.SIGINT)
<-sigs
```

**The bug.** `sigs` is a zero-value channel: `nil`. `signal.Notify`
panics on a nil channel (it has an explicit check). Even without the
panic, a receive on a nil channel blocks forever.

The mistake comes from forgetting `make`:

**Fix.**

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT)
<-sigs
```

The `var sigs chan T` form looks innocent because `chan T` is the
type — but a `var`-declared channel is nil and useless until `make`.

## Bug 5 — Using `Run` when you need streaming output

```go
cmd := exec.Command("backup", "/tb-of-data")
cmd.Stdout = nil                            // bug
cmd.Stderr = nil
err := cmd.Run()
fmt.Println("done")
```

**The bug.** With `Stdout` and `Stderr` set to `nil`, the runtime
discards the child's output. So we know nothing about progress, and
if the child writes diagnostic info to stderr, that's gone too. For
a long-running command, you wanted streaming.

**Fix.**

```go
cmd := exec.Command("backup", "/tb-of-data")
cmd.Stdout = os.Stdout                      // pass-through to our stdout
cmd.Stderr = os.Stderr
err := cmd.Run()
```

When `Cmd.Stdout` is an `*os.File`, the runtime passes the FD
directly to the child — no copy, no goroutine. For pass-through this
is the cheapest option.

## Bug 6 — Inheriting parent env without realizing it

```go
cmd := exec.Command("./worker")
// no cmd.Env set                           // bug-prone
out, _ := cmd.Output()
```

**The bug.** This isn't always wrong — but it's often surprising. With
`Cmd.Env == nil`, the child inherits the parent's *full* environment,
including stale variables, secrets the worker shouldn't see, and
anything CI has set. Several services have leaked credentials by
forking a child that logged its env.

**Fix.** Be explicit. For minimal env:

```go
cmd := exec.Command("./worker")
cmd.Env = []string{
    "PATH=" + os.Getenv("PATH"),
    "HOME=" + os.Getenv("HOME"),
    "WORKER_TASK=process-batch",
}
```

For "inherit + add":

```go
cmd.Env = append(os.Environ(), "WORKER_TASK=process-batch")
```

Either is fine. The point is to know which one you mean.

## Bug 7 — Building a shell command with `fmt.Sprintf`

```go
func search(user string) ([]byte, error) {
    cmd := exec.Command("sh", "-c",
        fmt.Sprintf("grep %s /etc/passwd", user)) // bug: injection
    return cmd.Output()
}
```

**The bug.** Classic shell injection. If `user` is `"alice; rm -rf
/"`, the executed line is `grep alice; rm -rf / /etc/passwd` — and
the second statement runs.

**Fix.** Don't use a shell at all unless you need shell features. Pass
the args directly to the binary:

```go
cmd := exec.Command("grep", user, "/etc/passwd")
return cmd.Output()
```

`exec.Command` does not invoke a shell. Each argument is passed as a
distinct `argv` element to the child; quoting and word-splitting do
not happen. `user` can contain spaces, quotes, semicolons — none of
them have special meaning.

If you absolutely need shell features (`|`, `&&`, `*`), validate the
input against an allowlist *before* interpolation, or build the
pipeline as multiple `exec.Cmd` values connected via `Cmd.StdoutPipe`.

## Bug 8 — `CombinedOutput` on a long-running process

```go
cmd := exec.Command("./streamer")            // writes 10 GB of logs
out, err := cmd.CombinedOutput()             // bug: 10 GB allocation
```

**The bug.** `CombinedOutput` (and `Output`) buffer the entire
captured stream in memory. A child that writes a lot will OOM the
parent.

**Fix.** Stream instead of capturing. Use `Cmd.Stdout = w` for any
`io.Writer`, or `Cmd.Stdout = os.Stdout` for pass-through:

```go
cmd := exec.Command("./streamer")
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
err := cmd.Run()
```

If you want a bounded capture, write a tiny `limitedWriter` that
returns `io.ErrShortBuffer` past the cap:

```go
type limWriter struct {
    w   io.Writer
    cap int
    n   int
}
func (l *limWriter) Write(p []byte) (int, error) {
    if l.n+len(p) > l.cap {
        return 0, io.ErrShortBuffer
    }
    n, err := l.w.Write(p)
    l.n += n
    return n, err
}
```

Plug it in via `Cmd.Stdout = &limWriter{w: &buf, cap: 1 << 20}`.

## Bug 9 — Ignoring `Cmd.WaitDelay`

```go
ctx, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()

cmd := exec.CommandContext(ctx, "./stubborn") // ignores SIGKILL... no it doesn't
err := cmd.Run()                              // but blocks forever if pipes still open
```

**The bug.** `exec.CommandContext` sends SIGKILL on context
cancellation, which the kernel forces on the child immediately. So
the *child* dies. But the runtime's I/O goroutines (copying from
child stdout/stderr to your writers) might still be waiting on
something that never closes — and `Wait` waits for them.

Without `Cmd.WaitDelay`, `Wait` can block indefinitely after the
child is gone.

**Fix.**

```go
cmd := exec.CommandContext(ctx, "./stubborn")
cmd.WaitDelay = 5 * time.Second  // give I/O 5s to finish, then give up
err := cmd.Run()
```

`WaitDelay` is the runtime's "I tried, but I'm done" timer. Set it
on every `CommandContext` call.

## Bug 10 — Concurrent `os.Setenv`

```go
func init() {
    for _, kv := range defaultEnv {
        go os.Setenv(kv.k, kv.v)             // bug: race
    }
}
```

**The bug.** `os.Setenv` mutates a process-global table. The Go
runtime added internal locking in 1.18, but cgo programs read the
environment directly via `getenv(3)`, which is not protected by the
Go lock — and on some platforms the underlying `setenv(3)` itself
isn't async-signal-safe or thread-safe.

Even when it doesn't crash, `Setenv` from many goroutines is racy
with respect to any goroutine that's also reading.

**Fix.** Set env at startup, single-threaded, before any other
goroutine starts:

```go
func init() {
    for _, kv := range defaultEnv {
        os.Setenv(kv.k, kv.v)               // synchronous
    }
}
```

Better still: don't use env mutation as your config-passing mechanism.
Snapshot env into a typed struct at startup and read from the struct.

## Bug 11 — Treating exit code 0 as "ran successfully"

```go
err := cmd.Run()
if err == nil {
    log.Println("worker succeeded")        // bug: not necessarily
}
```

**The bug.** `cmd.Run()` returns `nil` only when the child exits
with status 0. But "exit 0" doesn't mean the child *did* its work —
it just means the child decided to exit 0. Some tools exit 0 even
on partial failure.

Worse: if the child was killed by a signal, `cmd.Run()` returns an
`*exec.ExitError`, but `ExitCode()` returns `-1`. Your code that
checks `if exitCode == 0` would treat it as success.

**Fix.** Inspect the `ProcessState` after `Wait`:

```go
err := cmd.Run()
ps := cmd.ProcessState
if ps == nil {
    return fmt.Errorf("worker did not start: %w", err)
}
if !ps.Success() {
    if ws, ok := ps.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
        return fmt.Errorf("worker killed by %v", ws.Signal())
    }
    return fmt.Errorf("worker exited %d", ps.ExitCode())
}
```

`ps.Success()` is `true` iff the child exited cleanly with code 0.
For "succeeded *and* didn't lie about it," combine with an
out-of-band check (a result file, a status RPC).

## Bug 12 — SIGKILL as your first move

```go
cmd := exec.Command("./long-task")
cmd.Start()
time.Sleep(time.Second)
cmd.Process.Kill()                            // bug: SIGKILL immediately
```

**The bug.** `(*Process).Kill()` sends `SIGKILL` on Unix. SIGKILL
cannot be caught, so the child dies instantly with no chance to
flush buffers, write a state file, close DB connections, or
otherwise clean up.

For services that own data, this leaves it in whatever state the
last `write(2)` left it.

**Fix.** Send SIGTERM, then SIGKILL after a grace:

```go
cmd.Process.Signal(syscall.SIGTERM)

done := make(chan error, 1)
go func() { done <- cmd.Wait() }()
select {
case err := <-done:
    return err
case <-time.After(10 * time.Second):
    cmd.Process.Kill()                        // last resort
    return <-done
}
```

Reach for SIGKILL only when the child has demonstrated it ignores
SIGTERM.

## Bug 13 — Not handling SIGCHLD as PID 1

```go
// Containerized Go program; runs as PID 1.
func main() {
    cmd := exec.Command("./tool", "step1")
    cmd.Run()
    cmd2 := exec.Command("./tool", "step2")
    cmd2.Run()
    // ... but `tool` itself forks short-lived helpers ...
}
```

**The bug.** Inside the container, your Go program is PID 1. When
`./tool` forks helper processes that itself doesn't reap, those
helpers are reparented to PID 1 — *you* — when `tool` exits. You
never `Wait` on them, so they become zombies. Over the lifetime of
the container, zombies accumulate until the kernel runs out of PIDs.

**Fix.** As PID 1, run a SIGCHLD-driven reaper:

```go
//go:build linux
import "golang.org/x/sys/unix"

func reapZombies() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGCHLD)
    for range sigs {
        for {
            var ws unix.WaitStatus
            pid, err := unix.Wait4(-1, &ws, unix.WNOHANG, nil)
            if pid <= 0 || err != nil {
                break
            }
        }
    }
}

func main() {
    if os.Getpid() == 1 {
        go reapZombies()
    }
    // ... rest of main ...
}
```

Or — and this is what most production deployments do — ship `tini`
(`ENTRYPOINT ["/tini", "--"]`) as PID 1 and let it handle reaping.
Your Go binary stays at PID 2, where the kernel's default SIGCHLD
behavior (reparent to init = tini) takes over.

## Bug 14 — Closing `os.Stdout`

```go
defer os.Stdout.Close()                       // bug: bad idea
fmt.Println("starting")
```

**The bug.** Closing `os.Stdout` (or `Stderr`, or `Stdin`) closes
the underlying file descriptor. Any subsequent write — by your code,
the runtime's panic stack-trace dumper, or a buffered logger you
forgot — fails with `os.ErrClosed`. The runtime can no longer print
its own crash info.

`os.Stdout` is shared with the rest of the runtime; you don't own
it.

**Fix.** Never close the standard streams. If you want to redirect
output, replace the variable carefully (and only at startup), or
wrap with `os.NewFile(uintptr(...), ...)` as needed:

```go
// don't:  os.Stdout.Close()
// do:     write to os.Stdout normally; let the OS close on exit.
```

If you really need to close stdout (for daemonization, say), use
`syscall.Close(1)` after redirecting it to `/dev/null` first — but
modern Go services running under a supervisor should never need
this.

## Pattern recap

The most common `os`-family bugs in production are:

| Bug | Cause |
|-----|-------|
| Signals dropped | Channel size 0 |
| Subprocess hangs | `Wait` before drain; or single goroutine drains both pipes |
| Defers don't run | `os.Exit` (or `log.Fatal`) called somewhere |
| Child holds resources after deadline | `WaitDelay` unset; SIGKILL not actually sent |
| Shell injection | Built command line with `fmt.Sprintf` and shell |
| Memory blowup | `Output` / `CombinedOutput` on a streaming child |
| Zombies | PID 1 with no reaper, or `Start` without `Wait` |
| Surprised env | Used `nil` `Cmd.Env` and inherited everything |
| Bad exit-code logic | Treated `err == nil` as proof of work-done |

The good news is they're all detectable in code review. Memorize the
checklist; you'll find them in other people's code for years.

## See also

- [middle.md](middle.md) for the full pipe-wiring pattern.
- [senior.md](senior.md) for the deadlock dissection and process-
  group mechanics.
- [professional.md](professional.md) for the operational checklist.
