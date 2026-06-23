# 8.19 — `strings` and `bytes`

Go's `strings` and `bytes` packages are the two halves of the same
idea: one works on immutable `string` values, the other on mutable
`[]byte` slices. Together they cover everything from simple substring
checks to high-throughput text transformation pipelines. Because both
APIs mirror each other almost function-for-function, learning one
teaches you the other.

`strings` is the right default when you already have a `string` and
don't need to mutate in place. `bytes` is right when you're building
output, reusing buffers, or interfacing with `io.Reader`/`io.Writer`.
Knowing when to cross the boundary — and what it costs — is one of
the clearest signals of Go experience.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You want the essential API: search, split, join, trim, builder, and the immutability model |
| [middle.md](middle.md) | You're using `NewReplacer`, `Map`, `Cut`, `bytes.Buffer`, and safe zero-copy conversions |
| [senior.md](senior.md) | You need string internals, rune/byte iteration correctness, `unicode/utf8`, and profiling |
| [professional.md](professional.md) | You're building production text pipelines, sanitizers, and pooled buffer systems |
| [specification.md](specification.md) | You want every function signature, return type, and complexity note on one page |
| [interview.md](interview.md) | You're preparing for or running interviews on string and byte manipulation |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for string/byte bugs in real code |
| [optimize.md](optimize.md) | You want measurable allocation and throughput improvements |

## Prerequisites

- Go 1.22+ (examples use `strings.Cut`, range-over-func, and modern
  stdlib idioms).
- Comfort with slices, interfaces, and `io.Reader`/`io.Writer`.
- Basic understanding of UTF-8 and rune vs byte.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — `strings.NewReader` and `bytes.NewReader` implement `io.Reader`;
  this is where they're used.
- [`08-standard-library/18-fmt`](../18-fmt/index.md) — `fmt.Sprintf`
  is the common alternative to `strings.Builder`; the tradeoffs appear
  in the benchmark section of `professional.md`.
- [`08-standard-library/14-io-fs`](../14-io-fs/index.md) — file-
  level text scanning uses `bufio.Scanner` instead of
  `strings.Split`; motivation is in `professional.md` section 3.
- [`08-standard-library/06-bufio`](../06-bufio/index.md) — `bufio`
  wraps `io.Reader` for line-at-a-time scanning; pairs directly with
  `bytes.Buffer` and `strings.Builder`.
