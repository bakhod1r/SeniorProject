# 8.8 `regexp` — Interview

> **Audience.** Both sides of the table. Candidates use these to
> drill the package; interviewers use them to find out whether
> someone has written production Go regex code or just used regex
> in another language. Each answer is what a strong response sounds
> like — short, specific, with the reasoning visible.

## Junior

### Q1. What's the difference between `Compile` and `MustCompile`?

`Compile` returns a `(*Regexp, error)`. `MustCompile` panics on a bad
pattern. Use `MustCompile` for literal patterns at package init —
the panic fires once at startup if the pattern is malformed, which
is what you want for a programmer error. Use `Compile` for any
pattern coming from outside your code (config files, user input);
never panic on user input.

### Q2. Why is Go's regex engine "slower" than Perl's on simple patterns?

It's actually faster in the worst case and similar in the average
case. Go uses RE2-style NFA simulation; Perl uses backtracking. On
"normal" patterns and inputs they're comparable. On adversarial
inputs (e.g., `(a+)+b` against `aaaa...c`), Perl can spend minutes
while Go finishes in microseconds. The constant-factor cost on simple
patterns is sometimes a hair higher in Go, but Go has *no
catastrophic case*.

### Q3. Why is `\d` not the same as `[0-9]` in some regex engines, but it is in Go?

Go's `\d` is exactly `[0-9]` — ASCII digits only. Some engines
(modern Java, .NET with Unicode mode) make `\d` match all Unicode
digits. To match all Unicode digits in Go, use `[\p{Nd}]`
explicitly. The Go choice is for predictability; you opt into
Unicode where you want it.

### Q4. What does `MatchString` return that `FindString` doesn't?

`MatchString` returns `bool`. `FindString` returns the matched
substring (or `""` on no match). Use `MatchString` for "did this
match?" — it's faster, allocates nothing, and can short-circuit.
Use `FindString` only when you need the matched text. Never write
`FindString(s) != ""` for a bool check; an empty match returns `""`
too, breaking the test.

### Q5. Why must regex patterns be in raw strings (backticks)?

Because `\d`, `\s`, `\b`, etc. aren't valid Go escape sequences in
regular `"..."` strings. `"\d"` is a compile error.
`"\\d"` works but is harder to read. Backtick-quoted strings pass
the backslash through literally, so `` `\d` `` is exactly two
characters and the regex engine sees the digit shorthand.

### Q6. What does `(?i)` mean and where does it go?

`(?i)` is the case-insensitive flag. It can appear at the start of
the pattern (applies globally), in the middle (applies from that
point), or as a scoped group `(?i:foo)` (applies only inside).
`(?-i:foo)` turns it off in a scope. Combine with other flags:
`(?im)` is case-insensitive plus multi-line.

### Q7. What's the difference between `^` and `\A`?

`^` matches the start of input by default, but with the `(?m)` flag
it also matches at line breaks. `\A` always matches the start of
input regardless of flags. Use `\A` (and its sibling `\z`) when you
want anchored matching that's robust to flag changes.

## Middle

### Q8. Why does `(\w+)\1` not compile in Go?

Backreferences (`\1`, `\2`, ...) aren't supported in RE2. They would
break the linear-time guarantee — backreferences require remembering
specific characters from earlier in the match, which the NFA model
can't do efficiently. The error message is "invalid escape sequence:
\1" or "invalid or unsupported Perl syntax." If you need this kind
of context-dependent matching, use a parser, not a regex.

### Q9. What's the difference between leftmost-first and leftmost-longest?

For `a|aa` against `aaa`:

- Leftmost-first (`Compile`): match is `a` — the first alternative
  in the pattern that succeeds wins.
- Leftmost-longest (`CompilePOSIX` or `Longest()`): match is `aa` —
  among all matches starting at the leftmost position, the longest
  one wins.

Go defaults to leftmost-first because it matches Perl/JavaScript
expectations and is faster (the engine can stop at first success).
POSIX leftmost-longest is for tools whose users expect `grep -E`
semantics.

### Q10. How do you extract a named capture group?

```go
re := regexp.MustCompile(`(?P<year>\d{4})-(?P<month>\d{2})`)
m := re.FindStringSubmatch("2026-05")
year := m[re.SubexpIndex("year")]
```

`(?P<name>...)` is the Python-style named-group syntax. `SubexpIndex`
returns the numeric position of a named group, or `-1` if no such
name exists. The named form is more robust than `m[1]`/`m[2]` to
later pattern edits.

### Q11. When should you use `[]byte` methods over `string` methods?

When the input is already `[]byte`. Converting `[]byte` to `string`
allocates and copies; the `[]byte` API skips that. The compiled
`*Regexp` is the same either way. Rule of thumb: if your data
arrived as bytes (file contents, HTTP body, byte buffer), keep it
in bytes through the regex.

### Q12. Why is compiling inside a hot loop a bug?

`regexp.Compile` is 100-1000x more expensive than a single match
call. A handler that compiles its pattern on every request will
spend most of its CPU compiling rather than matching. The fix is
to compile once at package init: `var myRE = regexp.MustCompile(...)`.
Linters like `staticcheck` flag the bug as `SA1000`-style; reviewers
should also flag it.

### Q13. What does `ReplaceAllStringFunc` give you that `ReplaceAllString` doesn't?

`ReplaceAllString` does literal-with-backreferences substitution
(`$1`, `${name}`, etc.). `ReplaceAllStringFunc` calls a callback
with each whole match and uses the return value as the replacement.
Use the func form when the replacement depends on the matched text
in a way the template syntax can't express — math, lookups, format
conversions.

The func form gives you the *whole match*, not the submatches. To
work with submatches in a callback, fall back to walking
`FindAllStringSubmatchIndex` results manually.

### Q14. What does `LiteralPrefix()` return and what's it good for?

It returns `(prefix string, complete bool)`. The `prefix` is the
literal string the pattern is guaranteed to begin with. `complete`
is true if the *entire* pattern is literal (no metacharacters).

Use it for fast-path optimization: if `complete` is true, you can
fall through to `strings.Contains` (or `strings.HasPrefix` for
anchored patterns). For a config-driven filter where most patterns
are plain strings, that's a 10x+ speedup.

### Q15. How do you match non-ASCII letters?

Use `\p{L}` — Unicode-aware letter class — instead of `\w` or
`[a-zA-Z]`. `\p{L}+` matches "café", "北京", "Москва" as single
words. `\p{Nd}` matches all Unicode decimal digits. `\p{Latin}`,
`\p{Cyrillic}`, etc. match by script.

`\w` is deliberately ASCII-only in Go for predictability; the
Unicode classes are how you opt into the larger character set.

## Senior

### Q16. How does Go's regex engine prevent ReDoS?

It doesn't backtrack. RE2 simulates an NFA, which means it tracks
all possible match states simultaneously. Each input byte advances
*all* active states at once, in time linear in the size of the
state set (which is bounded by the pattern size). There is no
input that can produce exponential time.

The trade-off is that backreferences and lookaround can't be
implemented under the NFA model — those require remembering
specific values, which doesn't fit. RE2 chose linear-time over
those features, and Go inherited that choice.

### Q17. Is `*Regexp` safe for concurrent use?

Yes, as long as you don't call mutating methods. `Match*`, `Find*`,
`ReplaceAll*`, and `Split` are all safe to call from any number of
goroutines on the same `*Regexp`. The only mutating method is
`Longest()`, which should be called once at setup.

`Copy()` is deprecated — before Go 1.6 it was needed because the
match state wasn't pooled, but the package now maintains a free-list
of state buffers internally. Don't add `Copy` calls; remove them
where you find them.

### Q18. When would you prefer a hand-written parser over a regex?

When the grammar has nesting, backreferences (in the colloquial
sense — "must match the same thing as before"), or context-dependent
behavior. Examples:

- Email addresses (RFC 5322 grammar).
- URLs (use `net/url`).
- CSV with quoted fields containing commas (use `encoding/csv`).
- Any code-aware match: balanced braces, nested parentheses.
- Anything where you find yourself adding a fourth special case.

The threshold isn't strict; it's "when the regex stops being
clearly correct at a glance." A regex that needs comments to
explain has crossed it.

### Q19. Why do anchored patterns run faster?

When a pattern starts with `^` or `\A`, RE2 only attempts to match
at position 0. Without an anchor, it must try every position. On a
1 MB input, that's a 1,000,000x reduction in start positions —
though a literal-prefix pattern (`error: \w+`) gets most of the
same benefit because RE2 uses a Boyer-Moore-style scan to find
candidate positions.

Anchoring is the single highest-leverage performance change for
patterns where it's semantically correct. Always check whether your
pattern *can* be anchored before reaching for other optimizations.

### Q20. What does `re.Longest()` do and when would you use it?

It mutates the receiver to use leftmost-longest semantics instead
of the default leftmost-first. Same effect as compiling with
`CompilePOSIX`, but applied after compile.

Use it when you need POSIX semantics specifically — implementing a
`grep -E` clone, mimicking `awk`, or any tool whose users expect
the POSIX flavor. Most code never needs it.

### Q21. How do you profile regex CPU spend in a Go service?

Wrap each pattern in a thin function with `//go:noinline`:

```go
//go:noinline
func matchUserAgent(s string) bool { return userAgentRE.MatchString(s) }
```

The non-inlined wrapper appears in the CPU profile as a distinct
call site, so `go tool pprof` attributes regex time per pattern
rather than to a generic `regexp.(*Regexp).MatchString`.

For per-pattern attribution without code changes, instrument with
counters and a histogram, exposing them via Prometheus or
OpenTelemetry. Sample the histogram (e.g., 1 in 100 calls) if the
match itself is sub-microsecond — the timing overhead can dominate.

### Q22. How do you handle untrusted patterns from end users?

Layer the defenses:

1. **Length cap** — reject patterns over N bytes (typically 1 KiB).
2. **Complexity cap** — parse with `regexp/syntax` and check
   `len(prog.Inst)` against a budget.
3. **Compile cache with eviction** — bounded LRU/random.
4. **Input size cap** — even with linear-time matching, large
   inputs cost real CPU.
5. **Context-bounded match** — run the match in a goroutine and
   give up after a deadline.

The matcher itself can't be made unsafe through pattern shape, but
unbounded resources can still hurt you. The bounds are the
defense.

## Professional / Architecture

### Q23. How would you design an HTTP route matcher using `regexp`?

For most cases, **don't** — use `net/http`'s `ServeMux` (Go 1.22+
supports patterns), `gorilla/mux`, or `chi`. They use specialized
trie-based matchers that are faster than regex-per-route.

If you do build one with regex:

- Compile every route's pattern once at startup.
- Match in route order against `r.URL.Path` (or the cleaned form).
- Anchor every pattern with `\A` and `\z` so a "users/(\d+)" doesn't
  accidentally match `/api/users/42/extra`.
- Pre-filter with `LiteralPrefix()` — most routes have a literal
  prefix; checking it first skips the regex on misses.
- For 100+ routes, group by literal prefix and dispatch by prefix
  before regex.

A typical regex-based router on Go's stack handles 1-5 million
matches per second per core; a trie-based one handles 10-50 million.
For most services, both are far above the request rate.

### Q24. When does `ReplaceAllString` allocate, and how do you avoid it?

It allocates the result string and intermediate buffers. Three
escape valves:

1. **No matches:** `ReplaceAllString` returns the input string with
   no allocation since Go 1.22 (the package detects no matches
   early).
2. **`ReplaceAllLiteralString`:** skips the `$N` interpretation, so
   it can use a fixed replacement and skip building the
   substitution per match.
3. **Hand-rolled with `FindAllStringIndex`:** if you walk indices
   and use `strings.Builder.Grow`, you can build the result with
   one allocation amortized for the builder.

For high-throughput rewrites, the index-walking pattern from
[middle.md](middle.md) section 14 is what production code does.

### Q25. How would you migrate a service from PCRE-based pattern config to Go?

Audit the patterns for incompatible features:

| PCRE | Go status |
|------|-----------|
| Backreferences `\1` | Drop or restructure |
| Lookahead `(?=...)` | Drop or restructure |
| Lookbehind `(?<=...)` | Drop or restructure |
| Atomic groups `(?>...)` | Drop — RE2 doesn't backtrack |
| Recursive patterns `(?R)` | Replace with parser |
| `(?<name>...)` | Rename to `(?P<name>...)` |

For each pattern requiring lookaround, ask whether the surrounding
*code* can carry the context check instead — usually it's a few
lines of Go that's easier to read than the regex was.

Build a regression suite of (pattern, input, expected) triples
*before* migration. Run both engines side-by-side in a shadow mode
and alert on discrepancies. After a clean week, cut over.

### Q26. A regex-heavy service is at 90% CPU and `pprof` shows half the time in `regexp` — what do you do?

The triage order:

1. **Are patterns compiled in hot paths?** Look for `regexp.MustCompile`
   inside handlers or per-request functions. Hoist them.
2. **Are patterns anchored?** An unanchored pattern on long inputs
   is O(input) per call. Add `\A` where it's correct.
3. **Are inputs bounded?** Cap input size at the API edge.
4. **Are there literal pre-checks possible?** `strings.Contains`
   before the regex skips most inputs in 5 ns.
5. **Are alternations fragmented?** Combining `re1.MatchString(s) ||
   re2.MatchString(s) || re3.MatchString(s)` into one alternation
   often saves real CPU.
6. **Is `(?i)` necessary?** For ASCII-only fields, swap for an
   explicit char class.
7. **Is `ReplaceAllStringFunc` doing extra scans?** Replace with the
   index-walking pattern.

If none of those move the needle, the regex *is* the workload — you
need a different engine (a hand-written state machine for the hot
pattern) or a different architecture (precompute).

### Q27. Linear-time guarantee — is it really useful in practice?

Yes, in two ways:

1. **Threat surface reduction.** You can run user-supplied patterns
   against user-supplied inputs without a CPU bomb. WAFs, rule
   engines, search bars, log filters — all of them have user
   patterns somewhere, and the absence of catastrophic backtracking
   is what lets you ship them safely.
2. **Predictable latency.** Match latency is bounded by `input ×
   pattern`. You can compute a worst-case time and use it for SLO
   design. With backtracking engines, the worst case is unbounded;
   you have to add a wall-clock timeout, which is itself a layer of
   complexity.

The "downside" — no backreferences, no lookaround — bites less than
people expect. Most real grammars where lookaround is "needed" are
better expressed with a parser anyway. The features that you do
miss tend to be ones that should have been a parser from the start.

### Q28. How do you decide between `regexp`, `strings.Contains`, and a hand-written state machine?

| Use | When |
|-----|------|
| `strings.Contains`, `HasPrefix`, etc. | The pattern is fixed, no metacharacters needed |
| `regexp` | The pattern varies, has classes/quantifiers, or comes from config |
| Hand-rolled state machine | Hot path, very simple grammar (e.g., is-this-an-int), or you've profiled and need 10x+ |
| Real parser | Nesting, context-dependent rules, recursive structures |

The thresholds aren't strict. The signal that you should move:

- From `Contains` to `regexp`: when you find yourself adding a
  third "or this prefix" check.
- From `regexp` to hand-rolled: when the pattern is in the top-3
  of a CPU profile *and* the grammar is simple.
- From `regexp` to a parser: when the pattern needs comments to
  explain, or when "make it match this also" requires re-architecting
  the regex.

## Code-walk-through

### Q29. Walk me through the bug in this code.

```go
func extractIDs(text string) []int {
    re := regexp.MustCompile(`id=(\d+)`)
    matches := re.FindAllStringSubmatch(text, -1)
    ids := make([]int, 0, len(matches))
    for _, m := range matches {
        n, _ := strconv.Atoi(m[1])
        ids = append(ids, n)
    }
    return ids
}
```

Two issues:

1. **Compile in the hot path.** If `extractIDs` is called per
   request, `regexp.MustCompile` runs on every call. Move to a
   package-level `var` and reference it.
2. **Silent error swallow.** `strconv.Atoi`'s error is discarded.
   The pattern guarantees the captured text is digits, so it can't
   fail in *theory* — but if someone changes the pattern to allow
   `id=12 ` (trailing space) or `id=` (empty), the silent ignore
   becomes a silent bug. Either return the error or assert that
   the conversion can't fail (panic with context).

A reviewer might also ask whether `\b` boundaries should anchor
`id=` to avoid matching `userid=42`.

### Q30. What does this regex do and what's wrong with it?

```go
emailRE := regexp.MustCompile(`^.+@.+\..+$`)
```

It's a "looks vaguely like an email" check. Three problems:

1. **Too permissive.** `a@b.c` passes; so does `a@@.b` because
   `.+` is greedy and matches anything.
2. **Doesn't handle quoted local parts** (RFC 5322 allows `"a b"@x`).
3. **Doesn't handle internationalized domains** (`a@münchen.de`
   should pass).

For real validation, use `net/mail.ParseAddress`. The regex is fine
as a quick triage filter — "is this even close to an email?" — but
the fact that it's lazy enough to pass `a@@.b` should make you
distrust it as a security check.

The fix, if you must use a regex:

```go
emailish := regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
```

Tighter on whitespace and double-`@`. Still not RFC-compliant.
