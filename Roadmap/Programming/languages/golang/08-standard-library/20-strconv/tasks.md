# 8.20 `strconv` — Tasks

> Hands-on exercises. Each task has acceptance criteria; pass them
> all before moving on. Solutions are not provided — write your own.
> When the task says "no allocations", measure with
> `testing.AllocsPerRun` and assert ≤ 1 (the result string, which
> is unavoidable).

## T1 — Robust env-var parser

Write `func EnvInt(key string, def int) (int, error)` that reads
`os.Getenv(key)`, returns `def` if empty, and parses otherwise.

**Acceptance:**

- Wraps the `*strconv.NumError` with the env key name so the error
  is debuggable.
- Returns `(def, nil)` when the variable is unset.
- Returns `(0, err)` when the variable is set but malformed.
- Add tests for: unset, empty string, valid int, invalid int,
  overflow.

## T2 — Hex token decoder

Parse a hex token like `"deadbeef"` or `"0xDEADBEEF"` into a
`uint64`. Reject leading whitespace, signs, and decimal digits
outside hex range.

**Acceptance:**

- Accepts both `"deadbeef"` (no prefix) and `"0xdeadbeef"` (with).
- Case-insensitive hex digits.
- Rejects `" deadbeef "`, `"+deadbeef"`, `"deadbeeg"`.
- Use `strconv.ParseUint(s, 16, 64)` with prefix stripping.

## T3 — Currency formatter

Write `func FormatCents(c int64) string` that produces "$1,234.56"
from `123456`. Use `strconv.AppendInt` plus manual comma insertion
into a pooled buffer.

**Acceptance:**

- One allocation per call (the result string).
- Handles negative values: `-100` → `"-$1.00"`.
- Handles zero: `0` → `"$0.00"`.
- Handles very large values: `math.MaxInt64` formatted correctly.
- 5× faster than `fmt.Sprintf("$%d.%02d", c/100, c%100)` with
  comma post-processing.

## T4 — Hand-rolled `Atoi` for known-good input

Implement `func atoiFast(b []byte) int` that parses ASCII decimal
without any validation. Assume the caller has verified the input.

**Acceptance:**

- Returns correct values for `"0"`, `"1"`, `"42"`, `"123456789"`.
- Returns garbage (silently) for non-digit input — this is the
  point.
- Benchmark vs `strconv.Atoi(string(b))`: 5–10× faster.
- Add a fuzz test that compares against `strconv.Atoi` for valid
  inputs only.

## T5 — Zero-allocation JSON-int encoder

Write `func AppendJSONInt(dst []byte, i int64) []byte` that emits
the JSON representation of an integer.

**Acceptance:**

- Equivalent to `strconv.AppendInt(dst, i, 10)`.
- Benchmark vs `json.Marshal(i)` on a single `int64`: 10× faster.
- Test that the output round-trips through `json.Unmarshal`.
- Test boundary values: `0`, `1`, `-1`, `math.MaxInt64`,
  `math.MinInt64`.

## T6 — Robust float input sanitizer

Write `func ParseUserFloat(s string) (float64, error)` that
accepts:

- ASCII decimal: `"3.14"`, `"-3.14"`.
- European decimal: `"3,14"` (comma as separator).
- Whitespace: `" 3.14 "`.
- Underscores: `"1_234.56"` (Go-style group separator).

**Acceptance:**

- Wrap `strconv.ParseFloat` after normalization.
- Test that `"1_234.56"` parses to `1234.56`.
- Test that `"3,14"` parses to `3.14`.
- Reject `"3.1.4"`, `"abc"`, `""`.

## T7 — Custom-base encoder

Write `func FormatBase62(n uint64) string` that emits a base-62
string using `0-9a-zA-Z`. (`strconv.FormatUint` is base 2–36 only.)

**Acceptance:**

- `FormatBase62(0)` → `"0"`.
- `FormatBase62(61)` → `"Z"`.
- `FormatBase62(62)` → `"10"`.
- Round-trip through your own `ParseBase62`.
- Benchmark: < 100 ns/op.

## T8 — Range-checked integer parser

Write `func ParseRange(s string, min, max int) (int, error)` that
parses `s` as an int and validates `min ≤ v ≤ max`. Use
`strconv.ParseInt` with the appropriate `bitSize`.

**Acceptance:**

- Returns the parse error for malformed input.
- Returns a domain-specific error for out-of-range valid integers.
- Use `errors.Is` to distinguish in tests.
- The domain error includes `min`, `max`, and the parsed value.

## T9 — Hex dump with `strconv.Quote`

Write `func DumpString(s string) string` that produces a
representation of `s` showing both the human-readable form and
the byte values for control characters.

**Acceptance:**

- For `"hello"`: outputs `"hello"`.
- For `"hello\nworld"`: outputs `"hello\nworld"` (with the `\n`
  literally).
- Use `strconv.Quote` then strip the outer quotes.
- Test against UTF-8 strings, invalid UTF-8, and edge cases like
  empty string.

## T10 — Bool parser for HTTP query params

Write `func ParseLooseBool(s string) (bool, error)` that accepts
all common variants: `"true"`, `"false"`, `"yes"`, `"no"`,
`"on"`, `"off"`, `"1"`, `"0"`, `""` (empty → false). Case-
insensitive.

**Acceptance:**

- All listed inputs parse correctly.
- Unknown inputs return `ErrSyntax`-style error.
- Performance: faster than `strconv.ParseBool` for the common case
  by avoiding the case-sensitive table.

## Stretch tasks

### S1 — Reimplement `strconv.Itoa` from scratch

Write `myItoa(i int) string` without calling `strconv`. Use the
2-digit-at-a-time trick. Beat `strconv.Itoa` in benchmarks? (You
probably can't — the stdlib uses platform-specific tricks. The
goal is to understand why.)

**Acceptance:**

- Correct for all `int` values including `math.MinInt`.
- Within 50% of `strconv.Itoa` performance.
- Add the 200-byte digit table and explain the cache implications
  in a comment.

### S2 — Allocation-free CSV float parser

Process a 10M-row CSV of single-column floats. Use
`bufio.Scanner` with a custom split function and parse with
`strconv.ParseFloat` directly on the bytes (`string(b)` is
compiler-optimized when used as an argument to a function call).

**Acceptance:**

- Throughput: ≥ 500k rows/sec on amd64.
- Allocations per row: 0 (after warmup, measured by
  `runtime.MemStats`).
- Handles parse errors per row without stopping the whole
  ingestion.

### S3 — A `strconv` replacement that returns `*MyError`

Suppose your team has its own error type. Write a wrapper around
`strconv.ParseInt` that converts `*strconv.NumError` into your
type without losing the original via `errors.Is`/`Unwrap`.

**Acceptance:**

- `MyError` embeds the original `*NumError` and adds context (e.g.,
  field name).
- `errors.Is(err, strconv.ErrSyntax)` works through the wrapper.
- Test the unwrap chain explicitly.

### S4 — `FormatFloat` round-trip fuzzer

Write a fuzz test that, for random `float64` values, asserts:

```go
f1 := /* random */
s := strconv.FormatFloat(f1, 'g', -1, 64)
f2, _ := strconv.ParseFloat(s, 64)
require.True(t, math.Float64bits(f1) == math.Float64bits(f2))
```

Run for 1 minute. Confirm no counterexamples are found.

**Acceptance:**

- Test runs as `go test -fuzz=FuzzRoundTrip`.
- Handles `NaN` correctly (compare bit patterns, not values).
- Logs the input that fails (if any) with full precision.
