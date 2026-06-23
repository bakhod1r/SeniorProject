# Go Call by Value — Junior Level

## 1. Introduction

### What is it?
**Go is a pass-by-value language**: every argument you pass to a function is **copied** into the function's parameter. The function works on its local copy. Modifications inside the function don't change the caller's variable.

```go
func tryDouble(n int) {
    n *= 2
}

x := 5
tryDouble(x)
fmt.Println(x) // still 5 — function had its own copy
```

To mutate the caller's variable, pass a **pointer**:
```go
func actuallyDouble(p *int) {
    *p *= 2
}

x := 5
actuallyDouble(&x)
fmt.Println(x) // 10
```

---

## 2. Prerequisites
- Functions basics (2.6.1)
- Variables and types
- Basic understanding of pointers (covered in detail in 2.7)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| pass by value | Each argument is copied into the parameter |
| pass by reference | Function receives the same storage as caller — Go does NOT do this directly |
| copy | An independent duplicate of a value |
| pointer | A value holding the address of another value |
| dereference | Access the value pointed to (`*p`) |
| address-of | Get the address (`&x`) |
| reference type | Slice/map/channel/function: a small handle to underlying data |

---

## 4. Core Concepts

### 4.1 Primitives Are Copied
```go
func add5(n int) {
    n += 5
}

x := 10
add5(x)
fmt.Println(x) // 10 — x not modified
```

The function receives a copy of `x`. The copy is incremented; `x` is untouched.

### 4.2 Use Pointers to Mutate
```go
func add5ToVar(p *int) {
    *p += 5
}

x := 10
add5ToVar(&x)
fmt.Println(x) // 15
```

`&x` takes the address of `x`. `*p` accesses the value at that address.

### 4.3 Slices Are Reference-Like (But Header Is Still Copied!)
```go
func zero(s []int) {
    for i := range s {
        s[i] = 0 // modifies SHARED backing array
    }
}

s := []int{1, 2, 3}
zero(s)
fmt.Println(s) // [0 0 0] — caller sees changes
```

A slice is a small header (pointer to array + length + capacity). The header is copied, but the pointer in it points to the SAME array. So element mutations are visible.

### 4.4 But Reassigning a Slice Param Doesn't Affect Caller
```go
func clear(s []int) {
    s = nil // local `s` is now nil; caller's slice unchanged
}

s := []int{1, 2, 3}
clear(s)
fmt.Println(s) // [1 2 3] — still here
```

`s = nil` changes the LOCAL header. The caller's header is unaffected.

### 4.5 Maps Behave Similarly
```go
func add(m map[string]int) {
    m["x"] = 99 // modifies shared map data
}

m := map[string]int{"a": 1}
add(m)
fmt.Println(m) // map[a:1 x:99]
```

Maps are reference-like; the map header is copied, but both copies share the same underlying hash table.

### 4.6 Structs Are Copied Field-by-Field
```go
type Point struct{ X, Y int }

func translate(p Point) {
    p.X += 10
}

pt := Point{1, 2}
translate(pt)
fmt.Println(pt) // {1 2} — unchanged
```

For mutation, pass `*Point`:
```go
func translate(p *Point) {
    p.X += 10
}
translate(&pt) // {11 2}
```

---

## 5. Real-World Analogies

**A photocopy**: when you give a photocopy to someone, they can write on it — but your original is untouched. Pass-by-value is like making a photocopy of every argument.

**A library card vs the book**: lending the card (pointer) lets the borrower access the book itself. Lending a copy of the card (pointer-by-value) — they have their own card, but it points to the same book.

**A house key**: copying a key (pointer copy) gives someone access to the same house. They can rearrange the furniture (mutate), but they can't make THEIR copy of the key point to a different house just by holding it.

---

## 6. Mental Models

### Model 1 — Every Argument Is a Photocopy

```
caller: x = 5
   │
   │ copy
   ▼
callee param n = 5  (independent storage)

   modifications to n stay in callee
```

### Model 2 — Pointers Share, Not Reassignments

```
caller: x = 5; pass &x as p

callee:
    *p = 99   ← writes to caller's x
    p = nil   ← changes callee's local p; caller's variable unaffected
```

---

## 7. Pros & Cons

### Pros
- Simple, predictable mental model — no implicit aliasing
- Functions can't accidentally mutate caller state
- Easier to reason about concurrency (without shared mutable state)
- Fits the register ABI well (small types in registers)

### Cons
- Large struct copies are wasteful — use pointers for performance
- "Reference type" semantics (slices, maps) are subtle and confuse newcomers
- Want mutation? You must consciously pass a pointer

---

## 8. Use Cases

1. Pass primitives (int, bool, string) — always by value, no concern.
2. Pass small structs by value for clarity.
3. Pass large structs by pointer to avoid copying.
4. Pass slices/maps/channels — header copied, content shared.
5. Pass pointers when mutation is needed.
6. Pass interface values (boxes any concrete type).

---

## 9. Code Examples

### Example 1 — Primitive Copy
```go
package main

import "fmt"

func square(n int) int {
    n = n * n
    return n
}

func main() {
    x := 5
    sq := square(x)
    fmt.Println(x, sq) // 5 25
}
```

### Example 2 — Pointer for Mutation
```go
package main

import "fmt"

func incr(p *int) {
    *p++
}

func main() {
    n := 1
    incr(&n)
    incr(&n)
    fmt.Println(n) // 3
}
```

### Example 3 — Struct Copied
```go
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

func birthday(u User) {
    u.Age++
}

func main() {
    u := User{Name: "Ada", Age: 30}
    birthday(u)
    fmt.Println(u.Age) // 30 — unchanged
}
```

### Example 4 — Struct via Pointer Mutated
```go
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

func birthday(u *User) {
    u.Age++ // (*u).Age++
}

func main() {
    u := &User{Name: "Ada", Age: 30}
    birthday(u)
    fmt.Println(u.Age) // 31
}
```

### Example 5 — Slice Element Mutation Visible
```go
package main

import "fmt"

func square(s []int) {
    for i := range s {
        s[i] = s[i] * s[i]
    }
}

func main() {
    s := []int{1, 2, 3, 4}
    square(s)
    fmt.Println(s) // [1 4 9 16]
}
```

### Example 6 — Slice Append May or May Not Be Visible
```go
package main

import "fmt"

func add(s []int, v int) {
    s = append(s, v) // may reallocate; caller's s unchanged either way
}

func main() {
    s := []int{1, 2, 3}
    add(s, 99)
    fmt.Println(s) // [1 2 3]
}
```

To get the new slice, return it:
```go
func add(s []int, v int) []int {
    return append(s, v)
}
s = add(s, 99)
```

### Example 7 — Map Mutation Visible
```go
package main

import "fmt"

func setX(m map[string]int) {
    m["x"] = 100
}

func main() {
    m := map[string]int{}
    setX(m)
    fmt.Println(m) // map[x:100]
}
```

---

## 10. Coding Patterns

### Pattern 1 — Pure Function (No Mutation)
```go
func double(n int) int {
    return n * 2
}
```
No pointers, no side effects.

### Pattern 2 — Mutate via Pointer
```go
func setName(u *User, name string) {
    u.Name = name
}
```

### Pattern 3 — Return New Value (Functional Style)
```go
func renamed(u User, name string) User {
    u.Name = name
    return u
}

newU := renamed(u, "Linus")
```

### Pattern 4 — Sort In-Place (Slice Element Mutation)
```go
func sortInPlace(s []int) {
    sort.Ints(s) // modifies s's backing array
}
```

---

## 11. Clean Code Guidelines

1. **Document mutation in the function comment** — "modifies s in place" or "returns a new slice".
2. **Use pointers when you need mutation** — don't fake it with reassignment that won't propagate.
3. **For large structs (> 64 B), prefer pointer parameters** to avoid copy cost.
4. **For small structs and primitives, value parameters are usually fine**.
5. **Don't pass by pointer just to "save copying"** if the type is small — clarity matters more.

---

## 12. Product Use / Feature Example

**A user update API**:

```go
package main

import "fmt"

type User struct {
    ID   int
    Name string
    Age  int
}

// Update modifies u in place. Returns an error if invalid.
func Update(u *User, name string, age int) error {
    if age < 0 || age > 150 {
        return fmt.Errorf("invalid age: %d", age)
    }
    u.Name = name
    u.Age = age
    return nil
}

func main() {
    u := &User{ID: 1, Name: "Ada", Age: 30}
    if err := Update(u, "Ada Lovelace", 36); err != nil {
        fmt.Println(err)
    }
    fmt.Printf("%+v\n", u) // {ID:1 Name:Ada Lovelace Age:36}
}
```

The function takes `*User` to mutate the caller's struct.

---

## 13. Error Handling

When a function takes a pointer and may not be able to complete:

```go
func setAge(u *User, age int) error {
    if u == nil {
        return fmt.Errorf("nil user")
    }
    if age < 0 {
        return fmt.Errorf("negative age")
    }
    u.Age = age
    return nil
}
```

Always check for nil pointers when accepting them.

---

## 14. Security Considerations

1. **Mutating shared data via pointers** can cause races in concurrent code. Synchronize.
2. **Passing a pointer can leak access** to the entire pointee — be careful with sensitive data.
3. **Slices/maps shared via parameters** can be mutated by the callee. If you don't want that, pass a copy.
4. **Don't return a pointer to a local variable that the caller shouldn't outlive** — Go's escape analysis handles safety, but lifetime matters.

---

## 15. Performance Tips

1. **Small types (≤ 64 B): value pass is fine** — register ABI handles it.
2. **Large structs (> 64 B): pointer pass avoids the copy**.
3. **Slices, maps, channels are 1-3 words** — copying their headers is essentially free.
4. **Returning a small struct by value is OK** — register ABI passes it back efficiently.
5. **Don't optimize prematurely**. Profile first.

---

## 16. Metrics & Analytics

```go
import "time"

func processed(item Item, dur time.Duration) {
    // log dur
    fmt.Printf("[item=%v] %v\n", item, dur)
}

start := time.Now()
process(item)
processed(item, time.Since(start))
```

Pass duration by value (it's a small int64).

---

## 17. Best Practices

1. Use pointers for mutation; values for read-only.
2. Document whether functions mutate their arguments.
3. For large structs, prefer pointer parameters.
4. For small types, value parameters are clearer.
5. Be aware of slice/map aliasing.
6. When you want an independent slice, copy: `append([]T(nil), s...)`.
7. Always check for nil pointers when receiving them.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — "I changed the parameter but caller doesn't see it"
```go
func tryReplace(s []int) {
    s = []int{99} // local s reassigned
}

s := []int{1, 2, 3}
tryReplace(s)
fmt.Println(s) // [1 2 3]
```

To replace, take a pointer to slice:
```go
func replace(sp *[]int) {
    *sp = []int{99}
}
replace(&s)
fmt.Println(s) // [99]
```

### Pitfall 2 — "Slice append doesn't propagate"
```go
func grow(s []int) {
    s = append(s, 99) // local growth
}

s := []int{1, 2, 3}
grow(s)
fmt.Println(s) // [1 2 3]
```

Fix: return the new slice or pass a pointer to slice.

### Pitfall 3 — "Map writes panic"
```go
var m map[string]int // nil
m["x"] = 1 // panic: assignment to entry in nil map
```
Initialize with `make(map[string]int)` first.

### Pitfall 4 — Passing huge array by value
```go
type Big struct{ data [1<<20]byte }

func process(b Big) { /* ... */ } // 1 MB copy per call!
```
Use `*Big`.

### Pitfall 5 — Pointer to local that escapes
```go
func newCounter() *int {
    n := 0
    return &n // n escapes to heap; that's fine, just be aware
}
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Modifying parameter expecting caller change | Pass a pointer |
| Reassigning slice param expecting caller change | Return the new slice or pass `*[]T` |
| Calling method on nil pointer | Check for nil first |
| Passing huge struct by value in hot loop | Use a pointer |
| Forgetting maps are reference-like | Initialize with `make` before writing |

---

## 20. Common Misconceptions

**Misconception 1**: "Slices and maps are passed by reference."
**Truth**: They're passed by value, but the value is a small header pointing to shared underlying data. Element mutations are visible because the data is shared; reassignments are not.

**Misconception 2**: "Passing a struct is slow."
**Truth**: For small structs (≤ 64 B), the register ABI passes them efficiently. For large ones, prefer pointers.

**Misconception 3**: "Returning a pointer to a local variable is unsafe."
**Truth**: Go's escape analysis moves it to the heap. Safe.

**Misconception 4**: "Pointers are always faster."
**Truth**: For small types, value pass is faster (register, no indirection). For large types, pointer wins.

**Misconception 5**: "Channels are special — they're truly by reference."
**Truth**: A channel value is a small handle (pointer). The handle is copied; both copies refer to the same underlying channel.

---

## 21. Tricky Points

1. The "reference type" terminology is informal; technically all types are by-value, but reference types have small handles to shared data.
2. Slice append may or may not modify the underlying array depending on capacity.
3. Modifying a struct field via pointer is `(*p).X = y` (or `p.X = y` with auto-dereference).
4. Maps require `make` before use — nil map writes panic.
5. Channel send/receive is by-value — the VALUE in the channel is copied at each operation.

---

## 22. Test

```go
package main

import "testing"

type User struct{ Age int }

func birthday(u *User) { u.Age++ }

func TestBirthday(t *testing.T) {
    u := &User{Age: 30}
    birthday(u)
    if u.Age != 31 {
        t.Errorf("got %d, want 31", u.Age)
    }
}

func TestBirthdayValueReceiver(t *testing.T) {
    u := User{Age: 30}
    func(u User) { u.Age++ }(u)
    if u.Age != 30 {
        t.Errorf("got %d, want 30 (no mutation expected)", u.Age)
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
func mod(s []int) { s[0] = 999 }
s := []int{1, 2, 3}
mod(s)
fmt.Println(s)
```
**A**: `[999 2 3]`. Slice element mutation visible (shared backing array).

**Q2**: What does this print?
```go
func mod(s []int) { s = append(s, 99) }
s := []int{1, 2, 3}
mod(s)
fmt.Println(s)
```
**A**: `[1 2 3]`. Local s reassignment doesn't affect caller's header.

**Q3**: What does this print?
```go
type T struct{ N int }
func mod(t T) { t.N = 99 }
t := T{N: 1}
mod(t)
fmt.Println(t.N)
```
**A**: `1`. Struct copied; mutation only on copy.

---

## 24. Cheat Sheet

```go
// Read only
func use(n int) {}

// Mutate primitive: pointer
func incr(p *int) { *p++ }

// Mutate struct: pointer
func grow(u *User) { u.Age++ }

// Mutate slice elements: just the slice (header copied; data shared)
func zero(s []int) { for i := range s { s[i] = 0 } }

// Reassign slice/map header: return or pass pointer
func makeNew(sp *[]int) { *sp = []int{99} }
// Or: func makeNew() []int { return []int{99} }

// Map mutation visible (shared)
func set(m map[string]int) { m["x"] = 1 }

// Channel send/receive (handle shared)
func send(ch chan<- int, v int) { ch <- v }
```

---

## 25. Self-Assessment Checklist

- [ ] I know all Go args are pass-by-value
- [ ] I use pointers when I need to mutate caller's variable
- [ ] I understand slice/map/channel "reference type" semantics
- [ ] I know slice element mutations propagate; reassignments don't
- [ ] I know map writes propagate; the map header is shared
- [ ] I avoid passing huge structs by value
- [ ] I check pointer parameters for nil
- [ ] I document mutation behavior in function comments

---

## 26. Summary

Go is pass-by-value: every argument is copied into the function's parameter. For primitives and small structs, this is efficient. For large structs, prefer pointers. "Reference types" (slices, maps, channels, functions, interfaces) are passed by value too, but their values are small headers pointing to shared underlying data — so element/data modifications propagate, but reassignments of the header don't. To mutate the caller's variable, pass a pointer.

---

## 27. What You Can Build

- Functions that mutate caller state via pointers
- Pure (read-only) functions that take values
- Slice processors that modify in-place
- Map updaters
- Channel-based concurrent helpers
- Builder patterns (returning modified copies)

---

## 28. Further Reading

- [Go Spec — Calls](https://go.dev/ref/spec#Calls)
- [Effective Go — Functions](https://go.dev/doc/effective_go#functions)
- [Go FAQ — Why are slices not passed by reference?](https://go.dev/doc/faq#references)
- [Dave Cheney — There is no "pass-by-reference" in Go](https://dave.cheney.net/2017/04/29/there-is-no-pass-by-reference-in-go)

---

## 29. Related Topics

- 2.7 Pointers (deep dive)
- 2.7.3 With Maps & Slices (more on aliasing)
- 2.6.1 Functions Basics
- Chapter 3 Methods (value vs pointer receivers)

---

## 30. Diagrams & Visual Aids

### Pass by value vs pointer

```
PASS BY VALUE:
caller: x = 5
    │
    │ copy
    ▼
callee: n = 5  (independent)

  modifications to n: stay in callee.

PASS POINTER:
caller: x = 5
   addr: &x
    │
    │ pointer copied
    ▼
callee: p = &x  (points to caller's x)

  *p = 99: modifies caller's x.
```

### Slice header vs data

```
caller's slice s:
    [ ptr | len | cap ]
       │
       ▼
    [array: 1, 2, 3] ← shared with callee

callee's parameter s' (after pass-by-value):
    [ ptr | len | cap ]   ← copy of header
       │
       ▼ (same!)
    [array: 1, 2, 3]
```

Mutating elements through s' affects the array → caller sees.
Reassigning s' (`s' = newSlice`) only changes callee's header.
