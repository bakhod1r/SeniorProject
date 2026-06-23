# 8.5 `os` — Middle

> **Audience.** You're past `Output()` and bare `signal.Notify`. You
> write services that need to shut down cleanly, run subprocesses that
> stream gigabytes of output, and consume environment variables that
> have to follow a precedence rule. This file is the toolkit for that
> tier: `signal.NotifyContext`, full pipe wiring, context-aware
> cancellation, env composition, and the cross-platform quirks of
> `FindProcess`.

## 1. Graceful shutdown with `signal.NotifyContext`

The channel-and-`done` pattern in [junior.md](junior.md#15-two-phase-shutdown-signal-then-drain)
works, but it spreads shutdown logic across three places. Go 1.16
shipped `signal.NotifyContext`, which folds signal listening into the
`context.Context` your code is already passing around.

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{Addr: ":8080"}
    go func() {
        if err := srv.ListenAndServe(); err != nil &&
            err != http.ErrServerClosed {
            fmt.Println("server:", err)
        }
    }()

    <-ctx.Done() // wait for SIGINT/SIGTERM
    fmt.Println("shutdown signal received")

    shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutCtx); err != nil {
        fmt.Println("forced shutdown:", err)
    }
}
```

What's happening:

1. `signal.NotifyContext` returns a context that gets cancelled the
   first time one of the listed signals arrives.
2. `defer stop()` releases the signal hook (so the next signal goes
   back to the default handler — useful when the user mashes Ctrl-C).
3. We wait on `ctx.Done()` instead of an `os.Signal` channel.
4. After cancellation, we use a *separate* context with a timeout for
   the actual drain. If shutdown takes longer than the grace period,
   we force-close.

The two-context pattern (`ctx` for "we got the signal", `shutCtx` for
"how long we're willing to wait to drain") is the production shape.
Putting the timeout on the same context that cancels child operations
would require a different decomposition.

## 2. The second-signal escape hatch

If the user presses Ctrl-C twice, they probably mean it. `stop()`
restores the default signal handler, so a second SIGINT terminates the
process immediately. That's free with `signal.NotifyContext` — no extra
code needed.

If you've rolled your own with `signal.Notify`, you get the same
behavior by calling `signal.Stop(ch)` when you're ready to let the
default handler take over.

## 3. Wiring `Cmd` pipes by hand

`cmd.Output()` is a convenience for "small command, small output." For
streaming or for separating stdout from stderr, wire the pipes yourself.

```go
cmd := exec.Command("rsync", "-av", "src/", "dst/")

stdout, err := cmd.StdoutPipe()
if err != nil { return err }
stderr, err := cmd.StderrPipe()
if err != nil { return err }

if err := cmd.Start(); err != nil {
    return err
}

// IMPORTANT: read both pipes concurrently.
var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    sc := bufio.NewScanner(stdout)
    for sc.Scan() {
        log.Println("stdout:", sc.Text())
    }
}()
go func() {
    defer wg.Done()
    sc := bufio.NewScanner(stderr)
    for sc.Scan() {
        log.Println("stderr:", sc.Text())
    }
}()

wg.Wait()                        // drain pipes first
if err := cmd.Wait(); err != nil {
    return fmt.Errorf("rsync: %w", err)
}
```

Two rules that catch everyone:

1. **`StdoutPipe` / `StderrPipe` must be drained before `Wait`.** If
   the child writes more than the pipe buffer (~64 KiB on Linux) and
   nobody is reading, the child blocks in `write(2)` and never exits;
   `Wait` then blocks forever. The deadlock pattern is so common it
   has its own name; senior.md dissects it.
2. **Drain *both* pipes concurrently.** If you read all of stdout
   then all of stderr, and stderr fills its buffer before stdout is
   done, you deadlock again.

If you don't actually need the streams separated, `cmd.Stderr =
cmd.Stdout` plus a single `StdoutPipe` is simpler.

## 4. Letting the runtime do the wiring (`Cmd.Stdout = w`)

When you have an `io.Writer` you want the child's output sent to,
assign it directly:

```go
var buf bytes.Buffer
cmd := exec.Command("date")
cmd.Stdout = &buf
cmd.Stderr = os.Stderr // child's stderr goes to our stderr
if err := cmd.Run(); err != nil {
    return err
}
fmt.Println("date said:", buf.String())
```

When `Stdout` / `Stderr` is a `*os.File`, the runtime hands the file
descriptor straight to the child — no goroutine, no copy. When it's
any other `io.Writer`, the runtime spawns a goroutine that copies from
a pipe into your writer, and `Wait` blocks until that copy finishes.

This is why setting `cmd.Stdout = os.Stdout` is much faster than
setting it to a wrapped writer: the kernel does the work.

## 5. Context-aware `exec.CommandContext`

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

cmd := exec.CommandContext(ctx, "sleep", "30")
err := cmd.Run()
fmt.Println(err) // signal: killed
```

When the context is cancelled, the runtime sends `SIGKILL` to the
child by default. That's brutal. Go 1.20 added two fields that let
you customize:

```go
cmd := exec.CommandContext(ctx, "sleep", "30")
cmd.Cancel = func() error {
    return cmd.Process.Signal(syscall.SIGTERM) // try graceful first
}
cmd.WaitDelay = 5 * time.Second // then SIGKILL after 5s
```

`Cancel` is what gets called when `ctx` is done. Return `os.ErrProcessDone`
if the process is already gone; any other error becomes the cause of
the eventual `Wait` error.

`WaitDelay` is the grace period between `Cancel` and the runtime
giving up on the child. After it, the runtime closes the pipes and
forces `Wait` to return — even if the process is still alive
somewhere. You almost always want `WaitDelay` set; without it, a
hung child can keep your goroutine waiting forever.

## 6. Multi-step subprocess: stdin from one source, stdout to another

Streaming `tar c | gzip` style:

```go
tar := exec.Command("tar", "cf", "-", "src/")
gzip := exec.Command("gzip", "-c")

tarOut, _ := tar.StdoutPipe()
gzip.Stdin = tarOut
gzip.Stdout = output // some io.Writer

if err := gzip.Start(); err != nil { return err }
if err := tar.Run(); err != nil { return err }
if err := gzip.Wait(); err != nil { return err }
```

`gzip.Start` first (it'll block on its stdin until tar writes), then
`tar.Run` (which finishes when tar exits and closes its stdout), then
`gzip.Wait` (which finishes when gzip processes the EOF and exits).
Order matters; reverse it and you may deadlock.

## 7. Environment composition: precedence patterns

Real services have a config precedence: explicit flag > env var >
config file > default. The `os` package does the env-var part; you do
the rest.

```go
type Config struct {
    Addr     string
    LogLevel string
}

func Load() Config {
    cfg := Config{
        Addr:     ":8080",  // default
        LogLevel: "info",
    }
    // Override from env.
    if v, ok := os.LookupEnv("LISTEN_ADDR"); ok {
        cfg.Addr = v
    }
    if v, ok := os.LookupEnv("LOG_LEVEL"); ok {
        cfg.LogLevel = v
    }
    return cfg
}
```

For the parent-of-all loaders, ship a tiny helper:

```go
func envStr(key, def string) string {
    if v, ok := os.LookupEnv(key); ok && v != "" {
        return v
    }
    return def
}
func envInt(key string, def int) int {
    if v, ok := os.LookupEnv(key); ok {
        if n, err := strconv.Atoi(v); err == nil {
            return n
        }
    }
    return def
}
func envDur(key string, def time.Duration) time.Duration {
    if v, ok := os.LookupEnv(key); ok {
        if d, err := time.ParseDuration(v); err == nil {
            return d
        }
    }
    return def
}
```

Three rules:

1. **Treat empty string as unset.** `LISTEN_ADDR=` should not collapse
   your config; the user probably meant "default."
2. **Validate at load.** Crash early if `MAX_CONNS=banana`. A typo at
   startup is far better than a surprise at request time.
3. **Snapshot at startup.** Don't `os.Getenv` on the hot path; copy
   into a struct once. (See [optimize.md](optimize.md#1-the-cost-of-osgetenv).)

## 8. `ExpandEnv` quirks

```go
os.Setenv("USER", "alice")

s1 := os.ExpandEnv("$USER@host")        // "alice@host"
s2 := os.ExpandEnv("${USER}name")       // "alicename"
s3 := os.ExpandEnv("${UNSET}fallback")  // "fallback"  (unset → "")
s4 := os.ExpandEnv("$$USER")            // "$USER"     (literal $)
```

Things that bite people:

- **No default-value syntax.** Shells let you write `${X:-default}`;
  Go's `ExpandEnv` doesn't. Do it in code.
- **No quoting.** If a value contains `$VAR`, `ExpandEnv` will expand
  it again? No — `ExpandEnv` is single-pass, so `$$` is the only
  escape and the resulting string is final.
- **Garbage in, garbage out.** `${]bad}` is treated as a literal —
  unparseable forms are not errors.

For full control, use `os.Expand` with your own resolver.

## 9. Working directory for a child

```go
cmd := exec.Command("git", "rev-parse", "HEAD")
cmd.Dir = "/path/to/repo"
out, err := cmd.Output()
```

`cmd.Dir` is the child's initial working directory. If empty, the
child inherits the parent's. **Use `cmd.Dir` instead of `os.Chdir`
before launching** — `os.Chdir` is process-global and racy if you have
multiple goroutines launching commands.

## 10. `exec.LookPath` vs `exec.Command` resolution

`exec.Command("git", ...)` calls `LookPath` lazily during `Start`. If
`git` isn't on `PATH`, you get the error from `Start` (or `Run`/
`Output`), not from `Command`. To validate up front:

```go
if _, err := exec.LookPath("git"); err != nil {
    return fmt.Errorf("install git: %w", err)
}
```

There's a Go-specific quirk: as of Go 1.19, `LookPath` returns
`exec.ErrDot` when the resolved name is in the current directory but
the lookup path was relative — this is a security mitigation against
attackers planting binaries in CWD. To explicitly opt in to the old
behavior, prepend `./` to the name yourself.

## 11. Inspecting `*exec.Cmd` after the fact

After `Wait` returns, `cmd.ProcessState` is populated:

```go
cmd := exec.Command("sh", "-c", "exit 7")
err := cmd.Run()
fmt.Println(cmd.ProcessState.ExitCode())   // 7
fmt.Println(cmd.ProcessState.Success())    // false
fmt.Println(cmd.ProcessState.UserTime())   // CPU time
fmt.Println(cmd.ProcessState.SystemTime())
```

`ProcessState` survives the process. It's where you read CPU usage,
exit status, and (on Unix) the signal that killed the child.

## 12. `os.FindProcess` and per-OS behavior

```go
p, err := os.FindProcess(pid)
if err != nil { return err }
err = p.Signal(syscall.SIGTERM)
```

This is where Unix and Windows diverge:

- **On Unix**, `FindProcess` always succeeds — it just constructs a
  `*os.Process` value with the PID. `Signal` is the call that fails
  if the PID doesn't exist (`os.ErrProcessDone` / `errors.Is(err,
  syscall.ESRCH)`). This is because Unix has no atomic "look up
  process" operation.
- **On Windows**, `FindProcess` actually opens a handle to the
  process and fails immediately with `ERROR_INVALID_PARAMETER` if
  the PID is dead.

Portable pattern: don't rely on `FindProcess` to validate, do the
real operation and check that error:

```go
p, _ := os.FindProcess(pid)
if err := p.Signal(syscall.Signal(0)); err != nil {
    // process doesn't exist or we don't have permission
}
```

Sending signal 0 is the standard "is this process alive?" check on
Unix. On Windows, signal 0 is special-cased by the runtime to do the
right thing.

## 13. Restoring default signal behavior with `signal.Stop` and `signal.Reset`

After you've called `signal.Notify(ch, sig...)`, the runtime keeps
forwarding those signals to your channel forever. Two ways to undo:

```go
signal.Stop(ch)        // stop forwarding any signals to ch (channel-specific)
signal.Reset(syscall.SIGUSR1) // reset SIGUSR1 to default for the whole process
```

`Stop` is what you want when a goroutine is done watching:

```go
ch := make(chan os.Signal, 1)
signal.Notify(ch, syscall.SIGUSR1)
defer signal.Stop(ch)

select {
case <-ch:
    // handle
case <-ctx.Done():
    return
}
```

`Reset` is rare: it disables Go's handler for that signal entirely,
so the OS default (often "terminate") takes over.

## 14. Forwarding signals to children

If you're a wrapper or a supervisor, you usually want to forward
`SIGINT` / `SIGTERM` to the child rather than absorbing them.

```go
cmd := exec.Command("long-running-thing")
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
if err := cmd.Start(); err != nil { return err }

sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
go func() {
    for s := range sigs {
        _ = cmd.Process.Signal(s)
    }
}()

err := cmd.Wait()
signal.Stop(sigs)
close(sigs)
return err
```

If the child is in its own process group (default on Unix is "same
group as parent"), the terminal will already deliver SIGINT to it
when you press Ctrl-C, and you might be double-signalling. To take
full control, put the child in its own group with `SysProcAttr` —
covered in [senior.md](senior.md).

## 15. Captured-output size limits

`Output()` and `CombinedOutput()` capture to an `in-memory bytes.Buffer`
with no cap. If the child prints a gigabyte, you allocate a gigabyte.
For commands whose output you don't fully control:

```go
cmd := exec.Command("untrusted-tool")
var buf bytes.Buffer
cmd.Stdout = &limitedWriter{w: &buf, cap: 1 << 20}
cmd.Stderr = cmd.Stdout
err := cmd.Run()
```

`limitedWriter` is a 10-line wrapper that returns `io.ErrShortBuffer`
once the cap is reached. That tears down the pipe and aborts the
copy. You'll do this once and reuse it.

## 16. Concurrent subprocess launches

`exec.Command` is cheap; `Start` is a fork+exec syscall pair, which is
not. For batches:

```go
sem := make(chan struct{}, runtime.NumCPU())
var wg sync.WaitGroup
for _, host := range hosts {
    host := host
    wg.Add(1)
    sem <- struct{}{}
    go func() {
        defer wg.Done()
        defer func() { <-sem }()

        cmd := exec.Command("ssh", host, "uptime")
        out, err := cmd.Output()
        results <- result{host, out, err}
    }()
}
wg.Wait()
```

The semaphore caps concurrent forks. On Linux, `fork` of a large
process can be expensive (it copies the page table); see
[optimize.md](optimize.md#7-fork-cost-on-large-processes).

## 17. Running with stdin already drained (no terminal)

Some tools probe `os.Stdin` to see if it's a terminal and behave
differently. To force "no terminal" behavior, give the child an
explicit empty stdin:

```go
cmd.Stdin = strings.NewReader("")
```

or close stdin entirely:

```go
cmd.Stdin = nil // child inherits /dev/null on Unix
```

The default (`Stdin == nil`) gives the child `/dev/null` on Unix —
which is what you want unless you're piping data in.

## 18. `os.StartProcess` — the low-level escape hatch

`exec.Cmd` is built on `os.StartProcess`. You almost never use it
directly, but knowing it exists helps when you need to control
something `exec.Cmd` doesn't expose:

```go
attr := &os.ProcAttr{
    Dir: "/tmp",
    Env: []string{"PATH=/usr/bin"},
    Files: []*os.File{nil, os.Stdout, os.Stderr}, // stdin=null, stdout, stderr
    Sys:   &syscall.SysProcAttr{Setpgid: true},
}
proc, err := os.StartProcess("/bin/echo", []string{"echo", "hi"}, attr)
if err != nil { return err }
state, err := proc.Wait()
```

`Files` is the file-descriptor table of the child: index 0 is stdin,
1 is stdout, 2 is stderr, 3+ are extra inherited file descriptors. To
pass an open socket to a child, slot it in at index 3 and have the
child read FD 3. Senior services that do graceful binary swaps (e.g.
`grace`, `tableflip`) build on exactly this.

## 19. Common middle-tier mistakes

| Symptom | Cause |
|---------|-------|
| Subprocess hangs at gigabytes of output | `StdoutPipe` not drained; or both pipes drained sequentially instead of concurrently |
| `cmd.Wait` returns immediately with no error but child still alive | Forgot to drain `StdoutPipe` before `Wait` — pipe-close raced |
| Context cancellation doesn't kill child | Used `exec.Command` instead of `exec.CommandContext` |
| Child SIGKILL'd when you wanted graceful | `Cmd.Cancel` not set; default is `SIGKILL` |
| Child sees stale env vars | Mutated `os.Environ()` slice in place; use `append(os.Environ(), ...)` |
| Wrapper double-handles Ctrl-C | Both your handler and the kernel forwarded to the child via process group |

## 20. What to read next

- [senior.md](senior.md) — process groups, `SysProcAttr`, the
  deadlock pattern in detail, signal masking with cgo, the precise
  difference between `os.Exit`, `panic`, `log.Fatal`, `runtime.Goexit`.
- [professional.md](professional.md) — production graceful shutdown,
  HUP-reload, PID 1 quirks, supervision.
- [find-bug.md](find-bug.md) — twelve buggy snippets to sharpen your
  eye.
