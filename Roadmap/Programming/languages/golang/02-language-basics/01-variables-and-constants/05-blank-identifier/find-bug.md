# Go Blank Identifier — Find the Bug

## Instructions

Each exercise contains buggy Go code involving the blank identifier `_`. Identify the bug, explain the cause, and supply the fix. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Reading From `_`

```go
package main

import "fmt"

func divmod(a, b int) (int, int) { return a / b, a % b }

func main() {
    _, r := divmod(17, 5)
    fmt.Println(_, r)
}
```

<details>
<summary>Solution</summary>

**Bug:** `fmt.Println(_, r)` tries to use `_` as a value. `_` is write-only. The compiler refuses:

```
./main.go:9:17: cannot use _ as value
```

**Fix:** Bind the value to a real name:

```go
q, r := divmod(17, 5)
fmt.Println(q, r)
```

Or, if you really want to print only `r`, drop `_` from the print:

```go
_, r := divmod(17, 5)
fmt.Println(r)
```

**Key lesson:** `_` is a destination, not a name you can read.

</details>

---

## Bug 2 🟢 — Trying to Reference `_` Across Statements

```go
package main

import "fmt"

func main() {
    _ := 10
    _ := 20
    fmt.Println(_)
}
```

<details>
<summary>Solution</summary>

**Bug:** Two errors. First, `_ := 10` is illegal because short declaration `:=` requires at least one new non-blank name on the LHS. Second, even if the declarations were legal, each `_` is anonymous — there is no "the value of `_`" to print.

```
./main.go:6:5: no new variables on left side of :=
```

If we replace with `var _ int = 10; var _ int = 20`, those compile, but `fmt.Println(_)` still fails: "cannot use _ as value".

**Fix:** If you have two values to track, give them names:

```go
a := 10
b := 20
fmt.Println(a, b)
```

If you genuinely want both discarded:

```go
var _ = 10
var _ = 20
// nothing to print
```

**Key lesson:** Each `_` is independent. There is no continuity between occurrences.

</details>

---

## Bug 3 🟢 — Forgotten Side-Effect Import (lib/pq)

```go
package main

import (
    "database/sql"
    "fmt"
)

func main() {
    db, err := sql.Open("postgres", "postgres://localhost/test?sslmode=disable")
    if err != nil { panic(err) }
    defer db.Close()
    fmt.Println("connected")
}
```

The developer ran `goimports`, which removed `_ "github.com/lib/pq"` because it "wasn't used". Now `sql.Open` returns `sql: unknown driver "postgres" (forgotten import?)`.

<details>
<summary>Solution</summary>

**Bug:** The blank import is the **mechanism** that registers the postgres driver. Removing it means `database/sql` has no driver under the name `"postgres"`. The error message even hints at the cause.

**Fix:** Restore the import:

```go
import (
    "database/sql"
    "fmt"

    _ "github.com/lib/pq"
)
```

**Prevention:**
- Configure `goimports` (or your editor) to leave blank imports alone.
- Add a comment so the next reader does not delete it: `// registers postgres driver`.
- Ideally, group all driver imports in one place with a comment block.

```go
import (
    // SQL drivers — these register themselves via init().
    _ "github.com/lib/pq"
    _ "github.com/go-sql-driver/mysql"
)
```

**Key lesson:** Side-effect imports look "unused" to naive tooling. They are not.

</details>

---

## Bug 4 🟡 — Compile-Time Assertion: Value vs Pointer Receiver

```go
package main

import "fmt"

type Counter struct{ n int }

func (c *Counter) String() string {
    return fmt.Sprintf("count=%d", c.n)
}

var _ fmt.Stringer = Counter{}

func main() {
    c := Counter{n: 5}
    fmt.Println(c)
}
```

<details>
<summary>Solution</summary>

**Bug:** The assertion `var _ fmt.Stringer = Counter{}` checks whether `Counter` (value type, not `*Counter`) implements `fmt.Stringer`. `String` has a pointer receiver, so only `*Counter` is a `fmt.Stringer`. Compile error:

```
cannot use Counter{} (untyped value) as fmt.Stringer value: missing method String (String has pointer receiver)
```

**Fix:** Assert against the pointer type:

```go
var _ fmt.Stringer = (*Counter)(nil)
```

Now `*Counter` is checked, which has `String()`, and the line compiles.

**Side note:** `fmt.Println(c)` will still call `String()` because `fmt` automatically takes the address when needed (when `c` is addressable, as a local variable is). But the assertion error is real and legitimate — it warns that you cannot use `Counter` (the value type) directly as a `fmt.Stringer` in interface contexts.

**Key lesson:** When choosing between `T{}` and `(*T)(nil)` for assertions, follow the receiver. Pointer receiver → use `(*T)(nil)`. Value receiver → either form works (but `(*T)(nil)` is broader: a pointer type's method set includes both pointer- and value-receiver methods).

</details>

---

## Bug 5 🟡 — Receiver Discarded, Then Method "Calls" It

```go
package main

import "fmt"

type Greeter struct{ name string }

func (_ *Greeter) Greet() {
    fmt.Println("hello,", name) // intent: print g.name
}

func main() {
    g := &Greeter{name: "Ada"}
    g.Greet()
}
```

<details>
<summary>Solution</summary>

**Bug:** Two problems:

1. The method receiver is `_`, so the receiver value is unreachable inside the method.
2. The body references a free variable `name`, which is undefined at this scope. Compile error:

```
./main.go:8:34: undefined: name
```

The author probably wrote `_` for "I am too lazy to name the receiver" and forgot they would need it. The compile error is clear, but the deeper bug is the design — using `_` as a receiver when you actually need self-state is a contradiction.

**Fix:** Name the receiver:

```go
func (g *Greeter) Greet() {
    fmt.Println("hello,", g.name)
}
```

**Key lesson:** Use `_` as a receiver only when the method genuinely does not use the receiver. If you need the data, name it.

</details>

---

## Bug 6 🟡 — Confusing `_` with `nil`

```go
package main

import "fmt"

type Logger interface {
    Log(s string)
}

func use(l Logger) {
    if l == _ {
        fmt.Println("no logger")
        return
    }
    l.Log("ok")
}

func main() {
    use(nil)
}
```

<details>
<summary>Solution</summary>

**Bug:** `l == _` is not valid Go. `_` is not a value. The author confused `_` (the blank identifier) with `nil` (the typed-zero-value of a pointer or interface). The compiler refuses:

```
./main.go:11:9: cannot use _ as value
```

**Fix:** Use `nil`:

```go
if l == nil {
    fmt.Println("no logger")
    return
}
```

**Why people make this mistake:** Both `_` and `nil` represent "absence" in informal speech. They are completely different at the type-system level:

- `_` is the destination "no name" — appears only on the LHS of assignments and a few other declaration positions.
- `nil` is a value (typed zero) — appears in expressions wherever a pointer, interface, slice, map, channel, or function type is expected.

**Key lesson:** `_` discards a write. `nil` is a value you compare against.

</details>

---

## Bug 7 🟡 — Multiple `_` Pretending to Capture

```go
package main

import "fmt"

func split(s string) (string, string, string) {
    return s[:1], s[1:2], s[2:]
}

func main() {
    _, _, last := split("abcdef")
    fmt.Println(_, last) // intent: also print the second char
}
```

<details>
<summary>Solution</summary>

**Bug:** `fmt.Println(_, last)` references `_`, which is invalid. The author thought `_, _, last` "stored" the second value somewhere they could read.

```
./main.go:10:17: cannot use _ as value
```

**Fix:** Bind the second value to a real name:

```go
_, b, last := split("abcdef")
fmt.Println(b, last)
```

**Variation people sometimes try:**
```go
_, _, _ := split("abcdef") // even using all underscores
```

This compiles only as an expression statement: `_, _, _ = split("abcdef")` (with `=`, not `:=`). With `:=`, you get "no new variables on left side of :=".

**Key lesson:** If you need a value, name it. If you do not need it, `_` and forget about it.

</details>

---

## Bug 8 🟡 — Discarded Error Hides Failure

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Config struct {
    Host string `json:"host"`
    Port int    `json:"port"`
}

func loadConfig(data []byte) Config {
    var c Config
    _ = json.Unmarshal(data, &c) // discard error
    return c
}

func main() {
    cfg := loadConfig([]byte(`{"host": "localhost", "port": "not a number"}`))
    fmt.Println(cfg)
}
```

<details>
<summary>Solution</summary>

**Bug:** `json.Unmarshal` returns an error when the JSON is malformed or types do not match. Discarding the error means the caller silently gets a `Config` with zero-valued fields where parsing failed (`Port` stays 0). The program "works" but produces wrong data.

```
{localhost 0}
```

The user expected an error or a panic, not silent default-zeroing.

**Fix:** Handle the error:

```go
func loadConfig(data []byte) (Config, error) {
    var c Config
    if err := json.Unmarshal(data, &c); err != nil {
        return Config{}, fmt.Errorf("loadConfig: %w", err)
    }
    return c, nil
}
```

**Key lesson:** `_ = json.Unmarshal(...)` is almost always a bug. Bad input is a real failure mode; the error message tells you why. The blank identifier should not be a way to mute legitimate failures.

</details>

---

## Bug 9 🟡 — Compile-Time Assertion in Wrong Package

```go
// package main
package main

import (
    "fmt"
    "io"

    "example.com/mylib"
)

var _ io.Reader = (*mylib.Reader)(nil) // assertion in main

func main() {
    var r io.Reader = (*mylib.Reader)(nil)
    fmt.Println(r)
}
```

<details>
<summary>Solution</summary>

**Bug:** This compiles, but the assertion is in the wrong place. The point of a compile-time interface assertion is to **catch breakage at the package that defines the type**. By putting it in `main`, you only catch breakage when `main` recompiles. If `mylib.Reader` loses its `Read` method, every consumer of `mylib` breaks before `main` does.

The fix is to move the assertion **into the package that defines `Reader`**:

```go
// example.com/mylib/reader.go
package mylib

import "io"

type Reader struct{}

func (r *Reader) Read(p []byte) (int, error) { return 0, io.EOF }

var _ io.Reader = (*Reader)(nil) // belongs HERE, in mylib
```

Now any change to `mylib.Reader`'s method set fails to compile in `mylib` itself, before any consumer sees it.

**Key lesson:** Compile-time assertions belong with the type definition. Putting them downstream defeats their purpose.

</details>

---

## Bug 10 🔴 — Side-Effect Import in a Library Package

```go
// package mylib
package mylib

import (
    "database/sql"
    "fmt"

    _ "github.com/lib/pq"
)

func Connect(dsn string) (*sql.DB, error) {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        return nil, fmt.Errorf("mylib.Connect: %w", err)
    }
    return db, nil
}
```

A consumer imports `mylib` and finds their binary now contains the postgres driver, even though they wanted to use mysql. Worse, the binary size grew by 2MB they did not ask for.

<details>
<summary>Solution</summary>

**Bug:** The library forces every consumer to link in `lib/pq`. This is a policy decision that belongs to the **binary** (`main` package), not to a library.

**Fix 1:** Remove the blank import; let the consumer choose:

```go
package mylib

func Connect(driver, dsn string) (*sql.DB, error) {
    return sql.Open(driver, dsn)
}
```

```go
// in cmd/myapp/main.go
import _ "github.com/lib/pq"

mylib.Connect("postgres", "...")
```

**Fix 2:** Provide a sub-package per driver:

```
mylib/
  connect.go         (no driver imports)
  postgres/postgres.go (imports _ "github.com/lib/pq")
  mysql/mysql.go       (imports _ "github.com/go-sql-driver/mysql")
```

The consumer imports the sub-package they want.

**Key lesson:** Side-effect imports leak global state into every consumer. Keep them in `main` or in clearly-named opt-in sub-packages.

</details>

---

## Bug 11 🔴 — Reading "the value of `_`" From Loop

```go
package main

import "fmt"

func main() {
    nums := []int{10, 20, 30}
    for _, v := range nums {
        // ... do something with v
    }
    fmt.Println("last index:", _)
    fmt.Println("last value:", v)
}
```

<details>
<summary>Solution</summary>

**Bug:** Two unrelated errors:

1. `_` cannot be read; `Println("last index:", _)` is invalid.
2. `v` is scoped to the `for` loop; outside the loop it does not exist.

```
./main.go:9:34: cannot use _ as value
./main.go:10:35: undefined: v
```

The author may have come from a language where loop variables persist after the loop, or where `_` could be inspected.

**Fix:** Capture what you want into outer-scoped variables:

```go
var lastIdx int
var lastVal int
for i, v := range nums {
    lastIdx = i
    lastVal = v
}
fmt.Println("last index:", lastIdx)
fmt.Println("last value:", lastVal)
```

**Key lesson:** `_` does not store the value, and loop scope ends at the closing brace.

</details>

---

## Bug 12 🔴 — Mistaking `_` for an Importable Name

```go
package main

import (
    "fmt"

    _ "example.com/utils"
)

func main() {
    fmt.Println(_.Helper("x"))
}
```

<details>
<summary>Solution</summary>

**Bug:** The author thinks `_` is the package alias and they can call `_.Helper`. It is not. `import _ "example.com/utils"` means **"do not bind any name from this package"**. There is no package value to dereference.

```
./main.go:10:17: cannot use _ as value
```

**Fix:** If you want to call functions from `utils`, import it normally:

```go
import "example.com/utils"

utils.Helper("x")
```

If `utils` is needed only for its `init` side effect, the blank import is correct, but you cannot then call into the package.

**Key lesson:** Blank imports give you NOTHING from the package's namespace. They are for the side effect only.

</details>

---

## Bug 13 🔴 — Discarded Returns Across Layers

```go
package main

import "fmt"

func computeAndCheck() (int, error) {
    return 0, fmt.Errorf("bad input")
}

func wrapper() int {
    n, _ := computeAndCheck()
    return n
}

func main() {
    fmt.Println(wrapper()) // 0 — caller cannot tell why
}
```

The caller of `wrapper` cannot distinguish "n=0 is a valid answer" from "n=0 because the call failed".

<details>
<summary>Solution</summary>

**Bug:** `wrapper` swallowed the error. The bug is not at the `_` — it is at the design of `wrapper`. `wrapper` lost information.

**Fix:** Propagate:

```go
func wrapper() (int, error) {
    return computeAndCheck()
}
```

Or handle:

```go
func wrapper() int {
    n, err := computeAndCheck()
    if err != nil {
        log.Printf("computeAndCheck failed: %v", err)
        return -1 // or some sentinel
    }
    return n
}
```

**Key lesson:** Discarding an error inside a wrapper hides the failure from callers. If the caller cannot proceed safely without knowing about the error, propagate it.

</details>

---

## Bug 14 🔴 — Padding Field Position Mistake

```go
package main

import (
    "fmt"
    "unsafe"
)

type Counter struct {
    _ [56]byte // padding before A?
    A uint64
    B uint64
}

func main() {
    c1 := Counter{}
    c2 := Counter{}
    fmt.Println(unsafe.Sizeof(c1), &c1.A, &c1.B, &c2.A)
}
```

The author intended to put `A` and `B` on separate cache lines to avoid false sharing. They added padding **before** `A` instead of **between** `A` and `B`. The fields `A` and `B` still share a cache line.

<details>
<summary>Solution</summary>

**Bug:** The padding `_ [56]byte` is at offset 0; `A` follows at offset 56; `B` follows at offset 64. Although `A` and `B` are 8 bytes apart, they may STILL straddle a cache-line boundary depending on the alignment of `c1` itself. Worse, every instance has 56 bytes of wasted space at the start.

**Fix:** Pad **between** the fields:

```go
type Counter struct {
    A uint64
    _ [56]byte // pad to fill the 64-byte cache line containing A
    B uint64
    _ [56]byte // pad to fill the line for B (defensive against neighbors)
}
```

Now offset of `A` is 0, offset of `B` is 64. They are guaranteed on different cache lines (assuming `c1` itself is at least 8-byte aligned, which it is).

**Key lesson:** Padding placement matters. Put padding between hot fields, not before them. The cache-line size on x86 is 64 bytes; on ARM64 (Apple silicon) it is often 128.

</details>

---

## Bug 15 🔴 — Compile-Time Assertion with Generic Constraint

```go
package main

type Container[T any] interface {
    Get() T
}

type IntBox struct{ v int }
func (b *IntBox) Get() string { return "" }

var _ Container[int] = (*IntBox)(nil)

func main() {}
```

<details>
<summary>Solution</summary>

**Bug:** `IntBox.Get` returns `string`, but `Container[int]` requires `Get() int`. The compile-time assertion exists precisely to catch this; the compiler reports:

```
*IntBox does not implement Container[int] (wrong type for method Get)
    have Get() string
    want Get() int
```

The bug is in the `Get` method, not the assertion. The assertion correctly flags the mismatch.

**Fix:** Either correct the method signature to match the intended interface:

```go
func (b *IntBox) Get() int { return b.v }
```

…or change the interface parameterization to match the type:

```go
var _ Container[string] = (*IntBox)(nil)
```

…depending on what `IntBox` is actually meant to do.

**Key lesson:** This is the assertion working as intended — catching a bug at compile time. The "bug" is that without the assertion, the mismatch would surface later, possibly at runtime.

</details>

---

## 16. Summary of Common Bug Categories

1. **Reading from `_`** — Always a compile error.
2. **Treating `_` as a name across statements** — There is no continuity.
3. **Removing a side-effect import** thinking it is unused — Drivers and decoders register via `init`.
4. **Wrong receiver kind in compile-time assertions** — Use `(*T)(nil)` for pointer-receiver methods.
5. **`_` shadowing illusion** — `_` cannot be shadowed because it is not a binding.
6. **Receiver discard then accessing self** — Pick named receiver if you need it.
7. **Confusing `_` with `nil`** — They are different categories.
8. **Discarding errors that mattered** — Especially `json.Unmarshal`, `os.Remove` when correctness matters.
9. **Side-effect import in a library package** — Belongs in `main`.
10. **Padding placement mistakes** — Pad between hot fields, not at the start.

If you see `_` in a code review, ask: "Why is this discarded?" If the author cannot answer cleanly, the `_` probably hides a bug.
