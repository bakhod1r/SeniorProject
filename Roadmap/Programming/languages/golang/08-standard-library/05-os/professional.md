# 8.5 `os` — Professional

> **Audience.** You're shipping production services. You know the
> mechanics from earlier files; this one is the operational layer:
> the patterns that distinguish a service that survives a deploy from
> one that drops requests, leaks zombies, or refuses to die.

## 1. The shape of a graceful shutdown

A correct shutdown does four things in order:

1. **Stop accepting new work.** Close the listener; new clients get a
   connection refused.
2. **Let in-flight work finish.** Existing requests get a bounded
   amount of time.
3. **Force-kill what's still running** if the bound is exceeded.
4. **Exit with a sensible code.**

Here's the shape, end to end:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{
        Addr:    ":8080",
        Handler: buildHandler(),
    }

    go func() {
        if err := srv.ListenAndServe(); err != nil &&
            err != http.ErrServerClosed {
            log.Printf("listen: %v", err)
            stop() // trigger shutdown on listen failure too
        }
    }()
    log.Println("listening on", srv.Addr)

    <-ctx.Done()
    log.Println("shutdown initiated")

    // Phase 2: drain. Bounded.
    drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(drainCtx); err != nil {
        log.Printf("forced shutdown: %v", err)
        // Phase 3: kill what's left.
        if err := srv.Close(); err != nil {
            log.Printf("close: %v", err)
        }
        os.Exit(1)
    }
    log.Println("shutdown complete")
}
```

Pieces to notice:

- One context for "we got the signal", a separate one for the drain
  deadline. Conflating them limits your options.
- `srv.Shutdown(drainCtx)` is non-blocking until either all requests
  finish or `drainCtx` is cancelled.
- `srv.Close()` is the hard kill — it closes listeners and active
  connections immediately.
- `os.Exit(1)` is appropriate at the end of a forced shutdown to
  signal "we did not exit cleanly" to the supervisor.

## 2. Adding the grace period for backgrounded work

`http.Server.Shutdown` only knows about HTTP requests. Your handlers
might have spawned goroutines (a write to a queue, a webhook
delivery). Those need their own grace.

```go
var bg sync.WaitGroup

func handler(w http.ResponseWriter, r *http.Request) {
    bg.Add(1)
    go func() {
        defer bg.Done()
        sendWebhook(r.Context(), payload)
    }()
    w.WriteHeader(http.StatusAccepted)
}

// in main, after srv.Shutdown:
done := make(chan struct{})
go func() { bg.Wait(); close(done) }()
select {
case <-done:
case <-time.After(30 * time.Second):
    log.Println("background work didn't finish; abandoning")
}
```

A single `sync.WaitGroup` for "everything spawned by a handler" is
the simplest pattern. For multiple categories (webhooks, audit logs,
metric flushes), use one group per category and wait on them in
parallel with separate timeouts.

## 3. SIGHUP: reload-without-restart

Long convention on Unix: `SIGHUP` means "reread your config." For a
server that wants zero-downtime config changes:

```go
func main() {
    cfg := atomic.Pointer[Config]{}
    cfg.Store(loadConfig())

    sighup := make(chan os.Signal, 1)
    signal.Notify(sighup, syscall.SIGHUP)
    go func() {
        for range sighup {
            newCfg, err := loadConfig()
            if err != nil {
                log.Printf("reload failed, keeping old config: %v", err)
                continue
            }
            cfg.Store(newCfg)
            log.Println("config reloaded")
        }
    }()

    // ... handlers read cfg.Load() ...
}
```

Three production rules:

1. **Validate before swapping.** If the new config is broken, log and
   keep the old one. A bad reload should never crash a healthy
   service.
2. **Use `atomic.Pointer[T]`.** Concurrent handlers will be reading
   while the reload writes. A plain pointer assignment is not safe.
3. **Don't reload everything.** Listening sockets, DB pools, secrets:
   only reload what's safe. Some changes (port number, TLS cert)
   require a real restart or a graceful binary swap.

For TLS cert reload specifically, `tls.Config.GetCertificate` is the
right hook — you read the cert from a file inside the callback, and
the runtime calls back on each handshake.

## 4. Subprocess supervision: restart-on-crash

A loop that keeps a child alive, with backoff:

```go
func supervise(ctx context.Context, name string, args ...string) error {
    backoff := time.Second
    for {
        cmd := exec.CommandContext(ctx, name, args...)
        cmd.Stdout = os.Stdout
        cmd.Stderr = os.Stderr
        cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

        start := time.Now()
        err := cmd.Run()
        if ctx.Err() != nil {
            return ctx.Err()
        }
        if time.Since(start) > 30*time.Second {
            backoff = time.Second // ran long enough; reset backoff
        }

        log.Printf("child exited (%v); restarting in %v", err, backoff)
        select {
        case <-time.After(backoff):
        case <-ctx.Done():
            return ctx.Err()
        }
        if backoff < time.Minute {
            backoff *= 2
        }
    }
}
```

Patterns:

- **Exponential backoff with a cap.** A child that crashes
  immediately would otherwise burn CPU.
- **Reset the backoff after a successful run.** Otherwise the
  service degrades over time.
- **`Setpgid` + cancel via `CommandContext`.** When `ctx` cancels,
  the runtime delivers SIGKILL to the child by default — and
  because of the process group, anything *it* forked too.
- **Forward stdout/stderr.** Don't capture; let your supervisor
  (systemd, k8s) collect logs.

## 5. Env-driven config with secret hygiene

Twelve-factor says: config in env. That works until somebody logs
`os.Environ()` and prints `DATABASE_URL` with the password.

```go
type Secret string

func (Secret) String() string { return "<redacted>" } // for fmt
func (s Secret) Reveal() string { return string(s) }

type Config struct {
    Addr        string
    DBURL       Secret
    AuthToken   Secret
}

func Load() (*Config, error) {
    return &Config{
        Addr:      env("LISTEN_ADDR", ":8080"),
        DBURL:     Secret(mustEnv("DATABASE_URL")),
        AuthToken: Secret(mustEnv("AUTH_TOKEN")),
    }, nil
}
```

Three habits:

1. **Don't log `os.Environ()`.** Loop and skip known-secret keys, or
   never dump env at all.
2. **Wrap secret values in a type whose `String` method redacts.**
   Then `fmt.Printf("%v", cfg)` is safe.
3. **Read once at startup, not per request.** `os.Getenv` is cheap
   but not free, and a env-var change after startup is a misleading
   signal that you're "reconfigured" when you might not be.

For services that load secrets from a vault, use the env var only for
the path/credential of the vault; keep actual secrets out of
`os.Environ()` entirely.

## 6. Container-friendly: signal handling at PID 1

Containers commonly run your binary as PID 1. PID 1 is special:

- The kernel does **not** install default signal handlers for it. If
  you don't `signal.Notify(SIGTERM)`, your process won't even
  respond to `docker stop`.
- PID 1 inherits orphans. If you fork anything that itself forks,
  the grandchild becomes your child when the middle parent dies. If
  you don't reap, you leak zombies.
- Killing PID 1 kills the container. So a normal exit path matters
  more — there's no init to restart you.

The minimum your `main` needs at PID 1:

```go
func main() {
    if os.Getpid() == 1 {
        // We're PID 1. Reap orphans.
        go reapZombies(context.Background())
    }

    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    runApp(ctx)
}
```

`reapZombies` is the loop from
[senior.md §10](senior.md#10-reaping-zombies-as-pid-1). For most
services, ship `tini` or `dumb-init` instead; they're 50 KB and
handle this for you.

## 7. Signal forwarding in the entrypoint

When you wrap your binary in a shell entrypoint, the shell becomes
PID 1 and the kernel sends SIGTERM to it on `docker stop`. Most
shells don't forward signals to children. Result: your Go binary
never gets the signal.

Three fixes, in increasing order of correctness:

```bash
# Bad: shell stays around as PID 1
#!/bin/sh
./mybinary

# Better: exec replaces the shell
#!/bin/sh
exec ./mybinary

# Best: no shell; binary is the entrypoint
ENTRYPOINT ["./mybinary"]
```

In a Dockerfile, `ENTRYPOINT ["./mybinary"]` (exec form, not shell
form) is what you want. The shell-form `ENTRYPOINT ./mybinary`
silently wraps in `/bin/sh -c`, reintroducing the problem.

## 8. The 30-second timeout is not arbitrary

Kubernetes' default `terminationGracePeriodSeconds` is **30**. If
your shutdown takes longer than 30 seconds, the kubelet sends
SIGKILL. Match your in-app timeout to the orchestrator's:

```go
const gracePeriod = 25 * time.Second // < 30 to leave headroom
```

Five seconds of headroom lets your container actually exit cleanly
before the orchestrator escalates. If your service genuinely needs
more, configure both sides — but communicate the change in a
runbook, because it lengthens deploys.

## 9. Health checks during shutdown

A common bug: shutdown begins, the load balancer is still routing to
you, you serve a request, then close the connection mid-response.

The fix is a *readiness* signal that flips to "not ready" the
instant shutdown begins:

```go
var shuttingDown atomic.Bool

http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
    if shuttingDown.Load() {
        w.WriteHeader(http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})

// In shutdown:
<-ctx.Done()
shuttingDown.Store(true)
time.Sleep(5 * time.Second) // let LB notice
srv.Shutdown(drainCtx)
```

The `time.Sleep` is "let the load balancer notice we're unhealthy
before we stop accepting requests." Five seconds covers most LB
poll intervals. Without it, the LB will route a request to you in
the gap between "shutting down" and "listener closed."

## 10. Structured logging through shutdown

`log.Print` writes to stderr synchronously, which is fine. Logging
*libraries* with async batching are not. If you use `zap` or `zerolog`
in async mode, you must `Sync()` before exit:

```go
defer logger.Sync() // in main
```

Defers don't run on `os.Exit`. If your shutdown ends with `os.Exit`,
the buffered last lines never reach disk. Either return cleanly from
`main` or call `Sync()` explicitly before `os.Exit`.

## 11. Detecting build-time vs runtime platform

There are two questions that look similar but aren't:

- "What platform am I running on right now?" → `runtime.GOOS`,
  `runtime.GOARCH`. Useful for runtime branching.
- "What platform should this code compile for?" → build tags
  (`//go:build linux`). Useful when the code itself isn't portable.

```go
// runtime check (single binary works everywhere):
if runtime.GOOS == "windows" {
    return openWindowsRegistry()
}

// build tag (different files per platform):
//go:build linux
// +build linux
package myproc

func sysProcAttr() *syscall.SysProcAttr { /* Linux only */ }
```

Rule of thumb: if the code that branches doesn't compile on every
platform, build tags are mandatory. If it compiles everywhere but
behaves differently, runtime detection is fine.

## 12. The "exit code matters" cases

For most services exit code is "0 = clean, anything else = bad." But
in some contexts the value matters:

- **Test runners** parse exit codes to decide pass/fail.
- **Shell pipelines** use exit codes for `&&`, `||`.
- **Supervisors** distinguish "user asked for shutdown" (often 0)
  from "process crashed" (non-zero), and may use the value to decide
  whether to restart.
- **Container runtimes** report the exit code in `kubectl describe`.

A common convention:

| Exit code | Meaning |
|-----------|---------|
| 0 | success, clean shutdown |
| 1 | generic error |
| 2 | usage error (bad flags) |
| 64–78 | `sysexits.h` codes (rarely used in Go but well-defined) |
| 130 | killed by SIGINT (`128 + 2`) — shell convention |
| 143 | killed by SIGTERM (`128 + 15`) |

Pick one convention, document it, stick to it.

## 13. PID files (and why you usually don't need one)

Old daemons wrote `/var/run/myapp.pid` so other tools could send
signals. Modern systems track processes through cgroups and don't
need pidfiles. But if you need one for legacy compatibility:

```go
func writePidFile(path string) error {
    return os.WriteFile(path, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o644)
}
func cleanupPidFile(path string) {
    _ = os.Remove(path)
}
```

The bug everyone hits: pidfile cleanup must happen *before* `os.Exit`,
which means inside the `defer` chain that runs only when `main`
returns. Don't `os.Exit(1)` from `main` if you want the pidfile
gone.

## 14. The "what to forward" decision matrix

When supervising a child, decide which signals you forward and which
you handle yourself:

| Signal | Typical handling |
|--------|------------------|
| SIGINT | Forward to child *and* start your own shutdown |
| SIGTERM | Forward to child *and* start your own shutdown |
| SIGHUP | Forward to child (it might want to reload) |
| SIGUSR1, SIGUSR2 | Forward to child (application-defined) |
| SIGCHLD | **Don't forward.** Used for child reaping. |
| SIGPIPE | **Don't forward.** Go's runtime handles it. |
| SIGSEGV, SIGBUS, SIGFPE, SIGILL | **Don't intercept.** Runtime uses these. |
| SIGKILL, SIGSTOP | Cannot be intercepted at all. |

The 4-line forwarder loop:

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP,
    syscall.SIGUSR1, syscall.SIGUSR2)
go func() {
    for s := range sigs {
        cmd.Process.Signal(s)
    }
}()
```

## 15. Drain order matters

For a service with multiple background subsystems, drain them in
dependency order:

1. Stop accepting new HTTP requests.
2. Wait for in-flight requests to complete.
3. Close DB pool. (After requests, so requests can finish their
   queries.)
4. Close metrics flusher. (Last, so it can record final metrics.)

```go
<-ctx.Done()
shuttingDown.Store(true)
time.Sleep(5 * time.Second)        // let LB notice
srv.Shutdown(drainCtx)             // drain HTTP
bg.Wait()                          // drain backgrounded handlers
db.Close()                         // drain DB
metrics.Flush(context.Background())// last call to metrics
```

Reverse order means a request can fail because the DB is gone, or
metrics for that failure go nowhere.

## 16. Operational checklist

Before shipping a service, verify:

- [ ] `signal.NotifyContext` is wired to SIGINT and SIGTERM.
- [ ] Shutdown has a bounded grace period less than your orchestrator's.
- [ ] Readiness flips to "not ready" before drain begins.
- [ ] No `os.Exit` calls in code paths that have important defers.
- [ ] PID 1 has a reaper, or you ship `tini` / `dumb-init`.
- [ ] Dockerfile uses `ENTRYPOINT` exec form (`["./bin"]`), not shell.
- [ ] Logs are flushed before exit (`logger.Sync()`).
- [ ] Subprocess children are in their own process group.
- [ ] Subprocess context cancellation has a `WaitDelay` and a real
  kill in `Cancel`.
- [ ] Secret-bearing env vars are not logged via `os.Environ()`.
- [ ] HUP-reload (if used) validates new config before swapping.

## 17. What to read next

- [find-bug.md](find-bug.md) — bugs born from violating any of the
  above.
- [optimize.md](optimize.md) — measuring fork/exec cost; env-access
  patterns; the cost of CombinedOutput buffering.
- [tasks.md](tasks.md) — implement a supervisor, write a graceful
  HTTP server, build a PID-1-safe init.
