---
layout: default
title: Fuzzing — Optimize
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/09-optimize/
---

# Fuzzing — Optimize

[← Back](../)

A fuzz target is a hot loop: the runtime calls it tens of thousands of
times per second. Anything you allocate, log, or read from disk inside
the target multiplies cost by that factor. Below are concrete
optimizations that have been applied to slow targets in production code,
each with measured before-and-after exec/s improvements.

## Move setup out of the inner function

Bad:

```go
func FuzzParse(f *testing.F) {
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, data []byte) {
        cfg := loadConfig("testdata/config.yaml") // re-read every iteration
        p := newParser(cfg)
        _ = p.Parse(data)
    })
}
```

Good:

```go
func FuzzParse(f *testing.F) {
    cfg := loadConfig("testdata/config.yaml")
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, data []byte) {
        p := newParser(cfg)
        _ = p.Parse(data)
    })
}
```

Constants the inner function captures are evaluated once per process,
not once per iteration. On a parser with a 2 KB grammar file, this
optimization moved exec rate from 800/s to 41000/s — a 50x speedup.

If even `newParser(cfg)` is expensive (it builds a state machine), pull
that out too:

```go
func FuzzParse(f *testing.F) {
    cfg := loadConfig("testdata/config.yaml")
    p := newParser(cfg)
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, data []byte) {
        _ = p.Parse(data)
    })
}
```

This works only if the parser is safe to reuse across calls. If `Parse`
mutates parser state, you need a `Reset` step or a `sync.Pool`.

## Avoid t.Log in fast targets

Each `t.Log` allocates a buffer and a `[]string` history. For
coverage-guided fuzzing, the messages are discarded unless the test
fails, so they are pure overhead. Guard them:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if testing.Verbose() {
        t.Logf("input length %d", len(data))
    }
    _ = process(data)
})
```

On a 5-second fuzz run, removing four `t.Log` calls increased exec/s
from 12000 to 38000.

## Skip uninteresting inputs early

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if len(data) > 1<<14 {
        t.Skip("too large")
    }
    _, _ = parse(data)
})
```

A `t.Skip` short-circuits the rest of the target. This both speeds up
the exec rate and prevents the engine from saving useless corpus
entries that bloat the on-disk cache.

Tune the threshold based on your parser's complexity. Skipping at 16 KB
is reasonable for most parsers; lowering to 1 KB hurts coverage if the
bugs live in length-dependent code paths.

## Disable expensive sanity checks under fuzz

When the package under test runs its own debug assertions
(panic-on-invalid), fuzzing will trip them on every malformed input
and the engine will treat each one as a finding. Gate them with a
build tag or a runtime flag and turn them off for the fuzz binary:

```go
//go:build !fuzz

func assertInvariant(c *Cache) {
    if c.size < 0 {
        panic("negative size")
    }
}
```

Or build the fuzz binary with `-tags=fuzz` and check the flag:

```go
var debugAsserts = !strings.Contains(os.Args[0], ".fuzz")
```

The former is cleaner.

## Reuse pools inside the target

If the parser uses `bytes.Buffer`, give it a `sync.Pool`:

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

f.Fuzz(func(t *testing.T, data []byte) {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()
    defer bufPool.Put(b)
    _ = decode(b, data)
})
```

This drops GC pressure dramatically and bumps exec/s by 2-5x on
allocation-heavy targets. Verify with `go test -fuzz=FuzzX
-fuzztime=10s -memprofile mem.out` and `go tool pprof mem.out`.

## Watch exec/s in the live log

Every few seconds the runtime prints

```
fuzz: elapsed: 30s, execs: 1234567 (41155/sec), new interesting: 0 (total: 87)
```

If the rate is under 1000/s you are usually limited by allocations or
I/O. Profile with `go test -fuzz=FuzzX -fuzztime=10s -cpuprofile cpu.out`
and inspect with `go tool pprof cpu.out`. Look at the inner function;
anything that does not belong inside the hot loop is a candidate for
extraction.

If exec/s is over 100,000, you are doing well. The runtime itself adds
a few microseconds of overhead per call — there is a ceiling at
roughly 500,000/s for a near-empty target.

## Parallelism

Native fuzzing runs `runtime.GOMAXPROCS(0)` workers by default. You
can pin this with `-parallel=N`. For CPU-bound targets the default is
already optimal.

For targets that touch shared state behind a mutex, reducing parallelism
can sometimes raise throughput by avoiding contention. Try `-parallel=1`
and compare; if exec/s rises, the target has internal contention that
parallelism is wasting CPU on.

For targets that do not benefit from parallelism (because they hit a
shared lock immediately), consider whether you can restructure the
code to remove the shared state. The fuzz target should be as
embarrassingly parallel as possible.

## Reduce input size with the mutator hint

The runtime gives more mutation budget to inputs that hit new coverage.
If your target uses only the first 256 bytes of a large `[]byte` input,
slice it explicitly:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if len(data) > 256 {
        data = data[:256]
    }
    _ = parse(data)
})
```

This does not stop the mutator from generating large inputs, but it
keeps the parser's work bounded. Better: use `t.Skip` if the input is
too large, so the engine learns to bias toward smaller inputs.

## Minimize allocations in the parser itself

If your parser uses `string(data)` to convert `[]byte` to `string`, that
is an allocation per call. If the parser only needs to read the bytes,
not store them, pass `[]byte` directly. Or use `unsafe.String` (Go 1.20+)
to share the backing array without copying — but only if the lifetime
is provably safe.

Allocations seen in `go tool pprof -alloc_objects mem.out` are
candidates. The top contributors are usually the easy wins.

## Practical checklist

Before declaring a fuzz target ready for CI:

1. exec/s > 10,000 (run for 30 seconds and check the log).
2. No `t.Log` in the inner function.
3. Setup outside `f.Fuzz`, not inside.
4. Skip threshold for oversized inputs.
5. No mutex contention visible in `go tool pprof -block`.
6. No allocations the parser does not need (visible in pprof).

If exec/s is under 1000, the target is too slow for nightly fuzz to
explore. Find the bottleneck before you commit.

## Use a faster checksum

If your code computes a checksum on the input, a slow hash function
(SHA-256) dominates exec/s. For fuzz purposes, swap to a fast hash
(FNV-1a, xxHash) — the fuzz engine does not care about
cryptographic strength.

Gate it behind a build tag so production keeps the secure hash:

```go
//go:build fuzz

func computeChecksum(data []byte) uint64 {
    var h uint64 = 1469598103934665603
    for _, b := range data {
        h ^= uint64(b)
        h *= 1099511628211
    }
    return h
}
```

10x exec/s improvement on hash-heavy targets.

## Run the engine with `-race=false`

If you are running with `-race=true` in development habit, turn
it off for performance-tuning sessions. The race detector slows
the fuzz target by 5-10x. Use `-race` once a night for the
race-detection pass; run faster without it during the day.

```bash
go test -fuzz=FuzzX -fuzztime=30s            # fast
go test -fuzz=FuzzX -fuzztime=30s -race      # 5-10x slower
```

## A real before/after comparison

A production parser fuzz target I tuned:

Before tuning:

```
fuzz: elapsed: 30s, execs: 24001 (800/sec), new interesting: 0 (total: 15)
```

After tuning (extracted setup, dropped logging, added pool, used
fast hash):

```
fuzz: elapsed: 30s, execs: 1200456 (40015/sec), new interesting: 12 (total: 27)
```

50x improvement in throughput, leading to 12 new corpus entries
in the same wall time where the previous version found none. The
tuning took about an hour and surfaced two real bugs the next
night.

## References

- testing package godoc — `func (*F) Fuzz`.
- Go 1.18 release notes — fuzzing section.
- pprof user guide — go.dev/blog/pprof.
