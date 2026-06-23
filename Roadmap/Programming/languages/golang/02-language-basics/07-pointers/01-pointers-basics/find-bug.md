# Go Pointers Basics — Find the Bug

## Instructions

Each exercise has buggy Go code. Identify the bug, explain, fix. Difficulty: 🟢 🟡 🔴.

---

## Bug 1 🟢 — Nil Pointer Dereference

```go
var p *int
fmt.Println(*p)
```

<details>
<summary>Solution</summary>

**Bug**: `p` is nil; `*p` panics.

**Fix**:
```go
if p != nil {
    fmt.Println(*p)
}
```

**Key lesson**: Always nil-check.
</details>

---

## Bug 2 🟢 — Forgot &

```go
func incr(p *int) { *p++ }

n := 5
incr(n) // ?
```

<details>
<summary>Solution</summary>

**Bug**: Passing `n` (int), but function expects `*int`. Compile error.

**Fix**: `incr(&n)`.

**Key lesson**: Use `&` to take address.
</details>

---

## Bug 3 🟢 — Forgot * to Dereference

```go
n := 5
p := &n
fmt.Println(p) // prints address, not 5
```

<details>
<summary>Solution</summary>

**Bug**: Prints the pointer value (address), not the pointed-to value.

**Fix**: `fmt.Println(*p)` for the value `5`.

**Key lesson**: `*p` to read the pointee.
</details>

---

## Bug 4 🟡 — Pointer Arithmetic

```go
arr := [3]int{1, 2, 3}
p := &arr[0]
p++
fmt.Println(*p)
```

<details>
<summary>Solution</summary>

**Bug**: Go forbids pointer arithmetic. **Compile error**: `invalid operation: p++`.

**Fix**: use slice indexing: `arr[1]` or `arr[:][1]`.

**Key lesson**: Use slices, not pointer arithmetic.
</details>

---

## Bug 5 🟡 — Address of Map Value

```go
m := map[string]int{"a": 1}
p := &m["a"]
*p = 99
```

<details>
<summary>Solution</summary>

**Bug**: Map values are not addressable. **Compile error**.

**Fix** (extract):
```go
v := m["a"]
v = 99
m["a"] = v
```

**Key lesson**: Map values are not addressable. Use copy-modify-restore.
</details>

---

## Bug 6 🟡 — Method on Map Value

```go
type C struct{ N int }
func (c *C) Inc() { c.N++ }

m := map[string]C{"a": {N: 1}}
m["a"].Inc() // ?
```

<details>
<summary>Solution</summary>

**Bug**: `m["a"]` is not addressable; can't call pointer-receiver method. Compile error.

**Fix** — store pointers:
```go
m := map[string]*C{"a": {N: 1}}
m["a"].Inc()
```

**Key lesson**: For mutable struct values in maps, store pointers.
</details>

---

## Bug 7 🟡 — Loop Variable Pointer (Pre 1.22)

```go
var ptrs []*int
for _, x := range []int{1, 2, 3} {
    ptrs = append(ptrs, &x)
}
for _, p := range ptrs {
    fmt.Println(*p)
}
```

(Go 1.21 module.) What prints?

<details>
<summary>Solution</summary>

**Pre Go 1.22**: All `&x` are the same pointer (same variable). After loop, x = 3. Prints:
```
3
3
3
```

**Go 1.22+**: Each iteration's x is fresh. Prints `1 2 3`.

**Fix for pre-1.22**:
```go
for _, x := range items {
    x := x
    ptrs = append(ptrs, &x)
}
```

**Key lesson**: Loop variable capture; pre-1.22 needs shadow.
</details>

---

## Bug 8 🔴 — Aliasing Race

```go
shared := &Counter{}
go func() { shared.N++ }()
go func() { shared.N++ }()
```

<details>
<summary>Solution</summary>

**Bug**: Two goroutines mutate `shared.N` without synchronization. Race.

**Fix**: mutex or atomic:
```go
var mu sync.Mutex
go func() {
    mu.Lock(); defer mu.Unlock()
    shared.N++
}()
```

Or:
```go
import "sync/atomic"
go func() { atomic.AddInt64(&shared.N, 1) }()
```

**Key lesson**: Shared pointers across goroutines need synchronization.
</details>

---

## Bug 9 🔴 — Returning Pointer to Loop-Local

```go
func makeAll() []*int {
    var ptrs []*int
    for i := 0; i < 3; i++ {
        ptrs = append(ptrs, &i)
    }
    return ptrs
}
```

(Go 1.21.) What does each pointer point to?

<details>
<summary>Solution</summary>

**Pre 1.22**: All point to the same `i`. After loop, i = 3. All return 3.

**Go 1.22+**: Each iteration's `i` is distinct. Pointers point to 0, 1, 2.

**Fix for pre-1.22**:
```go
for i := 0; i < 3; i++ {
    i := i
    ptrs = append(ptrs, &i)
}
```

**Key lesson**: Test with both Go versions if your module supports a range.
</details>

---

## Bug 10 🔴 — Pointer Receiver, Value Used

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

func main() {
    t := T{n: 1}
    t.Inc()
    fmt.Println(t.n)
}
```

Does this work?

<details>
<summary>Solution</summary>

**Discussion**: Yes. `t.Inc()` is auto-converted to `(&t).Inc()` because `t` is addressable (a local variable). Prints `2`.

**It would FAIL** if `t` were not addressable, e.g., `T{n: 1}.Inc()` (compile error).

**Key lesson**: Pointer-receiver methods can be called on addressable values; Go inserts `&`.
</details>
