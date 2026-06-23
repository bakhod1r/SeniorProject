# Go fmt — Interview Questions

## Table of Contents

1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What's the difference between `Print`, `Println`, and `Printf`?**

- `Print(args...)` — writes to stdout, no newline; space between
  two adjacent non-string args, nothing between strings.
- `Println(args...)` — always spaces between args, trailing newline.
- `Printf(format, args...)` — verbs (`%s`, `%d`, ...); no automatic
  newline.

```go
fmt.Print("a", "b")        // ab
fmt.Print(1, 2)            // 1 2
fmt.Println("a", "b")      // a b\n
fmt.Printf("%s-%d", "x", 9) // x-9
```

---

**Q2: What's the difference between `Print`, `Sprint`, and `Fprint`?**

- `Print*` writes to stdout.
- `Sprint*` returns the formatted string.
- `Fprint*` writes to any `io.Writer`.

`Print` is sugar for `Fprint(os.Stdout, ...)`. All three families
have `*ln` and `*f` variants.

---

**Q3: What's the difference between `%v`, `%+v`, and `%#v`?**

- `%v` — default; for structs `{field1 field2}`.
- `%+v` — adds field names: `{Name:field1 Age:32}`.
- `%#v` — Go-syntax: `main.User{Name:"field1", Age:32}`.

```go
type U struct{ Name string; Age int }
u := U{"Ada", 36}
fmt.Printf("%v\n", u)   // {Ada 36}
fmt.Printf("%+v\n", u)  // {Name:Ada Age:36}
fmt.Printf("%#v\n", u)  // main.U{Name:"Ada", Age:36}
```

`%#v` calls `GoString()` if defined; the others call `String()`.

---

**Q4: How do you wrap an error with `fmt.Errorf`?**

Use `%w`:
```go
return fmt.Errorf("load %s: %w", path, err)
```

The wrapped error participates in the chain — `errors.Is(err,
os.ErrNotExist)` walks through it. `%w` works **only** inside
`fmt.Errorf`. Since Go 1.20 multiple `%w` per call is allowed:
```go
fmt.Errorf("step: %w; cleanup: %w", err1, err2)
```

---

**Q5: When does `fmt` call `String()` and when does it not?**

For `%s`/`%v`, `fmt` checks in order:

1. `Formatter` (`Format(State, rune)`) — overrides everything.
2. `error` (`Error()`) — beats `Stringer`.
3. `Stringer` (`String() string`).
4. Reflection-based default.

`String()` is **not** called when: the verb is `%T`; the verb is
`%#v` and `GoString()` is defined; you have a pointer-receiver
`String()` and format the value (not pointer); a `Formatter`
overrides; or the type also implements `error` — `Error()` wins.

---

**Q6: What does `%T` print?**

The Go type name including package path:
```go
fmt.Printf("%T\n", 42)      // int
fmt.Printf("%T\n", []int{}) // []int
fmt.Printf("%T\n", &User{}) // *main.User
fmt.Printf("%T\n", nil)     // <nil>
```

---

**Q7: How do you print a percent sign?**

Double it: `fmt.Printf("100%%\n")` → `100%`. A single `%` followed
by a non-verb produces `%!(NOVERB)`.

---

**Q8: What's wrong with `fmt.Printf(userInput)`?**

User input is treated as a format string. Verbs in `userInput` get
interpreted, looking for arguments that don't exist; you get
`%!s(MISSING)` placeholders. Fix:
```go
fmt.Print(userInput)        // literal
fmt.Printf("%s", userInput) // literal via %s
```

`staticcheck SA1006` catches this.

---

## Middle Level Questions

**Q9: Why is `fmt.Sprintf` slower than `strconv.Itoa`?**

`Sprintf` parses the format string, boxes args via `...any`, runs
reflection / type switch, and dispatches through method checks
(`Formatter`, `error`, `Stringer`). `strconv.Itoa` is typed and
hand-rolled (table lookup for small ints).

```
BenchmarkSprintfInt-8   30000000   45 ns/op   16 B/op   2 allocs/op
BenchmarkItoa-8        200000000    7 ns/op    0 B/op   0 allocs/op
```

~6x faster, zero allocs.

---

**Q10: When should you use `slog` instead of `fmt.Println`?**

For service logs, always. Switch when:

- The log is consumed by a machine (Splunk, Datadog, ELK).
- You need structured key-value pairs.
- You need leveled filtering.
- You want low/zero allocation per line.
- You want context propagation (`slog.With(...)`).

Keep `fmt.Println` for CLI tools, tests, error wrapping, and
human-readable output.

---

**Q11: Implement `fmt.Formatter` for custom verb handling.**

```go
type Color struct{ R, G, B uint8 }

func (c Color) Format(f fmt.State, verb rune) {
    switch verb {
    case 'h': fmt.Fprintf(f, "#%02x%02x%02x", c.R, c.G, c.B)
    case 'r': fmt.Fprintf(f, "rgb(%d,%d,%d)", c.R, c.G, c.B)
    case 'v':
        if f.Flag('+') {
            fmt.Fprintf(f, "Color{R:%d G:%d B:%d}", c.R, c.G, c.B)
            return
        }
        fmt.Fprintf(f, "(%d,%d,%d)", c.R, c.G, c.B)
    default:
        fmt.Fprintf(f, "%%!%c(Color=%v)", verb, c)
    }
}
```

Three rules: switch on `verb`; honour `f.Flag('+')`/`Width()`/
`Precision()`; always have a default branch.

---

**Q12: Stringer vs GoStringer?**

- `Stringer.String()` — natural, human-readable. Called by `%s`/`%v`.
- `GoStringer.GoString()` — Go-syntax that compiles back. Called by
  `%#v`.

```go
type ID [16]byte
func (id ID) String() string  { return hex.EncodeToString(id[:]) }
func (id ID) GoString() string { return fmt.Sprintf("ID{%#x}", id[:]) }

fmt.Printf("%s\n", id)  // 0123...
fmt.Printf("%#v\n", id) // ID{0x0123...}
```

---

**Q13: What does `%[N]verb` do?**

Indexed argument reference (1-indexed). The next non-indexed verb
continues from `N+1`.

```go
fmt.Printf("%[1]d in hex is %[1]x\n", 255) // 255 in hex is ff
fmt.Printf("%[2]s %[1]s!\n", "World", "Hello") // Hello World!
```

Useful for translation files where word order varies.

---

**Q14: When does `Sprintf` outperform `strings.Builder`?**

It usually doesn't. `Sprintf` is competitive when the format is
complex, the call is one-off, or readability beats nanoseconds.
For loops and bulk assembly, `Builder` + `strconv` wins by 3-5x.

---

**Q15: How does `%w` interact with `errors.Is/As`?**

`%w` makes the resulting error implement `Unwrap() error` (single
`%w`) or `Unwrap() []error` (multiple, Go 1.20+). `errors.Is/As`
walk the chain by calling `Unwrap` repeatedly.

```go
var ErrNotFound = errors.New("not found")
err := fmt.Errorf("user %d: %w", 42, ErrNotFound)
errors.Is(err, ErrNotFound) // true

var pe *fs.PathError
errors.As(err, &pe)
```

Without `%w`, the wrapped error is just text.

---

**Q16: Why does `fmt.Errorf("a: %w", nil)` panic in Go 1.20+?**

`nil` cannot be unwrapped. Earlier versions silently produced a
non-wrapping error, confusing `errors.Is`. Go 1.20 panics to make
the bug obvious. Filter `nil`, or use `errors.Join` (silently
ignores nils).

---

## Senior Level Questions

**Q17: Describe the `pp` printer state and its role.**

`pp` (in `src/fmt/print.go`) holds the output buffer, current arg
and `reflect.Value`, formatting state (width/precision/flags), and
wrapped errors for `Errorf`. Each call grabs a `pp` from
`sync.Pool`, fills the buffer, returns it (unless > ~64 KiB —
discarded to avoid pinning memory).

The pool eliminates ~80% of per-call allocations. Remaining: the
`[]any` for variadics, the result string in `Sprintf`, and boxes
for non-cached integers.

---

**Q18: How does `vet`'s printf analyzer work?**

It walks the AST, identifies `Printf`-like calls, parses literal
format strings, type-checks each verb. Reports wrong-type, missing/
extra arguments, `%w` outside `Errorf`, unknown verbs.

For custom helpers, add `// vet:printffunc` or use staticcheck's
configurable list.

---

**Q19: Explain the dispatch order: Formatter, error, Stringer.**

For `%s`/`%v`:

1. `Formatter` — overrides everything.
2. `error` — beats `Stringer`.
3. `Stringer`.
4. Reflection-based default.

A type implementing both `error` and `Stringer` shows `Error()` for
`%v`. To force `Stringer`, define `Format` and call `String()`
explicitly.

---

**Q20: How does `stringer` codegen work?**

Reads a Go file, finds the constant block of a named integer type,
emits a `String()` method. For dense contiguous values:

```go
const _Status_name = "PendingRunningDone"
var _Status_index = [...]uint8{0, 7, 14, 18}

func (i Status) String() string {
    if i < 0 || i >= Status(len(_Status_index)-1) {
        return "Status(" + strconv.FormatInt(int64(i), 10) + ")"
    }
    return _Status_name[_Status_index[i]:_Status_index[i+1]]
}
```

Sparse values fall back to `map[T]string`. Used by `time.Weekday`,
`time.Month`, Kubernetes, Prometheus, etcd.

---

**Q21: A type implements `Stringer`, `error`, and `Formatter`. What
gets called?**

`Format`. `Formatter` is highest precedence and overrides both. If
`Format` wants to delegate (e.g. `Error()` for `%s`, richer view
for `%+v`), it must call them explicitly.

---

**Q22: How do you avoid the `Stringer` recursion bug?**

Don't use `%v` of `self` inside `String()`:

```go
// Explicit fields
func (t T) String() string { return fmt.Sprintf("T{X:%d, Y:%d}", t.X, t.Y) }

// Alias trick (strips the method)
func (t T) String() string {
    type alias T
    return fmt.Sprintf("%+v", alias(t))
}
```

`vet` does NOT catch this; add a unit test.

---

**Q23: What allocations happen in `fmt.Println("hello", n)`?**

1. Variadic `...any` packs into `[]any` (~32 B).
2. `n` boxes into `any` — interned for small ints (~`-256..255`),
   one alloc otherwise.
3. `[]any` passed to `Fprintln`.
4. Bytes go directly to `os.Stdout`; no string alloc.

Roughly 1-2 allocations per call — dominant cost in hot loops.

---

## Scenario-Based Questions

**Q24: Code review shows `fmt.Errorf("read %s: %v", path, err)`.
What's wrong?**

`%v` should be `%w`. With `%v` the wrapped error becomes plain
text; the chain is broken; `errors.Is` returns false even when the
cause matches. `errorlint` flags this.

---

**Q25: A service prints `fmt.Println` per request; profile shows
30% CPU in `fmt.(*pp).doPrint`. What do you do?**

Switch to `slog` with `JSONHandler` (alloc-free in Go 1.22+). If
`slog` isn't available, buffer stdout with `bufio.Writer` and
`Flush` on shutdown.

---

**Q26: A custom error prints as `&{op:load err:...}` instead of
`load: file not found`. Why?**

The type is being printed via default struct format, not `Error()`.
Likely the method is named `Err()` instead of `Error()`, or
spelling/signature is wrong. Check `fmt.Printf("%T\n", err)` to
verify the type, then confirm `func (e MyError) Error() string`.

---

**Q27: A team has `Logf(format string, args ...any)`. `vet` doesn't
catch verb mismatches. Fix?**

Add a `printfunc` annotation, or:
```bash
go vet -printfuncs=Logf ./...
```

Or in `staticcheck.conf`:
```
[printf]
funcs = ["(*Logger).Logf"]
```

After this, `vet` checks `Logf` like `Printf`.

---

## FAQ

**Q: `Sprint` or `Sprintf` for one-off concatenation?**
`Sprint` for "print values with default format, spaces between";
`Sprintf` when you have a template. Similar cost; choose for
clarity.

**Q: Is `fmt.Println(err)` enough, or call `Error()` explicitly?**
`Println(err)` calls `Error()` automatically (`error` beats
`Stringer`). Either is fine; `Println(err)` is shorter.

**Q: How to print floats without scientific notation?**
`%f`. `%g` switches between `%e` and `%f`; `%f` always decimal.

**Q: Aligning hex output?**
```go
fmt.Printf("%08x\n", 255)  // 000000ff
fmt.Printf("%#08x\n", 255) // 0x0000ff
```

**Q: Print binary?**
```go
fmt.Printf("%08b\n", 10) // 00001010
```

**Q: Dump `[]byte` as a string?**
`%s` (the string view); `%v` shows decimal byte values.

**Q: Escape user-provided text?**
`%q` Go-quotes it: `fmt.Printf("%q\n", "hello\nworld")` →
`"hello\nworld"`.

**Q: Does `fmt.Print` flush?**
It writes to `os.Stdout`, which is line-buffered for terminals,
block-buffered when piped. For deterministic flushing, wrap with
`bufio.Writer` and call `Flush`.

**Q: Can `fmt.Sprintf` fail?**
It can produce `%!verb(...)` placeholders but doesn't return an
error. Use `vet` to catch problems at compile time.
