---
layout: default
title: Fuzzing — Middle
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/02-middle/
---

# Fuzzing — Middle

[← Back](../)

This page assumes you have written and run your first fuzz target. Now we
look at the machinery underneath. How does the engine generate mutations?
Where does coverage feedback come from? How do you write fuzz tests that
are still useful after the trivial bugs are gone? What does the corpus
directory layout look like in practice?

## The two-process architecture

`go test -fuzz` is not a single process. The runtime spawns a
coordinator and several worker processes. This is documented in
`src/internal/fuzz/coordinator.go`.

The coordinator's responsibilities:

- Load the seed corpus and the cached generated corpus.
- Distribute corpus entries to workers.
- Receive new "interesting" entries from workers and add them to
  the shared corpus.
- On failure, receive the failing input from the worker and run
  minimization.
- Track elapsed time and stop at `-fuzztime`.

Each worker's responsibilities:

- Receive a parent corpus entry from the coordinator.
- Mutate it.
- Run the fuzz target.
- Send back coverage data and any new entries.
- On failure, send the failing input back for minimization.

Communication is via a private RPC protocol over a pipe. The reason
for separate processes is fault isolation — a panic in the fuzz
target kills only the worker, not the coordinator. The coordinator
restarts the worker and continues.

This means: if your fuzz target leaks memory or exhausts file
descriptors, the worker process leaks them. Eventually the worker
dies and is restarted. You see this in the live output as a brief
hiccup but the engine recovers automatically.

For most users this is invisible. It matters when you debug fuzz
issues: setting a breakpoint in your fuzz target requires attaching
to the worker process, not the coordinator. Use `dlv attach <pid>`
after finding the worker PID.

## How `go test -fuzz` works internally

At a high level, `go test -fuzz=FuzzXxx` does the following:

1. Compiles your test binary with coverage instrumentation enabled. The
   `-cover` instrumentation injects bookkeeping calls at every branch
   so the runtime can observe which edges of the control-flow graph
   each input exercised.
2. Loads the seed corpus from `f.Add` calls and from the on-disk
   directories. Each seed is executed once to establish baseline
   coverage. If any seed fails, fuzzing aborts and reports the failing
   seed.
3. Spawns workers (by default `GOMAXPROCS` of them). Each worker holds a
   local copy of the corpus.
4. In a tight loop, each worker picks an existing corpus entry, applies
   a randomized mutation, runs the fuzz target, and looks at the
   coverage bitmap produced by the run. If the bitmap differs from
   everything seen so far, the new input is added to the corpus and to
   `$GOCACHE/fuzz/<modpath>/FuzzXxx/`.
5. On a panic or `t.Fail`, the engine minimizes the input (tries
   smaller variants that still fail), then writes the minimal input to
   `testdata/fuzz/FuzzXxx/<sha>` and prints the reproducer command.
6. When `-fuzztime` elapses, all workers stop and the process exits.

Two things to internalize from this list. First, fuzzing requires the
test binary to be rebuilt with coverage instrumentation, so the first run
after a clean checkout takes longer. Second, the engine is greedy on
"new coverage". An input that triggers a new branch is kept forever; an
input that triggers the same branches as some existing seed is
discarded. This is what stops the corpus from growing without bound.

## Mutation strategies

The exact set of mutations is an implementation detail, but the godoc
and source for `internal/fuzz/mutator.go` describe the families:

- Bit flips on bytes within the input.
- Insertion of magic constants (`0`, `1`, `-1`, `INT_MAX`, common
  protocol header bytes).
- Copying or moving spans of bytes between corpus entries.
- Truncating and growing the input.
- Type-aware mutations on integer parameters (increment, decrement,
  flip-sign, set to boundary values).

For a string parameter, the engine treats the underlying bytes as
mutation territory. UTF-8 validity is not preserved by the mutator —
that is why so many string-fuzz targets quickly find code paths that
choke on invalid UTF-8.

For a `[]byte` parameter, the mutator can also do byte-level
splice-and-stitch between corpus entries. This is the "crossover"
operation borrowed from evolutionary algorithms; it lets the engine
combine two interesting inputs into a third.

You cannot configure the mutator. If you need custom mutations (for
example, you are fuzzing a binary format with checksums), you have to
either: (a) accept the lower exploration efficiency, (b) recompute
checksums inside the fuzz target so the engine does not have to learn
them, or (c) switch to a tool like `go-fuzz` which supports custom
mutators.

## A note on instrumentation overhead

Coverage instrumentation slows the test binary. Typical overhead is
2-5x compared to uninstrumented code. The slowdown is invisible
to ordinary `go test` (which does not build with coverage by
default) but appears as soon as you add `-fuzz`.

This is why a function that benchmarks at 100 ns/op might run at
roughly 300-500 ns/op inside the fuzz target. The engine knows
about this overhead and the exec/s numbers it reports already
account for it.

In practice, the absolute slowdown matters less than the
relative throughput. A target running at 100,000 exec/s with
instrumentation is fine. A target running at 100 exec/s is not,
regardless of instrumentation overhead — that target is dominated by
your code, not by coverage tracking.

## Seed corpus management

There are two ways to register a seed:

- `f.Add(values...)` in the fuzz function body. The seed is in source
  code; it travels with the test file and is reviewed like any other
  code.
- Files in `testdata/fuzz/FuzzXxx/`. Each file is parsed as a
  Go-syntax literal vector matching the fuzz target signature.

In practice, hand-curated seeds go in `f.Add` for documentation: they
read like examples. Auto-saved failures and large corpus entries go in
`testdata/fuzz/FuzzXxx/` because committing them as Go literals would
clutter the source file.

A typical real-world layout for a JSON parser fuzz test:

```
parser/
  parser.go
  parser_test.go
  testdata/
    fuzz/
      FuzzParseJSON/
        0a1b2c3d...   <- minimized crasher from CI
        valid-empty   <- hand-named valid input
        valid-nested  <- hand-named valid input
```

You can mix hand-named files and hash-named files. The runtime treats
every file in the directory as a seed.

## When `f.Add` types must match exactly

A subtle rule: the types you pass to `f.Add` must match the fuzz target
parameter types exactly. The runtime does no implicit conversion.

```go
func FuzzWidget(f *testing.F) {
    f.Add(42)                              // int
    f.Add(int64(42))                       // int64
    f.Fuzz(func(t *testing.T, n int64) {   // expects int64
        // ...
    })
}
```

The first `f.Add(42)` here would have caused a runtime error at startup:
"seed entry got type int, want int64". The runtime prints a friendly
message and the process exits before any fuzzing happens.

The error catches you early, but it is annoying when you copy seeds
from another target with a different signature. Get into the habit of
writing `int64(x)`, `[]byte("...")` explicitly even when the type is
inferred.

## Sharing seed corpora between developers

When you find a bug locally and commit the saved input, every other
developer's `go test` now runs that input as a regression test.
Good. But there are a few gotchas.

First, the `testdata/fuzz/` files are byte-exact. A small editor
auto-format that adds a trailing newline can prevent the runtime
from parsing the file. Use `.gitattributes` to disable text
normalization for the directory:

```
testdata/fuzz/** -text
```

Second, the hash filenames are SHA-256 prefixes. They are stable
across machines (deterministic given the file content) but they
collide rarely. If two developers find different inputs whose
hashes share the prefix, one will silently overwrite the other on
commit. The probability is small but non-zero; rename important
findings to meaningful names.

Third, the cached generated corpus at `$GOCACHE/fuzz/` is not
shared. Each developer accumulates their own discovered inputs.
This is intentional — the cache is a private exploration history,
not a shared artifact. If you want to share discovered inputs,
copy them to `testdata/fuzz/` first.

## Property design: keep targets focused

A fuzz target is most useful when it tests one property in one
function. A target that tries to assert three properties at once is
harder to debug: which property failed? Which input? Was the failure
in the first property, before the second one even ran?

Bad:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    v, err := Parse(data)
    if err != nil {
        return
    }
    if Encode(v) == nil {
        t.Fatal("encode nil")
    }
    if Validate(v) != nil {
        t.Fatal("validate failed")
    }
    if len(Encode(v)) > 2*len(data) {
        t.Fatal("encode too large")
    }
})
```

Better — three separate fuzz functions, one per property. They share the
same seed corpus but exercise distinct invariants. When one fails, you
know which invariant broke without reading the code.

## When to write multiple fuzz functions for one package

If a package has several public entry points that take untrusted
input, write one fuzz function per entry point. They share a package
but exercise different code paths.

Example: a key-value store has `Set(key, value []byte)`,
`Get(key []byte) ([]byte, error)`, and `Delete(key []byte) error`.
Three fuzz functions:

```go
func FuzzStoreSet(f *testing.F) { /* ... */ }
func FuzzStoreGet(f *testing.F) { /* ... */ }
func FuzzStoreDelete(f *testing.F) { /* ... */ }
```

Each fuzz function focuses on one entry point. Failures are easy to
attribute. The fuzz engine runs one of them at a time under `-fuzz`,
so they do not interfere with each other.

A fourth fuzz function can exercise sequences:

```go
func FuzzStoreSequence(f *testing.F) {
    f.Add([]byte{0x01, 0x01, 'a', 0x01, 'x'})
    f.Fuzz(func(t *testing.T, data []byte) {
        s := NewStore()
        i := 0
        for i < len(data) {
            // decode operation, key, value from data and apply to s
            // ...
        }
    })
}
```

This is the "stateful fuzz" pattern. It explores combinations of
operations rather than single calls. More powerful but harder to
debug when a failure occurs.

## Round-trip targets

Round-trip targets are the workhorse of fuzz testing. The pattern:

```go
f.Fuzz(func(t *testing.T, in T) {
    bytes, err := Encode(in)
    if err != nil {
        return
    }
    out, err := Decode(bytes)
    if err != nil {
        t.Fatalf("decode after encode failed: %v", err)
    }
    if !reflect.DeepEqual(in, out) {
        t.Fatalf("round trip changed value: %+v -> %+v", in, out)
    }
})
```

This is a strong property: every value the encoder accepts must decode
back to itself. It catches subtle bugs in number formatting, escaping,
and floating-point precision.

A weaker but still useful variant is encoder-decoder symmetry: if the
encoder produces bytes that the decoder rejects, you have an asymmetric
contract. Fuzz that:

```go
f.Fuzz(func(t *testing.T, in T) {
    bytes, err := Encode(in)
    if err != nil {
        return
    }
    if _, derr := Decode(bytes); derr != nil {
        t.Fatalf("encoder produced bytes that decoder rejected: %v", derr)
    }
})
```

## Idempotence targets

Some functions should be idempotent: calling them twice in a row is
the same as calling them once. Example: a canonicalization function.

```go
func FuzzCanonicalize(f *testing.F) {
    f.Add("hello")
    f.Fuzz(func(t *testing.T, s string) {
        once := Canonicalize(s)
        twice := Canonicalize(once)
        if once != twice {
            t.Fatalf("not idempotent: %q -> %q -> %q", s, once, twice)
        }
    })
}
```

The property is strong: `Canonicalize(Canonicalize(x)) ==
Canonicalize(x)` for all `x`. Any input that violates this is a
bug in the canonicalization rule. Common cases that violate this
in real code: case folding that depends on locale, normalization
forms that disagree on combining characters, trim functions that
miss certain whitespace classes.

## Symmetry targets

Some functions should be symmetric: `f(a, b) == f(b, a)`. Example:
distance calculations, set merging.

```go
func FuzzMergeSymmetric(f *testing.F) {
    f.Add([]byte("aaa"), []byte("bbb"))
    f.Fuzz(func(t *testing.T, a, b []byte) {
        ab := Merge(a, b)
        ba := Merge(b, a)
        if !bytes.Equal(ab, ba) {
            t.Fatalf("merge not commutative: %v != %v", ab, ba)
        }
    })
}
```

If `Merge` is supposed to be order-independent, the property is a
clean spec for the engine to verify.

## Comparing parse-then-format vs format-then-parse

There are two natural round-trip directions for any
parser/encoder pair, and they have different bug-finding power.

**Format-then-parse**: take a typed value, format it to bytes,
parse the bytes back, compare. This catches:

- Encoder bugs that produce invalid output.
- Decoder bugs that reject canonical encoder output.
- Floating-point precision loss across the round trip.

```go
f.Fuzz(func(t *testing.T, n int64) {
    s := strconv.FormatInt(n, 10)
    parsed, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        t.Fatalf("parse failed on encoder output %q: %v", s, err)
    }
    if parsed != n {
        t.Fatalf("round trip changed value: %d -> %d", n, parsed)
    }
})
```

**Parse-then-format**: take bytes, parse to typed value, format back,
compare to original bytes. This catches:

- Parser leniency (accepting non-canonical inputs).
- Encoder canonicalization that changes representation.

```go
f.Fuzz(func(t *testing.T, s string) {
    n, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        return
    }
    reformatted := strconv.FormatInt(n, 10)
    if reformatted != s {
        // not a bug — parser accepted "01" and formatter produced "1"
    }
})
```

Format-then-parse is usually the stronger property because the
typed value space is smaller and more well-defined than the byte
space. Most production fuzz targets use this direction.

Parse-then-format is useful only when the encoder is supposed to be
the inverse of the parser on canonical inputs. If your spec
explicitly allows multiple input forms, parse-then-format will
report false positives.

## Differential targets

If you have two implementations of the same function — your hand-rolled
one and a reference — you can fuzz them against each other:

```go
f.Fuzz(func(t *testing.T, s string) {
    mine, myErr := myParseInt(s)
    ref, refErr := strconv.Atoi(s)
    if (myErr == nil) != (refErr == nil) {
        t.Fatalf("error disagreement on %q: mine=%v ref=%v", s, myErr, refErr)
    }
    if myErr == nil && mine != ref {
        t.Fatalf("value disagreement on %q: mine=%d ref=%d", s, mine, ref)
    }
})
```

The fuzzer will hunt for inputs where the two implementations diverge.
This finds bugs without requiring you to specify what "correct" means;
agreement with the reference is the spec.

A real-world example: when the Go team replaced the math/big internal
multiplication algorithm, they fuzz-differentiated the new code against
the old one for hours. Any disagreement was a bug.

## Fuzzing pure functions vs side-effecting functions

Native fuzzing is most effective on pure functions — those that
take input and return output with no side effects. The reason: the
target is replayed many times per second, often by parallel workers.
Side effects (writing files, touching databases, mutating globals)
either slow the engine to a crawl or cause cross-iteration
interference.

When you need to fuzz a side-effecting function, isolate its
side-effecting parts behind an interface, then fuzz the pure core:

```go
// Side-effecting wrapper.
func (s *Service) Handle(req []byte) error {
    parsed, err := parseRequest(req)
    if err != nil {
        return err
    }
    return s.db.Apply(parsed)
}

// Pure core to fuzz.
func parseRequest(req []byte) (parsedRequest, error) {
    // ... no I/O, no globals, no goroutines
}

func FuzzParseRequest(f *testing.F) {
    f.Add([]byte("typical-request"))
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = parseRequest(data)
    })
}
```

The parser is the high-bug-density component. The database
interaction is integration-test territory. Fuzzing the parser
finds the bugs that matter without paying the cost of
side-effect simulation.

## Edge cases the engine reliably finds

Native fuzzing has biases. The mutator inserts "magic constants" —
values like 0, 1, -1, MaxInt, MinInt, common Unicode boundary
characters, and certain protocol bytes. As a result, fuzz tests
reliably surface bugs at these inputs:

- Empty input. The mutator quickly tries `[]byte{}` and `""`.
- Single-byte input. Many parsers have off-by-one bugs at the
  boundary between "empty" and "one byte".
- Inputs with NUL bytes. C-style string handling that does not
  account for embedded NULs.
- Integer boundary values. `math.MaxInt64`, `0`, `-1`.
- Floating-point special values. `NaN`, `+Inf`, `-Inf`, denormals.
- UTF-8 boundary characters. Surrogate halves, BOM, the replacement
  character, characters at codepoint boundaries.
- Very long inputs. The mutator will eventually try kilobyte-sized
  inputs even if the seeds are short.

Knowing the engine's biases helps you predict which bugs it will
find quickly versus which might take long fuzz runs. If your code
has an obvious bug at one of the listed cases, fuzz will find it in
seconds.

## Edge cases the engine struggles with

Conversely, some inputs are hard for byte-level mutation to find:

- Inputs with strong internal structure (checksums, signatures,
  length-encoded fields). The engine mutates bytes randomly; a
  one-byte change usually invalidates the checksum and the parser
  rejects the input early.
- Inputs that require multiple correlated bytes to change together
  (a length field plus the payload it describes).
- Inputs near the boundary of an obscure data type (e.g. a specific
  IEEE 754 subnormal pattern).

For these, two techniques help:

1. Provide rich seeds. A handful of valid examples with the right
   structure lets the engine mutate around them.
2. Recompute the structural fields inside the target. If your input
   format has a checksum, compute the checksum inside `f.Fuzz` so
   the engine does not have to learn the checksum function. The
   engine then explores the parser without wasting time on
   guess-the-checksum.

## Limiting input size

Most parsers slow down with input size. A fuzz target that runs at
50 exec/s instead of 50,000 exec/s explores very little. Constraints:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if len(data) > 4096 {
        t.Skip()
    }
    _, _ = Parse(data)
})
```

`t.Skip` tells the engine that the input was not interesting. The
engine will not save it to the corpus, will not count it against
coverage, and will move on. This is the right primitive for "I do not
want to explore inputs this large".

Be careful not to skip too aggressively — if you skip everything
non-trivial, the engine has no inputs to mutate and effectively does
nothing. Tune the threshold based on the exec/s you observe.

## Skipping rules: what is and is not a bug

`t.Skip` tells the engine the input is uninteresting. The engine
does not count it as a failure but also does not promote it to the
corpus.

Use `t.Skip` for:

- Inputs that fail a precondition. (A parser that only accepts
  positive lengths can skip negative-length inputs from the engine.)
- Inputs that exceed size limits. (A 1 MB random input is unlikely
  to reveal bugs that a 1 KB one does not.)
- Inputs that explicitly do not match the spec. (UTF-8-only code
  path: skip non-UTF-8 inputs.)

Do *not* use `t.Skip` for:

- Inputs that crash. (`t.Skip` after `recover` is hiding a bug.)
- Inputs that produce wrong output. (Skip is for "not interesting",
  not "interesting but I do not want to fail right now".)
- Inputs that are slow. (If you want to bound execution time, use
  a watchdog goroutine or restructure the target.)

A common error: skipping too eagerly. A target that skips every
input with `len(data) > 64` will limit the engine to small inputs.
That is fine if your parser only operates on small inputs by spec.
It is wrong if you want exhaustive coverage of size-dependent
branches.

## Reading the live progress output

```
fuzz: elapsed: 30s, execs: 1234567 (41155/sec), new interesting: 0 (total: 87)
```

Each field:

- `elapsed` — wall time since fuzzing started.
- `execs` — total executions of the fuzz target across all workers.
- `(N/sec)` — average exec rate over the last reporting interval.
- `new interesting` — coverage-expanding inputs found in the last
  interval.
- `total` — total corpus size including seeds and discovered entries.

If `new interesting` stays at 0 for many minutes and the `total` is
small, the engine has saturated. Either the code under test has a small
state space (good), or the mutator cannot find inputs that hit deeper
paths (bad). The remedy in the second case is to add richer seeds.

If exec/s is very low (say under 1000), the fuzz target itself is too
slow. Profile it.

## Reading the failure trace

A panic-style failure trace from fuzzing looks like:

```
--- FAIL: FuzzParse (0.21s)
    --- FAIL: FuzzParse/a1b2c3d4e5
        --- FAIL: FuzzParse/a1b2c3d4e5
        panic: runtime error: index out of range [3] with length 2
        goroutine 7 [running]:
        runtime/debug.Stack()
            /usr/local/go/src/runtime/debug/stack.go:24 +0x65
        ...
        mypkg.parseHeader({0xc000010100, 0x2, 0x2})
            /repo/parser.go:42 +0x21d
        ...
```

Read it bottom-up: the bottom of the stack is the entry point
(the fuzz target), the top is where the panic happened. The frame
`mypkg.parseHeader` with the byte slice argument is the function
that crashed and the input bytes are visible in the slice arg.

For multi-line panics, the runtime prefixes everything with the
test name so the failure remains attributable when running many
fuzz targets in parallel.

## Memory profile a fuzz run

Allocations inside the fuzz target eat CPU and pressure the
garbage collector. Profile the heap:

```bash
go test -fuzz=FuzzParse -fuzztime=30s -memprofile mem.out
go tool pprof -alloc_objects -web mem.out
```

The `-alloc_objects` flag shows allocation counts rather than live
bytes. For fuzz targets you usually care about per-iteration
allocations, so this is the right view.

Common offenders:

- `[]byte` to `string` conversions inside the target.
- `fmt.Sprintf` for diagnostic messages.
- Slice growth without `make` preallocation.
- Goroutine spawn inside the target.

Each is a few-line fix; together they can move exec/s from 800/sec
to 50,000/sec on real targets.

## What happens when the fuzz target panics

A panic inside the fuzz target is captured by the runtime. The
worker reports the panic to the coordinator, the coordinator
performs minimization, and the test reports a failure. The panic
stack trace is included in the failure message.

If your code recovers from a panic internally, the runtime does not
see it. This is occasionally what you want — for example, if you
explicitly expect that some inputs trigger panics in third-party
libraries and you want to skip those:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    defer func() {
        if r := recover(); r != nil {
            if strings.Contains(fmt.Sprint(r), "known-broken-pattern") {
                t.Skip()
            }
            panic(r)
        }
    }()
    _ = thirdPartyParser(data)
})
```

This pattern is fragile and should be a temporary measure while
you wait for the upstream fix. Long-term, file the issue and
remove the recover when the fix lands.

## A note about determinism

The mutation engine is seeded by `time.Now()` at startup, so two
`-fuzz` runs of the same target rarely follow the same path through
the mutation space. This is usually a good thing — different runs
explore different inputs.

If you want a reproducible run for debugging, the engine accepts no
seed flag. The closest workaround is to use `-fuzztime=Nx` (count
form) instead of duration form. With a fixed count, the iteration
count is bounded but the inputs explored still vary.

For full reproducibility, save the corpus you want to replay and run
it under plain `go test` (no `-fuzz`). The corpus runs deterministically
in alphabetical order.

## CPU profile a fuzz run

The same flags that work for benchmarks work here:

```bash
go test -fuzz=FuzzParse -fuzztime=30s -cpuprofile cpu.out
go tool pprof -web cpu.out
```

The flame graph shows where the engine is spending wall time. Usually
the fuzz target body dominates — if anything *outside* it shows up at
the top, that is a clear win for moving setup out of the inner function.

## Type coercion and integer fuzzing

When the fuzz target takes integer parameters, the engine has more
freedom in mutation. Each integer parameter is independently mutated,
not packed into the byte input.

```go
f.Fuzz(func(t *testing.T, base int, exponent uint8) {
    if exponent == 0 {
        t.Skip()
    }
    _ = power(base, exponent)
})
```

The engine will independently try interesting values for `base`
(zero, MaxInt, MinInt, -1, +1) and for `exponent` (zero, max,
boundary values). Combining them, it explores `power(MaxInt, 255)`,
which overflows silently — a finding if you assert overflow detection.

Compare with a byte-only target where you would have to manually
slice the input:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if len(data) < 9 {
        t.Skip()
    }
    base := int(binary.LittleEndian.Uint64(data[:8]))
    exponent := uint8(data[8])
    _ = power(base, exponent)
})
```

This works but the engine has to learn the 9-byte structure through
coverage. Direct integer parameters let it explore numeric space more
efficiently.

For float parameters, the engine mutates toward special values: NaN,
±Inf, denormals, zeros of both signs, very small and very large
magnitudes. Useful when fuzzing numerical code.

## Fuzz functions with no `f.Add` calls

Strictly speaking, `f.Add` is not required. A fuzz function can omit
seeds entirely:

```go
func FuzzParse(f *testing.F) {
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = Parse(data)
    })
}
```

This works but the engine starts with zero coverage. It begins by
calling the target with an empty input and proceeds by mutation
from there. It eventually finds interesting inputs, but slower than
with seeds.

For new fuzz functions on previously un-fuzzed code, always
register at least one representative valid input. A single
non-trivial seed dramatically accelerates the first hour of fuzzing.

## A real example: fuzzing `encoding/json`

To see what fuzzing in real-world stdlib looks like, the Go team
ships fuzz tests for `encoding/json`. Simplified version:

```go
func FuzzUnmarshalJSON(f *testing.F) {
    f.Add([]byte(`{"a":1}`))
    f.Add([]byte(`null`))
    f.Add([]byte(`[]`))
    f.Fuzz(func(t *testing.T, data []byte) {
        var v any
        if err := json.Unmarshal(data, &v); err != nil {
            return
        }
        out, err := json.Marshal(v)
        if err != nil {
            t.Fatalf("re-marshal failed: %v", err)
        }
        var v2 any
        if err := json.Unmarshal(out, &v2); err != nil {
            t.Fatalf("re-parse failed: %v", err)
        }
        if !reflect.DeepEqual(v, v2) {
            t.Fatalf("round trip mismatch")
        }
    })
}
```

This is parse-then-marshal-then-parse, using `any` as the
intermediate type. The standard library has run this kind of fuzz
target on the stdlib JSON package and found multiple CVEs. The
property is strong: any JSON the parser accepts should marshal back
to JSON that the parser accepts and produces the same in-memory
value.

You can run this against the standard library yourself. Create a
test file in your own module:

```go
package mypkg_test

import (
    "encoding/json"
    "reflect"
    "testing"
)

func FuzzStdlibJSON(f *testing.F) {
    f.Add([]byte(`{"key":"value"}`))
    f.Fuzz(func(t *testing.T, data []byte) {
        var v any
        if err := json.Unmarshal(data, &v); err != nil {
            return
        }
        out, err := json.Marshal(v)
        if err != nil {
            t.Fatalf("marshal: %v", err)
        }
        var v2 any
        if err := json.Unmarshal(out, &v2); err != nil {
            t.Fatalf("re-parse: %v", err)
        }
        if !reflect.DeepEqual(v, v2) {
            t.Fatalf("mismatch: %v vs %v", v, v2)
        }
    })
}
```

Run for a minute. With modern Go versions, you should find nothing —
the stdlib is well-fuzzed. But the exercise of running fuzz against
a known-good target is useful to calibrate your expectations of
exec/s and corpus growth.

## Using sub-tests inside the fuzz target

The inner function receives `*testing.T` and can call `t.Run` to
create sub-tests. This is occasionally useful for grouping
assertions:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    parsed, err := Parse(data)
    if err != nil {
        return
    }
    t.Run("encoder", func(t *testing.T) {
        if Encode(parsed) == nil {
            t.Fatal("encode returned nil")
        }
    })
    t.Run("validate", func(t *testing.T) {
        if err := Validate(parsed); err != nil {
            t.Fatalf("validate failed: %v", err)
        }
    })
})
```

When a sub-test fails, the failure name includes the sub-test path:
`FuzzXxx/<hash>/encoder`. This makes triage slightly easier because
you know which assertion failed without reading line numbers.

The cost: `t.Run` adds a small per-call overhead. For very fast fuzz
targets this can drop exec/s noticeably. Use sub-tests only when the
grouping benefit outweighs the throughput cost.

## Practical session: adding fuzz coverage to an HTTP handler

Suppose you have:

```go
func HandleConfig(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    cfg, err := parseConfig(body)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    json.NewEncoder(w).Encode(cfg)
}
```

You want to fuzz `parseConfig`. Two layers:

```go
func FuzzParseConfig_NoPanic(f *testing.F) {
    f.Add([]byte(`{"name":"x"}`))
    f.Add([]byte(``))
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = parseConfig(data)
    })
}

func FuzzParseConfig_RoundTrip(f *testing.F) {
    f.Add([]byte(`{"name":"x","port":80}`))
    f.Fuzz(func(t *testing.T, data []byte) {
        cfg, err := parseConfig(data)
        if err != nil {
            return
        }
        re, err := json.Marshal(cfg)
        if err != nil {
            t.Fatalf("marshal failed: %v", err)
        }
        cfg2, err := parseConfig(re)
        if err != nil {
            t.Fatalf("re-parse after marshal failed: %v", err)
        }
        if !reflect.DeepEqual(cfg, cfg2) {
            t.Fatalf("round trip mismatch: %+v -> %+v", cfg, cfg2)
        }
    })
}
```

Run each for a minute. Both find bugs in untested branches you did not
think to write unit tests for.

## The "go test fuzz v1" file format in depth

Each file in `testdata/fuzz/FuzzXxx/` has the same structure. Worth
understanding because you will sometimes need to hand-craft corpus
entries or debug parsing errors.

First line: `go test fuzz v1`. This is the format version. The
runtime rejects files with a different header.

Subsequent lines: one Go-syntax literal per fuzz target parameter
(excluding the leading `*testing.T`). Whitespace between literals
is ignored. Comments are not allowed.

Supported literal forms:

```
[]byte("hello\x00world")
string("any \"escaped\" string")
int(-42)
int64(0x7fffffffffffffff)
uint8(255)
bool(true)
float32(3.14)
float64(1e308)
```

Bytes can be specified with escape sequences (`\x00`, `\n`, `\t`)
or with Go's raw string syntax (using backticks). The parser is the
same Go literal parser the compiler uses, so anything that compiles
as a literal is accepted.

A common mistake is to omit the type prefix:

```
go test fuzz v1
"hello"          <- BAD, missing string() wrapper
42               <- BAD, missing int() wrapper
```

The runtime requires the type wrapper because Go literals are
otherwise ambiguous (`42` could be `int`, `int8`, `int16`, etc.).

If a file fails to parse, the runtime logs a warning and skips it.
Other files in the directory continue to load normally.

## When two fuzz tests share a corpus

You may have two fuzz functions that take the same parameter
signature. Can they share seeds?

```go
func FuzzParseV1(f *testing.F) {
    f.Fuzz(func(t *testing.T, data []byte) { /* ... */ })
}

func FuzzParseV2(f *testing.F) {
    f.Fuzz(func(t *testing.T, data []byte) { /* ... */ })
}
```

The corpus directories are independent: `testdata/fuzz/FuzzParseV1/`
and `testdata/fuzz/FuzzParseV2/`. The runtime does not share files
between them.

If you really want to share, copy or symlink files. Most projects
just commit duplicates. Disk space is cheap; clarity is not.

A more useful pattern is to extract the seed-generation logic into a
helper that both fuzz functions call:

```go
func addCommonSeeds(f *testing.F) {
    f.Add([]byte("typical"))
    f.Add([]byte(""))
    f.Add([]byte{0x00, 0xff})
}

func FuzzParseV1(f *testing.F) {
    addCommonSeeds(f)
    f.Fuzz(/* ... */)
}

func FuzzParseV2(f *testing.F) {
    addCommonSeeds(f)
    f.Fuzz(/* ... */)
}
```

This keeps the seeds in source code and makes them obvious.

## When the input is structured: helper decoders

Native fuzzing's basic-types limitation often pushes you to decode a
`[]byte` input into a richer structure inside the target. A pattern:

```go
type fuzzInput struct {
    Op     uint8
    Key    []byte
    Value  []byte
}

func decodeFuzzInput(data []byte) (fuzzInput, bool) {
    if len(data) < 1 {
        return fuzzInput{}, false
    }
    op := data[0]
    rest := data[1:]
    // ... pull length-prefixed key and value
    return fuzzInput{Op: op, Key: key, Value: value}, true
}

func FuzzStore(f *testing.F) {
    f.Add([]byte{0x01, 0x03, 'a', 'b', 'c', 0x01, 'x'})
    f.Fuzz(func(t *testing.T, data []byte) {
        in, ok := decodeFuzzInput(data)
        if !ok {
            t.Skip()
        }
        s := NewStore()
        switch in.Op {
        case 1:
            s.Set(in.Key, in.Value)
        case 2:
            _, _ = s.Get(in.Key)
        }
    })
}
```

You have effectively built a tiny domain-specific decoder for your
fuzz target. The engine still mutates bytes; your decoder
interprets them as operations on the store. This pattern is how
people fuzz stateful systems with native fuzzing, despite the
basic-types limitation.

The package `github.com/AdaLogics/go-fuzz-headers` provides a
generic decoder along these lines, including a `ConsumeFuzzer` API
that pulls typed values from a byte source one at a time. Worth
exploring if you find yourself writing many such decoders by hand.

## Multiple seeds per fuzz function — should there be a maximum?

The runtime imposes no limit on the number of `f.Add` calls.
Pragmatically, anything beyond about a hundred seeds in source code
starts to clutter the test file and slow startup. The threshold is
not strict but in practice:

- 1 to 5 seeds inline in `f.Add` is normal.
- 5 to 20 inline seeds is acceptable if they document edge cases.
- More than 20 inline seeds is a smell — move them to
  `testdata/fuzz/FuzzXxx/` as files.

Files in `testdata/fuzz/` scale better: the runtime reads them
lazily, you can have thousands of them, and they do not bloat the
source file. The trade-off is that hash-named files in a directory
are less discoverable than inline `f.Add` calls. So put the
illustrative seeds inline and the bulky-historical seeds on disk.

## Subtest visibility

When fuzz mode discovers a new failing input, it appears in the test
output as a subtest of the fuzz function:

```
--- FAIL: FuzzParse (0.21s)
    --- FAIL: FuzzParse/8a1c91d6c1...
```

The naming convention is `FuzzXxx/<file-hash>` for auto-saved
crashers. For hand-named files in `testdata/fuzz/FuzzXxx/`, the
subtest name is the file name verbatim.

You can address subtests with the `-run` flag:

```bash
go test -run=FuzzParse/8a1c91d6c1     # one specific crasher
go test -run=FuzzParse                # all subtests of this fuzz function
go test -run=FuzzParse/empty          # the hand-named "empty" seed
```

The slash-separated path mirrors the directory structure on disk
beneath `testdata/fuzz/`.

## Migration from go-fuzz

If you have an existing go-fuzz target like:

```go
func Fuzz(data []byte) int {
    if Parse(data) != nil {
        return 1
    }
    return 0
}
```

The native equivalent:

```go
func FuzzParse(f *testing.F) {
    f.Fuzz(func(t *testing.T, data []byte) {
        _ = Parse(data)
    })
}
```

The return value `int` from go-fuzz had three values: 1 (interesting,
prioritize), 0 (boring), -1 (skip). Native fuzzing has no equivalent
for "interesting" — the engine decides based on coverage. The "skip"
case maps to `t.Skip`. The "boring" case is the default (just return).

If the go-fuzz target had complex setup, it usually needs to move
into either the outer fuzz function or a once-only `init`.

If the target took a struct input via `go-fuzz-headers`, you have
two choices: decompose to basic types, or write a `decode` helper
that consumes the byte input. The Middle page's "helper decoders"
section covered this pattern.

## When the runtime saves a non-failure

Occasionally the cache directory at `$GOCACHE/fuzz/` grows by an
input that does not look like a failure. These are coverage-
expanding entries — inputs that hit a new code branch but did not
fail any assertion. They are kept as future mutation parents.

You will not see them in CI artifacts or in `testdata/fuzz/`. They
are local exploration history. Deleting `$GOCACHE/fuzz/` resets this
history with no loss of committed regression tests.

A user-visible consequence: a long fuzz run on a complex parser can
accumulate hundreds of MB of cached inputs. Run
`go clean -fuzzcache` periodically to reclaim the space, or set
`-fuzzcachedir=/tmp/fuzz-tmp` to direct the cache elsewhere.

## Migration from gofuzz

`google/gofuzz` is a generator library, not a fuzz engine. If your
existing test looks like:

```go
import fuzz "github.com/google/gofuzz"

func TestRoundTrip(t *testing.T) {
    f := fuzz.New()
    var x Widget
    for i := 0; i < 1000; i++ {
        f.Fuzz(&x)
        // assert round trip
    }
}
```

This is property-based testing without coverage feedback. Native
fuzzing is not a direct replacement because it cannot fuzz `Widget`
directly. Two options:

1. Keep the existing test as a property-based test. Add a separate
   native fuzz target for byte-input code paths.
2. Switch to `pgregory.net/rapid`, which is a more powerful
   property-based library with shrinking.

For codebases that use `gofuzz` heavily (Kubernetes is the canonical
example), the existing tests usually stay. Native fuzzing is a
complementary addition, not a replacement.

## Fuzzing a function with multiple return paths

Functions with branching error paths can be harder for fuzz to
explore than straight-line code. The coverage feedback helps but
the engine still needs inputs that exercise each branch.

Consider:

```go
func parseHeader(data []byte) (Header, error) {
    if len(data) < 4 {
        return Header{}, errTooShort
    }
    magic := binary.BigEndian.Uint32(data[:4])
    switch magic {
    case 0x4D5A0000:
        return parseWindowsHeader(data[4:])
    case 0x7F454C46:
        return parseELFHeader(data[4:])
    case 0xCAFEBABE:
        return parseMachOHeader(data[4:])
    default:
        return Header{}, errUnknownMagic
    }
}
```

A fuzz target that calls `parseHeader` will quickly find the
"too short" branch and the "unknown magic" branch — those require
no special bytes. The three valid magics require the engine to
guess specific 4-byte values, which is harder.

Two options:

1. Seed with valid magic prefixes:

```go
f.Add([]byte{0x4D, 0x5A, 0x00, 0x00})
f.Add([]byte{0x7F, 0x45, 0x4C, 0x46})
f.Add([]byte{0xCA, 0xFE, 0xBA, 0xBE})
```

The engine starts from these seeds and mutates the bytes *after*
the magic, exploring the three parseXXXHeader functions.

2. Have separate fuzz functions per branch:

```go
func FuzzWindowsHeader(f *testing.F) {
    f.Add([]byte{0x00})
    f.Fuzz(func(t *testing.T, data []byte) {
        full := append([]byte{0x4D, 0x5A, 0x00, 0x00}, data...)
        _, _ = parseHeader(full)
    })
}
```

The second approach is more deterministic. Each function exercises
one parser path. The downside is you have to write more code.

## What we covered

- The engine's coverage-guided mutation loop.
- The mutation strategies the runtime applies.
- Type-exactness rules for `f.Add`.
- Round-trip, differential, and no-panic property patterns.
- Size limits with `t.Skip`.
- Reading the live progress output and CPU profiling.
- A practical end-to-end example with two layered fuzz tests.

The Senior page will go deeper into corpus growth dynamics, integration
with property-based testing libraries, OSS-Fuzz, and the limitations
that push you to pre-1.18 fuzzers in certain scenarios.

## References

- testing package godoc — type `F`, methods `Add`, `Fuzz`, `Skip`.
- Go 1.18 release notes — fuzzing section.
- Proposal: cmd/go: add fuzz testing — golang/go#44551.
- Tutorial: Getting started with fuzzing — go.dev/doc/tutorial/fuzz.
