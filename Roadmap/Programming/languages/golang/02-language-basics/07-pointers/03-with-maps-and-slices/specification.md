# Go Specification: Pointers with Maps & Slices

**Source:** https://go.dev/ref/spec#Slice_types, https://go.dev/ref/spec#Map_types

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Slice types** | https://go.dev/ref/spec#Slice_types |
| **Map types** | https://go.dev/ref/spec#Map_types |
| **Address operators** | https://go.dev/ref/spec#Address_operators |
| **Go Version** | Go 1.0+ |

---

## 2. Definition

This topic covers the interaction between pointers and Go's two main reference types — slices and maps. Key facts:
- **Slices** are passed by value (header copied), but share their backing array.
- **Maps** are passed by value (handle copied), but share the underlying hash table.
- **Slice elements ARE addressable**: `&s[i]` is valid.
- **Map values are NOT addressable**: `&m[k]` is a compile error.
- Storing pointers in slices or maps is common; but be aware of GC and aliasing implications.

---

## 3. Core Rules & Constraints

### 3.1 Slice Header Layout
```go
type slice struct {
    array unsafe.Pointer
    len   int
    cap   int
}
```

24 bytes on 64-bit. The `array` pointer points to the backing array.

### 3.2 Map Header
A map "value" is a pointer to an `hmap` struct. 8 bytes.

### 3.3 Slice Elements Are Addressable
```go
s := []int{1, 2, 3}
p := &s[0] // *int, points to s's backing array
*p = 99
fmt.Println(s) // [99 2 3]
```

### 3.4 Map Values Are NOT Addressable
```go
m := map[string]int{"a": 1}
// p := &m["a"] // compile error
```

The map runtime may rehash and move values; stable addresses would be unsafe.

### 3.5 Method Call on Map Value Field
```go
type Counter struct{ N int }
func (c *Counter) Inc() { c.N++ }

m := map[string]Counter{"a": {N: 1}}
// m["a"].Inc() // compile error
```

Workaround: store pointers, or extract-mutate-restore.

### 3.6 Slice of Pointers vs Pointer to Slice
```go
ptrs := []*Item{}      // slice of pointers; common
sliceP := &items       // pointer to slice; rare (use when reassigning the slice variable)
```

### 3.7 Map Value as Pointer
```go
m := map[string]*Counter{}
m["a"] = &Counter{N: 1}
m["a"].Inc() // OK: pointer is addressable through dereference
```

This is the standard pattern for mutable map values.

### 3.8 `append` and Slice Reallocation
```go
s := make([]int, 3, 5)
s = append(s, 99) // fits in cap; same array
s = append(s, ...big...) // exceeds cap; new array allocated; old refs stale
```

If you stored pointers to slice elements, after a reallocation those pointers become stale (point to old array).

---

## 4. Type Rules

### 4.1 Slice Pointer Is Different From Slice
- `[]T`: slice header (24 B).
- `*[]T`: pointer to slice header (8 B). Use only when you need to reassign the slice from a function.

### 4.2 Map Pointer Is Almost Never Useful
A map value is already a pointer to hmap. `*map[K]V` adds an extra layer of indirection rarely needed.

---

## 5. Behavioral Specification

### 5.1 Slice Element Pointers Stable Until Realloc
```go
s := make([]int, 3, 10)
p := &s[0]
s = append(s, 99) // cap 10; no realloc
*p = 999
fmt.Println(s) // [999 0 0 99]
```

But:
```go
s := make([]int, 3, 3)
p := &s[0]
s = append(s, 99) // realloc; new array
*p = 999          // modifies OLD array; not visible in s
```

### 5.2 Map Mutation Visible Through All References
```go
m := map[string]int{}
n := m
m["a"] = 1
fmt.Println(n["a"]) // 1 — same hmap
```

### 5.3 Slice Subset Shares Backing
```go
a := []int{1, 2, 3, 4, 5}
b := a[1:4] // shares backing
b[0] = 99
fmt.Println(a) // [1 99 3 4 5]
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| `&s[i]` for slice s | Defined — pointer to element |
| `&m[k]` for map m | Compile error |
| Pointer to slice element after append realloc | Stale (points to old array) |
| `*[]T` parameter | Defined — pointer to slice header |
| `*map[K]V` parameter | Defined but rarely useful |
| Method call on map value field | Compile error (not addressable) |
| Iterating with `for i := range s` then `&s[i]` | Defined — pointer to current element |
| Modifying map during iteration | Defined — newly added entries may or may not appear |
| Modifying slice during iteration | Defined — undefined behavior may result depending on operations |

---

## 7. Edge Cases from Spec

### 7.1 Pointer to Index
```go
s := []int{1, 2, 3}
for i := range s {
    p := &s[i] // valid; per-iteration pointer
    *p *= 2
}
```

### 7.2 Map of Pointers, Mutation
```go
m := map[string]*Counter{"a": {}}
m["a"].N++
fmt.Println(m["a"].N) // 1
```

### 7.3 Slice Header Pointer
```go
func resetSlice(sp *[]int) { *sp = nil }
s := []int{1, 2, 3}
resetSlice(&s)
fmt.Println(s) // []
```

### 7.4 Stale Pointer After Append
```go
s := make([]int, 3, 3)
p := &s[0]
s = append(s, 99) // reallocates
fmt.Println(*p, s) // 1 [1 0 0 99] — *p is stale
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Slice/map semantics established |
| Go 1.21 | `slices` and `maps` packages with helpers |

---

## 9. Implementation-Specific Behavior

### 9.1 Slice Backing Array Allocation
- Stack if it doesn't escape.
- Heap if it does.

### 9.2 Map Hash Table Allocation
Always heap (the runtime needs a stable home).

### 9.3 Map Value Storage
Maps with pointer values: each value is a pointer (8 B). Map with value-typed values: stored inline in hash buckets.

For large value types in maps, prefer pointer values to keep buckets compact.

---

## 10. Spec Compliance Checklist

- [ ] `&s[i]` used for slice element pointers
- [ ] No `&m[k]` attempts
- [ ] Map values that need mutation: store pointers
- [ ] After `append`, refresh pointers if cap may have grown
- [ ] `*[]T` only when reassigning the slice header

---

## 11. Official Examples

### Example 1: Slice Element Pointer
```go
s := []int{1, 2, 3}
p := &s[1]
*p = 99
fmt.Println(s) // [1 99 3]
```

### Example 2: Map of Pointers for Mutation
```go
type Counter struct{ N int }
m := map[string]*Counter{"a": {}}
m["a"].N++
m["a"].N++
fmt.Println(m["a"].N) // 2
```

### Example 3: Pointer to Slice for Reassignment
```go
func clear(sp *[]int) { *sp = nil }
s := []int{1, 2, 3}
clear(&s)
fmt.Println(s) // []
```

### Example 4: Stale Pointer After Append
```go
s := make([]int, 3, 3)
p := &s[0]
s = append(s, 99) // realloc
*p = 999          // modifies OLD array
fmt.Println(s)    // [1 0 0 99] — s sees the new array
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Slice types | https://go.dev/ref/spec#Slice_types | Slice header, element addressability |
| Map types | https://go.dev/ref/spec#Map_types | Map non-addressability |
| Index expressions | https://go.dev/ref/spec#Index_expressions | s[i], m[k] |
| Address operators | https://go.dev/ref/spec#Address_operators | &s[i] |
| Append | https://go.dev/ref/spec#Appending_and_copying_slices | Realloc semantics |
