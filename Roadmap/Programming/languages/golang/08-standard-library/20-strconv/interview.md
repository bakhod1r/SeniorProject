# 8.20 `strconv` — Interview

> **Audience.** Both sides of the table. Questions are tagged by
> level. Each answer is what a strong response sounds like — short,
> specific, and shows the candidate has shipped Go that handles
> numeric input/output at scale.

## Junior

### Q1. What's the difference between `strconv.Atoi` and `strconv.ParseInt`?

`Atoi` is decimal-only and returns `int`. `ParseInt(s, base, bitSize)`
is the general form: it accepts a `base` (2–36, or 0 for auto-detect)
and a `bitSize` to validate the range against. `Atoi` is a fast path
for the common case `ParseInt(s, 10, 0)`. Both return `*strconv.NumError`
on failure with `ErrSyntax` or `ErrRange` chained.

### Q2. Why does `strconv.ParseFloat` always return `float64`?

So the caller knows what type to expect regardless of `bitSize`. The
`bitSize` parameter controls rounding: with `32`, the result rounds
to a `float32`-representable value, so a subsequent `float32(f)` cast
is exact. With `64`, the result has full `float64` precision. The
return type stays uniform — `float64` — to avoid two different
function signatures.

### Q3. What does `strconv.ParseBool("yes")` return?

An error. `ParseBool` only accepts the Go literal forms: `"1"`,
`"t"`, `"T"`, `"true"`, `"True"`, `"TRUE"`, and their `false`
equivalents. For HTTP-style `"yes"`/`"no"` or `"on"`/`"off"`, you
need a custom helper.

### Q4. Why is `fmt.Sprintf("%d", x)` slower than `strconv.Itoa(x)`?

Three reasons: `Sprintf` parses the format string `"%d"` at every
call; `x` gets boxed into an `interface{}` (a two-word allocation
plus type dispatch); `fmt` then type-switches and dispatches to the
int formatter. `Itoa` skips all three steps — it knows the argument
is an `int` at compile time and reaches the digit-emission code
directly. Typical speedup is 5–10×.

### Q5. How do you read the error from `strconv.ParseInt`?

It returns `*strconv.NumError`, which wraps either
`strconv.ErrSyntax` (malformed input) or `strconv.ErrRange`
(value too large for the target). Use `errors.Is`:

```go
v, err := strconv.ParseInt(s, 10, 64)
switch {
case errors.Is(err, strconv.ErrRange):
    // overflow
case errors.Is(err, strconv.ErrSyntax):
    // not a number
case err == nil:
    // ok
}
```

## Middle

### Q6. When should you use `strconv.AppendInt` instead of `Itoa`?

When you're already accumulating output into a `[]byte` and don't
need an intermediate string. `Itoa` allocates a fresh string;
`AppendInt(buf, i, 10)` writes into `buf`'s tail capacity and
returns the updated slice. Combined with a pooled buffer or a
stack-allocated array, this gives zero allocations per number.
This is the foundation of every fast JSON encoder.

### Q7. What does `strconv.ParseInt(s, 0, 64)` do?

The `base == 0` argument enables auto-detection based on the input's
prefix: `0x` or `0X` for hex, `0b` or `0B` for binary (Go 1.13+),
`0o` or `0O` for octal (Go 1.13+), a leading `0` followed by digits
for legacy C-style octal, otherwise decimal. Useful for parsing
config values where users may write the same constant in different
forms.

### Q8. Why does `strconv.FormatFloat(f, 'g', 2, 64)` round 3.14159 to "3.1" instead of "3.14"?

For `'g'` / `'G'`, the `prec` argument is **total significant
digits**, not digits after the decimal. So `prec=2` gives two
significant digits total: `"3.1"`. To get two decimal places, use
`'f'` instead: `FormatFloat(f, 'f', 2, 64)` → `"3.14"`.

### Q9. What's the round-trip guarantee, and which `FormatFloat` call gives it?

`FormatFloat(f, 'g', -1, 64)` (and `'e'`/`'f'` with `prec=-1`)
produces the shortest decimal string that, when parsed back with
`ParseFloat`, recovers the exact same `float64` bit pattern. This
is the Ryū algorithm (Go 1.12+). Any other `prec` value sacrifices
the guarantee for fixed precision. JSON encoding of floats uses
`prec=-1` for this reason.

### Q10. What's the difference between `strconv.Quote("hello\n")` and `fmt.Sprintf("%q", "hello\n")`?

Both produce a Go-syntax quoted string with the same escape rules.
`Quote` is direct: it parses the input and writes the output.
`Sprintf("%q", ...)` goes through `fmt`: parses the format string,
boxes the argument, dispatches on type, calls into the quote logic.
For a single quote operation, `Quote` is 5–10× faster. The output
is identical except in rare Unicode edge cases (both follow Go
syntax).

### Q11. What's `strconv.IntSize`?

A constant set to `32` or `64` based on the build target's `int`
width. Used internally by `ParseInt`/`ParseUint` when `bitSize == 0`.
Avoid relying on it in your own code; explicit `32`/`64` makes the
behavior independent of the build target.

## Senior

### Q12. Walk me through `strconv.Itoa` performance for small integers.

The implementation has a 2-digit-at-a-time table called `smallsString`.
For values 0–99, it's a direct slice lookup into "00".."99". For
values 100+, it divides by 100 (the compiler turns this into a
multiply by a magic constant) and indexes the table for the low
two digits, then recurses on the high part. This is twice as fast
as a digit-at-a-time loop. The table is 200 bytes — fits in one
cache line for the lower half — so the table lookups are L1-cache
hits.

### Q13. What algorithm does `ParseFloat` use?

Two-stage. First, the **Eisel-Lemire** algorithm (Go 1.15+) tries
to compute the result with 64-bit fixed-point arithmetic; it
succeeds for ~95% of real-world inputs and is very fast. On
failure (extreme magnitudes, certain edge cases), it falls back to
an extended-precision **decimal** structure that performs
arbitrary-precision multiplication with precomputed powers of 10.
The fallback is much slower but always correct.

### Q14. What's `Ryū` and why does Go use it?

`Ryū` (Ulf Adams, 2018) is the algorithm `strconv.FormatFloat` uses
when `prec == -1`. It produces the **shortest decimal string** that
unambiguously round-trips through `ParseFloat`. The naive approach
— print 17 digits and trim — doesn't have this property. Ryū uses
a combination of precomputed tables and exact integer arithmetic to
determine the minimum digit count in O(1) per input. Go adopted it
in 1.12.

### Q15. Why is `NumError.Num` a string and not a `[]byte`?

For compatibility with error formatting and `errors.As`-style
inspection. Errors are typically logged or printed, so a string is
the natural form. The cost is one allocation on the failure path —
acceptable because failures are presumed rare. If you have a parser
that sees many failures, instrument the failure rate and consider
pre-validating cheaply (length, leading character) before calling
`Parse*`.

### Q16. When would you write a custom integer parser instead of using `Atoi`?

When you have **known-good input** and `Atoi`'s general checks
(empty string, sign, range validation) are pure overhead. For a
binary protocol where you know the field is exactly N ASCII
digits, a hand-written `n = n*10 + int(c-'0')` loop is 5–10×
faster. Caveat: the custom version produces silent garbage on bad
input. Pair it with a length check, a byte-set validation, or a
fuzz test that proves the upstream framing guarantees validity.

### Q17. How does `strconv.Unquote` handle invalid UTF-8 escapes?

After processing all escape sequences, it validates the result is
UTF-8. An escape that produces a high byte without a continuation
(e.g., `\x80`) is invalid UTF-8 and rejected. The exception is
single-byte content inside a rune literal (single-quoted), where
the raw byte is preserved. For most callers this distinction
doesn't matter — but it's why `Unquote` can reject input that
looks fine syntactically.

## Professional

### Q18. Design a CSV ingester that processes 10M rows per second of integer/float data. What's the architecture?

Start with `bufio.Scanner` for line framing. Use `scanner.Bytes()`
(not `Text()`) to avoid the per-line allocation. Write a custom
field parser that uses `bytes.IndexByte(',')` to find delimiters
and parses integers with a hand-rolled loop (since you control the
upstream and know it's well-formed). Reserve `strconv.ParseFloat`
for the float column — there's no cheap way to roll your own
float parser correctly. Combine with a worker pool: one goroutine
per CPU core, each consuming a channel of pre-tokenized rows.
Profile to confirm the bottleneck is the float parse, not framing.
If float parsing is the bottleneck, batch by column and use SIMD
(via assembly) — though this rarely matters before 10M rows/sec.

### Q19. Your service silently accepts malformed integer query parameters because `strconv.Atoi(s)` returns 0 for both invalid input and the legitimate value `"0"`. How do you fix it without breaking valid clients?

Three options, in increasing strictness:

1. **Check the error**: `v, err := strconv.Atoi(s); if err != nil { http.Error(...); return }`.
   The fix everyone should do; surfaces the failure at request time.
2. **Validate before parse**: cheap length and character class
   checks, then parse. Useful when failures are common and you want
   to avoid the `NumError` allocation.
3. **Schema-driven validation**: use a struct with `json:`-style
   tags and a library like `go-playground/validator` that rejects
   missing/invalid fields before they reach your handler.

The choice depends on whether the field is required, what the
"missing" semantics should be, and whether you care about
observability (option 1 makes failures countable).

### Q20. A senior engineer on your team wrote `fmt.Sprintf("%.4f", price)` in a 200k req/s pricing service. CPU profile shows it's the top frame. What do you change?

Replace with `strconv.AppendFloat(buf, price, 'f', 4, 64)` into a
pooled buffer. If the result needs to be a string, copy from the
buffer to a final `string(buf)` once; if it goes to an `io.Writer`,
write the bytes directly without ever materializing the string.
The savings: no format-string parsing, no `interface{}` boxing, no
intermediate string allocation. Expect a 5× speedup on that frame.

Document the change with a comment explaining "Sprintf is slow at
this volume" so future readers don't revert it for readability.

### Q21. What policies do you set for `strconv` use in a high-throughput Go codebase?

Four rules cover most cases:

1. `Sprintf` is banned for single-value serialization. Code review
   or a linter enforces. Use `Itoa`, `FormatFloat`, etc.
2. `Atoi`/`Parse*` errors are never silently discarded. The
   `v, _ := strconv.Atoi(s)` pattern requires a comment explaining
   why a zero on failure is intentional.
3. `bitSize` always matches the destination type. `ParseInt(s, 10,
   32)` for a `int32`, not `ParseInt(s, 10, 64)` followed by a
   cast.
4. `Append*` is preferred in serialization paths. The team builds a
   small library of "appender" helpers for common shapes (e.g., a
   user-id-formatter, a duration-formatter) and reaches for those.

## Bonus

### Q22. What does `strconv.FormatFloat(0.1, 'f', -1, 64)` return?

`"0.1"`. The Ryū-shortest round-trip representation. Even though
the bit pattern of `float64(0.1)` is
`0.1000000000000000055511151231257827021181583404541015625`, the
shortest decimal that parses back to the same bit pattern is
`"0.1"`. This is why JSON-encoded Go floats are stable.

### Q23. Can `strconv.ParseInt(s, 10, 64)` overflow?

No — it returns `ErrRange` for values outside `[-2^63, 2^63 − 1]`.
The implementation accumulates into a `int64` and checks for
overflow before each multiply. The careful loop ensures that even
adversarial input (`"99999999999999999999999"`) is rejected with
`ErrRange` without ever producing a wrong value.

### Q24. Why is `strconv.Itoa(math.MinInt64)` correctly `"-9223372036854775808"` even though `-math.MinInt64` overflows?

The implementation detects the negative case, emits the `-` sign,
and treats the magnitude as `uint64`. `uint64(int64(math.MinInt64))`
produces `0x8000000000000000`, which is a valid (large positive)
`uint64`. The formatter then converts that to decimal normally.
The same trick handles all negative `int64` values without ever
performing the overflow-prone `-i` operation.

### Q25. What's the relationship between `strconv` and `encoding/json`?

`encoding/json` uses `strconv` for the leaf number conversions:
`FormatFloat(f, 'g', -1, 64)` for floats, `FormatInt(i, 10)` for
ints, `AppendFloat`/`AppendInt` in the streaming encoder. The
quoting of string fields uses `strconv.AppendQuote`-style escape
rules (though the implementation is in `encoding/json` itself
because JSON escape rules differ slightly from Go's).

If you want to know why `json.Marshal` of a float produces a
particular string, read `strconv.FormatFloat` — that's the actual
code.
