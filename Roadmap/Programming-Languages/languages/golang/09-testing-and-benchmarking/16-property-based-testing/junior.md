---
layout: default
title: Property-Based Testing — Junior
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/junior/
---

# Property-Based Testing — Junior

[← Back](../)

This page introduces property-based testing (PBT) from scratch. The goal is
that by the end you can write your first property using `pgregory.net/rapid`
and explain to a teammate what a property is and why it is different from
an example.

## 1. The problem with example-based tests

When you start writing tests you almost certainly write them like this:

```go
func TestReverse(t *testing.T) {
    got := Reverse([]int{1, 2, 3})
    want := []int{3, 2, 1}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v want %v", got, want)
    }
}
```

This is an **example-based test**. You pick a concrete input, you compute
the expected output by hand, you compare. If the test passes, you know
the function works **for that one example**.

But `Reverse` is supposed to work for **all** slices. What about the empty
slice? What about a slice of length one? What about a slice that contains
zeros and negative numbers? What about a slice with one billion elements?

Example-based tests force you to enumerate every interesting case by hand.
Humans are bad at this — we forget edge cases, especially when they look
"too trivial to test".

## 2. What a property looks like

Instead of writing inputs and outputs, write **a statement that should be
true for any valid input**. Such a statement is called a **property**.

For `Reverse` a good property is:

> Reversing a slice twice gives back the original slice.

In code, with no library yet:

```go
func propReverseTwiceIsIdentity(xs []int) bool {
    return reflect.DeepEqual(Reverse(Reverse(xs)), xs)
}
```

This function returns `true` if the property holds for the input `xs`. It
does not pick any specific `xs`. The next step is to let a library
generate hundreds of `xs` values and call this function for each.

## 3. The first property with `pgregory.net/rapid`

```go
package mypkg

import (
    "reflect"
    "testing"

    "pgregory.net/rapid"
)

func Reverse(xs []int) []int {
    out := make([]int, len(xs))
    for i, v := range xs {
        out[len(xs)-1-i] = v
    }
    return out
}

func TestReverseTwiceIsIdentity(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
        if !reflect.DeepEqual(Reverse(Reverse(xs)), xs) {
            t.Fatalf("reverse twice changed the slice: %v", xs)
        }
    })
}
```

What happens when you run `go test`:

1. `rapid.Check` calls the inner function 100 times by default.
2. Each call draws a random `[]int` of random length.
3. The property is checked. If it ever fails, rapid prints a counter-example.

Try injecting a bug into `Reverse` — change `len(xs)-1-i` to `len(xs)-i`.
Re-run. You will see something like:

```
--- FAIL: TestReverseTwiceIsIdentity (0.00s)
    rapid.go:...: [rapid] failed after 1 tests: index out of range
        Failed test seed: 1234567890
        Traceback:
            xs = []int{0}
```

rapid found the bug and **shrank** the input to the smallest one that
fails: a single-element slice.

## 4. Vocabulary

- **Property** — a statement that is true for any valid input.
- **Generator** — a thing that produces random inputs of a given type.
- **Shrinking** — reducing a failing input to a minimal one.
- **Seed** — the integer that drives the PRNG; used to replay a failure.
- **Counter-example** — the specific input that broke the property.

## 5. Common properties to memorise

You will see these patterns over and over.

### 5.1 Round-trip

> Decoding the encoding of `x` returns `x`.

```go
rapid.Check(t, func(t *rapid.T) {
    s := rapid.String().Draw(t, "s")
    b, err := json.Marshal(s)
    if err != nil { t.Fatal(err) }
    var out string
    if err := json.Unmarshal(b, &out); err != nil { t.Fatal(err) }
    if out != s {
        t.Fatalf("round-trip failed: %q -> %q", s, out)
    }
})
```

Round-trip is the bread and butter of PBT. Every codec, serializer, and
encoder is a candidate.

### 5.2 Idempotency

> Applying `f` twice is the same as applying it once.

```go
rapid.Check(t, func(t *rapid.T) {
    s := rapid.String().Draw(t, "s")
    once := strings.TrimSpace(s)
    twice := strings.TrimSpace(once)
    if once != twice {
        t.Fatalf("not idempotent")
    }
})
```

Many normalising functions should be idempotent: trim, lower, sort, dedup.

### 5.3 Length / size invariants

> The output has the same length as the input (or some specific relation).

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    ys := Reverse(xs)
    if len(ys) != len(xs) {
        t.Fatalf("length changed")
    }
})
```

### 5.4 Permutation

> The output contains the same elements as the input (in some order).

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    ys := append([]int(nil), xs...)
    sort.Ints(ys)
    if !sameMultiset(xs, ys) {
        t.Fatalf("sort lost elements")
    }
})

func sameMultiset(a, b []int) bool {
    if len(a) != len(b) { return false }
    counts := map[int]int{}
    for _, v := range a { counts[v]++ }
    for _, v := range b { counts[v]-- }
    for _, c := range counts {
        if c != 0 { return false }
    }
    return true
}
```

### 5.5 Sortedness

> The output is sorted.

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    ys := append([]int(nil), xs...)
    sort.Ints(ys)
    for i := 1; i < len(ys); i++ {
        if ys[i-1] > ys[i] {
            t.Fatalf("not sorted: %v", ys)
        }
    }
})
```

**Important**: sortedness alone is not enough. `func sort(xs) []int { return nil }`
returns a sorted slice for every input — empty list trivially. Always pair
sortedness with the permutation property.

## 6. Comparing PBT to fuzzing

Go 1.18+ ships `go test -fuzz`. Beginners often ask "is fuzz the same as
PBT?" The short answer: no.

| Aspect       | Native fuzz                            | PBT (rapid)                           |
|--------------|----------------------------------------|---------------------------------------|
| Input shape  | `[]byte` (or registered seed types)    | Any typed value via generators        |
| Goal         | Find panics / crashes                  | Verify a logical property             |
| Mutation     | Coverage-guided                        | Random with shrinking                 |
| Best for     | Parsers, decoders, untrusted input     | Pure functions, structured algorithms |

Both are useful. Don't pick one — use both where they fit.

## 7. Comparing PBT to example-based testing

Imagine you maintain `Median(xs []int) int`. With examples you might write:

```go
{[]int{1, 2, 3}, 2},
{[]int{1, 2}, 1},
{[]int{}, 0}, // by convention
```

With PBT you write a property:

> Median equals the middle element of the sorted input.

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOfN(rapid.Int(), 1, 100).Draw(t, "xs")
    sorted := append([]int(nil), xs...)
    sort.Ints(sorted)
    want := sorted[len(sorted)/2]
    got := Median(xs)
    if got != want {
        t.Fatalf("median got %d want %d for %v", got, want, xs)
    }
})
```

PBT does not replace the empty-slice example — you need that too, because
the property's generator skips zero-length slices. **PBT and examples are
complementary.**

## 8. Reading a failure

When a property fails, rapid prints:

```
--- FAIL: TestSortIsPermutation (0.00s)
    rapid.go:...: [rapid] failed after 17 tests
        Traceback:
            in = []int{0, 0}
        Failed test seed: 9876543210
```

Two pieces of information matter:

- The **minimal counter-example** (`in = []int{0, 0}`).
- The **seed** (`9876543210`), which you can use to replay the failure
  with `-rapid.seed=9876543210`.

If the failure does not reproduce with the seed, you have a non-deterministic
property (time, goroutines, global state). Fix that first.

## 9. A first checklist

Before submitting your first PBT test, run through:

- [ ] The property is true for **any** valid input, not just one.
- [ ] You generate inputs with `rapid.*`, not by hand.
- [ ] On failure, the test calls `t.Fatalf` with the input.
- [ ] You also have at least one example-based test for the obvious case
      (often empty input, which generators may not produce).
- [ ] The property is deterministic given the seed.

## 10. Mini-exercise

Write a property for `strings.Contains`:

> `strings.Contains(haystack, needle)` is true if and only if there exists
> an index `i` such that `haystack[i:i+len(needle)] == needle`.

Sketch:

```go
rapid.Check(t, func(t *rapid.T) {
    h := rapid.String().Draw(t, "h")
    n := rapid.String().Draw(t, "n")
    got := strings.Contains(h, n)
    want := false
    for i := 0; i+len(n) <= len(h); i++ {
        if h[i:i+len(n)] == n { want = true; break }
    }
    if got != want {
        t.Fatalf("Contains(%q, %q): got %v want %v", h, n, got, want)
    }
})
```

That brute-force reference is your **oracle**: a slow, obviously correct
implementation that you trust to compare against the real one. The oracle
pattern is one of the most powerful PBT techniques you can learn.

## 11. Generators in `rapid` — the beginner subset

So far we have used three generators: `rapid.Int()`, `rapid.SliceOf(...)`,
and `rapid.String()`. Here is the subset you need at the junior level.

### 11.1 Primitive generators

```go
rapid.Bool()                  // random bool
rapid.Int()                   // any int (full range)
rapid.IntRange(0, 100)        // int in [0, 100]
rapid.Int32()
rapid.Int64()
rapid.Uint()
rapid.Float64()
rapid.Float64Range(0.0, 1.0)
rapid.Byte()
rapid.Rune()
```

`rapid.Int()` covers the full range from `math.MinInt` to `math.MaxInt`.
That sounds scary but is exactly what you want: PBT should explore the
extreme edges so you discover overflow bugs.

### 11.2 String generators

```go
rapid.String()                  // any UTF-8 string
rapid.StringN(0, 100, -1)       // string with length in [0, 100]
rapid.StringOf(rapid.Rune())    // string of given runes
rapid.StringMatching(`[a-z]+`)  // matches regex
```

The third argument of `StringN` is the maximum byte length; -1 means
unbounded.

`StringMatching` is fantastic for emails, identifiers, and other formats
where you do not want random Unicode noise.

### 11.3 Container generators

```go
rapid.SliceOf(rapid.Int())                 // []int, random length
rapid.SliceOfN(rapid.Int(), 1, 100)        // []int with 1..100 elements
rapid.MapOf(rapid.String(), rapid.Int())   // map[string]int
```

### 11.4 Choice generators

```go
rapid.Just(42)                              // always 42
rapid.OneOf(rapid.Just(0), rapid.IntRange(1, 1<<20))
rapid.SampledFrom([]int{1, 2, 3, 5, 8})    // pick from a fixed set
```

`OneOf` is the way to mix biased edge values with general random ones.

## 12. Worked example: `Sort`

Let us write a complete test file for `sort.Ints` using properties only.

```go
package mypkg_test

import (
    "sort"
    "testing"

    "pgregory.net/rapid"
)

// Property 1: output has the same length as input.
func TestSortIntsPreservesLength(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
        cp := append([]int(nil), in...)
        sort.Ints(cp)
        if len(cp) != len(in) {
            t.Fatalf("length changed from %d to %d", len(in), len(cp))
        }
    })
}

// Property 2: output is sorted.
func TestSortIntsIsSorted(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
        cp := append([]int(nil), in...)
        sort.Ints(cp)
        for i := 1; i < len(cp); i++ {
            if cp[i-1] > cp[i] {
                t.Fatalf("not sorted at index %d: %v", i, cp)
            }
        }
    })
}

// Property 3: output is a permutation of the input.
func TestSortIntsIsPermutation(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
        cp := append([]int(nil), in...)
        sort.Ints(cp)
        m := map[int]int{}
        for _, v := range in { m[v]++ }
        for _, v := range cp { m[v]-- }
        for k, c := range m {
            if c != 0 {
                t.Fatalf("element %d count differs by %d", k, c)
            }
        }
    })
}

// Property 4: idempotency.
func TestSortIntsIdempotent(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
        once := append([]int(nil), in...)
        sort.Ints(once)
        twice := append([]int(nil), once...)
        sort.Ints(twice)
        for i := range once {
            if once[i] != twice[i] {
                t.Fatalf("not idempotent at %d", i)
            }
        }
    })
}
```

Four properties, no example. Together they fully specify `sort.Ints` up to
stability (which `sort.Ints` does not guarantee anyway).

Notice that **none** of the properties alone is sufficient. Property 2
without 3 admits `func sort(xs) []int { return nil }`. Property 3 without
2 admits the identity function. The set forms the spec.

## 13. The "oracle" pattern

When you cannot directly state the property, write a **reference
implementation** and compare. The reference is allowed to be slow and
obviously correct.

```go
// Slow but obviously correct.
func referenceMax(xs []int) int {
    m := math.MinInt
    for _, v := range xs { if v > m { m = v } }
    return m
}

func TestFastMax(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        xs := rapid.SliceOfN(rapid.Int(), 1, 1000).Draw(t, "xs")
        if FastMax(xs) != referenceMax(xs) {
            t.Fatalf("disagree for %v", xs)
        }
    })
}
```

Use the oracle pattern whenever you optimise an algorithm: keep the naive
version as a reference, prove the fast one matches.

## 14. Common beginner mistakes

### 14.1 Forgetting that `Draw` only works inside a property

`rapid.SliceOf(...)` returns a generator, not a value. You only get a
value by calling `.Draw(t, "label")` inside the function passed to
`rapid.Check`. The label is a human-readable name used in failure reports.

```go
// Wrong
xs := rapid.SliceOf(rapid.Int())
// Right
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    _ = xs
})
```

### 14.2 Mutating the generated value

`rapid` reuses the underlying memory between runs. If you mutate the
slice, you risk corrupting future runs. Always **copy first** if you
mutate:

```go
in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
cp := append([]int(nil), in...) // copy
sort.Ints(cp)
```

This is also good hygiene because your property body then reads `in`
unchanged.

### 14.3 Non-deterministic properties

If your property calls `time.Now()`, `rand.Intn` (unseeded), or reads
environment variables, you cannot reproduce a failure from its seed.
Keep the property body pure.

### 14.4 Trivially-true properties

```go
require.True(t, len(out) >= 0)
```

Lengths are always non-negative. The property passes trivially. Review
each property and ask: "could a buggy implementation pass this?" If yes,
strengthen it.

## 15. When PBT is overkill at the junior level

If the function is:

- Tiny, with one or two discrete cases ("return user role string").
- Mostly glue ("call this DB query then that API").
- A simple lookup table.

Stick with example-based tests. PBT shines when there is **structure** —
a relation between input and output that holds for many inputs.

## 16. Installing `pgregory.net/rapid`

PBT is not in the standard library — `testing/quick` is, but as we will
see in section 22 below it is limited. The recommended library is
`pgregory.net/rapid`.

```bash
go get pgregory.net/rapid@latest
```

There are no other dependencies. The package itself depends only on the
standard library. Your `go.mod` will gain a single line:

```
require pgregory.net/rapid v1.x.x
```

Once installed, import it:

```go
import "pgregory.net/rapid"
```

Run your property tests with `go test` as usual. To see verbose generation
labels and seeds, pass the `-rapid.v` flag:

```
go test -rapid.v ./...
```

To reproduce a failing run with a known seed:

```
go test -run=TestSortIntsIsPermutation -rapid.seed=9876543210
```

## 17. Anatomy of a `rapid.Check` call

Let us unpack what happens line by line:

```go
func TestExample(t *testing.T) {                 // 1
    rapid.Check(t, func(t *rapid.T) {            // 2
        n := rapid.IntRange(0, 100).Draw(t, "n") // 3
        if n*2/2 != n {                          // 4
            t.Fatalf("math broken for %d", n)    // 5
        }
    })
}
```

1. Standard Go test.
2. `rapid.Check` accepts a `*testing.T` and a function. The function takes
   a `*rapid.T`, which embeds `*testing.T` and adds drawing methods.
3. `Draw` consumes random bytes from the underlying source and returns
   a value of the right type. The label `"n"` appears in failure output.
4. The property body — a regular Go expression.
5. `t.Fatalf` (inherited from `*testing.T`) signals a counter-example.

`rapid.Check` repeats steps 3-5 a hundred times. If any iteration fails,
rapid kicks off the **shrinking** phase: it tries to find a smaller input
that still triggers the failure. Once shrinking stabilises, the minimal
counter-example is reported alongside the failing seed.

## 18. Reading rapid's failure output more carefully

A real failure log looks like:

```
--- FAIL: TestSortIsPermutation (0.01s)
    sort_test.go:23: [rapid] failed after 23 tests
        Traceback:
            in = []int{1, 0}
        Original failing input:
            in = []int{-7, 42, 0, 0, 1, -3, 1024}
        Failed test seed: 1737044312000000
        Total elapsed time: 7ms
```

Three useful pieces:

- **Tests until failure** — 23. The first 22 inputs passed.
- **Minimal counter-example** — `[]int{1, 0}` after shrinking.
- **Original failing input** — what the random generator first produced.

The minimal counter-example is what you should reason about. Often it is
the smallest, most obvious bug:

> "If the slice is sorted in descending order, my function returns
> the wrong answer."

## 19. Equality with `cmp.Diff`

`reflect.DeepEqual` is enough for primitive types but not great for
diffing complex types. Use `github.com/google/go-cmp/cmp`:

```go
import "github.com/google/go-cmp/cmp"

if diff := cmp.Diff(want, got); diff != "" {
    t.Fatalf("mismatch (-want +got):\n%s", diff)
}
```

For PBT this matters because counter-examples may be large structs.
`cmp.Diff` shows you the exact field that differs.

## 20. Properties for arithmetic

Even tiny pure functions get value from PBT.

### 20.1 Addition is commutative

```go
rapid.Check(t, func(t *rapid.T) {
    a := rapid.Int().Draw(t, "a")
    b := rapid.Int().Draw(t, "b")
    if a+b != b+a {
        t.Fatalf("addition not commutative")
    }
})
```

This is a trivial test, but it exercises rapid's generator and is a good
sanity check for your setup.

### 20.2 Addition is associative

```go
rapid.Check(t, func(t *rapid.T) {
    a := rapid.Int().Draw(t, "a")
    b := rapid.Int().Draw(t, "b")
    c := rapid.Int().Draw(t, "c")
    if (a+b)+c != a+(b+c) {
        t.Fatalf("addition not associative for %d %d %d", a, b, c)
    }
})
```

### 20.3 Zero is the identity

```go
rapid.Check(t, func(t *rapid.T) {
    a := rapid.Int().Draw(t, "a")
    if a+0 != a {
        t.Fatalf("zero is not identity")
    }
})
```

If you ever swap from `int` to a "decimal" library, these properties will
catch silent regressions in basic arithmetic laws.

## 21. Properties for slices

### 21.1 Append preserves prefix

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    ys := rapid.SliceOf(rapid.Int()).Draw(t, "ys")
    out := append(append([]int(nil), xs...), ys...)
    for i, v := range xs {
        if out[i] != v {
            t.Fatalf("prefix lost at index %d", i)
        }
    }
})
```

### 21.2 Reverse preserves length

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    ys := Reverse(xs)
    if len(ys) != len(xs) {
        t.Fatalf("reverse changed length")
    }
})
```

### 21.3 Reverse reverses sortedness

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    sorted := append([]int(nil), xs...)
    sort.Ints(sorted)
    reversed := Reverse(sorted)
    for i := 1; i < len(reversed); i++ {
        if reversed[i-1] < reversed[i] {
            t.Fatalf("reverse of sorted is not descending")
        }
    }
})
```

## 22. `testing/quick` for comparison

Before rapid, the stdlib offered `testing/quick`. It still works and is
worth knowing because it has zero dependencies.

```go
import "testing/quick"

func TestReverseTwiceQuick(t *testing.T) {
    f := func(xs []int) bool {
        return reflect.DeepEqual(Reverse(Reverse(xs)), xs)
    }
    if err := quick.Check(f, nil); err != nil {
        t.Fatal(err)
    }
}
```

Differences from rapid:

- No shrinking. The failure prints the original random input.
- Biases are limited; uniform random over the full type range.
- Custom generators require implementing the `quick.Generator` interface.

Use `quick` for one-line sanity checks in tiny packages with no
dependencies; reach for rapid when you want shrinking and structured
generators.

## 23. Setting up Go's standard test environment

If this is your first time using `go test`, here is the minimum:

```bash
go mod init mypkg
go get pgregory.net/rapid@latest
mkdir -p sort_test_dir   # or just put tests in main package
```

In `mypkg_test.go`:

```go
package mypkg

import (
    "sort"
    "testing"
    "pgregory.net/rapid"
)

func TestSort(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
        cp := append([]int(nil), in...)
        sort.Ints(cp)
        for i := 1; i < len(cp); i++ {
            if cp[i-1] > cp[i] {
                t.Fatalf("not sorted")
            }
        }
    })
}
```

Run:

```bash
go test -v ./...
```

A green test means "the property held across 100 random inputs" — much
stronger than "one example passed".

## 24. Worked walkthrough: testing a `Stack`

To bring it all together, here is a small generic stack and a full set of
properties that specify its behaviour.

```go
type Stack[T any] struct {
    data []T
}

func (s *Stack[T]) Push(v T)        { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool)  {
    var zero T
    if len(s.data) == 0 { return zero, false }
    last := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return last, true
}
func (s *Stack[T]) Len() int { return len(s.data) }
```

### 24.1 Property: push then pop returns the pushed value

```go
func TestStackPushPop(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        v := rapid.Int().Draw(t, "v")
        s := &Stack[int]{}
        s.Push(v)
        got, ok := s.Pop()
        if !ok || got != v {
            t.Fatalf("push %d then pop got (%d,%v)", v, got, ok)
        }
    })
}
```

### 24.2 Property: pop reverses push order

For any sequence of pushes, popping returns them in reverse order.

```go
func TestStackPopReverses(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        vs := rapid.SliceOf(rapid.Int()).Draw(t, "vs")
        s := &Stack[int]{}
        for _, v := range vs { s.Push(v) }
        got := make([]int, 0, len(vs))
        for {
            v, ok := s.Pop()
            if !ok { break }
            got = append(got, v)
        }
        for i, v := range vs {
            want := vs[len(vs)-1-i]
            if got[i] != want {
                t.Fatalf("position %d: got %d want %d", i, got[i], want)
            }
        }
    })
}
```

### 24.3 Property: Len matches push minus pop

```go
func TestStackLenInvariant(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        ops := rapid.SliceOf(rapid.Bool()).Draw(t, "ops") // true=push, false=pop
        s := &Stack[int]{}
        pushed := 0
        popped := 0
        for _, push := range ops {
            if push {
                s.Push(0)
                pushed++
            } else {
                if _, ok := s.Pop(); ok {
                    popped++
                }
            }
            if s.Len() != pushed-popped {
                t.Fatalf("len %d != pushed-popped %d", s.Len(), pushed-popped)
            }
        }
    })
}
```

Note how the third property generates a **sequence of operations**, not
just a single input. This is the first step toward stateful PBT, which
we cover at the senior level.

## 25. Choosing what to make a property

Ask three questions:

1. **Is there a relationship?** "For all inputs satisfying X, the output
   satisfies Y." If yes, you have a property.
2. **Is there a reference?** "I have a slow obvious version and a fast
   optimised version." Compare them.
3. **Is there an invariant?** "The output is always sorted / non-empty /
   smaller than the input." Make it a property.

If none of these apply, the function is probably better tested with
explicit examples.

## 26. Worked example: `Set`

A set type built on a map.

```go
type Set struct { m map[int]struct{} }

func NewSet() *Set                  { return &Set{m: map[int]struct{}{}} }
func (s *Set) Add(v int)            { s.m[v] = struct{}{} }
func (s *Set) Has(v int) bool       { _, ok := s.m[v]; return ok }
func (s *Set) Len() int             { return len(s.m) }
func (s *Set) Remove(v int)         { delete(s.m, v) }
```

### 26.1 Add then Has returns true

```go
rapid.Check(t, func(t *rapid.T) {
    v := rapid.Int().Draw(t, "v")
    s := NewSet()
    s.Add(v)
    if !s.Has(v) {
        t.Fatalf("Has(%d) after Add(%d) is false", v, v)
    }
})
```

### 26.2 Add is idempotent on size

```go
rapid.Check(t, func(t *rapid.T) {
    v := rapid.Int().Draw(t, "v")
    s := NewSet()
    s.Add(v)
    once := s.Len()
    s.Add(v)
    twice := s.Len()
    if once != twice {
        t.Fatalf("adding %d twice changed Len: %d -> %d", v, once, twice)
    }
})
```

### 26.3 Remove undoes Add

```go
rapid.Check(t, func(t *rapid.T) {
    v := rapid.Int().Draw(t, "v")
    s := NewSet()
    s.Add(v)
    s.Remove(v)
    if s.Has(v) {
        t.Fatalf("element survived Remove")
    }
})
```

### 26.4 Len bounded by adds

```go
rapid.Check(t, func(t *rapid.T) {
    vs := rapid.SliceOf(rapid.Int()).Draw(t, "vs")
    s := NewSet()
    for _, v := range vs { s.Add(v) }
    if s.Len() > len(vs) {
        t.Fatalf("Len %d exceeds adds %d", s.Len(), len(vs))
    }
})
```

## 27. Common questions

**Q: My property test passes after 100 random inputs. Is that proof?**

No. PBT is a *strong* check but not a proof. 100 inputs is enough to
catch the vast majority of structural bugs but cannot exhaust every
possible value. For very critical code, raise `-rapid.checks` and run
overnight, or pair PBT with formal proof tools.

**Q: My test fails locally but passes in CI.**

You probably have non-determinism. Check for:

- `time.Now()` inside the property or the unit under test.
- Map iteration leaking into output.
- Concurrent goroutines without synchronisation.
- Different Go version or platform exposing different float behaviour.

Pin the seed in CI to expose the same input the local run found.

**Q: How do I generate `time.Time` values?**

```go
genTime := rapid.Custom(func(t *rapid.T) time.Time {
    sec := rapid.Int64Range(0, 1<<32).Draw(t, "sec")
    return time.Unix(sec, 0).UTC()
})
```

Always normalise the location to UTC so comparisons are reliable.

**Q: I cannot express the expected output as a closed form. What do I do?**

Use the **oracle pattern** (section 13) — a slow obviously-correct
reference — or assert weaker invariants (output length, presence of
required substrings, no error).

**Q: When does a property fail to find a bug that exists?**

When the generator does not produce the triggering input. If your bug
fires only on strings containing a NUL byte and the generator only emits
printable ASCII, no number of runs will help. Widen the generator.

## 28. Glossary

- **PBT** — property-based testing.
- **Property** — a logical statement about all inputs.
- **Generator** — a builder of random typed values.
- **Shrinker** — a tool that reduces a failing input to a minimal one.
- **Seed** — a number that determines the entire random sequence.
- **Counter-example** — the input that breaks a property.
- **Oracle** — a slow, obviously-correct reference implementation.
- **Round-trip** — `decode(encode(x)) = x`.
- **Idempotent** — `f(f(x)) = f(x)`.

## 29. A 10-minute starter exercise

Try this in a scratch directory:

```bash
mkdir pbt-demo && cd pbt-demo
go mod init pbt-demo
go get pgregory.net/rapid@latest
```

Create `abs_test.go`:

```go
package pbtdemo

import (
    "testing"
    "pgregory.net/rapid"
)

func Abs(x int) int {
    if x < 0 { return -x }
    return x
}

func TestAbsNonNegative(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        x := rapid.Int().Draw(t, "x")
        if Abs(x) < 0 {
            t.Fatalf("Abs(%d) = %d is negative", x, Abs(x))
        }
    })
}
```

Run `go test`. You will likely see a failure for `math.MinInt`:
`-math.MinInt` overflows back to `math.MinInt`, so `Abs(math.MinInt)` is
negative. rapid will shrink the failing input down to that value.

This is the canonical "PBT found my edge case for me" experience. It is
also why senior engineers reach for PBT before anything else when they
work on numeric or algorithmic code.

## 30. Beyond `t.Fatalf` — comparing with `cmp.Diff` and `assert`

Most of our examples have used `t.Fatalf` directly. In real codebases you
will see assertion libraries like `testify`:

```go
import "github.com/stretchr/testify/require"

rapid.Check(t, func(t *rapid.T) {
    s := rapid.String().Draw(t, "s")
    b, err := json.Marshal(s)
    require.NoError(t, err)
    var out string
    require.NoError(t, json.Unmarshal(b, &out))
    require.Equal(t, s, out)
})
```

`require.NoError` and `require.Equal` call `t.Fatal` on failure, so they
play well with `rapid.Check`. Use whatever style matches your project.

The one warning: do not use `assert.Equal` (which does **not** stop the
test). PBT relies on stopping at the first failure so the shrinker can
narrow it down.

## 31. Properties that involve floats

Floats deserve special care because of precision:

```go
rapid.Check(t, func(t *rapid.T) {
    a := rapid.Float64Range(-1e6, 1e6).Draw(t, "a")
    b := rapid.Float64Range(-1e6, 1e6).Draw(t, "b")
    if math.Abs((a+b)-(b+a)) > 1e-9 {
        t.Fatalf("addition not commutative: a=%g b=%g", a, b)
    }
})
```

A few rules of thumb:

- Use `Float64Range` with realistic bounds.
- Compare with a tolerance (`math.Abs(diff) < eps`), not `==`.
- Watch for NaN: by default `rapid.Float64()` emits NaN and Inf. Filter
  if your function does not handle them.

## 32. A note on test naming

Pick names that read like the property:

- `TestSortIsPermutation` — yes.
- `TestSortWorks` — no.
- `TestSortHandlesEdgeCases` — no.

The name should remind you, six months later, *which* invariant this
property captures. With four or five properties per function, you will
appreciate the discipline.

## 33. Final cheat sheet

| You want…                            | Use                                            |
|--------------------------------------|------------------------------------------------|
| Random int                           | `rapid.Int()` / `rapid.IntRange(lo, hi)`       |
| Random string                        | `rapid.String()` / `rapid.StringMatching(re)`  |
| Random slice                         | `rapid.SliceOf(g)` / `rapid.SliceOfN(g, lo, hi)` |
| Random struct                        | `rapid.Custom(func(t *rapid.T) T { ... })`     |
| Pick one of several values           | `rapid.OneOf(...)`, `rapid.SampledFrom(...)`   |
| Project a generator                  | `rapid.Map(g, fn)`                             |
| Filter (use sparingly)               | `rapid.Filter(g, pred)`                        |
| Run a property                       | `rapid.Check(t, func(t *rapid.T) { ... })`    |
| Replay a failure                     | `-rapid.seed=N` or `-rapid.failfile=PATH`      |
| More runs                            | `-rapid.checks=N` (default 100)                |

## 34. One more worked example: queue

To consolidate, here is a FIFO queue.

```go
type Queue[T any] struct{ data []T }

func (q *Queue[T]) Enq(v T)        { q.data = append(q.data, v) }
func (q *Queue[T]) Deq() (T, bool) {
    var z T
    if len(q.data) == 0 { return z, false }
    v := q.data[0]
    q.data = q.data[1:]
    return v, true
}
func (q *Queue[T]) Len() int { return len(q.data) }
```

Properties:

```go
// FIFO order: dequeue returns values in the order they were enqueued.
func TestQueueFIFO(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        vs := rapid.SliceOf(rapid.Int()).Draw(t, "vs")
        q := &Queue[int]{}
        for _, v := range vs { q.Enq(v) }
        for i, v := range vs {
            got, ok := q.Deq()
            if !ok || got != v {
                t.Fatalf("position %d: got (%d, %v) want (%d, true)",
                    i, got, ok, v)
            }
        }
        if _, ok := q.Deq(); ok {
            t.Fatalf("Deq on empty queue returned ok")
        }
    })
}

// Len is conserved.
func TestQueueLenInvariant(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        ops := rapid.SliceOf(rapid.Bool()).Draw(t, "ops")
        q := &Queue[int]{}
        expected := 0
        for _, push := range ops {
            if push {
                q.Enq(0); expected++
            } else if _, ok := q.Deq(); ok {
                expected--
            }
            if q.Len() != expected {
                t.Fatalf("Len mismatch: got %d want %d", q.Len(), expected)
            }
        }
    })
}
```

Two properties — order and size — together fully specify the queue
interface at the level of a junior engineer's responsibility.

## 35. A note on writing failure messages

The failure message your property prints determines how fast you can
debug. Compare:

```go
// Poor
t.Fatal("mismatch")

// Better
t.Fatalf("mismatch: input=%v expected=%v got=%v", in, want, got)

// Best
t.Fatalf("Sort permutation property failed:\n  input: %v\n  output: %v\n  diff counts: %v",
    in, out, multisetDiff(in, out))
```

Spend the extra 30 seconds writing the message. You will thank yourself
when CI fails three months later.

## 36. Recap and next steps

- A property is a statement true for any valid input.
- `rapid.Check` calls your function with many random inputs and shrinks
  failures to minimal counter-examples.
- Common properties: round-trip, idempotency, permutation, sortedness,
  identity.
- Always pair PBT with example tests — examples cover trivial corner
  cases generators may miss.
- Avoid non-determinism, mutation of generated values, and trivial
  predicates.

Next pages:

- Middle: custom generators, JSON round-trip, monotonicity, gopter.
- Senior: stateful PBT (`rapid.StateMachine`), shrinking strategy,
  combining with fuzz.
- Professional: running PBT in CI, replay seeds, mutation testing.
