# `min`, `max` & `clear` Built-ins — Junior Level

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
> Focus: "What do `min`, `max`, and `clear` do?" and "Why did Go add them as built-ins instead of library functions?"

For most of Go's history there was no `min` or `max` in the language. If you wanted the larger of two integers you wrote it by hand:

```go
func maxInt(a, b int) int {
    if a > b {
        return a
    }
    return b
}
```

Every project had a tiny `maxInt`, `minInt`, `maxFloat`, sometimes a dozen near-identical copies. The standard library shipped `math.Max` and `math.Min`, but those only work on `float64` and carry surprising IEEE-754 rules. Generics (Go 1.18) let you write *one* generic helper, but you still had to import it, and a generic call has a small instantiation cost.

Go 1.21 ended this by adding three built-in functions to the language itself:

```go
min(3, 7)            // 3
max(3, 7)            // 7
max(2, 9, 4, 1)      // 9   — variadic, any number of args
min("go", "rust")    // "go" — works on strings too

clear(m)             // empties a map m
clear(s)             // zeroes every element of a slice s
```

You do not import anything. You do not declare a type parameter. `min`, `max`, and `clear` are *predeclared identifiers* — the same category as `len`, `cap`, `append`, and `make`. They are always available.

After reading this file you will:
- Know exactly what `min`, `max`, and `clear` do, with their outputs
- Understand why they are built-ins and not ordinary functions
- Use `min`/`max` on integers, floats, and strings
- Use `clear` to empty a map and to zero a slice
- Know the difference between `clear(m)` and `clear(s)`
- Avoid the floating-point and `nil` pitfalls

You do **not** need generics, the `cmp` package, or compiler internals yet. This file is about the moment you stop copy-pasting `maxInt` into every project.

---

## Prerequisites

- **Required:** Go 1.21 or newer. These built-ins do not exist before 1.21. Check with `go version`.
- **Required:** The `go` directive in your `go.mod` must be `1.21` or higher, or the compiler will reject `min`/`max`/`clear` as undefined.
- **Required:** Comfort with basic types: `int`, `float64`, `string`, slices (`[]T`), and maps (`map[K]V`).
- **Helpful:** Knowing what "the zero value" of a type is (`0` for numbers, `""` for strings, `nil` for pointers/slices/maps).
- **Helpful:** A passing familiarity with comparison operators (`<`, `>`).

If `go version` prints `go1.21` or higher and your `go.mod` says `go 1.21`+, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Built-in function** | A function that is part of the language, always available without an import. `len`, `append`, `make`, `min`, `max`, `clear` are all built-ins. |
| **Predeclared identifier** | A name the compiler knows everywhere, in every package, without declaration. Built-ins are predeclared. |
| **Ordered type** | A type whose values can be compared with `<`, `<=`, `>`, `>=`: integers, floats, and strings (and types derived from them). |
| **Variadic** | Accepting any number of arguments. `max(a, b, c, ...)` takes two or more. |
| **Constant expression** | An expression the compiler can evaluate at compile time, e.g. `min(3, 7)` becomes the constant `3` in the binary. |
| **Zero value** | The default value a variable holds before assignment: `0`, `0.0`, `""`, `false`, `nil`. |
| **NaN** | "Not a Number" — a special floating-point value produced by operations like `0.0/0.0`. It compares unequal to everything, including itself. |
| **Signed zero** | IEEE-754 floats have both `+0.0` and `-0.0`. They are equal under `==` but are distinct bit patterns. |
| **`clear`** | The built-in that empties a map (deletes all keys) or zeroes a slice (sets every element to its zero value). |
| **`math.Min` / `math.Max`** | Older standard-library functions on `float64` with their own IEEE-754 special cases — *not* the same as the built-ins. |

---

## Core Concepts

### `min` and `max`: pick the smallest / largest

```go
min(x, y, ...)   // returns the smallest argument
max(x, y, ...)   // returns the largest argument
```

Both take **one or more arguments** (the spec requires at least one; in practice you almost always pass two or more). All arguments must be of the same ordered type, or of types that can be mixed under Go's normal type rules (covered at the middle level). The result has that same type.

```go
min(3, 7)        // 3      (int)
max(3, 7)        // 7      (int)
min(2.5, 1.1)    // 1.1    (float64)
max("a", "b")    // "b"    (string — lexicographic order)
min(8)           // 8      (one argument: returns it unchanged)
```

`max(2, 9, 4, 1)` scans all four and returns `9`. There is no upper limit on the argument count.

The comparison uses the same `<` ordering as the language: numbers numerically, strings byte-by-byte (so `"Z" < "a"` because uppercase letters have smaller byte values).

### Why built-ins and not a function?

You *could* write `max` as a generic function in Go 1.18+:

```go
func Max[T cmp.Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

But there are real reasons Go made `min`/`max` built-ins instead:

1. **No import.** `min` and `max` are so universal that requiring `import "golang.org/x/exp/constraints"` or a helper package was friction.
2. **Variadic over any count without slices.** A generic `Max(a, b T)` handles two args; `Max(vals ...T)` allocates a slice. The built-in `max(a, b, c, d)` takes any fixed count with zero overhead.
3. **Constant folding.** `min(3, 7)` where both are constants becomes the constant `3` *at compile time*. A function call cannot do that.
4. **One canonical spelling.** Before 1.21 every codebase had a different `maxInt`/`MaxInt`/`Max`. Now there is exactly one.

### `min`/`max` on constants are constants

If every argument is a constant, the result is itself a constant:

```go
const Limit = max(100, 200)   // Limit is the constant 200
var buf [min(64, 128)]byte    // a [64]byte array — array size must be constant
```

This is something a normal function can never do, because a function call happens at run time. `min`/`max` of constants happen at compile time.

### `clear`: empty a map or zero a slice

`clear` has *two* meanings depending on what you pass it.

**On a map**, `clear(m)` deletes every key:

```go
m := map[string]int{"a": 1, "b": 2}
clear(m)
fmt.Println(len(m))   // 0
```

After `clear(m)`, the map is empty but still usable — you can add keys again. It is the same map, not a new one.

**On a slice**, `clear(s)` sets every element to the zero value of the element type. It does **not** change the length or capacity:

```go
s := []int{1, 2, 3}
clear(s)
fmt.Println(s)        // [0 0 0]
fmt.Println(len(s))   // 3   — length unchanged
```

So `clear` on a slice zeroes contents; `clear` on a map removes contents. Same word, two behaviours, decided by the argument type.

### Why `clear` exists for maps: the NaN-key problem

Before `clear`, you emptied a map by looping and calling `delete`:

```go
for k := range m {
    delete(m, k)
}
```

This works — *except* for one nasty case. If a map has a `float64` key that is `NaN`, you **cannot delete it** with `delete`, because `delete(m, NaN)` looks up `NaN`, and `NaN != NaN`, so the lookup never matches. The key is stuck forever.

```go
nan := math.NaN()
m := map[float64]int{}
m[nan] = 1
delete(m, nan)        // does nothing — NaN can't be found
fmt.Println(len(m))   // 1   — the NaN key is still there!

clear(m)              // clear removes it
fmt.Println(len(m))   // 0
```

`clear` empties the *whole* map at the runtime level, so it removes even unreachable NaN keys. This is a key motivation for the built-in: it can do something a `delete` loop cannot.

---

## Real-World Analogies

**1. A built-in calculator button.** Older calculators made you key in a whole formula to find the bigger of two numbers. `min`/`max` are like a dedicated "biggest" button: one press, no setup, always there. You do not carry your own calculator (an imported helper); the button is on every machine.

**2. Erasing a whiteboard two ways.** `clear` on a map is like wiping a whiteboard clean — the board (the map) stays on the wall, just empty. `clear` on a slice is like resetting every sticky note on the board to blank — the notes (slots) are still there in their positions, but each one now says nothing.

**3. A stuck label you can't peel.** The NaN map key is like a sticker that has no readable name on it. You ask "remove the sticker labelled X" (`delete`), but since the sticker has no matching label, your request finds nothing. `clear` is the act of throwing the whole sheet away — stuck stickers included.

**4. A universal adapter.** Before `min`/`max`, you needed a different helper for ints, for floats, for strings — like carrying separate plugs for every country. The built-ins are a universal adapter: one shape fits every ordered type.

---

## Mental Models

### Model 1 — `min`/`max` are spelled like `len`

They live in the same mental box as `len`, `cap`, `append`. No import, always available, lowercase, part of the language. If you would not import a package to call `len`, you do not import one to call `min`.

### Model 2 — Same type in, same type out

`min(int, int)` returns `int`. `max(string, string)` returns `string`. The result type is the type of the arguments. There is no conversion happening — `max(3, 7)` is an `int`, never a `float64`.

### Model 3 — Constants fold; variables compute

If all arguments are constants, the answer is baked into the binary at compile time and can be used where a constant is required (array sizes, other constants). If any argument is a variable, the comparison happens at run time, just like an `if`.

### Model 4 — `clear` decides by argument kind

```
clear(x)
   │
   ├── x is a map   → delete all entries (NaN keys included)
   └── x is a slice → set every element to its zero value
```

There is no third behaviour. `clear` of anything else does not compile.

### Model 5 — `clear(s)` keeps the container, empties the contents

```
before: s = [a b c]   len=3 cap=3
clear(s)
after:  s = [0 0 0]   len=3 cap=3   ← same length, same capacity
```

`clear` never reslices, never reallocates. If you want length zero, that is `s = s[:0]` or `s = nil` — a *different* operation.

---

## Pros & Cons

### Pros

- **No import, no boilerplate.** Delete every hand-rolled `maxInt`. The language provides it.
- **Works on any ordered type.** One spelling for ints, floats, strings, and types derived from them.
- **Variadic.** `max(a, b, c, d)` with no slice allocation.
- **Constant-foldable.** `min`/`max` of constants are constants — usable in array sizes and `const` blocks.
- **`clear` solves the NaN-key bug.** It removes map keys a `delete` loop cannot.
- **Readable.** `max(timeout, minTimeout)` reads better than a five-line `if`.

### Cons

- **Requires Go 1.21+.** Code targeting older toolchains cannot use them.
- **Floating-point surprises.** `min`/`max` with `NaN` return `NaN`; signed zero has ordering rules most people never think about.
- **Not the same as `math.Min`/`math.Max`.** Mixing them up is a real source of bugs.
- **`clear` on a slice does not shorten it.** People expect `len 0`; they get a zeroed slice of the same length.
- **No `min`/`max` over a slice.** `max(mySlice...)` does not compile — the built-ins are not slice-aware. Use the `slices` package for that.

---

## Use Cases

Reach for `min`/`max` when:

- **Clamping a value.** `clamped := min(max(x, low), high)` keeps `x` within `[low, high]`.
- **Capping sizes.** `n := min(len(buf), requested)` reads no more than the buffer holds.
- **Bounding timeouts/retries.** `wait := min(base*attempt, maxWait)`.
- **Tracking a running extreme.** `best = max(best, candidate)` in a loop.
- **Compile-time sizing.** `var arr [max(A, B)]byte` where `A` and `B` are constants.

Reach for `clear` when:

- **Reusing a map across iterations** instead of allocating a new one each time: `clear(cache)` then refill.
- **Resetting a pooled slice's contents** before returning it to a `sync.Pool`, so old (possibly pointer-holding) data does not leak.
- **Emptying a map that might contain NaN float keys**, where a `delete` loop would fail.

Do **not** use them when:

- You need the minimum *of a slice's elements* — that is `slices.Min(s)`, not `min`.
- You are on Go < 1.21.
- You want `math.Min`'s specific IEEE-754 behaviour (rare, but it differs).

---

## Code Examples

### Example 1 — Basic `min` and `max`

```go
package main

import "fmt"

func main() {
    fmt.Println(min(3, 7))         // 3
    fmt.Println(max(3, 7))         // 7
    fmt.Println(max(2, 9, 4, 1))   // 9
    fmt.Println(min(2.5, 1.1))     // 1.1
    fmt.Println(max("go", "c++"))  // go   ('g' > 'c')
    fmt.Println(min(42))           // 42   (single arg)
}
```

### Example 2 — Clamping a value into a range

```go
func clamp(x, low, high int) int {
    return min(max(x, low), high)
}

func main() {
    fmt.Println(clamp(5, 0, 10))    // 5
    fmt.Println(clamp(-3, 0, 10))   // 0
    fmt.Println(clamp(99, 0, 10))   // 10
}
```

`max(x, low)` lifts `x` up to at least `low`; `min(..., high)` caps it at `high`. Two built-in calls replace a multi-branch `if`.

### Example 3 — Capping a read length

```go
func readAtMost(buf []byte, want int) int {
    n := min(len(buf), want)   // never read past the buffer
    // ... read n bytes ...
    return n
}
```

### Example 4 — A running maximum in a loop

```go
nums := []int{4, 1, 9, 2, 7}
best := nums[0]
for _, n := range nums[1:] {
    best = max(best, n)
}
fmt.Println(best)   // 9
```

(For a whole slice, `slices.Max(nums)` is shorter — see Related Topics. The point here is `max` inside a loop.)

### Example 5 — `min`/`max` of constants used at compile time

```go
const (
    minBuf = 64
    maxBuf = 4096
)

// Array size MUST be a constant — only possible because min/max fold.
var scratch [max(minBuf, 128)]byte   // a [128]byte

const cap = min(maxBuf, 8192)        // cap == 4096
```

### Example 6 — `clear` on a map empties it

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
fmt.Println(len(m))   // 3
clear(m)
fmt.Println(len(m))   // 0
m["d"] = 4            // still usable — same map
fmt.Println(len(m))   // 1
```

### Example 7 — `clear` on a slice zeroes elements

```go
s := []string{"x", "y", "z"}
clear(s)
fmt.Println(s)        // [  ]   (three empty strings)
fmt.Println(len(s))   // 3      — length is NOT reduced

nums := []int{1, 2, 3}
clear(nums)
fmt.Println(nums)     // [0 0 0]
```

### Example 8 — `clear` removes a NaN map key

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    nan := math.NaN()
    m := map[float64]string{nan: "stuck", 1.0: "ok"}

    delete(m, nan)             // does nothing — NaN never matches
    fmt.Println(len(m))        // 2  (NaN key survives)

    clear(m)                   // removes everything, NaN included
    fmt.Println(len(m))        // 0
}
```

### Example 9 — Reusing a map with `clear` to avoid allocation

```go
cache := make(map[string]int, 100)
for _, batch := range batches {
    clear(cache)               // reset, keep the backing storage
    for _, item := range batch {
        cache[item.Key] = item.Value
    }
    process(cache)
}
```

`clear(cache)` reuses the same allocated map across every batch instead of `cache = make(...)` each time.

---

## Coding Patterns

### Pattern: clamp helper

```go
func clamp[T cmp.Ordered](x, lo, hi T) T {
    return min(max(x, lo), hi)
}
```

`min`/`max` compose inside your own generic helper. (`cmp.Ordered` is covered at the middle level; the idea is that the built-ins work with type parameters too.)

### Pattern: reuse-then-refill for maps

```go
clear(m)
for _, v := range items {
    m[v.Key] = v.Val
}
```

Reset and rebuild, keeping the allocation. Common in hot loops.

### Pattern: zero-before-pool for slices

```go
func release(buf []*Conn) {
    clear(buf)        // drop references so the GC can collect them
    pool.Put(buf[:0]) // return an empty-but-allocated slice
}
```

Zeroing pointer-holding slices before pooling prevents the pooled slice from pinning objects in memory.

### Pattern: bound a growing value

```go
backoff = min(backoff*2, maxBackoff)
```

A one-liner exponential backoff cap.

---

## Clean Code

- **Prefer `min`/`max` over `if a < b` ladders** for simple bounds. `n := min(a, b)` says intent directly.
- **Use `clamp(min(max(...)))` for ranges**, not nested `if`s.
- **Do not confuse `clear(s)` with truncation.** If you mean "length zero," write `s = s[:0]`. `clear` means "zero the elements."
- **Reach for the right tool for slices of values.** `max(s...)` does not compile; use `slices.Max(s)`. Do not loop with `max` if a one-liner exists.
- **Keep types consistent.** `min(intVal, floatVal)` will not compile; convert first, deliberately.
- **Delete your old `maxInt`/`minInt` helpers** once you require Go 1.21. They are dead weight now.

---

## Product Use / Feature

In real software, these built-ins show up everywhere:

- **Rate limiters and backoff** use `min(computed, ceiling)` to cap wait times.
- **Pagination** uses `min(pageSize, remaining)` to avoid over-reading.
- **UI layout** uses `max(contentWidth, minWidth)` to enforce minimums.
- **Caches and buffers** use `clear` to reset reusable storage every cycle, cutting allocations and GC pressure.
- **Object pools** use `clear` on slices to drop references before reuse, preventing memory leaks.

They are small, but they remove a category of repeated boilerplate from product code and make intent obvious to the next reader.

---

## Error Handling

`min`, `max`, and `clear` do not return errors — they are pure operations. The "errors" are compile-time:

### "undefined: min" / "undefined: max" / "undefined: clear"

Your toolchain or `go.mod` predates 1.21. Fix: upgrade Go and set `go 1.21` (or higher) in `go.mod`.

### "invalid argument: arguments have different types"

You mixed types: `max(intVar, floatVar)`. Fix: convert one side: `max(float64(intVar), floatVar)`.

### "invalid argument: ... is not ordered"

You passed a type with no `<` ordering (a struct, a slice, a bool). `min`/`max` only accept integers, floats, and strings. Fix: compare a field, or use a different approach.

### "invalid operation: clear expects ... map or slice"

You passed `clear` something that is not a map or slice (an array, a channel, an int). Fix: pass a map or slice. (For an *array*, take a slice of it first: `clear(arr[:])`.)

These are caught at compile time, which is the good news — there is no runtime failure mode to handle.

---

## Security Considerations

- **`clear` for sensitive data — partial help.** `clear(secretBytes)` zeroes the slice elements, which can scrub a buffer that held a password or key. This is *better* than leaving the data, but Go's GC and value copies mean it is not a guaranteed memory-scrubbing tool. For hard requirements use a dedicated wipe routine; for ordinary hygiene, `clear` helps.
- **`clear` prevents reference leaks in pools.** A pooled `[]*T` that is not cleared keeps old objects alive and reachable, which is both a memory issue and a potential data-exposure issue (a reused buffer leaking a previous request's data). Clearing before reuse closes that gap.
- **`min`/`max` for bounds checking.** `n := min(len(buf), requested)` is a defensive idiom that prevents over-reads driven by attacker-controlled `requested` values.
- **No injection surface.** These built-ins do not parse input or touch I/O; they have no injection or escaping concerns of their own.

---

## Performance Tips

- **`min`/`max` of constants cost nothing at runtime** — they are folded into constants by the compiler.
- **`min`/`max` of variables are as cheap as an `if`** — a comparison and a move, no allocation, no function-call overhead (the compiler inlines them).
- **`clear(m)` reuses the map's storage**, so `clear` + refill in a loop avoids the allocation that `m = make(...)` would incur each iteration.
- **`clear(s)` on a slice may compile to an optimized memory-zeroing routine** (memclr) rather than an element-by-element loop, which is fast.
- **Do not allocate a slice just to call `max(...)`** — that is the slow path. For a slice, `slices.Max(s)` reads it in place.

---

## Best Practices

1. **Set `go 1.21`+ in `go.mod`** before using these. Otherwise the compiler rejects them.
2. **Replace hand-rolled `maxInt`/`minInt` helpers** with the built-ins; delete the duplicates.
3. **Use `clamp := min(max(x, lo), hi)`** for ranges instead of nested `if`s.
4. **Remember `clear(s)` zeroes, it does not truncate.** Use `s = s[:0]` for "empty but keep capacity."
5. **Use `clear(m)` to empty maps**, especially if NaN float keys are even remotely possible.
6. **Use `slices.Min` / `slices.Max` for slices of values** — the built-ins are not slice-aware.
7. **Be deliberate about floats.** If `NaN` is possible and you need specific behaviour, know that `min`/`max` propagate `NaN`.
8. **Keep argument types identical** to avoid conversion bugs.

---

## Edge Cases & Pitfalls

### Pitfall 1 — `min`/`max` with NaN returns NaN

If any argument is `NaN`, the result is `NaN`:

```go
max(1.0, math.NaN())   // NaN, not 1.0
min(1.0, math.NaN())   // NaN, not 1.0
```

If you have floats that might be NaN and want to ignore them, you must filter first. `min`/`max` will not "skip" a NaN.

### Pitfall 2 — Signed zero ordering

`min`/`max` treat negative zero as *smaller* than positive zero:

```go
min(0.0, math.Copysign(0, -1))   // -0.0
max(0.0, math.Copysign(0, -1))   //  0.0
```

`-0.0 == 0.0` is `true`, but `min`/`max` still order them. You almost never care, but it can surprise you in tests that print results.

### Pitfall 3 — `clear(s)` does not change length

```go
s := []int{1, 2, 3}
clear(s)
len(s)   // 3, not 0
```

Expecting `len 0` after `clear` is the single most common slice mistake. Use `s = s[:0]` for that.

### Pitfall 4 — `clear` on a `nil` map or slice is a no-op

```go
var m map[string]int   // nil
clear(m)               // safe — does nothing

var s []int            // nil
clear(s)               // safe — does nothing
```

No panic. Unlike *writing* to a nil map (which panics), `clear` of a nil map is fine.

### Pitfall 5 — `max(slice...)` does not compile

```go
nums := []int{1, 2, 3}
max(nums...)   // COMPILE ERROR — built-ins are not variadic-over-slices
```

Use `slices.Max(nums)` instead.

### Pitfall 6 — Mixing `min`/`max` with `math.Min`/`math.Max`

They are different functions with different rules. `math.Max(x, NaN)` and the built-in `max(x, NaN)` both give `NaN`, but their signed-zero and infinity handling differs in subtle documented ways. Pick one and know which you are using.

### Pitfall 7 — Arrays need slicing for `clear`

```go
var arr [3]int
clear(arr)     // COMPILE ERROR — clear wants a map or slice
clear(arr[:])  // OK — slice the array first
```

---

## Common Mistakes

- **Using them on Go < 1.21** and getting "undefined: min."
- **Expecting `clear(s)` to give length 0.** It zeroes, it does not shrink.
- **Calling `max(slice...)`** and being surprised it does not compile.
- **Mixing types:** `max(i, f)` where `i` is `int` and `f` is `float64`.
- **Assuming `min`/`max` skip NaN.** They propagate it.
- **Emptying a map with a `delete` loop** when a NaN key is possible — `clear` is the correct tool.
- **Forgetting `clear` on a pooled pointer slice**, leaking the referenced objects.
- **Keeping old `maxInt`/`minInt` helpers around** after upgrading — dead code.

---

## Common Misconceptions

> *"`min`/`max` work on slices like `max(mySlice...)`."*

No. They take fixed arguments of an ordered type. For a slice, use `slices.Min`/`slices.Max`.

> *"`min`/`max` are the same as `math.Min`/`math.Max`."*

No. `math.Min`/`math.Max` are `float64`-only library functions with their own IEEE-754 special cases. The built-ins are generic over all ordered types and have the language's own (simpler) NaN and signed-zero rules.

> *"`clear(s)` makes the slice empty (length 0)."*

No. It sets every element to the zero value and leaves length and capacity untouched.

> *"`clear(m)` allocates a new map."*

No. It empties the existing map in place. The variable still points at the same map.

> *"You need to import something to use `min`/`max`/`clear`."*

No. They are predeclared, like `len` and `append`. No import.

> *"`clear` of a nil map panics like writing to one does."*

No. `clear(nil-map)` and `clear(nil-slice)` are safe no-ops.

---

## Tricky Points

- **`min`/`max` require at least one argument.** `min()` with zero arguments does not compile. (You will essentially always pass two or more.)
- **The result type is the argument type**, including derived types: `min(myCelsius, otherCelsius)` returns a `Celsius`, not a bare `float64`.
- **Constant `min`/`max` are usable as array sizes** because they fold to constants; variable ones are not.
- **`clear` is the only safe way to remove NaN map keys**, because `delete` cannot find them.
- **`clear(s)` may use a fast memory-zero**, but semantically it is "set each element to its zero value" — for a `[]*T` that means setting each to `nil`.
- **Untyped constants adapt.** `max(1, 2.0)` is allowed because untyped constants combine; `max(intVar, 2.0)` may or may not, depending on whether `2.0` fits — covered at middle level.
- **`min`/`max` on strings use byte order**, so `"Apple" < "apple"` (uppercase first).

---

## Test

Try this in a scratch file with Go 1.21+.

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    fmt.Println(min(3, 7, 1))                 // ?
    fmt.Println(max("go", "rust", "c"))       // ?

    s := []int{5, 6, 7}
    clear(s)
    fmt.Println(s, len(s))                     // ?

    m := map[string]int{"a": 1, "b": 2}
    clear(m)
    fmt.Println(len(m))                        // ?

    fmt.Println(max(2.0, math.NaN()))          // ?
}
```

Now answer before running:
1. What does `min(3, 7, 1)` print? (Answer: `1`.)
2. What does `max("go", "rust", "c")` print? (Answer: `rust`.)
3. What are `s` and `len(s)` after `clear(s)`? (Answer: `[0 0 0] 3` — zeroed, length unchanged.)
4. What is `len(m)` after `clear(m)`? (Answer: `0`.)
5. What is `max(2.0, math.NaN())`? (Answer: `NaN`.)

---

## Tricky Questions

**Q1.** Does `clear(s)` make `len(s)` zero?

A. No. It sets every element to the zero value and leaves length and capacity unchanged. For length zero, use `s = s[:0]`.

**Q2.** Can I write `max(mySlice...)`?

A. No, it does not compile. The built-ins take fixed ordered arguments, not a spread slice. Use `slices.Max(mySlice)`.

**Q3.** What does `max(1.0, math.NaN())` return?

A. `NaN`. If any argument is NaN, the result is NaN. The built-ins do not skip NaN.

**Q4.** Why can't `delete` remove a NaN map key, but `clear` can?

A. `delete(m, NaN)` must *find* the key, but `NaN != NaN`, so the lookup never matches and nothing is deleted. `clear` empties the whole map at the runtime level, so it removes even unfindable keys.

**Q5.** Is `clear(nilMap)` safe?

A. Yes. It is a no-op. (Note: *writing* to a nil map panics, but `clear` of one does not.)

**Q6.** Can `min`/`max` be used to size an array?

A. Yes, if all arguments are constants: `var a [max(8, 16)]byte` gives a `[16]byte`. With variable arguments it cannot, because array sizes must be constants.

**Q7.** Do `min`/`max` allocate?

A. No. They are inlined to a comparison and a move — as cheap as an `if`. Of constants, they cost nothing at all (compile-time folded).

**Q8.** What type does `max(3, 7)` have?

A. `int`. The result type is the type of the arguments; here untyped integer constants default to `int`.

**Q9.** Does `clear` work on a channel or a struct?

A. No. `clear` accepts only maps and slices. A struct or channel argument is a compile error.

**Q10.** I'm on Go 1.20 and `min` is undefined. Why?

A. These built-ins were added in Go 1.21. Upgrade your toolchain and set `go 1.21`+ in `go.mod`.

---

## Cheat Sheet

```go
// min / max — one or more args, any ordered type, same type out
min(3, 7)           // 3
max(3, 7)           // 7
max(2, 9, 4, 1)     // 9
min(2.5, 1.1)       // 1.1
max("a", "b")       // "b"

// constant-foldable
const C = max(100, 200)       // 200
var buf [min(64, 128)]byte    // [64]byte

// clamp
clamped := min(max(x, lo), hi)

// clear on a MAP — deletes all entries (NaN keys too)
clear(m)            // len(m) == 0, same map

// clear on a SLICE — zeroes elements, keeps len/cap
clear(s)            // s == [0 0 0 ...], len unchanged

// for "empty but keep capacity": NOT clear
s = s[:0]
```

```
What you have   →  What you want         →  Use
two values         the larger               max(a, b)
many values        the largest              max(a, b, c, ...)
a slice            the largest element      slices.Max(s)
a map              empty it                 clear(m)
a slice            zero every element       clear(s)
a slice            length 0, keep cap       s = s[:0]
a map with NaN     empty it (delete fails)  clear(m)
```

| Symptom | Cause | Fix |
|---------|-------|-----|
| `undefined: min` | Go < 1.21 or `go.mod` too old | Upgrade; set `go 1.21`+ |
| `max(slice...)` won't compile | Built-ins not slice-aware | `slices.Max(slice)` |
| `len(s)` still > 0 after `clear` | `clear` zeroes, not truncates | `s = s[:0]` |
| `max(i, f)` won't compile | Mixed types | Convert one side |
| NaN map key survives `delete` | `NaN != NaN` | `clear(m)` |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain what `min`, `max`, and `clear` each do, in one sentence
- [ ] State why they are built-ins rather than imported functions
- [ ] Use `min`/`max` on integers, floats, and strings
- [ ] Predict the output of `clear(s)` on a slice (zeroed, same length)
- [ ] Predict the output of `clear(m)` on a map (empty, same map)
- [ ] Explain why `clear` can remove a NaN map key but `delete` cannot
- [ ] Predict `max(x, NaN)` (it is NaN)
- [ ] Know that `clear` of a nil map/slice is a safe no-op
- [ ] Use `min(max(...))` to clamp a value into a range
- [ ] Know to use `slices.Min`/`slices.Max` for slices of values

---

## Summary

Go 1.21 added three predeclared built-in functions. `min` and `max` take one or more arguments of any ordered type — integers, floats, strings, or types derived from them — and return the smallest or largest, with the same type as the arguments. They are variadic, allocate nothing, fold to constants when their arguments are constants, and replace the hand-rolled `maxInt`/`minInt` helpers every codebase used to carry.

`clear` does two related things depending on its argument: on a **map** it deletes every entry (including NaN float keys that `delete` cannot remove — a key reason the built-in exists), and on a **slice** it sets every element to the zero value *without* changing length or capacity.

The pitfalls are small but real: `min`/`max` propagate `NaN` rather than skipping it, they are not the same as `math.Min`/`math.Max`, they do not work over a spread slice (use the `slices` package), and `clear(s)` zeroes rather than truncates. Set `go 1.21`+ in your `go.mod`, delete your old helpers, and use the built-ins for the clarity and correctness they buy.

---

## What You Can Build

After learning this:

- **A clamp/bounds utility** that keeps configuration values within safe ranges with one-liners.
- **An exponential-backoff cap** using `min(base*attempt, ceiling)`.
- **A reusable cache or buffer** that `clear`s and refills each cycle to cut allocations.
- **A leak-free object pool** that `clear`s pointer slices before returning them.
- **Compile-time-sized buffers** using `min`/`max` of constants as array sizes.

You cannot yet:
- Reason precisely about type inference across mixed-but-compatible operands (next: middle.md)
- Use `min`/`max`/`clear` inside generic functions with `cmp.Ordered` (middle.md)
- Explain the exact signed-zero and NaN spec rules and the `math`-package contrast (middle/senior)
- Understand how the compiler lowers these built-ins (professional.md)

---

## Further Reading

- [Go 1.21 Release Notes — new built-ins](https://go.dev/doc/go1.21#language) — where `min`, `max`, `clear` were introduced.
- [Go Language Specification — "Min and max"](https://go.dev/ref/spec#Min_and_max) — authoritative semantics.
- [Go Language Specification — "Clear"](https://go.dev/ref/spec#Clear) — the formal `clear` rules.
- [`cmp` package](https://pkg.go.dev/cmp) — the `cmp.Ordered` constraint used in generics.
- [`slices` package](https://pkg.go.dev/slices) — `slices.Min`/`slices.Max` for slices of values.

---

## Related Topics

- 18.1 Generics — `cmp.Ordered` and how built-ins compose with type parameters
- [18.2 `slices` and `maps` Packages](../02-slices-maps-packages/junior.md) — `slices.Min`/`slices.Max`, `maps.Clone`
- [1.x Constants and Constant Expressions](../../01-introduction-to-go/junior.md) — why `min`/`max` of constants fold
- 7.x Floating-Point and IEEE-754 — NaN and signed-zero behaviour in depth
- [math package](https://pkg.go.dev/math) — `math.Min`/`math.Max` and how they differ

---

## Diagrams & Visual Aids

```
min / max — same type in, same type out:

    min(3, 7, 1)  ──►  scan all args ──►  1   (smallest)
    max(3, 7, 1)  ──►  scan all args ──►  7   (largest)

    int  in  → int  out
    float in → float out
    string in → string out
```

```
clear, decided by argument kind:

    clear(x)
       │
       ├── map   → delete ALL entries (NaN keys included)
       │           map stays, len → 0
       │
       └── slice → set EVERY element to zero value
                   len & cap unchanged
```

```
clear(s) vs s = s[:0]   (a common confusion)

    s = [a b c]   len=3 cap=3

    clear(s)  →  [0 0 0]   len=3 cap=3   (zeroed, same length)
    s = s[:0] →  []        len=0 cap=3   (emptied, capacity kept)
```

```
the NaN-key problem:

    m[NaN] = "stuck"
         │
    delete(m, NaN)  ──►  look up NaN  ──►  NaN != NaN  ──►  no match  ──►  key survives
         │
    clear(m)        ──►  drop entire map storage  ──►  NaN key gone
```
