# Go fmt — Specification

**Source:** https://pkg.go.dev/fmt
**Section:** Package documentation (verb table, interfaces)

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official docs** | https://pkg.go.dev/fmt |
| **Source** | https://github.com/golang/go/tree/master/src/fmt |
| **Introduced** | Go 1.0 |
| **`%w` added** | Go 1.13 |
| **Multiple `%w`** | Go 1.20 |
| **Stable since** | Go 1.0; verb table additions only |

---

## 2. Definition

The `fmt` package implements formatted I/O with functions analogous
to C's `printf` and `scanf`. Verbs derive from C but include
Go-specific extensions (struct formatting, `%w` for error wrapping,
`%T` for types).

The package exposes the printer family (`Print`/`Sprint`/`Fprint` ±
`ln`/`f`), `Errorf`, the scanner family (`Scan`/`Sscan`/`Fscan` ±
`ln`/`f`), and three customisation interfaces (`Stringer`,
`GoStringer`, `Formatter`).

---

## 3. Core Function Signatures

```go
// Print to stdout
func Print(a ...any) (n int, err error)
func Println(a ...any) (n int, err error)
func Printf(format string, a ...any) (n int, err error)

// Build a string
func Sprint(a ...any) string
func Sprintln(a ...any) string
func Sprintf(format string, a ...any) string

// Write to any io.Writer
func Fprint(w io.Writer, a ...any) (n int, err error)
func Fprintln(w io.Writer, a ...any) (n int, err error)
func Fprintf(w io.Writer, format string, a ...any) (n int, err error)

// Build an error
func Errorf(format string, a ...any) error

// Read input
func Scan(a ...any) (n int, err error)
func Scanln(a ...any) (n int, err error)
func Scanf(format string, a ...any) (n int, err error)
func Sscan(s string, a ...any) (n int, err error)
func Sscanln(s string, a ...any) (n int, err error)
func Sscanf(s, format string, a ...any) (n int, err error)
func Fscan(r io.Reader, a ...any) (n int, err error)
func Fscanln(r io.Reader, a ...any) (n int, err error)
func Fscanf(r io.Reader, format string, a ...any) (n int, err error)

// Append (Go 1.19+)
func Append(b []byte, a ...any) []byte
func Appendln(b []byte, a ...any) []byte
func Appendf(b []byte, format string, a ...any) []byte
```

---

## 4. The Verb Table

### 4.1 General

| Verb | Description |
|------|-------------|
| `%v` | Default format. Calls `Stringer.String` if implemented. |
| `%+v` | Like `%v`; for structs, adds field names. |
| `%#v` | Go-syntax representation. Calls `GoStringer.GoString` if implemented. |
| `%T` | Go-syntax type. |
| `%%` | Literal percent sign. |

### 4.2 Boolean

| Verb | Description |
|------|-------------|
| `%t` | `true` or `false`. |

### 4.3 Integer

| Verb | Description |
|------|-------------|
| `%b` | Base 2. |
| `%c` | Unicode character of the corresponding code point. |
| `%d` | Base 10. |
| `%o` | Base 8. |
| `%O` | Base 8 with `0o` prefix. |
| `%q` | Single-quoted character literal, Go-escaped. |
| `%x` | Base 16, lowercase a–f. |
| `%X` | Base 16, uppercase A–F. |
| `%U` | Unicode notation, e.g. `U+1234`. |

### 4.4 Floating-Point and Complex

| Verb | Description |
|------|-------------|
| `%b` | Decimalless scientific notation, e.g. `-123456p-78`. |
| `%e` | Scientific notation, e.g. `-1.234456e+78`. |
| `%E` | Like `%e` but uppercase. |
| `%f` | Decimal point, no exponent. |
| `%F` | Synonym for `%f`. |
| `%g` | `%e` for large exponents, `%f` otherwise. |
| `%G` | Like `%g` but uppercase. |
| `%x` | Hex, lowercase a–f, with `p` exponent. |
| `%X` | Hex, uppercase A–F. |

### 4.5 String and Slice of Byte

| Verb | Description |
|------|-------------|
| `%s` | Uninterpreted bytes / characters. |
| `%q` | Double-quoted, safely escaped. |
| `%x` | Base 16, lowercase, two characters per byte. |
| `%X` | Base 16, uppercase, two characters per byte. |

### 4.6 Pointer

| Verb | Description |
|------|-------------|
| `%p` | Hex address with `0x` prefix. |

### 4.7 Error Wrapping

| Verb | Description |
|------|-------------|
| `%w` | Like `%v`, AND records the value as a wrapped error. **Errorf-only.** |

---

## 5. Width and Precision

```
% [flags] [width] [.precision] [argument index] verb
```

| Token | Meaning |
|-------|---------|
| `width` | Minimum number of runes; padded with spaces. |
| `-` flag | Left-align in width. |
| `0` flag | Pad with zeros instead of spaces. |
| `.precision` | For floats: digits after the decimal. For strings: max width. For ints: minimum digits. |
| `*` (in width or precision) | Take from the next int argument. |
| `[N]` | Use argument N (1-indexed); next non-indexed verb uses N+1. |

Flags:

| Flag | Meaning |
|------|---------|
| `+` | Always print sign for numbers. |
| `-` | Left-align (with width). |
| `#` | Alternate form: `0o` for `%#o`, `0x` for `%#x`, etc. |
| `0` | Zero-pad (with width). |
| ` ` (space) | Leave a space for the sign of a number. |

### Examples

```go
fmt.Printf("%5d\n", 42)     //    42
fmt.Printf("%-5d|\n", 42)   // 42   |
fmt.Printf("%05d\n", 42)    // 00042
fmt.Printf("%+d\n", 42)     // +42
fmt.Printf("%.3f\n", 3.14)  // 3.140
fmt.Printf("%6.2f\n", 3.14) //   3.14
fmt.Printf("%.3s\n", "hello") // hel
fmt.Printf("%[2]d %[1]d\n", 1, 2) // 2 1
fmt.Printf("%*d\n", 5, 42)  //    42
```

---

## 6. The Stringer Interface

```go
type Stringer interface { String() string }
```

Called by `%s`, `%v`, and the unformatted `Print*` family when the
type implements it. Bypassed by `%T`, `%#v` (when `GoStringer`
exists), and `%p`.

---

## 7. The GoStringer Interface

```go
type GoStringer interface { GoString() string }
```

Called by `%#v` only. Should return text that compiles back to the
value in Go syntax.

---

## 8. The Formatter Interface

```go
type Formatter interface { Format(f State, verb rune) }

type State interface {
    Write(b []byte) (n int, err error)
    Width()     (wid int, ok bool)
    Precision() (prec int, ok bool)
    Flag(c int) bool
}
```

A type implementing `Formatter` overrides all default verb
handling, including `String()` and `Error()`. `f State` embeds
`io.Writer` plus `Width()`/`Precision()`/`Flag(c)`. `verb rune` is
the verb character.

---

## 9. Errorf and the %w Verb

```go
func Errorf(format string, a ...any) error
```

If the format contains a `%w` verb, the corresponding argument must
be an error. The returned error implements `Unwrap() error` (single
`%w`) or `Unwrap() []error` (multiple `%w`, Go 1.20+).

Outside `Errorf`, `%w` is treated as a malformed verb and produces
`%!w(...)`.

`Errorf("...: %w", nil)` panics in Go 1.20+:
```
panic: %w error operand cannot be nil
```

### Errors Helpers (errors package)

```go
func errors.Is(err, target error) bool
func errors.As(err error, target any) bool
func errors.Unwrap(err error) error
func errors.Join(errs ...error) error
```

These walk the chain produced by `%w`.

---

## 10. Default Format Rules

For each Go kind, the default `%v` representation:

| Kind | `%v` form |
|------|-----------|
| bool | `true` / `false` |
| int / uint | `%d` |
| float / complex | `%g` |
| string | the string |
| chan | `%p` |
| func | `%p` |
| pointer | `%p` |
| array / slice | `[elem0 elem1 ...]` |
| map | `map[key1:val1 key2:val2 ...]` |
| struct | `{field1 field2 ...}` |
| interface | the value's dynamic value, formatted by `%v` |
| nil interface | `<nil>` |

For `%+v` of structs: `{Name:value Age:value ...}`.
For `%#v`: Go-syntax form.

---

## 11. Print Family Spacing Rules

`fmt.Print`:

- Adds a space between two adjacent operands when **neither** is a
  string.
- No leading or trailing newline.

`fmt.Println`:

- Always adds a space between adjacent operands.
- Adds a trailing newline.

`fmt.Printf`:

- Inserts no spaces or newlines automatically; the format string is
  authoritative.

---

## 12. Scan Family

```go
func Scan(a ...any) (n int, err error)
func Scanf(format string, a ...any) (n int, err error)
func Sscan(s string, a ...any) (n int, err error)
func Sscanf(s, format string, a ...any) (n int, err error)
func Fscan(r io.Reader, a ...any) (n int, err error)
func Fscanf(r io.Reader, format string, a ...any) (n int, err error)
```

- Whitespace separates tokens.
- Newlines: `Scan` treats them as whitespace; `Scanln` requires a
  newline at end.
- Verbs: `%d`, `%s`, `%f`, etc., similar to `Printf`.
- `%w` is **not** valid in scanning.

Returns the number of successfully scanned items.

---

## 13. Append Family (Go 1.19+)

```go
func Append(b []byte, a ...any) []byte
func Appendln(b []byte, a ...any) []byte
func Appendf(b []byte, format string, a ...any) []byte
```

Same semantics as `Print*`/`Sprint*` but writes into a caller-
provided byte slice, returning the resulting slice. Useful for
zero-allocation formatting in hot paths.

---

## 14. Edge Cases

### 14.1 nil interface

```go
var i any = nil
fmt.Printf("%v\n", i) // <nil>
fmt.Printf("%T\n", i) // <nil>
```

### 14.2 typed nil

```go
var p *T = nil
var i any = p
fmt.Printf("%v\n", i) // <nil>  (actually calls String() if defined)
fmt.Printf("%T\n", i) // *main.T
i == nil               // false  (interface is non-nil)
```

### 14.3 Recursion

A `String()` that calls `fmt.Sprintf("%v", t)` on its own type
infinitely recurses. The runtime detects stack overflow and
crashes. There is no automatic protection.

### 14.4 Wrong Verb For Type

`fmt` substitutes a runtime placeholder:
```
%!verb(type=value)   // e.g. %!d(string=hello)
%!(EXTRA type=value) // unconsumed argument
%!d(MISSING)         // missing argument
```

`go vet` catches these at compile time when the format is a
literal.

### 14.5 Format String Parsing Failure

If the format string ends mid-verb (e.g. `"%5"`), `fmt` emits
`%!(NOVERB)` and stops scanning verbs.

---

## 15. Related Specifications

### errors

- `errors.New(text string) error`
- `errors.Is(err, target error) bool`
- `errors.As(err error, target any) bool`
- `errors.Unwrap(err error) error`
- `errors.Join(errs ...error) error`

### reflect

`fmt`'s default formatting uses `reflect.Value` for composite
types. The `Kind` enumeration determines which fast path or
recursion is used.

### strconv

For pure value-to-string conversions, `strconv` is the
zero-allocation alternative:
- `strconv.Itoa(n int) string`
- `strconv.FormatFloat(f float64, fmt byte, prec, bitSize int) string`
- `strconv.AppendInt(dst []byte, n int64, base int) []byte`

### io

`Fprint*` accepts any `io.Writer`. `Fscan*` accepts any
`io.Reader`.

---

## 16. Version History

| Go version | Change |
|-----------|--------|
| Go 1.0 | Package introduced. |
| Go 1.5 | `%T` clarified for nil interfaces. |
| Go 1.13 | `%w` verb added; `errors.Is`, `errors.As`, `errors.Unwrap` added. |
| Go 1.19 | `Append`, `Appendln`, `Appendf` added. |
| Go 1.20 | Multiple `%w` per `Errorf`; `Errorf` panics on nil `%w` argument; `errors.Join` added. |
| Go 1.21 | Various performance improvements; `slog` introduced (companion package). |
| Go 1.22 | `pp` pool refinements; loop-variable change interacts with closures formatting. |

---

## 17. Implementation Notes

### File map

```
src/fmt/
  doc.go         Verb table documentation.
  print.go       Print/Sprint/Fprint, pp state, dispatch.
  format.go      Per-type byte writers (fmtInteger, fmtFloat, ...).
  scan.go        Scan/Sscan/Fscan, ss state.
  errors.go      Errorf, wrapError, wrapErrors.
```

### pp State

```go
// (simplified)
type pp struct {
    buf         buffer       // []byte the formatted bytes go into
    arg         any          // current argument
    value       reflect.Value
    fmt         fmt          // width, precision, flags
    reordered   bool         // %[N] was used
    goodArgNum  bool         // %[N] referred to an existing argument
    panicking   bool
    erroring    bool
    wrapErrs    bool         // recognise %w (Errorf only)
    wrappedErrs []int        // indices in `args` of wrapped errors
}
```

### Pool

```go
var ppFree = sync.Pool{New: func() any { return new(pp) }}
```

`pp.free()` returns the printer state to the pool unless its buffer
exceeds 64 KiB (to avoid pinning memory).

---

## 18. Acceptance Tests

```go
type stringerS struct{ V int }
func (s stringerS) String() string { return "S!" }

func TestStringerCalled(t *testing.T) {
    type S struct{ V int }
    if got := fmt.Sprintf("%v", S{42}); got != "{42}" { t.Fatalf("got %q", got) }
}

func TestStringerOverride(t *testing.T) {
    if got := fmt.Sprintf("%v", stringerS{42}); got != "S!" { t.Fatalf("got %q", got) }
}

func TestErrorfWraps(t *testing.T) {
    inner := errors.New("inner")
    outer := fmt.Errorf("outer: %w", inner)
    if !errors.Is(outer, inner) { t.Fatal("expected outer to wrap inner") }
}

func TestWInSprintfFallback(t *testing.T) {
    s := fmt.Sprintf("%w", errors.New("x"))
    if !strings.HasPrefix(s, "%!w(") { t.Fatalf("got %q", s) }
}
```

---

## 19. Related Specs

- [Go spec — `%w` and `errors`](https://pkg.go.dev/errors)
- [Go blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Go release notes 1.20 — multiple %w](https://go.dev/doc/go1.20#errors)
- [staticcheck — printf checks](https://staticcheck.dev/docs/checks/)
- [`vet`'s printf analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/printf)

---

## 20. Summary

`fmt` exposes a small, stable surface: nine printer functions
(three families × three variants), `Errorf`, the scan family, and
three customisation interfaces. Verbs follow `%[flags][width]
[.prec][index]verb`. `%v` is the default; `%w` is the wrapping
marker recognised only by `Errorf`. Custom types implement
`Stringer`, `GoStringer`, or `Formatter` to control representation,
with a fixed dispatch order: `Formatter` → `error` → `Stringer` →
reflection. The implementation uses a pooled `pp` printer state to
amortise per-call cost. The package has been stable since Go 1.0,
with the most consequential additions being `%w` (Go 1.13) and
multi-`%w` (Go 1.20).
