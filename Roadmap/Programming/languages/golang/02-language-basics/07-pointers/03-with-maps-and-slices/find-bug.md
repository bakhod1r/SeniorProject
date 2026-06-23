# Go Pointers with Maps & Slices — Find the Bug

## Instructions

Identify, explain, fix. Difficulty: 🟢 🟡 🔴.

---

## Bug 1 🟢 — `&m["key"]`

```go
m := map[string]int{"a": 1}
p := &m["a"]
*p = 99
```

<details>
<summary>Solution</summary>

**Bug**: Map values not addressable. Compile error.

**Fix**: extract or use `map[K]*V`:
```go
v := m["a"]; v = 99; m["a"] = v
```
</details>

---

## Bug 2 🟢 — Append Result Discarded

```go
s := []int{1, 2, 3}
append(s, 99)
fmt.Println(s) // expected [1 2 3 99]
```

<details>
<summary>Solution</summary>

**Bug**: `append` returns a new slice; discarding the result loses the change. Output: `[1 2 3]`.

**Fix**: `s = append(s, 99)`.
</details>

---

## Bug 3 🟢 — Map Value Field Mutation

```go
type Counter struct{ N int }
m := map[string]Counter{"a": {N: 1}}
m["a"].N++
```

<details>
<summary>Solution</summary>

**Bug**: Map value field can't be modified directly (not addressable). Compile error.

**Fix**: store as `map[string]*Counter` OR extract-modify-restore.
</details>

---

## Bug 4 🟡 — Stale Pointer After Append

```go
s := make([]int, 3, 3)
s[0] = 1
p := &s[0]
s = append(s, 99)
*p = 999
fmt.Println(s)
```

<details>
<summary>Solution</summary>

**Bug**: append reallocates (cap was 3, exceeded). `p` points to the old (detached) array. `*p = 999` doesn't affect `s`. Output: `[1 0 0 99]`.

**Fix**: use index `s[0] = 999` instead of cached pointer; or `p = &s[0]` after append.
</details>

---

## Bug 5 🟡 — Subslice Append Surprise

```go
a := []int{1, 2, 3, 4, 5}
b := a[:3] // cap=5
b = append(b, 99)
fmt.Println(a) // expected [1 2 3 4 5]
```

<details>
<summary>Solution</summary>

**Bug**: `b`'s cap is 5 (inherited from `a`). `append` writes within shared backing — overwrites `a[3]`. Output: `[1 2 3 99 5]`.

**Fix** (defensive copy):
```go
b := append([]int{}, a[:3]...)
b = append(b, 99)
// a is unaffected
```
</details>

---

## Bug 6 🟡 — Concurrent Map Panic

```go
m := map[int]int{}
for i := 0; i < 100; i++ {
    go func(i int) { m[i] = i }(i)
}
```

<details>
<summary>Solution</summary>

**Bug**: Concurrent map writes panic with "concurrent map writes".

**Fix**: `sync.RWMutex`:
```go
var mu sync.RWMutex
m := map[int]int{}
for i := 0; i < 100; i++ {
    go func(i int) {
        mu.Lock()
        m[i] = i
        mu.Unlock()
    }(i)
}
```

Or `sync.Map`.
</details>

---

## Bug 7 🟡 — Loop Variable Pointer in Pre-1.22

```go
items := []int{1, 2, 3}
var ptrs []*int
for _, x := range items {
    ptrs = append(ptrs, &x)
}
```

<details>
<summary>Solution</summary>

**Pre-1.22**: All `&x` are the same pointer. After loop, all point to value 3.

**Fix**: shadow `x := x`, OR use index `&items[i]`, OR upgrade to Go 1.22+.
</details>

---

## Bug 8 🔴 — Subslice Pinning Memory

```go
big := make([]byte, 1<<20)
small := big[:10]
big = nil
runtime.GC()
// 1 MB still alive (small references the backing)
```

<details>
<summary>Solution</summary>

**Bug**: `small` references the backing array. The whole 1 MB stays alive.

**Fix** — copy out:
```go
small := make([]byte, 10)
copy(small, big[:10])
big = nil
// 1 MB collectable
```
</details>

---

## Bug 9 🔴 — Map Iteration Order Assumption

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k, v := range m {
    fmt.Println(k, v)
}
// Code assumes alphabetical order
```

<details>
<summary>Solution</summary>

**Bug**: Map iteration order is RANDOMIZED by Go (intentionally, to discourage reliance on order). Output varies.

**Fix** — sort keys explicitly:
```go
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }
sort.Strings(keys)
for _, k := range keys {
    fmt.Println(k, m[k])
}
```
</details>

---

## Bug 10 🔴 — Storing Pointers to Loop's Slice Index

```go
items := []int{1, 2, 3}
var ptrs []*int
for i := range items {
    ptrs = append(ptrs, &items[i])
}
items = append(items, 99) // may realloc
fmt.Println(*ptrs[0])
```

<details>
<summary>Solution</summary>

**Bug**: After append, `items` may have a new backing array. `ptrs[0]` still points to the old array.

**Fix**: don't append after taking element pointers, OR re-acquire pointers after append, OR use indices instead of pointers.
</details>
