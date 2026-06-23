# 8.5 — `os`: Process, Environment, Signals, Exec

The `os` package is Go's bridge to the operating system. This leaf covers
the *process* surface: command-line arguments, environment variables,
signals, exit semantics, child-process execution via `os/exec`, and the
small handful of facilities (working directory, hostname, user dirs)
that everything else assumes is there.

> **Scope note.** File and directory I/O — `os.Open`, `os.ReadFile`,
> `os.Stat`, `filepath.WalkDir`, etc. — lives in the sibling leaf
> [`01-io-and-file-handling`](../01-io-and-file-handling/index.md). This
> leaf cross-references it but does not duplicate it.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need `os.Args`, env vars, `exec.Command`, basic signals |
| [middle.md](middle.md) | You're wiring graceful shutdown and full subprocess pipes |
| [senior.md](senior.md) | You need process groups, signal masking, exit semantics |
| [professional.md](professional.md) | You're shipping services with HUP-reload, supervision, PID 1 quirks |
| [specification.md](specification.md) | You need the formal field/function reference |
| [interview.md](interview.md) | You're prepping for or running interviews on `os`/`os/exec` |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `os` and signal bugs |
| [optimize.md](optimize.md) | You're cutting subprocess overhead or env-access cost |

## Prerequisites

- Go 1.22+ (uses `signal.NotifyContext`, `Cmd.Cancel`, `Cmd.WaitDelay`).
- Comfort with goroutines, channels, and `context.Context`.
- For [find-bug.md](find-bug.md) and [optimize.md](optimize.md), basic
  Linux process model (PIDs, signals, fork/exec) helps.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — file/dir operations and the `io.Reader`/`io.Writer` interfaces every
  `Cmd` pipe is built on.
- [`08-standard-library/02-flag`](../02-flag/) — parsing the
  `os.Args` slice into typed flags.
- [`08-standard-library/03-time`](../03-time/) — `context.WithTimeout`
  and `time.AfterFunc` for shutdown grace periods.
