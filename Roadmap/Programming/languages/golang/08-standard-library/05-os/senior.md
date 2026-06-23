# 8.5 `os` — Senior

> **Audience.** You've shipped Go services that fork subprocesses, you
> understand the basic Unix process model, and you've been bitten at
> least once by a deadlocked `Wait` or a defer that didn't run. This
> file is the precise mechanics: process groups, `SysProcAttr`, signal
> handling under cgo, the deadlock pattern in detail, and the exact
> semantics of every "this process is over now" mechanism Go offers.

## 1. The four termination paths in Go (precise version)

| Mechanism | Defers (current goroutine) | Defers (other goroutines) | `runtime.Goexit` finalizers | Exit code | Notes |
|-----------|----------------------------|---------------------------|-----------------------------|-----------|-------|
| `return` from `main` | run | not run; goroutines killed | not run | 0 | Other goroutines continue if `main` doesn't return; once it does, they're killed mid-execution |
| `os.Exit(n)` | **not run** | not run | not run | `n` | Buffered output not flushed |
| `log.Fatal(...)` | **not run** | not run | not run | 1 | Equivalent to `log.Print(...); os.Exit(1)` |
| `log.Panic(...)` | run (in panic) | not run | not run | 2 | `log.Print(...); panic(...)` |
| `panic` (uncaught) | **run** | not run | not run | 2 | Stack dumped to stderr; defers in current goroutine fire then `runtime` exits |
| `panic` (recovered) | run normally | n/a | n/a | n/a | Process continues |
| `runtime.Goexit()` | run in current goroutine | n/a | n/a | n/a | Kills only this goroutine; if last live goroutine, runtime exits with stack dump and code 2 |
| Killed by signal | not run | not run | not run | 128+sig (shell convention) | Kernel terminates immediately |

The single mistake to internalize: `os.Exit` does not run deferred
functions. Not in the calling goroutine, not anywhere. If you have
buffered writers, temp files to clean up, or sockets to drain,
`os.Exit` skips all of it.

```go
func main() {
    f, err := os.Create("out.txt")
    if err != nil { return }
    defer f.Close()             // never runs
    bw := bufio.NewWriter(f)
    defer bw.Flush()            // never runs
    bw.WriteString("hello\n")
    os.Exit(0)                  // truncates the program; nothing flushes
}
```

The fix is the `run() error` pattern from
[junior.md](junior.md#8-exit-codes-return-osexit-logfatal-panic): `main`
calls `run`, `run` does the work and returns, `main` translates the
return value to an exit code. All defers in `run` fire before `main`
sees the value.

## 2. The deadlock between `Wait` and unread pipe output

This is the canonical `os/exec` bug. Pseudocode of the broken pattern:

```go
cmd := exec.Command("noisy-tool")
stdout, _ := cmd.StdoutPipe()
cmd.Start()
err := cmd.Wait()              // BLOCKS FOREVER
data, _ := io.ReadAll(stdout)  // never reached
```

What happens at the OS level:

1. `cmd.Start` creates a pipe; the child writes to one end, your
   process reads from the other.
2. The pipe has a kernel-side buffer (~64 KiB on Linux).
3. The child writes more than 64 KiB. Subsequent `write(2)` calls
   block.
4. The child can't exit until its writes complete.
5. `cmd.Wait` blocks until the child exits.
6. Nobody reads the pipe → child blocks → `Wait` blocks → deadlock.

The contract:

> `StdoutPipe`: It is incorrect to call `Wait` before all reads from
> the pipe have completed. (`pkg.go.dev/os/exec`)

The correct shape is "drain pipes, *then* `Wait`":

```go
cmd := exec.Command("noisy-tool")
stdout, _ := cmd.StdoutPipe()
cmd.Stderr = cmd.Stdout

if err := cmd.Start(); err != nil { return err }

data, errR := io.ReadAll(stdout)        // drain first
errW := cmd.Wait()                       // then wait
if errR != nil { return errR }
if errW != nil { return errW }
```

If you have separate `StderrPipe`, drain *both* concurrently:

```go
var wg sync.WaitGroup
wg.Add(2)
var outBuf, errBuf []byte
go func() { defer wg.Done(); outBuf, _ = io.ReadAll(stdout) }()
go func() { defer wg.Done(); errBuf, _ = io.ReadAll(stderr) }()
wg.Wait()
err := cmd.Wait()
```

`cmd.Output()` and `cmd.CombinedOutput()` do all of this for you —
which is why they exist. They allocate as needed; the pipe-pattern
above gives you control over buffering.

## 3. Process groups and sessions

When a Unix process forks, the child by default inherits the parent's
*process group ID* (PGID). When the terminal user presses Ctrl-C, the
kernel delivers SIGINT to *every process in the foreground process
group*. So if your Go program forked `gpg` and the user hits Ctrl-C,
both your program and `gpg` get SIGINT — usually what you want for
interactive tools.

For services and supervisors, this is the wrong default. You want to:
1. Isolate the child in its own group so the kernel doesn't double-
   deliver signals.
2. Be able to kill the *entire subtree* (the child plus anything it
   forked) by sending one signal to the group.

```go
//go:build linux || darwin

import "syscall"

cmd := exec.Command("./worker")
cmd.SysProcAttr = &syscall.SysProcAttr{
    Setpgid: true, // child becomes its own group leader
}
if err := cmd.Start(); err != nil { return err }

// Kill the whole group (negative PID = group):
syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
```

Three notes:

- `Setpgid: true` with `Pgid: 0` (the default) means "make a new group
  whose ID equals the child's PID." That's the leader.
- The negative-PID trick (`syscall.Kill(-pid, sig)`) is the standard
  Unix way to signal an entire group. Without `Setpgid`, you'd be
  signalling your own group, which often includes the parent.
- `Setsid: true` is stronger: it puts the child in a new *session* as
  well, fully detaching from the controlling terminal. Use it when
  building daemons.

## 4. `SysProcAttr` per platform

`syscall.SysProcAttr` is a *different struct on every OS*. The Linux
version has Linux-only fields like `Cloneflags` and `AmbientCaps`; the
Darwin version doesn't; the Windows version is unrecognizable.

```go
// Linux
&syscall.SysProcAttr{
    Setpgid:    true,
    Pgid:       0,
    Setsid:     true,
    Pdeathsig:  syscall.SIGTERM, // child gets SIGTERM if parent dies
    Credential: &syscall.Credential{Uid: 65534, Gid: 65534},
    Cloneflags: syscall.CLONE_NEWNS | syscall.CLONE_NEWPID, // namespaces
}

// Windows
&syscall.SysProcAttr{
    HideWindow: true,
    CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
}
```

Build-tag your `SysProcAttr` blocks so cross-compilation works:

```go
// proc_unix.go
//go:build unix
package mypkg
func sysProcAttr() *syscall.SysProcAttr {
    return &syscall.SysProcAttr{Setpgid: true}
}

// proc_windows.go
//go:build windows
package mypkg
func sysProcAttr() *syscall.SysProcAttr {
    return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}
```

`Pdeathsig` (Linux-only) is the secret sauce for orphan cleanup: if
the parent dies, the kernel sends the named signal to the child. Pair
it with `Setpgid` for "kill the whole tree if I crash" semantics.

## 5. `Credential`: dropping privileges in the child

If your service starts as root and forks a worker that should run as
nobody:

```go
cmd := exec.Command("./worker")
cmd.SysProcAttr = &syscall.SysProcAttr{
    Credential: &syscall.Credential{
        Uid:    65534,
        Gid:    65534,
        Groups: []uint32{},      // no supplementary groups
    },
}
```

The drop happens between `fork` and `exec`. The parent stays root.
Subtleties:

- The credential change must succeed before `exec`; otherwise `Start`
  returns the error.
- File descriptors inherited by the child were opened as root; that's
  why this pattern is paired with passing pre-opened sockets via
  `ExtraFiles`.
- Don't use `os.Setuid` *in the parent* unless you really mean to drop
  privileges process-wide — Go's runtime is multithreaded and Linux's
  setuid only affects the calling thread, leading to subtle bugs.
  (`syscall.Setuid` is even worse; it's the raw syscall.)

## 6. Passing inherited file descriptors

The classic graceful-restart trick: parent listens on port 80, forks a
new binary, hands the listening socket to the new binary, then exits.
`Cmd.ExtraFiles` is the channel.

```go
ln, _ := net.Listen("tcp", ":8080")
tcp := ln.(*net.TCPListener)
f, _ := tcp.File() // returns *os.File for the underlying socket

cmd := exec.Command("./newbinary")
cmd.ExtraFiles = []*os.File{f} // becomes FD 3 in the child
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
cmd.Env = append(os.Environ(), "INHERITED_FD=3")
cmd.Start()
```

In the child:

```go
fd := 3 // hardcoded by convention, or read from env
ln, _ := net.FileListener(os.NewFile(uintptr(fd), "listener"))
```

The kernel duplicates the descriptor across `exec`. Both processes
share the listening socket; the kernel load-balances `accept(2)` calls.

## 7. Signal masking and cgo

Go's runtime installs handlers for almost every signal. Cgo
complicates this in two directions:

1. **Signals delivered while a goroutine is running C code** are
   delivered to the running thread. Some C libraries install their own
   signal handlers (libGL, libssl, libuv, …) and can clobber Go's. Go
   tries to chain these but it's not always perfect.
2. **The Go runtime won't preempt a thread that's deep in C.** A
   signal that's expected to interrupt a syscall may be queued
   instead.

Practical guidance:

- Avoid cgo when you don't need it. The signal interaction is one of
  many reasons.
- If you must cgo, set `signal.Ignore` on signals you don't care
  about *before* loading the C library, so Go doesn't fight it.
- For SIGSEGV / SIGBUS / SIGFPE generated by the runtime itself
  (nil-deref, divide-by-zero), don't try to handle them — Go uses
  them internally.
- `runtime/cgo` exposes some control via `signal.Stop` and
  `runtime/debug.SetTraceback`.

The official guidance lives in the [`runtime/cgo` docs](https://pkg.go.dev/runtime/cgo)
and the `os/signal` package overview, which has a long section titled
"Go programs that use cgo or SWIG".

## 8. The signal channel must be buffered

```go
ch := make(chan os.Signal)        // BAD: unbuffered
signal.Notify(ch, syscall.SIGTERM)
```

The `signal.Notify` source does a non-blocking send on the channel:

```go
select {
case ch <- sig:
default:                           // signal dropped silently
}
```

If your goroutine isn't *currently* in a receive when the signal
fires, the signal is lost. The fix is `make(chan os.Signal, 1)`. The
buffer of 1 is enough because if a signal is already queued and
another fires, you only need one wakeup — the second `Notify` would
be redundant.

The same rule applies to channels used with `os/signal.NotifyContext`
internally; the package handles it for you.

## 9. The full lifecycle of `*exec.Cmd`

```
exec.Command(...) ──▶ Cmd struct populated, no syscall yet
        │
        ▼
cmd.Start() ──▶ fork+exec; pipes set up; goroutines started for stdin/out/err
        │
        ▼
(child runs; you copy bytes through pipes)
        │
        ▼
cmd.Wait() ──▶ waits for child + waits for I/O goroutines + reaps zombie
        │
        ▼
cmd.ProcessState set; child fully gone; resources released
```

`Cmd` is single-use. After `Wait`, you cannot `Start` again — build a
new `Cmd`. `Cmd.Process` is non-nil between `Start` and `Wait`;
`Cmd.ProcessState` is non-nil after `Wait` returns.

If you `Start` and never `Wait`, you create a zombie process: the
kernel keeps a tombstone entry until somebody reaps it. Always pair
`Start` with `Wait` (or use `Run` / `Output` / `CombinedOutput`,
which do both).

## 10. Reaping zombies as PID 1

In a normal Linux process tree, when a child exits, its parent is
expected to call `wait()`. If the parent doesn't, the kernel keeps
the child's exit-status entry around — that's a zombie.

In containers, your Go binary often runs as PID 1. PID 1 has a
special responsibility: it adopts orphaned children. If anything in
the container forks twice and the intermediate parent dies, the
grandchild is reparented to PID 1 — you. If you don't reap it, you'll
leak zombies.

The simple fix: a loop that calls `unix.Wait4(-1, ...)`. Pseudo:

```go
//go:build linux

import "golang.org/x/sys/unix"

func reap(ctx context.Context) {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGCHLD)
    defer signal.Stop(sigs)

    for {
        select {
        case <-ctx.Done():
            return
        case <-sigs:
            for {
                var ws unix.WaitStatus
                pid, err := unix.Wait4(-1, &ws, unix.WNOHANG, nil)
                if pid <= 0 || err != nil {
                    break
                }
            }
        }
    }
}
```

Run `reap` in a goroutine in `main` if you're going to be PID 1.
Most production containers ship a tiny init like `tini` or `dumb-init`
to handle this for you, which is why this is rarely an issue in
practice — but knowing it's *your* problem when you're PID 1 is the
senior-level point.

## 11. Why `panic` differs from `os.Exit`

Both end the process. They get there differently:

- `panic` walks up the goroutine's stack, running every deferred
  function. A `recover` in a deferred function in any frame stops
  the unwind and returns control to that frame.
- `os.Exit` calls the C `exit(2)` syscall directly. No Go-side
  cleanup happens.

Consequences:

- A `defer recover()` in `main` catches panics from goroutines? No —
  `recover` is goroutine-local. A panic in a goroutine without its
  own `recover` crashes the program even if `main` has one.
- `defer fmt.Println("bye")` runs on `panic`, not on `os.Exit`.
- A `runtime.SetFinalizer` is not guaranteed to run on either.
  Finalizers are best-effort during GC, never guaranteed at exit.

## 12. `runtime.Goexit` — kill one goroutine only

```go
go func() {
    defer fmt.Println("cleanup")
    runtime.Goexit()
    fmt.Println("never reached")
}()
```

`Goexit` terminates the calling goroutine, runs its defers, and does
nothing to other goroutines. If it's the last live goroutine in the
program, the runtime then exits with a stack-dump and exit code 2.

It's used internally by `testing.T.FailNow()` and `T.Fatal()` —
that's how those calls bail out of a test without killing the whole
test binary.

## 13. Signal forwarding: the supervisor pattern

A supervisor that runs another process and forwards every common
signal:

```go
func runWithForwarding(name string, args []string) (int, error) {
    cmd := exec.Command(name, args...)
    cmd.Stdin = os.Stdin
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

    if err := cmd.Start(); err != nil {
        return -1, err
    }

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs)              // every signal we can intercept
    defer signal.Stop(sigs)

    go func() {
        for s := range sigs {
            if s == syscall.SIGCHLD {
                continue             // would conflict with cmd.Wait
            }
            _ = cmd.Process.Signal(s)
        }
    }()

    err := cmd.Wait()
    var ee *exec.ExitError
    if errors.As(err, &ee) {
        return ee.ExitCode(), nil
    }
    return 0, err
}
```

Notes:

- We skip SIGCHLD because Go's runtime uses it for child reaping.
- We use `signal.Notify(sigs)` with no signal list, which subscribes
  to "every catchable signal" — except SIGKILL and SIGSTOP, which the
  kernel doesn't let any handler intercept.
- We forward to `cmd.Process.Signal(s)`, which sends to the child's
  PID. To send to the entire group, use `syscall.Kill(-pid, s)`.

## 14. The double-fork daemon pattern (and why systemd makes it obsolete)

Pre-systemd, the way to detach a process from the terminal was:

1. `fork`. Parent exits.
2. Child calls `setsid` (creates a new session, no controlling
   terminal).
3. Child `fork` again. Grandparent exits.
4. Grandchild closes 0, 1, 2 and reopens to `/dev/null`.

This left the daemon with no controlling terminal and no chance of
reacquiring one. In Go, `Setsid: true` plus a `cmd.Start` and parent
`Exit` covers steps 1–2; the second fork is paranoia about session
leaders.

Modern systems do this differently. `systemd` (and `launchd`,
`runit`, `s6`, Kubernetes…) launch your binary as PID 1 of a cgroup
or as a tracked child. You log to stdout, the supervisor captures it.
You don't fork; you stay in the foreground. The supervisor handles
restart-on-crash, log rotation, and reaping.

If you ship Linux services in 2026, the right answer is "don't
daemonize; let your supervisor do that." Build for stdout-and-foreground.

## 15. The `Cmd.WaitDelay` hard timeout

Even with `cmd.Cancel`, a process might catch your SIGTERM and ignore
it. `WaitDelay` is the runtime's "I give up" timer.

```go
cmd := exec.CommandContext(ctx, "./untrusted")
cmd.Cancel = func() error {
    return cmd.Process.Signal(syscall.SIGTERM)
}
cmd.WaitDelay = 5 * time.Second
err := cmd.Run()
```

Sequence on context cancellation:
1. `Cancel()` fires (we send SIGTERM).
2. The child has `WaitDelay` to exit on its own.
3. If still alive, the runtime closes the child's pipes (which makes
   any `io.Copy` goroutines unblock and return).
4. `Wait` returns. `cmd.ProcessState` may still show the child
   running on Unix — the runtime does *not* SIGKILL by default; it
   just gives up waiting.

If you want a real hard kill, do it yourself in `Cancel`:

```go
cmd.Cancel = func() error {
    cmd.Process.Signal(syscall.SIGTERM)
    time.AfterFunc(5*time.Second, func() {
        cmd.Process.Kill()
    })
    return nil
}
```

(Note that `Cancel` itself is supposed to be quick; spawning a
follow-up goroutine is the usual workaround.)

## 16. `os.Process` vs `exec.Cmd`

`os.Process` is the low-level handle: a PID and a way to send signals
or wait. You get one from `os.StartProcess` or `os.FindProcess`.
`exec.Cmd` is the friendly wrapper that knows about pipes, env, and
context.

A typical reason to use `os.Process` directly: you have a PID from
somewhere else (a pidfile, an API call) and you want to send a
signal:

```go
pid, _ := readPidFile()
p, err := os.FindProcess(pid)
if err != nil { return err }
if err := p.Signal(syscall.SIGHUP); err != nil { return err }
```

Or to wait for a process you didn't fork (Linux only via `pidfd`,
but the API is `os.FindProcess` + `(*Process).Wait` — and `Wait`
will return an error if you're not the parent).

## 17. Errors: `*exec.ExitError`, `*os.PathError`, `fs.ErrPermission`

The `os` family wraps OS errors in typed values:

```go
out, err := exec.Command("ls", "/nope").Output()

var ee *exec.ExitError
if errors.As(err, &ee) {
    fmt.Println("non-zero exit", ee.ExitCode())
}

var pe *os.PathError
if errors.As(err, &pe) {
    fmt.Println("path error:", pe.Op, pe.Path, pe.Err)
}

if errors.Is(err, fs.ErrPermission) { /* EACCES */ }
if errors.Is(err, fs.ErrNotExist)   { /* ENOENT */ }
if errors.Is(err, fs.ErrExist)      { /* EEXIST */ }
```

`os.IsNotExist`, `os.IsPermission`, `os.IsExist` predate `errors.Is`
and still work. Prefer `errors.Is` in new code; it composes with
wrapping.

## 18. Reading the exit status precisely (Unix)

```go
err := cmd.Run()
var ee *exec.ExitError
if errors.As(err, &ee) {
    if status, ok := ee.Sys().(syscall.WaitStatus); ok {
        if status.Signaled() {
            fmt.Println("killed by", status.Signal())
        } else {
            fmt.Println("exited", status.ExitStatus())
        }
    }
}
```

The shell convention is to map a signal kill to exit code `128+sig`
(so `SIGKILL = 9` → `137`). Go's `ee.ExitCode()` returns `-1` for a
signal kill, *not* `128+sig`. If you want the shell convention, do
the math yourself with `WaitStatus.Signal()`.

## 19. Common senior-level mistakes

| Symptom | Cause |
|---------|-------|
| Defers in `main` don't run | `os.Exit` was called somewhere, or panic in another goroutine |
| Subprocess hangs forever | Pipes not drained before `Wait`; or single goroutine drains both pipes sequentially |
| Killed child's children survive | Forgot `Setpgid: true`; signalled the leader, not the group |
| Container leaks zombies | Running as PID 1 without a reaper; missing `tini` / `dumb-init` |
| Cgo program ignores SIGINT | C library installed its own handler; Go's was overwritten |
| `Wait` returns success but child didn't run | Used `cmd.Start()` and forgot to actually call it; or `cmd.Stderr` set to a closed file |
| `signal.Notify` "doesn't fire" | Channel unbuffered; signal arrived while the receiver wasn't blocked on it |

## 20. What to read next

- [professional.md](professional.md) — production graceful shutdown
  with grace periods, HUP-reload, supervision patterns, container
  signal quirks.
- [find-bug.md](find-bug.md) — the deadlock and signal-drop patterns
  in twelve different disguises.
- [optimize.md](optimize.md) — fork cost, exec cost, env-access cost,
  Linux-specific tricks.
- The standard library docs:
  [`os`](https://pkg.go.dev/os),
  [`os/exec`](https://pkg.go.dev/os/exec),
  [`os/signal`](https://pkg.go.dev/os/signal).
