# Go Pointers with Structs — Find the Bug

## Instructions

Identify the bug, explain, fix. Difficulty: 🟢 🟡 🔴.

---

## Bug 1 🟢 — Mixing Receivers Breaks Interface

```go
type Animal struct{ Name string }
func (a Animal) Name1() string  { return a.Name }
func (a *Animal) Bark()         { fmt.Println(a.Name) }

type Speaker interface { Name1() string; Bark() }

var s Speaker = Animal{Name: "Rex"}
```

<details>
<summary>Solution</summary>

**Bug**: `Animal{}` doesn't satisfy `Speaker` because `Bark` has pointer receiver. Compile error.

**Fix**: `var s Speaker = &Animal{Name: "Rex"}` — `*Animal` has both methods.

**Lesson**: Pick consistent receiver types. Mixed receivers limit interface satisfaction.
</details>

---

## Bug 2 🟢 — Nil Struct Field Access

```go
var p *Point
fmt.Println(p.X)
```

<details>
<summary>Solution</summary>

**Bug**: Nil pointer dereference panic. Auto-dereferencing nil panics.

**Fix**:
```go
if p != nil { fmt.Println(p.X) }
```
</details>

---

## Bug 3 🟢 — Map Value Mutation

```go
type Counter struct{ N int }
m := map[string]Counter{"a": {N: 1}}
m["a"].N++
```

<details>
<summary>Solution</summary>

**Bug**: Map values are not addressable; can't mutate fields directly. Compile error.

**Fix** (extract):
```go
c := m["a"]; c.N++; m["a"] = c
```

Or store pointers:
```go
m := map[string]*Counter{"a": {N: 1}}
m["a"].N++
```
</details>

---

## Bug 4 🟡 — Returning Slice of Pointers from Loop

```go
type Item struct{ V int }
func make() []*Item {
    items := []Item{{1}, {2}, {3}}
    var ptrs []*Item
    for _, it := range items {
        ptrs = append(ptrs, &it) // pre-1.22 bug
    }
    return ptrs
}
```

(Pre Go 1.22.) What does each pointer point to?

<details>
<summary>Solution</summary>

**Pre-1.22**: All pointers point to the same `it` (last value: `{V: 3}`).

**Fix** for pre-1.22:
```go
for i := range items {
    ptrs = append(ptrs, &items[i]) // index — different memory
}
```

Or shadow with `it := it` (creates per-iter copy).

**Lesson**: Pre-1.22 loop variable capture pitfall. Use index for slice element pointers.
</details>

---

## Bug 5 🟡 — Pointer Receiver Required on Non-Addressable Value

```go
type T struct{ N int }
func (t *T) Inc() { t.N++ }

func main() {
    T{N: 1}.Inc() // ?
}
```

<details>
<summary>Solution</summary>

**Bug**: `T{N: 1}` is a composite literal, not addressable. Can't call pointer-receiver method. Compile error.

**Fix** — assign to a variable first:
```go
t := T{N: 1}
t.Inc() // OK; Go takes &t
```

Or allocate with pointer:
```go
(&T{N: 1}).Inc() // OK
```
</details>

---

## Bug 6 🟡 — Constructor Returns Pointer to Local That's Reused

```go
type Builder struct{ Items []int }
var b Builder

func New() *Builder {
    b = Builder{Items: []int{}} // reuses package var
    return &b
}
```

<details>
<summary>Solution</summary>

**Bug**: All callers get a pointer to the SAME `b`. Each `New()` overwrites the previous; old "instances" become garbage.

**Fix** — fresh allocation each call:
```go
func New() *Builder {
    return &Builder{Items: []int{}}
}
```

**Lesson**: Constructors should allocate fresh per call.
</details>

---

## Bug 7 🟡 — Storing Pointer to Local

```go
type Service struct{ Logger *Logger }

func setup() *Service {
    l := Logger{Prefix: "SVC"}
    return &Service{Logger: &l}
}
```

Is this safe?

<details>
<summary>Solution</summary>

**Discussion**: Yes — Go's escape analysis moves `l` to the heap because `&l` escapes. Safe.

The compiler verifies; this is idiomatic Go. Verify with `go build -gcflags="-m"`.

**Lesson**: Returning pointers to locals is safe in Go (unlike C); escape analysis handles allocation.
</details>

---

## Bug 8 🔴 — Concurrent Mutation of Pointer Field

```go
type Cache struct{ data *Data }

func update(c *Cache, d *Data) { c.data = d }

c := &Cache{}
go update(c, &Data{V: 1})
go update(c, &Data{V: 2})
fmt.Println(c.data)
```

<details>
<summary>Solution</summary>

**Bug**: Two goroutines write to `c.data` concurrently. Race. Reader may see torn value.

**Fix** — atomic.Pointer:
```go
import "sync/atomic"

type Cache struct{ data atomic.Pointer[Data] }

func update(c *Cache, d *Data) { c.data.Store(d) }
```

Or mutex.

**Lesson**: Concurrent pointer-field updates need atomic or mutex.
</details>

---

## Bug 9 🔴 — Embedded Pointer Method Conflict

```go
type A struct{}
func (a *A) M() string { return "A" }

type B struct{}
func (b *B) M() string { return "B" }

type C struct {
    *A
    *B
}

c := &C{A: &A{}, B: &B{}}
c.M() // ?
```

<details>
<summary>Solution</summary>

**Bug**: Both A and B have method M; ambiguous. Compile error: `ambiguous selector c.M`.

**Fix** — be explicit:
```go
c.A.M() // "A"
c.B.M() // "B"
```

Or define `M` on C to disambiguate:
```go
func (c *C) M() string { return c.A.M() + "+" + c.B.M() }
```

**Lesson**: Embedded pointer fields with overlapping methods need explicit selection.
</details>

---

## Bug 10 🔴 — Defensive Copy Missing

```go
type Buffer struct{ data []int }

func New(initial []int) *Buffer {
    return &Buffer{data: initial} // BUG: aliases caller
}

func main() {
    src := []int{1, 2, 3}
    b := New(src)
    src[0] = 99
    fmt.Println(b.data) // expected [1 2 3]
}
```

<details>
<summary>Solution</summary>

**Bug**: `b.data` aliases `src`. Mutating src affects b.

**Fix** — defensive copy:
```go
func New(initial []int) *Buffer {
    return &Buffer{data: append([]int(nil), initial...)}
}
```

**Lesson**: Constructors taking slices/maps should defensively copy if the caller's data shouldn't be aliased.
</details>
