# Go Call by Value — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: Is Go pass-by-value or pass-by-reference?**

**Answer**: Go is strictly **pass-by-value**. Every argument passed to a function is copied into the function's parameter. To allow the function to mutate the caller's variable, you pass a pointer (and the pointer itself is also passed by value — its value, the address, is copied).

```go
func tryDouble(n int) { n *= 2 }
x := 5
tryDouble(x)
fmt.Println(x) // 5 — function had a copy
```

---

**Q2: Why does this code mutate the slice when slices are "passed by value"?**
```go
func zero(s []int) { s[0] = 0 }
s := []int{1, 2, 3}
zero(s)
fmt.Println(s) // [0 2 3]
```

**Answer**: A slice is a small HEADER (pointer + length + capacity) that's passed by value (the header is copied). But the pointer inside the header points to the same backing array. Modifying elements goes through that pointer — visible to caller. Modifying the header itself (e.g., `s = nil`) only affects the local copy.

---

**Q3: How do you make a function mutate a caller's variable?**

**Answer**: Pass a pointer:
```go
func incr(p *int) { *p++ }
x := 5
incr(&x)
fmt.Println(x) // 6
```

The pointer is passed by value (the address is copied), but dereferencing accesses the caller's storage.

---

**Q4: What types are "reference-like" in Go?**

**Answer**: Slice, map, channel, function value, and interface. They are still passed by value, but their values are small headers/handles that point to shared underlying data.

| Type | Header size | Shared data |
|------|-------------|-------------|
| Slice | 24 B (3 words) | Backing array |
| Map | 8 B | Hash table |
| Channel | 8 B | Channel struct |
| Function | 8+ B | Code + captures |
| Interface | 16 B | Concrete value |

---

**Q5: What happens when you pass a struct to a function?**

**Answer**: The entire struct is copied field-by-field into the parameter. For small structs, this is efficient (register-passed). For large structs, the copy is expensive — prefer `*Struct` for performance.

```go
type Big struct { Data [1<<20]byte }
func process(b Big) { /* copies 1 MB! */ }
func processFast(b *Big) { /* 8 B pointer */ }
```

---

## Middle Level Questions

**Q6: What's the difference between modifying a slice's element vs reassigning the slice?**

**Answer**:
- **Element mutation**: `s[i] = v` modifies the shared backing array; visible to caller.
- **Reassignment**: `s = newSlice` modifies only the local header; caller's header unchanged.
- **Append**: `s = append(s, v)` may modify the backing array (if cap allows) and reassigns the local header.

```go
func mutateElems(s []int) { s[0] = 99 }     // visible
func reassign(s []int)    { s = nil }        // not visible
func grow(s []int)        { s = append(s, 99) } // local growth
```

To propagate header changes, return the new slice or pass `*[]T`.

---

**Q7: Why do nil maps panic on write but not on read?**

**Answer**: A nil map has no underlying hash table. Reading returns the zero value of the value type (no allocation needed). Writing requires allocating a bucket, which is impossible without an hmap — so it panics.

```go
var m map[string]int
_ = m["x"]  // 0 — read OK
m["x"] = 1  // panic: assignment to entry in nil map
```

Initialize with `make(map[string]int)` first.

---

**Q8: How does pass-by-value affect method receivers?**

**Answer**: A method's receiver is essentially the first parameter. With a value receiver, the receiver is COPIED:

```go
type Counter struct{ n int }
func (c Counter) Inc() { c.n++ } // operates on a COPY
c := Counter{}
c.Inc()
fmt.Println(c.n) // 0 — original unchanged
```

With a pointer receiver, the pointer is copied (so the function operates through it on the original):

```go
func (c *Counter) IncPtr() { c.n++ }
c.IncPtr()
fmt.Println(c.n) // 1 — original modified
```

---

**Q9: Why is taking the address of a function literal illegal?**

**Answer**: Function literals are not addressable. Their values are funcvals, which the runtime manages. You can take the address of a variable holding the function:

```go
// _ = &func(){} // ERROR
f := func() {}
_ = &f // OK: address of f (a variable)
```

---

**Q10: What's "defensive copy" and when do you need it?**

**Answer**: A defensive copy is a separate copy of caller-provided data, made by the function to prevent the caller from later mutating the stored value:

```go
type Cache struct { items []int }

// BAD: stores a reference; caller can mutate items later
func (c *Cache) BadSet(items []int) { c.items = items }

// GOOD: independent copy
func (c *Cache) Set(items []int) {
    c.items = append([]int(nil), items...)
}
```

Needed when storing slice/map data past the function call.

---

**Q11: Is returning a pointer to a local variable safe?**

**Answer**: Yes. Go's escape analysis automatically moves the variable to the heap if its address escapes. The pointer is valid for the caller's use:

```go
func newCounter() *int {
    n := 0
    return &n // n escapes to heap; safe
}
```

This isn't a "stack-overflow" concern as in C.

---

**Q12: Why is passing a `*[]int` rare in Go?**

**Answer**: Slices are already small headers; passing the slice (header) by value gives access to the backing array, which is what most code needs. `*[]int` (pointer to slice) is needed only when the function must REASSIGN the caller's slice header (e.g., to `nil` or a different slice).

```go
// Modify elements: just []int
func zero(s []int) { for i := range s { s[i] = 0 } }

// Reassign header: *[]int
func clear(sp *[]int) { *sp = nil }
```

---

## Senior Level Questions

**Q13: Walk through what happens when you call `f([]int{1,2,3})`.**

**Answer**:
1. The compiler synthesizes the slice literal: a backing array `[3]int{1, 2, 3}` and a slice header `{ptr: &arr[0], len: 3, cap: 3}`.
2. Escape analysis determines if the array stays on the stack or goes to the heap.
3. The slice header (3 words: ptr, len, cap) is passed via registers (AX, BX, CX on amd64).
4. Inside `f`, the parameter `s` IS those 3 register values.
5. Modifying `s[0]` writes to the shared backing array.
6. Reassigning `s` only changes the local register/slot.

---

**Q14: When does the register ABI spill to the stack?**

**Answer**: When the function has more arguments than fit in the register set, or when individual arguments are too large.

Limits on amd64:
- Up to 9 integer/pointer registers (AX, BX, CX, DI, SI, R8, R9, R10, R11).
- Up to 15 float registers (X0-X14).
- Total per-call register budget.

Structs are decomposed; if they don't fit, they spill. A struct of more than ~64 B typically spills.

When spillover happens, the caller writes args to its outgoing-args area on the stack, and the callee reads from there.

---

**Q15: What's the cost of passing a 1 KB struct vs a pointer to it?**

**Answer**:
- 1 KB struct by value: stack memcpy of 1 KB per call (~10-20 ns plus cache effects).
- Pointer (8 B): single register load (~free).

For 1M calls/sec, the value version copies 1 GB/sec. Pointer version copies almost nothing.

For data-only structs (no embedded mutex), pointer is the better choice for anything > ~64 B.

---

**Q16: What happens to a slice's backing array when you return a sub-slice from a function?**

**Answer**: The returned sub-slice keeps the ENTIRE backing array alive — even the portions not visible through the sub-slice's length.

```go
func first(s []int) []int {
    return s[:1] // returned slice keeps s's whole array alive
}
```

For long-term storage, copy out the bytes:
```go
func first(s []int) []int {
    out := make([]int, 1)
    out[0] = s[0]
    return out
}
```

This is a common source of memory leaks — a small returned slice "anchors" a much larger original.

---

**Q17: How does interface boxing work for value receivers vs pointer receivers?**

**Answer**:

**Value receiver** (`func (t T) M()`):
- Assignment `var i I = T{}` boxes T's value into the interface.
- For small T (fits in 1 word), value may be stored inline in the interface's data slot.
- For larger T, an allocation occurs to hold T's value, and the data slot points to it.

**Pointer receiver** (`func (t *T) M()`):
- Assignment `var i I = &T{}` boxes the pointer.
- The data slot IS the pointer; no extra allocation beyond what already existed for T.

Conclusion: pointer receivers are usually cheaper for boxing.

---

**Q18: A function takes `[]Item` (slice of large items). When is it OK to pass by value?**

**Answer**: Almost always. The slice itself is just 24 B — passing it is fast. The question is whether the function will mutate the items:
- If the function only reads: pass by value is fine.
- If the function modifies items: caller may not see changes (they get the local copy of the header). For element mutation (`s[i].Field = v`), the caller WILL see it (shared backing array).
- If the function appends or reassigns the slice: caller won't see; return the new slice or take a pointer.

For per-item mutation through a pointer:
```go
func process(items []Item) {
    for i := range items {
        items[i].Field = compute() // modifies shared backing
    }
}
```

---

**Q19: What's the typed-nil-interface gotcha and how does pass-by-value contribute?**

**Answer**: Returning a typed nil pointer through an interface result creates a non-nil interface:

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "" }

func f() error {
    var p *MyErr // nil
    return p     // returns interface{itab: *MyErr, data: nil}
}

err := f()
fmt.Println(err == nil) // false!
```

The interface VALUE is `(itab, data)` — both passed as 2 register words. Both must be nil for the interface to compare equal to nil. Here itab is non-nil even though data is nil.

Fix: return literal `nil`:
```go
return nil // (nil, nil) — both words zero
```

---

**Q20: Why might a function that takes a struct by value be slower in Go 1.16 than Go 1.17?**

**Answer**: Go 1.17 introduced the register-based ABI on amd64. Before, all arguments traveled through the stack. After, small structs are decomposed into registers — much faster. A struct that fit in registers in 1.17+ but spilled in 1.16 saw measurable speedup.

For Go versions before 1.17, value passes of even small structs had stack-copy overhead. The post-1.17 ABI changed the cost model significantly.

---

## Scenario-Based Questions

**Q21: Your function is profiled and shows 30% time in `runtime.memmove`. The function takes a struct argument. What do you check?**

**Answer**: Likely the struct is being copied repeatedly. Check:

1. **Struct size**: `unsafe.Sizeof` to see how big.
2. **Frequency**: how often is the function called?
3. **Existing pointer usage**: would `*StructName` work?

If the struct is > ~256 B and called > 1M times/sec, the value-copy is your bottleneck. Switch to a pointer parameter.

Also check: is there a related "decode-into-struct" pattern that could be replaced by "decode-into-pointer"? Or is the struct being returned by value when a pointer would work?

---

**Q22: A team's cache stores caller-provided maps. Callers complain of phantom changes. What's the fix?**

**Answer**: The cache likely stores `m` by reference (the map handle). When callers later mutate `m`, the cache sees the changes.

Fix: defensive deep-copy at `Set`:
```go
func (c *Cache) Set(m map[string]int) {
    copy := make(map[string]int, len(m))
    for k, v := range m {
        copy[k] = v
    }
    c.data = copy
}
```

Or in Go 1.21+:
```go
import "maps"
c.data = maps.Clone(m)
```

Document the contract: "Cache takes a copy of the input map".

---

**Q23: A method has a value receiver but mutations don't persist. What's wrong?**

**Answer**: Value receivers operate on COPIES. `func (t T) M() { t.field++ }` modifies the local copy; caller's `t` is unchanged.

Fix: use pointer receiver: `func (t *T) M() { t.field++ }`.

Or restructure: have the method return a modified value:
```go
func (t T) WithField(f int) T {
    t.field = f
    return t
}
t = t.WithField(42)
```

Choice depends on design philosophy (mutable vs immutable values).

---

**Q24: Concurrent goroutines mutate a slice passed by value to each. Is that safe?**

**Answer**: NO. Although the slice header is copied (each goroutine has its own header value), the BACKING ARRAY is shared. Concurrent writes to elements race.

```go
s := []int{1, 2, 3}
go func(s []int) { s[0] = 99 }(s)  // race
go func(s []int) { s[0] = 100 }(s) // race
```

Fix:
- **Synchronize**: use a mutex.
- **Defensive copy** per goroutine:
  ```go
  go func(s []int) {
      local := append([]int(nil), s...)
      // ... use local ...
  }(s)
  ```
- **Channel-based ownership transfer**: send the slice through a channel; the receiver becomes the sole owner.

---

## FAQ

**Why doesn't Go have explicit pass-by-reference syntax?**

Go's design favors explicitness: if you want indirection, take an address (`&x`) and pass a pointer. There's no implicit reference passing.

---

**When should I use a pointer receiver vs value receiver?**

- **Pointer receiver**: when the method mutates the receiver, when the type is large, when consistency with other methods on the type requires it.
- **Value receiver**: when the method only reads, when the type is small, when the method should have no side effects.

For a given type, prefer consistency: if any method has a pointer receiver, all should.

---

**Are interface values really "pass by value"?**

Yes. The interface value (2 words: itab + data) is copied. The data may be a pointer to the underlying concrete value (which is then shared). So "passing an interface by value" copies the interface struct but the boxed value is shared if it's pointer-typed.

---

**Why do `make([]int, 0)` and `[]int{}` and a nil `[]int` differ?**

All three have length 0. The differences:
- `var s []int`: nil header, no backing array.
- `[]int{}`: non-nil header, empty backing array (or nil — Go may optimize).
- `make([]int, 0)`: non-nil header, empty backing array.

For most operations (range, len, append) they behave identically. Comparison to nil differs.

---

**How do I know if a function will allocate?**

Run `go build -gcflags="-m"` to see escape decisions. Use `go test -benchmem` to count allocations per call.

---

**What's the cost of returning a slice vs a pointer to a slice?**

Returning `[]T` returns a 3-word header (registers, free). Returning `*[]T` returns a single pointer (1 register, free) plus an indirection on access. For most cases, returning the slice directly is preferred.

---

**Where can I read about Go's calling convention?**

[Go Internal ABI documentation](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md). Implementation in `cmd/compile/internal/ssa/decompose.go` and related files.
