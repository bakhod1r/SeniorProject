# Slice Tricks — Senior

## 1. Re-deriving every trick from the header

A senior reads a slice trick and sees three field assignments. Drop the syntax sugar of `append` for a moment:

```go
// the slice header
type SliceHeader struct {
    Data uintptr   // ptr to element 0
    Len  int
    Cap  int
}
```

Every trick rewrites some subset of `(Data, Len, Cap)` and optionally moves bytes inside `[Data, Data+Cap*sizeof(T))`. That's it. No magic.

Reading this way exposes:

- which tricks reuse storage vs allocate,
- which tricks change `Data` (rare; only re-slicing the front),
- which tricks leak references through the dead tail,
- when a Go 1.21+ `slices.*` helper is byte-for-byte equivalent to the trick and when it differs.

The rest of this file derives each canonical trick from the header model, then compares against the `slices` package's actual implementation (the package is short and worth reading: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/slices/slices.go).

For the underlying header layout itself see [../05-slice-header-internals/](../05-slice-header-internals/); the math here assumes you know `(ptr, len, cap)` cold.

---

## 2. Insert at `i`: what `append` is really doing

```go
s = append(s[:i], append([]T{x}, s[i:]...)...)
```

Step-by-step header transformation. Suppose `len(s) = n`, `cap(s) = c`, `i < n`.

1. `s[i:]` — header `(Data+i*size, n-i, c-i)`. No copy.
2. `[]T{x}` — fresh allocation of cap=1, header `(P, 1, 1)`.
3. `append([]T{x}, s[i:]...)` — appending `n-i` elements to a cap=1 slice triggers a grow. New backing array of cap `≥ n-i+1`. One alloc, n-i copies. Returns `(P', n-i+1, ≥n-i+1)`.
4. `s[:i]` — header `(Data, i, c)`.
5. `append(s[:i], ...)` — appending `n-i+1` elements to a slice of len `i`, cap `c`. If `i+(n-i+1) = n+1 ≤ c`, in-place; copies `n-i+1` elements from the temporary into `s[Data+i*size]`. Returns `(Data, n+1, c)`. If not, allocates new backing array of cap ≥ n+1, copies all of `s[:i]` (i copies), then the `n-i+1` from the temporary.

Allocations: **1 always** (the `[]T{x}` literal at step 2). Possibly +1 if step 5 needs to grow. Copies: at least `n-i+1` (step 3) plus `n-i+1` (step 5) = ~2(n−i). Compare with the optimal copy count of `n-i` (a single right-shift). The trick does roughly **twice the necessary copies** because it materializes an intermediate slice.

### What `slices.Insert` does instead

```go
// abbreviated from src/slices/slices.go
func Insert[S ~[]E, E any](s S, i int, v ...E) S {
    if len(v) == 0 {
        return s
    }
    m := len(v)
    if n := len(s) + m; n <= cap(s) {
        s2 := s[:n]
        copy(s2[i+m:], s2[i:])   // right-shift in place
        copy(s2[i:], v)
        return s2
    }
    s2 := slices.Grow(s, m)
    s2 = s2[:len(s)+m]
    copy(s2[i+m:], s2[i:])
    copy(s2[i:], v)
    return s2
}
```

Two `copy` calls: one to shift the tail, one to drop in the new values. **Zero intermediate slice allocation.** When `cap` is sufficient, it's allocation-free. When growth is needed, exactly one allocation.

Trick vs `slices.Insert`:

| | Wiki trick | `slices.Insert` |
|-|------------|-----------------|
| Allocations (cap fits) | 1 | 0 |
| Allocations (cap grows) | 2 | 1 |
| Element copies | ~2(n−i) | n−i + m |
| Code length | one line | one call |

The trick is genuinely worse on every axis. Use `slices.Insert` in Go 1.21+ code.

---

## 3. Delete preserving order: in-place left-shift

```go
s = append(s[:i], s[i+1:]...)
```

Headers:

1. `s[:i]` — `(Data, i, c)`.
2. `s[i+1:]` — `(Data+(i+1)*size, n-i-1, c-i-1)`.
3. `append(s[:i], s[i+1:]...)` — appending `n-i-1` to a slice of len `i`, cap `c`. Since `i + n-i-1 = n-1 ≤ c`, in-place. Copies `n-i-1` elements **left** from `Data+(i+1)` to `Data+i`. `append` (and `copy`) is required by the spec to handle overlapping ranges when destination starts ≤ source — which is the case.

Allocations: **0**. Copies: `n-i-1`. Optimal.

But: `s[n-1]` is now a stale duplicate. For pointer types, GC roots leak.

```go
// canonical correction for pointer-element types
copy(s[i:], s[i+1:])
clear(s[len(s)-1:])    // zero the now-dead trailing slot
s = s[:len(s)-1]
```

`clear(s[len(s)-1:])` is the post-1.21 way to write `s[len(s)-1] = zero` for a generic element type.

### What `slices.Delete` does

Go 1.22+:

```go
func Delete[S ~[]E, E any](s S, i, j int) S {
    _ = s[i:j:len(s)]   // bounds check
    if i == j {
        return s
    }
    oldlen := len(s)
    s = append(s[:i], s[j:]...)
    clear(s[len(s):oldlen])   // zero the elements that left the new len
    return s
}
```

Two interesting things:

1. It uses the **same `append` trick** for the left-shift.
2. After shifting, it calls `clear` on the elements that fell out of `len` but are still in the old backing array. This is the pointer-leak fix.

Pre-1.22 `slices.Delete` did *not* clear the tail; if you're on Go 1.21 with pointer elements, do it yourself.

| | Wiki trick | `slices.Delete` (Go 1.22+) |
|-|------------|----------------------------|
| Allocations | 0 | 0 |
| Element copies | n−i−1 | n−j |
| Zeroes tail? | no (manual) | yes (automatic) |

---

## 4. Swap-and-pop delete: O(1) when order is irrelevant

```go
s[i] = s[len(s)-1]
clear(s[len(s)-1:])     // for pointer types
s = s[:len(s)-1]
```

Headers: one element write, `Len -= 1`. Done.

Cost: **1 write + 1 clear (pointer types only)**. The minimum possible. There is no equivalent `slices.SwapDelete` because the function name would have to encode "I don't care about order" — and the standard library prefers explicit shape to clever naming.

When to use:

- Element order doesn't matter (membership sets, free lists, particle systems).
- Hot path where O(n) shift is unacceptable.

When NOT to use:

- Order matters (queues, sorted lists, anything the caller iterates in sequence).
- Single deletion in a small slice — `slices.Delete` is fast enough and clearer.

---

## 5. Cut a range — the same shape

```go
s = append(s[:i], s[j:]...)
```

Same `append` left-shift as single delete but copies `n-j` elements left to `Data+i*size`. After shift, `j-i` trailing slots are stale.

Pointer-safe version:

```go
copy(s[i:], s[j:])
clear(s[len(s)-(j-i):])
s = s[:len(s)-(j-i)]
```

Or, Go 1.21+:

```go
s = slices.Delete(s, i, j)   // same call as single-element delete with a range
```

---

## 6. The "Replace" trick: delete a range and insert a different one

The wiki shape:

```go
// replace s[i:j] with the contents of v
s = append(s[:i], append(v, s[j:]...)...)
```

Same allocation cost as Insert: one intermediate slice (`append(v, s[j:]...)`) plus possibly the outer growth. `slices.Replace` (Go 1.21+) does this with zero intermediate:

```go
func Replace[S ~[]E, E any](s S, i, j int, v ...E) S {
    _ = s[i:j]
    if i == j {
        return Insert(s, i, v...)
    }
    if j == len(s) {
        return append(s[:i], v...)
    }
    tot := len(s[:i]) + len(v) + len(s[j:])
    if tot > cap(s) {
        s2 := slices.Grow(s[:0], tot)
        s2 = append(s2, s[:i]...)
        s2 = append(s2, v...)
        s2 = append(s2, s[j:]...)
        return s2
    }
    r := s[:tot]
    if i+len(v) <= j {
        // shrinking or same-size: left-shift the tail
        copy(r[i:], v)
        copy(r[i+len(v):], s[j:])
        clear(s[tot:])
        return r
    }
    // growing: right-shift the tail
    copy(r[i+len(v):], s[j:])
    copy(r[i:], v)
    return r
}
```

Worth reading carefully: the standard library's branch for "is the new range larger or smaller than the old range" is the same intuition you'd write by hand — but it's prebuilt, tested, and `clear`s correctly. Always prefer.

---

## 7. Pop front: the queue-leak in full

```go
x = s[0]
s = s[1:]
```

Header: `Data += size`, `Len -= 1`, `Cap -= 1`. No copy. O(1).

```
backing array:  [a, b, c, d, e, _, _, _]   (cap=8, len=5)
                 ↑                  ↑
                 s.Data            s.Data+cap (one past)

after pop front:
                [a, b, c, d, e, _, _, _]
                    ↑                  ↑
                    s.Data            s.Data+cap-1
```

`a` is still in the backing array but no longer reachable through `s`. It's still **GC-reachable** as long as the array is reachable, which it is — through `s.Data`. The element gets freed only when:

- (a) the slice is reassigned and the old header is discarded, OR
- (b) `append` causes a growth and the old array is abandoned.

For `[]byte`, `a` is just a byte — no real leak. For `[]*Customer`, `a` keeps `*Customer` alive forever.

The fix at the trick level is to zero the popped slot before re-slicing:

```go
x = s[0]
var zero T
s[0] = zero        // or: clear(s[:1])
s = s[1:]
```

But that's still wrong for a *long-running queue*: every popped slot is now stuck in the leading "dead zone" of the backing array. The array grows because pushes need slots, and the dead zone grows too. Use a **ring buffer** (see [professional.md](professional.md) §3).

---

## 8. Push back: amortized analysis

```go
s = append(s, x)
```

If `len(s) < cap(s)`, written in place: `Len++`, no copy, O(1).

If `len(s) == cap(s)`, `append` calls `runtime.growslice` which:

1. Computes a new cap (roughly: double under 256 elements, then 1.25× over).
2. Allocates a new backing array.
3. Copies all `len(s)` elements over.
4. Returns a new header.

Amortized O(1) per push: across `n` pushes, total copy work is `n + n/2 + n/4 + ... ≈ 2n`. The single push that triggers the grow is O(n), but the average is O(1).

The growth ratio changed in Go 1.18 from "double until 1024, then 1.25" to a smoother size-class-aligned formula. Memory waste is bounded: never more than ~2× the actual data.

Implications:

- A loop of `append(s, x)` `n` times allocates roughly `log_2(n / initial_cap)` times.
- Preallocating with `make([]T, 0, n)` eliminates all reallocs and is the single most useful "trick" in performance code.

---

## 9. Reverse: the in-place baseline

Two-finger swap, in-place, O(n/2) swaps, **zero allocations and zero copies of backing memory**.

`slices.Reverse` is literally this:

```go
func Reverse[S ~[]E, E any](s S) {
    for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
        s[i], s[j] = s[j], s[i]
    }
}
```

No room for improvement. The trick and the stdlib helper are byte-identical after inlining.

---

## 10. Rotate: the three-reverses trick, explained at the header

`rotateLeft(s, k)`:

```
input:       [A | B]      A = s[:k], B = s[k:]
reverse(A):  [A' | B]
reverse(B):  [A' | B']
reverse(s):  [B | A]
```

Why three reverses? Algebraically, `(A·B)^R = B^R · A^R`. So reversing both halves and then the whole thing produces `B · A`. No allocation; ~1.5n element writes.

Alternatives:

| Approach | Writes | Allocations |
|----------|--------|-------------|
| Three reverses | 1.5n | 0 |
| `out := append(s[k:], s[:k]...)` | n | 1 |
| Cyclic rotation (gcd loop) | n | 0 |
| `copy` into a temp buffer | n + k or n + (n−k) | 1 |

Three reverses is the simplest **in-place, no-alloc** rotate. The cyclic gcd version uses the same number of writes but is harder to read.

---

## 11. Compact / Compact with predicate

The pre-1.21 trick:

```go
// sorted dedupe
n := 0
for i, x := range s {
    if i == 0 || x != s[i-1] {
        s[n] = x
        n++
    }
}
s = s[:n]
```

`slices.Compact` (Go 1.21):

```go
func Compact[S ~[]E, E comparable](s S) S {
    if len(s) < 2 {
        return s
    }
    i := 1
    for k := 1; k < len(s); k++ {
        if s[k] != s[k-1] {
            if i != k {
                s[i] = s[k]
            }
            i++
        }
    }
    clear(s[i:])   // Go 1.22+ tail-clear
    return s[:i]
}
```

Same algorithm, but with `clear(s[i:])` for pointer-element safety. The `if i != k` skips a self-copy when the run is contiguous from the start — a tiny micro-optimization.

`slices.CompactFunc` takes an equality predicate and is the right choice when comparing by a field (e.g., `User.ID`).

---

## 12. The pointer-zeroing rule, in full

| Scenario | Must zero? |
|----------|------------|
| Element type contains no pointers (`int`, `byte`, `struct{X,Y int}`) | No |
| Element type is a pointer (`*T`, `*[]byte`) | Yes |
| Element type contains a pointer (`User{Name string, Friends []*User}`) | Yes |
| Element type is `string` | Yes — strings are `(ptr, len)`; the `ptr` holds character data alive |
| Element type is a slice (`[]byte`) | Yes — slices are `(ptr, len, cap)`; the `ptr` holds bytes alive |
| Element type is `interface{}` / `any` | Yes — interface header holds a pointer |
| Element type is `map[K]V` | Yes — maps are reference types |

A useful mental check: **if the type's zero value is `nil` for any field, the type's elements need zeroing when they leave a slice**.

The `clear` built-in (Go 1.21+) takes care of generic zeroing:

```go
clear(s[n:])   // s[i] = zero(T) for each i in [n, len(s))
```

Pre-1.21:

```go
for i := n; i < len(s); i++ {
    var zero T
    s[i] = zero
}
```

In hot code, the loop compiles to a `memclr` runtime call for blittable types; for pointer types the compiler emits a write-barrier-aware sequence to maintain the GC's tricolor invariant. `clear` is equivalent.

---

## 13. Aliasing rules a senior must respect

A returned sub-slice **shares the parent's backing array**. Two consequences:

```go
sub := s[i:j]
// 1. sub[k] = x changes s[i+k]
// 2. append(sub, x) may write into s[j], s[j+1], ... as long as cap(sub) > len(sub).
//    cap(sub) is cap(s) - i, not j - i.
```

Defenses:

- **Scoped clone**: `sub := s[i:j:j]`. Forces `cap == len`, so the next `append` grows.
- **Real clone**: `sub := slices.Clone(s[i:j])`. New backing array; full isolation.
- **Don't expose the slice**: hand back a `func(yield func(T) bool)` iterator.

Choose the cheapest defense that meets the threat model. For an internal pipeline, sub-slice sharing is fine and fast. For a public API, return a `slices.Clone` or scoped clone.

---

## 14. The `slices` package as a reference implementation

When in doubt about what a trick *should* do, read the stdlib source. It's small (~600 lines for `slices`), heavily tested, and the canonical correct form. Particularly worth reading:

| Function | Why |
|----------|-----|
| `slices.Insert` | Shows the right shift-then-copy without intermediate alloc |
| `slices.Delete` | Shows the `clear` post-shift for pointer safety |
| `slices.Replace` | Shows shrink-vs-grow branching |
| `slices.Compact` | Shows the write-index pattern |
| `slices.Grow` | Shows the right `append` idiom for preallocation |

The package source: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/slices/slices.go

---

## 15. When a trick is still preferable to `slices.*`

| Trick | Reason to prefer over `slices.*` |
|-------|----------------------------------|
| Swap-and-pop delete | No stdlib equivalent; O(1) vs O(n−i) when order doesn't matter |
| Rotate by k | No stdlib equivalent (as of Go 1.23) |
| Two-finger reverse with custom swap (e.g., `swap` is a method, not assignment) | When elements aren't directly assignable |
| Tight in-place filter with extra accounting (count, sum) | `slices.Filter` doesn't exist; a hand loop fuses passes |
| In-place mutation of pointers in a slice (no new slice) | `slices.*` returns a new slice; mutation via loop is cheaper if you'd already own the slot |

In Go 1.21+ code, default to `slices.*`. Reach for the wiki form only when the helper genuinely doesn't fit.

---

## 16. Codegen comparison

For an `[]int` delete, the wiki trick:

```go
s = append(s[:i], s[i+1:]...)
```

Compiles (Go 1.23, AMD64) to roughly:

```
MOVQ    s+8(FP), CX      ; load len
SUBQ    $1, CX           ; new len
... bounds check ...
MOVQ    s+0(FP), DX      ; load Data
LEAQ    (DX)(i*8), BX    ; src = Data + i*8
LEAQ    8(BX), AX        ; dst = Data + (i+1)*8
... memmove via runtime.memmove ...
MOVQ    CX, s+8(FP)      ; store new len
```

For `slices.Delete(s, i, i+1)`:

```
... essentially the same, with an extra clear loop on the trailing element
```

The two emit nearly identical assembly. The difference is the `clear` at the end of `slices.Delete`, which costs one zero-store. For `int`, immaterial. For `*T`, the difference is whether the write barrier runs — `slices.Delete` runs it correctly.

PGO and inlining tend to fold both into the same machine code for `int`-like types. Don't micro-benchmark; prefer the helper for readability and pointer-safety.

---

## 17. Summary

Every slice trick is a header edit plus a memory move; the senior view is to read the header transformation before reading the syntax. The wiki tricks were optimal for their era but the Go 1.21+ `slices` package replaces nearly all of them with allocation-free, pointer-safe, generic helpers. The exceptions are swap-and-pop delete and rotate, which still need to be hand-written. The pointer-zeroing rule applies to every shrinking trick where the element type contains a pointer (including `string`, `slice`, `map`, `interface`); use `clear(s[n:])` from Go 1.21+ or a manual zero loop pre-1.21. When choosing between a trick and a helper, prefer the helper; it is what your reviewers expect and what the stdlib has carefully optimized.

---

## Further reading
- `slices` source: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/slices/slices.go
- `runtime.growslice`: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/runtime/slice.go
- SliceTricks wiki (legacy reference): https://github.com/golang/go/wiki/SliceTricks
- `clear` built-in: https://pkg.go.dev/builtin#clear
- Sibling — header internals: [../05-slice-header-internals/](../05-slice-header-internals/)
- Sibling — capacity and growth: [../01-capacity-and-growth/](../01-capacity-and-growth/)
