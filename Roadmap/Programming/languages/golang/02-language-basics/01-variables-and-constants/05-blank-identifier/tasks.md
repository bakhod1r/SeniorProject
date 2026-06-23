# Go Blank Identifier — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use the blank identifier idiomatically: discard only what should be discarded; document non-obvious choices; never use `_` to silence legitimate compiler errors.

---

## Task 1 — Discard the Error

**Difficulty**: Beginner
**Topic**: Multi-return discard

**Description**: Parse "123" as an integer using `strconv.Atoi`, ignoring the error. Print the integer.

**Starter Code**:
```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // TODO: parse "123" with strconv.Atoi, discarding the error
    var n int
    fmt.Println(n)
}
```

**Expected Output**:
```
123
```

**Evaluation Checklist**:
- [ ] Uses `_` for the error position
- [ ] Result `n` printed correctly
- [ ] No `if err != nil` block (we are explicitly discarding)

<details>
<summary>Solution</summary>

```go
n, _ := strconv.Atoi("123")
fmt.Println(n)
```

We trust the input "123"; in production, you would handle the error.

</details>

---

## Task 2 — Range Over Slice with Discarded Index

**Difficulty**: Beginner
**Topic**: Range index discard

**Description**: Compute the sum of `[]int{1, 2, 3, 4, 5}` using `range`. Use `_` to discard the index.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3, 4, 5}
    sum := 0
    // TODO
    fmt.Println(sum)
}
```

**Expected Output**:
```
15
```

**Evaluation Checklist**:
- [ ] Uses `for _, v := range nums`
- [ ] Discards index with `_`
- [ ] Computes sum correctly

<details>
<summary>Solution</summary>

```go
for _, v := range nums {
    sum += v
}
```

</details>

---

## Task 3 — Side-Effect Import

**Difficulty**: Beginner
**Topic**: Blank import

**Description**: Write the import block that includes `database/sql` for use, plus the postgres driver `github.com/lib/pq` for its registration side effect only (no name binding).

**Starter Code**:
```go
package main

import (
    "database/sql"
    // TODO: blank import for postgres driver
)

func main() {
    db, _ := sql.Open("postgres", "...")
    _ = db
}
```

**Expected Output**:
The program compiles. (No runtime output expected.)

**Evaluation Checklist**:
- [ ] Uses `import _ "github.com/lib/pq"`
- [ ] Does not import `pq` normally
- [ ] Comment optional but encouraged

<details>
<summary>Solution</summary>

```go
import (
    "database/sql"

    _ "github.com/lib/pq" // registers postgres driver
)
```

</details>

---

## Task 4 — Compile-Time Interface Assertion

**Difficulty**: Beginner
**Topic**: Interface satisfaction check

**Description**: Given the type `Greeter` and the interface `Greetable`, add a compile-time assertion that `*Greeter` implements `Greetable`.

**Starter Code**:
```go
package main

import "fmt"

type Greetable interface {
    Greet() string
}

type Greeter struct{ name string }

func (g *Greeter) Greet() string {
    return "hi, " + g.name
}

// TODO: compile-time assertion that *Greeter implements Greetable

func main() {
    g := &Greeter{name: "Ada"}
    fmt.Println(g.Greet())
}
```

**Expected Output**:
```
hi, Ada
```

**Evaluation Checklist**:
- [ ] Uses `var _ Greetable = (*Greeter)(nil)` or equivalent
- [ ] Assertion is at package level, not inside `main`
- [ ] No runtime cost

<details>
<summary>Solution</summary>

```go
var _ Greetable = (*Greeter)(nil)
```

Place near the type definition.

</details>

---

## Task 5 — Discard Map Value Presence Flag

**Difficulty**: Beginner
**Topic**: Comma-ok discard

**Description**: Look up the value at key `"role"` in `m := map[string]string{"role": "admin"}`. Discard the presence flag explicitly with `_`.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    m := map[string]string{"role": "admin"}
    // TODO: read m["role"] with explicit `_` discard
    var role string
    fmt.Println(role)
}
```

**Expected Output**:
```
admin
```

**Evaluation Checklist**:
- [ ] Uses `role, _ := m["role"]`
- [ ] Demonstrates the comma-ok form even though it is optional for maps

<details>
<summary>Solution</summary>

```go
role, _ := m["role"]
```

The comma-ok form is optional for maps. Using `_` documents that you considered presence and chose to ignore it.

</details>

---

## Task 6 — Receiver Discard

**Difficulty**: Beginner
**Topic**: Method without receiver use

**Description**: Implement a method `Version` on `*Service` that returns "v1.0" without naming the receiver.

**Starter Code**:
```go
package main

import "fmt"

type Service struct{ /* ... */ }

// TODO: method Version() with discarded receiver

func main() {
    s := &Service{}
    fmt.Println(s.Version())
}
```

**Expected Output**:
```
v1.0
```

**Evaluation Checklist**:
- [ ] Uses `func (_ *Service) Version() string`
- [ ] Returns "v1.0"
- [ ] Method does not reference `self`

<details>
<summary>Solution</summary>

```go
func (_ *Service) Version() string {
    return "v1.0"
}
```

</details>

---

## Task 7 — Struct with Padding

**Difficulty**: Intermediate
**Topic**: Anonymous struct field

**Description**: Define `Aligned` with two `uint64` fields `A` and `B`, separated by exactly 56 bytes of anonymous padding so each field starts on a 64-byte boundary. Print `unsafe.Sizeof(Aligned{})`.

**Starter Code**:
```go
package main

import (
    "fmt"
    "unsafe"
)

// TODO: define struct Aligned

func main() {
    fmt.Println(unsafe.Sizeof(Aligned{}))
}
```

**Expected Output**:
```
72
```

(Or 128 if you also pad after `B`.)

**Evaluation Checklist**:
- [ ] Uses `_ [56]byte` between fields
- [ ] Total size matches expected
- [ ] Field names are `A` and `B`

<details>
<summary>Solution (72 bytes)**:

```go
type Aligned struct {
    A uint64
    _ [56]byte
    B uint64
}
```

For 128 bytes, also pad after `B`:

```go
type Aligned struct {
    A uint64
    _ [56]byte
    B uint64
    _ [56]byte
}
```

</details>

---

## Task 8 — Build a Driver Plugin Registry

**Difficulty**: Intermediate
**Topic**: Side-effect imports + init

**Description**: Build a small framework where each codec package registers itself in `init`. The main app imports codecs blank.

**Starter Code**:
```go
// codec/registry.go
package codec

var codecs = map[string]Codec{}

type Codec interface {
    Encode(s string) string
}

// TODO: Register and Get functions
```

```go
// codec/upper/upper.go
package upper

import "myapp/codec"
import "strings"

type Upper struct{}
func (Upper) Encode(s string) string { return strings.ToUpper(s) }

// TODO: register in init
```

```go
// main.go
package main

import (
    "fmt"

    "myapp/codec"

    // TODO: blank import for upper
)

func main() {
    c := codec.Get("upper")
    fmt.Println(c.Encode("hello"))
}
```

**Expected Output**:
```
HELLO
```

**Evaluation Checklist**:
- [ ] `codec.Register("upper", Upper{})` in `upper/upper.go`'s `init`
- [ ] `_ "myapp/codec/upper"` in `main.go`
- [ ] `codec.Get("upper")` returns the registered codec

<details>
<summary>Solution</summary>

`codec/registry.go`:
```go
package codec

var codecs = map[string]Codec{}

type Codec interface {
    Encode(s string) string
}

func Register(name string, c Codec) { codecs[name] = c }
func Get(name string) Codec         { return codecs[name] }
```

`codec/upper/upper.go`:
```go
package upper

import (
    "strings"

    "myapp/codec"
)

type Upper struct{}

func (Upper) Encode(s string) string { return strings.ToUpper(s) }

func init() {
    codec.Register("upper", Upper{})
}
```

`main.go`:
```go
package main

import (
    "fmt"

    "myapp/codec"
    _ "myapp/codec/upper"
)

func main() {
    c := codec.Get("upper")
    fmt.Println(c.Encode("hello"))
}
```

</details>

---

## Task 9 — Compile-Time Assertion for a Generic Container

**Difficulty**: Intermediate
**Topic**: Generic interface assertion

**Description**: Given `Container[T]` and `IntBag` (which holds ints), add a compile-time assertion that `*IntBag` implements `Container[int]`.

**Starter Code**:
```go
package main

import "fmt"

type Container[T any] interface {
    Add(v T)
    Items() []T
}

type IntBag struct{ items []int }

func (b *IntBag) Add(v int)    { b.items = append(b.items, v) }
func (b *IntBag) Items() []int { return b.items }

// TODO: compile-time assertion

func main() {
    var c Container[int] = &IntBag{}
    c.Add(1)
    c.Add(2)
    fmt.Println(c.Items())
}
```

**Expected Output**:
```
[1 2]
```

**Evaluation Checklist**:
- [ ] Uses `var _ Container[int] = (*IntBag)(nil)`
- [ ] Type parameter `int` is correct
- [ ] Assertion is at package level

<details>
<summary>Solution</summary>

```go
var _ Container[int] = (*IntBag)(nil)
```

</details>

---

## Task 10 — Discard `n` From `io.Copy`

**Difficulty**: Intermediate
**Topic**: Discarding the byte count

**Description**: Copy a `strings.Reader` into a `bytes.Buffer` using `io.Copy`. Discard the byte count but check the error.

**Starter Code**:
```go
package main

import (
    "bytes"
    "fmt"
    "io"
    "strings"
)

func main() {
    src := strings.NewReader("hello")
    var dst bytes.Buffer
    // TODO: io.Copy, discarding n, checking err
    fmt.Println(dst.String())
}
```

**Expected Output**:
```
hello
```

**Evaluation Checklist**:
- [ ] Uses `_, err := io.Copy(&dst, src)`
- [ ] Checks `err != nil` (even if just for safety)
- [ ] Prints destination buffer

<details>
<summary>Solution</summary>

```go
_, err := io.Copy(&dst, src)
if err != nil {
    fmt.Println("copy failed:", err)
    return
}
```

</details>

---

## Task 11 — Discard Receiver in Interface Method

**Difficulty**: Intermediate
**Topic**: Stateless service method

**Description**: Define a stateless `HealthChecker` type with method `Check() string` returning "ok". Use `_` for the receiver. Add a compile-time assertion that it implements an `Operationable` interface.

**Starter Code**:
```go
package main

import "fmt"

type Operationable interface {
    Check() string
}

// TODO: HealthChecker, method, assertion

func main() {
    var op Operationable = &HealthChecker{}
    fmt.Println(op.Check())
}
```

**Expected Output**:
```
ok
```

**Evaluation Checklist**:
- [ ] `func (_ *HealthChecker) Check() string`
- [ ] `var _ Operationable = (*HealthChecker)(nil)`
- [ ] Method body returns "ok"

<details>
<summary>Solution</summary>

```go
type HealthChecker struct{}

func (_ *HealthChecker) Check() string { return "ok" }

var _ Operationable = (*HealthChecker)(nil)
```

</details>

---

## Task 12 — Avoid Capturing Big Slice Via Underscore Parameter

**Difficulty**: Advanced
**Topic**: Escape analysis with `_` parameter

**Description**: Write `register(_ []byte) func()` that ignores its argument and returns a closure printing "done". The intent is that the caller's `[]byte` is not pinned by the returned closure.

**Starter Code**:
```go
package main

import "fmt"

// TODO

func main() {
    bigBuf := make([]byte, 1<<20)
    f := register(bigBuf)
    f()
    _ = bigBuf
}
```

**Expected Output**:
```
done
```

**Evaluation Checklist**:
- [ ] Parameter is `_ []byte` (not named)
- [ ] Returns a closure
- [ ] Closure does not capture the parameter

<details>
<summary>Solution</summary>

```go
func register(_ []byte) func() {
    return func() { fmt.Println("done") }
}
```

The `_` parameter slot exists for the API signature but is not bound to a local variable, so the closure cannot capture it.

</details>

---

## Task 13 — Multiple Compile-Time Assertions in One Block

**Difficulty**: Advanced
**Topic**: Grouped assertions

**Description**: Given three types `T1`, `T2`, `T3` all implementing interface `I`, group all three compile-time assertions into one `var (...)` block.

**Starter Code**:
```go
package main

import "fmt"

type I interface {
    Tag() string
}

type T1 struct{}
type T2 struct{}
type T3 struct{}

func (*T1) Tag() string { return "t1" }
func (*T2) Tag() string { return "t2" }
func (*T3) Tag() string { return "t3" }

// TODO: grouped assertions

func main() {
    items := []I{&T1{}, &T2{}, &T3{}}
    for _, it := range items {
        fmt.Println(it.Tag())
    }
}
```

**Expected Output**:
```
t1
t2
t3
```

**Evaluation Checklist**:
- [ ] All assertions in a single `var (...)` block
- [ ] Each uses `(*T)(nil)`
- [ ] Block placed at package level

<details>
<summary>Solution</summary>

```go
var (
    _ I = (*T1)(nil)
    _ I = (*T2)(nil)
    _ I = (*T3)(nil)
)
```

</details>

---

## Task 14 — Detect a Bug Caused by Removed Blank Import

**Difficulty**: Advanced
**Topic**: Production debugging

**Description**: A teammate's PR removes `_ "github.com/lib/pq"` because their IDE flagged it as "unused". The CI passes locally but production fails with `sql: unknown driver "postgres"`. Explain why and write a comment to the import that prevents the next person from removing it.

**Starter Code**:
```go
package main

import (
    "database/sql"
    "log"

    // TODO: blank import with explanatory comment
)

func main() {
    db, err := sql.Open("postgres", "...")
    if err != nil { log.Fatal(err) }
    _ = db
}
```

**Expected Output**:
The program compiles, and no future contributor removes the import.

**Evaluation Checklist**:
- [ ] Restored blank import line
- [ ] Comment explains the side effect
- [ ] Comment is on the same line or directly above the import

<details>
<summary>Solution</summary>

```go
import (
    "database/sql"
    "log"

    // SQL drivers — these self-register via init().
    // DO NOT remove even if your IDE marks them unused.
    _ "github.com/lib/pq"
)
```

The comment serves both the IDE (a hint to leave it alone) and the next reader.

</details>

---

## Task 15 — Write a Linter Rule (Conceptual)

**Difficulty**: Advanced
**Topic**: Static analysis

**Description**: Describe a Go static-analysis rule that flags `_ = expr` assignments where `expr`'s only return value is `error` (i.e., the discarded value is an error). Provide the conceptual algorithm; you do not need to implement it in `golang.org/x/tools/go/analysis`, just describe the steps.

**Expected Output (your written answer)**:
A short paragraph describing the algorithm.

**Evaluation Checklist**:
- [ ] Walks the AST
- [ ] Identifies `*ast.AssignStmt` with single LHS `_`
- [ ] Resolves the type of the RHS
- [ ] Reports if the type is `error`
- [ ] Suggests handling the error or adding a `// nolint:errcheck` comment with justification

<details>
<summary>Solution</summary>

The algorithm:

1. Traverse each Go file's AST.
2. For each `*ast.AssignStmt` whose `Lhs` has exactly one element and that element is `*ast.Ident{Name: "_"}`:
3. Look up the type of the `Rhs[0]` expression via `go/types`.
4. If the type is `error` (i.e., implements `error` interface, or named `error`):
5. Emit a diagnostic at the assignment's position: "discarded error from <function>; handle it explicitly or document with a `// nolint:errcheck` comment".

This is essentially what `errcheck` does. It can be configured to allow specific functions (like `fmt.Println`) on an exclusion list.

The rule is useful but noisy; teams typically scope it to specific risk areas (database, IO, JSON parsing) rather than every error discard.

</details>

---

## 16. Self-Assessment

After completing the tasks, answer:

- Can I list 5 distinct positions where `_` is allowed?
- Can I explain why each `_` is independent?
- Do I always reach for `(*T)(nil)` rather than `T{}` for assertions?
- Can I name 3 standard-library packages that exist primarily to be blank-imported?
- Do I know which lint rules flag discarded errors and how to scope them?

If yes to all, you have a solid grasp of the blank identifier. The next step is to look at OSS code (CockroachDB, Kubernetes, lib/pq) and see how the patterns appear in production.

---

## 17. Summary

The blank identifier is a small feature with a wide range of idiomatic uses:

1. Discarding return values.
2. Discarding range index/value.
3. Side-effect imports.
4. Compile-time interface assertions.
5. Struct padding.
6. Stateless method receivers.

Each task above exercises one of these patterns. Use `_` to **add intent**, not to **silence the compiler**.
