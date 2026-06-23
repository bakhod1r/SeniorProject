# 8.8 `regexp` — Tasks

> **Audience.** You've read [junior.md](junior.md) and at least the
> first half of [middle.md](middle.md). These exercises range from
> "ten minutes" to "an evening" each. Each task lists a problem
> statement, acceptance criteria, and a stretch goal. No solutions.

Common ground rules:

- All patterns must compile via `regexp.MustCompile` at package init,
  never inside a hot loop.
- Run with `go test -race` if you spawn goroutines. Any race fails.
- Prefer `[]byte` methods if your input is already `[]byte`; prefer
  `string` methods if your input is already `string`.
- Wrap errors with `%w` and surface them — never swallow.

## 1. Word counter

Build `wordcount` that reads stdin and prints a count of unique
"words." Define a word as one or more Unicode letter runes
(`\p{L}+`).

**Acceptance criteria.**

- Compiles a single pattern at package init.
- Uses `bufio.Scanner` to read line-by-line; never loads the entire
  input into memory.
- Counts words case-insensitively (treat `Foo` and `foo` as the same
  word).
- Prints in descending count order; ties break alphabetically.
- Handles non-ASCII text correctly: "café" is one word, "北京" is one
  word.
- Has a unit test that passes a `strings.Reader` and asserts on a
  `bytes.Buffer` output.

**Stretch.** Add a `-min N` flag that filters out words appearing
fewer than N times. Add a `-top K` flag that keeps only the top K
words.

## 2. ISO 8601 date validator

Build a function `validateDate(s string) (year, month, day int, ok bool)`
that accepts dates in `YYYY-MM-DD` form.

**Acceptance criteria.**

- Pattern uses character ranges (not loose `\d{4}`) so that month is
  `01-12` and day is `01-31`.
- Returns `false` for empty string, dates with the wrong separators
  (`2026/01/01`), and dates with leading/trailing whitespace.
- Returns `false` for `2026-02-30` and `2026-13-01` — verify with
  `time.Parse(time.DateOnly, s)` after the regex passes (the regex
  alone can't catch impossible-date combinations).
- Returns the parsed integers when `ok` is true.

**Stretch.** Extend to handle ISO 8601 *datetime* with optional
timezone: `2026-01-01T12:00:00Z`, `2026-01-01T12:00:00+03:00`.

## 3. Find-and-redact tool

Build `redact` that reads stdin and writes stdout, replacing certain
patterns with `[REDACTED]`:

- Email addresses (rough match — `\S+@\S+\.\S+` is OK).
- IPv4 addresses.
- 16-digit credit-card-like numbers (`\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b`).

**Acceptance criteria.**

- All three patterns compiled once at package init.
- Streams input — does not buffer the whole stream.
- Each match is replaced with `[REDACTED]` (no submatch interpolation
  needed).
- Test cases include: a line with one email, a line with two emails,
  a line with overlapping candidates (e.g., an IP inside a URL).

**Stretch.** Add a `-mask` flag that replaces with the same number of
`*` characters as the original match length, preserving line widths.
Add a `-types email,ip` flag to enable only specific patterns.

## 4. Log-line parser

Given log lines like:

```
2026-05-06T12:34:56Z level=INFO method=GET path=/users/42 status=200 duration=14ms
```

Build a function that extracts `level`, `method`, `path`, `status`,
`duration` into a struct.

**Acceptance criteria.**

- Uses *one* regex with named capture groups: `(?P<level>...)`,
  `(?P<method>...)`, etc.
- Extracts via `SubexpIndex(name)`, not numeric indices.
- Returns an error when a line doesn't match the pattern.
- Has tests for: well-formed lines, lines with extra fields (the
  regex should still match), lines missing a field (should return
  an error), and lines with weird whitespace.

**Stretch.** Make the field set configurable: pass a list of field
names, build the pattern dynamically. Validate that every requested
field has a non-empty match.

## 5. Streaming substitution

Build `streamReplace` that reads from `io.Reader`, writes to
`io.Writer`, and applies a regex substitution. Signature:

```go
func streamReplace(r io.Reader, w io.Writer, re *regexp.Regexp, repl string) error
```

**Acceptance criteria.**

- Streams in chunks; never loads the entire input into memory.
- Handles matches that don't span newlines (use `bufio.Scanner` with
  `ScanLines`).
- Document the limitation: matches that *would* span newlines are
  not detected because each line is processed independently.
- Writes substitution results immediately (don't buffer the full
  output).
- Test with a 100 MB input (use `iotest.OneByteReader` to simulate
  short reads) and assert constant memory.

**Stretch.** Make it work with the underlying `MatchReader`-style
streaming API for patterns that span newlines, but document the
trade-off (more buffer, no chunking guarantee).

## 6. Pattern complexity validator

Build a function `validatePattern(pattern string) error` that uses
`regexp/syntax` to check whether a pattern is "safe to compile" by
your house rules.

**Acceptance criteria.**

- Returns an error if `len(pattern) > 1024`.
- Returns an error if the parsed AST has more than 100 alternatives
  (`OpAlternate` nodes).
- Returns an error if the compiled program has more than 5,000
  instructions (`len(prog.Inst)`).
- Pattern that fails parsing returns a wrapped `regexp/syntax.Error`.
- Tests cover: long patterns, deeply nested patterns, simple patterns
  that pass.

**Stretch.** Add a check for "too many capturing groups" (over 50)
and "too many character classes" (over 100). Surface a structured
error type with a `Reason` field instead of a string.

## 7. Multi-pattern dispatcher

Build a `Dispatcher` that registers multiple patterns with handler
functions and dispatches an input to the first matching handler.

**Acceptance criteria.**

- `Register(name, pattern string, handler func(matches []string)) error`
  compiles the pattern and stores it.
- `Dispatch(input string) (string, error)` runs each registered
  pattern in registration order, returning the name of the matching
  handler.
- For the matching pattern, the handler receives the submatches
  (whole match at index 0, captures at 1+).
- If no pattern matches, returns `"", ErrNoMatch`.
- Pre-filter with `LiteralPrefix()` — if the prefix doesn't match the
  input, skip the regex.

**Stretch.** Make the dispatcher concurrent-safe: multiple
goroutines can `Dispatch` simultaneously. Add a benchmark comparing
the prefilter version vs naive sequential matching on 1,000 patterns.

## 8. Concurrent regex pipeline

Build a pipeline that reads lines from one channel, applies a
substitution via a regex, and writes results to another channel.
Multiple worker goroutines share a single `*Regexp`.

**Acceptance criteria.**

- The regex is compiled once and shared (not copied per worker).
- Workers run concurrently — verify with `-race`.
- Handles cancellation via `context.Context`: closing the input
  channel or cancelling the context drains workers cleanly.
- A unit test starts the pipeline, sends 10,000 lines, cancels
  partway, and asserts no goroutines leak (`runtime.NumGoroutine`
  before/after).

**Stretch.** Add backpressure: the output channel has a small
buffer, so workers block until consumers catch up. Add a metric for
the average queue depth.

## 9. Allocation-free counter

Build `countMatches(re *regexp.Regexp, r io.Reader) (int, error)`
that counts occurrences of `re` in the input stream.

**Acceptance criteria.**

- Uses `[]byte` API end-to-end.
- Uses `bufio.Scanner.Bytes()` to avoid string allocation.
- Allocates O(1) memory regardless of input size — verify with
  `testing.B` and `b.ReportAllocs()`.
- Counts matches per line correctly: a single line with 5 matches
  counts as 5.
- Handles long lines by raising the scanner cap to 1 MiB.

**Stretch.** Benchmark against a naive version that uses
`re.FindAllString(line, -1)` per line. Aim for at least 5x speedup
on a 100 MB input with a million matches.

## 10. URL slug generator

Build `slugify(title string) string` that converts a title to a
URL-safe slug.

**Acceptance criteria.**

- Lowercases the input (Unicode-aware).
- Replaces runs of non-letter, non-digit characters with a single
  `-`.
- Strips leading and trailing `-`.
- Uses `\p{L}` and `\p{N}` (Unicode-aware classes), not `\w`.
- Tests cover: ASCII titles, mixed-script titles ("Hello, café!"),
  titles with consecutive whitespace, titles consisting only of
  non-letter characters (return `""`).

**Stretch.** Add transliteration for common accented characters
(`café` → `cafe`). The transliteration table can be a small map;
the regex is for the splitting/cleaning step.

## 11. Replace with structured callback

Build `replaceCaptures(re *regexp.Regexp, src string, fn func(captures []string) string) string`
that applies `fn` to each match's submatches.

**Acceptance criteria.**

- The callback receives `captures` where `captures[0]` is the whole
  match and `captures[1:]` are the submatches in order.
- Walks `FindAllStringSubmatchIndex` once — no double-match.
- Builds the result with `strings.Builder` and `Grow` — one
  allocation amortized for the builder.
- Test that the result is identical to a naive
  `ReplaceAllStringFunc` + `FindStringSubmatch` implementation.

**Stretch.** Benchmark the implementation against the naive double-
match version on a 1 MB input with 100,000 matches. Aim for at
least 2x speedup.

## 12. Match-with-deadline

Build `matchWithDeadline(re *regexp.Regexp, input string, deadline time.Duration) (bool, error)`
that runs a match and returns `context.DeadlineExceeded` if the
match takes longer than `deadline`.

**Acceptance criteria.**

- Uses `re.MatchReader` against an `io.RuneReader` that wraps a
  `strings.Reader` and a context.
- The wrapping reader returns the context's error from `ReadRune`
  when the context is done.
- Tests verify: a quick match returns true; a match against a 100 MB
  input with a 1 ms deadline returns the deadline error.
- No goroutine leaks — the context cancellation propagates through
  the matcher.

**Stretch.** Benchmark the wrapper's overhead against a plain
`MatchString` call. Should be under 20% overhead for matches that
finish well before the deadline.

## 13. CSV-ish parser (don't use this in production)

Build a deliberately-bad CSV parser using `regexp.Split` to teach why
real CSV needs `encoding/csv`.

**Acceptance criteria.**

- Splits by comma using a single regex.
- Document at least three failure cases: quoted fields with embedded
  commas, quoted fields with embedded quotes, fields with newlines
  inside quotes.
- Each failure case has a test that demonstrates the wrong output.
- Comments in the code explain why each failure happens.
- Final paragraph in the README points to `encoding/csv` for real
  work.

**Stretch.** Benchmark against `encoding/csv` on a 10 MB CSV file.
The regex version should be 1-3x faster for *simple* CSV (one of the
trade-offs of correctness).

## 14. Pattern cache

Build a `Cache` type that compiles patterns lazily and caches them,
with bounded size and concurrent access.

**Acceptance criteria.**

- `(c *Cache).Get(pattern string) (*regexp.Regexp, error)` returns a
  cached pattern or compiles and caches it.
- Capped at N entries; evicts randomly when full.
- Compile errors are also cached for a short window (10 seconds)
  with a test demonstrating the same bad pattern doesn't re-compile
  on every call within the window.
- Concurrent `Get` calls are safe; `RWMutex` for the read path.
- Benchmark: 1,000 distinct patterns, 1,000,000 calls, mostly hits.
  Should achieve at least 5 million calls/sec/core.

**Stretch.** Add an LRU eviction option. Benchmark random vs LRU on
a Zipf-distributed workload — the LRU should win.

## 15. Capture-group renamer

Build a function `renameGroups(pattern string, oldName, newName string) (string, error)`
that uses `regexp/syntax` to rename a named capture group in a
pattern.

**Acceptance criteria.**

- Parses with `syntax.Parse`, walks the AST, finds nodes with
  `Op == OpCapture && Name == oldName`, and renames them.
- Returns the canonicalized pattern via `String()`.
- Returns an error if `oldName` doesn't exist in the pattern.
- Returns an error if `newName` is already in use.
- Re-compiling the result with `regexp.Compile` succeeds and the new
  name is reachable via `SubexpIndex`.

**Stretch.** Generalize to a transform: `transformAST(pattern string,
transform func(*syntax.Regexp))` lets the caller mutate any node.
Tests show how to use it to remove case-insensitive flags from
specific groups.

## 16. Anchored router

Build a `Router` that maps URL path patterns to handler IDs.

**Acceptance criteria.**

- `Add(pattern, id string) error` accepts patterns like
  `/users/(?P<id>\d+)` and `/articles/(?P<slug>[\w-]+)`.
- Each pattern is anchored automatically (the router prepends `\A`
  and appends `\z` if not already present).
- `Match(path string) (id string, params map[string]string, ok bool)`
  returns the first matching route's id and named captures.
- Patterns are checked in registration order.
- Has unit tests that cover: exact match, multiple capture groups,
  no match returns false, routes can share prefixes without
  conflict.

**Stretch.** Pre-filter routes by literal prefix using
`LiteralPrefix()`. For routes whose prefix matches the path, only
those go through regex matching. Benchmark against the naive linear
scan with 100 routes — aim for at least 3x speedup on a non-matching
path.

## 17. Custom split function

Build `splitWithDelim(re *regexp.Regexp, s string) ([]string, []string)`
that returns both the split pieces *and* the matched delimiters.

**Acceptance criteria.**

- For `re = \s+` and `s = "hello   world  go"`:
  - pieces: `["hello", "world", "go"]`
  - delimiters: `["   ", "  "]`
- The lengths satisfy `len(pieces) == len(delimiters) + 1` for any
  non-empty input.
- Uses `FindAllStringIndex` to walk the input once.
- Works on edge cases: empty string, leading/trailing delimiters,
  consecutive delimiters.

**Stretch.** Add a callback variant: `splitWithDelimFunc(re, s,
func(piece, delim string))` that calls `fn` for each piece+delim
pair (the last call passes `""` for the trailing delim).

## 18. Pattern transformer

Using `regexp/syntax`, build a function `addCaseInsensitive(pattern string) (string, error)`
that returns the input pattern wrapped in `(?i:...)`.

**Acceptance criteria.**

- Parse via `syntax.Parse(pattern, syntax.Perl)`.
- Wrap the parsed AST in a new `OpCapture` (or `OpConcat` with a
  flag-setting prefix) and return the canonical string form.
- Verify by compiling the result with `regexp.Compile` and asserting
  it produces case-insensitive matches.
- Test with patterns that already have `(?i)` — should not
  double-wrap.

**Stretch.** Generalize to `addFlags(pattern, flags string) (string,
error)`. Handle conflicting flags: `addFlags("(?-i)foo", "i")` should
note the conflict and return an error or strip the negation.

## 19. Streaming match counter with backpressure

Build `countMatchesAsync(ctx context.Context, re *regexp.Regexp, r io.Reader, workers int) (int, error)`
that distributes matching work across N workers using a channel.

**Acceptance criteria.**

- Reads lines via `bufio.Scanner` and sends them to a channel.
- N worker goroutines read lines and run `re.Match`.
- Workers report counts via an output channel; one goroutine sums them.
- Cancellation via `ctx` propagates: cancel mid-scan and all
  goroutines exit cleanly within 100 ms.
- No goroutine leaks (verify with `runtime.NumGoroutine` before/after).
- The `bufio.Scanner` is in its own goroutine; the channel buffer is
  small (e.g., 16) to provide backpressure.

**Stretch.** Add a metric for queue depth (peak observed). Benchmark
with 1, 2, 4, 8 workers on a 100 MB log and report the speedup.

## 20. Self-check

After completing the tasks above, you should be able to answer the
following without looking anything up:

- Why does compiling a pattern in a loop cripple throughput?
- What's the difference between `Find` and `FindIndex`?
- How does `(?i)` differ from `[Aa][Bb][Cc]` in cost and correctness?
- Why is `\p{L}` better than `\w` for user-facing text?
- When should you reach for `regexp/syntax` rather than `regexp`?
- What does `LiteralPrefix()` give you, and how do you use it?
- Why is `Copy()` deprecated?
- What's the cost difference between `MatchString` and `FindString`
  on a non-matching input? On a matching input?

If any of these are fuzzy, re-read the relevant section of
[junior.md](junior.md), [middle.md](middle.md), or [senior.md](senior.md)
and try the closest task above again.
