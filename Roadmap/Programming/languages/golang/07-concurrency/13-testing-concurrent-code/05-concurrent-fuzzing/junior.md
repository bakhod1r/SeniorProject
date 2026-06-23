# Concurrent Fuzzing — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is fuzzing? How do I write a fuzz target in Go? Why should I run it with `-race`?"

**Fuzzing** is a testing technique where the testing framework generates random or semi-random inputs, feeds them to a target function, and watches for crashes, panics, or violated invariants. The fuzzer does not know your code's intent — it explores. It mutates bytes, flips bits, splices strings, and uses coverage feedback to evolve inputs toward parts of the program no test has visited yet.

Since Go 1.18 the standard `testing` package has a native fuzzer. You write a function with a name starting with `Fuzz`, register seed inputs with `f.Add`, and supply a fuzz function with `f.Fuzz`. Then you run:

```
go test -fuzz=FuzzParse -fuzztime=30s
```

The framework runs your seeds first, then begins mutating them. Every input that triggers new code coverage is saved to the persistent corpus on disk and used as a seed for future mutations.

**Concurrent fuzzing** is fuzzing combined with the race detector:

```
go test -fuzz=FuzzParse -fuzztime=30s -race
```

Now every fuzzed input is also executed under TSan instrumentation. If the target function spawns goroutines, shares state, or wraps a concurrent data structure, the fuzzer becomes a data-race finder. Random inputs hit code paths your unit tests never explored, and the race detector watches each one.

After reading this file you will:

- Know what fuzzing is and how it differs from example-based tests
- Be able to write a basic fuzz target with `testing.F`, `f.Add`, and `f.Fuzz`
- Understand why `go test -fuzz -race` is the most powerful combination Go ships
- Know where the corpus lives on disk and how to commit it to git
- Recognise the typical bug shapes fuzzing finds: parser panics, decoder hangs, data races on rare inputs
- Be able to stress-test a fuzz-found input by running it across many goroutines
- Know the basic flags: `-fuzz`, `-fuzztime`, `-fuzzminimizetime`, `-fuzzcachedir`

You do not need to know coverage-guided mutation internals, property-based testing libraries, or how to write a state-machine fuzzer yet. Those live at middle and senior.

---

## Prerequisites

- **Required:** Go 1.18 or newer (1.21+ recommended). Native fuzzing did not exist before 1.18. Check with `go version`.
- **Required:** Comfort writing tests with `testing.T` — naming, `*_test.go` files, `go test ./...`.
- **Required:** Awareness of the race detector. If you have not read [Race Detector Deep Dive](../01-race-detector-deep/), do that first. Concurrent fuzzing is meaningless without it.
- **Required:** Basic understanding of goroutines and channels. You should be able to start a goroutine and pass data through a channel without thinking.
- **Helpful:** Some experience writing parsers, decoders, or any code that takes bytes from the outside world. Fuzz targets shine on input-handling code.
- **Helpful:** Familiarity with table-driven tests. A fuzz target is, in spirit, a table-driven test where the table is generated for you.

If you can write `func TestFoo(t *testing.T)` and you have run `go test -race ./...` at least once, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fuzzing** | Automated input-generation testing. The framework produces inputs, runs the target, and watches for failures. |
| **Fuzz target** | A function with signature `func FuzzXxx(f *testing.F)` containing `f.Add` seeds and an `f.Fuzz` call. |
| **`testing.F`** | The fuzzing equivalent of `*testing.T`. Methods include `Add`, `Fuzz`, `Skip`, `Fatal`, `Helper`. |
| **`f.Add`** | Adds a *seed input* to the corpus. Seeds are run unmutated and used as starting points for mutation. |
| **`f.Fuzz`** | Registers the fuzz function. Takes a callback `func(*testing.T, ...types...)` where the extra parameters match the seed shape. |
| **Seed corpus** | The set of `f.Add` inputs plus any files under `testdata/fuzz/FuzzXxx/`. Always re-run on every `go test`. |
| **Generated corpus** | Inputs the fuzzer discovers and saves under `$GOCACHE/fuzz/`. Persisted between runs. |
| **Coverage-guided** | The fuzzer measures which basic blocks an input reaches. Inputs that reach new blocks are kept and mutated further. |
| **Mutation** | A small change to an existing input — bit flip, byte insert, byte delete, length doubling, splice from another seed. |
| **Minimisation** | When a failure is found, the fuzzer shrinks the input to the smallest variant that still triggers the same failure. |
| **`-fuzz`** | Flag that names the fuzz target to run. Without it, fuzz tests run only on their seed corpus, like ordinary tests. |
| **`-fuzztime`** | How long to fuzz. `30s`, `5m`, or a number of iterations like `10000x`. Default is forever. |
| **`-fuzzminimizetime`** | How long the minimiser may spend shrinking a failing input. Default `60s`. |
| **`-fuzzcachedir`** | Override where the generated corpus is stored. Defaults to a subdirectory of `GOCACHE`. |
| **`testdata/fuzz/FuzzXxx/`** | Where committed failing inputs live. The framework saves new failure reproducers here. |
| **Race detector** | TSan-based runtime instrumentation enabled by `-race`. Detects data races at runtime. |
| **Concurrent invariant** | A property of a concurrent program that must hold under any interleaving the scheduler can produce. |
| **Stress test** | Running the same operation across many goroutines for many iterations to flush out rare timing bugs. |
| **Property-based testing** | A style of testing where you express invariants and the framework generates inputs to falsify them. Libraries: `pgregory.net/rapid`, `gopter`. |
| **`go-fuzz`** | The original community fuzzer for Go (by Dmitry Vyukov), the predecessor of the built-in fuzzer. Still useful for older Go versions. |

---

## Core Concepts

### Fuzzing is testing without examples

Traditional tests are example-based: you write inputs, you write expected outputs, you compare. Fuzz testing flips that: you write a target that should never crash or violate an invariant *for any input*, and the framework finds the inputs. You stop curating examples; you start curating invariants.

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Add("")
    f.Add("a")
    f.Fuzz(func(t *testing.T, s string) {
        r := Reverse(s)
        rr := Reverse(r)
        if rr != s {
            t.Errorf("reverse twice changed string: %q -> %q -> %q", s, r, rr)
        }
    })
}
```

The invariant: reversing a string twice should yield the original. The fuzzer generates strings — including weird ones with invalid UTF-8 — and tries to break that invariant.

### The `testing.F` API has three verbs

`f.Add` adds a seed. `f.Fuzz` registers the function under test. `f.Skip` and `f.Fatal` work like their `*testing.T` counterparts. That is essentially the entire surface area.

```go
func FuzzAtoi(f *testing.F) {
    f.Add("123")
    f.Add("-7")
    f.Add("0")
    f.Fuzz(func(t *testing.T, s string) {
        n, err := strconv.Atoi(s)
        if err != nil {
            return
        }
        out := strconv.Itoa(n)
        if out != strings.TrimLeft(s, "+0") && !(n == 0 && strings.Trim(s, "+0") == "") {
            // invariant relaxed; the point is the API shape
        }
        _ = out
    })
}
```

### The fuzz function signature is inferred from `f.Add`

The first argument is always `*testing.T`. The remaining arguments must match — by type and by position — what you passed to `f.Add`. If you mix types across seeds, `go test` complains. Supported types: `[]byte`, `string`, all integer types, `float32`, `float64`, `bool`, and `rune`. There is no support for `int slice`, `map`, or struct inputs — you encode complex inputs as `[]byte` and decode inside the fuzz function.

```go
func FuzzPair(f *testing.F) {
    f.Add("hi", 7)
    f.Add("", 0)
    f.Fuzz(func(t *testing.T, s string, n int) {
        if n < 0 {
            return
        }
        _ = strings.Repeat(s, n)
    })
}
```

### Seeds run on every `go test`, mutation only with `-fuzz`

Without `-fuzz`, your `Fuzz` function behaves like a parametrised test: every seed runs once, the test passes or fails, that is it. This is by design — your seed corpus protects against regressions even when you are not actively fuzzing. With `-fuzz=FuzzXxx`, the framework starts mutating and runs forever (or until `-fuzztime` expires, or a failure is found).

### The race detector is orthogonal to fuzzing

`-race` is a build flag. `-fuzz` is a test flag. They compose. When both are set, every iteration of every fuzz input runs under TSan instrumentation. This is the killer combination: random inputs explore code paths your example tests never touched, and TSan watches each one for unsynchronised memory access.

```
go test -run=^$ -fuzz=FuzzDecode -fuzztime=2m -race ./decoder
```

`-run=^$` disables ordinary tests so the worker processes dedicate their time to fuzzing.

### Failures persist to `testdata/fuzz/`

When the fuzzer finds an input that fails, it writes the minimised reproducer to `testdata/fuzz/FuzzXxx/<hash>` *inside your module*. Commit that file. From then on, every `go test` re-runs the reproducer as part of the seed corpus, ensuring the bug stays fixed.

The file format is a simple text header followed by one `go test-fuzz` value per parameter:

```
go test fuzz v1
string("hello\x80")
int(7)
```

### Generated corpus lives in `GOCACHE`

Inputs that *passed* but expanded coverage are stored under `$GOCACHE/fuzz/<module>/FuzzXxx/`. They are not committed; they accumulate across fuzz runs and seed future mutations. You can override the location with `-fuzzcachedir`. Run `go env GOCACHE` to find the default.

---

## Real-World Analogies

### Fuzzing is like a hostile tester banging on your keyboard

You hand a junior tester your new form-input parser and say "break it." They paste 10,000 lines of unicode, type control characters, hit Enter mid-word. Every clever bug they find becomes a regression test forever. The fuzzer is that tester, except it does it a million times per minute and remembers every successful attack.

### `-race` is the surveillance camera; `-fuzz` is the burglar

The race detector watches. The fuzzer rattles every door and window. Alone, the camera might never record a break-in because no one tries the doors. Alone, the burglar might break in but no one would know. Together, every doorknob jiggle is filmed.

### The corpus is a museum of attacks

Every input the fuzzer saves is a record of "this combination of bytes mattered." Over weeks of CI runs the corpus grows into a curated museum. New developers reading the corpus learn what malformed input looks like in your domain.

### Seeds are the prompts; mutation is the AI

You give a few example inputs (the seeds). The fuzzer treats them as prompts and generates variations forever. The good outputs (new coverage) are kept as new prompts. The bad ones (failures) are reported back to you with a minimised reproduction.

---

## Mental Models

### Model 1: A search problem with a fitness function

Fuzzing is a search through input space. The fitness function is "code coverage" — does this input reach a basic block we have not seen? Mutation is the search operator. The seed corpus is the starting population. Failures are the global minima.

### Model 2: A million parallel unit tests

Every iteration of `f.Fuzz` is one unit test. The fuzzer is a generator over the space of unit tests for your function. With `-race`, every one of those unit tests runs under TSan. Multiply the value of one good unit test by a million; that is what fuzzing pays.

### Model 3: The funnel

At the top, the fuzzer dumps in millions of random byte sequences. The coverage filter keeps only those that explored new territory. The minimiser shrinks the survivors. The output, at the bottom, is a tiny list of small inputs that demonstrate every flaw your code has — for now.

### Model 4: A coverage-driven random walk

Imagine a maze whose floor plan is your code's basic-block graph. The fuzzer walks the maze. Coverage tells it which rooms are new. Mutation tells it which corridor to try next. Eventually it has mapped every room — or hit a wall (panic) that should not have been there.

---

## Pros & Cons

**Pros:**

- Finds bugs you would never imagine. Especially parser bugs, integer-overflow bugs, panic-on-empty-input bugs.
- Coverage-guided mutation is far more effective than random generation. Inputs evolve toward complexity.
- Combines naturally with `-race`. Concurrent code is harder to test by example; fuzzing supplies the inputs example-based tests miss.
- The corpus is a permanent regression record. Commit failing inputs and they protect you forever.
- Zero dependencies — built into the standard `testing` package.

**Cons:**

- Fuzzing burns CPU. Real bugs sometimes need hours of fuzzing to surface.
- Fuzz targets are harder to write than unit tests. You must express invariants, not examples.
- `f.Add` supports only basic types. Complex inputs require an ad-hoc decoding step inside the fuzz function.
- Findings can be flaky if the target depends on time, randomness, or external state. You must seed your own RNGs and stub time.
- The persistent corpus can grow large. CI runners must handle disk usage.

---

## Use Cases

- **Parsers and decoders.** Any function that takes bytes from the outside world: JSON, protobuf, custom binary formats, URL parsers, regex compilers.
- **Encoders and round-trippers.** Decode-then-encode must equal the original; encode-then-decode must equal the original.
- **String manipulation.** Reverse, escape, unescape, normalise.
- **Numeric code.** Anything involving overflow, NaN, ±Inf, denormals.
- **State machines.** Encode the operation sequence as `[]byte`, decode inside the fuzz function into a list of ops, replay them concurrently.
- **Concurrent data structures.** Queues, sets, maps. Drive operations from fuzz-generated bytes across multiple goroutines.
- **Authorisation logic.** Fuzz the policy input; assert "an unauthenticated user can never access `/admin`."
- **Protocol implementations.** HTTP/2 frames, TLS records, custom RPC frames. Fuzz the wire-format parser.

---

## Code Examples

### Example 1: A trivial fuzz target

```go
package main

import (
    "strings"
    "testing"
)

func Reverse(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}

func FuzzReverse(f *testing.F) {
    seeds := []string{"hello", "world", "", "a", "abc"}
    for _, s := range seeds {
        f.Add(s)
    }
    f.Fuzz(func(t *testing.T, s string) {
        r := Reverse(s)
        rr := Reverse(r)
        if rr != s {
            t.Errorf("double-reverse not identity: %q -> %q -> %q", s, r, rr)
        }
        if strings.Contains(r, "\x00") && !strings.Contains(s, "\x00") {
            t.Errorf("reverse introduced NUL byte")
        }
    })
}
```

Run with:

```
go test -fuzz=FuzzReverse -fuzztime=10s
```

The classic failure: `Reverse` corrupts invalid UTF-8. The first fuzz input that fails will be something like `"\xc0"` — a lone continuation byte — that `[]rune(s)` converts to `U+FFFD`, losing information.

### Example 2: Fuzzing a concurrent map with `-race`

```go
package shardmap

import (
    "encoding/binary"
    "sync"
    "testing"
)

type Map struct {
    mu sync.RWMutex
    m  map[string]int
}

func New() *Map { return &Map{m: map[string]int{}} }

func (m *Map) Set(k string, v int) {
    m.mu.Lock()
    m.m[k] = v
    m.mu.Unlock()
}

func (m *Map) Get(k string) (int, bool) {
    m.mu.RLock()
    v, ok := m.m[k]
    m.mu.RUnlock()
    return v, ok
}

func FuzzMapConcurrent(f *testing.F) {
    f.Add([]byte("\x00\x01\x02\x03"))
    f.Add([]byte("\x10ab\x10cd\x10ef"))
    f.Fuzz(func(t *testing.T, data []byte) {
        m := New()
        ops := decodeOps(data)
        var wg sync.WaitGroup
        for _, op := range ops {
            wg.Add(1)
            go func(op op) {
                defer wg.Done()
                if op.write {
                    m.Set(op.key, op.val)
                } else {
                    m.Get(op.key)
                }
            }(op)
        }
        wg.Wait()
    })
}

type op struct {
    write bool
    key   string
    val   int
}

func decodeOps(data []byte) []op {
    var out []op
    for len(data) >= 2 {
        write := data[0]&1 == 1
        n := int(data[0]>>1) & 0x07
        data = data[1:]
        if len(data) < n+1 {
            return out
        }
        key := string(data[:n])
        data = data[n:]
        val := int(int8(data[0]))
        data = data[1:]
        out = append(out, op{write: write, key: key, val: val})
    }
    _ = binary.BigEndian // keep import used in real code
    return out
}
```

Run with:

```
go test -run=^$ -fuzz=FuzzMapConcurrent -fuzztime=1m -race
```

The fuzzer mutates byte slices. `decodeOps` turns each slice into a sequence of read/write operations. Many goroutines run them in parallel. The race detector watches. If you forget the `mu.RLock()` in `Get`, this will fail in seconds.

### Example 3: A fuzz target for a state machine

```go
package counter

import "sync"

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Dec() { c.mu.Lock(); c.n--; c.mu.Unlock() }
func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

```go
package counter

import (
    "sync"
    "testing"
)

func FuzzCounterInvariant(f *testing.F) {
    f.Add(uint64(0x0102030405060708))
    f.Add(uint64(0xff))
    f.Fuzz(func(t *testing.T, ops uint64) {
        c := &Counter{}
        var wg sync.WaitGroup
        var expected int64
        for i := 0; i < 16; i++ {
            op := (ops >> (i * 4)) & 0x0f
            wg.Add(1)
            if op%2 == 0 {
                expected++
                go func() { defer wg.Done(); c.Inc() }()
            } else {
                expected--
                go func() { defer wg.Done(); c.Dec() }()
            }
        }
        wg.Wait()
        if int64(c.Value()) != expected {
            t.Fatalf("expected %d, got %d", expected, c.Value())
        }
    })
}
```

The invariant: after `N` concurrent `Inc`/`Dec` calls the counter must equal `inc - dec`. The fuzzer encodes the operation sequence as bits of a `uint64`. Run with `-race` to catch unsynchronised access; run without `-race` to catch logic bugs.

### Example 4: Round-trip fuzzing

```go
func FuzzJSONRoundTrip(f *testing.F) {
    f.Add([]byte(`{"a":1}`))
    f.Add([]byte(`[]`))
    f.Add([]byte(`null`))
    f.Fuzz(func(t *testing.T, data []byte) {
        var v any
        if err := json.Unmarshal(data, &v); err != nil {
            return // valid behaviour: malformed JSON
        }
        out, err := json.Marshal(v)
        if err != nil {
            t.Fatalf("re-marshal failed: %v", err)
        }
        var v2 any
        if err := json.Unmarshal(out, &v2); err != nil {
            t.Fatalf("re-unmarshal failed: %v", err)
        }
        if !reflect.DeepEqual(v, v2) {
            t.Fatalf("round-trip mismatch:\nfirst:  %v\nsecond: %v", v, v2)
        }
    })
}
```

The invariant: `decode -> encode -> decode` yields the same value as the first decode.

### Example 5: Stress-replaying a fuzz-found input

```go
func TestRegression_FuzzMap_b3f7(t *testing.T) {
    raw := []byte{0x07, 'a', 'b', 'c', 0x01, 0x05, 'd', 'e', 0x02}
    for i := 0; i < 1000; i++ {
        m := New()
        ops := decodeOps(raw)
        var wg sync.WaitGroup
        for _, op := range ops {
            wg.Add(1)
            go func(op op) {
                defer wg.Done()
                if op.write {
                    m.Set(op.key, op.val)
                } else {
                    m.Get(op.key)
                }
            }(op)
        }
        wg.Wait()
    }
}
```

Once the fuzzer found a failing input, you copy it into a stress test that re-runs it 1000 times. With `-race`, any rare interleaving that only sometimes triggers the race becomes overwhelmingly likely to be caught.

---

## Coding Patterns

### Pattern: One target per public function

If your package exports `Parse`, `Encode`, `Match`, write `FuzzParse`, `FuzzEncode`, `FuzzMatch`. Each focuses on one entry point. Each can be fuzzed independently and in parallel CI jobs.

### Pattern: Seed from real data

If you have production samples — sanitised, anonymised — feed them to `f.Add`. Real-world inputs explore code paths random bytes rarely reach. Read a directory:

```go
func FuzzParse(f *testing.F) {
    entries, _ := os.ReadDir("testdata/samples")
    for _, e := range entries {
        b, _ := os.ReadFile(filepath.Join("testdata/samples", e.Name()))
        f.Add(b)
    }
    f.Fuzz(func(t *testing.T, data []byte) { _, _ = Parse(data) })
}
```

### Pattern: Encode complex inputs as byte slices

The fuzzer only knows basic types. To fuzz a sequence of operations, encode them in `[]byte` and decode inside the fuzz function. The decoder must be total (no panics) so that any byte sequence yields *some* valid op list.

### Pattern: Skip uninteresting inputs

```go
f.Fuzz(func(t *testing.T, data []byte) {
    if len(data) < 8 {
        t.Skip()
    }
    _, _ = Parse(data)
})
```

`t.Skip` keeps coverage focused on inputs that actually exercise the code.

### Pattern: Wrap the system in a deterministic harness

If your code uses time, randomness, or external services, replace them with deterministic stubs in the fuzz function. A fuzz failure must reproduce when re-run; non-determinism breaks reproducibility.

```go
f.Fuzz(func(t *testing.T, seed int64, data []byte) {
    rng := rand.New(rand.NewSource(seed))
    clock := newFakeClock()
    s := NewServer(WithRand(rng), WithClock(clock))
    _, _ = s.Handle(data)
})
```

### Pattern: Concurrent fuzz harness

```go
f.Fuzz(func(t *testing.T, data []byte) {
    s := NewQueue()
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(part []byte) {
            defer wg.Done()
            for _, b := range part {
                if b&1 == 1 {
                    s.Push(int(b))
                } else {
                    s.Pop()
                }
            }
        }(slicePart(data, i, 4))
    }
    wg.Wait()
})
```

Always run this with `-race`. Without it, the fuzzer cannot find data races; it can only find panics.

---

## Clean Code

- **Name fuzz targets after the function they test.** `FuzzParse`, not `FuzzTest1`.
- **Keep fuzz functions short.** Decode → execute → assert invariant. If decoding is complex, extract a helper.
- **Reject ambiguous inputs with `t.Skip`.** Do not let the fuzzer waste CPU on inputs that cannot meaningfully exercise the code.
- **Express one invariant per target.** `FuzzReverseRoundTrip`, `FuzzReverseNoNULIntroduction` — two targets are clearer than one with two assertions.
- **Commit `testdata/fuzz/FuzzXxx/`.** Treat failing inputs like regression tests. They are version-controlled bugs.
- **Document the encoding in a comment.** When you decode `[]byte` into operations, explain the layout. Future readers will appreciate it.

---

## Product Use / Feature

Fuzzing is invisible to users but valuable to product teams.

**Hardening user-facing parsers.** Forms, URL parameters, file uploads, API request bodies — all are attack surface. A fuzz target on each parser catches malformed-input bugs before a user (or attacker) does.

**Pre-release hardening.** Run `-fuzz` for hours before a major release. Every failure committed to `testdata/fuzz/` becomes a permanent regression test.

**Bug-bounty defence.** When a security researcher reports a parser crash, the response is "add the input to the fuzz corpus." Both fixes the bug and protects against the class.

**Refactoring confidence.** Before a large refactor of input-handling code, run the existing fuzz targets for a few hours. Establish a baseline of known-good behaviour. After the refactor, re-run; any new failure is a regression introduced by the change.

**Concurrent feature validation.** When you ship a new concurrent feature — a lock-free queue, a sharded cache — wrap it in `FuzzFeatureName` and run with `-race`. Soak it overnight in CI.

---

## Error Handling

In a fuzz target, "failure" has two flavours:

1. **Panic.** Any panic in the fuzz function or any code it calls is captured by the test runner, logged with a stack trace, and saved as a failing input under `testdata/fuzz/FuzzXxx/`.
2. **`t.Errorf` / `t.Fatalf`.** Explicit failure. Same outcome: input saved, reproducer printed.

Errors from the system under test are usually *not* failures. A parser returning `error` for malformed input is correct behaviour. The fuzz function should return early on expected errors:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    v, err := Parse(data)
    if err != nil {
        return // expected: parser rejected malformed input
    }
    if v == nil {
        t.Fatal("parser returned nil with no error")
    }
})
```

The only legitimate failures are invariant violations: round-trip mismatch, panic from supposedly-total code, race detector report, deadlock, infinite loop (caught by `-timeout`).

If the target uses concurrency and you want to fail on a timeout (suspected deadlock), wrap the fuzz body in a `select`:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    done := make(chan struct{})
    go func() {
        defer close(done)
        run(data)
    }()
    select {
    case <-done:
    case <-time.After(5 * time.Second):
        t.Fatal("possible deadlock")
    }
})
```

---

## Security Considerations

Fuzzing *is* a security tool. It is the same technology used by AFL, libFuzzer, and Google's OSS-Fuzz to find tens of thousands of CVEs.

- **Fuzz any code that touches untrusted input.** Network protocols, file parsers, user-supplied templates, query parsers — all are candidates.
- **Pair fuzzing with `-race` for crypto and auth code.** Authorisation bugs often hide behind rare interleavings that only fuzzing surfaces.
- **Treat fuzz-found panics as security incidents.** A panic in a parser is a denial-of-service vulnerability. A panic in cryptographic code can be a key-leak vulnerability through an error message.
- **Sanitise corpus inputs before committing.** Real-world data may contain PII. Strip it before adding to `testdata/`.
- **Never fuzz against a live database or external service.** Stub them. Fuzzers send millions of malformed requests; production systems are not the target.
- **Watch for resource exhaustion.** A fuzz input that triggers a 10-GB allocation is a denial-of-service finding. Cap allocations and goroutine counts inside the fuzz function and fail fast.

---

## Performance Tips

- **Run fuzz tests in their own job.** Do not mix fuzzing with unit tests in CI. Fuzzing wants a long time-budget; unit tests want speed.
- **Use `-parallel`.** The fuzzer starts `GOMAXPROCS` worker processes by default. On a 16-core machine you get 16-way mutation in parallel.
- **Seed well.** A good seed corpus reaches deep coverage in seconds. A bad one wastes hours discovering the obvious.
- **Use `-fuzzminimizetime=10s`.** Minimisation can dominate runtime. Cap it.
- **Keep the fuzz function cheap.** Per-iteration overhead dominates. Avoid I/O, avoid heavy allocations, avoid logging.
- **Run shorter, more frequently.** A nightly `-fuzztime=30m` per target finds more bugs than a weekly `-fuzztime=7d` — fresh seed corpora explore broader.
- **Shard targets across CI workers.** One fuzz target per worker process, parallelised by CI matrix, gives near-linear speedup.

---

## Best Practices

- **Always pair fuzzing of concurrent code with `-race`.** Without it you lose half the value.
- **Write invariants, not examples.** `f.Fuzz` is for properties; `t.Run` table tests are for examples.
- **Commit every reproducer.** `testdata/fuzz/` is part of your test suite.
- **Run fuzzing locally before pushing.** A quick `-fuzztime=30s` catches the obvious before CI does.
- **Have at least one fuzz target per public input-handling function.** Aim for coverage of attack surface.
- **Stub all sources of non-determinism.** Time, RNGs, network. A fuzz failure must reproduce.
- **Use `f.Helper()` in shared assertion helpers.** Makes stack traces point at the fuzz function, not the helper.
- **Document each fuzz target.** Why does it exist? What invariant does it check?

---

## Edge Cases & Pitfalls

- **The fuzz function must be deterministic.** If it depends on `time.Now()`, `rand` without a seeded source, or external state, failures become unreproducible.
- **The fuzz function must be total.** Any panic on any input is a finding. If your input decoder can panic, fix the decoder; the fuzzer is not the place to test it.
- **Long-running iterations starve the fuzzer.** A fuzz function that takes 10 seconds per call is too slow. Cap loop bounds derived from input.
- **`f.Add` panics if the seed type mismatches.** All seeds must agree on the parameter types.
- **A failing seed crashes `go test` before fuzzing starts.** Fix seed regressions first.
- **`testdata/fuzz/` is part of the source tree.** Do not `.gitignore` it.
- **`$GOCACHE/fuzz/` can grow large.** Periodically `go clean -fuzzcache`.
- **The race detector slows the fuzzer 5–10×.** Expect lower iteration rates with `-race`. The trade-off is worth it.

---

## Common Mistakes

### Mistake 1: Forgetting `-race`

```
go test -fuzz=FuzzConcurrentQueue -fuzztime=5m   # missing -race
```

This finds panics but no data races. For concurrent code, always add `-race`.

### Mistake 2: Letting the fuzz function depend on time

```go
f.Fuzz(func(t *testing.T, data []byte) {
    start := time.Now()
    Parse(data)
    if time.Since(start) > 100*time.Millisecond {
        t.Fatal("slow")
    }
})
```

The fuzzer cannot reproduce a timing failure. The minimiser will report inconsistent results.

### Mistake 3: Asserting on outputs you cannot predict

```go
f.Fuzz(func(t *testing.T, data []byte) {
    v, err := Parse(data)
    if err == nil && len(v) == 0 {
        t.Fatal("empty parse")
    }
})
```

Empty results are usually valid (`Parse([]byte("[]"))` returns `[]`). The "failure" is in the assertion, not the code.

### Mistake 4: Not committing `testdata/fuzz/`

A new developer pulls the repo, runs `go test`, sees no regression coverage of last week's bug. The corpus is part of the test suite. Commit it.

### Mistake 5: Running fuzzing forever in CI without a budget

`-fuzztime` defaults to forever. Without a budget, a CI job hangs. Always set `-fuzztime`.

### Mistake 6: Reading `data` without bounds checks

```go
f.Fuzz(func(t *testing.T, data []byte) {
    first := data[0]  // panics on empty input — caught by the fuzzer as a failure!
})
```

If the fuzz function itself panics, you get a failing input that says nothing about the system under test. Always handle empty / short inputs.

### Mistake 7: Sharing state across fuzz iterations

```go
m := newMap()
f.Fuzz(func(t *testing.T, data []byte) {
    m.Set(string(data), 1) // m persists across iterations!
})
```

Each iteration must be independent. Create state inside the fuzz function.

---

## Common Misconceptions

- **"Fuzzing replaces unit tests."** It complements them. Unit tests describe known behaviour; fuzzing finds unknown bugs.
- **"Fuzzing is only for parsers."** Parsers are the easiest target. Any function over `[]byte`, including state machines, is fair game.
- **"`-fuzz` runs my existing tests."** No. With `-fuzz=FuzzX`, the fuzzer focuses on `FuzzX`. Use `-run` separately to run other tests.
- **"`-race` finds all races."** It finds races that *happen* during the run. The fuzzer's job is to make rare races happen.
- **"Fuzzing is non-deterministic."** Each iteration is. The corpus is deterministic — committed seeds re-run identically.
- **"I need third-party libraries."** For 90% of cases the built-in fuzzer is enough. `rapid` and `gopter` are for richer property-based scenarios.
- **"Fuzzing is slow."** Per-iteration it can be fast — millions of iterations per CPU-hour. What is slow is *human-driven* fuzzing; let CI do it.

---

## Tricky Points

### Tricky: `f.Add` accepts variadic `any`, but the types are checked at runtime

```go
f.Add("hi", 7)
f.Add("bye", "oops") // panics at runtime when go test starts the fuzzer
```

The shape of every seed must match the shape of every other seed and the fuzz function signature.

### Tricky: `[]byte` and `string` are distinct in the fuzz API

`f.Add([]byte("hi"))` is *not* the same as `f.Add("hi")`. The fuzz function must take the same type.

### Tricky: `*testing.T` inside the fuzz function is not the outer `*testing.F`

You cannot call `t.Parallel()` on it in a way that changes fuzz worker behaviour. The fuzzer parallelises across worker *processes*, not across `t.Parallel()`.

### Tricky: `f.Skip` skips the entire fuzz target, not an iteration

To skip *one* iteration, call `t.Skip()` inside the fuzz function.

### Tricky: Coverage is per-package

The fuzzer measures coverage of the package being fuzzed, not the entire program. Bugs in transitively imported packages are still findable, but the coverage signal does not optimise for them.

---

## Test

How to test that your fuzz target works:

1. **Run with no flags.** `go test ./...` should run the seeds and pass.
2. **Run with `-fuzz`.** `go test -fuzz=FuzzXxx -fuzztime=10s`. Should report iteration count, no failures.
3. **Inject a bug.** Temporarily break the system under test. Re-run. The fuzzer should find the bug within seconds. Revert.
4. **Verify the regression mechanism.** After a real find, the input is saved to `testdata/fuzz/`. Delete the bug fix, run `go test` (no `-fuzz`), it should fail on the committed reproducer.
5. **Run with `-race`.** Even on the seed corpus. Catches any obvious race the test author missed.

---

## Tricky Questions

**Q: I see "skipping fuzzing test on non-linux platform" — what is happening?**
A: Some early `1.18` versions limited fuzzing to certain OSes. From `1.19` onward fuzzing works on Linux, macOS, Windows. Upgrade.

**Q: My fuzz target only runs the seed corpus even with `-fuzz`. Why?**
A: Check that the target name matches the pattern exactly. `-fuzz=FuzzParse` matches `FuzzParse`, not `FuzzParser`. Use a regex like `-fuzz=^FuzzParse$`.

**Q: Why does `go test -fuzz=Foo` complain "no fuzz tests match"?**
A: The function must start with `Fuzz` and take `*testing.F`. Also, only one fuzz target can be selected per run.

**Q: Where do I commit a fuzz failure?**
A: The framework saves it under `testdata/fuzz/FuzzXxx/<hash>`. `git add testdata/fuzz/` and commit.

**Q: How do I run `go test -fuzz` in CI?**
A: Set `-fuzztime` to a budget (`5m`, `1h`). Use a matrix to run multiple targets in parallel.

**Q: Can I fuzz with `-race` and still get reasonable iteration rates?**
A: Yes, at 5–10× slowdown vs. plain fuzzing. Reduce the work per iteration to compensate.

---

## Cheat Sheet

```
# Run all seeds (no mutation):
go test ./...

# Mutate one target for 30 seconds:
go test -fuzz=FuzzParse -fuzztime=30s

# Mutate one target with race detector:
go test -fuzz=FuzzParse -fuzztime=30s -race

# Mutate one target with a specific iteration count:
go test -fuzz=FuzzParse -fuzztime=100000x

# Disable normal tests, fuzz only:
go test -run=^$ -fuzz=FuzzParse -fuzztime=1m

# Custom cache directory:
go test -fuzz=FuzzParse -fuzzcachedir=/tmp/fuzz-cache

# Clean generated corpus:
go clean -fuzzcache

# Limit minimisation time:
go test -fuzz=FuzzParse -fuzzminimizetime=10s
```

Fuzz target skeleton:

```go
func FuzzXxx(f *testing.F) {
    f.Add([]byte("seed1"))
    f.Add([]byte("seed2"))
    f.Fuzz(func(t *testing.T, data []byte) {
        // 1. Decode data into operations or arguments
        // 2. Run the system under test
        // 3. Assert invariants
    })
}
```

---

## Self-Assessment Checklist

- [ ] I can write a `FuzzXxx` function with `f.Add` and `f.Fuzz`.
- [ ] I know the difference between running with and without `-fuzz`.
- [ ] I know how to combine `-fuzz` and `-race`.
- [ ] I can locate the persistent corpus on disk.
- [ ] I know that `testdata/fuzz/FuzzXxx/` is committed.
- [ ] I can write at least three different invariants for a parser.
- [ ] I can encode a sequence of operations as `[]byte` and decode it in the fuzz function.
- [ ] I can stress-test a fuzz-found input by re-running it many times under `-race`.
- [ ] I know the basic flags: `-fuzz`, `-fuzztime`, `-fuzzminimizetime`, `-fuzzcachedir`.
- [ ] I can list three categories of bugs the fuzzer commonly finds.

---

## Summary

Concurrent fuzzing in Go is the combination of two tools that already existed independently: the native fuzzer in `testing.F` (Go 1.18+) and the race detector (`-race`). Together they form a near-effortless way to find rare data races on rare inputs. You write seed inputs with `f.Add`, an invariant in `f.Fuzz`, and let `go test -fuzz -race` run for minutes or hours. The fuzzer generates millions of inputs, the race detector watches every one, and any failure is minimised and saved under `testdata/fuzz/` so it stays fixed forever. The pattern works for parsers, encoders, state machines, and concurrent data structures. The discipline is: write invariants, not examples; commit reproducers; budget CI time; pair `-fuzz` with `-race` whenever the target uses goroutines.

---

## What You Can Build

- A fuzz target for any parser in your codebase.
- A regression-tested concurrent queue: every fuzz-found bug becomes a permanent test.
- A nightly CI job that fuzzes each parser for 10 minutes with `-race`.
- A property-based round-trip suite for every encoder/decoder pair.
- A state-machine fuzz harness that drives a concurrent server through random op sequences.

---

## Further Reading

- The Go blog: "Fuzzing is Beta Ready" (March 2021) and "Fuzzing in Go 1.18".
- The official `testing.F` docs at `pkg.go.dev/testing`.
- `golang.org/doc/security/fuzz/` — the security team's fuzzing guide.
- Dmitry Vyukov's original [`go-fuzz`](https://github.com/dvyukov/go-fuzz) repository — historical context.
- `pgregory.net/rapid` — property-based testing library.
- `github.com/leanovate/gopter` — older property-based testing library.

---

## Related Topics

- [Race Detector Deep Dive](../01-race-detector-deep/) — the other half of the `-fuzz -race` combo.
- [Deterministic Testing](../02-deterministic-testing/) — making fuzz failures reproducible.
- [WaitGroup in Tests](../03-waitgroup-in-tests/) — synchronising concurrent fuzz harnesses.
- [Mocking Time](../04-mocking-time/) — stubbing time inside fuzz functions.

---

## Diagrams & Visual Aids

### The fuzzing loop

```
        +---------------+
        |   Seed corpus |
        +-------+-------+
                |
                v
  +-------------+-------------+
  |  Mutate (bit flip, splice)|
  +-------------+-------------+
                |
                v
        +-------+-------+
        | Run fuzz func |  <-- with -race instrumentation
        +-------+-------+
                |
       +--------+---------+
       |                  |
       v                  v
  new coverage?      failure?
       |                  |
       v                  v
  save to corpus     minimise + save
                     to testdata/fuzz/
```

### How `-fuzz` and `-race` compose

```
  Input -----+
             |    +--------------+
             +--->| Race-built   |---> coverage report
                  | binary (TSan)|---> race report (if any)
                  +--------------+---> panic / t.Fatal? -> failure
```

### What lives where

```
my-module/
  parser/
    parser.go
    parser_fuzz_test.go    # FuzzParse lives here
    testdata/
      fuzz/
        FuzzParse/
          a3f7e1...         # committed failing inputs

$GOCACHE/
  fuzz/
    my-module/
      parser/
        FuzzParse/
          0/                # generated corpus, per-worker
          1/
```

### The funnel

```
  Millions of random bytes
            |
            v
  Coverage filter (keeps ~thousands)
            |
            v
  Failure detection (keeps ~tens)
            |
            v
  Minimisation (keeps the smallest)
            |
            v
  testdata/fuzz/FuzzXxx/<hash>  -> commit
```
