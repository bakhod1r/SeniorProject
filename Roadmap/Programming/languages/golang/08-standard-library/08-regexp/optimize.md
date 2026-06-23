# 8.8 `regexp` — Optimize

> **Audience.** Your regex code is correct and you need it faster,
> cheaper, or both. This file covers the structural changes that pay
> off, the micro-tactics that move 10-50%, and the platform tricks
> worth knowing. Always measure before and after.

## 1. Measure first

Before optimizing, profile. The relevant Go profiles:

| Profile | Captures | When to reach |
|---------|----------|---------------|
| CPU profile (`pprof.profile`) | Stack samples while CPU is busy | High CPU, throughput limited |
| Heap profile (`pprof.allocs`) | Where allocations happen | High GC overhead, memory pressure |
| Block profile (`pprof.block`) | Goroutines waiting on sync | Low CPU, low throughput |

```sh
curl -o cpu.prof http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http :8080 cpu.prof
```

Inside the flame graph, look for:

- `regexp.(*Regexp).doMatch` or `regexp.(*Regexp).match` — match time.
- `regexp.compile`, `regexp.Compile`, `regexp.MustCompile` — *if you
  see these in a non-init stack, you have a hot-path compile bug.*
  See [find-bug.md](find-bug.md) section 1.
- `runtime.mallocgc` underneath regex calls — match work allocates.
  Switch to `Match` or index methods.

Benchmark before and after each change:

```go
func BenchmarkExtract(b *testing.B) {
    input := []byte(strings.Repeat("foo bar 123 baz ", 1000))
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = patternRE.FindAll(input, -1)
    }
}
```

A change that's "obviously faster" but doesn't move the benchmark is
a change you don't make.

## 2. Compile once

The biggest single optimization. Move every `MustCompile` out of
hot paths into package-level vars:

```go
// Wrong
func handle(input string) bool {
    re := regexp.MustCompile(`\d+`)
    return re.MatchString(input)
}

// Right
var digitRE = regexp.MustCompile(`\d+`)
func handle(input string) bool {
    return digitRE.MatchString(input)
}
```

Speedup: 100-1000x for short inputs, since compile dominates over
match. Even on long inputs where match is the bottleneck, compile
cost is recoverable engineering time you'll never need to think
about again.

Catch this with linters:

- `staticcheck` flags `SA1000` for compiles inside loops.
- `gocritic` has `regexpMust` for MustCompile in non-init contexts.
- For ad-hoc finding: `grep -rn 'regexp.MustCompile' --include='*.go' .`
  and check that every result is a `var` declaration or in `init()`.

## 3. Use `Match` over `Find` for booleans

| Method | What it does | Allocations |
|--------|--------------|-------------|
| `MatchString(s)` | Returns true iff the pattern matches | 0 |
| `Match(b)` | Same, on bytes | 0 |
| `FindString(s) != ""` | Returns the matched text, then compares | 0-1 |
| `FindStringIndex(s) != nil` | Returns offsets, then checks | 1 (the slice) |

For yes/no decisions, `Match`/`MatchString` is the only correct
choice. It's measurably faster *and* it correctly distinguishes
"matched empty" from "no match" — which the `Find != ""` form gets
wrong.

## 4. Anchor the pattern

If your match must start at the beginning, anchor:

```go
// Unanchored: NFA tries every position
loose := regexp.MustCompile(`error: \w+`)

// Anchored: NFA only at position 0
tight := regexp.MustCompile(`\Aerror: \w+`)
```

Speedup depends on input length. On a 1 MB input where the match is
at position 0, anchoring is roughly 10-100x faster — the engine can
stop after one attempt instead of trying every byte position.

For multi-line input where you want the match at line start, use
`(?m)^...`:

```go
re := regexp.MustCompile(`(?m)^error: \w+`)
```

This is *not* as fast as a true anchor, but RE2 still optimizes line-
start matching. Plus, you avoid loading whole files — pair with
`bufio.Scanner` so each line is matched independently with `^` (or
`\A`) anchored at the start of each line.

## 5. Add a literal pre-filter

When most inputs don't match, a `strings.Contains` check before the
regex is dramatically faster:

```go
var fatalRE = regexp.MustCompile(`(?i)\bfatal\b`)

func looksFatal(line []byte) bool {
    if !bytes.Contains(line, []byte("fatal")) &&
       !bytes.Contains(line, []byte("FATAL")) &&
       !bytes.Contains(line, []byte("Fatal")) {
        return false
    }
    return fatalRE.Match(line)
}
```

If 99% of lines fail the prefilter, average cost drops by 30-90%.
The `bytes.Contains` is O(n) but with very small constants — often
sub-nanosecond per byte on modern CPUs.

For patterns where the literal substring is more obvious, use
`LiteralPrefix()`:

```go
prefix, complete := re.LiteralPrefix()
if !complete && prefix != "" {
    if !bytes.Contains(input, []byte(prefix)) {
        return false
    }
}
return re.Match(input)
```

`LiteralPrefix` returns the literal text the pattern is *guaranteed*
to begin with. RE2 internally already does this scan for prefix-anchored
patterns; the explicit check helps for cases where the prefix only
appears mid-pattern (which RE2 doesn't auto-detect).

## 6. Match on `[]byte`, not `string`

If your data is already bytes, use the `[]byte` API:

```go
// Slow: converts []byte to string (copies + allocates)
re.MatchString(string(buf))

// Fast: same data, no allocation
re.Match(buf)
```

For a 1 MB buffer, the `string()` conversion is a 1 MB allocation per
call. The compiled `*Regexp` doesn't care which entry point you use
— internally, both go through the same matcher.

The reverse holds too: if your data is a string, `Match([]byte(s))`
allocates a copy. Stick with what you have.

## 7. Use index methods to avoid string allocation

`FindAllString` allocates a string per match. `FindAllStringIndex`
allocates a small `[]int` per match instead:

```go
// Allocates strings
matches := re.FindAllString(input, -1) // 1 + N strings

// Allocates only index slices
indices := re.FindAllStringIndex(input, -1) // 1 + N small []int
```

If you're going to slice the input anyway:

```go
for _, idx := range indices {
    sub := input[idx[0]:idx[1]]
    process(sub) // sub is a sub-string, no copy on most architectures
}
```

The result string from a slice expression on a Go string is a header
into the same backing array — no allocation. So `input[a:b]` is
free; `re.FindAllString` is not.

## 8. Combine alternations into one pattern

Three sequential matches are slower than one combined match:

```go
// Slow: three pattern scans
ok := re1.MatchString(s) || re2.MatchString(s) || re3.MatchString(s)

// Fast: one combined scan
combinedRE := regexp.MustCompile(`(?:` + p1 + `)|(?:` + p2 + `)|(?:` + p3 + `)`)
ok := combinedRE.MatchString(s)
```

Speedup: ~3x for the obvious case (one scan instead of three). RE2
also optimizes alternations of literals into a single literal-set
scan internally — `(?:foo|bar|baz)` is faster than three separate
matches.

If you need to know *which* alternative matched, capture each one:

```go
combinedRE := regexp.MustCompile(`(p1)|(p2)|(p3)`)
m := combinedRE.FindStringSubmatchIndex(s)
switch {
case m == nil: // no match
case m[2] >= 0: // p1 matched
case m[4] >= 0: // p2 matched
case m[6] >= 0: // p3 matched
}
```

Combination only works when the alternatives have compatible
semantics (e.g., they're all "find anywhere in input"). Mixing
anchored and unanchored alternatives requires care.

## 9. Avoid `(?i)` for ASCII-only data

`(?i)` enables full Unicode case-folding. For ASCII-only inputs,
either pre-lowercase or use explicit char classes:

```go
// Slow
re := regexp.MustCompile(`(?i)error`)

// Fast for ASCII: char class chain
re := regexp.MustCompile(`[Ee][Rr][Rr][Oo][Rr]`)

// Faster for ASCII: pre-lowercase
re := regexp.MustCompile(`error`)
re.MatchString(strings.ToLower(input))
```

The `strings.ToLower` allocates once but uses a tight ASCII
fast-path. For inputs over a few KiB, it's faster than `(?i)`. For
short inputs (under 100 bytes), `(?i)` may win because the allocation
dominates.

For mixed-script input, you need `(?i)` — the manual lowercasing
won't fold across scripts (e.g., Greek, Turkish dotless I).

## 10. Replace via index walking

`ReplaceAllStringFunc` runs the match twice when you need submatches
inside the callback. The fix: walk indices manually.

```go
// Slow: outer scan + per-match scan
out := re.ReplaceAllStringFunc(s, func(m string) string {
    sm := re.FindStringSubmatch(m)
    return process(sm)
})

// Fast: one scan, manual building
matches := re.FindAllStringSubmatchIndex(s, -1)
var b strings.Builder
b.Grow(len(s))
last := 0
for _, m := range matches {
    b.WriteString(s[last:m[0]])
    captures := make([]string, len(m)/2)
    for i := 0; i < len(captures); i++ {
        if m[2*i] >= 0 {
            captures[i] = s[m[2*i]:m[2*i+1]]
        }
    }
    b.WriteString(process(captures))
    last = m[1]
}
b.WriteString(s[last:])
out := b.String()
```

Speedup: ~2-3x for replace-with-submatch logic. The
`strings.Builder.Grow` keeps allocations to one for typical inputs.

For patterns where you only need the whole match (no submatches),
stick with `ReplaceAllStringFunc` — it's already optimal for that case.

## 11. Pool result slices

If you call `FindAll*` repeatedly with similar match counts, the
result slice allocations dominate. A `sync.Pool` of int slices helps:

```go
var indexPool = sync.Pool{
    New: func() any {
        s := make([][]int, 0, 64)
        return &s
    },
}

func findAll(re *regexp.Regexp, input []byte) [][]int {
    p := indexPool.Get().(*[][]int)
    *p = (*p)[:0]
    *p = re.FindAllIndex(input, -1)
    // process *p
    indexPool.Put(p)
    return nil
}
```

This is rarely worth the complexity unless you're doing millions of
matches per second. Profile first; if `runtime.makeslice` shows up
under regex calls, pooling helps.

## 12. The right `bufio.Scanner` setup for log scanning

For line-at-a-time log scanning with regex:

```go
var lineRE = regexp.MustCompile(`...`)

func scan(r io.Reader) error {
    s := bufio.NewScanner(r)
    s.Buffer(make([]byte, 64*1024), 1<<20) // raise cap for long lines
    for s.Scan() {
        if !lineRE.Match(s.Bytes()) { // []byte API, no allocation
            continue
        }
        // ...
    }
    return s.Err()
}
```

Three optimizations stacked:

1. `s.Bytes()` over `s.Text()` — no string allocation.
2. `Match([]byte)` over `MatchString` — no input copy.
3. The scanner's read buffer is reused across lines — no per-line
   allocation.

For a 1 GB log with a million lines, the difference between
`s.Text() + MatchString` and `s.Bytes() + Match` is roughly 2-3x in
total wall-clock time.

## 13. Compile flags that save instructions

The compiled program's size affects match speed. Flags that *reduce*
program size:

| Flag | Effect on program |
|------|-------------------|
| Anchoring (`\A`, `^` w/o `(?m)`) | Skips position-iteration code |
| Literal prefix | Engine uses a Boyer-Moore scan |
| `(?:...)` over `(...)` | One fewer capture-tracking instruction per group |

Flags that *increase* program size (use only when needed):

| Flag | Effect |
|------|--------|
| `(?i)` | Adds case-folding tables, fold at every literal char |
| `(?s)` | `.` now needs to handle `\n` — slightly larger DFA |
| `\b` boundaries | Each adds 4-8 program instructions |

The differences are usually small (microseconds per match), but for
hot patterns they add up. Use `regexp/syntax.Compile` to inspect the
program length:

```go
import "regexp/syntax"

ast, _ := syntax.Parse(pat, syntax.Perl)
prog, _ := syntax.Compile(ast)
fmt.Println("program size:", len(prog.Inst))
```

## 14. The DFA cache and warmup

RE2 lazily builds a DFA from the NFA program for the parts of the
pattern it actually visits. The first match through a complex pattern
is slower than the second; the second is the steady state.

```go
var re = regexp.MustCompile(`...complex pattern...`)

func init() {
    // Warm up the DFA cache with representative input.
    re.MatchString("typical input shape here")
}
```

This is mostly relevant for batch jobs that do one big match. For
long-running services, the cache warms up naturally over the first
few requests.

The DFA cache has a size limit; very complex patterns or extremely
long inputs can blow it, falling back to the slower NFA simulation.
Watch for this in profiles: `regexp.(*Regexp).match` time increases
super-linearly with input size when the DFA is missing.

## 15. Bypass regex when possible

The fastest regex is no regex. Reach for `strings`/`bytes` first:

| Task | Fastest |
|------|---------|
| Substring exists | `strings.Contains` |
| Starts with literal | `strings.HasPrefix` |
| Ends with literal | `strings.HasSuffix` |
| Find substring index | `strings.Index` |
| Split by single char | `strings.Split` |
| Split by literal string | `strings.Split` |
| Replace literal substring | `strings.ReplaceAll` |
| Trim whitespace | `strings.TrimSpace` |
| Lowercase / uppercase | `strings.ToLower` / `ToUpper` |

These are 10-100x faster than the regex equivalent because they
have specialized SIMD-aware implementations. Use them whenever the
work doesn't actually require regex syntax.

The regex earns its place when:

- The pattern has classes (`[a-z]`) or quantifiers (`a{3,5}`).
- The pattern needs alternation (`foo|bar`).
- The pattern is configured at runtime.
- The pattern has anchors that string functions can't express.

If your "regex" is `^foo$`, write `s == "foo"`. If your "regex" is
`foo|bar|baz`, write a function with three `strings.Contains` checks
(or one `bytes.IndexAny` if you can pre-build a char set).

## 16. Architectural moves: precompute, denormalize, separate

When micro-optimizations run out:

### Precompute matches

If the same input is matched by many patterns, run all matches in
one pass and store results. A regex-heavy log analyzer can save
50%+ by tokenizing once and re-using the tokens.

### Denormalize the input

If you control the input format, change it to remove the need for
regex. `key=value` parsing is a regex case; `JSON` is a parser case
that's both faster and more robust.

### Separate fast and slow paths

Most inputs in production have a stable shape. Detect the common
case with a literal check; only fall through to regex for the
unusual case.

```go
func parse(line []byte) (parsed, error) {
    // Fast path: lines with the standard prefix.
    if bytes.HasPrefix(line, []byte("[INFO] ")) {
        return parseFastInfo(line)
    }
    // Slow path: regex for everything else.
    return parseRegex(line)
}
```

If 95% of lines hit the fast path, the regex carries 5% of the work.

## 17. When to switch to a different tool

Regex performance has limits. If you've applied everything above
and still need more, consider:

| Need | Tool |
|------|------|
| Token grammar with > 50 keywords | A hand-written or generated lexer |
| Nested structures (HTML, JSON, etc.) | A real parser |
| Very simple binary protocols | A state machine |
| Pattern matching in event streams (CEP) | A specialized library |
| Text search at scale | Aho-Corasick (e.g., `github.com/cloudflare/ahocorasick`) |
| User-supplied patterns at scale | Bounded regex with rate limits |

Aho-Corasick is the standout for "match many literals against many
inputs" — it's `O(input + matches)` for any number of patterns,
faster than even a combined RE2 alternation. Used in malware
scanners, protocol filters, NLP keyword extraction.

For Go, `github.com/cloudflare/ahocorasick` is the one most people
reach for. It's a drop-in upgrade when your regex is "lots of
literals OR'd together."

## 18. Benchmark template

Use this skeleton when you're tuning a specific pattern:

```go
package mypkg

import (
    "regexp"
    "testing"
)

var (
    benchInput = []byte(/* representative input here */)
    bench1     = regexp.MustCompile(`pattern_v1`)
    bench2     = regexp.MustCompile(`pattern_v2`)
)

func BenchmarkV1(b *testing.B) {
    b.ReportAllocs()
    b.SetBytes(int64(len(benchInput)))
    for i := 0; i < b.N; i++ {
        if !bench1.Match(benchInput) {
            b.Fatal("expected match")
        }
    }
}

func BenchmarkV2(b *testing.B) {
    b.ReportAllocs()
    b.SetBytes(int64(len(benchInput)))
    for i := 0; i < b.N; i++ {
        if !bench2.Match(benchInput) {
            b.Fatal("expected match")
        }
    }
}
```

Run with:

```sh
go test -bench=. -benchmem -count=10 -benchtime=2s
```

Use `benchstat` to compare:

```sh
go test -bench=. -count=10 > before.txt
# (make change)
go test -bench=. -count=10 > after.txt
benchstat before.txt after.txt
```

`benchstat` shows the percentage difference and statistical
significance — far more reliable than eyeballing two `ns/op` numbers.

## 19. The optimization cheat-sheet

For a regex-heavy code path, in priority order:

1. **Compile once.** The single most impactful change.
2. **Use `[]byte` if the input is bytes.** Free if your data is
   already bytes.
3. **Use `Match` for booleans.** Don't pay for substring extraction.
4. **Anchor when semantically correct.** 10-100x on long inputs.
5. **Add a literal prefilter for low-hit-rate cases.** 5-10x when
   most inputs don't match.
6. **Use index methods if you slice the input anyway.** Saves a
   string allocation per match.
7. **Combine alternations.** One scan instead of N.
8. **Drop `(?i)` for ASCII data.** A few percent.
9. **Walk indices for replace-with-submatch.** 2-3x for that
   specific pattern.
10. **Use `bufio.Scanner.Bytes()` not `Text()`.** No per-line
    allocation.

If after all that you still need more, the answer is usually a
different tool — Aho-Corasick for many literals, a parser for real
grammars, a hand-written state machine for very hot inner loops.

## 20. What to read next

- [find-bug.md](find-bug.md) — drills targeting the items in this
  file.
- [professional.md](professional.md) — the production patterns:
  pattern caches, observability, untrusted-input handling.
- [`../01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md)
  — when the bottleneck is I/O around the regex, not the regex
  itself.
