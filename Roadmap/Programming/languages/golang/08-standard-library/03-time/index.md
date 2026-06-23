# 8.3 — `time`

The `time` package looks small and is anything but. A `time.Time` value
carries two clocks (wall and monotonic). Durations are integers. Layout
strings are the digits of one specific moment in 2006. Timers and
tickers leak if you misuse them. Timezones live in a system-wide IANA
database — until they don't, and then you ship `_ "time/tzdata"` to
embed them. JSON serialization quietly drops the monotonic clock.
Adding 24 hours is not the same as adding a day. `time.After` allocated
forever before Go 1.23.

This leaf walks the package end-to-end: `Time`, `Duration`, monotonic
vs wall, parsing and formatting, timezones, `Timer`/`Ticker`,
`context` integration, marshaling, NTP jumps, DST, and the production
patterns you reach for when you actually have to schedule something.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need the core API — `Now`, `Since`, `Sleep`, layouts, `Timer` |
| [middle.md](middle.md) | Monotonic pitfalls, RFC3339, `Timer.Stop` drain, `ctx.WithTimeout` |
| [senior.md](senior.md) | Wall+monotonic internals, tzdata, leap seconds, NTP jumps, runtime timers |
| [professional.md](professional.md) | Timeout budgets, deadline propagation, jittered backoff, fake clocks |
| [specification.md](specification.md) | The formal reference — methods, layouts, errors, invariants |
| [interview.md](interview.md) | 25+ questions with model answers |
| [tasks.md](tasks.md) | Hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | Buggy snippets to train your eye |
| [optimize.md](optimize.md) | `Now()` cost, `AppendFormat`, timer pooling, drift correction |

## Prerequisites

- Go 1.22+ (some sections call out 1.20+ `DateTime`/`DateOnly` and
  1.23+ timer GC improvements explicitly).
- Comfort with goroutines, channels, and `context.Context`.
- For [find-bug.md](find-bug.md) and [optimize.md](optimize.md), basic
  familiarity with `go test -bench` and `pprof`.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — companion leaf, same voice and depth.
- [`07-concurrency`](../../07-concurrency/) — `Timer`, `Ticker`, and
  `context.WithTimeout` interact directly with goroutines and channels.
- The official package docs:
  [`time`](https://pkg.go.dev/time),
  [`time/tzdata`](https://pkg.go.dev/time/tzdata),
  [`context`](https://pkg.go.dev/context).
