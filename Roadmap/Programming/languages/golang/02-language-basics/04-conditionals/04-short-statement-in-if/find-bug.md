# Go Short Statement in If — Find the Bug

## Instructions

Each exercise contains buggy Go code that uses (or misuses) the if-init form. Identify the bug, explain why, and provide the fix. Difficulty: Easy, Medium, Hard.

---

## Bug 1 (Easy) — Trying to Use the Init Variable After the Block

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    if n, err := strconv.Atoi("42"); err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println("parsed:", n)
}
```

What is wrong, and how do you fix it?

<details>
<summary>Solution</summary>

**Bug**: `n` is declared in the if-init. Its scope is the if/else chain. The `fmt.Println("parsed:", n)` after the chain is outside that scope; the compiler reports `undefined: n`.

**Fix** — declare `n` (and `err`) outside the if:

```go
n, err := strconv.Atoi("42")
if err != nil {
    fmt.Println(err)
    return
}
fmt.Println("parsed:", n)
```

**Common-bug explanation**: Init form is purely for variables consumed inside the if/else chain. As soon as a value must outlive the chain, do not use init form.
</details>

---

## Bug 2 (Easy) — Shadowing Outer `err`

```go
package main

import (
    "errors"
    "fmt"
)

func op() error { return errors.New("boom") }

func process() error {
    var err error
    for i := 0; i < 3; i++ {
        if err := op(); err != nil {
            fmt.Println("iter", i, ":", err)
        }
    }
    return err
}

func main() {
    fmt.Println("returned:", process())
}
```

What does `main` print, and what is wrong?

<details>
<summary>Solution</summary>

**Bug**: The inner `if err := op(); err != nil` declares a NEW `err` in the implicit block scope of the if. The outer `err` is never assigned. `process()` returns nil even though every iteration produced an error.

Output:
```
iter 0 : boom
iter 1 : boom
iter 2 : boom
returned: <nil>
```

**Fix** — use `=` to assign to the outer `err`:

```go
for i := 0; i < 3; i++ {
    if err = op(); err != nil {
        fmt.Println("iter", i, ":", err)
    }
}
return err
```

Now the init form runs as an assignment to the existing outer `err`. If you want to keep the iteration error scoped, drop the outer `err` and surface errors a different way.

**Common-bug explanation**: This is the classic err-shadowing bug. `:=` always declares a new variable in the implicit block; outer-scope `err` is never touched. Use `=` if you intend to mutate the outer.
</details>

---

## Bug 3 (Easy) — Confusing `:=` and `=`

```go
package main

import "fmt"

func main() {
    x := 10
    if x = compute(); x > 5 {
        fmt.Println("big:", x)
    }
    fmt.Println("after:", x)
}

func compute() int { return 7 }
```

The author thinks the second `Println` will show `10`. What does it show?

<details>
<summary>Solution</summary>

**Bug**: The init uses `=`, which is an assignment, not a declaration. It mutates the outer `x` from `10` to `7`. After the if, `x` is `7`.

Output:
```
big: 7
after: 7
```

**Fix** — if you intended to keep the outer `x` intact, use `:=`:

```go
x := 10
if x := compute(); x > 5 {
    fmt.Println("big:", x) // inner x = 7
}
fmt.Println("after:", x) // outer x = 10
```

**Common-bug explanation**: `=` and `:=` look similar but mean opposite things in init position. `=` reuses the existing name (mutates outer); `:=` introduces a new name (shadows outer).
</details>

---

## Bug 4 (Easy) — Comma-Ok Used Without `ok`

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 0, "b": 5}
    if v, _ := m["a"]; v > 0 {
        fmt.Println("a present and positive")
    } else {
        fmt.Println("a missing or zero")
    }
}
```

What is the subtle bug?

<details>
<summary>Solution</summary>

**Bug**: Discarding `ok` with `_` collapses two distinct cases — "absent" and "present-but-zero" — into one branch ("missing or zero"). The map has `a: 0`. The output says `a missing or zero`, which is misleading: `a` is present.

**Fix** — keep `ok` and combine in the condition:

```go
if v, ok := m["a"]; ok && v > 0 {
    fmt.Println("a present and positive")
} else if ok {
    fmt.Println("a present but zero")
} else {
    fmt.Println("a absent")
}
```

**Common-bug explanation**: The comma-ok form's whole purpose is to distinguish "missing" from "zero". Discarding `ok` defeats it.
</details>

---

## Bug 5 (Medium) — Multi-Var Init Where Only One Is Used

```go
package main

import "fmt"

func ratio(a, b int) (q, r int) {
    return a / b, a % b
}

func main() {
    if q, r := ratio(20, 7); q > 2 {
        fmt.Println("big quotient:", q)
    }
}
```

What does `go vet` or `staticcheck` say?

<details>
<summary>Solution</summary>

**Bug**: `r` is declared but unused inside the chain. Go does **not** emit an unused-variable error for `r` here because both `q` and `r` are introduced by the same `:=` and at least one (`q`) is used. The compiler permits it. But linters (`unparam`, `staticcheck` SA4006/SA5008 variants) will warn that `r` is dead.

**Fix** — either ignore with `_` or split the call:

```go
if q, _ := ratio(20, 7); q > 2 {
    fmt.Println("big quotient:", q)
}
```

Or:

```go
q := 20 / 7
if q > 2 {
    fmt.Println("big quotient:", q)
}
```

**Common-bug explanation**: Multi-var init can hide unused values. The compiler is lenient; linters are stricter. Drop unused names with `_` so the intent is clear.
</details>

---

## Bug 6 (Medium) — Init Variable Reused After the Else

```go
package main

import "fmt"

func main() {
    if x := 5; x > 0 {
        fmt.Println("positive")
    } else if x < 0 {
        fmt.Println("negative")
    } else {
        fmt.Println("zero")
    }
    if x > 0 { // ??
        fmt.Println("still positive")
    }
}
```

Compile or runtime error?

<details>
<summary>Solution</summary>

**Bug**: Compile error. The first `if x := 5; ...` chain declares `x` in its implicit block. After the chain's closing `}`, `x` is out of scope. The second `if x > 0` finds no `x` — `undefined: x`.

**Fix** — declare `x` outside if you need it later:

```go
x := 5
if x > 0 {
    fmt.Println("positive")
} else if x < 0 {
    fmt.Println("negative")
} else {
    fmt.Println("zero")
}
if x > 0 {
    fmt.Println("still positive")
}
```

**Common-bug explanation**: The implicit block ends with the chain's last `}`. Names declared in init are gone after that. Always check whether you need the value past the chain before reaching for init form.
</details>

---

## Bug 7 (Medium) — Type Assertion Without Comma-Ok

```go
package main

import "fmt"

func main() {
    var i any = 42
    if s := i.(string); len(s) > 0 {
        fmt.Println("string:", s)
    } else {
        fmt.Println("empty string")
    }
}
```

What happens?

<details>
<summary>Solution</summary>

**Bug**: Single-result type assertion `i.(string)` panics if the dynamic type is not `string`. `i` holds `int(42)`. The program panics with `interface conversion: interface {} is int, not string`.

The init form does not protect from this — it is the comma-ok form of the assertion that does. The author wrote `i.(string)` instead of `i.(string)` with `ok`.

**Fix** — use comma-ok:

```go
if s, ok := i.(string); ok && len(s) > 0 {
    fmt.Println("string:", s)
} else {
    fmt.Println("not a non-empty string")
}
```

**Common-bug explanation**: The init form is a scoping tool, not a safety tool. Pair it with comma-ok for safe type assertions.
</details>

---

## Bug 8 (Medium) — Useless Init Call With Discarded Result

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    raw := "42"
    if strconv.Atoi(raw); len(raw) > 0 {
        fmt.Println("input:", raw)
    }
}
```

What is wrong with this code?

<details>
<summary>Solution</summary>

**Bug**: The init `strconv.Atoi(raw)` is a function call (a valid `ExpressionStmt`). Both return values — the parsed int and the error — are silently discarded. The condition `len(raw) > 0` does not look at them. The init wastes cycles and hides whether the parse succeeded.

`errcheck` and `staticcheck` will flag the unchecked error from `strconv.Atoi`.

**Fix** — capture the results in a `:=` so the check uses them:

```go
if n, err := strconv.Atoi(raw); err != nil {
    fmt.Println("parse failed:", err)
} else {
    fmt.Println("input:", raw, "as int:", n)
}
```

Or remove the call if you do not actually need the parse:

```go
if len(raw) > 0 {
    fmt.Println("input:", raw)
}
```

**Common-bug explanation**: Init position must be a `SimpleStmt`. Function calls are valid `SimpleStmt`s, but a call whose results are ignored and whose side effects are zero is dead code. The init is the wrong place to put any call whose result the condition does not consume.
</details>

---

## Bug 9 (Hard) — Multi-Var Init With Shadowing Mismatch

```go
package main

import (
    "errors"
    "fmt"
)

func work() (int, error) { return 0, errors.New("oops") }

func run() (n int, err error) {
    if n, err := work(); err != nil {
        return n, err
    }
    fmt.Println("got:", n)
    return n, nil
}

func main() {
    n, err := run()
    fmt.Println(n, err)
}
```

What does this print, and what is the bug?

<details>
<summary>Solution</summary>

**Bug**: The function `run` declares **named return values** `n` and `err`. The if-init writes `if n, err := work(); err != nil` — both `n` and `err` are introduced as fresh inner names because `:=` is used.

The inner `err` is `oops` and the inner branch `return n, err` returns the inner names — by the named-return mechanism, `return` with values overrides the named slots. So when `err` is non-nil, that branch correctly returns `(0, oops)`.

But when `err` is nil (different example), the inner `n` would also be set, the if branch is skipped, and `fmt.Println("got:", n)` reads the **outer** named return `n`, which is still its zero value. The inner `n` from `work()` is lost.

In this specific example with `err != nil`, output is:
```
0 oops
```
which looks correct. But if `work()` returned `(42, nil)`, the inner `n=42` would be discarded:
```
got: 0
0 <nil>
```

**Fix** — use `=` to assign to the named returns:

```go
func run() (n int, err error) {
    if n, err = work(); err != nil {
        return n, err
    }
    fmt.Println("got:", n)
    return n, nil
}
```

Or just `return work()` if no other logic.

**Common-bug explanation**: Named returns + if-init `:=` is one of Go's most subtle bugs. The init shadows the named returns; when control flows past the if, the outer (zero) named returns are read, losing the inner values.
</details>

---

## Bug 10 (Hard) — Channel Receive in Init Without Comma-Ok

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 7
    close(ch)

    for {
        if v := <-ch; v == 0 {
            fmt.Println("done")
            return
        } else {
            fmt.Println("got:", v)
        }
    }
}
```

What is wrong?

<details>
<summary>Solution</summary>

**Bug**: A single-value receive `<-ch` does not distinguish "channel closed" from "received the zero value". After the closed channel drains its buffered `7`, every subsequent `<-ch` returns `0` (the int zero) immediately. The author expects `v == 0` to mean "done", but if a real `0` were sent the loop would terminate prematurely.

In this example there is no real `0` sent, so the loop happens to behave correctly — but the logic is fragile and incorrect in general.

**Fix** — use comma-ok:

```go
for {
    if v, ok := <-ch; !ok {
        fmt.Println("done")
        return
    } else {
        fmt.Println("got:", v)
    }
}
```

**Common-bug explanation**: Channel `<-ch` returns the zero value when closed. The two-result form (`v, ok := <-ch`) is the only way to distinguish "closed" from "received a real zero". Init form is the right place to use it; just remember to include `ok`.
</details>

---

## Bug 11 (Hard) — Init in `else if` Chain Reading Wrong Scope

```go
package main

import "fmt"

func main() {
    if a := 1; a > 0 {
        fmt.Println("first:", a)
    } else if b := 2; a == 0 && b == 2 {
        fmt.Println("second:", a, b)
    } else {
        fmt.Println("third")
    }
}
```

The author thinks `a` and `b` are independent. What is the actual scoping?

<details>
<summary>Solution</summary>

**Bug**: This is actually correct in scoping but tricky. The first `if a := 1; ...` opens an implicit block; `a` is in scope across all `else if` and `else` branches. The `else if b := 2; ...` opens a **second** implicit block nested inside the first; `b` is in scope only across that inner else-if's body and any following else.

So:
- `a` is in scope in the first body, the `else if` condition, the `else if` body, and the final `else`.
- `b` is in scope only in the `else if` body and the final `else`.

Both names live as long as the chain. After the chain's last `}`, both are gone.

The "bug" people often hit: they expect `b` to be local to the `else if` only and are surprised that the final `else` can reference it. (It usually cannot accidentally — the final `else` does not name `b` here.)

**Fix** — if you want `b` truly local, hoist or use a switch:

```go
switch {
case a > 0:
    fmt.Println("first:", a)
case a == 0:
    b := 2
    if b == 2 {
        fmt.Println("second:", a, b)
    }
default:
    fmt.Println("third")
}
```

**Common-bug explanation**: Init in `else if` opens a NESTED implicit block. The names propagate down the chain (to subsequent `else if`/`else`) but not up. People often misread the lifetime.
</details>

---

## Bug 12 (Hard) — Init in Switch Reused After

```go
package main

import "fmt"

func kind(s string) string {
    switch first := s[0]; {
    case first >= 'a' && first <= 'z':
        return "lower"
    case first >= 'A' && first <= 'Z':
        return "upper"
    default:
        return "other"
    }
    fmt.Println("first was:", first) // ??
}

func main() {
    fmt.Println(kind("Go"))
}
```

What is wrong?

<details>
<summary>Solution</summary>

**Bug 1**: The `fmt.Println("first was:", first)` after the switch is unreachable — every case `return`s. `go vet` warns: "unreachable code".

**Bug 2**: Even if it were reachable, `first` is declared in the switch's init. Its scope ends at the switch's `}`. The line outside the switch references `first`, which is undefined. Compile error.

**Fix** — remove the dead line, or hoist `first` outside the switch if you need it after:

```go
func kind(s string) string {
    first := s[0]
    res := ""
    switch {
    case first >= 'a' && first <= 'z':
        res = "lower"
    case first >= 'A' && first <= 'Z':
        res = "upper"
    default:
        res = "other"
    }
    fmt.Println("first was:", first)
    return res
}
```

**Common-bug explanation**: Switch-init shares scope rules with if-init. The init's variables vanish at the switch's closing `}`. If you need them later, hoist.
</details>

---

## Summary

The bugs above cover the five mandated categories:

1. **Post-block use** (Bug 1, 6, 12)
2. **Outer err shadowed** (Bug 2, 9)
3. **`:=` vs `=` confusion** (Bug 3, 9)
4. **Comma-ok mistakes** (Bug 4, 7, 10)
5. **Multi-var init pitfalls** (Bug 5, 9, 11)

Lessons:
- Init form is a scope tool. Names die at the chain's last `}`.
- `:=` always declares; `=` always assigns. Choose deliberately.
- Comma-ok is essential for maps, type assertions, and channels.
- Named returns + init `:=` is a classic shadowing trap.
- Switch-init follows the same rules as if-init.
