# 8.20 `strconv` — Specification

> Reference card. Function signatures, semantics, and edge cases.
> Authoritative source: `$GOROOT/src/strconv/`.

## 1. Constants and variables

```go
const IntSize = 32 << (^uint(0) >> 63) // 32 or 64, depending on platform

var ErrRange = errors.New("value out of range")
var ErrSyntax = errors.New("invalid syntax")
```

`IntSize` is the bit-size of `int` on the build target. Use it
sparingly; explicit `32`/`64` is clearer in code.

## 2. Errors

```go
type NumError struct {
    Func string // e.g., "ParseInt"
    Num  string // the input that failed to parse
    Err  error  // strconv.ErrRange or strconv.ErrSyntax
}

func (e *NumError) Error() string
func (e *NumError) Unwrap() error
```

`Error()` formats as `strconv.{Func}: parsing {Num}: {Err}`.
`Unwrap()` returns `Err` so `errors.Is(err, strconv.ErrRange)`
works through the chain.

## 3. Integer conversions

### Parse

```go
func Atoi(s string) (int, error)
func ParseInt(s string, base, bitSize int) (int64, error)
func ParseUint(s string, base, bitSize int) (uint64, error)
```

| Parameter | Values |
|-----------|--------|
| `base` | 0, 2..36. `0` = auto-detect (`0x`, `0b`, `0o`, `0`, decimal) |
| `bitSize` | 0, 8, 16, 32, 64. `0` = `int` size |

Inputs accepted:

- Optional leading `+` or `-` for `ParseInt` only (not `ParseUint`).
- Decimal digits `0`-`9`, or hex `0`-`9a`-`fA`-`F`, etc., for higher
  bases.
- For `base == 0`, prefix selects: `0x`/`0X` (hex), `0b`/`0B` (bin,
  Go 1.13+), `0o`/`0O` (oct, Go 1.13+), `0` followed by digits (oct,
  legacy), otherwise decimal.

Returns `ErrSyntax` for malformed input, `ErrRange` if the value
exceeds the target `bitSize`.

`Atoi(s)` is equivalent to `ParseInt(s, 10, 0)` with a slight fast
path for short decimal strings.

### Format

```go
func Itoa(i int) string
func FormatInt(i int64, base int) string
func FormatUint(i uint64, base int) string

func AppendInt(dst []byte, i int64, base int) []byte
func AppendUint(dst []byte, i uint64, base int) []byte
```

`base` must be in `[2, 36]`. Letters in output are lowercase
(`'a'..'z'`). For uppercase, post-process or use `fmt`.

`Itoa(i)` is equivalent to `FormatInt(int64(i), 10)`.

`Append*` writes into `dst`'s tail capacity, growing if needed,
and returns the new slice header. Pass `nil` to start fresh; pass
a pre-allocated slice for zero-allocation use.

## 4. Float conversions

### Parse

```go
func ParseFloat(s string, bitSize int) (float64, error)
```

`bitSize` is `32` or `64`. Always returns `float64`; the bit
pattern matches `float32` rounding when `bitSize == 32`.

Inputs accepted:

- Decimal: `[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?`
- Hex (Go 1.13+): `[+-]?0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]+)?([pP][+-]?[0-9]+)?`
- `inf`, `+inf`, `-inf`, `Inf` (case-insensitive)
- `nan`, `NaN`, etc.

### Format

```go
func FormatFloat(f float64, fmt byte, prec, bitSize int) string
func AppendFloat(dst []byte, f float64, fmt byte, prec, bitSize int) []byte
```

`fmt` (format byte):

| Byte | Description |
|------|-------------|
| `'f'` | Fixed-point: `123.456` |
| `'e'`/`'E'` | Scientific lower/upper: `1.23456e+02` |
| `'g'`/`'G'` | Shortest of `e`/`f` |
| `'b'` | Binary exponent: `7916...p-49` |
| `'x'`/`'X'` | Hex float (Go 1.12+): `0x1.f4ccccp+6` |

`prec`:

- For `'f'`, `'e'`, `'E'`: digits after decimal point.
- For `'g'`, `'G'`: total significant digits.
- For `'b'`, `'x'`, `'X'`: ignored.
- `-1`: shortest representation that round-trips through
  `ParseFloat`.

`bitSize` is `32` or `64`, matching the source value's precision.

Special values:

| Value | Output |
|-------|--------|
| `+Inf` | `"+Inf"` |
| `-Inf` | `"-Inf"` |
| `NaN` | `"NaN"` |
| `+0.0`, `-0.0` | `"0"`, `"-0"` |

## 5. Bool conversions

```go
func ParseBool(s string) (bool, error)
func FormatBool(b bool) string
func AppendBool(dst []byte, b bool) []byte
```

Accepted inputs for `ParseBool` (exact match, case-sensitive
exceptions noted):

| True | False |
|------|-------|
| `"1"` | `"0"` |
| `"t"` | `"f"` |
| `"T"` | `"F"` |
| `"TRUE"` | `"FALSE"` |
| `"true"` | `"false"` |
| `"True"` | `"False"` |

Any other input returns `ErrSyntax`.

`FormatBool(true)` returns `"true"`; `FormatBool(false)` returns
`"false"`.

## 6. Quote and unquote

```go
func Quote(s string) string
func QuoteToASCII(s string) string
func QuoteToGraphic(s string) string
func AppendQuote(dst []byte, s string) []byte
func AppendQuoteToASCII(dst []byte, s string) []byte
func AppendQuoteToGraphic(dst []byte, s string) []byte

func QuoteRune(r rune) string
func QuoteRuneToASCII(r rune) string
func QuoteRuneToGraphic(r rune) string
func AppendQuoteRune(dst []byte, r rune) []byte
func AppendQuoteRuneToASCII(dst []byte, r rune) []byte
func AppendQuoteRuneToGraphic(dst []byte, r rune) []byte

func Unquote(s string) (string, error)
func UnquoteChar(s string, quote byte) (value rune, multibyte bool, tail string, err error)

func CanBackquote(s string) bool
func IsPrint(r rune) bool
func IsGraphic(r rune) bool
```

`Quote(s)` returns `s` as a Go double-quoted string literal.
Non-printable characters use Go escape syntax (`\n`, `\xNN`,
`\uNNNN`, `\UNNNNNNNN`).

`QuoteToASCII` escapes all non-ASCII runes additionally.

`QuoteToGraphic` keeps printable Unicode runes as-is; escapes only
non-graphic characters.

`Unquote(s)` parses `s` as a Go string/rune literal. Accepts:

- Backtick-quoted: contents copied verbatim, no escape processing.
- Double-quoted: full escape processing.
- Single-quoted: exactly one rune (or escape).

Returns `(value, nil)` on success, `("", ErrSyntax)` on failure.

`UnquoteChar` parses one rune from a partially-quoted string;
useful for custom parsers.

`CanBackquote(s)` reports whether `s` can be a raw string literal
(no backticks, no `\r`, no `\x00` etc.).

`IsPrint` and `IsGraphic` are exported because Quote uses them; the
predicates match Unicode tables baked into the package.

## 7. Method tables

### Allocation behavior

| Function | Allocates result? |
|----------|-------------------|
| `Atoi`, `ParseInt`, `ParseUint`, `ParseFloat`, `ParseBool` | No (success); yes (failure: NumError) |
| `Itoa`, `FormatInt`, `FormatUint`, `FormatFloat`, `FormatBool` | Yes (result string) |
| `Quote`, `QuoteToASCII`, `QuoteToGraphic` | Yes |
| `QuoteRune` and variants | Yes (small) |
| `Append*` | No (if `dst` has capacity); yes (if grow needed) |
| `Unquote` | Yes (result string) |
| `CanBackquote`, `IsPrint`, `IsGraphic` | No |

### Concurrency

All functions are pure and safe for concurrent use.

## 8. Behavior table for common inputs

### `Atoi`

| Input | Result | Error |
|-------|--------|-------|
| `""` | `0` | `ErrSyntax` |
| `"42"` | `42` | nil |
| `"+42"` | `42` | nil |
| `"-42"` | `-42` | nil |
| `" 42"` | `0` | `ErrSyntax` (no leading space) |
| `"42 "` | `0` | `ErrSyntax` (no trailing space) |
| `"42a"` | `0` | `ErrSyntax` |
| `"4_2"` | `0` | `ErrSyntax` (no underscores) |
| `"0x2A"` | `0` | `ErrSyntax` (Atoi is base 10 only) |
| `"99999999999999999999"` | `0` | `ErrRange` |

### `ParseBool`

| Input | Result | Error |
|-------|--------|-------|
| `"1"` | `true` | nil |
| `"true"` | `true` | nil |
| `"True"` | `true` | nil |
| `"TRUE"` | `true` | nil |
| `"0"` | `false` | nil |
| `"yes"` | `false` | `ErrSyntax` |
| `"on"` | `false` | `ErrSyntax` |

### `ParseFloat` special values

| Input | Result |
|-------|--------|
| `"3.14"` | `3.14` |
| `"+0"` | `+0.0` |
| `"-0"` | `-0.0` |
| `"inf"`, `"Inf"`, `"+Inf"` | `+math.Inf(1)` |
| `"-inf"`, `"-Inf"` | `math.Inf(-1)` |
| `"nan"`, `"NaN"` | `math.NaN()` |
| `"0x1.8p1"` | `3.0` (Go 1.13+) |

### `Quote` edge cases

| Input | Output |
|-------|--------|
| `""` | `"\"\""` |
| `"hello"` | `"\"hello\""` |
| `"a\nb"` | `"\"a\\nb\""` |
| `"€"` (U+20AC) | `"\"€\""` (printable) |
| `"\x00"` | `"\"\\x00\""` |
| invalid UTF-8 | `\xNN` escapes per byte |

## 9. Compatibility notes

- All `strconv` functions are part of the Go 1 compatibility
  promise. Signatures have not changed since Go 1.0.
- Hex floats (`0x1.8p1`) added in Go 1.13.
- Binary (`0b1010`) and octal (`0o755`) prefixes for `base == 0`
  added in Go 1.13.
- Multiple-`%w` not applicable here (no fmt).
- `Ryū` for `FormatFloat` with `prec=-1`: Go 1.12+.
- `Eisel-Lemire` for `ParseFloat`: Go 1.15+.

## 10. Complexity summary

| Function | Time | Space |
|----------|------|-------|
| `Atoi`, `ParseInt`, `ParseUint` | O(n) where n = `len(s)` | O(1) success / O(1) failure (NumError) |
| `ParseFloat` | O(n) average; O(n²) worst case (rare) | O(1) success |
| `Itoa`, `FormatInt`, `FormatUint` | O(log₁₀(i)) | O(log₁₀(i)) |
| `FormatFloat` with `prec=-1` | O(1) per significant digit (Ryū) | O(1) |
| `Quote`, `Unquote` | O(n) | O(n) |
| `AppendInt`, etc. | same as Format, but no fresh allocation when `dst` has capacity | O(1) extra |

## 11. References

- [pkg.go.dev/strconv](https://pkg.go.dev/strconv)
- Source: `$GOROOT/src/strconv/`
- Cross-links: [`../18-fmt/`](../18-fmt/index.md),
  [`../04-encoding-json/`](../04-encoding-json/index.md),
  [`../19-strings-bytes/`](../19-strings-bytes/index.md)
