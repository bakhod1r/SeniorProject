# Go Pointers with Maps & Slices — Junior Level

## 1. Introduction

Slices and maps in Go are "reference-like" types: when you pass them to a function, the small **header** is copied, but the underlying data is shared. Pointers interact with these types in specific ways:

- **Slice elements** ARE addressable: `&s[0]` works.
- **Map values** are NOT addressable: `&m["key"]` is a compile error.
- For mutable struct values in a map, store pointers: `map[K]*V`.

```go
s := []int{1, 2, 3}
p := &s[0]
*p = 99
fmt.Println(s) // [99 2 3]

m := map[string]int{"a": 1}
// p := &m["a"] // ERROR
```

---

## 2. Prerequisites
- Pointers basics (2.7.1)
- Slices and maps (2.3)
- Call by value (2.6.7)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Slice header | Three-word value: array pointer, length, capacity |
| Backing array | The contiguous memory holding slice elements |
| Map handle | Pointer to internal hash table |
| Addressable | Can have its address taken via `&` |
| Aliasing | Sharing the same underlying data through multiple references |

---

## 4. Core Concepts

### 4.1 Slice Header Is Copied; Backing Array Is Shared
```go
func zero(s []int) { s[0] = 0 }
s := []int{1, 2, 3}
zero(s)
fmt.Println(s) // [0 2 3]
```

The function got a copy of the slice header, but the array it points to is the same.

### 4.2 Slice Element Pointers
```go
s := []int{1, 2, 3}
p := &s[0]
*p = 99
fmt.Println(s) // [99 2 3]
```

Valid because slice elements are addressable.

### 4.3 Map Values Cannot Be Addressed
```go
m := map[string]int{"a": 1}
// p := &m["a"] // compile error
```

Workaround: extract, modify, restore:
```go
v := m["a"]
v++
m["a"] = v
```

### 4.4 Map of Pointers for Mutable Values
```go
type Counter struct{ N int }
m := map[string]*Counter{"a": {N: 1}}
m["a"].N++
fmt.Println(m["a"].N) // 2
```

Storing pointers gives you addressable targets through dereference.

### 4.5 Pointer to Slice (Rare)
```go
func reset(sp *[]int) { *sp = nil }
s := []int{1, 2, 3}
reset(&s)
fmt.Println(s) // []
```

Use only when you need to REASSIGN the caller's slice.

### 4.6 Stale Pointers After Append
```go
s := make([]int, 3, 3) // cap = 3
p := &s[0]
s = append(s, 99)      // realloc; new array
*p = 999               // modifies OLD array
fmt.Println(s)         // [1 0 0 99] — *p doesn't affect s
```

When `append` exceeds capacity, the backing array is reallocated. Existing pointers become stale.

---

## 5. Real-World Analogies

**A library card and the bookshelf**: the slice is your card; the bookshelf is the backing array. Many cards can point to the same shelf. You can also have a finger pointing at a specific book (`&s[i]`). But if the library reorganizes shelves (append realloc), your finger now points at the OLD shelf — useless.

**Mailbox vs the address book**: map's value isn't a fixed mailbox you can hand over — it's an entry in a dynamic register that may be rehashed. To mutate a value, you take it out, modify, put it back.

---

## 6. Mental Models

```
Slice s passed to function:
   header (caller)         header (callee)
   [arr|len|cap]    →copy→  [arr|len|cap]
        │                        │
        └──────► backing array ◄─┘
                  (shared!)
```

For mutating elements: works through shared array.
For appending: callee may reallocate; caller's header unchanged.

---

## 7. Pros & Cons

### Pros (Slices)
- Element pointers are valid and useful
- Element mutation propagates
- Cheap to pass (just header)

### Cons
- Aliasing surprises
- Stale pointers after append realloc
- Slice header reassignment doesn't propagate

### Pros (Maps)
- Mutation propagates (handle is shared)
- O(1) lookup

### Cons (Maps)
- Values not addressable
- Need pointers in values for mutation
- Slow iteration (no order guarantee)

---

## 8. Use Cases

1. Mutating slice elements via pointer.
2. Storing pointers in slices for shared data.
3. Map of pointers for mutable struct values.
4. Pointer-to-slice for header reassignment in functions.
5. Indexing through pointer for sub-iteration.

---

## 9. Code Examples

### Example 1 — Slice Element Pointer
```go
s := []int{1, 2, 3}
p := &s[1]
*p = 99
fmt.Println(s) // [1 99 3]
```

### Example 2 — Map of Pointers
```go
type Counter struct{ N int }
m := map[string]*Counter{
    "a": {N: 0},
    "b": {N: 0},
}
m["a"].N++
m["a"].N++
m["b"].N++
fmt.Println(m["a"].N, m["b"].N) // 2 1
```

### Example 3 — Slice of Pointers
```go
type User struct{ Name string }
users := []*User{
    {Name: "Ada"},
    {Name: "Bob"},
}
for _, u := range users {
    u.Name = strings.ToUpper(u.Name)
}
fmt.Println(users[0].Name) // ADA
```

### Example 4 — Reassign Slice Through Pointer
```go
func appendAll(sp *[]int, values ...int) {
    *sp = append(*sp, values...)
}

s := []int{1, 2}
appendAll(&s, 3, 4, 5)
fmt.Println(s) // [1 2 3 4 5]
```

### Example 5 — Stale Pointer Demo
```go
s := make([]int, 3, 3)
s[0] = 1; s[1] = 2; s[2] = 3
p := &s[0]
fmt.Println(*p) // 1

s = append(s, 99) // exceeds cap; new backing array
*p = 999          // modifies the OLD array
fmt.Println(s)    // [1 2 3 99] — *p not reflected
fmt.Println(*p)   // 999 — refers to detached old array
```

### Example 6 — Map Value Extract-Modify-Restore
```go
type Counter struct{ N int }
m := map[string]Counter{"a": {N: 1}}
c := m["a"]
c.N++
m["a"] = c
fmt.Println(m["a"].N) // 2
```

### Example 7 — Iterating Slice With Element Pointer
```go
s := []int{1, 2, 3}
for i := range s {
    p := &s[i]
    *p *= 10
}
fmt.Println(s) // [10 20 30]
```

---

## 10. Coding Patterns

### Pattern 1 — Map of Pointers for Mutability
```go
m := map[K]*V{}
m[k] = &V{...}
m[k].Field = value
```

### Pattern 2 — Slice of Pointers for Shared/Heterogeneous
```go
items := []*Item{}
items = append(items, &Item{...})
```

### Pattern 3 — Pointer-to-Slice for Append-In-Function
```go
func growSlice(sp *[]int, vs ...int) {
    *sp = append(*sp, vs...)
}
```

### Pattern 4 — Index Pointer in Loop
```go
for i := range s {
    process(&s[i])
}
```

---

## 11. Clean Code Guidelines

1. **Slice elements**: prefer indexing `s[i]` for clarity; pointer `&s[i]` only when needed.
2. **Map values**: use `map[K]*V` when V needs mutation.
3. **Avoid storing pointers to slice elements past appends** — they may go stale.
4. **Prefer return-new-slice over `*[]T` parameters** for clarity.
5. **Defensive copy** when storing caller-provided slices.

---

## 12. Product Use / Feature Example

**A scoreboard (mutable map values)**:

```go
type Score struct{ Points int }

scoreboard := map[string]*Score{
    "alice": {Points: 0},
    "bob":   {Points: 0},
}

func awardPoints(player string, points int) {
    if s, ok := scoreboard[player]; ok {
        s.Points += points
    }
}

awardPoints("alice", 10)
awardPoints("alice", 5)
awardPoints("bob", 3)
fmt.Println(scoreboard["alice"].Points) // 15
```

`*Score` enables direct mutation; with `Score` value, you'd need extract-modify-restore.

---

## 13. Error Handling

```go
m := map[string]*Counter{}
c, ok := m["a"]
if !ok {
    return fmt.Errorf("counter not found")
}
if c == nil {
    return fmt.Errorf("nil counter")
}
c.N++
```

Map lookup returns the zero value (nil for pointer types) for missing keys; check before dereferencing.

---

## 14. Security Considerations

1. **Slices passed to functions are aliased** — caller can mutate after callee returns.
2. **Defensive copy** for caller-provided slices stored long-term.
3. **Map of pointers exposes mutable internals** to anyone with access to the map.
4. **Stale pointers after append** can lead to "lost" updates — be aware.

---

## 15. Performance Tips

1. **Slice headers are 24 B** — passing them is essentially free.
2. **Map values inline** when value type is small; use pointers for large values to keep buckets compact.
3. **Pre-allocate slice cap** to avoid append reallocations.
4. **Pre-allocate map size** with `make(map[K]V, n)` if you know roughly N entries.

---

## 16. Metrics & Analytics

```go
counts := map[string]int{}
for _, item := range items {
    counts[item.Type]++
}
```

For ints in maps, no pointer needed — increment via index works (Go handles it specially for additive updates of map values).

Wait — actually `m[k]++` is `m[k] = m[k] + 1`, so it requires re-storing. That works for map[K]int.

---

## 17. Best Practices

1. Slice element pointers OK for mutation.
2. Map of pointers for mutable struct values.
3. Avoid storing pointers across append-realloc.
4. Document aliasing in function signatures.
5. Use `[]T` (slice) for sequential data; `[]*T` (slice of pointers) when sharing or polymorphism is needed.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — `&m[k]` Compile Error
```go
m := map[string]int{"a": 1}
// p := &m["a"] // error
```
Workaround: extract.

### Pitfall 2 — Stale Element Pointer
```go
p := &s[0]
s = append(s, 1)  // may realloc
*p // may be stale
```

### Pitfall 3 — Map Value Field Mutation
```go
m := map[string]Counter{"a": {N: 1}}
// m["a"].N++  // error: not addressable
```

### Pitfall 4 — Nil Map Write
```go
var m map[string]int
m["x"] = 1 // panic
```
Initialize with `make`.

### Pitfall 5 — Append Doesn't Propagate
```go
func add(s []int) { s = append(s, 99) } // local; caller unaffected
```
Return the new slice, or use `*[]T`.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| `&m[k]` | Extract first |
| `m[k].Field = v` for value-typed V | Store as `*V` or extract |
| Pointer to slice element after append | Refresh after append |
| Forgetting nil map init | `make(map[K]V)` |
| Aliasing surprise on slice store | Defensive copy |

---

## 20. Common Misconceptions

**1**: "Slices are passed by reference."
**Truth**: Header is passed by value; backing array shared. Subtle but important.

**2**: "I can take the address of a map value."
**Truth**: No. Map values are not addressable.

**3**: "After `append`, my old slice still has the appended elements."
**Truth**: If reallocation occurred, the old slice header still has the old array (and old length). Always reassign: `s = append(s, ...)`.

**4**: "Pointers to slice elements are always safe."
**Truth**: Stale after reallocation.

---

## 21. Tricky Points

1. Slice elements addressable; map values not.
2. Append may or may not reallocate (depends on capacity).
3. `s = append(s, ...)` is required to capture potential reallocation.
4. Map of pointers vs map of values has very different mutation semantics.
5. Slice of pointers vs slice of values affects GC pointer density.

---

## 22. Test

```go
func TestSliceMutation(t *testing.T) {
    s := []int{1, 2, 3}
    p := &s[0]
    *p = 99
    if s[0] != 99 { t.Fail() }
}

func TestMapPointerMutation(t *testing.T) {
    type C struct{ N int }
    m := map[string]*C{"a": {}}
    m["a"].N = 42
    if m["a"].N != 42 { t.Fail() }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
m := map[string]int{"a": 1}
v := m["a"]
v++
fmt.Println(m["a"])
```
**A**: `1`. `v` is a copy; modifying it doesn't affect the map.

**Q2**: What does this print?
```go
s := make([]int, 3, 3)
p := &s[0]
s = append(s, 99)
*p = 999
fmt.Println(s)
```
**A**: `[1 0 0 99]`. Append reallocated; `s` points to new array; `*p` modified the old (now-detached) array.

---

## 24. Cheat Sheet

```go
// Slice element pointer
p := &s[i]
*p = newValue

// Map of pointers (for mutation)
m := map[K]*V{}
m[k] = &V{}
m[k].Field = ...

// Pointer to slice (for header reassignment)
func reset(sp *[]int) { *sp = nil }

// Refresh after append
s = append(s, 99) // always reassign
```

---

## 25. Self-Assessment Checklist

- [ ] I know slice elements are addressable
- [ ] I know map values are not addressable
- [ ] I use `map[K]*V` for mutable values
- [ ] I'm aware of stale pointers after append
- [ ] I always reassign after append
- [ ] I use defensive copy when needed

---

## 26. Summary

Slices: element pointers valid, but watch for stale-after-append. Maps: values not addressable; use `map[K]*V` for mutable values. Both types pass by value (header/handle copied) but share underlying data — mutations propagate, reassignments don't.

---

## 27. What You Can Build

- Mutable scoreboards (map[K]*V)
- Slice-of-pointers for polymorphism
- Functions that grow caller's slice via *[]T
- Iterators with per-element pointer

---

## 28. Further Reading

- [Go Blog — Go slices: usage and internals](https://go.dev/blog/slices-intro)
- [Go Blog — Maps in action](https://go.dev/blog/maps)
- [Effective Go — Slices](https://go.dev/doc/effective_go#slices)

---

## 29. Related Topics

- 2.7.1 Pointers Basics
- 2.7.2 Pointers with Structs
- 2.6.7 Call by Value
- 2.3.2 Slices, 2.3.4 Maps

---

## 30. Diagrams & Visual Aids

### Slice header sharing
```
caller s:  [arr* | len | cap]
              │
              ▼
          [1, 2, 3]   ← shared backing array
              ▲
              │
callee s': [arr* | len | cap] (copy of header)
```
