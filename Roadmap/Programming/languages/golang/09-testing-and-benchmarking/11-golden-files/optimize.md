---
layout: default
title: Golden Files — Optimize
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/optimize/
---

# Golden Files — Optimize

[← Back](../)

## Baseline

A naive golden test runs `os.ReadFile`, allocates two `[]byte`, computes a diff on every comparison, and may re-read the same fixture inside a table loop. For a package with 200 golden assertions in a CI run this matters: I/O dominates, and large goldens (multi-megabyte HTML) blow up allocator pressure.

## Profile first

```
go test ./pkg -run TestGolden -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -top cpu.out
```

If `os.ReadFile` dominates, the bottleneck is I/O. If `cmp.Diff` dominates, the bottleneck is the diff algorithm. The optimization differs.

## Optimization 1 — short-circuit equality before diff

`cmp.Diff` walks the entire input. `bytes.Equal` is a single memcmp.

```go
if bytes.Equal(got, want) {
    return // pass; never call cmp.Diff
}
// only on mismatch:
t.Fatalf("diff:\n%s", cmp.Diff(string(want), string(got)))
```

Most runs are passes. Avoiding `cmp.Diff` on the hot path is a measurable win on packages with hundreds of goldens.

## Optimization 2 — cache golden bytes across subtests

In a table-driven test where every case loads the same golden header or schema fragment, read once:

```go
var (
    schemaOnce sync.Once
    schemaBytes []byte
)

func loadSchema(t *testing.T) []byte {
    schemaOnce.Do(func() {
        b, err := os.ReadFile("testdata/schema.golden")
        if err != nil { t.Fatal(err) }
        schemaBytes = b
    })
    return schemaBytes
}
```

`sync.Once` is safe under `t.Parallel()`. Do not cache mutable buffers; return a fresh copy if subtests mutate.

## Optimization 3 — reuse buffers in the SUT

If the SUT writes to `bytes.Buffer`, pool the buffer across the table:

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        buf := bufPool.Get().(*bytes.Buffer)
        defer func() { buf.Reset(); bufPool.Put(buf) }()
        Render(buf, tc.input)
        assertGolden(t, buf.Bytes())
    })
}
```

Caveat: `assertGolden` must not retain `buf.Bytes()` past `bufPool.Put`. If your helper writes to disk under `-update`, copy first.

## Optimization 4 — skip read when updating

In update mode you do not need to read the old golden. Branch first:

```go
if *update {
    return os.WriteFile(path, got, 0o644)
}
want, err := os.ReadFile(path)
```

Saves one syscall per assertion when regenerating large fixtures.

## Optimization 5 — parallel subtests

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        got := Render(tc.input)
        assertGolden(t, got)
    })
}
```

Each subtest has its own golden path; parallelism is safe. On a 10-core machine a 1000-case golden suite drops from minutes to seconds.

## Optimization 6 — line-based diff over byte-based

`cmp.Diff(string(want), string(got))` materializes the full text twice. For very large outputs use a streaming line diff (e.g. `github.com/pmezard/go-difflib/difflib.UnifiedDiff`). On 1 MB inputs this halves diff allocations.

## Optimization 7 — drop normalization when not needed

Each regex `ReplaceAll` allocates. If a SUT is already deterministic, do not run normalizers "just in case":

```go
// bad — runs on every assertion
got = timestampRE.ReplaceAll(got, []byte("<T>"))

// good — gate on need
if containsTimestamp(got) {
    got = timestampRE.ReplaceAll(got, []byte("<T>"))
}
```

Better: fix the SUT so it never emits a timestamp under test, then delete the normalizer entirely.

## Optimization 8 — embed goldens for read-only suites

`go:embed` removes the per-test syscall:

```go
//go:embed testdata/*.golden
var goldenFS embed.FS

func readGolden(name string) ([]byte, error) {
    return goldenFS.ReadFile("testdata/" + name + ".golden")
}
```

Trade-off: `-update` can no longer write through `embed.FS` (it is read-only). You need a parallel `os.WriteFile` path under `*update`. Worth it only when the test binary runs in a sandbox without filesystem access at runtime.

## What NOT to optimize

- Do not pre-compress goldens. The savings on disk are dwarfed by decompress cost per test run.
- Do not share goldens across subtests to "save space". The maintenance cost — figuring out which subtest broke a shared golden — exceeds any I/O win.
- Do not skip the diff on mismatch to "speed up failures". A failing test needs a readable message far more than it needs to be fast.

## Measurement matters

Always benchmark before and after:

```
go test ./pkg -run TestGolden -bench . -benchmem -count=10 | tee before.txt
# apply change
go test ./pkg -run TestGolden -bench . -benchmem -count=10 | tee after.txt
benchstat before.txt after.txt
```

If `benchstat` shows no significant difference, revert. Optimization without measurement is superstition.

## Detailed walkthrough: profiling a slow golden suite

Suppose your CI takes 3 minutes on the test suite and `go test -cpuprofile` shows 40% of time inside golden assertions. The profile output:

```
flat  flat%   sum%        cum   cum%
60s   33%    33%        70s    38%   regexp.(*Regexp).ReplaceAll
20s   11%    44%        20s    11%   syscall.read
15s   8%     52%        30s    16%   github.com/google/go-cmp/cmp.Diff
```

Diagnosis: `regexp.ReplaceAll` is the dominant cost. Action: each test calls `normalize` which has six regex passes, but most of the SUT output never contains any of the patterns being normalized.

Optimization: precheck whether a pattern is present before running `ReplaceAll`:

```go
func normalizeFast(b []byte) []byte {
    if bytes.IndexByte(b, '<') >= 0 {
        b = htmlEntityRE.ReplaceAll(b, ...)
    }
    if bytes.IndexByte(b, ':') >= 0 {
        b = timestampRE.ReplaceAll(b, ...)
    }
    return b
}
```

`bytes.IndexByte` is far faster than `regexp.ReplaceAll`. The optimization wins because most outputs do not contain the patterns at all.

Result: CI time drops to 2 minutes. The wins are measurable. The original 40% golden cost falls to 12%.

This is what real optimization looks like: profile, identify, target, measure.

## A note on premature optimization

The above is a real optimization that paid off. But here is the inverse: a team that thought goldens were slow, added a "cache golden bytes" layer, found a bug in the cache, and ended up with both slower tests and a flaky cache. The benchmark would have told them the cache was unnecessary.

Always measure. Skipping the measurement is how you end up with code that is more complex without being faster.

## Closing

Optimization of golden tests is rarely the highest-value activity. The SUT itself is usually the bottleneck. Profile, target, measure. If goldens really are slow, the techniques here apply. If not, leave them alone.

The mantra: measure twice, optimize once. Or for goldens specifically: profile first, suspect the SUT, optimize last.

## Worked example: a slow code generator test

A package generates Go code from a YAML schema. Each test exercises the generator on one schema, formats the result with `go/format.Source`, and golden-compares. The package has 80 schemas. The test takes 12 seconds.

Profile output:

```
flat  flat%   sum%        cum   cum%
8s    66%    66%        9s     75%   go/format.Source
2s    16%    82%        2s     16%   gen.Generate
1s    8%     90%        1s     8%    runtime.gcMark
```

`format.Source` is the bottleneck. It parses the generated code, formats, and re-emits. Done once per test, 80 times, adds up.

Optimization 1: skip formatting when not needed. In compare mode the golden is already formatted; the SUT output should match byte-for-byte. Skip `format.Source` in compare mode:

```go
got := gen.Generate(spec)
if *update {
    formatted, _ := format.Source(got)
    got = formatted
}
assertGolden(t, got)
```

The compare path saves 100 ms per test. Eighty tests save 8 seconds.

Wait — but if the generator emits unformatted Go and the golden contains formatted Go, the comparison fails. The fix is to always emit formatted Go from the generator itself; the test does not need to reformat:

Optimization 2: move formatting into the generator. `Generate` returns formatted bytes. The test does not need `format.Source` at all. The cost is paid once in the generator (which production code uses anyway), and the test runs in a tenth of the time.

Result: test suite drops from 12 seconds to 1.5 seconds. The optimization is in the SUT, not the test framework. This is typical: golden test slowness usually reflects SUT slowness.

## Worked example: parallel golden batch

A package has 1000 small golden assertions, each I/O-bound. Profile shows 80% in `os.ReadFile`. Adding `t.Parallel()` to each subtest distributes the I/O across cores:

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // ...
        assertGolden(t, got)
    })
}
```

On an 8-core machine, the suite runs about 7x faster. Diminishing returns past the core count, but the easy parallelism win is significant.

## A reminder on the bigger picture

Optimizing tests is rarely a high-leverage activity. A 2x speedup of a test suite that runs in 30 seconds saves 15 seconds per CI run. A 10x speedup of a slow database query saves hours per day. Allocate your optimization budget where the impact lives.

For most projects, golden tests are not the bottleneck. Profile, confirm, then act — or move on to a real bottleneck.

[← Back](../)
