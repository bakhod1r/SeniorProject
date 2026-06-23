# Slice Header Internals — Junior

## 1. What a slice really is

A Go slice **looks** like a dynamic array, but in memory it is a tiny three-word descriptor that **points** into a backing array. That descriptor is called the **slice header**. Once you can picture those three words, almost every "weird" slice behaviour becomes obvious.

The header has exactly three fields:

| Field | Type | Meaning |
|-------|------|---------|
| `Data` | pointer | Address of the first element of the backing array the slice sees |
| `Len`  | int (machine word) | How many elements you can index into (`s[0]` ... `s[len-1]`) |
| `Cap`  | int (machine word) | How many elements exist from `Data` to the end of the backing array |

On a 64-bit machine each word is 8 bytes, so a slice value is `8 + 8 + 8 = 24` bytes regardless of how many elements it represents. A slice of one billion ints and a slice of zero ints both occupy 24 bytes in your local variable; the difference is where `Data` points and what `Len`/`Cap` say.

For a sibling deep dive on how `Cap` is chosen and grows when you `append`, see [capacity-and-growth](../01-capacity-and-growth/). This file focuses on the **header** itself.

---

## 2. A picture worth a thousand bytes

```
s := []int{10, 20, 30, 40, 50}

   s (a slice value, on the stack)
   +---------+---------+---------+
   | Data    | Len = 5 | Cap = 5 |
   +----+----+---------+---------+
        |
        v
   backing array (somewhere — heap or stack)
   +----+----+----+----+----+
   | 10 | 20 | 30 | 40 | 50 |
   +----+----+----+----+----+
     0    1    2    3    4
```

`s` is the three-word header. The actual integers live in a separate region: an array. When you pass `s` to a function, **only the header is copied**. The integers are not. The function receives its own header but pointing at the same array.

---

## 3. The fields, one at a time

### Data

`Data` is the address of element 0 of the *visible* part of the backing array. Two slices into the same array can have different `Data` pointers:

```go
arr := [...]int{10, 20, 30, 40, 50}
a := arr[0:3] // Data -> &arr[0], Len=3, Cap=5
b := arr[2:5] // Data -> &arr[2], Len=3, Cap=3
```

`a` and `b` both look 3 elements long, but `b`'s `Data` is two ints past `a`'s.

### Len

`Len` is the bound for indexing and the value returned by `len(s)`. Accessing `s[i]` panics if `i < 0` or `i >= len(s)`. **Not** `i >= cap(s)`.

### Cap

`Cap` is the bound for reslicing: `s[:k]` is allowed if `0 <= k <= cap(s)`. It is also the headroom `append` has before it needs to allocate a fresh backing array.

```go
s := make([]int, 3, 8) // Len=3, Cap=8
_ = s[5] // PANIC: index out of range (5 >= len=3)
t := s[:5] // OK: 5 <= cap=8; now t has Len=5, Cap=8
```

---

## 4. Slice is a value type — but it shares an array

This is the single most important sentence in this file:

> A slice header is **passed by value**, but the `Data` pointer inside makes the elements **shared**.

Concrete example:

```go
func main() {
    s := []int{1, 2, 3}
    modify(s)
    fmt.Println(s) // [99 2 3] — the function changed it
}

func modify(x []int) {
    x[0] = 99 // writes through x.Data, which is also s.Data
}
```

`modify` got its own copy of the three-word header `x`. But `x.Data == s.Data`, so writing through `x[0]` writes through the same memory cell as `s[0]`. The change is visible.

Compare with reassignment, which does *not* propagate:

```go
func main() {
    s := []int{1, 2, 3}
    replace(s)
    fmt.Println(s) // [1 2 3] — unchanged
}

func replace(x []int) {
    x = []int{9, 9, 9} // replaces x's header only; main's s is untouched
}
```

`x = []int{...}` overwrites the local `x` variable (which is just a header on `replace`'s stack frame). `main`'s `s` header has no idea this happened.

This is the standard rule for Go in general — *everything* is pass-by-value — combined with the fact that one of the three header words is a pointer.

---

## 5. Why `len` and `cap` exist as separate things

When you reslice, both can change:

```go
s := make([]int, 5, 10) // header: {Data:X, Len:5, Cap:10}
t := s[1:3]             // header: {Data:X+8, Len:2, Cap:9}
```

`len(t) == 2` (you indexed `[1:3]`, that's 2 elements). `cap(t) == 9` because the backing array extends 9 ints past `t`'s `Data` pointer. You **lost** one cell of capacity at the front (`X+0` is no longer reachable through `t`), but you kept everything from index 1 onward.

The rule: `cap(s[i:j])` is always `cap(s) - i`. The `j` part affects only `Len`.

---

## 6. The full-slice expression `s[i:j:k]`

A third index pins capacity:

```go
s := make([]int, 5, 10) // Len=5, Cap=10
u := s[1:3:4]           // Len=2, Cap=3
```

`u`'s header is `{Data: s.Data + 1, Len: 3-1, Cap: 4-1}`. This is invaluable when you want to hand a slice to code that might `append` to it: by capping `Cap` to exactly what you intend the recipient to see, you guarantee that *their* `append` will allocate a new backing array instead of clobbering yours.

We will revisit this in the [middle](middle.md) file. For now, just know that the third index is the upper bound for the cap field.

---

## 7. `nil` vs the empty slice

Two slice values that print the same can have different headers:

| Expression | Data    | Len | Cap | `s == nil` |
|------------|---------|-----|-----|------------|
| `var s []int`        | nil       | 0 | 0 | true  |
| `s := []int{}`       | non-nil   | 0 | 0 | false |
| `s := make([]int, 0)`| non-nil   | 0 | 0 | false |

All three print as `[]`. All three have `len == 0` and `cap == 0`. But only the first is `== nil`.

In most code this doesn't matter — you can `append` to a nil slice, `range` over it, take its `len`. Where it bites:

```go
b, _ := json.Marshal(struct{ S []int }{nil})       // {"S":null}
b, _ := json.Marshal(struct{ S []int }{[]int{}})   // {"S":[]}
```

`encoding/json` distinguishes them. Many JSON APIs prefer `[]` over `null`; if so, initialise with `[]T{}`.

---

## 8. Why the header copy is cheap

A header is three words. Copying it is the same cost as copying a single `int64` plus a pointer plus another `int64`. The compiler usually does it with two or three SIMD-aligned moves, or just register-to-register.

That's why Go-style "everything by value" is fine for slices. The cost of `f(bigSlice)` is the cost of copying 24 bytes, not the 8 GB of data behind it.

If you want to **prevent** a function from seeing changes to the underlying data, you must copy the elements with `copy()` — copying the header alone does not protect you.

---

## 9. Mutating through one slice, watching through another

```go
arr := [...]int{1, 2, 3, 4, 5}
a := arr[:]
b := arr[2:]

a[2] = 99
fmt.Println(b[0]) // 99 — same memory cell!
```

`a[2]` and `b[0]` are the same byte address in the backing array. The headers are different (different `Data`), but the array under them is one.

This is called **aliasing**. It is a source of many subtle bugs (see [find-bug.md](find-bug.md)) and a source of many speed wins (`bytes.Split` returns sub-slices, not copies, in O(n)).

---

## 10. How `len(s)` and `cap(s)` are implemented

The compiler does not call a function. It loads the second/third word of the slice header. There is no runtime dispatch, no method table, nothing. A `len(s)` compile-time is **one machine instruction**.

```go
n := len(s)
// equivalent on amd64:
// MOVQ 8(SP), AX   ; load Len field
```

Knowing this kills two false fears:

- "I should cache `len(s)` in a variable" — no, the compiler already does. It's free.
- "Calling `len(s)` inside a loop is slow" — no, see above.

The cost of `len` and `cap` is genuinely zero in any hot path you care about.

---

## 11. The Go language definition vs the implementation

The Go *spec* defines slices behaviourally: they have a length, a capacity, and refer to an underlying array. It does not say the runtime must use a 24-byte struct with these exact field names. The 24-byte layout we are studying lives in:

- `src/runtime/slice.go` — the runtime's own type is just three fields: `array unsafe.Pointer; len int; cap int`.
- `src/reflect/value.go` — exposes `reflect.SliceHeader` for old code that wants to peek (now deprecated, see [specification.md](specification.md)).

In practice every Go compiler since forever has used this layout, and you can rely on it for tools and debugging — but treat it as an implementation detail, not a language guarantee.

---

## 12. Things to try

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := []int{10, 20, 30, 40, 50}
    fmt.Println("size of header:", unsafe.Sizeof(s)) // 24 on 64-bit
    fmt.Println("len:", len(s), "cap:", cap(s))

    t := s[1:3]
    fmt.Println("t len:", len(t), "cap:", cap(t)) // 2, 4
    fmt.Printf("s data: %p\nt data: %p\n", &s[0], &t[0])
    // Difference is exactly sizeof(int) = 8 bytes
}
```

Run it. Read the addresses. Confirm with your own eyes that `t`'s `Data` is 8 bytes past `s`'s.

Then add:

```go
t[0] = 999
fmt.Println(s) // [10 999 30 40 50] — observed through s, written through t
```

Now you understand the header.

---

## 13. Common misconceptions

| Misconception | Reality |
|---------------|---------|
| "A slice contains its elements" | A slice contains a *pointer* to an array. The elements are elsewhere. |
| "Passing a slice copies the data" | It copies the 24-byte header. The data is shared. |
| "Setting `s = nil` frees the array" | If anyone else holds a slice into the same array, the array stays alive. |
| "A nil slice and `[]int{}` are different objects" | They differ in the `Data` field; observably identical for `len`/`range`/`append`, but JSON-distinguishable. |
| "`len(s)` is slow because it walks the slice" | It's one load instruction. Cost is zero. |
| "If two slices have the same address, they're the same slice" | They share a backing array but may still have different `Len` and `Cap`. |

---

## 14. The one rule to remember

When in doubt, draw the three boxes. `Data | Len | Cap`. Ask:

1. Where does `Data` point?
2. What's `Len`?
3. What's `Cap`?

Every "why didn't this work?" question about slices reduces to those three.

---

## 15. What's next

- [middle.md](middle.md) — slicing produces new headers, aliasing in depth, three-index slicing, nil vs empty in real code.
- [senior.md](senior.md) — walk through `runtime.slice`, `growslice`, and how escape analysis decides whether the backing array lives on the stack or the heap.
- [specification.md](specification.md) — exact source citations and the deprecation story of `reflect.SliceHeader`.

---

## Further reading
- Go blog: "Go Slices: usage and internals" — https://go.dev/blog/slices-intro
- Russ Cox: "Go Data Structures" — https://research.swtch.com/godata
- Source: `src/runtime/slice.go` — https://github.com/golang/go/blob/master/src/runtime/slice.go
- Spec: https://go.dev/ref/spec#Slice_types
