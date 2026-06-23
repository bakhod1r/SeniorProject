# 8.19 `strings` and `bytes` — Tasks

> Hands-on exercises. Each task has acceptance criteria; pass them
> all before moving on. Reference solutions live in the senior and
> professional files. No grading rubric is needed; if your code
> meets the criteria and the included tests pass, you're done.

## T1 — Word frequency counter

Write `func WordFreq(r io.Reader) (map[string]int, error)` that
reads text from `r`, splits on Unicode whitespace, lowercases each
word, and returns counts. Words are compared case-insensitively.

**Acceptance:**

- Uses `bufio.Scanner` with `bufio.ScanWords`, not `io.ReadAll` plus
  `strings.Fields` (must stream).
- Words have leading/trailing punctuation stripped (`hello,` →
  `hello`).
- Lowercasing uses `strings.ToLower`, not byte arithmetic.
- A 100 MB input file uses < 10 MB of heap (peak RSS).
- Tested with at least three inputs: ASCII, mixed Unicode, and a
  file with one very long line (>1 MB).

## T2 — CSV parser using `strings.Cut`

Write `func ParseCSV(line string) []string` that splits a single
CSV line on commas, supporting quoted fields with `""` as an escape.

**Acceptance:**

- Allocates at most one slice (the result), no intermediate strings
  for unquoted fields (use substring views).
- Handles `"a,b","c""d",e` → `["a,b", "c\"d", "e"]`.
- Empty fields preserved: `a,,b` → `["a", "", "b"]`.
- Trailing comma adds an empty field: `a,b,` → `["a", "b", ""]`.
- No regex. Uses `strings.Cut` and `strings.IndexByte` only.

## T3 — Template renderer with `strings.Builder`

Write `func Render(template string, vars map[string]string) string`
that substitutes `{{name}}` placeholders. Unknown variables expand
to `""`. Use `strings.Builder` with `Grow` sized correctly.

**Acceptance:**

- One allocation for the result (verified by `testing.AllocsPerRun`
  ≤ 1).
- Handles overlapping markers correctly: `"{{a}}{{b}}"` →
  expansion of both.
- Unbalanced markers (`{{a`) appear verbatim in output.
- Benchmark beats `strings.NewReplacer` for ≤ 10 variables.

## T4 — Ring buffer with `bytes.Buffer`

Wrap `bytes.Buffer` in a fixed-capacity ring: when `Write` would
exceed capacity, drop oldest bytes first. Implement `io.Writer` and
a `Bytes() []byte` snapshot.

**Acceptance:**

- Capacity is configurable at construction.
- Writes beyond capacity discard the oldest data, not the new data.
- `Bytes()` returns the current contents in order (oldest first).
- Reuse across many writes does not grow allocation beyond capacity
  (verified with `runtime.ReadMemStats` before/after a million
  writes).

## T5 — Pool-backed string sanitizer

Implement the `sanitize.LogLine` function from the professional file
yourself. Use a package-level `sync.Pool` for `*strings.Builder`,
cap outputs at 200 runes, replace control characters with `?`, and
collapse `\r\n\t` to a single space.

**Acceptance:**

- 1 allocation per call (the final string).
- A Builder whose final `Cap() > 1024` is dropped, not pooled.
- Concurrent calls from 100 goroutines pass `go test -race`.
- Benchmark output: `BenchmarkLogLine` < 200 ns/op for a 50-char
  input on amd64.

## T6 — Frame splitter for `bufio.Scanner`

Write `func FramedSplit(data []byte, atEOF bool) (advance int, token []byte, err error)`
that reads length-prefixed frames: a 4-byte big-endian length
followed by that many bytes of payload. Plug it into
`bufio.Scanner` and test with a stream of 10k frames.

**Acceptance:**

- Returns `(0, nil, nil)` when more data is needed.
- Returns `(0, nil, io.ErrUnexpectedEOF)` when `atEOF` is true and
  the buffer holds a partial frame.
- Handles `Scanner.Buffer(max)` correctly when a frame exceeds the
  default `bufio.MaxScanTokenSize`.
- Zero allocations per frame after warm-up.

## T7 — Unicode-safe truncate

Write `func TruncateRunes(s string, max int) string` that returns
the first `max` runes of `s`. Don't split a multi-byte rune mid-way.

**Acceptance:**

- Uses `utf8.DecodeRuneInString` (or `range`) rather than byte
  indexing.
- `TruncateRunes("héllo", 3) == "hél"`.
- `TruncateRunes("hi", 10) == "hi"` (does not pad).
- Returns the original string (no allocation) when `max >=
  RuneCountInString(s)`.

## T8 — Build a tag-stripper

Write `func StripTags(s string) string` that removes anything
between `<` and `>` from `s`, including the brackets. Don't try to
parse HTML — just remove the tags.

**Acceptance:**

- Uses `strings.IndexByte` for the search.
- One pass, one allocation (`strings.Builder`).
- Unmatched `<` (no closing `>`) is preserved through to end of
  input.
- Benchmark: 5× faster than `regexp.MustCompile("<[^>]*>").ReplaceAllString`.

## T9 — Multi-pattern replacer with priority

Write `func PriorityReplace(s string, repls []struct{ Old, New string })`
that applies replacements in order, where each pair is applied only
to text that has not already been replaced. (This is harder than
`Replacer` because `Replacer` chooses the longest match; you must
chain.)

**Acceptance:**

- Replacements applied in the given order.
- Replaced regions are not re-scanned by later pairs.
- Test: `[{"a","bb"}, {"b","c"}]` applied to `"a"` returns `"bb"`,
  not `"cc"`.
- O(n × len(repls)) worst-case time, O(n) per pass.

## T10 — Streaming line filter

Write a command-line tool `linefilter` that reads stdin line-by-
line, applies a list of substring filters (provided as args),
and writes lines that match all filters to stdout.

**Acceptance:**

- Uses `bufio.Scanner` with a 64 MB max buffer.
- Multiple filters: all must match (`AND`).
- A `-v` flag inverts (line must match NONE of the filters).
- 1 GB input streams through in < 5 seconds on a recent machine.
- `go test ./...` passes.

## Stretch tasks

### S1 — Pure-Go fixed-buffer JSON encoder for a known struct

Without using `encoding/json`, write a `func EncodeUser(u User, dst []byte) []byte`
that appends JSON for a `User{ID int, Name string, Email string}`
struct directly to `dst`. Use `strconv.AppendInt`, `strconv.AppendQuote`,
and raw byte writes. Beat `encoding/json` by ≥ 5× in
`BenchmarkEncodeUser`.

### S2 — Zero-allocation `strings.Cut` loop for a single goroutine parser

Build a query-string parser that processes 1M key=value pairs
streamed from a network connection without allocating per pair.
Use `strings.Cut`, store keys/values into a pre-allocated
`map[string]string` (recycle between requests), and benchmark
allocs/op == 0 after warm-up.

### S3 — Compare `Replacer` vs hand-rolled byte loop for HTML escape

Write a benchmark suite comparing:

1. `html.EscapeString`
2. A package-level `strings.NewReplacer`
3. A custom function with `bytes.IndexByte` and a switch.

For each, report ns/op and allocs/op on inputs sized 10 B, 1 KB,
and 1 MB. Explain which wins at each size and why.

### S4 — Implement `strings.Builder` from scratch

Write `mybuilder` with the same API (`Write`, `WriteString`,
`WriteByte`, `WriteRune`, `Reset`, `Grow`, `Len`, `Cap`, `String`).
Implement the copy-check using a self-pointer the same way the
stdlib does. Test that copying your builder by value panics on
next use. Diff your implementation against `$GOROOT/src/strings/builder.go`
and note any differences.

### S5 — Build a UTF-8 validator from scratch

Write `func IsValidUTF8(b []byte) bool` without calling
`utf8.Valid`. Match the standard table (RFC 3629): 1-byte
sequences in 0x00–0x7F; 2-byte sequences starting C2–DF; 3-byte
sequences starting E0–EF (with constraints on the trailing
bytes); 4-byte sequences F0–F4. Test against `utf8.Valid` on a
fuzz corpus.
