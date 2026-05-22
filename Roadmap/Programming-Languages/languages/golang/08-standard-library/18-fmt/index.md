# 8.18 — `fmt`

The `fmt` package implements formatted I/O analogous to C's `printf`
and `scanf`. It is the most-used package in the Go standard library:
every program that prints a value, builds a string from a template,
wraps an error with `%w`, or implements `String()` on a custom type
goes through `fmt`. Despite that ubiquity, `fmt` is also the package
where teams accumulate the most subtle bugs — `%d` on a string, a
forgotten `%w` inside `Sprintf`, a `Stringer` that recurses into
itself, a pointer-receiver `String()` method that never fires when a
value is formatted.

This leaf walks the package end-to-end: the three families of
formatting functions (`Print`/`Sprint`/`Fprint`), the verb table with
width and precision, the `Stringer` / `GoStringer` / `Formatter`
interfaces that let user types control their own rendering, the
internals of the `pp` printer-state pool that makes `fmt` competitive
with hand-rolled `strconv`, and the production patterns and traps
that keep showing up in code review — when to reach for `fmt` and
when `strconv`, `strings.Builder`, or `slog` is the right answer.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need `Printf`, `Sprintf`, `Errorf`, and the day-one verbs |
| [middle.md](middle.md) | You're wrapping errors, writing to `io.Writer`, comparing with `Builder`/`slog` |
| [senior.md](senior.md) | You need `Stringer`/`GoStringer`/`Formatter` semantics and the `pp` pool |
| [professional.md](professional.md) | You're shipping services and care about `vet`, `staticcheck`, and structured-logging trade-offs |
| [specification.md](specification.md) | You need the verb table and the formal interface signatures |
| [interview.md](interview.md) | You're preparing for or running interviews on Go formatting |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `fmt` misuse |
| [optimize.md](optimize.md) | You're cutting allocations from the format hot path |

## Prerequisites

- Go 1.22+ (the `%w` verb landed in Go 1.13; multiple `%w` in a
  single call landed in Go 1.20).
- Working knowledge of `io.Writer` (see
  [`../01-io-and-file-handling`](../01-io-and-file-handling/index.md))
  — every `Fprint*` function takes one.
- Familiarity with the `error` interface (see
  [`../../05-error-handling/04-fmt-errorf`](../../05-error-handling/04-fmt-errorf/))
  for the `fmt.Errorf` wrapping deep dive.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — `Fprintf` writes to `io.Writer`; `Fprintln` is the building block
  for hand-rolled loggers.
- [`08-standard-library/07-slog`](../07-slog/index.md) — for
  long-running services prefer `slog` over `Printf` to stdout. This
  leaf calls out which verbs map to which `slog.Attr`.
- [`05-error-handling/04-fmt-errorf`](../../05-error-handling/04-fmt-errorf/)
  — focused deep dive on `fmt.Errorf` and `%w`. This leaf covers the
  surface and the traps; that one covers the wrapping graph.
- [`10-go-toolchain/01-core-go-commands/04-go-fmt`](../../10-go-toolchain/01-core-go-commands/04-go-fmt/)
  — the `gofmt` CLI tool, unrelated to this package despite the name.
