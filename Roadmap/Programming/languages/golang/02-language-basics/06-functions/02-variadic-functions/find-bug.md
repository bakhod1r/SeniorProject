# Go Variadic Functions — Find the Bug

## Instructions

Each exercise contains buggy Go code involving variadic functions. Identify the bug, explain why it occurs, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Variadic Not Last

```go
package main

import "fmt"

func event(tags ...string, name string) {
    fmt.Println(name, tags)
}

func main() {
    event("auth", "user", "login")
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Where is the variadic parameter allowed in the parameter list?
</details>

<details>
<summary>Solution</summary>

**Bug**: The variadic parameter `...string` must be the **last** parameter. **Compile error**: `can only use ... with final parameter in list`.

**Fix** — put the required parameter first:
```go
func event(name string, tags ...string) {
    fmt.Println(name, tags)
}

func main() {
    event("login", "auth", "user")
}
```

**Key lesson**: Only the last parameter may be variadic. Required parameters go first.
</details>

---

## Bug 2 🟢 — Forwarding Without Spread

```go
package main

import "fmt"

func inner(args ...any) {
    fmt.Println("inner got", len(args), "args:", args)
}

func outer(args ...any) {
    inner(args)
}

func main() {
    outer("a", "b", "c")
}
```

The author expected "inner got 3 args: [a b c]". What does it actually print?

<details>
<summary>Hint</summary>
What is the difference between `inner(args)` and `inner(args...)`?
</details>

<details>
<summary>Solution</summary>

**Bug**: `inner(args)` passes the slice `args` as a SINGLE argument (an `any` whose value is `[]any{a, b, c}`). `inner` receives 1 arg, not 3.

Output:
```
inner got 1 args: [[a b c]]
```

**Fix** — use spread:
```go
func outer(args ...any) {
    inner(args...) // spread each element as a separate arg
}
```

Now output:
```
inner got 3 args: [a b c]
```

**Key lesson**: When forwarding a variadic, you MUST spread with `args...`. Forgetting the `...` wraps the slice as a single arg. This is the most common variadic bug.
</details>

---

## Bug 3 🟢 — Spread of `[]int` Into `...any`

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3}
    fmt.Println(nums...)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
`fmt.Println` is `func(args ...any)`. Can you spread `[]int` into `...any`?
</details>

<details>
<summary>Solution</summary>

**Bug**: `fmt.Println` takes `...any` (== `...interface{}`). Spreading requires the slice element type to match exactly. `[]int` is NOT assignable to `[]any` — Go does not perform per-element conversion.

**Compile error**: `cannot use nums (variable of type []int) as []any value in argument to fmt.Println`.

**Fix** — convert each element manually:
```go
nums := []int{1, 2, 3}
args := make([]any, len(nums))
for i, n := range nums {
    args[i] = n
}
fmt.Println(args...)
```

Or just call without spread:
```go
fmt.Println(nums) // prints "[1 2 3]"
```

**Key lesson**: Spread requires exact slice type match. To spread typed slices into `...any`, convert each element first.
</details>

---

## Bug 4 🟢 — Mixing Literal Args With Spread

```go
package main

import "fmt"

func sum(xs ...int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    extras := []int{2, 3, 4}
    fmt.Println(sum(1, extras...))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Can a single call mix individual arguments with spread?
</details>

<details>
<summary>Solution</summary>

**Bug**: Go does not allow mixing literal arguments with the spread operator at the same call site. **Compile error**: `cannot mix...` (or similar — phrasing varies by Go version).

**Fix** — build a combined slice first:
```go
combined := append([]int{1}, extras...)
fmt.Println(sum(combined...))
```

Or just expand the call to all literals:
```go
fmt.Println(sum(1, 2, 3, 4))
```

**Key lesson**: Each call uses ONE form: all literal, or one spread. Combine slices yourself before the call.
</details>

---

## Bug 5 🟡 — Aliasing Mutation Bug

```go
package main

import "fmt"

func zero(xs ...int) {
    for i := range xs {
        xs[i] = 0
    }
}

func main() {
    s := []int{1, 2, 3}
    zero(s...)
    fmt.Println(s)
}
```

The author expected `[1 2 3]`. What actually prints?

<details>
<summary>Hint</summary>
Does spread copy the slice or share the backing array?
</details>

<details>
<summary>Solution</summary>

**Bug**: Spread (`s...`) shares the same backing array. `zero` mutates the caller's slice through aliasing. Output:
```
[0 0 0]
```

**Fix** (option A — defensive copy inside `zero`):
```go
func zero(xs ...int) {
    xs = append([]int(nil), xs...) // local copy
    for i := range xs {
        xs[i] = 0
    }
}
```

**Fix** (option B — caller copies):
```go
defensive := append([]int(nil), s...)
zero(defensive...)
```

**Fix** (option C — return a result instead of mutating):
```go
func zeroed(xs ...int) []int {
    out := make([]int, len(xs))
    return out // all zeros by default
}
```

**Key lesson**: Spread aliases the caller's backing array. If your function mutates, document it or defensively copy.
</details>

---

## Bug 6 🟡 — Variadic Call With nil Slice

```go
package main

import "fmt"

func sum(xs ...int) int {
    if xs == nil {
        return -1 // sentinel for "no input"
    }
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    fmt.Println(sum())                        // expects -1
    fmt.Println(sum([]int{}...))             // expects 0?
    fmt.Println(sum([]int{1, 2, 3}...))      // expects 6
}
```

The author expected `-1`, `0`, `6`. What actually prints?

<details>
<summary>Hint</summary>
What is the parameter when called with `[]int{}...` vs `sum()`?
</details>

<details>
<summary>Solution</summary>

**Bug**: There's a subtle distinction:
- `sum()` → `xs` is **nil** → returns -1.
- `sum([]int{}...)` → `xs` is a non-nil empty slice → does NOT match `xs == nil`, returns 0.
- `sum([]int{1, 2, 3}...)` → returns 6.

Output:
```
-1
0
6
```

This may match expectations, but the bug is in the **design**: `xs == nil` is not a reliable "no args" indicator because callers can spread an explicitly-empty slice.

**Fix** — use `len(xs) == 0` for the "no input" case:
```go
func sum(xs ...int) int {
    if len(xs) == 0 {
        return -1
    }
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}
```

Now both `sum()` and `sum([]int{}...)` correctly return -1.

**Key lesson**: Always check `len(xs) == 0`, not `xs == nil`. Both nil and empty-non-nil slices have length 0; users may pass either.
</details>

---

## Bug 7 🟡 — Storing the Variadic Without Copying

```go
package main

import "fmt"

type Buffer struct {
    items []int
}

func (b *Buffer) Append(items ...int) {
    b.items = items // BUG
}

func main() {
    src := []int{1, 2, 3}
    b := &Buffer{}
    b.Append(src...)
    src[0] = 99
    fmt.Println(b.items)
}
```

The author expected `[1 2 3]` to be stored. What actually prints?

<details>
<summary>Hint</summary>
What does `b.items = items` actually assign?
</details>

<details>
<summary>Solution</summary>

**Bug**: `b.items = items` stores a slice that aliases the caller's backing array. After the caller mutates `src[0]`, the buffer reflects it. Output:
```
[99 2 3]
```

**Fix** — defensive copy:
```go
func (b *Buffer) Append(items ...int) {
    b.items = append([]int(nil), items...)
}
```

Or, if you want to APPEND (not replace) like the method name suggests:
```go
func (b *Buffer) Append(items ...int) {
    b.items = append(b.items, items...)
}
```

`append` here automatically grows `b.items` and copies the elements, so no aliasing of the input slice remains.

**Key lesson**: When a variadic function stores the slice past the call, defensively copy. The aliasing window is invisible from the function signature.
</details>

---

## Bug 8 🟡 — `printAll` Calling Itself With Spread

```go
package main

import "fmt"

func printAll(args ...any) {
    if len(args) == 0 {
        fmt.Println("(empty)")
        return
    }
    fmt.Println(args[0])
    printAll(args[1:]) // BUG
}

func main() {
    printAll("a", "b", "c")
}
```

The author expected each element printed on its own line. What actually happens?

<details>
<summary>Hint</summary>
What does `printAll(args[1:])` pass — a single arg or multiple?
</details>

<details>
<summary>Solution</summary>

**Bug**: `args[1:]` is a slice. Passing it as a single argument means `printAll`'s next call sees `args == [[b c]]` (one arg, which is the slice). The recursive call enters with `len(args) == 1`, prints the slice, then recurses with `args[1:]` (empty), and prints `(empty)`.

Output:
```
a
[b c]
(empty)
```

**Fix** — spread with `...`:
```go
printAll(args[1:]...)
```

Now:
```
a
b
c
(empty)
```

**Key lesson**: Spread is required when forwarding a slice into a variadic — even when recursing into the same function.
</details>

---

## Bug 9 🟡 — Reslicing Inside Variadic

```go
package main

import "fmt"

func keepFirst(n int, xs ...int) []int {
    return xs[:n]
}

func main() {
    s := []int{1, 2, 3, 4, 5}
    kept := keepFirst(2, s...)
    s[0] = 99
    fmt.Println(kept)
}
```

The author expected `[1 2]`. What actually prints?

<details>
<summary>Hint</summary>
What does `xs[:n]` share with `s`?
</details>

<details>
<summary>Solution</summary>

**Bug**: `xs[:n]` is a view of the same backing array as `xs`, which is the same as `s`. After `s[0] = 99`, `kept[0]` reflects the change. Output:
```
[99 2]
```

**Fix** — copy the result:
```go
func keepFirst(n int, xs ...int) []int {
    return append([]int(nil), xs[:n]...)
}
```

**Key lesson**: A subslice of a spread variadic is still aliased to the caller's backing array. Always copy when returning a slice that should be independent.
</details>

---

## Bug 10 🔴 — Variadic of `error` and Nil Filtering

```go
package main

import (
    "errors"
    "fmt"
)

func combine(errs ...error) error {
    if len(errs) == 0 {
        return nil
    }
    msgs := ""
    for i, e := range errs {
        if i > 0 {
            msgs += "; "
        }
        msgs += e.Error() // BUG
    }
    return errors.New(msgs)
}

func main() {
    err := combine(nil, errors.New("a"), nil, errors.New("b"))
    fmt.Println(err)
}
```

What is the bug?

<details>
<summary>Hint</summary>
What happens when you call `e.Error()` on a nil error?
</details>

<details>
<summary>Solution</summary>

**Bug**: When `e` is nil (a nil `error` interface), `e.Error()` panics with `nil pointer dereference`. The author forgot to skip nil errors.

**Fix** — filter nil errors first:
```go
func combine(errs ...error) error {
    var nonNil []string
    for _, e := range errs {
        if e != nil {
            nonNil = append(nonNil, e.Error())
        }
    }
    if len(nonNil) == 0 {
        return nil
    }
    return errors.New(strings.Join(nonNil, "; "))
}
```

Or use `errors.Join` (Go 1.20+):
```go
func combine(errs ...error) error {
    return errors.Join(errs...) // automatically filters nil
}
```

**Key lesson**: Variadics of interface types may contain nil values. Always check before dereferencing or method-calling.
</details>

---

## Bug 11 🔴 — Variadic Slice Reused in Goroutine

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Producer struct {
    buf []int
    mu  sync.Mutex
}

func (p *Producer) push(items ...int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    p.buf = append(p.buf, items...)
}

func main() {
    p := &Producer{}

    src := []int{1, 2, 3}
    go p.push(src...)

    src[0] = 99 // mutate while goroutine may be reading

    time.Sleep(50 * time.Millisecond)
    fmt.Println(p.buf)
}
```

This produces a race condition. Where, and how do you fix?

<details>
<summary>Hint</summary>
Spread aliases the caller's backing array. The goroutine reads `items`; the caller mutates `src` concurrently.
</details>

<details>
<summary>Solution</summary>

**Bug**: `go p.push(src...)` passes the spread slice (aliasing `src`) to a goroutine. The main goroutine then mutates `src[0]`. Both goroutines access `src[0]` concurrently — **data race**.

`go test -race` would detect: "WARNING: DATA RACE".

The output may be `[1 2 3]` or `[99 2 3]` non-deterministically.

**Fix** (option A — defensive copy at the boundary):
```go
go func(items []int) {
    snap := append([]int(nil), items...)
    p.push(snap...)
}(src)
```

**Fix** (option B — copy in `push`):
```go
func (p *Producer) push(items ...int) {
    snap := append([]int(nil), items...)
    p.mu.Lock()
    defer p.mu.Unlock()
    p.buf = append(p.buf, snap...)
}
```

**Fix** (option C — caller copies before goroutine):
```go
snap := append([]int(nil), src...)
go p.push(snap...)
```

**Key lesson**: When a variadic spread crosses a goroutine boundary, the alias becomes a race risk. Defensively copy at the boundary or document the contract clearly.
</details>

---

## Bug 12 🔴 — Generic Variadic Type Inference Failure

```go
package main

import "fmt"

func First[T any](xs ...T) T {
    var zero T
    if len(xs) == 0 {
        return zero
    }
    return xs[0]
}

func main() {
    fmt.Println(First())              // BUG
    fmt.Println(First(1, 2, 3))
    fmt.Println(First("a", "b"))
}
```

What is the bug at the first call?

<details>
<summary>Hint</summary>
Can the compiler infer `T` from no arguments?
</details>

<details>
<summary>Solution</summary>

**Bug**: With zero arguments, the compiler cannot infer `T`. **Compile error**: `cannot infer T`.

**Fix** — provide the type parameter explicitly:
```go
fmt.Println(First[int]())
fmt.Println(First[string]())
```

For other calls, type inference works because the first argument's type determines `T`.

**Key lesson**: Generic variadics fail type inference at empty-args calls. Either require explicit type args or design the function to take at least one positional arg.
</details>

---

## Bonus Bug 🔴 — Empty Spread Doesn't Match What You Expect

```go
package main

import "fmt"

func sum(xs ...int) int {
    fmt.Printf("xs is nil? %v, len=%d\n", xs == nil, len(xs))
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    var nilSlice []int
    empty := []int{}

    fmt.Println(sum())             // prints "xs is nil? true, len=0"  → 0
    fmt.Println(sum(nilSlice...))  // prints ?
    fmt.Println(sum(empty...))     // prints ?
}
```

What does each call print for the nil/len status?

<details>
<summary>Hint</summary>
Does spread of nil produce a nil-parameter or an empty-non-nil parameter? What about spread of an empty-non-nil slice?
</details>

<details>
<summary>Solution</summary>

**Output**:
```
xs is nil? true, len=0
0
xs is nil? true, len=0
0
xs is nil? false, len=0
0
```

Explanation:
- `sum()` — implicit slice is nil.
- `sum(nilSlice...)` — passes nilSlice as the parameter; xs == nilSlice == nil.
- `sum(empty...)` — passes empty (non-nil); xs is empty-non-nil.

The total is 0 in all cases because `range nil` is a no-op (same as range over empty).

**Lesson**: There's a subtle three-way distinction:
1. `sum()` → param is nil.
2. `sum(nilSlice...)` → param is nil (whatever slice was).
3. `sum(empty...)` → param is empty-non-nil.

For most functions this difference doesn't matter (`len(xs) == 0` covers all). But code that distinguishes nil vs empty (e.g., for serialization) must be aware.

**Key lesson**: Variadic parameters can be nil OR empty-non-nil depending on caller. Use `len(xs) == 0`, not `xs == nil`, for "no values" checks.
</details>
