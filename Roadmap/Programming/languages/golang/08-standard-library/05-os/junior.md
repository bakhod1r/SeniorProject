# 8.5 `os` — Junior

> **Audience.** You can write Go and call `fmt.Println`, but the
> command line, environment, and child processes are still mysterious.
> By the end of this file you will know how to read arguments and env
> vars, run another program and capture its output, change directories,
> handle Ctrl-C cleanly, and understand the difference between
> `return`, `panic`, `log.Fatal`, and `os.Exit`.

## 1. The shape of a Go program

When the OS launches your binary, it hands the runtime four things:
the path to the binary, the argument list, the environment, and the
three standard streams. The `os` package exposes all four:

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("binary:", os.Args[0])
    fmt.Println("args:  ", os.Args[1:])
    fmt.Println("pid:   ", os.Getpid())
    fmt.Println("ppid:  ", os.Getppid())
    fmt.Println("home:  ", must(os.UserHomeDir()))
    h, _ := os.Hostname()
    fmt.Println("host:  ", h)
}

func must[T any](v T, err error) T {
    if err != nil {
        panic(err)
    }
    return v
}
```

`os.Args` is always non-empty: `os.Args[0]` is whatever name the parent
used to invoke you (often the absolute path, sometimes just `myprog`).
`os.Args[1:]` is the actual arguments. For anything more than counting
positional args, use the [`flag`](../02-flag/junior.md) package — don't parse
`os.Args` by hand.

## 2. `os.Args` and a one-line argument loop

```go
for i, a := range os.Args[1:] {
    fmt.Printf("arg %d: %q\n", i, a)
}
```

The arguments are strings. The OS does not pre-convert types. If you
want an integer flag, parse it with `strconv.Atoi`, or — better — let
`flag` handle it.

## 3. Environment variables: read

```go
v := os.Getenv("HOME")     // "" if unset; you can't tell unset from empty
v, ok := os.LookupEnv("HOME") // ok==false if unset
```

Use `LookupEnv` whenever the empty string is a legal value, or whenever
"missing" needs to mean something different from "set to empty." A
common pattern is fallback-with-default:

```go
func env(key, def string) string {
    if v, ok := os.LookupEnv(key); ok {
        return v
    }
    return def
}

addr := env("LISTEN_ADDR", ":8080")
```

`os.Environ()` returns the whole environment as `[]string` of
`"KEY=VALUE"` entries. You can iterate it and parse with
`strings.SplitN(s, "=", 2)`.

```go
for _, kv := range os.Environ() {
    parts := strings.SplitN(kv, "=", 2)
    fmt.Println(parts[0])
}
```

## 4. Environment variables: write

```go
os.Setenv("LOG_LEVEL", "debug")
os.Unsetenv("OLD_TOKEN")
```

Two things to know on day one:

1. `os.Setenv` mutates *this process*. It does **not** affect the
   parent shell. When this Go program exits, the change is gone.
2. Children inherit the environment as it stood when the child was
   launched. `os.Setenv` in this process before launching a child is
   how you control the child's env.

## 5. Variable expansion in strings

```go
s := os.ExpandEnv("path is $HOME/bin and home is ${HOME}")
// "path is /home/me/bin and home is /home/me"
```

`ExpandEnv` substitutes `$VAR` or `${VAR}`. Unset variables become the
empty string — there is no error. For custom lookup logic use
`os.Expand`:

```go
s := os.Expand("hi $USER", func(k string) string {
    if k == "USER" {
        return "alice"
    }
    return ""
})
```

`ExpandEnv` is convenient for config files. It is **not** a shell —
there's no quoting, no command substitution, no globbing.

## 6. Working directory

```go
wd, err := os.Getwd()       // current directory
err = os.Chdir("/tmp")      // change directory for this process
```

Like `Setenv`, `Chdir` affects the calling process only. Children
launched after the call inherit the new directory; the parent shell is
untouched.

Most programs should just use absolute paths or paths relative to a
configured root rather than relying on `Getwd`. `Chdir` is occasionally
needed when shelling out to a tool that itself uses relative paths.

## 7. Standard streams

`os.Stdin`, `os.Stdout`, and `os.Stderr` are `*os.File` values that the
runtime opens for you. Because `*os.File` implements `io.Reader` and
`io.Writer`, they slot in anywhere those interfaces are expected.

```go
fmt.Fprintln(os.Stderr, "warning: thing happened")
io.Copy(os.Stdout, os.Stdin) // crude `cat`
```

For the streaming and buffering patterns built on top of these — line
scanning, `bufio.Writer`, `io.Copy`, etc. — see
[`01-io-and-file-handling/junior.md`](../01-io-and-file-handling/junior.md).

## 8. Exit codes: `return`, `os.Exit`, `log.Fatal`, `panic`

A Go program ends in one of four ways. They are not equivalent.

| Mechanism | Exit code | Defers run? | Goroutines stopped? |
|-----------|-----------|-------------|---------------------|
| `return` from `main` | 0 | yes | yes (when `main` returns) |
| `os.Exit(n)` | `n` | **no** | yes (process dies immediately) |
| `log.Fatal(...)` | 1 | **no** (calls `os.Exit(1)`) | yes |
| `panic` (uncaught) | 2 | yes (in current goroutine) | yes (after stack dump) |

The single most common bug at this level: deferring something
important, then calling `os.Exit`. The defers don't run.

```go
func main() {
    f, _ := os.Create("out.txt")
    defer f.Close()       // never runs!
    if bad {
        os.Exit(1)
    }
}
```

The fix is to wrap your real logic in a function that returns an error,
let `main` decide the exit code:

```go
func run() error {
    f, err := os.Create("out.txt")
    if err != nil {
        return err
    }
    defer f.Close()
    // ... real work ...
    return nil
}

func main() {
    if err := run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

`run` does the work, `main` does the exit code. `defer f.Close()` is
inside `run`, so it runs whenever `run` returns — error or not.

## 9. Running another program: `exec.Command`

```go
package main

import (
    "fmt"
    "os/exec"
)

func main() {
    out, err := exec.Command("git", "status", "--porcelain").Output()
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Printf("%s", out)
}
```

`exec.Command(name, args...)` builds a `*exec.Cmd` value. Nothing has
been launched yet. Then one of four runners actually starts and waits
for the process:

| Method | What it does |
|--------|--------------|
| `cmd.Run()` | Start, wait, return error. Stdout/stderr go where you set them (default: discarded). |
| `cmd.Output()` | Like `Run`, but captures stdout into the returned `[]byte`. |
| `cmd.CombinedOutput()` | Captures stdout *and* stderr interleaved. |
| `cmd.Start()` then `cmd.Wait()` | Manual control. Streaming, multi-step. |

Pick `Output` when you want the result as bytes. Pick `CombinedOutput`
when you want both streams together (good for diagnostics, bad when
the command writes a lot — you'll buffer it all). Pick `Run` when you
want side effects only (the process modified the world; you don't care
about its stdout). Pick `Start`/`Wait` when you need to stream.

## 10. Failure detection on `Output` / `Run`

When the child exits non-zero, `Output` returns an `*exec.ExitError`:

```go
out, err := exec.Command("ls", "/nope").Output()
if err != nil {
    var ee *exec.ExitError
    if errors.As(err, &ee) {
        fmt.Println("exit code:", ee.ExitCode())
        fmt.Printf("stderr: %s\n", ee.Stderr) // populated only by Output, not Run
    }
}
```

`exec.ExitError.Stderr` is filled in by `Output()` (it captures stderr
into a small buffer up to 32 KiB). For `Run()` you'd have to wire
`Cmd.Stderr` yourself — see middle.md.

## 11. Look up a binary: `exec.LookPath`

```go
path, err := exec.LookPath("git")
if err != nil {
    return fmt.Errorf("git not installed: %w", err)
}
fmt.Println("git is at", path)
```

`exec.Command` already does this internally when you pass a bare name:
it walks `$PATH` and resolves the name to a full path. `LookPath` lets
you check up front and produce a friendlier error message.

If you pass a path with a slash (`./mybin`, `/usr/local/bin/mybin`),
`exec.Command` uses it directly without consulting `$PATH`.

## 12. Passing input via stdin

```go
cmd := exec.Command("grep", "needle")
cmd.Stdin = strings.NewReader("haystack\nneedle in haystack\n")
out, err := cmd.Output()
fmt.Printf("%s\n%v\n", out, err)
```

`Cmd.Stdin` is an `io.Reader`. Anything that implements `Reader`
works: a `*os.File`, a `bytes.Buffer`, an `*http.Response.Body`. The
child process reads from it as fast as it likes; the runtime copies in
the background.

## 13. Setting the child's environment

```go
cmd := exec.Command("printenv", "GREETING")
cmd.Env = append(os.Environ(),
    "GREETING=hello",
    "TZ=UTC",
)
out, _ := cmd.Output()
fmt.Printf("%s", out) // hello\n
```

If `cmd.Env` is `nil`, the child inherits the parent's environment (as
of `Cmd.Start`). If you set `cmd.Env`, that exact slice is the child's
entire environment — duplicated keys are not deduplicated, missing
values are missing.

The idiomatic pattern is `append(os.Environ(), "KEY=VALUE")` to add
on top of inheritance, or `[]string{"KEY=VALUE", ...}` for a clean
slate.

## 14. The simplest signal handler

`Ctrl-C` in a terminal sends `SIGINT`. By default Go terminates on it.
To do something on the way out, listen with `signal.Notify`:

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
)

func main() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

    fmt.Println("press Ctrl-C, my pid is", os.Getpid())
    s := <-sigs
    fmt.Println("got signal:", s)
    fmt.Println("cleaning up…")
}
```

Three things to know:

1. **Buffer the channel with size 1.** If the channel is unbuffered and
   the goroutine receiving from it isn't ready when the signal fires,
   `signal.Notify` *drops the signal silently*. Always make the channel
   `make(chan os.Signal, 1)`.
2. **Pass specific signals** to `signal.Notify`. With no signals
   listed, you get every signal — usually not what you want.
3. **`syscall.SIGINT` is the same value as `os.Interrupt`.** The
   `syscall` form is portable across more platforms.

## 15. Two-phase shutdown: signal then drain

Common pattern: receive a signal, then ask the rest of the program to
stop. A channel makes this clean:

```go
func main() {
    done := make(chan struct{})
    go work(done)

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

    <-sigs
    close(done)        // tell worker to stop
    fmt.Println("waiting for worker…")
    // worker exits, then main returns
}

func work(done <-chan struct{}) {
    t := time.NewTicker(500 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-done:
            fmt.Println("worker stopping")
            return
        case <-t.C:
            fmt.Println("tick")
        }
    }
}
```

Middle.md replaces `done chan struct{}` with `signal.NotifyContext`,
which is strictly nicer. Learn the channel form first because it makes
the mechanism visible.

## 16. Where temp files and config live

```go
home, _ := os.UserHomeDir()       // /home/alice
cache, _ := os.UserCacheDir()     // /home/alice/.cache
conf, _ := os.UserConfigDir()     // /home/alice/.config
fmt.Println(home, cache, conf)
```

These follow the platform conventions: XDG on Linux, `Library/...` on
macOS, `%LOCALAPPDATA%` on Windows. Use them instead of hard-coding
paths so your program works on every OS.

For tempfiles, see
[`01-io-and-file-handling/junior.md`](../01-io-and-file-handling/junior.md#17-temporary-files-and-directories).
The functions are `os.CreateTemp` and `os.MkdirTemp`.

## 17. Where the running binary lives

```go
exe, err := os.Executable()
if err == nil {
    fmt.Println("I am", exe)
}
```

`os.Executable` returns the absolute path to the currently running
binary. Useful for finding adjacent files (`exe + ".cfg"`), for
restarting yourself, or for reporting your own path in logs.

It can fail on platforms where the OS doesn't track the path (rare).
Always handle the error.

## 18. Detecting OS and architecture

```go
import "runtime"

fmt.Println(runtime.GOOS, runtime.GOARCH) // "linux amd64", "darwin arm64", ...

if runtime.GOOS == "windows" {
    // platform-specific path handling
}
```

For one-off branches at runtime, `runtime.GOOS` is fine. For
platform-specific *files*, prefer build tags (`//go:build linux`) so
the wrong code doesn't even compile on the wrong OS. We'll touch on
build tags in [professional.md](professional.md).

## 19. A complete runnable example: a wrapper script

Putting most of this file together — a program that runs another
program, prefixes its output, and forwards Ctrl-C cleanly:

```go
package main

import (
    "bufio"
    "fmt"
    "io"
    "os"
    "os/exec"
    "os/signal"
    "syscall"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Fprintln(os.Stderr, "usage: prefix <program> [args...]")
        os.Exit(2)
    }

    cmd := exec.Command(os.Args[1], os.Args[2:]...)
    stdout, err := cmd.StdoutPipe()
    if err != nil {
        die(err)
    }
    cmd.Stderr = cmd.Stdout // merge stderr into stdout

    if err := cmd.Start(); err != nil {
        die(err)
    }

    // Forward our SIGINT to the child.
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
    go func() {
        s := <-sigs
        cmd.Process.Signal(s)
    }()

    s := bufio.NewScanner(stdout)
    for s.Scan() {
        fmt.Printf("[child] %s\n", s.Text())
    }

    if err := cmd.Wait(); err != nil {
        var ee *exec.ExitError
        if errors.As(err, &ee) {
            os.Exit(ee.ExitCode())
        }
        die(err)
    }
}

func die(err error) {
    fmt.Fprintln(os.Stderr, "error:", err)
    os.Exit(1)
}

// (imports omitted for brevity in real code: "errors")
```

That's a real, working `prefix git status` style wrapper. It uses
`Start`/`Wait` (not `Run`) so we can stream stdout. It merges stderr
into stdout for simplicity. It forwards our signals to the child.
It returns the child's exit code. The five things you do constantly
once you outgrow `Output()`.

## 20. Common mistakes at this level

| Symptom | Likely cause |
|---------|--------------|
| `defer` doesn't run | `os.Exit` (or `log.Fatal`) was called instead of returning |
| Signal handler never fires | Channel was unbuffered; signal was dropped |
| Empty string from `Getenv` is ambiguous | Use `LookupEnv` to distinguish unset from empty |
| `exec.Command("foo bar")` fails with "no such file" | `exec.Command` does **not** parse a shell line; pass `"foo", "bar"` as separate args |
| Child can't see `LOG_LEVEL` you set | Set with `os.Setenv` *before* `cmd.Start`, or build `cmd.Env` explicitly |
| Output is empty | Used `Run` (discards stdout) when you wanted `Output` |

## 21. What to read next

- [middle.md](middle.md) — `signal.NotifyContext`, full pipe wiring,
  context cancellation, env precedence.
- [senior.md](senior.md) — process groups, signal masking, the exact
  semantics of `os.Exit`, the deadlock pattern with `Cmd.Wait`.
- [tasks.md](tasks.md) — exercises that build on this junior material.
- [`01-io-and-file-handling`](../01-io-and-file-handling/junior.md) for
  everything file-related.
- [`02-flag`](../02-flag/junior.md) for parsing `os.Args` properly.
