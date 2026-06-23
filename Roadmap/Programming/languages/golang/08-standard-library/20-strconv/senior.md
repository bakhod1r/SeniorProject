# 8.20 `strconv` — Senior

> **Audience.** You're the person on the team who knows why `fmt`
> falls over at 100k req/s, who can read pprof output of a marshaler,
> who's asked why two implementations of "format this float" disagree
> on the last digit. This file is the layer where you understand the
> algorithms underneath, not just the API.

## 1. Float formatting: Ryū, Grisu3, and the round-trip guarantee

`strconv.FormatFloat(f, 'g', -1, 64)` produces the **shortest**
decimal representation that, when parsed back via `ParseFloat`,
recovers the exact same `float64` bit pattern. This is not a
property of decimal arithmetic; it's an algorithmic result.

Go 1.12+ implements **Ryū** (Ulf Adams, 2018) for the `prec=-1`
case and **Grisu3** (Loitsch, 2010) as a faster fallback for
specific value ranges. Both algorithms answer the question: "What
is the shortest decimal that rounds to this float?"

The naive approach — print 17 digits, then strip trailing zeros —
fails. For `0.1`, the underlying `float64` value is
`0.1000000000000000055511151231257827021181583404541015625`. Naive
truncation to "0.1" works for parsing but isn't guaranteed; Ryū
proves it's the shortest correctly-rounding string.

You don't need to implement Ryū. You do need to know:

- `prec=-1` triggers the shortest-roundtrip path. Other `prec`
  values use simpler (and slower for prec=-1, faster for fixed
  prec) code paths.
- This is why JSON-encoded Go floats are stable across encode/decode
  cycles — `encoding/json` uses `FormatFloat(..., 'g', -1, 64)`.
- Comparing floats as strings across languages is unreliable: Java
  and Python may produce a different shortest representation for
  the same bit pattern.

## 2. Integer formatting fast path

`FormatInt` for `base == 10` has a tiered fast path:

```go
// simplified from strconv/itoa.go
func FormatInt(i int64, base int) string {
    if 0 <= i && i < int64(len(smallsString))/2 {
        return smallsString[i*2 : i*2+2] // direct table lookup
    }
    return formatBits(nil, uint64(i), base, i < 0, false)
}
```

`smallsString` is a 200-byte table containing "00", "01", ..., "99"
laid out contiguously. For values 0–99, this is a single bounds-
checked slice — no allocation, no division.

For values >= 100, `formatBits` divides by 100 repeatedly, indexing
into `smallsString` for two digits at a time. This is twice as fast
as the digit-at-a-time loop you'd write by hand.

`Itoa` is an inline call to `FormatInt(int64(i), 10)`. The Go
compiler eliminates the wrapper.

## 3. `NumError`: layout and allocation cost

```go
type NumError struct {
    Func string
    Num  string
    Err  error
}
```

Three fields, each a small header. On a failing parse, the
implementation allocates:

1. A `NumError` struct (24 bytes on amd64).
2. A copy of the input as `Num`. **Watch this**: `Num` may include
   the entire input string if it's short, but the implementation
   uses `string(input)` so it's a defensive copy.

For a fast-failing parser that sees many invalid inputs, the
error allocation can dominate the success path. If you can detect
"definitely-not-a-number" cheaply (e.g., `s == ""`, `s[0]` not in
`-+0..9`), short-circuit before calling `Parse*`.

## 4. Reading the assembly

```bash
go build -gcflags="-S" -o /dev/null mypkg 2>&1 | grep -A 5 "Itoa"
```

For `strconv.Itoa(42)` you'll see:

- A call into `runtime.convT64` if the compiler can't prove `42`
  fits in the small table — except for the literal case where
  constant folding kicks in.
- For dynamic `int` values, a call to `FormatInt`.

The interesting observation: `strconv.Itoa(rand.Intn(1000))` inlines
the call (`FormatInt` is marked `//go:noinline` only on certain
paths). The 64-bit divide-by-100 in `formatBits` becomes a multiply
by a magic constant — the compiler's strength reduction in action.

## 5. Escape analysis: `Itoa` vs `AppendInt`

```go
func a() string {
    return strconv.Itoa(42) // allocates the result string
}

func b(buf []byte) []byte {
    return strconv.AppendInt(buf, 42, 10) // appends, no new string
}
```

With `-gcflags="-m"`:

```
./x.go:8:21: strconv.Itoa(42) escapes to heap
./x.go:12:33: leaking param: buf
./x.go:12:33: strconv.AppendInt(buf, 42, 10) does not escape
```

`AppendInt` writes into the caller's slice. If the caller's slice
is on the stack (e.g., `var buf [32]byte; AppendInt(buf[:0], ...)`),
the entire operation is stack-only. This is how high-throughput
encoders achieve zero allocations.

## 6. The `strconv.Quote` escape table

`Quote` decides for each rune whether to emit it verbatim or escape
it. The decision uses `unicode.IsPrint` plus special cases for
`"`, `\`, and the C-style escapes (`\n`, `\r`, `\t`).

The fast path for ASCII printable characters (`0x20`–`0x7E` minus
`"` and `\`) is a single byte compare; for the rest, the code
falls into the slow path that calls `unicode.IsPrint` and possibly
emits `\uXXXX` or `\UXXXXXXXX`.

`QuoteToASCII` forces the slow path for every non-ASCII rune; use
it when the output must be ASCII-safe (e.g., HTTP headers, source
code embedded in another language).

## 7. `Atoi` vs `ParseInt`: why two functions?

Looking at `strconv/atoi.go`:

```go
func Atoi(s string) (int, error) {
    // Fast path for small positive integers
    const fnAtoi = "Atoi"

    sLen := len(s)
    if intSize == 32 && (0 < sLen && sLen < 10) ||
       intSize == 64 && (0 < sLen && sLen < 19) {
        s0 := s
        if s[0] == '-' || s[0] == '+' {
            s = s[1:]
            if len(s) < 1 {
                return 0, &NumError{fnAtoi, s0, ErrSyntax}
            }
        }
        n := 0
        for _, ch := range []byte(s) {
            ch -= '0'
            if ch > 9 {
                return 0, &NumError{fnAtoi, s0, ErrSyntax}
            }
            n = n*10 + int(ch)
        }
        if s0[0] == '-' {
            n = -n
        }
        return n, nil
    }
    // Slow path: delegate to ParseInt
    i64, err := ParseInt(s, 10, 0)
    ...
}
```

`Atoi` has a hot path for short decimal strings that avoids the
generality of `ParseInt` (no base parameter, no `bitSize` checks).
For typical input sizes (≤ 18 digits, decimal, signed), `Atoi` is
~2× faster than `ParseInt(s, 10, 0)`.

Implications:

- For decimal parsing of small integers, `Atoi` is the right call.
- For anything else (other bases, ranged checks, unsigned),
  `ParseInt`/`ParseUint`.

## 8. `ParseFloat` algorithm sketch

For a string like `"3.14159"`:

1. **Lex**: split into sign, integer part, fractional part,
   exponent. The result is a `decimal` struct (an arbitrary-
   precision decimal representation).
2. **Try Eisel-Lemire** (Go 1.15+) — a fast 64-bit fixed-point
   approximation that succeeds for ~95% of inputs.
3. **Fall back to slow path** — extended precision multiplication
   with carefully-chosen powers of 10 from a precomputed table.
4. **Round** to the target `bitSize` (32 or 64).

The Eisel-Lemire fast path is what makes `ParseFloat` competitive
with `strtod` in C. It's also why "garbage input" is fast to reject:
the lex stage fails before any arithmetic.

## 9. The `strconv.Unquote` algorithm

`Unquote(s)` reads `s` as a Go string/rune literal. It's not just
"strip quotes and reverse `Quote`":

- Backtick-quoted (`` ` ``): no escapes processed; contents copied
  verbatim. Must not contain a backtick.
- Double-quoted (`"`): `\a \b \f \n \r \t \v \\ \"`, octal
  (`\NNN`), hex (`\xNN`), 16-bit unicode (`\uNNNN`), 32-bit unicode
  (`\UNNNNNNNN`).
- Single-quoted (`'`): same escapes, plus must contain exactly one
  rune.

Implementation detail: `Unquote` validates UTF-8 of the input AFTER
processing escapes. An escape that produces an invalid UTF-8
sequence (e.g., `\x80` alone, which isn't valid UTF-8) is rejected
unless it's inside a byte string context — but `Unquote` doesn't
have that context, so it rejects them.

This is the source of the rare "unquote failed" error in code that
manually constructs Go-syntax strings.

## 10. Why there's no `strconv.AppendBytes`

You might want a function that appends a `[]byte` representation
of a number. There isn't one — `AppendInt` already returns
`[]byte`, and `AppendQuote` does the byte-wise equivalent of
`Quote`. The package is consistent on this: every `Format*` has an
`Append*`, and `AppendQuote` plus `AppendQuoteRune` cover the
quoted byte case.

For raw byte conversion (e.g., a `uint16` written as two bytes),
use `encoding/binary` — it's a different package for a different
purpose (in-memory binary layout, not textual representation).

## 11. Concurrency notes

All `strconv` functions are pure: no global state, no goroutine-
local data, no caches. Safe to call from any number of goroutines
without synchronization.

The functions that allocate (everything except the `Append*` family
and `Quote` on a pre-allocated buffer) interact with the garbage
collector. Heavy concurrent allocation contributes to GC pressure;
this is the case for `Itoa`, `FormatFloat`, `ParseInt`-with-error,
`Quote`, and similar.

For sustained throughput, prefer `Append*` into pooled `[]byte`.

## 12. Edge cases

### Maximum/minimum int representations

```go
strconv.FormatInt(math.MinInt64, 10) // "-9223372036854775808"
```

The negation `-math.MinInt64` overflows; the implementation
handles this with an `if i < 0 { ... }` branch that emits the
minus sign separately and treats the magnitude as `uint64`.

### "Inf", "NaN", and "0"

```go
strconv.FormatFloat(math.Inf(1), 'g', -1, 64)  // "+Inf"
strconv.FormatFloat(math.Inf(-1), 'g', -1, 64) // "-Inf"
strconv.FormatFloat(math.NaN(), 'g', -1, 64)   // "NaN"

strconv.ParseFloat("+Inf", 64) // +Inf, nil
strconv.ParseFloat("inf", 64)  // +Inf, nil (case-insensitive)
strconv.ParseFloat("NaN", 64)  // NaN, nil
```

NaN compares unequal to itself, so `f != f` is the canonical NaN
check. Be careful when parsing untrusted input: an attacker who
controls a numeric field can inject `NaN` and break downstream
comparisons.

### Negative zero

```go
strconv.FormatFloat(-0.0, 'f', -1, 64) // "-0"
strconv.FormatFloat(0.0, 'f', -1, 64)  // "0"
```

`-0.0 == 0.0` is true in Go (IEEE 754 mandate), but the string
forms differ. Don't rely on `s == "0"` to test for zero.

### Underscores in numeric literals (Go 1.13+)

```go
strconv.ParseInt("1_000", 10, 64) // err: invalid syntax
```

Underscores in Go source code are stripped by the compiler before
the runtime ever sees the literal. `strconv` does **not** accept
them. If your input format includes underscores, strip them with
`strings.ReplaceAll(s, "_", "")` first.

## 13. Migration: `os.Getenv` + `strconv.Atoi`

A common pattern is the un-checked environment variable:

```go
port, _ := strconv.Atoi(os.Getenv("PORT"))
// port == 0 if PORT is unset, malformed, or just "0"
```

Three failure modes silently produce the same result. The fix is a
small helper:

```go
func envInt(key string, def int) (int, error) {
    s := os.Getenv(key)
    if s == "" {
        return def, nil
    }
    v, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("env %s: %w", key, err)
    }
    return v, nil
}
```

For a service, `viper`, `kong`, or a custom config loader handles
this. For a one-off script, the helper is enough.

## 14. Cross-references

For the production patterns built on these primitives, see the
professional file. For the API tables, see the specification.

- [`../04-encoding-json/`](../04-encoding-json/index.md) —
  `encoding/json` uses `FormatFloat` and `Quote` internally.
- [`../18-fmt/`](../18-fmt/index.md) — `fmt` is the slower,
  feature-rich alternative.
- [`../19-strings-bytes/`](../19-strings-bytes/index.md) —
  `Builder` + `AppendInt` is the zero-alloc combination.
