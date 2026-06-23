# Go fmt — Find the Bug

## Instructions

Each exercise contains buggy Go code. Identify the bug, explain
why, and provide the corrected code. Difficulty: 🟢 Easy,
🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — %d on a String

```go
name := "Ada"
fmt.Printf("Hello, %d\n", name)
```

<details>
<summary>Solution</summary>

`%d` is the integer verb but `name` is a `string`. Output:

```
Hello, %!d(string=Ada)
```

`go vet` warns at build time:
```
Printf format %d has arg name of wrong type string
```

Fix: `fmt.Printf("Hello, %s\n", name)` (or `%v`).

`vet` catches verb/argument mismatches. Run it in CI; treat
warnings as errors.
</details>

---

## Bug 2 🟢 — %s on a Struct With No Stringer

```go
type User struct{ Name string; Age int }
u := User{Name: "Ada", Age: 36}
fmt.Printf("%s\n", u)
```

<details>
<summary>Solution</summary>

`%s` on a struct without `String()` falls back to a default format:

```
{Ada 36}
```

Fix — choose your representation:
```go
fmt.Printf("%v\n", u)   // {Ada 36}
fmt.Printf("%+v\n", u)  // {Name:Ada Age:36}
// Or implement Stringer
func (u User) String() string { return u.Name }
```

For types you print or log, define `String()`.
</details>

---

## Bug 3 🟢 — %v on a Nil Interface

```go
var err error
fmt.Printf("error: %v\n", err)
```

<details>
<summary>Solution</summary>

Output: `error: <nil>`. This is **not** the same as a nil pointer
of a concrete type:

```go
var p *MyError      // typed nil
var e error = p     // wraps typed nil
fmt.Printf("%v\n", e)   // <nil> or panic if Error() doesn't nil-check
fmt.Println(e == nil)   // false! the interface has a type
```

Always check `err != nil` before formatting an error. A typed nil
prints whatever the type's `String()`/`Error()` returns — which
might panic if the method dereferences without a nil guard.
</details>

---

## Bug 4 🟢 — %w in Sprintf

```go
inner := errors.New("inner")
msg := fmt.Sprintf("outer: %w", inner)
fmt.Println(msg)
```

<details>
<summary>Solution</summary>

Output: `outer: %!w(*errors.errorString=&{inner})`.

`%w` is recognised **only** by `fmt.Errorf`. In `Sprintf` it falls
back to a malformed-verb placeholder, and there's no chain — the
result is a string, not an error.

Fix:
```go
err := fmt.Errorf("outer: %w", inner)
fmt.Println(err)                // outer: inner
fmt.Println(errors.Unwrap(err)) // inner
```

`go vet` and `errorlint` both catch this.
</details>

---

## Bug 5 🟡 — Stringer Infinite Recursion

```go
type M struct{ X, Y int }
func (m M) String() string { return fmt.Sprintf("%v", m) }
fmt.Println(M{1, 2})
```

<details>
<summary>Solution</summary>

`%v` of `M` calls `M.String()`, which calls `Sprintf("%v", m)`, which
calls `String()` again. Stack overflow:

```
runtime: goroutine stack exceeds 1000000000-byte limit
fatal error: stack overflow
```

Fix 1 — explicit field references:
```go
func (m M) String() string { return fmt.Sprintf("M{X:%d, Y:%d}", m.X, m.Y) }
```

Fix 2 — alias trick (strips the method):
```go
func (m M) String() string {
    type alias M
    return fmt.Sprintf("%+v", alias(m))
}
```

`vet` does NOT catch this. Add a unit test that calls `String()`.
</details>

---

## Bug 6 🟡 — Pointer Receiver Stringer on Value

```go
type T struct{ V int }
func (t *T) String() string { return fmt.Sprintf("T(%d)", t.V) }

t := T{V: 42}
fmt.Println(t)  // {42}
fmt.Println(&t) // T(42)
```

<details>
<summary>Solution</summary>

`String()` has a pointer receiver. `T` (a value) doesn't implement
`Stringer`; only `*T` does. So `fmt.Println(t)` falls back to the
default `{42}`.

Fix — value receiver:
```go
func (t T) String() string { return fmt.Sprintf("T(%d)", t.V) }
```

Define `String()` on the value receiver unless the type is meant
to be used only by pointer (rare for small structs). Same rule
applies to `Format` and `GoString`.
</details>

---

## Bug 7 🟡 — Width Modifier Misuse

```go
fmt.Printf("%5d\n", "hello")
```

<details>
<summary>Solution</summary>

Output: `%!d(string=hello)`. Width applies only after type-checking.

For strings, width is min chars and precision is max chars:
```go
fmt.Printf("%5s\n", "hi")     //    hi
fmt.Printf("%.3s\n", "hello") // hel
fmt.Printf("%5.3s\n", "hello") //   hel
```

Width and precision have different meanings per verb. Read the
verb table.
</details>

---

## Bug 8 🟢 — Forgetting to Escape %

```go
fmt.Printf("100%\n")
```

<details>
<summary>Solution</summary>

Output: `100%!(NOVERB)`. `%\n` parses as a malformed verb.

Fix: double the `%`: `fmt.Printf("100%%\n")` → `100%`.

`vet` catches this.
</details>

---

## Bug 9 🟡 — Println in a Hot Loop

```go
items := make([]int, 1_000_000)
for _, v := range items {
    fmt.Println("item:", v)
}
```

<details>
<summary>Solution</summary>

`Println` has hidden costs in tight loops:
1. Allocating an `[]any` for the variadic args.
2. Boxing `v` into an `any` (alloc if outside small-int range).
3. The `os.Stdout` mutex lock per call.
4. Kernel write per line (no buffering by default).

For 1M iterations: ~10s, ~3M allocs, ~200 MB of GC pressure.

Fix 1 — buffered writer:
```go
bw := bufio.NewWriterSize(os.Stdout, 1<<20)
defer bw.Flush()
for _, v := range items { fmt.Fprintln(bw, "item:", v) }
```

Fix 2 — `slog.Debug` (zero-alloc handler).
Fix 3 — don't log in a hot loop. Aggregate first.

`fmt.Println` is interactive-output speed; 1M/sec is wrong tooling.
</details>

---

## Bug 10 🟡 — %q / %v on Bytes vs Strings

```go
s := "hello\nworld"
b := []byte("hello\nworld")
fmt.Printf("%q\n", s)
fmt.Printf("%q\n", b)
```

<details>
<summary>Solution</summary>

Both produce `"hello\nworld"` — `%q` treats `[]byte` and `string`
identically (both go through `strconv.Quote`).

The actual gotcha is `%v` on `[]byte`:
```go
b := []byte("Go")
fmt.Printf("%v\n", b)  // [71 111]   ← decimal byte values
fmt.Printf("%s\n", b)  // Go         ← string view
```

Code that does `%v` on `[]byte` expecting the string is a common
bug. Use `%s` or convert with `string(b)`.

Hex variants:
```go
fmt.Printf("%x\n", "Go")               // 476f
fmt.Printf("% x\n", []byte("Go"))      // 47 6f
fmt.Printf("%X\n", []byte{0xde, 0xad}) // DEAD
```
</details>

---

## Bug 11 🟡 — Custom Error That Loses %w

```go
type AppError struct{ Op string; Err error }

func (e *AppError) Error() string {
    return fmt.Sprintf("%s: %v", e.Op, e.Err)
}

_, ioErr := os.Open("/no/such")
err := &AppError{Op: "load", Err: ioErr}
fmt.Println(errors.Is(err, fs.ErrNotExist)) // false
```

<details>
<summary>Solution</summary>

`AppError` doesn't implement `Unwrap()`. `errors.Is` walks the chain
via `Unwrap`; without it, the chain ends at `AppError`.

Fix:
```go
func (e *AppError) Unwrap() error { return e.Err }
```

After: `errors.Is(err, fs.ErrNotExist)` returns `true`.

A custom error that wraps another **must** implement `Unwrap()`,
or use `fmt.Errorf("...: %w", inner)` directly.
</details>

---

## Bug 12 🔴 — User Input as Format String

```go
msg := os.Args[1]
fmt.Printf(msg)
```

<details>
<summary>Solution</summary>

`msg` is user-controlled. Passing `%s %d %x %v` causes `fmt` to
look for arguments and emit `%!s(MISSING)` etc. Not memory-unsafe
in Go (unlike C), but:
- Leaks verbose output the developer didn't intend.
- User-controlled formatting in logs.
- Confuses log parsers.

Fix — `Print` for literal output, or `%s` to constrain:
```go
fmt.Print(msg)
fmt.Printf("%s", msg)
```

`staticcheck SA1006` catches this. Format strings must be constants.
</details>

---

## Bug 13 🟡 — Missing Argument Silent

```go
fmt.Printf("user=%s id=%d\n", "ada")
```

<details>
<summary>Solution</summary>

Output: `user=ada id=%!d(MISSING)`. `fmt` doesn't error — it
inserts a placeholder and continues, so the bug may slip into logs.

`vet` catches it at compile time:
```
Printf format %d reads arg #2, but call has 1 arg
```

Always run `vet`; always fix `printf` warnings.
</details>

---

## Bug 14 🔴 — fmt.Errorf With Multiple %w and Nil

```go
var cleanupErr error // nil
primary := errors.New("primary")
err := fmt.Errorf("step: %w; cleanup: %w", primary, cleanupErr)
```

<details>
<summary>Solution</summary>

Since Go 1.20, `Errorf` panics if any argument bound to `%w` is
`nil`:
```
panic: %w error operand cannot be nil
```

Fix — guard, or use `errors.Join` (silently ignores nil):
```go
if cleanupErr != nil {
    err = fmt.Errorf("step: %w; cleanup: %w", primary, cleanupErr)
} else {
    err = fmt.Errorf("step: %w", primary)
}
// or
err = errors.Join(primary, cleanupErr)
```

Multiple `%w` requires non-nil errors. `errors.Join` is safer for
collected errors.
</details>

---

## Bug 15 🟡 — Println Adds Spaces Where You Don't Want

```go
fmt.Println("price=", 99) // price= 99   ← extra space
```

<details>
<summary>Solution</summary>

`Println` always adds a space between operands.

Fix — `Printf` for control:
```go
fmt.Printf("price=%d\n", 99)
```

Subtle: `Print` only adds spaces between two non-string args:
```go
fmt.Print("a", 1)   // a1
fmt.Print(1, 2)     // 1 2
fmt.Print("a", "b") // ab
```
</details>

---

## Bug 16 🔴 — Format That Panics on nil

```go
type N struct{ V int }
func (n *N) String() string { return fmt.Sprintf("N(%d)", n.V) }

var p *N
fmt.Println(p)
```

<details>
<summary>Solution</summary>

`String()` dereferences `n.V` without nil-checking. `fmt.Println(p)`
with `p == nil` calls `(*N)(nil).String()`, which nil-derefs.

`fmt` recovers from panics inside `String()` and prints:
```
%!v(PANIC=String method: runtime error: invalid memory address...)
```

Don't rely on this. Nil-check inside `String()`:
```go
func (n *N) String() string {
    if n == nil { return "<nil N>" }
    return fmt.Sprintf("N(%d)", n.V)
}
```

Pointer-receiver methods that may be called on nil must nil-check.
</details>

---

## Summary: 10 Mandated Bugs Coverage

| # | Bug | Where |
|---|-----|-------|
| 1 | `%d` on string | Bug 1 |
| 2 | `%s` on non-Stringer struct | Bug 2 |
| 3 | `%v` on nil interface | Bug 3 |
| 4 | `%w` in Sprintf | Bug 4 |
| 5 | Stringer infinite recursion | Bug 5 |
| 6 | Pointer-receiver Stringer on value | Bug 6 |
| 7 | Width modifier misuse | Bug 7 |
| 8 | Forgetting to escape `%` | Bug 8 |
| 9 | Println in hot loop | Bug 9 |
| 10 | `%q`/`%v` on bytes vs strings | Bug 10 |

Plus 6 bonus production traps: missing `Unwrap`, format-string
injection, missing argument, multiple `%w` with nil, `Println`
spacing, nil-receiver String panic.

First line of defense: `go vet`. Second: `errorlint` and
`staticcheck`. Third: a habit of running every new `String()`
through a `fmt.Println` test before shipping.
