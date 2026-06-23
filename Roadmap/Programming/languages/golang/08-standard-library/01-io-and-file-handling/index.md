# 8.1 — `io` and File Handling

The `io` package is the spine of every Go program that touches bytes. File
I/O, network I/O, encoding/decoding, compression, hashing, and even the
`fmt` family all sit on top of two interfaces: `io.Reader` and `io.Writer`.
Anything that produces bytes implements `Reader`; anything that accepts
bytes implements `Writer`. Once you internalize this, the rest of the
standard library starts to feel like a single tool.

This leaf walks the stack from the lowest level — `os.File` and raw
syscalls — up through the `io` adapters, the `bufio` buffering layer, and
into the patterns you reach for in production: copying with limits,
teeing, piping between goroutines, and bounded streaming over large
files. We avoid loading whole files into memory wherever possible; the
`io.Reader` contract was designed for that and we lean into it.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need the core APIs and copy-paste examples |
| [middle.md](middle.md) | You're combining readers, writers, and buffered scanners |
| [senior.md](senior.md) | You need the exact semantics of `EOF`, partial reads, and `Close()` |
| [professional.md](professional.md) | You're shipping streaming pipelines under load |
| [specification.md](specification.md) | You need the formal contract — what each interface guarantees and forbids |
| [interview.md](interview.md) | You're preparing for or running interviews on stdlib I/O |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for I/O bugs in real code |
| [optimize.md](optimize.md) | You're cutting allocations or chasing throughput |

## Prerequisites

- Go 1.22+ (examples use `errors.Is`, `slices`, and modern stdlib idioms).
- Working knowledge of slices, error handling, and basic concurrency.
- For `find-bug.md` and `optimize.md`, comfort with `go test`,
  `pprof`, and reading a flame graph helps.

## Cross-references

- [`08-standard-library/05-os`](../05-os/index.md) — process and OS surface
  beyond file handles.
- [`08-standard-library/06-bufio`](../06-bufio/) — the buffering layer in
  isolation.
- [`08-standard-library/14-io-fs`](../14-io-fs/) — the abstract file-system
  interface used by `embed`, `testing/fstest`, and `os.DirFS`.
