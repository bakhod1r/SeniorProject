---
layout: default
title: Fuzzing — Junior
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/junior/
---

# Fuzzing — Junior

[← Back](../)

This page is your first real contact with Go's native fuzz testing, added in
Go 1.18. By the end of it you should be able to write a `Fuzz` function, run
it with `go test -fuzz`, understand the output the toolchain produces, and
turn a discovered crash into a permanent regression test. The level of
abstraction is deliberately low: we walk slowly, explain each line of code,
and prefer concrete examples over generalities.

If you have never written a Go test before, stop here and read the unit
testing junior page first. Fuzzing assumes you are comfortable with
`*testing.T`, `t.Errorf`, `t.Fatal`, table-driven tests, subtests, and the
shape of `func TestXxx(t *testing.T)`. Fuzzing is a sibling concept; it lives
in the same package and the same file, and it shares almost all of the same
infrastructure.

## 1. What is fuzzing?

Fuzzing is a way of testing a function by feeding it large numbers of
randomly generated inputs and watching for any input that makes the function
crash, panic, time out, or produce a result that violates an invariant you
declared. The fuzzing engine is the part of the toolchain that generates
those inputs. You provide a small body of code that takes an input and
checks "is the behaviour still correct on this input?"; the engine
provides the inputs.

There are three closely related testing styles you will hear about in Go,
and it is worth being precise about how they differ.

**Table-driven tests** are deterministic. You write down a list of
`{input, expected}` pairs and a loop iterates through them. The inputs are
chosen by you, by hand. The strength is that they document the contract
of the function; the weakness is that you only ever test inputs you thought
to write down. Almost every bug a junior writes is hiding in an input the
junior did not think to write down.

**Property-based testing (PBT)** is the academic cousin of fuzzing. The
tester writes a property — an invariant that must hold for all inputs —
and a generator produces random inputs from a domain you describe. Tools
like `gopter` and `rapid` implement PBT for Go. The classic example is
`reverse(reverse(s)) == s` for any string `s`.

**Fuzzing** in Go is best understood as PBT with two extra superpowers:
the input generator is built into the toolchain (no third-party library),
and the engine is *coverage-guided*. That second part is the important
one. The engine instruments your code at compile time, runs each candidate
input, and asks "did this input cause new code paths to execute?" If yes,
the input is kept and mutated further; if no, it is mostly discarded. Over
seconds or minutes, the corpus of "interesting" inputs grows and starts
exercising deep, narrow code paths that random generation alone would
never reach.

The practical consequence is that fuzzing finds bugs that table-driven
tests cannot. A SQL parser that crashes on the string `SELECT\x00 1` will
never be caught by tests written by a sane human; a fuzz engine that
mutates byte by byte will hit it within seconds.

The practical consequence in the other direction is that fuzz tests are
*not* a substitute for table-driven tests. Table-driven tests assert
**specific** behaviour (`reverse("abc") == "cba"`). Fuzz tests assert
**general** behaviour (`reverse(reverse(s)) == s`). You need both.

## 2. Your first Fuzz function

Go fuzz tests live in `_test.go` files alongside regular tests, in the
same package. The naming convention is `FuzzXxx` — same shape as
`TestXxx` and `BenchmarkXxx` — and the signature takes a single
`*testing.F`:

```go
package strings_demo

import (
    "testing"
)

func Reverse(s string) string {
    r := []rune(s)
    for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
        r[i], r[j] = r[j], r[i]
    }
    return string(r)
}

func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Add("世界")
    f.Add("")

    f.Fuzz(func(t *testing.T, in string) {
        rev := Reverse(in)
        revRev := Reverse(rev)
        if revRev != in {
            t.Errorf("Reverse(Reverse(%q)) = %q; want %q", in, revRev, in)
        }
    })
}
```

Stop and look at this carefully because every other example on this page
is a variation on it.

The function is named `FuzzReverse`. The `Fuzz` prefix is what the
toolchain looks for, exactly the way it looks for `Test` or `Benchmark`.

The parameter is `f *testing.F`. The `F` stands for "fuzz". It is to
fuzz tests what `*testing.T` is to unit tests and what `*testing.B` is
to benchmarks: a context object that controls the lifecycle of the test
and gives you the methods you need.

`f.Add(...)` adds a seed to the corpus. The seed corpus is the set of
known-good inputs the engine starts with. The engine will run your
fuzz body against each seed once (so seeds also act like inline
table-driven tests) and then use them as starting points to mutate
new inputs from.

`f.Fuzz(func(t *testing.T, in string) { ... })` registers the fuzz
target — the body that the engine will call repeatedly. The first
parameter is always `*testing.T`. The remaining parameters are the
*fuzzed* arguments — values the engine will generate. Crucially, the
types of these parameters must match the types of every `f.Add` call.
If you write `f.Add("hello")` and then your `f.Fuzz` body takes
`(t *testing.T, in []byte)`, the test will not compile.

Inside the body we apply the function under test (`Reverse`), apply it
again to the result, and assert the round-trip invariant. The
invariant is the key idea. You are not asserting "the answer is X";
you are asserting "no matter what input we throw at this function,
this property holds". That is what makes the test usable on inputs
you have never seen.

## 3. Running a fuzz test

There are two distinct ways to run `FuzzReverse`, and conflating them
is the most common beginner confusion.

### 3a. Running it as a regular test (the seed-only mode)

If you simply do:

```
go test ./...
```

the Go toolchain will execute every seed in `FuzzReverse` exactly once,
treating each seed as a normal subtest. It will *not* generate new
inputs. This is fast and runs in CI. You always want it to pass.

You can also run it more explicitly:

```
go test -run FuzzReverse ./...
```

Same behaviour: only the seed corpus is exercised.

### 3b. Running it as a real fuzz (the generative mode)

To actually let the engine generate new inputs, you must pass `-fuzz`:

```
go test -fuzz=FuzzReverse -fuzztime=10s
```

The `-fuzz=FuzzReverse` flag tells the toolchain "actively fuzz this one
function". The pattern is a regular expression matched against fuzz
function names — `-fuzz=FuzzReverse` matches that exact name;
`-fuzz=.` matches every fuzz function (but you can only fuzz one
function per `go test` invocation; if your regex matches more than one,
the toolchain refuses).

The `-fuzztime=10s` flag bounds the run. Without it, fuzzing runs
forever. Common values:

- `-fuzztime=30s` — quick experiment from the laptop
- `-fuzztime=10m` — overnight or nightly CI lane
- `-fuzztime=1000000x` — a fixed number of executions instead of wall time

While fuzzing runs you will see output like:

```
fuzz: elapsed: 0s, gathering baseline coverage: 0/3 completed
fuzz: elapsed: 0s, gathering baseline coverage: 3/3 completed, now fuzzing with 8 workers
fuzz: elapsed: 3s, execs: 215318 (71769/sec), new interesting: 12 (total: 15)
fuzz: elapsed: 6s, execs: 432051 (72244/sec), new interesting: 14 (total: 17)
fuzz: elapsed: 9s, execs: 648922 (72290/sec), new interesting: 14 (total: 17)
fuzz: elapsed: 10s, execs: 720451 (72145/sec), new interesting: 14 (total: 17)
PASS
ok   example.com/strings_demo    10.034s
```

Decoding this:

- `execs` — how many times your fuzz body was called.
- `execs/sec` — throughput. Tens of thousands per second is normal for
  pure functions; far less if your body does I/O or allocation.
- `workers` — Go runs the fuzz body in parallel across goroutines, one
  per CPU by default.
- `new interesting` — inputs that triggered new coverage. The engine
  saves these to disk so it can mutate them in subsequent iterations.
- `gathering baseline coverage` — the first phase, where the engine runs
  every seed once to learn the function's coverage profile.

When `-fuzztime` expires with no crash, the test passes. The new
interesting inputs *stay* on disk (in `$GOCACHE/fuzz/...`) so the next
run picks up where this one left off — fuzzing has continuous progress
across runs.

## 4. The seed corpus and `testdata/fuzz`

Go fuzz tests have two corpora that you must keep straight in your head.

**Seed corpus.** These are inputs you commit to the repository. They
come from two sources: every `f.Add(...)` call in the test, and every
file under `testdata/fuzz/<FuzzName>/`. The seed corpus is the ground
truth; it lives in version control, gets reviewed in pull requests, and
runs as part of `go test` even without `-fuzz`.

**Generated corpus.** These are inputs the engine has discovered to be
"interesting" during a fuzzing run. They live in `$GOCACHE/fuzz/` (run
`go env GOCACHE` to see where), not in your repo. They are not
committed. The cache lets a long-running fuzz session resume where it
left off, but it is fundamentally ephemeral.

The interesting case is what happens when the engine finds a *failing*
input. That input is automatically promoted from the generated corpus
into the seed corpus, by being written to a file under
`testdata/fuzz/<FuzzName>/`. The file name is the SHA-256 of the input.
The file format is a small textual representation listing each
parameter:

```
go test fuzz v1
string("\xc8\x9a")
```

This file is now a permanent regression test. The next time anyone
runs `go test`, that exact input will be replayed through the fuzz
body. If the bug is fixed, the test passes. If the bug regresses, the
test fails — with the same input, in any developer's environment, in
CI, on any machine.

You *must* commit `testdata/fuzz/` to git. If you forget, you have
quietly turned your regression test into a souvenir.

## 5. The output of a discovered failure

Let us deliberately break `Reverse` so you can see what failure looks
like. Replace the rune-based implementation with a byte-based one:

```go
func Reverse(s string) string {
    b := []byte(s)
    for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
        b[i], b[j] = b[j], b[i]
    }
    return string(b)
}
```

For ASCII this still works. For multi-byte UTF-8 it does not, because
reversing the *bytes* of a multi-byte rune produces an invalid UTF-8
sequence. Run the fuzz:

```
go test -fuzz=FuzzReverse -fuzztime=30s
```

Within a second or two you will see something like:

```
--- FAIL: FuzzReverse (0.04s)
    --- FAIL: FuzzReverse/seed#1 (0.00s)
        reverse_test.go:21: Reverse(Reverse("世界")) = "\xe7\x95\x8c\xe4\xb8\x96"; want "世界"
fuzz: elapsed: 1s, gathering baseline coverage: 2/3 completed
FAIL
```

Notice that the failure was found by a *seed*, not by mutation. That is
common: well-chosen seeds find bugs immediately.

Now make the seed innocuous and let mutation find a bug. Remove the
`f.Add("世界")` line. Re-run:

```
go test -fuzz=FuzzReverse -fuzztime=30s
```

Output:

```
fuzz: elapsed: 3s, execs: 41028 (13670/sec), new interesting: 21 (total: 23)
fuzz: minimizing 56-byte failing input file
fuzz: elapsed: 3s, minimizing
--- FAIL: FuzzReverse (0.00s)
    --- FAIL: FuzzReverse/c8aabbcdef... (0.00s)
        reverse_test.go:21: Reverse(Reverse("\xc8\x9a")) = "\xa8\xc9"; want "\xc8\x9a"

    Failing input written to testdata/fuzz/FuzzReverse/c8aabbcdef0123456789...
    To re-run:
    go test -run=FuzzReverse/c8aabbcdef0123456789...
FAIL
exit status 1
FAIL    example.com/strings_demo  3.402s
```

There are several pieces here worth pulling apart.

The hex string after `FuzzReverse/` is the SHA-256 (truncated) of the
input. It is also the file name of the corpus entry.

`fuzz: minimizing` is the engine trying to shrink the failing input.
Minimization is one of the most important features of fuzzing. The
engine found *some* input that fails, but that input may be long and
full of irrelevant bytes. The engine then tries shorter and simpler
variations that still fail, and reports the smallest one it finds. The
result is typically tiny and very debuggable — here, two bytes.

The failure message comes from your own `t.Errorf` call. Make this
message informative; the engine will quote it verbatim.

The `To re-run` line shows you exactly how to replay this specific
input later as a normal subtest. No `-fuzz` flag needed — the engine is
not generating; it is just running the saved file:

```
go test -run=FuzzReverse/c8aabbcdef0123456789...
```

## 6. Reproducing the failure (the saved input is the test)

Open the file that was created:

```
$ cat testdata/fuzz/FuzzReverse/c8aabbcdef0123456789...
go test fuzz v1
string("\xc8\x9a")
```

The header `go test fuzz v1` declares the format version. Each
subsequent line declares one argument, with the *type* followed by a
Go-syntax value. Strings use Go's standard escape syntax. `[]byte`
shows up as `[]byte("...")`. Primitives show up as
`int(42)`, `uint64(0xdeadbeef)`, `float64(1.5)`, `bool(true)`, and so on.

Commit this file. From now on, every `go test ./...` run replays it as
a regression test. There is no further bookkeeping; the file *is* the
test. This is the simplest and most powerful aspect of Go fuzzing:
*a discovered failure becomes a permanent, deterministic test
automatically.*

If you want to delete the entry once the bug is fixed, the test will
of course no longer be replayed — but you usually want to keep it, as
a regression guard.

## 7. What types can the fuzz target take?

The fuzz engine only generates inputs of types it knows how to
generate. As of Go 1.21+, the supported types are:

- `string`
- `[]byte`
- `int`, `int8`, `int16`, `int32`, `int64`
- `uint`, `uint8`, `uint16`, `uint32`, `uint64`
- `float32`, `float64`
- `bool`
- `rune` (alias for `int32`)
- `byte` (alias for `uint8`)

That is the complete list. The fuzz target may take *multiple* such
parameters in any combination, e.g.:

```go
func FuzzClamp(f *testing.F) {
    f.Add(5, 0, 10)
    f.Add(15, 0, 10)
    f.Add(-3, 0, 10)

    f.Fuzz(func(t *testing.T, x, lo, hi int) {
        if lo > hi {
            return
        }
        c := Clamp(x, lo, hi)
        if c < lo || c > hi {
            t.Errorf("Clamp(%d, %d, %d) = %d, out of range", x, lo, hi, c)
        }
    })
}
```

Note three things:

First, every `f.Add` must match the parameter list of `f.Fuzz` exactly
in arity and types. `f.Add(5, 0, 10)` works because all three are
`int`. `f.Add(5, 0, "10")` would panic at registration time.

Second, you cannot fuzz structs, slices-of-structs, maps, channels,
interfaces, or any custom type. If you need structured input, you
fuzz `[]byte` or `string` and parse it yourself inside the body. The
fuzzer is intentionally restricted to a small set of primitive types
because it has to generate bytes from scratch without any knowledge
of your application's schema.

Third, the `return` on the `lo > hi` line is the canonical way to
*skip* inputs that violate a precondition. We will revisit this in
section 11.

## 8. The relationship to `b.N` in benchmarks

Beginners often see `*testing.F` and `*testing.B` and wonder if they
are the same kind of beast. They are similar in shape and very
different in purpose.

A benchmark's driver is `*testing.B`:

```go
func BenchmarkReverse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Reverse("hello")
    }
}
```

The framework picks `b.N` adaptively to get a stable measurement of
nanoseconds per operation. The body executes the same input over and
over. The *output* is a number — ns/op, allocs/op.

A fuzz target's driver is `*testing.F`, but the engine controls the
loop internally:

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Fuzz(func(t *testing.T, in string) {
        _ = Reverse(in)
    })
}
```

There is no `f.N`. You do not write the loop. The engine calls your
body millions of times, but each call gets a *different* input
(unlike a benchmark, where the input is fixed). The *output* is not a
number; it is either "no failure found" or "here is a failing
input".

The similarity worth noticing: both drivers run their bodies many
times, and both rely on the body being fast. A slow fuzz body — say,
one that does network I/O — caps your `execs/sec` and severely
reduces what the engine can explore. Just like a slow benchmark body
inflates `ns/op`, a slow fuzz body wastes CPU.

## 9. Worked example — fuzzing a JSON parser

Let us fuzz a JSON validator. We have a tiny function:

```go
package jsonparse

import "encoding/json"

func IsValid(data []byte) bool {
    var v any
    return json.Unmarshal(data, &v) == nil
}
```

A fuzz test:

```go
package jsonparse

import (
    "encoding/json"
    "testing"
)

func FuzzIsValid(f *testing.F) {
    f.Add([]byte(`{}`))
    f.Add([]byte(`{"a":1}`))
    f.Add([]byte(`[1,2,3]`))
    f.Add([]byte(`"hello"`))
    f.Add([]byte(`null`))
    f.Add([]byte(``))
    f.Add([]byte(`{`))

    f.Fuzz(func(t *testing.T, data []byte) {
        valid := IsValid(data)
        if !valid {
            return
        }
        // If IsValid said yes, json.Unmarshal must also accept it.
        var v any
        if err := json.Unmarshal(data, &v); err != nil {
            t.Fatalf("IsValid said true but Unmarshal said error: %v\ninput=%q", err, data)
        }
    })
}
```

There are two important moves in this body.

First, the use of `return` when `valid` is false. We do not want to
treat an "invalid JSON" as a failure — most random byte sequences are
not valid JSON, and that is fine. We are testing a more specific
property: *if IsValid claims true, the json package must agree*. This
is called a *differential* property: it compares two implementations
of the same idea.

Second, we still call `json.Unmarshal` in the body even though it is
the same function `IsValid` uses underneath. That is intentional. If
we extracted `IsValid` later to a hand-rolled parser, this test would
immediately catch any disagreement with the standard library.

A second fuzz target on the same parser checks for crashes:

```go
func FuzzIsValidDoesNotPanic(f *testing.F) {
    f.Add([]byte(`{"a":1}`))
    f.Add([]byte(``))

    f.Fuzz(func(t *testing.T, data []byte) {
        _ = IsValid(data)
    })
}
```

That is it. The whole body is just a call. The implicit assertion is
"this function must not panic for any byte sequence". The engine will
try very hard to find one that does.

This pattern — fuzz target whose body just *calls* the function and
relies on the absence of panic — is one of the most useful patterns in
the language. Use it on every public function that takes untrusted
input: parsers, decoders, hash functions, URL builders, template
expansions.

## 10. Worked example — fuzzing the reverse function properly

Back to `Reverse`. The rune-based implementation is closer to correct,
but is it actually correct? Let us write a fuzz that exercises three
properties at once.

```go
package strings_demo

import (
    "testing"
    "unicode/utf8"
)

func FuzzReverseProperties(f *testing.F) {
    f.Add("hello")
    f.Add("世界")
    f.Add("á") // 'a' + combining acute accent
    f.Add("")

    f.Fuzz(func(t *testing.T, in string) {
        if !utf8.ValidString(in) {
            return
        }
        rev := Reverse(in)

        // Property 1: result is valid UTF-8.
        if !utf8.ValidString(rev) {
            t.Errorf("Reverse(%q) = %q which is not valid UTF-8", in, rev)
        }

        // Property 2: length in runes is preserved.
        if utf8.RuneCountInString(in) != utf8.RuneCountInString(rev) {
            t.Errorf("Reverse(%q): rune count changed from %d to %d",
                in, utf8.RuneCountInString(in), utf8.RuneCountInString(rev))
        }

        // Property 3: applying Reverse twice gives back the original.
        if Reverse(rev) != in {
            t.Errorf("Reverse is not its own inverse on %q", in)
        }
    })
}
```

This is a good example of layering properties. The first two are
*output* properties (about `rev` itself); the third is a *round-trip*
property (about the composition). When this test fails, the error
message tells you which property failed, so debugging is direct.

Notice the `if !utf8.ValidString(in) { return }` guard. The fuzz engine
generates arbitrary bytes; many of them will not be valid UTF-8 when
interpreted as strings. If our `Reverse` is documented to require
valid UTF-8 input, then feeding it invalid input is meaningless — we
return early. This is the *precondition* pattern, and we will return
to it in section 11.

## 11. Common first mistakes

The mistakes below are the ones almost every junior makes the first
time they sit down with `go test -fuzz`. Reading them now saves a few
hours of confusion later.

### Mistake 1 — panicking on expected error

```go
f.Fuzz(func(t *testing.T, data []byte) {
    p, err := Parse(data)
    if err != nil {
        t.Fatal(err)
    }
    _ = p
})
```

This is wrong. The fuzz engine generates billions of byte sequences,
*most of which are not valid input*. `Parse` will return an error on
nearly all of them. By calling `t.Fatal(err)` you are reporting every
single one of those as a bug. Within milliseconds, the fuzz output
will be full of "failures" that are not failures at all.

Correct version:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    p, err := Parse(data)
    if err != nil {
        return // expected, the input is malformed
    }
    // Now assert properties of the successful parse:
    if p == nil {
        t.Fatal("Parse returned nil result with nil error")
    }
})
```

The fuzz body must distinguish between *acceptable rejection* (the
input was invalid; return early) and *bug* (the function violated
its contract; call `t.Errorf` or `t.Fatal`).

### Mistake 2 — side effects in the body

```go
var counter int

func FuzzWrite(f *testing.F) {
    f.Fuzz(func(t *testing.T, data []byte) {
        counter++
        Write(data, fmt.Sprintf("file_%d.txt", counter))
    })
}
```

Two problems here. The package-level `counter` is shared across
goroutines and races. Writing files inside the body makes the test
non-reproducible: if the fuzzer finds a failing input, replaying it
will produce different filesystem state than the original failure.

Rules of thumb:

- The body must be a pure function of its inputs, as far as possible.
- No package-level mutable state.
- No filesystem, no network, no global random source.
- If you must do I/O, do it to a `t.TempDir()` and clean it up.

### Mistake 3 — non-deterministic body

```go
f.Fuzz(func(t *testing.T, n int) {
    r := rand.Int()
    if r+n < 0 {
        t.Fatal("overflow")
    }
})
```

The failure depends on `rand.Int()`. Replaying the saved input file
will not reproduce the bug, because `rand.Int()` returns something
different each run. The fuzz framework relies on determinism; a
non-deterministic body sabotages the whole regression-test mechanism.

If you need randomness inside the body, derive it from the fuzzed
inputs themselves (`rand.New(rand.NewSource(int64(seed)))` where
`seed` is a fuzzed `int`).

### Mistake 4 — slow body

```go
f.Fuzz(func(t *testing.T, data []byte) {
    time.Sleep(10 * time.Millisecond)
    _ = Parse(data)
})
```

You will get fewer than 100 executions per second. The fuzz engine
explores by *volume*; a slow body means very little exploration. Any
sleep, any network call, any expensive setup belongs *outside* the
body. Use `testing.F.Cleanup` for teardown and do per-fuzz setup once
(before `f.Fuzz`), not on every iteration.

### Mistake 5 — fuzzing multiple functions at once

```
go test -fuzz=. -fuzztime=30s
```

If your test file has `FuzzA` and `FuzzB`, this fails:

```
testing: will not fuzz, -fuzz matches more than one fuzz test: [FuzzA FuzzB]
```

You can only fuzz one function per `go test` invocation. The
`-fuzz` flag must match exactly one fuzz function. Run them
sequentially:

```
go test -fuzz=FuzzA -fuzztime=30s
go test -fuzz=FuzzB -fuzztime=30s
```

You can, of course, still *seed-run* all of them at once with plain
`go test`. The single-function restriction only applies to the
generative `-fuzz` mode.

### Mistake 6 — committing the cache

The `$GOCACHE/fuzz/` directory should not be in your repository.
`testdata/fuzz/` should be. Mixing them up is common. The rule:
- *Saved failing inputs* live in `testdata/fuzz/<FuzzName>/` — commit.
- *Interesting inputs from a run* live in `$GOCACHE/fuzz/` — do not
  commit, do not even know where it is.

If you accidentally see a giant `testdata/fuzz` after a run,
inspect the contents. Failing inputs are tiny (handful of bytes,
filename is hex). If you see thousands of large files, you may have
pointed something at the wrong path.

### Mistake 7 — assuming the seed alone is enough

```go
func FuzzParse(f *testing.F) {
    f.Add([]byte(`{"a":1}`))
    f.Fuzz(func(t *testing.T, data []byte) {
        _ = Parse(data)
    })
}
```

If you run `go test ./...` (no `-fuzz`), this only exercises one input
and reports nothing meaningful about your parser's robustness. The
seed-only path verifies that the fuzz test still *compiles and runs*,
not that the parser is correct on arbitrary input. Always also run
`go test -fuzz=FuzzParse -fuzztime=30s` periodically, especially
before releases.

### Mistake 8 — over-broad assertions

```go
f.Fuzz(func(t *testing.T, data []byte) {
    _, err := Parse(data)
    if err != nil {
        t.Fatalf("any error is a bug: %v", err)
    }
})
```

This is mistake 1 in fancier clothing. The author *believes* the
function should accept everything; in practice almost every byte
sequence will be rejected. Read the documented contract of the
function, formalize it into a precondition, and apply the
precondition (early return) inside the body. *Assertions describe
what must hold; preconditions describe when those assertions
apply.*

### Mistake 9 — using `t.Skip` for a precondition

```go
f.Fuzz(func(t *testing.T, x int) {
    if x < 0 {
        t.Skip()
    }
    if Sqrt(x) < 0 {
        t.Errorf("negative sqrt for %d", x)
    }
})
```

`t.Skip` works, but it inflates the visible "skipped" count and the
engine still considers the iteration as having explored coverage. Use
plain `return` for "this input does not satisfy my precondition";
reserve `t.Skip` for *infrastructure* unavailability (a missing tool,
an environment variable, a platform-gated feature).

### Mistake 10 — forgetting that t inside the fuzz body is per-iteration

```go
f.Fuzz(func(t *testing.T, in string) {
    t.Logf("trying %q", in)
    // ...
})
```

This `t.Logf` runs on every single iteration — tens of thousands of
times per second. Even at -v, the output is a hose. The general
guidance: do not log inside the fuzz body except to enrich a real
failure message. The fuzz engine already prints progress; it does not
need your help.

## 12. A minimal mental model

If you internalize one diagram from this page, internalize this one.

```
            +-----------------------------+
            |       testing.F             |
            |                             |
seeds ----> |  f.Add(...)                 |
            |       |                     |
            |       v                     |
            |  +-----------------------+  |
            |  |   coverage-guided     |  |
            |  |   mutation engine     |  |
            |  +-----------------------+  |
            |       |                     |
            |       v                     |
            |  f.Fuzz(func(t, ...){...})  |
            |       |                     |
            |       v                     |
            |  +-----------------------+  |
            |  |  bug found?  ---yes-->|--+--> testdata/fuzz/FuzzName/<sha>
            |  |  no                   |  |
            |  +-----------------------+  |
            +-----------------------------+
                       |
                       v
                  PASS or FAIL
```

The engine pulls seeds out of `f.Add`, mutates them, runs them through
the function registered with `f.Fuzz`, watches for failures, and
saves them as regression tests. That is the whole loop.

## 13. End-to-end exercise — practice on your own

Pick a function in your own code that takes `[]byte` or `string` and
write a fuzz test for it. Suggestions, easiest to hardest:

1. A string trimming function. Property: the trimmed string has no
   leading or trailing whitespace; trimming is idempotent.
2. A base64 encoder/decoder pair. Property: `decode(encode(b))` equals
   `b` for any `[]byte`.
3. A URL parser. Property: parsing never panics; the host of a parsed
   URL never contains a slash.
4. A CSV parser. Property: parsing never panics; the number of fields
   in each row is consistent.
5. A small expression evaluator. Property: `evaluate(s)` either
   returns a finite float or an error — never `+Inf`, `-Inf`, or
   `NaN`, never panics.

For each one, write three seeds. Run `go test -fuzz=. -fuzztime=30s`
(after renaming so only one fuzz function exists). Watch the
`new interesting` counter rise. If something crashes, inspect the file
under `testdata/fuzz/`, fix the bug, and rerun. The first time you
see the engine catch a bug that you genuinely did not anticipate is
the moment fuzzing earns its place in your toolbox.

## 14. Cheat sheet

```
go test                              # runs seeds only (fast, deterministic)
go test -run FuzzReverse             # runs FuzzReverse's seeds only
go test -fuzz=FuzzReverse            # runs forever, generating new inputs
go test -fuzz=FuzzReverse -fuzztime=30s   # 30 seconds wall-clock
go test -fuzz=FuzzReverse -fuzztime=1000000x  # 1M executions
go test -fuzz=FuzzReverse -parallel=4         # cap workers
go test -run=FuzzReverse/abc123      # replay one saved corpus entry
```

```go
func FuzzXxx(f *testing.F) {
    // 1. Seeds: known-good inputs of the exact param types.
    f.Add(seed1)
    f.Add(seed2)

    // 2. Body: pure function of inputs, returns early on
    //    expected errors, fails loudly on broken invariants.
    f.Fuzz(func(t *testing.T, in TYPE) {
        if !isValidInput(in) {
            return // precondition
        }
        result, err := FunctionUnderTest(in)
        if err != nil {
            return // acceptable failure
        }
        if !invariantHolds(in, result) {
            t.Errorf("invariant broken: in=%v result=%v", in, result)
        }
    })
}
```

Allowed parameter types for the fuzz body (in addition to `*testing.T`):

```
string, []byte,
int, int8, int16, int32, int64,
uint, uint8, uint16, uint32, uint64,
float32, float64,
bool,
rune (= int32), byte (= uint8)
```

## 15. A second pass through the lifecycle, slowly

It is worth walking through a complete fuzzing session end-to-end one more
time, in exhaustive detail, with no skipped steps. Read this section
slowly. If you are still unsure how `f.Add`, `f.Fuzz`, the engine, and
`testdata/fuzz/` fit together, this will close the gap.

Suppose your repository looks like this:

```
project/
  go.mod
  intervals/
    intervals.go
    intervals_test.go
```

`intervals.go` contains:

```go
package intervals

// Contains reports whether the closed interval [lo, hi] contains x.
// It assumes lo <= hi; behaviour is unspecified otherwise.
func Contains(x, lo, hi int) bool {
    return x >= lo && x <= hi
}
```

`intervals_test.go` contains a fuzz target:

```go
package intervals

import "testing"

func FuzzContains(f *testing.F) {
    f.Add(5, 0, 10)
    f.Add(0, 0, 10)
    f.Add(10, 0, 10)
    f.Add(-1, 0, 10)
    f.Add(11, 0, 10)

    f.Fuzz(func(t *testing.T, x, lo, hi int) {
        if lo > hi {
            return
        }
        got := Contains(x, lo, hi)
        want := x >= lo && x <= hi
        if got != want {
            t.Errorf("Contains(%d, %d, %d) = %v; want %v", x, lo, hi, got, want)
        }
    })
}
```

Step 1 — you run `go test ./...`. The toolchain compiles the package
in test mode, finds `FuzzContains`, runs each seed once as a subtest,
and reports `PASS`. Total wall time: a few milliseconds.

Step 2 — you run `go test -fuzz=FuzzContains -fuzztime=20s ./intervals`.
The toolchain recompiles the package with coverage instrumentation,
runs each seed once to gather baseline coverage, then enters the
fuzz loop. It generates new `(x, lo, hi)` triples by mutating bytes
in the corpus. Some mutations make `lo > hi`, the body returns
early; some satisfy the precondition and exercise `Contains`. After
20 seconds it stops, prints execution counts, and exits 0.

Step 3 — you introduce a bug. Edit `intervals.go`:

```go
func Contains(x, lo, hi int) bool {
    return x > lo && x <= hi // BUG: should be >= lo
}
```

Step 4 — you re-run `go test -fuzz=FuzzContains -fuzztime=20s`. Within
milliseconds the engine finds the mutation `(0, 0, 10)`: the body
expects `0 >= 0 && 0 <= 10 == true` but our buggy function returns
`0 > 0 && ... == false`. The engine prints:

```
--- FAIL: FuzzContains (0.00s)
    --- FAIL: FuzzContains/abcd1234... (0.00s)
        intervals_test.go:17: Contains(0, 0, 10) = false; want true

    Failing input written to testdata/fuzz/FuzzContains/abcd1234...
    To re-run:
    go test -run=FuzzContains/abcd1234...
```

Step 5 — a new file appears:

```
project/
  intervals/
    testdata/
      fuzz/
        FuzzContains/
          abcd1234ef567890abcdef0123456789abcdef0123456789abcdef0123456789
```

Step 6 — inspect the file:

```
go test fuzz v1
int(0)
int(0)
int(10)
```

That is the entire format: a version header, then one line per
parameter. Step 7 — you commit this file. From now on, the bug —
even if the original engine that discovered it is never run again
— is locked in as a regression test.

Step 8 — fix the bug. Re-run `go test ./intervals`. The saved
regression input is replayed as a subtest, it passes, the test
suite is green. Step 9 — push.

If, six months later, a colleague refactors `Contains` and
accidentally reintroduces the bug, the very next `go test`
invocation catches it. No one had to remember to rerun the fuzzer.
The discovery moment from six months ago is now a permanent property
of the test suite.

This is the loop. Internalize it.

## 16. A note on coverage and why it matters

We have called the Go fuzzer "coverage-guided" several times. It is
worth spending a paragraph on what that means, because the picture
many beginners build of the engine is a pure random byte generator,
and that picture is wrong.

When the toolchain compiles a package for fuzzing, it inserts small
counters at the entrance of every basic block — every linear sequence
of instructions with no branches. After each call to the fuzz body,
the engine examines those counters. If the input caused a counter to
go from 0 to non-zero (a basic block reached for the first time), the
input is *interesting*. The engine keeps the interesting input,
prioritizes it for further mutation, and continues.

Consider a function with a branch like:

```go
if len(data) > 4 && data[0] == 'M' && data[1] == 'Z' {
    // ... deep code path
}
```

A pure random generator would need `2^16` tries on average to land
the first two bytes as `M` and `Z`. A coverage-guided fuzzer needs
roughly `256` tries to land the `M`, then about another `256` to
land the `Z` — because the moment it lands `M` it sees new coverage,
keeps that input, and mutates it further. The dependency on the
*and* chain collapses from multiplicative to additive. This is the
exponential speedup of coverage guidance, and it is the reason
fuzzing works at all on non-trivial parsers.

There is nothing you, the test author, need to do to enable coverage
guidance. It happens automatically when you use `-fuzz`. But knowing
*why* the engine is fast helps you write fuzz bodies the engine can
make progress on. The most important rule: do not flatten meaningful
branches into a single early-return precondition. The engine wants
to see your code branching; that is how it knows what to explore.

Concretely, this body is bad for coverage guidance:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if !looksLikeProtobuf(data) {
        return
    }
    _, _ = Parse(data)
})
```

`looksLikeProtobuf` is doing work *outside* `Parse`. The engine sees
coverage in `looksLikeProtobuf` rise, mistakes that for progress, and
spends time exploring the precondition rather than the parser. If
your precondition is a quick syntactic check, fine. If it is
heavyweight, push it down into the parser itself or arrange for the
engine to see the parser's coverage instead.

## 17. Fuzzing and the race detector

A useful trick: combine fuzzing with the race detector.

```
go test -fuzz=FuzzWorker -race -fuzztime=60s
```

If your fuzz target spawns goroutines, the `-race` flag will catch
data races that random concurrent inputs trigger. The combination is
particularly powerful for caches, connection pools, lock-free data
structures, and anything that takes a sequence of operations as
input. (We will not go deep on this here — it is a senior-level
topic — but it is worth knowing the option exists.)

Note that `-race` slows execution by roughly 5x to 10x. Use it for
shorter, targeted runs, not for the multi-hour soaks you might do
without it.

## 18. Fuzzing and assertions written with `require`/`assert`

If you use `github.com/stretchr/testify`, you may instinctively write:

```go
f.Fuzz(func(t *testing.T, in string) {
    rev := Reverse(in)
    require.Equal(t, in, Reverse(rev))
})
```

This works. `require.Equal` calls `t.Errorf` and `t.FailNow`
underneath, both of which the fuzz framework understands. The only
caveat: `require.NoError(t, err)` is the testify equivalent of
"any error is a bug", which is mistake 1 from section 11. Make sure
you genuinely mean it before writing it. For functions that legally
return errors on bad input, write the precondition check by hand;
do not paper over it with `require.NoError`.

## 19. When *not* to fuzz

Fuzzing is powerful, but it is not the right tool for every test.
Skip fuzzing when:

- The function has a small, enumerable input space — at that point
  a table-driven test covers everything.
- The function has no interesting branches — fuzzing a getter is
  silly.
- The function does heavy I/O — fuzz throughput collapses, and you
  spend CPU on infrastructure rather than exploration.
- The bug class you care about is not "any input crashes it" but
  "this specific input produces the wrong answer". That belongs in
  a regression test, not a fuzz target.
- You do not have a property to check. Fuzzing without an assertion
  finds only panics. That is still valuable for parsers, but for
  business logic with no panic risk, fuzzing without a property is
  just burning CPU.

Reach for fuzzing when:

- The input domain is huge and irregular (strings, bytes, untrusted
  data).
- You can state at least one invariant that should hold for *all*
  inputs in some precondition class.
- The function is parsing, decoding, validating, or otherwise
  exposed to potentially adversarial input.
- You have had bugs in this function before that escaped manual
  tests.

## 20. What we did and did not cover

Covered:

- What fuzzing is conceptually, and how it differs from table-driven
  testing and from property-based testing.
- The shape of a `Fuzz` function: signature, seeds, body.
- Running fuzz tests in seed mode (`go test`) and in generative mode
  (`go test -fuzz=Name -fuzztime=...`).
- How the engine reports a failing input, how it minimizes, and how
  it persists the input to `testdata/fuzz/<FuzzName>/`.
- Reproducing a saved failure as a normal subtest.
- The list of allowed fuzz-input types and why structured types are
  not supported.
- The relationship to benchmarks (`*testing.B`): similar driver,
  different goal.
- Two worked examples: a JSON validator (`IsValid` vs `json.Unmarshal`)
  and a string reverse (UTF-8 round-trip).
- Ten common first-time mistakes and how to avoid each.

Not covered (these belong on the middle and senior pages):

- Custom corpora layouts, sharing corpora across machines, persisting
  corpora in CI artifacts.
- Differential fuzzing against another implementation in detail.
- Structured fuzzing — feeding `[]byte` into a parser that produces
  a typed value, then using that value as the "real" input.
- Performance tuning: GOMAXPROCS, memory pressure, parallelism
  trade-offs.
- Integration with OSS-Fuzz, ClusterFuzzLite, and external
  coverage-guided engines.
- Mutation strategies and their internal details (byte-level vs
  splice vs dictionary-based).
- Fuzzing tests that span concurrency boundaries (channels,
  goroutines, race detection inside the fuzz body).
- Coverage attribution and reading the `-test.coverprofile` of a fuzz
  run.

If any of that interests you now, you are reading the right page for a
warm-up; the next pages in this section pick up directly where this
one stops.

[← Back](../)
