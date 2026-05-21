---
layout: default
title: Fuzzing — Find the Bug
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/08-find-the-bug/
---

# Fuzzing — Find the Bug

[← Back](../)

Below are six fuzz tests as people have shipped them. Each one looks fine
during code review. Each one is wrong in a way that either causes false
negatives, false positives, or makes the fuzz runtime refuse to run them.
Identify the bug before scrolling to the explanation.

## Snippet 1 — The deceptive involutive property

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Fuzz(func(t *testing.T, s string) {
        r := reverse(s)
        if reverse(r) != s {
            t.Errorf("not involutive: %q", s)
        }
    })
}
```

The function under test is a naive `reverse` that flips bytes:

```go
func reverse(s string) string {
    b := []byte(s)
    for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
        b[i], b[j] = b[j], b[i]
    }
    return string(b)
}
```

Bug: a naive byte-flip is not involutive on multi-byte UTF-8. A two-byte
character like `é` (0xC3 0xA9) becomes invalid bytes once reversed
(0xA9 0xC3), and reversing again does not recover the original — the
bytes do recover, but consumers see invalid UTF-8 in the intermediate
form. The fuzzer will discover this on the very first non-ASCII input.

The test is technically correct — it found the bug — but the test name
suggests the property holds; the failure is in `reverse`, not the test.
Lesson: if your spec only claims involutivity on ASCII, gate the input
with `t.Skip` when non-ASCII bytes appear, or write a rune-aware reverse.

## Snippet 2 — The over-strict round-trip

```go
func FuzzParse(f *testing.F) {
    f.Add([]byte{0x00})
    f.Fuzz(func(t *testing.T, in []byte) {
        v, err := Parse(in)
        if err != nil {
            return
        }
        out := Encode(v)
        if !bytes.Equal(in, out) {
            t.Fatalf("round trip failed")
        }
    })
}
```

Bug: this asserts that every parser-accepted input is in canonical form.
Most parsers accept multiple representations of the same value — `1`,
`01`, `1.0` all parse to the same number. The fuzzer will flag the very
first non-canonical accepted input as a "round trip failure" even though
the parser is correct.

Fix: compare values after parsing both sides, not raw bytes.

```go
v, err := Parse(in)
if err != nil {
    return
}
out := Encode(v)
v2, err := Parse(out)
if err != nil {
    t.Fatalf("parse rejected its own encode output")
}
if !reflect.DeepEqual(v, v2) {
    t.Fatalf("round trip changed value")
}
```

## Snippet 3 — The unsupported type

```go
func FuzzWidget(f *testing.F) {
    f.Add(1, "x")
    f.Fuzz(func(t *testing.T, w Widget) {
        _ = process(w)
    })
}
```

Bug: `Widget` is a struct. The runtime panics at registration:
`testing.F.Fuzz: function parameter type Widget not supported`. Native
fuzzing accepts only basic types (the list is in the specification page).
Either decompose the struct fields into parameters and assemble inside
the inner function:

```go
f.Fuzz(func(t *testing.T, id int, name string) {
    w := Widget{ID: id, Name: name}
    _ = process(w)
})
```

Or switch to a pre-1.18 fuzzer such as `go-fuzz` with
`go-fuzz-headers`. Also notice the `f.Add` types do not match the
target either — `int` vs `Widget`. The runtime would catch both errors
at the start of fuzzing, but it is easy to miss in code review.

## Snippet 4 — The accidentally true property

```go
func FuzzHash(f *testing.F) {
    f.Add([]byte("seed"))
    f.Fuzz(func(t *testing.T, data []byte) {
        h := hash(data)
        if h == 0 {
            t.Fatal("zero hash")
        }
    })
}
```

Bug: `hash([]byte{})` legitimately returns 0 for several real-world
hash functions. FNV initial state for an empty input is non-zero, but
trivial custom hashes start at zero. The fuzzer will minimize down to
the empty slice in seconds, reporting "zero hash" as a finding.

This is a spec problem, not a fuzz bug — but reviewers should ask
whether 0 is actually disallowed before merging. If the spec is
"non-empty input must have non-zero hash", gate it:

```go
if len(data) == 0 {
    t.Skip()
}
```

If 0 is genuinely a bug for any input, the existing test is correct
and the implementation must change.

## Snippet 5 — The disk-reading seed loader

```go
func FuzzAddSeed(f *testing.F) {
    seeds := loadFromDisk("seeds.txt")
    for _, s := range seeds {
        f.Add(s)
    }
    f.Fuzz(func(t *testing.T, s string) {
        _ = validate(s)
    })
}
```

Bug: `loadFromDisk` is called once per `go test` invocation when
fuzzing — that is fine. But when running normal `go test` (no `-fuzz`),
the seeds become subtests. If `loadFromDisk` panics on a missing file,
every test binary that imports this package fails to run, including
ones that have nothing to do with fuzzing.

Move file I/O inside an `if testing.Short() { return }` guard or under
a `sync.Once` that returns the empty slice on error. Better still —
commit the seeds to `testdata/fuzz/FuzzAddSeed/` and let the runtime
load them automatically. The on-disk corpus loader is robust to
missing or malformed files.

## Snippet 6 — The expensive setup inside the inner function

```go
func FuzzParser(f *testing.F) {
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, data []byte) {
        cfg, err := os.ReadFile("testdata/parser_config.json")
        if err != nil {
            t.Skip()
        }
        p := buildParser(cfg)
        _ = p.Parse(data)
    })
}
```

Bug: `os.ReadFile` and `buildParser` run on every iteration. Exec/s
drops from 50,000 to 500 because each call does disk I/O and rebuilds
state. The fuzz engine explores almost nothing in the allotted time.

Fix: move the setup outside the fuzz target.

```go
func FuzzParser(f *testing.F) {
    cfg, err := os.ReadFile("testdata/parser_config.json")
    if err != nil {
        f.Fatal(err)
    }
    p := buildParser(cfg)
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, data []byte) {
        _ = p.Parse(data)
    })
}
```

This works if `p.Parse` does not mutate `p`'s state. If it does, you
need a `Reset` method or per-iteration construction with a `sync.Pool`
to amortize allocations.

## Snippet 7 — The unreproducible concurrency bug

```go
func FuzzCache(f *testing.F) {
    f.Add("key", "value")
    f.Fuzz(func(t *testing.T, k, v string) {
        c := getGlobalCache()
        c.Set(k, v)
        got, _ := c.Get(k)
        if got != v {
            t.Fatalf("cache lost value")
        }
    })
}
```

Bug: `getGlobalCache()` returns a shared singleton. Workers run the
target concurrently. Worker A sets `(k, "v1")`, worker B sets
`(k, "v2")` between A's set and get, A reads "v2" and fails.

The bug is a real concurrency issue in the cache — the fuzzer found a
genuine bug! But the failure is not deterministic. Re-running
`go test -run=FuzzCache/<hash>` is single-worker and reproduces with
the saved input, masking the concurrency hazard.

Two fixes:

1. Construct a fresh cache inside the target: `c := newCache()`. Each
   worker has its own state.
2. Run with `-race` to surface the data race directly.

The lesson: fuzz targets must not depend on global mutable state.

## Snippet 8 — The size limit that hides the bug

```go
func FuzzParser(f *testing.F) {
    f.Add([]byte("ok"))
    f.Fuzz(func(t *testing.T, data []byte) {
        if len(data) > 8 {
            t.Skip()
        }
        _ = Parse(data)
    })
}
```

Bug: the size cap is too aggressive. Real production inputs are
hundreds of bytes; the fuzz target only ever sees inputs of 8
bytes or less. Bugs that require longer inputs to surface are
invisible to this target.

Fix: raise the cap to a realistic upper bound for production
input sizes. A few kilobytes is usually fine.

Lesson: size caps are performance optimizations, not coverage
filters. Use them sparingly and verify they do not exclude the
inputs you care about.

## Snippet 9 — The unfair differential

```go
func FuzzAtoi(f *testing.F) {
    f.Add("0")
    f.Fuzz(func(t *testing.T, s string) {
        mine, myErr := myAtoi(s)
        ref, refErr := strconv.Atoi(strings.TrimSpace(s))
        if (myErr == nil) != (refErr == nil) {
            t.Fatalf("error mismatch")
        }
        if myErr == nil && mine != ref {
            t.Fatalf("value mismatch")
        }
    })
}
```

Bug: the reference call has `strings.TrimSpace` applied, but the
hand-rolled `myAtoi` is called on the raw string. Any input with
leading whitespace makes the two implementations disagree on
acceptance criteria — but it is the test that is wrong, not the
implementations.

Fix: apply the same transformations to both sides, or to neither.
Differential tests must compare apples to apples.

## Snippet 10 — The recover that hides bugs

```go
func FuzzParseSafe(f *testing.F) {
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, data []byte) {
        defer func() {
            if r := recover(); r != nil {
                // swallow panics so we never fail
            }
        }()
        _ = ParseUnsafe(data)
    })
}
```

Bug: `recover()` is silently swallowing every panic. The fuzz
target never fails. The engine reports no findings — even though
`ParseUnsafe` is panicking on many inputs.

The intention here was probably "do not fail; just see what
happens". But fuzz testing is about detecting bugs; suppressing
panics defeats the purpose.

Fix: remove the recover. If the goal is to allow specific known
panics, narrow the recover to only those:

```go
defer func() {
    if r := recover(); r != nil {
        msg := fmt.Sprint(r)
        if !strings.Contains(msg, "known-acceptable-pattern") {
            panic(r)
        }
    }
}()
```

## Reviewer's checklist

When reviewing a fuzz target PR, walk through these:

1. Are all fuzz parameter types in the supported list (basic types only)?
2. Does the invariant hold for every accepted input, or only canonical
   ones?
3. Are there expensive operations inside `f.Fuzz`? Move them out.
4. Are seeds committed to `testdata/fuzz/...` rather than read from
   disk at startup?
5. Does `t.Skip` rule out genuinely invalid inputs that you do not want
   the engine to chase?
6. Does the target touch global mutable state? If so, fix it.
7. Is there a way to express the property more strongly? "Does not
   panic" is a fine starting point but encoder/decoder round-trip or
   differential agreement is stronger.

If all seven pass, the target is ready to ship.
