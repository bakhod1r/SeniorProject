# 8.20 `strconv` — Middle

> **Audience.** You can call `Atoi`/`Itoa` and `ParseFloat`. Now you're
> writing the hot inner loop of a parser, marshaler, or CSV
> ingester, and `fmt.Sprintf("%d", x)` shows up in the profile. You
> need to know `Append*`, when `Quote` is the right tool, why
> `ParseUint` exists when `ParseInt` would seem enough, and how to
> beat the general-purpose APIs by a factor of 10×.

## 1. The `Append*` family — appending without allocation

Every `Format*` function has an `Append*` twin that takes a `[]byte`
and writes into it instead of allocating a new string:

```go
func AppendInt(dst []byte, i int64, base int) []byte
func AppendUint(dst []byte, i uint64, base int) []byte
func AppendFloat(dst []byte, f float64, fmt byte, prec, bitSize int) []byte
func AppendBool(dst []byte, b bool) []byte
func AppendQuote(dst []byte, s string) []byte
func AppendQuoteRune(dst []byte, r rune) []byte
```

These are the foundation of every fast Go JSON encoder. The pattern:

```go
b := make([]byte, 0, 64)
b = append(b, '{', '"', 'i', 'd', '"', ':')
b = strconv.AppendInt(b, int64(user.ID), 10)
b = append(b, ',', '"', 'n', 'a', 'm', 'e', '"', ':')
b = strconv.AppendQuote(b, user.Name)
b = append(b, '}')
```

One growing slice, no intermediate strings, no `fmt` parsing.
Typical speedup over `fmt.Sprintf` is 3–10×.

## 2. The `Itoa` shortcut vs `FormatInt`

`strconv.Itoa(i)` is exactly `strconv.FormatInt(int64(i), 10)`. Both
allocate a fresh string. For the hottest paths, use `AppendInt`
into a pooled buffer.

```go
s := strconv.Itoa(42)              // "42", allocates
s := strconv.FormatInt(42, 10)     // "42", allocates
b := strconv.AppendInt(nil, 42, 10) // []byte("42"), allocates
```

The third form is interesting because passing `nil` causes `Append`
to allocate fresh — same cost as `Itoa`. The win comes from passing
a pre-allocated buffer.

## 3. Bases other than 10

`FormatInt(i, base)` and `ParseInt(s, base, bitSize)` accept any
base from 2 to 36.

```go
strconv.FormatInt(255, 16)  // "ff"
strconv.FormatInt(255, 2)   // "11111111"
strconv.FormatInt(255, 36)  // "73"

strconv.ParseInt("ff", 16, 64)  // 255, nil
strconv.ParseInt("0xff", 0, 64) // 255, nil (base 0 = auto-detect)
strconv.ParseInt("0o755", 0, 64) // 493
strconv.ParseInt("0b1010", 0, 64) // 10
```

**Base 0** is the auto-detect mode:

- `0x...` → base 16
- `0b...` → base 2 (Go 1.13+)
- `0o...` → base 8 (Go 1.13+)
- `0...`  → base 8 (legacy C-style; rare but still works)
- otherwise → base 10

This is the right choice when parsing user input where the format
varies.

For uppercase hex (`FF` instead of `ff`), use the `fmt` family
(`fmt.Sprintf("%X", 255)`) or post-process with `bytes.ToUpper`.
`strconv.FormatInt` always emits lowercase digits.

## 4. `ParseUint` — why it exists

`ParseInt` returns an `int64`. The maximum value is 2^63 − 1. If
you're parsing a `uint64` from a network protocol or a database
column, the top bit of legitimate values won't fit:

```go
v, err := strconv.ParseInt("18446744073709551615", 10, 64)
// err: strconv.ParseInt: parsing "18446744073709551615": value out of range

v, err := strconv.ParseUint("18446744073709551615", 10, 64)
// v == math.MaxUint64, err == nil
```

Same reasoning for hex addresses (`0xFFFFFFFFFFFFFFFF`), Unix
timestamps in microseconds, sequence numbers — anything with the
high bit set. Use `ParseUint`.

## 5. The `bitSize` parameter, explained

`ParseInt(s, base, bitSize)` checks that the result fits in
`bitSize` bits. Valid values: 0, 8, 16, 32, 64.

```go
strconv.ParseInt("128", 10, 8)  // err: out of range (int8 max is 127)
strconv.ParseInt("128", 10, 16) // 128, nil
```

`bitSize == 0` means "size of `int` on this platform". Always pass
the destination size; it makes range errors fail fast at parse time
instead of corrupting silently after assignment.

The return type is always `int64`; you cast to the smaller type
after the range check:

```go
v, err := strconv.ParseInt(s, 10, 32)
if err != nil { return err }
i32 := int32(v) // safe: parse already validated the range
```

## 6. `ParseFloat`: 32-bit vs 64-bit

```go
f, err := strconv.ParseFloat("3.14", 64)  // f is float64
f, err := strconv.ParseFloat("3.14", 32)  // f is float64 but bit-pattern matches float32
```

Always returns `float64`, but the `bitSize` parameter controls
rounding. With `bitSize == 32`, `ParseFloat` rounds to a value
representable as `float32`, so the cast to `float32` is exact:

```go
f32 := float32(f) // safe: no double-rounding
```

With `bitSize == 64`, the result has full `float64` precision. If
you cast that to `float32`, you risk double rounding:

```go
f, _ := strconv.ParseFloat("3.14", 64)
f32 := float32(f) // may differ from ParseFloat("3.14", 32)
```

For most code, this distinction doesn't matter. For numerical
correctness (financial calculations, scientific data), match
`bitSize` to the destination type.

## 7. `Quote`, `Unquote`, and Go string literals

`Quote` emits a string in Go syntax: surrounded by `"`, with
`\n`, `\t`, `\"`, `\\`, and non-printable runes properly escaped.

```go
strconv.Quote("hello\nworld")    // "\"hello\\nworld\""
strconv.Quote(`a"b`)             // "\"a\\\"b\""
strconv.QuoteRune('é')      // "'é'"  (é)
```

`Unquote` reverses it, returning the original Go string value:

```go
s, err := strconv.Unquote(`"hello\nworld"`)
// s == "hello\nworld", err == nil
```

The most common use is logging or debugging: when you want to print
a string with explicit byte boundaries, `Quote` shows it. For
JSON-style escaping, use `encoding/json`; `Quote` follows Go
syntax, not JSON (close, but not identical — JSON doesn't allow
`\xNN`, but `Quote` may emit it).

Variants:

| Function | Output |
|----------|--------|
| `Quote` | Go syntax; non-printable chars escaped |
| `QuoteToASCII` | Same, but all non-ASCII runes escaped too |
| `QuoteToGraphic` | Quotes only non-printable runes (keeps printable Unicode) |
| `QuoteRune` | Single-rune version with `'` quotes |
| `AppendQuote` | Appends to `[]byte` |

`CanBackquote(s)` reports whether `s` can be written as a raw
string literal (`` `like this` ``). It's true when `s` contains no
backquote and no non-printable characters except `\t`.

## 8. `NumError` and structured parse errors

Every `Parse*` failure returns a `*strconv.NumError`:

```go
type NumError struct {
    Func string // "ParseFloat", "ParseInt", "ParseUint"
    Num  string // the input
    Err  error  // strconv.ErrSyntax or strconv.ErrRange
}

func (e *NumError) Error() string
func (e *NumError) Unwrap() error
```

Use `errors.Is` to distinguish:

```go
_, err := strconv.ParseInt(s, 10, 64)
switch {
case errors.Is(err, strconv.ErrSyntax):
    // s isn't a number at all
case errors.Is(err, strconv.ErrRange):
    // s is a number but out of range
case err != nil:
    // shouldn't happen, but defensive
}
```

`NumError.Unwrap()` lets `errors.Is` traverse the chain.

`NumError.Num` is the offending input, useful for error messages —
but **redact it if the input is sensitive** (password, token,
PII): the default `Error()` includes it.

## 9. Parsing optional bool, int, float

Web APIs often have optional fields. `Parse*` requires a value:

```go
b, err := strconv.ParseBool(query.Get("verbose"))
// If "verbose" is absent, query.Get returns "", and ParseBool fails.
```

Wrap with a default-aware helper:

```go
func parseBoolDefault(s string, def bool) bool {
    if s == "" {
        return def
    }
    v, err := strconv.ParseBool(s)
    if err != nil {
        return def
    }
    return v
}
```

`ParseBool` accepts: `"1", "t", "T", "TRUE", "true", "True"` for
true; `"0", "f", "F", "FALSE", "false", "False"` for false. It
does NOT accept `"yes"`, `"on"`, `"y"`, `"enabled"`, etc. Build a
custom helper if your input has those.

## 10. Batch parsing with pre-allocated slice

For converting a slice of strings to ints:

### Before

```go
func parseInts(parts []string) ([]int, error) {
    var out []int
    for _, p := range parts {
        v, err := strconv.Atoi(p)
        if err != nil { return nil, err }
        out = append(out, v)
    }
    return out, nil
}
```

Each `append` may grow the slice; up to log2(N) reallocations.

### After

```go
func parseInts(parts []string) ([]int, error) {
    out := make([]int, len(parts))
    for i, p := range parts {
        v, err := strconv.Atoi(p)
        if err != nil { return nil, &numErrAt{i, err} }
        out[i] = v
    }
    return out, nil
}
```

One allocation. The `&numErrAt` wrapper carries the index that
failed — far more useful than the string alone.

## 11. `strconv.IntSize` and platform-dependent ints

`strconv.IntSize` is `32` or `64` depending on the build target's
word size. When you accept the size-zero parameter to `ParseInt(s,
base, 0)`, the implementation falls back to `IntSize`.

Avoid this in cross-platform code. Always specify `32` or `64`
explicitly — your code's behavior should not depend on whether the
binary is built for amd64 or arm32.

## 12. Choosing between `strconv`, `fmt`, and `encoding/json`

For a single number → string, all three work:

```go
strconv.Itoa(42)               // "42"
fmt.Sprintf("%d", 42)          // "42"
b, _ := json.Marshal(42)       // []byte("42")
```

Relative speed (approximate):

| Function | ns/op |
|----------|-------|
| `strconv.Itoa` | 30 |
| `strconv.AppendInt(buf, 42, 10)` | 12 |
| `fmt.Sprintf("%d", 42)` | 150 |
| `json.Marshal(42)` | 400 |

For one call per second the differences are invisible. For 100k+
calls per second they matter.

`fmt` shines when you need formatting flags (padding, width,
precision combinations). `strconv` shines when you need raw
number-to-string with no format string overhead. `encoding/json`
adds type-driven dispatch and quoting on top.

## 13. Floats: format codes that matter

`FormatFloat(f, fmt, prec, bitSize)` takes a format byte:

| Code | Output for 3.14159 with `prec=2` |
|------|----------------------------------|
| `'f'` | `"3.14"` (fixed-point) |
| `'e'` | `"3.14e+00"` (scientific lowercase) |
| `'E'` | `"3.14E+00"` (scientific uppercase) |
| `'g'` | `"3.1"` (shortest of `'e'`/`'f'`) |
| `'G'` | `"3.1"` (uppercase variant of `'g'`) |
| `'b'` | `"7074029114692207p-51"` (binary exponent, no rounding) |
| `'x'` | `"0x1.91eb86p+1"` (hex float, Go 1.12+) |
| `'X'` | `"0X1.91EB86P+1"` |

The `prec` parameter:

- For `'f'`, `'e'`, `'E'`: digits after the decimal point.
- For `'g'`, `'G'`: total significant digits.
- For `'b'`, `'x'`, `'X'`: ignored.
- `-1` means "shortest representation that round-trips through
  `ParseFloat`".

The `'g'` format with `prec=-1` is what `fmt.Sprintf("%v", f)`
produces. It's the most compact human-readable form and the only
one with the round-trip guarantee.

## 14. The "round-trip" guarantee

```go
f := 1.0 / 3.0
s := strconv.FormatFloat(f, 'g', -1, 64)
f2, _ := strconv.ParseFloat(s, 64)
// f == f2 // ALWAYS true
```

This guarantee is enforced by the Ryū algorithm (Go 1.12+): the
shortest decimal string that, when parsed back, produces the exact
same `float64` bit pattern. This is what makes JSON serialization
of floats lossless across Go ↔ Go.

It is NOT true for arbitrary `prec` values:

```go
s := strconv.FormatFloat(0.1, 'f', 2, 64) // "0.10"
f2, _ := strconv.ParseFloat(s, 64)
// f2 != 0.1 (0.10 has a different bit pattern)
```

For data interchange, use `prec=-1` unless you have a fixed-format
requirement.

## 15. CSV parsing example

Parsing a single CSV row of numbers:

```go
func parseRow(row string) ([]float64, error) {
    var out []float64
    for row != "" {
        field, rest, _ := strings.Cut(row, ",")
        v, err := strconv.ParseFloat(field, 64)
        if err != nil {
            return nil, fmt.Errorf("parse %q: %w", field, err)
        }
        out = append(out, v)
        row = rest
    }
    return out, nil
}
```

For real CSV with quoting, use `encoding/csv`. The `strconv`
primitive shines for known-good numeric data (output of another
Go program, internal protocols).

## 16. Common middle-tier mistakes

### 16.1 Ignoring the parse error

```go
v, _ := strconv.Atoi(s) // bug if s is not a number
```

Atoi returns 0 with the error; if you ignore the error, you get 0
silently. Always check or wrap.

### 16.2 Wrong `bitSize`

```go
v, _ := strconv.ParseInt(s, 10, 64)
i32 := int32(v) // overflow if v is outside int32 range
```

Pass `32` to `ParseInt` to let it validate.

### 16.3 `FormatFloat` with wrong precision

```go
s := strconv.FormatFloat(1.234, 'f', 2, 64) // "1.23"
// Loss of information; cannot round-trip.
```

Use `prec=-1` for round-trippable output.

### 16.4 `Quote` confused with JSON encoding

```go
s := strconv.Quote(`{"key": "value"}`) // "\"{\\\"key\\\": \\\"value\\\"}\""
```

`Quote` produces Go syntax, not JSON. For JSON-escaped strings,
use `encoding/json`.

### 16.5 Forgetting that `ParseBool` accepts "1" and "0"

```go
// Surprising:
strconv.ParseBool("1")  // true, nil
strconv.ParseBool("2")  // false, error
strconv.ParseBool("on") // false, error
```

If your protocol uses "1/0" booleans, this is the right tool. If it
uses "yes/no", build your own helper.

## 17. Where to go next

The senior file covers:

- How `ParseFloat` actually implements Ryū / Grisu3.
- The bit layout of `NumError` and where allocations come from.
- The assembly-level fast paths for small integers.
- Escape analysis of `Itoa` vs `FormatInt` vs `AppendInt`.

The professional file is "running this in production at scale":
zero-allocation parsing pipelines, profiling techniques, and the
build tools that catch `Sprintf` regressions.
