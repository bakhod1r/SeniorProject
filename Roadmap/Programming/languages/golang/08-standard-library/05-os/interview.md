# 8.5 `os` — Interview

> 28 questions and answers covering the `os`, `os/exec`, and `os/signal`
> surface. Mid-level questions toward the top, senior- and staff-level
> toward the bottom. Answers stay close to the level a candidate is
> expected to reach in a 45-minute interview.

## Q1. What's the difference between `os.Getenv` and `os.LookupEnv`?

`Getenv` returns just the value as a string; an unset variable and a
variable set to the empty string both return `""`. `LookupEnv`
returns `(value, ok)`; `ok` is `false` only when the variable is
unset.

Use `LookupEnv` when "set to empty" needs to mean something different
from "not set." For most config-with-default code, `LookupEnv` is the
correct primitive.

## Q2. What happens to deferred functions when `os.Exit` is called?

They don't run. `os.Exit` calls the C `exit(2)` syscall directly; the
Go runtime doesn't get a chance to walk the defer stack of the
calling goroutine, and other goroutines are killed mid-execution
without their defers running either.

The remediation pattern: wrap your real logic in a function that
returns an error, and have `main` translate the error to the exit
code:

```go
func main() {
    if err := run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

`run` does the work (with all the defers); `main` does the exit.

## Q3. Walk me through a graceful shutdown using `signal.NotifyContext`.

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

go srv.ListenAndServe()

<-ctx.Done()                    // wait for signal

drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(drainCtx)          // bounded drain
```

Two contexts: one cancels on signal, one bounds how long shutdown
gets. `defer stop()` restores the default handler so a second Ctrl-C
forces termination immediately. After `Shutdown` returns (or its
context expires), main returns and the process exits.

## Q4. How can subprocess execution deadlock?

The classic case: you call `Cmd.StdoutPipe()`, then `Cmd.Start()`,
then `Cmd.Wait()` *before* draining the pipe. The child writes more
than the pipe's kernel buffer (~64 KiB), blocks on `write(2)`, can
never exit, and `Wait` blocks forever waiting for it.

The contract is documented: drain `StdoutPipe` (and `StderrPipe`,
concurrently) *before* calling `Wait`.

## Q5. What's the difference between `Run`, `Output`, and `CombinedOutput`?

| Method | Stdout | Stderr | Use when |
|--------|--------|--------|----------|
| `Run` | written to `Cmd.Stdout` (or discarded) | likewise | side effects only |
| `Output` | captured into the returned `[]byte` | placed in `*ExitError.Stderr` on failure | you want the output |
| `CombinedOutput` | both interleaved into the returned `[]byte` | likewise | diagnostics |

All three internally call `Start` then `Wait`. They differ only in
how they wire `Stdout` / `Stderr`.

## Q6. Why does `os.Setenv` affect child processes?

Child processes inherit the environment as it stands when `fork`
runs. `os.Setenv` mutates the parent's process-global environment;
any child started after the call sees the new value. Children started
*before* the call already have a copy of the old environment and are
unaffected.

To control a single child's environment without touching the parent's,
set `Cmd.Env` instead — that overrides inheritance for that one
process.

## Q7. How do you reap a zombie process?

A zombie is a child that has exited but whose exit status hasn't been
collected. The collector is `Wait` (or `wait4(2)` on Unix). For each
child you `fork`, you must call `Wait` once.

`exec.Cmd.Run` / `Output` / `CombinedOutput` do this for you. `Start`
without a paired `Wait` leaks zombies.

If you're PID 1 in a container, you also inherit *orphaned*
grandchildren whose parents died. For those, run a SIGCHLD-driven
`unix.Wait4(-1, ..., WNOHANG)` loop, or ship a tiny init like `tini`.

## Q8. What does `signal.Stop` do?

`signal.Stop(ch)` removes `ch` from the list of channels to which
signals are forwarded. After `Stop`, signals previously registered
via `signal.Notify(ch, ...)` go back to whichever default behavior
applies (or to other registered channels).

`signal.NotifyContext` calls `Stop` internally when its context is
cancelled — that's why a second SIGINT terminates the process: with
no Go handler in place, the OS default takes over.

## Q9. Why might SIGTERM be ignored by your Go program?

A few reasons:

1. **The signal channel is unbuffered.** `signal.Notify` does a non-
   blocking send; an unbuffered channel with no ready receiver drops
   the signal. Always `make(chan os.Signal, 1)`.
2. **`signal.Ignore(syscall.SIGTERM)` was called.** Either explicitly
   in your code, or because you `Notify`-ed it on a channel and then
   stopped reading.
3. **You're PID 1.** PID 1 has no kernel-installed default handler;
   if you don't register one, SIGTERM does nothing.
4. **A cgo library installed its own handler.** Some C libraries
   (libGL, etc.) install handlers that don't chain to Go's.
5. **You're running inside a shell that doesn't forward signals.**
   Use `exec ./mybinary` or `ENTRYPOINT ["./mybinary"]`.

## Q10. What's the difference between `panic`, `os.Exit`, `log.Fatal`, and `runtime.Goexit`?

| Mechanism | Defers run? | Process exits? | Use when |
|-----------|-------------|----------------|----------|
| `panic` | yes (current goroutine) | yes (if uncaught) | unrecoverable bug; want stack dump |
| `os.Exit(n)` | no | yes (code `n`) | done; exit cleanly with chosen code |
| `log.Fatal(...)` | no (calls `os.Exit(1)`) | yes (code 1) | log a message and exit; no defers needed |
| `runtime.Goexit()` | yes (current goroutine only) | only if last live goroutine | end this goroutine's work; e.g. `t.Fatal` |

Pick `panic` when there's a bug. Pick `os.Exit` when you've finished
work and have nothing to clean up. Pick `log.Fatal` only if you've
audited that no deferred cleanup matters. Pick `Goexit` essentially
never outside the testing package.

## Q11. How do you set environment variables for a child without polluting the parent?

```go
cmd := exec.Command("printenv", "X")
cmd.Env = append(os.Environ(), "X=hello")
```

Setting `cmd.Env` overrides inheritance for that one child. Don't
call `os.Setenv` — it would change the parent's environment and any
*other* child started afterward.

`append(os.Environ(), ...)` keeps inheritance plus adds; `[]string{...}`
gives the child only what's in the slice.

## Q12. What's the difference between `os.Args[0]` and `os.Executable()`?

`os.Args[0]` is whatever the parent passed as `argv[0]` — usually the
name the user typed (`./myprog`, `myprog`, or sometimes the resolved
path). It's controlled by the parent and can be lied about.

`os.Executable()` asks the OS for the actual filesystem path of the
running binary. On Linux it reads `/proc/self/exe`; on macOS it uses
`_NSGetExecutablePath`; on Windows `GetModuleFileName`. It's
trustworthy but can fail on platforms that don't track the path.

## Q13. Explain the `Setpgid` / process-group pattern for child processes.

By default, a child process inherits the parent's process group ID.
Pressing Ctrl-C in a terminal sends SIGINT to *every process in the
foreground group* — so both parent and child see it.

To isolate the child:

```go
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
```

Now the child is in its own group. Two benefits:
1. Signals from the terminal don't reach the child unless you forward
   them yourself.
2. You can kill the child *and all its descendants* with one syscall:
   `syscall.Kill(-cmd.Process.Pid, sig)`. The negative PID means
   "this process group."

Critical for supervisors and for any code that runs subprocesses
that themselves fork.

## Q14. What is `Cmd.WaitDelay` and when do you set it?

`Cmd.WaitDelay` (Go 1.20+) is the maximum time the runtime waits
between calling `Cmd.Cancel` (triggered by context cancellation) and
giving up on the child. After it expires, the runtime closes the
child's pipes — which unblocks any I/O goroutines and lets `Wait`
return — even if the child is still alive.

Set it on every `exec.CommandContext` invocation. Without it, a child
that ignores SIGTERM can keep your goroutine waiting indefinitely.
Pair with a `Cancel` that escalates to SIGKILL after a grace period
if you really mean "die."

## Q15. Why is `os.Setenv` from multiple goroutines dangerous?

`os.Setenv` modifies a process-global table. The Go runtime uses an
internal lock so setenv and getenv don't race against each other,
but in older Go versions (<1.18) and in cgo programs that read the
environment via libc functions, there are race-condition reports.

Practically: snapshot env at startup into a typed config struct, and
don't call `Setenv` after that. If you must, wrap it in your own
mutex.

## Q16. How would you implement a process supervisor with restart-on-crash?

A loop with exponential backoff:

```go
func supervise(ctx context.Context, name string) error {
    backoff := time.Second
    for {
        cmd := exec.CommandContext(ctx, name)
        cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
        cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

        start := time.Now()
        err := cmd.Run()
        if ctx.Err() != nil { return ctx.Err() }
        if time.Since(start) > 30*time.Second {
            backoff = time.Second
        }
        log.Printf("child died (%v); restarting in %v", err, backoff)
        select {
        case <-time.After(backoff):
        case <-ctx.Done(): return ctx.Err()
        }
        if backoff < time.Minute { backoff *= 2 }
    }
}
```

Reset the backoff on long-lived runs; otherwise an occasional crash
degrades the service over time.

## Q17. What does `signal.NotifyContext` do that `signal.Notify` doesn't?

`Notify` gives you a channel; you have to integrate it into your own
control flow with `select`. `NotifyContext` returns a `context.Context`
that gets cancelled on the first matching signal — which means you
can pass it to anything that accepts a context, and it just works.

You also get a `stop` function that detaches the signal hook,
restoring default behavior. Calling `stop()` after handling the
first signal turns the second one into a hard kill — useful for
"Ctrl-C twice = I really mean it."

## Q18. How do you build a command timeout that kills the child cleanly?

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

cmd := exec.CommandContext(ctx, "long-thing")
cmd.Cancel = func() error {
    return cmd.Process.Signal(syscall.SIGTERM) // graceful first
}
cmd.WaitDelay = 5 * time.Second  // then runtime gives up
err := cmd.Run()
```

Three layers: context timeout fires `Cancel`, `Cancel` sends SIGTERM,
`WaitDelay` lets the runtime detach if the child still ignores us.
For a hard kill after the grace, escalate to SIGKILL inside `Cancel`.

## Q19. What are `ExtraFiles` and what would you use them for?

`Cmd.ExtraFiles` is a slice of `*os.File` values that become file
descriptors 3, 4, ... in the child. The child inherits them across
`exec`.

Use case: graceful binary swap. The parent listens on port 80, forks
the new binary with `ExtraFiles: []*os.File{listenerFD}`, the new
binary calls `net.FileListener` on FD 3 to take over the socket, and
the parent exits. Both processes share the listening socket; the
kernel load-balances `accept`.

Also used for passing stdin/stdout to subprocess pipelines, file-
backed mmaps to a worker, or systemd's socket activation pattern.

## Q20. What's the difference between `os.Process.Signal(sig)` and `syscall.Kill(pid, sig)`?

Functionally similar on Unix: both deliver `sig` to the named target.
Differences:
- `os.Process.Signal` is portable; `syscall.Kill` is Unix-only.
- `syscall.Kill` accepts negative PIDs to signal an entire process
  group: `syscall.Kill(-pid, sig)` sends to every process whose PGID
  equals `pid`. `os.Process.Signal` doesn't expose this.
- `os.Process.Signal` returns `os.ErrProcessDone` if the process has
  exited; `syscall.Kill` returns `ESRCH`.

For "kill the whole subtree," use `syscall.Kill(-pid, sig)` with
`Setpgid`-launched children.

## Q21. Why might `errors.Is(err, fs.ErrPermission)` be preferred over `os.IsPermission(err)`?

Both work today. `errors.Is` composes with error wrapping (`%w`), so
it sees through nested errors. `os.IsPermission` predates wrapping
and looks at the immediate error type. For new code, `errors.Is`
plus `fs.ErrPermission` is the modern idiom; the `os.IsXxx` family
is kept around for backward compatibility.

## Q22. How do you forward stdin/stdout/stderr to a child without buffering?

Assign `cmd.Stdin = os.Stdin`, etc. The Go runtime detects that the
target is an `*os.File` and passes the FD directly to the child
across `exec`. No goroutine, no copy — the kernel does the I/O.

When `cmd.Stdout` is any other `io.Writer`, the runtime spawns a
goroutine that pumps from a pipe into your writer. That works but is
slower and adds backpressure. For pass-through, use `*os.File`.

## Q23. What does `exec.LookPath` return for a binary in the current directory?

Since Go 1.19, `LookPath` returns `exec.ErrDot` if the resolved path
is in the current directory because of a relative `PATH` entry (`""`
or `"."`). The actual path is in `(*exec.Error).Name`. This is a
security mitigation against attackers planting binaries in CWD.

To opt in, prepend `./` to the name explicitly: `exec.Command("./mybin")`.
Then `LookPath` is bypassed and the path is used directly.

## Q24. What's the issue with logging `os.Environ()` in production?

Environment variables commonly hold secrets: `DATABASE_URL` (with
password), `AWS_SECRET_ACCESS_KEY`, OAuth client secrets. Logging
the whole environment leaks them all. Even "debug" code path runs in
prod sometimes.

Mitigations:
- Never log `os.Environ()`.
- Wrap secret values in a type whose `String()` method returns
  `"<redacted>"`.
- Use a vault and pass only a vault address via env.

## Q25. Why might your container exit immediately on `docker stop`?

`docker stop` sends SIGTERM to PID 1, then SIGKILL after a timeout
(default 10s). If your shell wrapper is PID 1 and doesn't forward
signals, the SIGTERM is lost — `docker stop` then SIGKILLs your
shell, taking your binary down with it without a graceful path.

Fix: use `exec ./mybinary` in the shell wrapper, or
`ENTRYPOINT ["./mybinary"]` in the Dockerfile (exec form, not shell
form).

## Q26. What does the Go runtime do for SIGPIPE?

The runtime ignores SIGPIPE for writes to file descriptors 0, 1, 2
(after the first one). For other FDs, it doesn't intercept — a
broken-pipe write returns `EPIPE` from the syscall, which becomes a
normal `error` from `Write`.

Why: most CLI tools want SIGPIPE to terminate them (so `mytool |
head` exits cleanly). But for stdout/stderr writes, where the program
is presumably trying to log diagnostics, the runtime preserves the
process and lets you handle the error.

## Q27. How does Go's signal handling interact with cgo?

Cgo introduces three complications:

1. C libraries can install their own signal handlers, possibly
   overwriting Go's. Go tries to chain to a previous handler but
   it's library-dependent.
2. Signals delivered while a thread is in C code are handled by that
   thread's installed handler, which might be the C library's.
3. Go can't preempt a thread that's blocked in C. A signal expected
   to interrupt a syscall may queue.

Practical guidance: avoid cgo unless necessary; if you must, set
`signal.Ignore` on signals you don't care about *before* loading
the C library; don't intercept SIGSEGV / SIGBUS / SIGFPE (the
runtime needs them).

## Q28. Walk me through implementing a PID-1-safe init in Go.

```go
func main() {
    if os.Getpid() != 1 {
        log.Fatal("this should only run as PID 1")
    }

    // 1. Reap orphans on SIGCHLD.
    go reapZombies()

    // 2. Forward signals to the actual app.
    cmd := exec.Command("/app/server")
    cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
    cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
    if err := cmd.Start(); err != nil { log.Fatal(err) }

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
    go func() {
        for s := range sigs {
            cmd.Process.Signal(s)
        }
    }()

    // 3. Wait for the app and propagate its exit code.
    err := cmd.Wait()
    if ee, ok := err.(*exec.ExitError); ok {
        os.Exit(ee.ExitCode())
    }
}
```

The three responsibilities of PID 1: reap orphans, forward signals,
propagate the wrapped app's exit code. `tini` and `dumb-init` are
tiny C programs that do exactly this; you'd write the Go version
only if you have an unusual reason.

## See also

- [tasks.md](tasks.md) — exercises that turn these answers into code.
- [find-bug.md](find-bug.md) — for "spot the bug" interview rounds.
- [senior.md](senior.md) — the longer-form versions of Q4, Q10, Q13,
  Q27.
