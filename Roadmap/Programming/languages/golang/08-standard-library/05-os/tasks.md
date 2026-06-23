# 8.5 `os` — Tasks

> Twelve exercises that work the `os`, `os/exec`, and `os/signal` API
> from the inside. Each task lists acceptance criteria. Where useful,
> hints point to a function or pattern from the other files.

## Task 1 — A `tail -f` that exits on Ctrl-C

Write a program `tailf` that takes a file path on the command line,
reads the existing contents to stdout, then keeps printing new lines
as they're appended. Pressing Ctrl-C must produce a single line
`shutdown` on stderr and exit with code 0.

**Acceptance:**
- Streams (no `os.ReadFile`).
- `signal.NotifyContext`-driven shutdown.
- No deadlock on Ctrl-C; the read loop wakes immediately.
- Buffered output to stdout is flushed before exit.

**Hint:** `bufio.NewScanner(f)` plus a `time.Ticker` for polling new
data. Or, on Linux, `inotify` via `golang.org/x/sys/unix` (out of
scope for this task — keep it polled).

## Task 2 — Graceful HTTP server

Write a server `gracefulhttp` that:
1. Listens on `:8080`.
2. Handles `/sleep?seconds=N` by sleeping `N` seconds before
   responding `200 OK`.
3. On SIGINT or SIGTERM, stops accepting new requests and gives in-
   flight ones up to **20 seconds** to finish.
4. If an in-flight request exceeds the grace, force-closes and exits
   with code 1.

**Acceptance:**
- `signal.NotifyContext` with both signals.
- Two contexts: one for the signal, a separate `context.WithTimeout`
  for the drain.
- Logs `accepted shutdown signal`, `drain complete` (or `forced
  shutdown after 20s`), then the exit code matches.

**Hint:** `srv.Shutdown(drainCtx)` is the call that drains.

## Task 3 — Subprocess supervisor with restart-on-crash

Write `super`, which takes `super -- <command...>` and supervises
the command:
- Restart the child every time it exits non-zero.
- Exponential backoff: 1s, 2s, 4s, 8s, capped at 60s.
- Reset backoff to 1s if the child ran for more than 30s.
- Forward SIGINT and SIGTERM to the child; on receiving them, exit
  the supervisor too without restart.
- Forward stdout and stderr to the supervisor's own.

**Acceptance:**
- `exec.CommandContext` with `Setpgid: true`.
- Backoff measured against wall-clock run time.
- A clean exit (code 0) does *not* restart.

## Task 4 — Env-driven config loader

Build a package `envcfg` exposing:

```go
type Config struct {
    Addr      string
    LogLevel  string
    DBURL     string
    Timeout   time.Duration
    MaxConn   int
}

func Load() (*Config, error)
```

Defaults:
- `Addr = ":8080"`, `LogLevel = "info"`, `Timeout = 5s`, `MaxConn = 100`.
- `DBURL` is required; missing → return a wrapped error naming the
  variable.

Read from `LISTEN_ADDR`, `LOG_LEVEL`, `DATABASE_URL`, `TIMEOUT`,
`MAX_CONN`.

**Acceptance:**
- `os.LookupEnv` (not `Getenv`) so empty values fall back to default.
- Bad values (e.g., `MAX_CONN=banana`) return a wrapped error.
- Tests use `t.Setenv(...)` to manipulate env without leaking.

## Task 5 — `runtimeout` wrapper

Write `runtimeout`, called as `runtimeout 30s -- mycmd args...`. It:
- Runs `mycmd args...` with stdout/stderr inherited.
- After `30s` (or whatever duration), sends SIGTERM.
- After another **5 seconds** (the grace), sends SIGKILL.
- Exits with the child's exit code, or with 124 if the child was
  killed by the timeout.

**Acceptance:**
- `exec.CommandContext` + `cmd.Cancel` + `cmd.WaitDelay`.
- Forwards `os.Args[0]` argv to the child correctly.
- Return code distinguishes "child errored on its own" from "we
  killed it."

**Hint:** `cmd.ProcessState.Sys().(syscall.WaitStatus).Signaled()` is
true when the child died from a signal.

## Task 6 — Run N commands in parallel and collect

Write `parallel`:

```
parallel -j 4 "echo a" "echo b" "false" "echo d"
```

- Run each command via `sh -c`.
- Cap concurrency at `-j` (default `runtime.NumCPU()`).
- Print, after all complete, one line per command in *original* order:
  `[ok|fail]<TAB>exit_code<TAB>command<TAB>output (truncated to 200 chars)`.

**Acceptance:**
- A semaphore channel caps active children.
- Output order matches input order, even though completion order
  doesn't.
- Captured output is bounded (no unbounded buffer; truncate at
  collect time).

## Task 7 — Sub-shell with env interpolation

Write `expand`, which reads stdin, interpolates `$VAR` and `${VAR}`
references using the current environment, and writes the result to
stdout. Unset variables: produce an empty string and a warning to
stderr.

**Acceptance:**
- `os.Expand` with a custom mapping (so you can emit warnings).
- `$$` produces a literal `$`.
- Streams (no `io.ReadAll`); use `bufio.Scanner` or `bufio.Reader`.

## Task 8 — Daemon with HUP-reload

Write a long-running program `reloader` that:
- Writes the current contents of a config file to stdout once a
  second.
- On SIGHUP, re-reads the config file and switches over without
  exiting.
- On SIGTERM/SIGINT, exits cleanly.
- If the config file is unreadable on a HUP, logs the error and
  keeps using the old config.

**Acceptance:**
- `atomic.Pointer[string]` (or `[Config]`) for safe swap.
- HUP handler validates before swapping.
- No goroutine leaks when run with `-race` and 100 HUPs.

## Task 9 — PID-1-safe init

Write `init1` that, when run as PID 1, executes its second-and-on
arguments as a child and:
- Reaps any zombies (children whose parents died and were reparented
  to PID 1).
- Forwards SIGINT, SIGTERM, SIGHUP to the child.
- On the child's exit, propagates its exit code (or `128+sig` if it
  was signal-killed).

**Acceptance:**
- Detects PID 1 with `os.Getpid() == 1`. If not PID 1, runs anyway
  but logs a warning.
- Uses `golang.org/x/sys/unix.Wait4(-1, ..., WNOHANG)` in a SIGCHLD
  loop.
- Exits the same way the child did.

**Hint:** Test with `docker run --rm -it your-image sleep 5` and verify
`docker stop` produces a clean exit within a couple of seconds.

## Task 10 — `which` reimplementation

Write `which name1 name2 ...` that:
- For each name, prints the absolute path of the binary that would
  be executed, or `name1: not found` to stderr.
- Exits 0 if all found, 1 if any missing, 2 if no arguments.
- Honors the Go 1.19 `exec.ErrDot` rule: if a name resolves via a
  relative `PATH` entry, print a warning to stderr and don't include
  it.

**Acceptance:**
- Uses `exec.LookPath`.
- `errors.Is(err, exec.ErrNotFound)` and `errors.Is(err, exec.ErrDot)`
  for branching.

## Task 11 — Tee stdin to two files

Write `tee2 file1 file2` that reads stdin, writes the bytes to both
named files *and* to stdout, and exits cleanly on Ctrl-C. The bytes
already buffered must reach the files before exit.

**Acceptance:**
- `io.MultiWriter` for the fan-out.
- `bufio.Writer` for both files; `Flush` before close in deferred
  order.
- Signal-driven exit; no truncated tail.

## Task 12 — `lsproc`: list processes you can signal

On Linux, write `lsproc` that walks `/proc`, finds every directory
whose name is a number, reads `/proc/<pid>/status` to get the
process name, and prints `pid name`. For each, attempt
`syscall.Kill(pid, 0)` — if it succeeds (or fails with `EPERM`),
the process exists; print it. If it fails with `ESRCH`, skip.

**Acceptance:**
- Build-tag with `//go:build linux`.
- No panics on permission errors.
- Output matches `ps -A` line count within a small margin.

## Stretch goals

If you finish the above, try these:

- **Task 13** — Write a `ports` command that lists open TCP ports
  and the PID owning each, by reading `/proc/net/tcp` and walking
  `/proc/*/fd`. (Pure Go, no `lsof`.)
- **Task 14** — Implement a binary-swap reload: a server that, on
  SIGUSR2, forks a new copy of itself, hands it the listening
  socket via `ExtraFiles`, and exits after the new instance signals
  ready.
- **Task 15** — Implement a job queue with one parent and N
  workers, where each worker is a separate process forked at
  startup, fed work via stdin, and replaced if it crashes.

## Cross-references

- [junior.md](junior.md) for the basics most tasks rely on.
- [middle.md](middle.md) for `signal.NotifyContext` and `Cmd.Cancel`.
- [senior.md](senior.md) for `Setpgid`, deadlock avoidance, reaping.
- [professional.md](professional.md) for HUP-reload and PID 1.
- [`02-flag`](../02-flag/junior.md) for parsing the argv each task takes.
