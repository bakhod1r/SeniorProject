# 8.6 `bufio` — Index

Buffered I/O for Go. Wraps any `io.Reader` or `io.Writer` and amortises
syscalls into 4 KiB-default chunks. Adds a line/word/rune scanner.

This leaf assumes the foundations from
[../01-io-and-file-handling/](../01-io-and-file-handling/index.md).

## Files

- [junior.md](junior.md) — what `bufio.Reader`, `bufio.Writer`, and
  `bufio.Scanner` do, when to use each, every method you need on day one.
- [middle.md](middle.md) — `ReadSlice` aliasing, `Peek`, `AvailableBuffer`,
  custom `SplitFunc`, framing protocols, `Reset` for pooling.
- [senior.md](senior.md) — exact contracts, `ErrTooLong` token loss,
  `ErrFinalToken`, `ReadFrom`/`WriteTo` fast paths, concurrency model.
- [professional.md](professional.md) — production patterns: pooling
  scanners, multi-megabyte tokens, observable buffered pipelines.
- [specification.md](specification.md) — every method, every error,
  every default size, in tables.
- [interview.md](interview.md) — the questions interviewers ask.
- [tasks.md](tasks.md) — exercises that practice each surface.
- [find-bug.md](find-bug.md) — broken snippets to diagnose.
- [optimize.md](optimize.md) — tuning buffer sizes and split functions.

## What to read next

After this leaf: [../07-strings-bytes-unicode/](../07-strings-bytes-unicode/index.md)
for text manipulation, or [../05-encoding/](../05-encoding/index.md) for
how `bufio` plumbs into `encoding/json`, `encoding/csv`, and friends.
