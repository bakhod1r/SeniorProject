# Go Short Statement in If — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use the if-init form idiomatically. When the value must outlive the chain, use a hoisted declaration instead — the right choice is part of each task.

---

## Task 1 — Basic Init Guard

**Difficulty**: Beginner
**Topic**: Single-variable init

**Description**: Write a program that reads an integer from `compute()` and uses an `if`-init form to print "positive", "negative", or "zero" without leaving the value in the surrounding scope.

**Starter Code**:
```go
package main

import "fmt"

func compute() int { return -3 }

func main() {
    // TODO: use if-init to inspect compute()'s result and print the right word.
}
```

**Expected Output** (for return value `-3`):
```
negative
```

**Evaluation Checklist**:
- [ ] Uses `if x := compute(); ...` with a chained `else if` and `else`
- [ ] `x` not used after the chain
- [ ] All three branches reachable (test by changing `compute`'s return)

<details><summary>Solution</summary>

```go
func main() {
    if x := compute(); x > 0 {
        fmt.Println("positive")
    } else if x < 0 {
        fmt.Println("negative")
    } else {
        fmt.Println("zero")
    }
}
```
</details>

---

## Task 2 — Map Comma-Ok

**Difficulty**: Beginner
**Topic**: Comma-ok in init

**Description**: Given a `map[string]int`, write a function `report(m map[string]int, key string)` that prints `"<key> = <value>"` if the key is present (regardless of value) and `"<key> not in map"` otherwise.

**Starter Code**:
```go
package main

import "fmt"

func report(m map[string]int, key string) {
    // TODO
}

func main() {
    m := map[string]int{"a": 0, "b": 5}
    report(m, "a")
    report(m, "c")
}
```

**Expected Output**:
```
a = 0
c not in map
```

**Evaluation Checklist**:
- [ ] Uses `if v, ok := m[key]; ok { ... } else { ... }`
- [ ] Distinguishes "present-and-zero" from "absent" (the `a` case)
- [ ] No leakage of `v` or `ok` beyond the chain

<details><summary>Solution</summary>

```go
func report(m map[string]int, key string) {
    if v, ok := m[key]; ok {
        fmt.Printf("%s = %d\n", key, v)
    } else {
        fmt.Printf("%s not in map\n", key)
    }
}
```
</details>

---

## Task 3 — Type Assertion Guard

**Difficulty**: Beginner
**Topic**: Type assertion in init

**Description**: Implement `describe(i any)` that prints type-specific descriptions for `int`, `string`, and `[]int`, and a generic message for any other type. Use chained `if`-init type assertions.

**Starter Code**:
```go
package main

import "fmt"

func describe(i any) {
    // TODO
}

func main() {
    describe(42)
    describe("Go")
    describe([]int{1, 2, 3})
    describe(3.14)
}
```

**Expected Output**:
```
int: 42
string of length 2
slice of length 3
unknown type
```

**Evaluation Checklist**:
- [ ] Each type check uses `if v, ok := i.(T); ok { ... }`
- [ ] Returns/prints early on the first matching type
- [ ] Falls through to "unknown type" otherwise

<details><summary>Solution</summary>

```go
func describe(i any) {
    if n, ok := i.(int); ok {
        fmt.Printf("int: %d\n", n)
        return
    }
    if s, ok := i.(string); ok {
        fmt.Printf("string of length %d\n", len(s))
        return
    }
    if sl, ok := i.([]int); ok {
        fmt.Printf("slice of length %d\n", len(sl))
        return
    }
    fmt.Println("unknown type")
}
```
</details>

---

## Task 4 — Channel Receive Guard

**Difficulty**: Beginner
**Topic**: Comma-ok with channels in init

**Description**: Implement `drain(ch <-chan int)` that prints every received value and prints `"channel closed"` when the channel is drained and closed. Use `if v, ok := <-ch; ok` inside an infinite `for`.

**Starter Code**:
```go
package main

import "fmt"

func drain(ch <-chan int) {
    // TODO
}

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    close(ch)
    drain(ch)
}
```

**Expected Output**:
```
got: 1
got: 2
got: 3
channel closed
```

**Evaluation Checklist**:
- [ ] Uses `for { if v, ok := <-ch; ok { ... } else { return } }`
- [ ] Prints each received value
- [ ] Returns when the channel is closed

<details><summary>Solution</summary>

```go
func drain(ch <-chan int) {
    for {
        if v, ok := <-ch; ok {
            fmt.Println("got:", v)
        } else {
            fmt.Println("channel closed")
            return
        }
    }
}
```
</details>

---

## Task 5 — Switch With Init

**Difficulty**: Beginner
**Topic**: Switch-init parallel

**Description**: Write `dayKind(day time.Weekday) string` that returns `"weekend"` for Saturday/Sunday and `"weekday"` otherwise. Use a tagless `switch` with init.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func dayKind(day time.Weekday) string {
    // TODO: switch d := day; { case ... }
    return ""
}

func main() {
    fmt.Println(dayKind(time.Saturday))
    fmt.Println(dayKind(time.Wednesday))
}
```

**Expected Output**:
```
weekend
weekday
```

**Evaluation Checklist**:
- [ ] Uses `switch d := day; { case ... }`
- [ ] Both cases reachable
- [ ] `d` not used after the switch

<details><summary>Solution</summary>

```go
func dayKind(day time.Weekday) string {
    switch d := day; {
    case d == time.Saturday || d == time.Sunday:
        return "weekend"
    default:
        return "weekday"
    }
}
```
</details>

---

## Task 6 — Refactor: Avoid Err-Shadowing

**Difficulty**: Intermediate
**Topic**: `:=` vs `=` in init

**Description**: This function silently loses errors. Refactor so that errors are preserved.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
)

func op(i int) error {
    if i%2 == 1 {
        return fmt.Errorf("odd: %d", i)
    }
    return nil
}

func runAll() error {
    var err error
    for i := 0; i < 4; i++ {
        if err := op(i); err != nil {
            fmt.Println("logged:", err)
        }
    }
    return err
}

func main() {
    e := runAll()
    fmt.Println("returned:", e)
    _ = errors.New
}
```

**Bug**: The init's `err :=` shadows the outer `err`. `runAll` returns `nil` even though `op(1)` and `op(3)` failed.

**Expected Output (after fix)**: returned should be the last logged error.

**Evaluation Checklist**:
- [ ] Identifies the shadowing bug
- [ ] Fixes by using `=` to assign to the outer `err`
- [ ] Last error is preserved in the return value

<details><summary>Solution</summary>

```go
func runAll() error {
    var err error
    for i := 0; i < 4; i++ {
        if err = op(i); err != nil {
            fmt.Println("logged:", err)
        }
    }
    return err
}
```

Output:
```
logged: odd: 1
logged: odd: 3
returned: odd: 3
```
</details>

---

## Task 7 — Choosing Init vs Hoisted

**Difficulty**: Intermediate
**Topic**: When NOT to use init form

**Description**: Refactor `parseAndUse(raw string)` so it is idiomatic. The function must parse `raw` as an integer, error out on failure, and double the parsed value if it is positive.

**Starter Code**:
```go
package main

import (
    "fmt"
    "strconv"
)

func parseAndUse(raw string) (int, error) {
    if n, err := strconv.Atoi(raw); err != nil {
        return 0, err
    }
    if n > 0 { // ??
        return n * 2, nil
    }
    return n, nil
}

func main() {
    fmt.Println(parseAndUse("21"))
}
```

**Bug**: `n` is declared in the if-init; it does not exist outside. The function does not compile.

**Evaluation Checklist**:
- [ ] Recognizes that `n` must outlive the err check
- [ ] Hoists the declaration: `n, err := strconv.Atoi(raw); if err != nil { ... }`
- [ ] Function compiles and returns 42 for input "21"

<details><summary>Solution</summary>

```go
func parseAndUse(raw string) (int, error) {
    n, err := strconv.Atoi(raw)
    if err != nil {
        return 0, err
    }
    if n > 0 {
        return n * 2, nil
    }
    return n, nil
}
```

Output: `42 <nil>`
</details>

---

## Task 8 — Validation Chain

**Difficulty**: Intermediate
**Topic**: Layered if-init for validation

**Description**: Implement `validateEmail(s string) error` returning errors for: empty string, missing `@`, missing domain dot. Use chained `else if` with init.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

func validateEmail(s string) error {
    // TODO
    return nil
}

func main() {
    cases := []string{"", "no-at", "user@nodot", "ok@example.com"}
    for _, c := range cases {
        fmt.Printf("%q -> %v\n", c, validateEmail(c))
    }
}
```

**Expected Output**:
```
"" -> empty email
"no-at" -> missing @
"user@nodot" -> missing dot in domain
"ok@example.com" -> <nil>
```

**Evaluation Checklist**:
- [ ] Uses chained `if/else if` with init for each check
- [ ] Each init scopes its variable to its check
- [ ] Returns the right `error` for each case

<details><summary>Solution</summary>

```go
func validateEmail(s string) error {
    if t := strings.TrimSpace(s); t == "" {
        return errors.New("empty email")
    } else if i := strings.Index(t, "@"); i < 0 {
        return errors.New("missing @")
    } else if !strings.Contains(t[i+1:], ".") {
        return errors.New("missing dot in domain")
    }
    return nil
}
```
</details>

---

## Task 9 — Type Switch With Init

**Difficulty**: Intermediate
**Topic**: Type switch + init

**Description**: Write `total(values []any) int` that sums the integer values, doubles the length of any string values, and ignores other types. Use a type switch with init inside the loop.

**Starter Code**:
```go
package main

import "fmt"

func total(values []any) int {
    sum := 0
    for _, v := range values {
        // TODO: use type switch with init
        _ = v
    }
    return sum
}

func main() {
    fmt.Println(total([]any{1, "ab", 2, 3.14, "cd", 7}))
}
```

**Expected Output**:
```
18
```

(Compute: 1 + 2*len("ab")=4 + 2 + (skip 3.14) + 2*len("cd")=4 + 7 = 18.)

**Evaluation Checklist**:
- [ ] Uses `switch x := v; t := x.(type) { ... }` (or simply `switch t := v.(type)` if init not needed)
- [ ] Adds int values directly
- [ ] Adds 2*len for strings
- [ ] Skips other types

<details><summary>Solution</summary>

```go
func total(values []any) int {
    sum := 0
    for _, v := range values {
        switch x := v; t := x.(type) {
        case int:
            sum += t
        case string:
            sum += 2 * len(t)
        }
    }
    return sum
}
```

(The init `x := v` is artificial here since `v` is already in scope; a more typical real use is when computing a value to feed the type switch.)
</details>

---

## Task 10 — Switch-Init for Dispatch

**Difficulty**: Intermediate
**Topic**: Switch-init avoids recomputation

**Description**: Implement `messageHour(m Message) string` that returns "morning", "afternoon", "evening", or "night" based on `m.Time().Hour()`. Use `switch h := m.Time().Hour(); { case ... }` so the call to `Time().Hour()` runs once.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

type Message struct {
    t time.Time
}

func (m Message) Time() time.Time { return m.t }

func messageHour(m Message) string {
    // TODO
    return ""
}

func main() {
    m := Message{t: time.Date(2025, 1, 1, 14, 0, 0, 0, time.UTC)}
    fmt.Println(messageHour(m))
}
```

**Expected Output**:
```
afternoon
```

**Evaluation Checklist**:
- [ ] Calls `m.Time().Hour()` once (in the switch init)
- [ ] All four cases handled
- [ ] `h` not visible after the switch

<details><summary>Solution</summary>

```go
func messageHour(m Message) string {
    switch h := m.Time().Hour(); {
    case h < 6:
        return "night"
    case h < 12:
        return "morning"
    case h < 18:
        return "afternoon"
    default:
        return "evening"
    }
}
```
</details>

---

## Task 11 — Detecting the Shadowing Trap

**Difficulty**: Hard
**Topic**: Named returns + init

**Description**: Identify and fix the bug. Both code paths should return the actual computed value.

**Starter Code**:
```go
package main

import "fmt"

func compute() (int, error) { return 100, nil }

func work() (n int, err error) {
    if n, err := compute(); err != nil {
        return n, err
    }
    return n, nil
}

func main() {
    n, err := work()
    fmt.Println(n, err) // expected: 100 <nil>; actual: 0 <nil>
}
```

**Bug**: The init's `:=` shadows the named returns. The inner `n` and `err` are local to the if's implicit block. When `err == nil`, control falls past the if; the body's `return n, nil` reads the outer named `n`, which is still its zero value (0).

**Evaluation Checklist**:
- [ ] Identifies the shadowing
- [ ] Fixes by using `=` (assignment) instead of `:=`
- [ ] Function returns 100 on success

<details><summary>Solution</summary>

```go
func work() (n int, err error) {
    if n, err = compute(); err != nil {
        return n, err
    }
    return n, nil
}
```

Now `n, err = compute()` assigns to the named returns. After the if, `n` is 100. Output: `100 <nil>`.

Alternatively (cleaner):
```go
func work() (int, error) {
    return compute()
}
```
But assume the function does extra work that justifies the structure.
</details>

---

## Task 12 — Building a Result Slice

**Difficulty**: Hard
**Topic**: Loop + if-init

**Description**: Given `sources []func() (int, error)`, return a slice containing the successful results. Each function may fail; failures are logged but do not stop iteration.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "log"
)

func collect(sources []func() (int, error)) []int {
    out := make([]int, 0, len(sources))
    // TODO
    return out
}

func main() {
    s := []func() (int, error){
        func() (int, error) { return 10, nil },
        func() (int, error) { return 0, errors.New("boom") },
        func() (int, error) { return 20, nil },
    }
    fmt.Println(collect(s)) // [10 20]
    _ = log.Println
}
```

**Expected Output**:
```
[10 20]
```
(With "boom" logged via `log.Println`.)

**Evaluation Checklist**:
- [ ] Iterates `sources`
- [ ] Uses `if v, err := f(); err != nil { log... } else { out = append(out, v) }`
- [ ] No leakage of `v`, `err` outside each iteration's check

<details><summary>Solution</summary>

```go
func collect(sources []func() (int, error)) []int {
    out := make([]int, 0, len(sources))
    for _, f := range sources {
        if v, err := f(); err != nil {
            log.Println("source failed:", err)
        } else {
            out = append(out, v)
        }
    }
    return out
}
```
</details>

---

## Task 13 — Cache With Fallback

**Difficulty**: Hard
**Topic**: Multiple if-inits in sequence

**Description**: Implement `Cache.Get(key string) (Value, error)` that first checks a local map; if missing, fetches from a `remote` interface; returns an error if remote fails.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
)

type Value struct{ N int }

type remote interface {
    Fetch(key string) (Value, error)
}

type fakeRemote struct{}

func (fakeRemote) Fetch(key string) (Value, error) {
    if key == "x" {
        return Value{N: 99}, nil
    }
    return Value{}, errors.New("remote miss")
}

type Cache struct {
    local  map[string]Value
    remote remote
}

func (c *Cache) Get(key string) (Value, error) {
    // TODO: check local; on miss, fetch from remote and populate local.
    return Value{}, nil
}

func main() {
    c := &Cache{local: map[string]Value{"a": {N: 1}}, remote: fakeRemote{}}
    fmt.Println(c.Get("a"))
    fmt.Println(c.Get("x"))
    fmt.Println(c.Get("?"))
}
```

**Expected Output**:
```
{1} <nil>
{99} <nil>
{0} remote miss
```

**Evaluation Checklist**:
- [ ] Uses `if v, ok := c.local[key]; ok { return v, nil }`
- [ ] Uses `if v, err := c.remote.Fetch(key); err == nil { c.local[key] = v; return v, nil }`
- [ ] Returns the remote's error on failure

<details><summary>Solution</summary>

```go
func (c *Cache) Get(key string) (Value, error) {
    if v, ok := c.local[key]; ok {
        return v, nil
    }
    if v, err := c.remote.Fetch(key); err == nil {
        c.local[key] = v
        return v, nil
    } else {
        return Value{}, err
    }
}
```
</details>

---

## Task 14 — Reject Heavy Init

**Difficulty**: Hard
**Topic**: Style judgment

**Description**: This code passes lint but is hard to read. Refactor without changing behavior.

**Starter Code**:
```go
package main

import "fmt"

type Result struct {
    Items []int
    Total int
}

func slowQuery() Result { return Result{Items: []int{1, 2, 3}, Total: 6} }

func summary() string {
    if r := slowQuery(); r.Total > 0 && len(r.Items) > 0 && r.Total/len(r.Items) > 1 {
        return fmt.Sprintf("avg %d", r.Total/len(r.Items))
    }
    return "empty"
}

func main() {
    fmt.Println(summary())
}
```

**Issue**: Heavy work (`slowQuery`) sits in the init position; the boolean condition is long and recomputes `r.Total/len(r.Items)` twice.

**Evaluation Checklist**:
- [ ] Hoists `slowQuery()` out of the init
- [ ] Computes `avg` once
- [ ] Reads more clearly without losing tight scope

<details><summary>Solution</summary>

```go
func summary() string {
    r := slowQuery()
    if r.Total <= 0 || len(r.Items) == 0 {
        return "empty"
    }
    avg := r.Total / len(r.Items)
    if avg <= 1 {
        return "empty"
    }
    return fmt.Sprintf("avg %d", avg)
}
```

Now `r` and `avg` are clearly named, `slowQuery` is highlighted as the major operation, and there is no duplicated arithmetic. The cost is two extra lines and `r` lives past the conditional — acceptable for clarity.
</details>

---

## Task 15 — Predict the Output

**Difficulty**: Hard
**Topic**: Scope reasoning

**Description**: Predict the exact output **without** running the program. Then verify.

**Code**:
```go
package main

import "fmt"

func main() {
    x := 1
    if x := x + 1; x > 1 {
        fmt.Println("A:", x)
        if x := x + 1; x > 2 {
            fmt.Println("B:", x)
        }
        fmt.Println("C:", x)
    }
    fmt.Println("D:", x)
}
```

**Self-check**:
- [ ] What does each line print?
- [ ] Which `x` does each line refer to?

<details><summary>Solution</summary>

```
A: 2
B: 3
C: 2
D: 1
```

Step by step:
- `x := 1` → outer `x = 1`.
- First `if x := x + 1; ...`: reads outer `x` (1), declares first inner `x = 2`. Body sees first inner `x`.
- `A: 2` — prints first inner `x`.
- Nested `if x := x + 1; ...`: reads first inner `x` (2), declares second inner `x = 3`. Innermost body sees second inner `x`.
- `B: 3` — prints second inner `x`.
- After the inner `if`'s closing `}`, second inner `x` is gone. `C: 2` — prints first inner `x`.
- After the outer `if`'s closing `}`, first inner `x` is gone. `D: 1` — prints outer `x`.

Three distinct `x` variables exist at different points; each is shadowed by the deeper one until its block ends.
</details>
