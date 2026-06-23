# Go Multiple Return Values — Find the Bug

## Instructions

Each exercise contains buggy Go code involving multi-result functions. Identify the bug, explain why it occurs, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Discarding Required Result

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    n := strconv.Atoi("42")
    fmt.Println(n)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
How many values does `strconv.Atoi` return?
</details>

<details>
<summary>Solution</summary>

**Bug**: `strconv.Atoi` returns `(int, error)`. Assigning to one variable triggers **compile error**: `multiple-value strconv.Atoi() (value of type (int, error)) in single-value context`.

**Fix**:
```go
n, err := strconv.Atoi("42")
if err != nil {
    fmt.Println("error:", err)
    return
}
fmt.Println(n)
```

Or, if you intentionally want to discard the error (rare and risky):
```go
n, _ := strconv.Atoi("42")
fmt.Println(n)
```

**Key lesson**: You must accept every result of a multi-result call, either by name or with `_`.
</details>

---

## Bug 2 🟢 — Wrong Result Order

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    err, n := strconv.Atoi("42")
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println(n)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What's the declared order of `Atoi`'s results?
</details>

<details>
<summary>Solution</summary>

**Bug**: `Atoi` returns `(int, error)` in that order. The code assigns the int to `err` (a name suggesting error) and the error to `n`. **Compile error**: type mismatch — `int` cannot be assigned to a name expected to be `error` (well, with `:=` Go infers types, so this actually compiles but `err` would be `int` and `n` would be `error`, leading to runtime confusion).

**Fix**:
```go
n, err := strconv.Atoi("42") // declared order
```

**Key lesson**: Match the declared result order exactly. Variable names don't change the order.
</details>

---

## Bug 3 🟢 — Using Value Without Checking Error

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    data, err := os.ReadFile("/nonexistent")
    fmt.Printf("read %d bytes\n", len(data))
    if err != nil {
        return
    }
}
```

The author expected the read-bytes line not to print on error. What happens?

<details>
<summary>Hint</summary>
What is `data` when err is non-nil?
</details>

<details>
<summary>Solution</summary>

**Bug**: `data` is `nil` when err is non-nil. The print line runs unconditionally, printing `read 0 bytes` even on failure. Then the program returns. The user sees a misleading message.

**Fix** — check err first:
```go
data, err := os.ReadFile("/nonexistent")
if err != nil {
    fmt.Println("error:", err)
    return
}
fmt.Printf("read %d bytes\n", len(data))
```

**Key lesson**: ALWAYS check err first. Don't use the value when err is non-nil.
</details>

---

## Bug 4 🟢 — Multi-Result In Single-Value Context

```go
package main

import "fmt"

func divmod(a, b int) (int, int) { return a / b, a % b }

func main() {
    fmt.Println(divmod(17, 5) + 1)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Can multi-result expressions participate in arithmetic?
</details>

<details>
<summary>Solution</summary>

**Bug**: `divmod(17, 5) + 1` uses a multi-result function in a single-value context. **Compile error**: `multiple-value divmod() in single-value context`.

**Fix**:
```go
q, r := divmod(17, 5)
fmt.Println(q + r + 1) // 3 + 2 + 1 = 6
// or just one of them:
q, _ := divmod(17, 5)
fmt.Println(q + 1)
```

**Key lesson**: Multi-result calls cannot be used in expressions. Assign first, then use.
</details>

---

## Bug 5 🟡 — Mixing Multi-Result With Other Args

```go
package main

import "fmt"

func divmod(a, b int) (int, int) { return a / b, a % b }
func sum(a, b, c int) int        { return a + b + c }

func main() {
    fmt.Println(sum(divmod(17, 5), 100))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Can you mix a multi-result call with extra arguments?
</details>

<details>
<summary>Solution</summary>

**Bug**: Forwarding `divmod(17, 5)` into `sum` is allowed only if the param list matches exactly. Adding `100` makes it a mix of multi-result + extra arg — **compile error**.

**Fix**:
```go
q, r := divmod(17, 5)
fmt.Println(sum(q, r, 100))
```

**Key lesson**: Multi-result forwarding `g(f())` requires EXACT signature match. No mixing with extra args.
</details>

---

## Bug 6 🟡 — Typed-Nil Interface

```go
package main

import "fmt"

type MyError struct{ Msg string }

func (e *MyError) Error() string { return e.Msg }

func validate(s string) error {
    var err *MyError
    if s == "" {
        err = &MyError{Msg: "empty"}
    }
    return err
}

func main() {
    err := validate("hello")
    fmt.Println("err is nil?", err == nil)
}
```

The author expected `err == nil` to be true. What happens?

<details>
<summary>Hint</summary>
What does the `error` interface store when you return a typed nil pointer?
</details>

<details>
<summary>Solution</summary>

**Bug**: When `s != ""`, `err` is a nil `*MyError`. Assigning that to an `error` interface produces a non-nil interface (itab is non-nil, data is nil). `err == nil` returns false.

Output:
```
err is nil? false
```

**Fix** — return literal nil:
```go
func validate(s string) error {
    if s == "" {
        return &MyError{Msg: "empty"}
    }
    return nil // literal nil interface
}
```

**Key lesson**: Never return a typed nil where an interface is expected. Always use `return nil` literally.
</details>

---

## Bug 7 🟡 — Wrapping With `%v` Instead of `%w`

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func get(k string) error {
    return fmt.Errorf("key %s: %v", k, ErrNotFound)
}

func main() {
    err := get("x")
    fmt.Println("matches sentinel?", errors.Is(err, ErrNotFound))
}
```

The author expected `errors.Is` to return true. What happens?

<details>
<summary>Hint</summary>
Does `%v` create a wrapped error?
</details>

<details>
<summary>Solution</summary>

**Bug**: `%v` formats the error as a string but does NOT preserve the chain. `errors.Is` finds no link to `ErrNotFound`. Returns false.

**Fix** — use `%w`:
```go
return fmt.Errorf("key %s: %w", k, ErrNotFound)
```

`%w` wraps the error so `errors.Is` and `errors.As` can traverse the chain.

**Key lesson**: Use `%w` (not `%v` or `%s`) when wrapping errors with `fmt.Errorf`. This is the only verb that preserves the chain.
</details>

---

## Bug 8 🟡 — Discarding Critical Errors

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    data, _ := os.ReadFile("/etc/passwd")
    fmt.Println(string(data[:100])) // BUG
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What if the file doesn't exist or is too short?
</details>

<details>
<summary>Solution</summary>

**Bug**: Two issues:
1. `_` discards the error. If the file doesn't exist, `data` is nil.
2. `data[:100]` panics if `len(data) < 100`.

Result: either nil-slice index panic or out-of-bounds panic.

**Fix**:
```go
data, err := os.ReadFile("/etc/passwd")
if err != nil {
    fmt.Println("error:", err)
    return
}
n := len(data)
if n > 100 {
    n = 100
}
fmt.Println(string(data[:n]))
```

**Key lesson**: Discarding errors with `_` is rarely correct. Always validate the value's bounds before slicing.
</details>

---

## Bug 9 🟡 — Returning Partial State With Error

```go
package main

import (
    "errors"
    "fmt"
)

type Counter struct {
    Value int
}

func loadCounter() (*Counter, error) {
    c := &Counter{Value: 1}
    if err := someCheck(); err != nil {
        c.Value = 99
        return c, err // returns partial state
    }
    return c, nil
}

func someCheck() error { return errors.New("invalid") }

func main() {
    c, err := loadCounter()
    if err != nil {
        fmt.Println("error:", err)
    }
    fmt.Println("value:", c.Value) // BUG: uses c even though there was an error
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What should the function return when error is non-nil?
</details>

<details>
<summary>Solution</summary>

**Bug**: The function returns `c` (with Value=99) alongside the error. The caller, despite checking err, then uses `c.Value` — which is in a corrupt state.

Output:
```
error: invalid
value: 99
```

**Fix** — return nil when error is non-nil:
```go
func loadCounter() (*Counter, error) {
    c := &Counter{Value: 1}
    if err := someCheck(); err != nil {
        return nil, err // don't expose partial state
    }
    return c, nil
}
```

Now caller can safely write `if err != nil { return }` without worrying about a stale `c`.

**Key lesson**: When returning an error, return the zero value for the other results. This makes the contract explicit and prevents subtle bugs.
</details>

---

## Bug 10 🔴 — Naked Return Without Named Results

```go
package main

import "fmt"

func splitAt(s string, i int) (string, string) {
    a := s[:i]
    b := s[i:]
    return // BUG
}

func main() {
    fmt.Println(splitAt("hello world", 5))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When can you use a naked `return`?
</details>

<details>
<summary>Solution</summary>

**Bug**: A naked `return` works only when the function has **named** return values. Here, the results are unnamed `(string, string)`. **Compile error**: `not enough arguments to return`.

**Fix** (option A — name the results):
```go
func splitAt(s string, i int) (a, b string) {
    a = s[:i]
    b = s[i:]
    return
}
```

**Fix** (option B — explicit return):
```go
func splitAt(s string, i int) (string, string) {
    a := s[:i]
    b := s[i:]
    return a, b
}
```

**Key lesson**: Naked return requires named results. Without names, you must list every result explicitly.
</details>

---

## Bug 11 🔴 — `errors.Is` Comparing With New Sentinel

```go
package main

import (
    "errors"
    "fmt"
)

func notFoundErr() error {
    return errors.New("not found")
}

func main() {
    err := fmt.Errorf("get key x: %w", notFoundErr())
    sentinel := errors.New("not found")
    fmt.Println(errors.Is(err, sentinel))
}
```

The author expected `true`. What happens?

<details>
<summary>Hint</summary>
What does `errors.New` return each time it's called?
</details>

<details>
<summary>Solution</summary>

**Bug**: `errors.New("not found")` allocates a NEW `*errorString` each call. Each call returns a different pointer. `errors.Is` checks pointer equality (for non-comparable types) — they don't match.

Output:
```
false
```

**Fix** — define sentinel ONCE at package level:
```go
var ErrNotFound = errors.New("not found") // package-level, allocated once

func notFoundErr() error {
    return ErrNotFound
}

func main() {
    err := fmt.Errorf("get key x: %w", notFoundErr())
    fmt.Println(errors.Is(err, ErrNotFound)) // true
}
```

**Key lesson**: Sentinel errors must be defined once at package level. Each `errors.New` call creates a unique error value.
</details>

---

## Bug 12 🔴 — `defer` Closure Doesn't Update Named Return

```go
package main

import "fmt"

func work() (n int, err error) {
    defer func() {
        n = -1
        err = fmt.Errorf("modified")
    }()
    return 42, nil
}

func main() {
    n, err := work()
    fmt.Println(n, err)
}
```

What does this print? Is the defer working correctly?

<details>
<summary>Hint</summary>
Do explicit return values bypass the named return slots?
</details>

<details>
<summary>Solution</summary>

**Trick (not a bug per se)**: Even with `return 42, nil`, the named results `n` and `err` are populated FIRST, then the deferred function modifies them. Output:
```
-1 modified
```

The lesson is that named results in `return value, value` form still update the named slots before defer runs. The deferred function sees the updated values and can modify them.

**Implication**: a deferred `recover` + `err = fmt.Errorf("recovered: %v", r)` pattern works to convert panics to error returns:

```go
func safe() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    panic("boom")
}
```

**Key lesson**: Defer with named results can override explicit returns. Use this for cleanup-error capture and panic-to-error conversion.
</details>

---

## Bug 13 🔴 — Forwarding to Wrong-Arity Function

```go
package main

import "fmt"

func source() (int, int, int) { return 1, 2, 3 }
func dest(a, b int) int       { return a + b }

func main() {
    fmt.Println(dest(source()))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
How many parameters does `dest` take, and how many does `source` return?
</details>

<details>
<summary>Solution</summary>

**Bug**: `source` returns 3 values, but `dest` accepts 2. Forwarding requires exact match. **Compile error**: `multiple-value source() in single-value context` or similar.

**Fix** — assign and discard:
```go
a, b, _ := source()
fmt.Println(dest(a, b))
```

Or change `dest` to accept three:
```go
func dest(a, b, c int) int { return a + b + c }
```

**Key lesson**: `g(f())` direct forwarding works ONLY when result count and types match parameters exactly.
</details>

---

## Bonus Bug 🔴 — Closure Captures Wrong Multi-Return

```go
package main

import "fmt"

func parseAll(items []string) []func() (int, error) {
    var fns []func() (int, error)
    for _, s := range items {
        fns = append(fns, func() (int, error) {
            return parseInt(s)
        })
    }
    return fns
}

func parseInt(s string) (int, error) {
    if s == "" { return 0, fmt.Errorf("empty") }
    return len(s), nil
}

func main() {
    fns := parseAll([]string{"a", "bb", "ccc"})
    for i, fn := range fns {
        n, err := fn()
        fmt.Printf("[%d] n=%d err=%v\n", i, n, err)
    }
}
```

In Go < 1.22, the output was wrong. In Go ≥ 1.22, it's correct. Why?

<details>
<summary>Hint</summary>
What's the loop-variable change in Go 1.22?
</details>

<details>
<summary>Solution</summary>

**Pre Go 1.22**: each closure captures the SAME `s` variable (shared across iterations). After the loop, `s` is `"ccc"`. All closures call `parseInt("ccc")`, returning `(3, nil)` three times. Output:
```
[0] n=3 err=<nil>
[1] n=3 err=<nil>
[2] n=3 err=<nil>
```

**Post Go 1.22**: `for ... range` creates a NEW `s` per iteration. Each closure captures its own. Output:
```
[0] n=1 err=<nil>
[1] n=2 err=<nil>
[2] n=3 err=<nil>
```

**Fix for pre-1.22**:
```go
for _, s := range items {
    s := s // shadow with per-iteration copy
    fns = append(fns, func() (int, error) {
        return parseInt(s)
    })
}
```

Or pass as argument:
```go
for _, s := range items {
    fns = append(fns, makeFn(s))
}

func makeFn(s string) func() (int, error) {
    return func() (int, error) { return parseInt(s) }
}
```

**Key lesson**: Multi-result functions returned from closures interact with the loop-variable change in Go 1.22. Pre-1.22 code may have had subtle bugs masked by the multi-result not changing the closure semantics. Always verify your `go.mod` go directive when interpreting closure-capture code.
</details>
