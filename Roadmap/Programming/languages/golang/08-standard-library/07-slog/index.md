# 8.7 — `log/slog` (Structured Logging)

Go 1.21 added `log/slog` as the official structured-logging package. Before
it, the choice was the un-structured `log` package or one of the
third-party loggers (`logrus`, `zap`, `zerolog`). `slog` ends that split:
it ships in the standard library, has a documented `Handler` interface
that third-party backends can implement, and is the package new code
should default to.

This leaf covers the four user-visible types (`Logger`, `Handler`,
`Record`, `Attr`), the two built-in handlers (`TextHandler`,
`JSONHandler`), the `LogValuer` and `Group` machinery for shaping output,
and the patterns that turn `slog` from "another logger" into a
zero-allocation observability primitive that propagates context across
goroutines and out to a tracing backend.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You've used `log` and need the equivalent `slog` API |
| [middle.md](middle.md) | You're building handlers, groups, and context-aware loggers |
| [senior.md](senior.md) | You need the exact `Handler` contract and allocation model |
| [professional.md](professional.md) | You're shipping services with structured logs at scale |
| [specification.md](specification.md) | You need the formal interface and method tables |
| [interview.md](interview.md) | You're preparing for or running interviews on Go logging |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `slog` misuse in real code |
| [optimize.md](optimize.md) | You're cutting allocations from the log hot path |

## Prerequisites

- Go 1.22+ (Go 1.21 introduced `slog`; 1.22 stabilized `LogValuer` and
  several handler bug fixes).
- Working knowledge of `io.Writer` (see
  [`../01-io-and-file-handling`](../01-io-and-file-handling/index.md)).
- Comfort with `context.Context` for the request-scoped logging patterns.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — `Handler`s write to `io.Writer`; rotation, atomic writes, and
  buffering all live there.
- [`08-standard-library/05-os`](../05-os/) — `os.Stdout` / `os.Stderr` as
  the default destinations and how to swap them.
