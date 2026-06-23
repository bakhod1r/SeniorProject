# Go Blank Identifier — Junior Level

## 1. Introduction

### What is it?
The **blank identifier** is the single underscore character `_`. It is a special name in Go that represents an **anonymous, write-only "destination"**. You write into it whenever you have a value the language forces you to bind a name to, but you have no use for that value.

`_` is **not a normal variable**. You cannot read from it, you cannot take its address, and you cannot pass it as a value. Each occurrence of `_` is independent — there is no single underlying storage location.

### How to use it?
```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // Discard one of two return values.
    n, _ := strconv.Atoi("42")
    fmt.Println(n) // 42

    // Discard the index in a range loop.
    sum := 0
    for _, v := range []int{1, 2, 3, 4} {
        sum += v
    }
    fmt.Println(sum) // 10
}
```

The first `_` throws away the `error` returned by `strconv.Atoi`. The second `_` throws away the loop index. Neither value is stored anywhere — the compiler simply does not bind them to a real name.

### Why does Go need this?
Go is strict about unused names. Every imported package and every declared local variable must be used, or the compiler refuses to build. That rule is great for catching dead code, but it would be painful in two situations:
1. A function returns multiple values and you only need some of them.
2. A `range` clause produces an index plus a value, and you only need one of them.

The blank identifier is the official escape hatch. It says to the compiler: "I know a value is here. I am intentionally throwing it away. Stop nagging me."

### How is `_` different from a regular variable?
A regular variable has a memory location, a type, and a name you can refer to later. The blank identifier has none of these:

```go
x := 10
fmt.Println(x) // OK — read x

_ = 10
fmt.Println(_) // COMPILE ERROR: cannot use _ as value
```

Each `_` you write is a brand-new "no-name slot" that exists only for the duration of the assignment. You cannot reach back and ask "what was the last `_`?" — there is no such thing.

---

## 2. Prerequisites

Before reading this section, make sure you understand:

- Variable declaration with `var` and short declaration `:=` (topic 2.1.1).
- Multiple assignment and multiple return values from functions.
- Basic `import` statements and the rule that unused imports fail to compile.
- `range` over slices, arrays, maps, and strings.
- Interfaces at a conceptual level — you do not need to write your own yet, but you will see them mentioned (topic 2.7 covers them in depth).
- The idea of a package-level `init` function (topic 2.5).

You do not need any concurrency, generics, or reflection knowledge for this section.

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| blank identifier | The token `_`; a write-only sink that discards the assigned value |
| discard | To throw away a value the language forces you to receive |
| side-effect import | An import written `import _ "path"` so the package's `init` runs but no names are bound |
| compile-time assertion | Code that fails at compile time when an invariant is violated, often `var _ I = (*T)(nil)` |
| padding | Extra unused bytes inserted into a struct, sometimes spelled `_ [N]byte` |
| receiver | The value before the method name, e.g. the `r` in `func (r *T) M()` |
| init function | A function named `init` that runs once when the package is loaded |
| unused-name error | The Go compiler error you get when a declared local variable or import is never referenced |
| destination of an assignment | The left-hand side of `=` or `:=`; this is the only place `_` is allowed in expressions |

---

## 4. Core Concepts

### 4.1 Discarding Return Values

Many Go functions return more than one value. The most common pattern is `(result, error)`. When you have already proven the call cannot fail (or you are in a quick prototype), you can drop the error with `_`.

```go
import "strconv"

n, _ := strconv.Atoi("42") // we trust the literal "42"
```

The same applies to functions returning a value plus a "comma-ok" result, like map lookup or type assertion:

```go
m := map[string]int{"a": 1}
v, _ := m["a"]   // v == 1; we don't care whether the key was present

var i any = "hi"
s, _ := i.(string) // s == "hi"; we don't care if the assertion failed
```

You can also discard the value and keep the second return:

```go
_, err := os.Open("data.txt")
if err != nil {
    log.Fatal(err)
}
```

Here we open a file purely to check whether opening succeeds — we throw away the file handle (a leak in real code, but illustrative).

### 4.2 Discarding the Index in `range`

`range` over a slice or array yields `(index, value)`. If you only want the value:

```go
nums := []int{10, 20, 30}
for _, v := range nums {
    fmt.Println(v)
}
```

If you only want the index:

```go
for i := range nums {
    fmt.Println(i)
}
```

Note that `range` lets you simply **omit** the second item — you do not have to write `_` on the right side. But on the left side of multiple assignment in general, omitting is not allowed; you write `_`.

For a map, `range` yields `(key, value)`:

```go
m := map[string]int{"a": 1, "b": 2}
for _, v := range m {
    fmt.Println(v)
}
```

For a string, `range` yields `(byteIndex, rune)`:

```go
for _, r := range "héllo" {
    fmt.Printf("%c\n", r)
}
```

### 4.3 Side-Effect Imports

Sometimes a package exists not to expose names you call, but to **register itself** with another package via an `init` function. The classic example is database drivers:

```go
import (
    "database/sql"
    _ "github.com/lib/pq" // registers the "postgres" driver
)

db, err := sql.Open("postgres", "...")
```

Without the underscore, the compiler would complain: "imported and not used: github.com/lib/pq". With the underscore, the import is allowed even though no names from `lib/pq` appear in your code. The package's `init` function still runs, and that is exactly what you want — the driver registers itself with the `database/sql` registry, and `sql.Open("postgres", ...)` then works.

Other classic side-effect imports:

```go
import _ "image/png"               // registers PNG decoder
import _ "image/jpeg"              // registers JPEG decoder
import _ "net/http/pprof"          // registers /debug/pprof/* HTTP handlers
import _ "expvar"                  // registers /debug/vars HTTP handler
```

The shape is always the same: someone else's package keeps a registry; this package's `init` adds an entry. You import it for the side effect, not for the names.

### 4.4 Compile-Time Interface Assertions

This is a small but powerful pattern. Suppose you have an interface `Stringer` (`fmt.Stringer`) and a struct `User`:

```go
type User struct{ name string }

func (u User) String() string { return u.name }
```

You believe `User` implements `Stringer`. To make the compiler **prove it for you**, write:

```go
var _ fmt.Stringer = User{}
```

Read the line right-to-left:
1. Construct a `User{}`.
2. Assign it to a variable of type `fmt.Stringer`.
3. The variable's name is `_`, so the value is immediately discarded.

The assignment forces an interface conversion at compile time. If `User` does not implement `Stringer`, you get a compile error pointing at exactly this line — long before the program runs and long before any other site that uses `User` as a `Stringer`.

For pointer-receiver interfaces, use a typed nil:

```go
var _ io.Reader = (*MyReader)(nil)
```

This avoids constructing a real `MyReader` value. We will revisit this pattern in middle and senior tiers.

### 4.5 Other Useful Spots

- **Method receivers you do not use.** `func (_ *Logger) Print(s string)` says the method does not need `self`. Rare; usually a sign you should refactor, but legal.
- **Struct padding.** Some low-level code uses anonymous fields named `_` to force a specific memory layout: `_ [4]byte`. You will see this in cache-line alignment work. Topic 4.x covers struct layout in detail.
- **Throwaway type parameters or names** in generic code (advanced; not used in this section).

---

## 5. Common Mistakes

### 5.1 Trying to Read From `_`

```go
_, err := f()
fmt.Println(_) // COMPILE ERROR: cannot use _ as value
```

The compiler treats `_` as write-only. The fix: assign to a real name if you intend to use the value.

### 5.2 Using `_` to Silence the "Unused Variable" Error Lazily

```go
x := computeExpensive()
_ = x // makes the compiler happy
```

This compiles, but it usually means you forgot to actually use `x`. The compiler's "declared and not used" error exists to catch dead code — silencing it with `_ = x` defeats the check. Only do this when there is a documented reason (rare). If you want to keep the call for its side effect, write `_ = computeExpensive()` directly.

### 5.3 Forgetting the Side-Effect Import

A new contributor sees:

```go
import _ "github.com/lib/pq"
```

…and thinks "we never use `pq`, the underscore looks weird, it must be a leftover" — and deletes it. Suddenly `sql.Open("postgres", ...)` returns "unknown driver: postgres" at runtime. Always check whether an underscore import is registering a driver, decoder, or HTTP handler before removing it.

### 5.4 Ignoring an `error` That Mattered

```go
_, _ = os.Remove(path)
```

If the path was important, swallowing the error hides bugs. The blank identifier should not be a way to silence linters. Only discard an error when you have thought about what it could mean and decided you genuinely do not care (e.g. best-effort cleanup in a defer).

### 5.5 Reusing `_` as If It Were a Variable

```go
_ := readToken()
fmt.Println(_) // INVALID
```

Two errors here: you cannot use `:=` to "declare" `_` (you can write `_ := ...` legally as throwaway, but) you cannot then reference it. Each `_` is independent; there is no continuity.

### 5.6 Forgetting That `_ = expr` Still Evaluates `expr`

```go
_ = expensiveCall()
```

This **runs** `expensiveCall()`. The blank identifier discards the result, not the work. If you want to skip the work entirely, comment the line out.

---

## 6. Mini Exercises

Try these in the [Go Playground](https://go.dev/play/) before reading the answers.

### Exercise 1 — Discard the error
Print only the integer parsed from "100", ignoring the error.

<details>
<summary>Solution</summary>

```go
n, _ := strconv.Atoi("100")
fmt.Println(n)
```
</details>

### Exercise 2 — Sum a slice ignoring indexes
Given `nums := []int{2, 4, 6}`, print the sum.

<details>
<summary>Solution</summary>

```go
sum := 0
for _, v := range nums {
    sum += v
}
fmt.Println(sum) // 12
```
</details>

### Exercise 3 — Side-effect import
Write the import line that registers the PostgreSQL driver for `database/sql` without exposing any names.

<details>
<summary>Solution</summary>

```go
import _ "github.com/lib/pq"
```
</details>

### Exercise 4 — Compile-time interface assertion
You have:
```go
type Beep struct{}
func (b Beep) String() string { return "beep" }
```
Add one line that makes the compiler verify `Beep` implements `fmt.Stringer`.

<details>
<summary>Solution</summary>

```go
var _ fmt.Stringer = Beep{}
```
</details>

### Exercise 5 — Spot the mistake
What is wrong here?
```go
_, err := json.Marshal(v)
fmt.Println(_, err)
```

<details>
<summary>Solution</summary>

You cannot read `_`. Use a real name:
```go
data, err := json.Marshal(v)
fmt.Println(data, err)
```
</details>

### Exercise 6 — Receiver discard
Write a method `Ping` on `*Server` that prints "pong" and does not access the receiver.

<details>
<summary>Solution</summary>

```go
func (_ *Server) Ping() {
    fmt.Println("pong")
}
```

Idiomatically you would write `func (s *Server) Ping()` and just not reference `s`. Both forms compile.
</details>

### Exercise 7 — Map lookup without checking presence
Read the value at key `"role"` from `m map[string]string`, ignoring whether the key was present.

<details>
<summary>Solution</summary>

```go
role, _ := m["role"]
```

In fact, the comma-ok form is optional for maps; `role := m["role"]` returns the zero value if absent. Use the `_` form when you want to be explicit that you considered the presence check and decided to ignore it.
</details>

### Exercise 8 — Iterate keys only
Print each key of `m := map[string]int{"a":1, "b":2}` (order undefined).

<details>
<summary>Solution</summary>

```go
for k := range m {
    fmt.Println(k)
}
```

`range` over a map with one variable returns keys.
</details>

### Exercise 9 — Type assertion discard
Given `var x any = 7`, assert it as `int` and ignore failure.

<details>
<summary>Solution</summary>

```go
n, _ := x.(int)
fmt.Println(n)
```
</details>

### Exercise 10 — Package init side effect
Imagine package `colors` has `func init() { register("red") }`. Show the import line that triggers it without exposing names.

<details>
<summary>Solution</summary>

```go
import _ "example.com/colors"
```
</details>

---

## 7. Cheat Sheet

| Pattern | Example | Meaning |
|---------|---------|---------|
| Discard a return value | `n, _ := f()` | Keep `n`, throw away the second result |
| Keep only the second return | `_, err := f()` | Throw away the first result |
| Range value only | `for _, v := range s` | Discard index |
| Range index only | `for i := range s` | Discard value (no `_` needed) |
| Map lookup with explicit discard | `v, _ := m[k]` | Ignore presence flag |
| Type assertion with explicit discard | `s, _ := x.(string)` | Ignore failure flag |
| Side-effect import | `import _ "pkg"` | Run `init`; expose no names |
| Compile-time interface check | `var _ I = (*T)(nil)` | Force the compiler to verify `*T` implements `I` |
| Method receiver discard | `func (_ *T) M()` | Method ignores its receiver |
| Struct padding | `_ [4]byte` | Insert 4 bytes of unused space |

**Things `_` is NOT:**
- A real variable (no storage, no address).
- A name you can read from (`fmt.Println(_)` fails to compile).
- The same across multiple uses (`_ := 1; _ := 2` declares two unrelated sinks).
- A way to silence the compiler honestly (`_ = unused` hides bugs).
- The same as `nil` (one is a write-only sink; the other is a typed zero value).

**Spec link:** https://go.dev/ref/spec#Blank_identifier (Go 1.0).

**Next steps:** Read `middle.md` for design patterns built around `_`, `senior.md` for compiler internals, and `find-bug.md` for mistakes that bite real codebases.

---

## 8. Extended Walkthroughs

### 8.1 The "Two-Return Pattern" Tour

Many standard-library and third-party functions return `(value, error)`. Here is a tour of how `_` shows up across them.

```go
// strconv: parse a string to int
n, _ := strconv.Atoi("42")
// strings: lookup is by index, no error, but...

// json.Marshal returns ([]byte, error)
data, _ := json.Marshal(struct{ A int }{A: 1})

// http.Get returns (*http.Response, error)
resp, _ := http.Get("https://example.com")
defer resp.Body.Close() // NOTE: dangerous if err != nil — resp may be nil!
```

The last example shows why `_` for an error is a sharp tool. In production, `http.Get` failing returns `(nil, err)`; calling `resp.Body.Close()` on nil panics. The `_` in `resp, _ := http.Get(...)` is wrong here. Do this instead:

```go
resp, err := http.Get("https://example.com")
if err != nil {
    return err
}
defer resp.Body.Close()
```

The lesson: `_` for errors is fine when you have **proven** the call cannot fail in this context (e.g., parsing a literal). Otherwise, name and check.

### 8.2 The "Comma-Ok" Tour

Three places where Go uses `(value, ok)`:

```go
// 1. Map lookup
v, ok := m["key"]
v, _ := m["key"] // discard ok; v is the zero value if key absent

// 2. Type assertion
s, ok := iface.(string)
s, _ := iface.(string) // discard ok; s is "" if assertion fails

// 3. Channel receive
v, ok := <-ch
v, _ := <-ch // discard ok; v is the zero value if channel closed
```

In all three, `_` says "I do not care whether the operation succeeded — give me the value (or its zero) regardless".

For maps and assertions, the comma-ok form is optional (`v := m["key"]` returns the zero value if absent; `v := iface.(string)` panics if the assertion fails — `_` form is safer).

### 8.3 The "Init Side Effect" Tour

Side-effect imports are the shape:

```go
import _ "package/path"
```

Where they appear in real code:

```go
// 1. Database drivers
import _ "github.com/lib/pq"
import _ "github.com/go-sql-driver/mysql"

// 2. Image decoders
import _ "image/png"
import _ "image/jpeg"
import _ "image/gif"

// 3. Profiling endpoints
import _ "net/http/pprof"

// 4. Public variable exporter
import _ "expvar"

// 5. Crypto registrations
import _ "golang.org/x/crypto/blake2b"
```

In every case, the imported package's `init` function adds an entry to a registry maintained by another package. The consuming code does not name anything from the imported package; it only relies on the registration's effect.

### 8.4 The "Compile-Time Assertion" Tour

The line `var _ I = (*T)(nil)` is one of the most useful patterns in Go libraries. Examples:

```go
// fmt.Stringer is implemented by *MyType
var _ fmt.Stringer = (*MyType)(nil)

// io.Reader is implemented by *FileReader
var _ io.Reader = (*FileReader)(nil)

// sql.Driver is implemented by *Driver
var _ sql.Driver = (*Driver)(nil)
```

Read each line as: "compile fails here if the assertion is wrong". You get error reporting at the type definition rather than at distant call sites.

For value-receiver implementations, you can use `T{}` instead of `(*T)(nil)`:

```go
type Color string
func (c Color) String() string { return string(c) }
var _ fmt.Stringer = Color("red")
```

Both forms are fine. `(*T)(nil)` is a stricter check (it covers both pointer- and value-receiver methods).

---

## 9. Frequently Asked Beginner Questions

**Q: Is `_` a valid variable name?**

No. It is a special predeclared identifier. You cannot reassign or read it. A "variable" in Go has a name, a type, and storage — `_` has only a type-checker role.

**Q: Can I write `var x _ = 5`?**

No. `_` is not a type. The blank identifier appears as a name, never as a type.

**Q: Why does Go force me to use unused variables anyway?**

Go's design philosophy: dead code is a bug. Unused locals are almost always either (a) typos, (b) leftovers from a refactor, or (c) lazy programming. The compile error catches them. The blank identifier is the official escape hatch when the language *forces* you to receive a value you do not want.

**Q: Are there languages where `_` works similarly?**

Yes — Erlang, Elixir, Rust, Scala, OCaml, Haskell, F# all have a wildcard pattern `_`. Go's version is most similar to OCaml's: a write-only sink, allowed in pattern-like positions, never in expression position.

**Q: Will `_ = x` make a linter happy when I forgot to use `x`?**

Sometimes. But it is bad practice. The compiler error "declared but not used" exists to catch real bugs. Silencing it with `_ = x` defeats the check. If you are mid-refactor, leave the error; finish the refactor and remove or use the variable.

**Q: How do I know whether to use `_` or just omit a return?**

If the function returns multiple values, you must receive all of them — use `_` to discard the ones you do not want.

```go
n, _ := strconv.Atoi(s) // function returns 2 values; we receive 2 slots
```

Range is special: omitting the second variable is allowed.

```go
for i := range slice  // legal: receive only index
for i, v := range slice  // legal: receive both
```

If you want only the value:

```go
for _, v := range slice // need _ here because you cannot omit the index
```

**Q: Is `_` thread-safe?**

Trivially yes — there is nothing to share. Each `_` is just a discard; no storage; no contention. Concurrency questions do not apply.

**Q: Can I use `_` in a `defer`?**

Yes:

```go
defer func() {
    _ = file.Close()
}()
```

Discards the close error (often acceptable in cleanup paths).

**Q: How does `_` interact with generics?**

Just like with non-generic code. You can discard generic returns, range over generic slices with `_`, etc. Type parameter names can be `_` (rare and useless because you cannot reference the parameter).

**Q: Can I `_ := ...` in a `for` initializer?**

```go
for i, _ := f(); i < 10; i++ {} // valid syntactically
```

Discards the second return of `f()`. Rare, but legal.

---

## 10. End-of-Section Recap

The blank identifier:

- Is a write-only discard slot.
- Has no storage, no scope, no continuity.
- Is allowed in declarations, LHS positions, range, struct fields, parameters, receivers, and import names.
- Is never allowed in expression positions.
- Comes free at runtime — zero instructions emitted.

Idiomatic uses:

1. Discard return values you do not need.
2. Discard the index in `range`.
3. Side-effect imports for driver/decoder/handler registration.
4. Compile-time interface assertions.
5. Struct padding.

Anti-patterns:

1. Reading from `_` (compile error).
2. Treating `_` as a name across statements (each occurrence is independent).
3. Removing side-effect imports thinking they are unused.
4. Discarding errors that mattered (e.g., `_ = json.Unmarshal(...)`).
5. Using `_` to silence "declared but not used" instead of fixing the underlying issue.

Move to `middle.md` next to learn how `_` becomes a deliberate design tool.
