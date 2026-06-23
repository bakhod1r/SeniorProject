# Go fmt — Junior Level

## 1. Introduction

### What is it?

The `fmt` package is Go's standard formatted-I/O package, modelled
after C's `printf` and `scanf`. You reach for it to print a value,
build a string from a template, wrap an error, or read user input.
It lives at [`pkg.go.dev/fmt`](https://pkg.go.dev/fmt) and has been
in the standard library since Go 1.0.

### How to use it?

```go
package main

import "fmt"

func main() {
    name := "Ada"
    age := 36
    fmt.Println("Hello,", name)               // Hello, Ada
    fmt.Printf("name=%s age=%d\n", name, age) // name=Ada age=36
    s := fmt.Sprintf("user-%d", age)          // returns "user-36"
    fmt.Println(s)
}
```

`Println` adds spaces between args and a trailing newline. `Printf`
adds neither — you write `\n` yourself. `Sprintf` returns the result
instead of printing it.

---

## 2. Prerequisites

- Variables, basic types (`int`, `string`, `bool`, `float64`).
- Functions and the `error` type.
- Slices, maps, and structs at a reading level.
- A rough idea of `io.Writer` (`Write([]byte) (int, error)`) — needed
  for the `Fprint*` family.

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Verb | A `%`-prefixed token in a format string (`%d`, `%s`, ...) |
| Argument | A value supplied after the format string, consumed by a verb |
| Format string | The first parameter of any `Printf`-style call |
| Width | Minimum column width, e.g. `%5d` |
| Precision | Digits after the decimal, e.g. `%.2f` |
| Stringer | Any type with a `String() string` method |
| io.Writer | Anything with `Write([]byte) (int, error)` |
| stdout | OS file descriptor 1; default destination of `Print*` |
| stderr | OS file descriptor 2; `fmt.Fprintln(os.Stderr, ...)` writes there |

---

## 4. Core Concepts

### 4.1 The Three Families

`fmt` has three families, distinguished by where the result goes.

```go
fmt.Print("hello")            // → stdout
s := fmt.Sprint("hello")      // → returns string
fmt.Fprint(os.Stderr, "hi")   // → any io.Writer
```

Each family has three variants:

| Variant | Behavior |
|---------|----------|
| `Print` | concatenate, default formatting |
| `Println` | adds spaces between args and a trailing newline |
| `Printf` | uses a format string with verbs |

That gives nine functions, plus `Errorf` (returns `error`) and the
`Scan*` family (reads input).

### 4.2 The First Five Verbs

These five cover 80% of day-one needs:

| Verb | Meaning | Example |
|------|---------|---------|
| `%v` | default format | `fmt.Printf("%v", 42)` → `42` |
| `%s` | string | `fmt.Printf("%s", "hi")` → `hi` |
| `%d` | integer (decimal) | `fmt.Printf("%d", 42)` → `42` |
| `%t` | boolean | `fmt.Printf("%t", true)` → `true` |
| `%f` | float | `fmt.Printf("%f", 1.5)` → `1.500000` |

`%v` works on any type. When in doubt, reach for `%v` first.

### 4.3 Newlines

`Println` adds a newline; `Printf` does not.

```go
fmt.Println("a", "b")  // a b\n
fmt.Printf("a b")      // a b   (no newline)
fmt.Printf("a b\n")    // a b\n
```

Forgetting `\n` in `Printf` is the most common day-one bug.

### 4.4 Many Arguments at Once

A format string consumes one argument per verb, left to right.

```go
fmt.Printf("%s is %d years old\n", "Ada", 36)
// Ada is 36 years old
```

Too few arguments yields `%!d(MISSING)`; too many yields
`%!(EXTRA <type>=<value>)`.

### 4.5 Sprintf Returns a String

```go
key := fmt.Sprintf("user:%d:name", 42) // "user:42:name"
```

The most-used member of the family inside library code.

### 4.6 Errorf Returns an error

`fmt.Errorf` is `Sprintf` plus `errors.New`:

```go
err := fmt.Errorf("bad count: %d", -1) // bad count: -1
```

The special verb `%w` (Section 4.10) wraps an existing error.

### 4.7 Fprintf Writes Anywhere

`Fprintf` takes any `io.Writer` first — stdout, stderr, files, HTTP
responses, buffers.

```go
fmt.Fprintln(os.Stderr, "warning: low disk")
fmt.Fprintf(w, "Hello %s\n", name) // w is, say, http.ResponseWriter
```

`Print` is just `Fprint(os.Stdout, ...)`.

### 4.8 Default Format with %v

`%v` picks a sensible default for any type:

```go
fmt.Printf("%v\n", []int{1,2,3})           // [1 2 3]
fmt.Printf("%v\n", map[string]int{"a":1}) // map[a:1]
```

For structs, `%v` prints values; `%+v` adds field names; `%#v` prints
Go syntax that you can paste back into code.

```go
p := struct{ X, Y int }{1, 2}
fmt.Printf("%v\n", p)   // {1 2}
fmt.Printf("%+v\n", p)  // {X:1 Y:2}
fmt.Printf("%#v\n", p)  // struct { X int; Y int }{X:1, Y:2}
```

### 4.9 String Format with %s and %q

`%s` prints a string as is; `%q` quotes it with Go-syntax escaping.

```go
fmt.Printf("%s\n", "hello\nworld")  // hello
                                    // world
fmt.Printf("%q\n", "hello\nworld")  // "hello\nworld"
```

`%q` is great for log lines because it makes whitespace visible.

### 4.10 The %w Verb (Error Wrapping)

In Go 1.13+, `fmt.Errorf` recognises `%w` to wrap an underlying
error. The result implements `Unwrap()` so `errors.Is`/`As` walk
the chain.

```go
src, err := os.Open("config.toml")
if err != nil {
    return fmt.Errorf("load config: %w", err)
}
```

`%w` only works inside `fmt.Errorf`. Using it in `Sprintf` falls
back to `%v` (see `find-bug.md`).

### 4.11 Width and Precision

Numbers between `%` and the verb specify width (minimum columns) and
precision (digits or significant figures).

```go
fmt.Printf("%5d|\n", 42)      //    42|   (right-aligned)
fmt.Printf("%-5d|\n", 42)     // 42   |   (left-aligned)
fmt.Printf("%05d|\n", 42)     // 00042|   (zero-padded)
fmt.Printf("%.2f\n", 3.14159) // 3.14
fmt.Printf("%*d\n", 5, 42)    //    42    (width as argument)
```

### 4.12 Reading Input with Scan

`Scan*` reads from stdin into pointers.

```go
var name string
var age int
fmt.Scan(&name, &age)
```

For text-mode applications prefer
[`bufio.Scanner`](../06-bufio/junior.md) — `fmt.Scan` is whitespace tokenized
and easy to misuse.

---

## 5. Real-World Analogies

**Photo printer.** `Println` is auto mode: any picture, default size.
`Printf` is manual: you choose the paper and borders. `Sprintf` is
"send to PDF": a digital file you can pass around.

**Mail-merge template.** The format string is the letter; verbs are
the placeholders; arguments fill them in. Forget one and you ship
`Hi %!s(MISSING)`.

---

## 6. Mental Models

```
fmt.Printf("%s=%d\n", k, v)
       │     │  │
       │     │  └── \n: literal newline
       │     └── %d: integer verb, consumes v
       └── %s: string verb, consumes k
```

For each verb, `fmt` uses reflection to read the matching argument.
For `Print`/`Sprint`, no format string is parsed — values use their
default format separated by spaces (or no separator for `Print`).

```
Print family
┌──────────────────────────────┐
│  Print*  → os.Stdout         │
│  Sprint* → returns string    │
│  Fprint* → io.Writer arg     │
│  Errorf  → error             │
│  Scan*   → reads stdin       │
└──────────────────────────────┘
```

---

## 7. Pros & Cons

### Pros

- One package covers stdout, stderr, files, strings, and errors.
- `%v` "just works" on any type.
- `Stringer` lets your types print themselves.
- Familiar to anyone who has used `printf`.

### Cons

- Reflection-based; slower than `strconv` for hot paths.
- Easy to misuse: wrong verb, missing argument, forgotten `\n`.
- For structured logging, prefer [`slog`](../07-slog/junior.md).
- Format strings are not type-checked at compile time (only `vet`
  catches them).

---

## 8. Use Cases

1. CLI output and progress messages.
2. Error wrapping with `fmt.Errorf("...: %w", err)`.
3. Building keys, paths, and SQL fragments with `Sprintf`.
4. Implementing `String()` on your own types (see `senior.md`).
5. Quick debugging with `%+v` and `%#v`.
6. Writing to `bytes.Buffer` or `strings.Builder`.
7. Writing to `http.ResponseWriter` in toy HTTP handlers.
8. Producing test failure messages in `t.Errorf`.

---

## 9. Code Examples

### Example 1 — Print, Println, Printf

```go
fmt.Print("a", "b", "\n")  // ab
fmt.Println("a", "b")      // a b
fmt.Printf("a%sb\n", "-")  // a-b
```

### Example 2 — Sprintf for keys

```go
func cacheKey(userID int, kind string) string {
    return fmt.Sprintf("user:%d:%s", userID, kind)
}
// cacheKey(42, "profile") → "user:42:profile"
```

### Example 3 — Errorf and wrapping

```go
func loadConfig(path string) error {
    if _, err := os.Stat(path); err != nil {
        return fmt.Errorf("load %s: %w", path, err)
    }
    return nil
}

err := loadConfig("/no/such/file")
fmt.Println(err)                            // load /no/such/file: stat ...: no such file
fmt.Println(errors.Is(err, os.ErrNotExist)) // true
```

### Example 4 — Width and precision

```go
items := []struct {
    name string
    qty  int
    cost float64
}{{"apple", 3, 0.5}, {"plum", 12, 0.25}, {"watermelon", 1, 4.0}}

for _, it := range items {
    fmt.Printf("%-12s %3d  $%6.2f\n", it.name, it.qty, it.cost)
}
// apple          3  $  0.50
// plum          12  $  0.25
// watermelon     1  $  4.00
```

### Example 5 — Fprintf to stderr

```go
func warn(format string, args ...any) {
    fmt.Fprintf(os.Stderr, "warning: "+format+"\n", args...)
}

warn("disk usage at %d%%", 92)
```

### Example 6 — Default vs %+v vs %#v

```go
type Point struct{ X, Y int }
p := Point{1, 2}
fmt.Printf("%v\n", p)   // {1 2}
fmt.Printf("%+v\n", p)  // {X:1 Y:2}
fmt.Printf("%#v\n", p)  // main.Point{X:1, Y:2}
```

### Example 7 — Scan

```go
var name string
var age int
fmt.Print("Enter name and age: ")
n, err := fmt.Scan(&name, &age)
if err != nil {
    fmt.Println("read error:", err)
    return
}
fmt.Printf("read %d values: %s, %d\n", n, name, age)
```

---

## 10. Coding Patterns

```go
// Build a key/path
url := fmt.Sprintf("/users/%d/posts/%d", userID, postID)

// Wrap an error with context
return fmt.Errorf("step %d: %w", n, err)

// Print a struct for debugging
fmt.Printf("debug: %+v\n", req)

// Print to stderr
fmt.Fprintln(os.Stderr, "fatal: missing config")

// Tabular output
fmt.Printf("%-20s %5d\n", row.Name, row.Count)
```

---

## 11. Clean Code Guidelines

1. Prefer `Println` when you don't need a format string.
2. Use `%v` when you don't care about the exact representation; use
   `%d`/`%s`/etc. when you do.
3. Always include `\n` in the format string of `Printf`.
4. Prefer `%w` for error wrapping; it preserves the chain.
5. Write to `os.Stderr` for warnings and errors, `os.Stdout` for
   normal output. Pipelines depend on this split.

```go
// Good
fmt.Fprintln(os.Stderr, "warn: retrying")
return fmt.Errorf("dial %s: %w", addr, err)

// Bad
fmt.Println("warn: retrying")              // pollutes stdout
return fmt.Errorf("dial %s: %v", addr, err) // no wrapping
```

---

## 12. Product Use / Feature Example

A CLI that summarises a directory with width-aligned columns.

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Fprintln(os.Stderr, "usage: dirsum <path>")
        os.Exit(2)
    }
    entries, err := os.ReadDir(os.Args[1])
    if err != nil {
        fmt.Fprintf(os.Stderr, "read: %v\n", err)
        os.Exit(1)
    }
    fmt.Printf("%-30s %10s\n", "name", "size")
    var total int64
    for _, e := range entries {
        info, err := e.Info()
        if err != nil { continue }
        fmt.Printf("%-30s %10d\n", e.Name(), info.Size())
        total += info.Size()
    }
    fmt.Printf("%-30s %10d\n", "TOTAL", total)
}
```

The whole UI is `fmt`. No third-party formatter needed.

---

## 13. Error Handling

`fmt.Print*` returns `(n int, err error)`; the error comes from the
underlying writer (e.g. a closed pipe). For stdout this is rare. For
network or file writers you may want to check.

```go
if _, err := fmt.Fprintln(w, "ok"); err != nil {
    return fmt.Errorf("write response: %w", err)
}
```

`fmt.Errorf` itself never fails.

---

## 14. Security Considerations

1. **Never use user input as the format string.**
   ```go
   fmt.Printf(userInput)        // BAD: arbitrary verb interpretation
   fmt.Print(userInput)         // good — literal
   fmt.Printf("%s", userInput)  // good — literal via %s
   ```
2. **Avoid logging secrets.** `%v` and `%+v` print all struct fields,
   including `Password`. Implement `String()` to redact.
3. **Sprintf-built SQL is a SQL-injection vector.** Use parameterised
   queries (`db.Query("... WHERE id=$1", id)`).

---

## 15. Performance Tips

1. `fmt.Sprintf` allocates; fine for one-off code.
2. In hot loops, `strconv.Itoa(n)` is ~3x faster than
   `fmt.Sprintf("%d", n)`.
3. For building strings from many parts, use `strings.Builder` and
   `fmt.Fprintf(&b, ...)`.
4. For long-lived services, prefer [`slog`](../07-slog/junior.md) — it
   batches and structures.

---

## 16. Metrics & Analytics

`runtime.MemStats` and `pprof` often show `fmt.Sprintf` near the top
of Go-service heap profiles. `go test -bench . -benchmem` makes it
visible:

```
BenchmarkSprintfInt-8   30000000   45 ns/op   16 B/op   2 allocs/op
BenchmarkItoa-8        100000000   12 ns/op    0 B/op   0 allocs/op
```

---

## 17. Best Practices

1. Use `%v` until you have a reason to use a specific verb.
2. Use `%w` for wrapping errors; never `%v` for that purpose.
3. Use `Sprintf` for keys; use `Builder` for hot loops.
4. Always include `\n` in `Printf` format strings.
5. Write user-visible output to `Stdout`, diagnostics to `Stderr`.
6. Implement `String() string` for types you print often.
7. Run `go vet` — its `printf` analyzer catches almost every
   verb/argument mismatch.

---

## 18. Edge Cases & Pitfalls

```go
// 1. Wrong verb for the type
fmt.Printf("%d\n", "hi")        // %!d(string=hi) — use %s

// 2. Missing argument
fmt.Printf("%s %d\n", "hi")     // hi %!d(MISSING)

// 3. Extra argument
fmt.Printf("%s\n", "hi", 99)    // hi\n%!(EXTRA int=99)

// 4. Forgotten \n — output glues to next line
fmt.Printf("ready")

// 5. Println adds a space before "99"
fmt.Println("price=", price)    // price= 99

// 6. User input as format
fmt.Printf(input)               // BAD; use fmt.Print(input)

// 7. %w in Sprintf — silently treated as %v
s := fmt.Sprintf("err: %w", err)

// 8. Forgetting to escape %
fmt.Printf("100%\n")            // %!\n(MISSING) — use 100%%
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| `%d` on a string | Use `%s` (or `%v`) |
| `%w` in `Sprintf` | Use `%v`, or move to `Errorf` |
| Missing `\n` in `Printf` | Add it |
| User input as format | `fmt.Print(input)` or `%s` |
| Forgetting to double `%` | `100%%` |
| `Sprintf` in a tight loop | `strconv` or `Builder` |

---

## 20. Common Misconceptions

**"`Println` and `Printf` are the same."** `Println` adds spaces
between arguments and a trailing newline; `Printf` does neither.

**"`%v` and `%s` are interchangeable."** `%v` falls back to a default
format for any type. `%s` requires the value be a string or implement
`String()`/`Error()`/`MarshalText()`.

**"`fmt.Sprintf` is fast."** It allocates and reflects; ~3x slower
than `strconv` for primitives.

**"`%w` is a real verb."** `%w` is a marker recognised only by
`fmt.Errorf`; elsewhere it falls back to `%v`.

**"`Print` and `Println` add spaces the same way."** `Print` adds
spaces only between two non-string arguments; `Println` always does.

---

## 21. Tricky Points

1. `Print` and `Println` differ in spacing rules.
2. `%v` calls `String()`; `%s` does too — but not on integers.
3. `%w` only works in `Errorf`.
4. `%T` prints the type, not the value.
5. `%v` of a `nil` interface is `<nil>`.

---

## 22. Test

```go
func TestSprintf(t *testing.T) {
    if got := fmt.Sprintf("user-%d", 42); got != "user-42" {
        t.Errorf("got %q", got)
    }
}

func TestErrorfWrap(t *testing.T) {
    inner := fmt.Errorf("inner")
    outer := fmt.Errorf("outer: %w", inner)
    if !strings.Contains(outer.Error(), "outer: inner") {
        t.Errorf("got %q", outer.Error())
    }
}
```

---

## 23. Tricky Questions

**Q1**: What is printed?
```go
fmt.Println("a", "b")
fmt.Print("a", "b")
fmt.Print("a", 1)
```
**A**: `a b`, `ab`, `a 1`. `Print` adds a space only between
non-string args.

**Q2**: What is printed by `fmt.Sprintf("count=%w", err)`?
**A**: `count=%!w(...)`. `%w` outside `Errorf` is malformed.

**Q3**: For `t := struct{A,B int}{1,2}`, what does
`fmt.Printf("%v %+v %#v\n", t, t, t)` print?
**A**: `{1 2} {A:1 B:2} main.T{A:1, B:2}`

---

## 24. Cheat Sheet

```go
// Print
fmt.Print("hello")           // no newline, no spaces
fmt.Println("hello", "you")  // newline + spaces
fmt.Printf("x=%d\n", 42)     // formatted

// Build a string / wrap an error
s := fmt.Sprintf("user-%d", id)
err := fmt.Errorf("read %s: %w", path, ioErr)

// Write to any io.Writer
fmt.Fprintln(os.Stderr, "warn")
fmt.Fprintf(w, "line %d\n", n)

// Verbs
%v   default
%s   string
%d   integer
%t   bool
%f   float
%T   type
%+v  struct with field names
%#v  Go-syntax representation
%w   wrap error (Errorf only)

// Width / precision
%5d   width 5, right-aligned
%-5d  width 5, left-aligned
%05d  width 5, zero-padded
%.2f  precision 2
%5.2f width 5, precision 2
```

---

## 25. Self-Assessment Checklist

- [ ] I can choose between `Print`, `Println`, and `Printf`.
- [ ] I know the five day-one verbs (`%v %s %d %t %f`).
- [ ] I know that `Sprintf` returns a string.
- [ ] I include `\n` in `Printf` format strings.
- [ ] I use `%w` for error wrapping, only inside `Errorf`.
- [ ] I write user output to `Stdout`, diagnostics to `Stderr`.
- [ ] I never use user input as a format string.
- [ ] I run `go vet` and read its `printf` warnings.

---

## 26. Summary

`fmt` gives you three families — `Print`, `Sprint`, `Fprint` — each
with three variants (zero suffix, `ln`, `f`). Use the `f` variants
when you have verbs; the others for default formatting. Wrap errors
with `fmt.Errorf("...: %w", err)`. Use `%v` until a specific verb is
needed. Mind the spacing differences between `Print` and `Println`,
the missing `\n` in `Printf`, and the `%w`-only-in-`Errorf` rule.
Run `go vet`.

---

## 27. What You Can Build

- CLIs with aligned tabular output.
- Error wrappers that preserve cause chains.
- Cache keys, URL paths, and SQL fragments.
- Toy HTTP handlers using `Fprintf(w, ...)`.
- Test failure messages that pinpoint mismatches.
- Quick debug dumps of structs with `%+v`.

---

## 28. Further Reading

- [pkg.go.dev/fmt](https://pkg.go.dev/fmt) — full docs and verb
  reference.
- [Effective Go — Printing](https://go.dev/doc/effective_go#printing)
- [Go Blog — Errors are values](https://go.dev/blog/errors-are-values)
- [Go 1.13 release notes — `%w`](https://go.dev/doc/go1.13#error_wrapping)

---

## 29. Related Topics

- 8.1 `io` and file handling — every `Fprintf` writes to a writer.
- 8.7 `log/slog` — structured logging for services.
- 5.4 `fmt.Errorf` — focused deep dive on `%w`.
- 8.6 `bufio` — buffered I/O over the same writers.

---

## 30. Diagrams & Visual Aids

```
                 ┌───────────┐
                 │ arguments │
                 └─────┬─────┘
                       ▼
   ┌────────────┬─────────────┬────────────┐
   │  Print*    │   Sprint*   │  Fprint*   │
   │  → stdout  │ → returns s │ → writer   │
   └─────┬──────┴──────┬──────┴─────┬──────┘
         ▼             ▼            ▼
       screen       string      file/net
```

```mermaid
flowchart TD
    A[format string] --> B{token?}
    B -- literal --> C[copy to output]
    B -- %v --> D[default by reflect.Kind]
    B -- %d/%s/%f --> E[type-specific encoder]
    B -- %w --> F[Errorf only — wrap]
    D --> G[String\(\) if implemented]
    E --> G
    G --> H[bytes appended]
```
