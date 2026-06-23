# 8.5 `os` — Specification

> A formal reference for the `os`, `os/exec`, and `os/signal` surface
> covered in this leaf. Field-by-field tables, signal numbers per
> platform, lifecycle states, error sentinels. Use the package docs
> on pkg.go.dev for the authoritative source; this is a cross-reference
> for the patterns covered in earlier files.

## 1. Process functions

| Function | Returns | Notes |
|----------|---------|-------|
| `os.Args` | `[]string` | `Args[0]` is invocation name; never empty |
| `os.Getpid()` | `int` | Current PID |
| `os.Getppid()` | `int` | Parent PID; can become 1 (or the subreaper) if parent dies |
| `os.Getuid()` | `int` | -1 on Windows |
| `os.Geteuid()` | `int` | -1 on Windows |
| `os.Getgid()` | `int` | -1 on Windows |
| `os.Getegid()` | `int` | -1 on Windows |
| `os.Hostname()` | `(string, error)` | Reads `gethostname(2)` |
| `os.UserHomeDir()` | `(string, error)` | `$HOME` on Unix, `%USERPROFILE%` on Windows |
| `os.UserCacheDir()` | `(string, error)` | XDG_CACHE_HOME or platform default |
| `os.UserConfigDir()` | `(string, error)` | XDG_CONFIG_HOME or platform default |
| `os.TempDir()` | `string` | `$TMPDIR` or platform default; never errors |
| `os.Executable()` | `(string, error)` | Absolute path to running binary |
| `os.Chdir(dir)` | `error` | Process-global; race-prone with goroutines |
| `os.Getwd()` | `(string, error)` | Current working directory |
| `os.Exit(code)` | (does not return) | Skips defers and finalizers |

## 2. Environment functions

| Function | Behavior |
|----------|----------|
| `os.Getenv(key)` | Returns value, or `""` if unset (cannot distinguish) |
| `os.LookupEnv(key)` | Returns `(value, true)` if set, `("", false)` if unset |
| `os.Setenv(key, value)` | Sets in current process; affects future children |
| `os.Unsetenv(key)` | Removes |
| `os.Environ()` | Returns `[]string` of `"KEY=VALUE"` |
| `os.ExpandEnv(s)` | Substitutes `$VAR` and `${VAR}`; unset → `""` |
| `os.Expand(s, mapping)` | Same with custom resolver |
| `os.Clearenv()` | Wipes the environment |

Notes:
- `Setenv`/`Unsetenv` are process-global. Mutex protect if multiple
  goroutines call them concurrently.
- `Environ()` returns a *copy*. Mutating the slice doesn't change
  the environment; use `Setenv`.

## 3. Process management

| Function | Returns | Use |
|----------|---------|-----|
| `os.StartProcess(name, argv, *ProcAttr)` | `(*Process, error)` | Low-level fork+exec |
| `os.FindProcess(pid)` | `(*Process, error)` | Construct handle from PID; on Unix, never fails (deferred) |
| `(*Process).Signal(sig)` | `error` | Send signal; `ErrProcessDone` if exited |
| `(*Process).Kill()` | `error` | SIGKILL on Unix; TerminateProcess on Windows |
| `(*Process).Wait()` | `(*ProcessState, error)` | Reap; only works if you're the parent |
| `(*Process).Release()` | `error` | Release resources without waiting (Windows handle, etc.) |

## 4. `os.ProcAttr` fields

```go
type ProcAttr struct {
    Dir   string         // child's working directory
    Env   []string       // child's environment; nil = inherit
    Files []*os.File     // child's FDs; index = FD number
    Sys   *syscall.SysProcAttr // OS-specific
}
```

## 5. `*os.ProcessState` accessors

| Method | Returns |
|--------|---------|
| `.Pid()` | `int` |
| `.Exited()` | `bool` — true if process exited (vs killed) |
| `.Success()` | `bool` — exited with code 0 |
| `.ExitCode()` | `int` — exit code, or `-1` if killed by signal |
| `.UserTime()` | `time.Duration` — CPU time in user mode |
| `.SystemTime()` | `time.Duration` — CPU time in kernel mode |
| `.Sys()` | `any` — `syscall.WaitStatus` on Unix |
| `.SysUsage()` | `any` — `*syscall.Rusage` on Unix |
| `.String()` | `string` — human-readable summary |

## 6. `*exec.Cmd` field reference

```go
type Cmd struct {
    Path        string          // resolved binary path
    Args        []string        // including Args[0] (the program name)
    Env         []string        // nil = inherit from parent
    Dir         string          // working directory
    Stdin       io.Reader       // nil = /dev/null
    Stdout      io.Writer       // nil = /dev/null
    Stderr      io.Writer       // nil = /dev/null
    ExtraFiles  []*os.File      // FDs 3, 4, ... in the child
    SysProcAttr *syscall.SysProcAttr

    Process     *os.Process     // set after Start
    ProcessState *os.ProcessState // set after Wait

    Err         error           // populated by NewCmd-time errors

    Cancel      func() error    // 1.20+: called when context cancels
    WaitDelay   time.Duration   // 1.20+: hard timeout after Cancel

    // Internal: fd0, fd1, fd2 wiring goroutines
}
```

## 7. `*exec.Cmd` lifecycle states

```
[Construct] ── exec.Command(...) ─────▶ Cmd struct, no syscall
       │
[Started] ── cmd.Start() ─────────────▶ fork+exec; pipes ready
       │                                Cmd.Process != nil
       ▼
[Running] ── (child runs; pipes flow)
       │
[Waited] ── cmd.Wait() ───────────────▶ child reaped; goroutines done
                                        Cmd.ProcessState != nil
```

A `Cmd` is single-use: after `Wait`, build a new `Cmd` for the next
invocation. `Run`, `Output`, `CombinedOutput` all internally do
`Start` then `Wait`.

## 8. `*exec.Cmd` runner methods

| Method | Captures stdout | Captures stderr | Returns |
|--------|-----------------|-----------------|---------|
| `Run()` | no (uses `Stdout`) | no (uses `Stderr`) | `error` |
| `Start()` | no | no | `error` (does not wait) |
| `Wait()` | n/a | n/a | `error` (must follow `Start`) |
| `Output()` | yes (returned) | partial (in `*ExitError.Stderr`) | `([]byte, error)` |
| `CombinedOutput()` | yes (interleaved) | yes (interleaved) | `([]byte, error)` |

## 9. `os/signal` functions

| Function | Behavior |
|----------|----------|
| `signal.Notify(c, sigs...)` | Forward listed signals to channel `c`. With no signals, forwards all catchable signals. |
| `signal.Stop(c)` | Stop forwarding to `c` |
| `signal.Reset(sigs...)` | Reset listed signals to default OS behavior |
| `signal.Ignore(sigs...)` | Ignore listed signals (Go won't see them) |
| `signal.Ignored(sig)` | Reports whether `sig` is currently ignored |
| `signal.NotifyContext(ctx, sigs...)` | Returns `(ctx, stop)`; `ctx` cancels on first matching signal |

Channel rules:
- The channel must be buffered (size ≥ 1). `Notify` does a non-
  blocking send; if the buffer is full, the signal is dropped.
- A single channel can be registered for multiple signals.
- `Stop` is safe to call multiple times.

## 10. Common signals (Unix)

| Signal | Number (Linux) | Default | Catchable |
|--------|----------------|---------|-----------|
| SIGHUP | 1 | terminate | yes |
| SIGINT | 2 | terminate | yes (Ctrl-C) |
| SIGQUIT | 3 | core dump | yes (Ctrl-\) |
| SIGILL | 4 | core dump | yes (runtime uses) |
| SIGABRT | 6 | core dump | yes |
| SIGFPE | 8 | core dump | yes (runtime uses) |
| SIGKILL | 9 | terminate | **no** |
| SIGUSR1 | 10 | terminate | yes |
| SIGSEGV | 11 | core dump | yes (runtime uses) |
| SIGUSR2 | 12 | terminate | yes |
| SIGPIPE | 13 | terminate | yes (runtime uses) |
| SIGALRM | 14 | terminate | yes |
| SIGTERM | 15 | terminate | yes |
| SIGCHLD | 17 | ignore | yes |
| SIGCONT | 18 | continue | yes |
| SIGSTOP | 19 | stop | **no** |
| SIGTSTP | 20 | stop | yes (Ctrl-Z) |
| SIGTTIN | 21 | stop | yes |
| SIGTTOU | 22 | stop | yes |

Numbers vary across architectures (Linux MIPS, Alpha, etc.). Use the
named constants from `syscall` rather than literals. Some constants
(`SIGUSR1`, `SIGCHLD`) are only present on Unix builds — guard with
build tags.

## 11. Signals and Windows

Windows has only a small set of signals:

| Constant | Meaning |
|----------|---------|
| `os.Interrupt` | Ctrl-C / Ctrl-Break |
| `syscall.SIGTERM` | Synthetic; only sent by some tooling |
| `syscall.SIGKILL` | Used by `(*Process).Kill()` |

Windows does not have SIGUSR1, SIGHUP, SIGSTOP, etc. Don't import
those constants in Windows-targeted code without `//go:build unix`.

## 12. `syscall.SysProcAttr` (Linux subset)

```go
type SysProcAttr struct {
    Chroot     string
    Credential *Credential
    Ptrace     bool
    Setsid     bool          // create new session
    Setpgid    bool          // create new process group
    Pgid       int           // group ID; 0 = use child's PID
    Setctty    bool          // set controlling tty
    Noctty     bool          // detach from controlling tty
    Ctty       int           // tty FD
    Foreground bool
    Pdeathsig  Signal        // signal sent if parent dies
    Cloneflags uintptr       // CLONE_NEWNS, CLONE_NEWPID, ...
    Unshareflags uintptr
    UidMappings []SysProcIDMap
    GidMappings []SysProcIDMap
    GidMappingsEnableSetgroups bool
    AmbientCaps []uintptr    // ambient capabilities
    UseCgroupFD bool
    CgroupFD    int
}
```

Many fields are Linux-specific. `Cloneflags` is the gateway to
namespaces (i.e., the kernel API containers are built on).

## 13. `syscall.SysProcAttr` (Windows subset)

```go
type SysProcAttr struct {
    HideWindow         bool
    CmdLine            string  // raw command line
    CreationFlags      uint32  // CREATE_NEW_PROCESS_GROUP, etc.
    Token              syscall.Token
    ProcessAttributes  *SecurityAttributes
    ThreadAttributes   *SecurityAttributes
    NoInheritHandles   bool
    ParentProcess      syscall.Handle
    AdditionalInheritedHandles []syscall.Handle
}
```

Windows has its own model: process groups exist but mean something
different; signals are mostly synthesized.

## 14. Error sentinels

| Sentinel | Meaning |
|----------|---------|
| `os.ErrInvalid` | Invalid argument |
| `os.ErrPermission` | Permission denied (alias for `fs.ErrPermission`) |
| `os.ErrExist` | File already exists (alias for `fs.ErrExist`) |
| `os.ErrNotExist` | File does not exist (alias for `fs.ErrNotExist`) |
| `os.ErrClosed` | Operation on closed file (alias for `fs.ErrClosed`) |
| `os.ErrNoDeadline` | File doesn't support deadlines |
| `os.ErrDeadlineExceeded` | I/O deadline passed |
| `os.ErrProcessDone` | Process already exited (`(*Process).Signal` etc.) |
| `exec.ErrNotFound` | Binary not found in `PATH` |
| `exec.ErrDot` | Resolved binary is in CWD via relative path (1.19+) |
| `exec.ErrWaitDelay` | `Wait` returned because `WaitDelay` expired |

Use `errors.Is(err, sentinel)` rather than direct comparison; many
errors are wrapped in `*os.PathError` or `*exec.Error`.

## 15. Error types

| Type | Wraps | Fields |
|------|-------|--------|
| `*os.PathError` | yes | `Op`, `Path`, `Err` |
| `*os.LinkError` | yes | `Op`, `Old`, `New`, `Err` |
| `*os.SyscallError` | yes | `Syscall`, `Err` |
| `*exec.Error` | yes | `Name`, `Err` (returned by `LookPath`) |
| `*exec.ExitError` | yes | embeds `*os.ProcessState`; `Stderr []byte` |

All implement `Unwrap()`; `errors.Is`/`As` work as expected.

## 16. Standard streams

| Variable | Type | Default |
|----------|------|---------|
| `os.Stdin` | `*os.File` | FD 0 |
| `os.Stdout` | `*os.File` | FD 1 |
| `os.Stderr` | `*os.File` | FD 2 |

Closing them is generally a bad idea; the runtime and other goroutines
may write to them.

## 17. `os/exec` lookup precedence

1. If `name` contains a path separator (`/` or `\`), use it directly
   as a path. No `PATH` lookup.
2. Otherwise, search each directory in `$PATH` (Unix) or `%PATH%`
   (Windows) for an executable named `name`.
3. On Windows, also search for `name.exe`, `name.bat`, `name.cmd`,
   etc. according to `%PATHEXT%`.
4. Since Go 1.19, if step 2 resolves to a file in the current
   directory via a relative `PATH` entry (`""`, `"."`), `LookPath`
   returns `exec.ErrDot`. To opt in, prepend `./` to the name.

## 18. `runtime` constants relevant to `os`

| Constant | Type | Examples |
|----------|------|----------|
| `runtime.GOOS` | `string` | `"linux"`, `"darwin"`, `"windows"`, `"freebsd"`, `"netbsd"`, `"openbsd"`, `"plan9"`, `"solaris"`, `"js"`, `"wasip1"` |
| `runtime.GOARCH` | `string` | `"amd64"`, `"arm64"`, `"386"`, `"arm"`, `"riscv64"`, `"wasm"`, ... |
| `runtime.NumCPU()` | `int` | Logical CPUs available to the process |
| `runtime.GOMAXPROCS(n)` | `int` | OS threads simultaneously running Go code |

## 19. Cross-references

- [`io` and File Handling`](../01-io-and-file-handling/specification.md)
  for `*os.File` operations and `fs.FileMode` semantics.
- [`flag`](../02-flag/junior.md) for `os.Args` parsing.
- [`time`](../03-time/junior.md) for `context.WithTimeout` shutdown bounds.
