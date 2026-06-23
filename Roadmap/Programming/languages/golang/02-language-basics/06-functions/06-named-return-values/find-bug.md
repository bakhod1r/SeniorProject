# Go Named Return Values — Find the Bug

## Instructions

Each exercise contains buggy Go code involving named return values. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Naked Return Without Named Results

```go
package main

import "fmt"

func half(n int) int {
    result := n / 2
    return // BUG
}

func main() {
    fmt.Println(half(10))
}
```

<details>
<summary>Solution</summary>

**Bug**: Naked `return` requires named results. **Compile error**: `not enough arguments to return`.

**Fix** (option A — name the result):
```go
func half(n int) (result int) {
    result = n / 2
    return
}
```

**Fix** (option B — explicit return):
```go
func half(n int) int {
    return n / 2
}
```

**Key lesson**: Naked return is allowed only with named results.
</details>

---

## Bug 2 🟢 — Shadowing Named Result

```go
package main

import "fmt"

func compute(input int) (n int) {
    n := input * 2 // BUG
    return
}

func main() {
    fmt.Println(compute(5))
}
```

<details>
<summary>Solution</summary>

**Bug**: `n := input * 2` declares a NEW local `n`, shadowing the named result. The named result is never assigned. **Compile error** typically catches this: `n declared but not used`. If the compile error is suppressed somehow (or if the inner code uses the local), the named result returns 0.

**Fix** — use `=` (assignment), not `:=` (declaration):
```go
func compute(input int) (n int) {
    n = input * 2 // assignment to named result
    return
}
```

Output: `10`.

**Key lesson**: Use `=` to assign to named results, not `:=`. The latter shadows.
</details>

---

## Bug 3 🟢 — Forgotten Assignment

```go
package main

import "fmt"

func minMax(xs []int) (min, max int) {
    if len(xs) == 0 {
        return
    }
    for _, x := range xs {
        if x < min { min = x }
        if x > max { max = x }
    }
    return
}

func main() {
    fmt.Println(minMax([]int{3, 7, 1, 5}))
}
```

What's the bug?

<details>
<summary>Hint</summary>
What are `min` and `max` initialized to?
</details>

<details>
<summary>Solution</summary>

**Bug**: `min` and `max` are initialized to 0 (zero value of int). On the first iteration, the comparisons `x < 0` and `x > 0` may not behave as expected for non-positive inputs.

For `[3, 7, 1, 5]`:
- Initial: min=0, max=0
- x=3: 3<0 false, 3>0 true → max=3
- x=7: 7<0 false, 7>0 true → max=7
- x=1: 1<0 false, 1>0 false → no change
- x=5: 5<0 false, 5>0 false → no change
- Returns (0, 7)

For all-positive input, `min` is wrongly 0.

**Fix** — initialize min and max to the first element:
```go
func minMax(xs []int) (min, max int) {
    if len(xs) == 0 { return }
    min = xs[0]
    max = xs[0]
    for _, x := range xs[1:] {
        if x < min { min = x }
        if x > max { max = x }
    }
    return
}
```

Now returns (1, 7) for the example.

**Key lesson**: Named results are zero-initialized; that may not be a sensible starting state for your algorithm.
</details>

---

## Bug 4 🟢 — Defer Eager Argument Evaluation

```go
package main

import "fmt"

func work() (n int) {
    n = 1
    defer fmt.Println("n at defer:", n) // BUG?
    n = 99
    return
}

func main() {
    work()
}
```

What's printed? Did the author intend this?

<details>
<summary>Solution</summary>

**Discussion**: `defer fmt.Println(...)` evaluates arguments EAGERLY, at defer time. `n` is captured as 1.

Output:
```
n at defer: 1
```

If the author wanted to see the FINAL value (99), they need a closure:
```go
defer func() {
    fmt.Println("n at defer:", n)
}()
```

Output now:
```
n at defer: 99
```

**Key lesson**: `defer call(args)` evaluates args eagerly. Use `defer func(){...}()` for late evaluation.
</details>

---

## Bug 5 🟡 — Mixed Named and Unnamed

```go
package main

func f() (n int, string) {
    return 0, ""
}
```

<details>
<summary>Solution</summary>

**Bug**: You cannot mix named and unnamed in the same result list. **Compile error**: `mixed named and unnamed parameters`.

**Fix** (all named):
```go
func f() (n int, s string) {
    return 0, ""
}
```

**Fix** (all unnamed):
```go
func f() (int, string) {
    return 0, ""
}
```

**Key lesson**: Pick one style for the result list — all named or all unnamed.
</details>

---

## Bug 6 🟡 — Defer Reads Stale Value

```go
package main

import (
    "errors"
    "fmt"
)

func op() (err error) {
    defer fmt.Println("err was:", err) // BUG
    err = errors.New("failed")
    return
}

func main() {
    op()
}
```

What's printed?

<details>
<summary>Solution</summary>

**Bug**: `defer fmt.Println(...)` evaluates args eagerly. `err` is captured as `nil` (zero value).

Output:
```
err was: <nil>
```

**Fix** — closure:
```go
defer func() {
    fmt.Println("err was:", err)
}()
```

Output now:
```
err was: failed
```

**Key lesson**: Use a closure to defer evaluation along with the call.
</details>

---

## Bug 7 🟡 — `:=` in defer Closure Shadows

```go
package main

import (
    "errors"
    "fmt"
)

func op() (err error) {
    defer func() {
        if err != nil {
            err := fmt.Errorf("wrapped: %w", err) // BUG
            _ = err
        }
    }()
    return errors.New("inner")
}

func main() {
    fmt.Println(op())
}
```

<details>
<summary>Solution</summary>

**Bug**: Inside the deferred closure, `err :=` declares a NEW local `err`, shadowing the named result. The wrapping happens but never updates the function's named `err`.

Output:
```
inner
```

**Fix** — use `=` (assignment):
```go
defer func() {
    if err != nil {
        err = fmt.Errorf("wrapped: %w", err)
    }
}()
```

Output now:
```
wrapped: inner
```

**Key lesson**: Inside defer closures, use `=` to modify the captured named result, not `:=`.
</details>

---

## Bug 8 🟡 — Recover Without Setting Error

```go
package main

import "fmt"

func safe() (err error) {
    defer func() {
        recover() // BUG: discards the recovered value
    }()
    panic("boom")
    return nil
}

func main() {
    err := safe()
    fmt.Println(err)
}
```

<details>
<summary>Solution</summary>

**Bug**: `recover()` is called but its return value is discarded. The panic IS absorbed (recover was called inside a deferred function), but `err` is never set. The caller gets `nil` even though there was a panic.

Output:
```
<nil>
```

**Fix** — capture and set err:
```go
defer func() {
    if r := recover(); r != nil {
        err = fmt.Errorf("recovered: %v", r)
    }
}()
```

Output now:
```
recovered: boom
```

**Key lesson**: When using recover for panic-to-error, always check the return value and assign to the named error.
</details>

---

## Bug 9 🟡 — Rollback Logic Backwards

```go
package main

import (
    "errors"
    "fmt"
)

type Tx struct{}
func (t *Tx) Commit() error   { fmt.Println("commit"); return nil }
func (t *Tx) Rollback() error { fmt.Println("rollback"); return nil }

func transfer(amount int) (err error) {
    tx := &Tx{}
    defer func() {
        if err == nil {
            tx.Rollback() // BUG
        } else {
            tx.Commit()
        }
    }()
    if amount <= 0 {
        err = errors.New("bad amount")
        return
    }
    return
}

func main() {
    fmt.Println(transfer(100))
}
```

<details>
<summary>Solution</summary>

**Bug**: The rollback/commit logic is inverted. On success (`err == nil`) we should commit; on failure rollback.

For amount=100: success path; current code calls Rollback. WRONG.

**Fix**:
```go
defer func() {
    if err != nil {
        tx.Rollback()
    } else {
        if cerr := tx.Commit(); cerr != nil {
            err = cerr
        }
    }
}()
```

Now success commits, failure rolls back. Also captures commit errors if commit itself fails.

**Key lesson**: Auto-rollback patterns require careful logic. Test both success and failure paths.
</details>

---

## Bug 10 🔴 — Closure Captures Named Return Concurrently

```go
package main

import (
    "fmt"
    "sync"
)

func work() (n int) {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            n++ // BUG
        }()
    }
    wg.Wait()
    return
}

func main() {
    fmt.Println(work())
}
```

What's the bug?

<details>
<summary>Solution</summary>

**Bug**: 5 goroutines concurrently increment `n` (the named result) without synchronization. Data race; final value may not be 5.

`go run -race main.go` flags it.

**Fix** — synchronize:
```go
func work() (n int) {
    var mu sync.Mutex
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            n++
            mu.Unlock()
        }()
    }
    wg.Wait()
    return
}
```

Or use atomic:
```go
import "sync/atomic"

func work() (n int) {
    var atomicN int64
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&atomicN, 1)
        }()
    }
    wg.Wait()
    n = int(atomicN)
    return
}
```

**Key lesson**: Named results are regular variables. Concurrent mutation requires synchronization.
</details>

---

## Bug 11 🔴 — Returning Typed Nil Through Named Error

```go
package main

import "fmt"

type MyErr struct{}
func (e *MyErr) Error() string { return "my error" }

func op() (err error) {
    var p *MyErr // nil
    err = p
    return
}

func main() {
    err := op()
    fmt.Println("err is nil?", err == nil)
}
```

<details>
<summary>Solution</summary>

**Bug**: `err = p` assigns a typed nil pointer to the `error` interface. The interface holds a non-nil type word + nil data — `err == nil` returns false.

Output:
```
err is nil? false
```

**Fix** — explicitly assign nil:
```go
func op() (err error) {
    if shouldError() {
        err = &MyErr{}
    } else {
        err = nil
    }
    return
}
```

Or just don't assign on the no-error path:
```go
func op() (err error) {
    if shouldError() {
        err = &MyErr{}
    }
    return // err is zero-value nil if not assigned
}
```

**Key lesson**: Typed nil pointers wrapped in an interface produce non-nil interfaces. For named errors, prefer literal `nil` or just don't assign on success paths.
</details>

---

## Bug 12 🔴 — Deferred Modification Order

```go
package main

import "fmt"

func compute() (n int) {
    defer func() { n *= 2 }()
    defer func() { n += 1 }()
    n = 5
    return
}

func main() {
    fmt.Println(compute())
}
```

What's the output? Why?

<details>
<summary>Solution</summary>

**Output**: `12`.

**Why**:
1. `n = 5` (body sets n).
2. `return` → no expression, so n stays 5.
3. Defers run in LIFO order.
4. defer registered LAST runs FIRST: `n += 1` → n = 6.
5. defer registered FIRST runs LAST: `n *= 2` → n = 12.
6. Function returns 12.

If you want `(5 * 2) + 1 = 11`, swap the registration order.

**Key lesson**: Defers run LIFO. Order registration carefully when modifications are sequence-dependent.
</details>

---

## Bug 13 🔴 — Mixing Defer + Goroutine Modifying Named Result

```go
package main

import (
    "fmt"
    "time"
)

func work() (n int) {
    defer func() { n = 99 }()
    go func() {
        time.Sleep(50 * time.Millisecond)
        n = 50 // BUG: races with defer
    }()
    return 1
}

func main() {
    n := work()
    fmt.Println(n)
    time.Sleep(100 * time.Millisecond) // wait for goroutine
}
```

What's the bug?

<details>
<summary>Solution</summary>

**Bug**: The function returns before the goroutine modifies `n`. By the time `fmt.Println(n)` runs in main, the deferred `n = 99` has already run and the function returned 99.

But the spawned goroutine also writes to `n` (the named result variable, which has escaped to the heap because the goroutine captures it). After the function returns, the goroutine writes 50 to `n`. But the caller already received 99.

The race is: the goroutine writes to `n` (now a heap variable) AFTER the function returns. Nothing reads `n` from main, but if the caller had a pointer to it... actually, the caller received a copy of the value 99.

The real problem: **the goroutine modifies a variable that should have been local to the function call**. The function exited, the named result was captured into the return value, and the goroutine's later write is meaningless (no one reads the heap n anymore).

But there's a race detector flag: the goroutine writes to `n` while main reads it via the return value. Wait, the return value IS a copy.

Actually, the race might be on the heap-promoted `n` between main's deferred `n = 99` and the goroutine's `n = 50`. If they happen to overlap, race.

**Fix** — don't spawn goroutines that modify named results without synchronization with the function's return.

**Key lesson**: A named result captured by a goroutine that outlives the function is a recipe for races and confusion. Avoid this pattern.
</details>

---

## Bonus Bug 🔴 — Defer Closure Captures Wrong Named Result

```go
package main

import "fmt"

func compute() (a int, b int) {
    defer func() {
        a = a * b // BUG?
    }()
    a = 3
    b = 4
    return
}

func main() {
    fmt.Println(compute())
}
```

<details>
<summary>Solution</summary>

**Discussion**: This works as intended:
1. `a = 3, b = 4` (set named results).
2. `return` (no expressions, named results stay as 3, 4).
3. defer: `a = a * b` → `a = 3 * 4 = 12`.
4. Returns (12, 4).

Output:
```
12 4
```

If the author expected (3, 4), the bug is the defer doing unintended modification.

If the author wanted `b = a * b` (modifying `b` instead of `a`), they have an off-by-one in the defer's intent.

**Lesson**: Named results in defer modifications are easy to mistake. Be explicit; comment your intent.

**Key lesson**: Multi-result + defer modification can be subtle. Test the actual return values match expectations.
</details>
