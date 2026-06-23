# 8.8 `regexp` — Middle

> **Audience.** You've read [junior.md](junior.md) and you can pick
> the right method off the matrix. This file is the working surface:
> submatches with byte indices, replace callbacks that see the full
> capture set, Unicode character classes, anchored vs unanchored
> matching, and the patterns you reach for once "find me a number"
> isn't enough.

## 1. The `Index` family — byte offsets, not strings

Every `Find*String` method has an `Index` cousin that returns byte
offsets into the input instead of substrings:

| Method | Returns |
|--------|---------|
| `FindStringIndex(s)` | `[]int{start, end}` of first match, or `nil` |
| `FindAllStringIndex(s, -1)` | `[][]int` of all matches |
| `FindStringSubmatchIndex(s)` | `[]int{m0s, m0e, m1s, m1e, ...}` for whole match + captures |
| `FindAllStringSubmatchIndex(s, -1)` | `[][]int` of the above per match |

The submatch-index encoding is awkward but precise. For a pattern
with N capture groups, each result has `2*(N+1)` ints:

- `result[0:2]` — start/end of the whole match.
- `result[2:4]` — start/end of capture 1.
- `result[4:6]` — start/end of capture 2.
- ...

```go
re := regexp.MustCompile(`(\w+)=(\w+)`)
m := re.FindStringSubmatchIndex("name=alice")
// m == []int{0, 10, 0, 4, 5, 10}
//          ^---^  whole match: "name=alice"
//                 ^--^  capture 1: "name"
//                       ^---^  capture 2: "alice"
fmt.Println(s[m[0]:m[1]], s[m[2]:m[3]], s[m[4]:m[5]])
```

A capture that didn't participate gets `-1, -1`. Always check before
slicing:

```go
if m[2] >= 0 {
    cap1 := s[m[2]:m[4]]
}
```

Why bother with indices at all? Three reasons:

1. **No allocation per match.** `FindAllStringSubmatch` allocates a
   string for every capture; the `Index` form returns the same data
   as `int` offsets, with one slice header per match.
2. **Surrounding context.** You can show the bytes before and after a
   match: `s[m[0]-20:m[1]+20]`.
3. **In-place edits.** When you want to replace selectively without
   the cost of building a new string per substitution, the `Index`
   data gives you the exact ranges to splice.

## 2. `FindAllSubmatchIndex` and an in-place rewrite

Here's the practical use of the index form: rewrite numbers in a
string, doubling each one, allocating exactly once.

```go
func doubleNumbers(s string) string {
    re := regexp.MustCompile(`\d+`)
    matches := re.FindAllStringIndex(s, -1)
    if matches == nil {
        return s
    }
    var b strings.Builder
    b.Grow(len(s) * 2)
    last := 0
    for _, m := range matches {
        b.WriteString(s[last:m[0]])
        n, _ := strconv.Atoi(s[m[0]:m[1]])
        fmt.Fprintf(&b, "%d", n*2)
        last = m[1]
    }
    b.WriteString(s[last:])
    return b.String()
}
```

`ReplaceAllStringFunc` does almost the same thing under the hood —
but for non-trivial replacement logic where you need access to
captures, the index form gives you control without going through the
callback's reduced API.

## 3. `ReplaceAllStringFunc` — the simple callback

When the replacement depends on the matched text:

```go
re := regexp.MustCompile(`\d+`)
out := re.ReplaceAllStringFunc("a 1 b 22 c 333", func(s string) string {
    n, _ := strconv.Atoi(s)
    return strconv.Itoa(n * n)
})
// "a 1 b 484 c 110889"
```

The callback receives the *whole match* — no submatches. If you wrote
`(\d+)` and called the func form, you still get only one string back:
the whole match, not the capture.

If you need access to submatches in the replacement, drop down to the
`Index` form:

```go
func replaceWithSubmatches(re *regexp.Regexp, s string,
    repl func(submatches []string) string) string {
    return string(re.ReplaceAllFunc([]byte(s), func(m []byte) []byte {
        sm := re.FindSubmatch(m)
        result := make([]string, len(sm))
        for i, b := range sm {
            result[i] = string(b)
        }
        return []byte(repl(result))
    }))
}
```

This double-matches (once for the outer scan, once inside the
callback). For tight loops, prefer the index-walking pattern from
section 2.

## 4. `Expand` and `ExpandString` — replacement-string semantics, exposed

`Expand` lets you apply the `$1`/`${name}` substitution rules to a
template, given a match:

```go
re := regexp.MustCompile(`(\w+)\s+(\w+)`)
src := []byte("Alice Smith")
m := re.FindSubmatchIndex(src)

template := []byte("$2, $1")
result := re.Expand(nil, template, src, m)
// "Smith, Alice"
```

This is the building block `ReplaceAll` is built on. You'll rarely
need it directly, but it's useful when you have one match and want to
produce multiple replacement variants from different templates.

The first argument is an append-style destination (`nil` to allocate a
new slice). The signature follows the stdlib pattern of "appendable
result, then inputs":

```go
func (re *Regexp) Expand(dst []byte, template, src []byte, match []int) []byte
func (re *Regexp) ExpandString(dst []byte, template string, src string, match []int) []byte
```

## 5. Unicode character classes

The big win over `\d` and `\w` is `\p{...}` — Unicode property
classes. The set is large; the most useful ones:

| Class | Meaning |
|-------|---------|
| `\p{L}` | Any letter (any script) |
| `\p{Ll}` | Lowercase letter |
| `\p{Lu}` | Uppercase letter |
| `\p{N}` | Any number (including digits, fractions, Roman numerals) |
| `\p{Nd}` | Decimal digit (any script) |
| `\p{P}` | Any punctuation |
| `\p{S}` | Any symbol |
| `\p{Z}` | Any whitespace separator |
| `\p{M}` | Any combining mark |
| `\p{Greek}`, `\p{Han}`, `\p{Cyrillic}`, ... | Specific scripts |

Capitalize `\P{L}` for the negation ("any non-letter").

Examples:

```go
unicodeWord := regexp.MustCompile(`\p{L}+`)
unicodeWord.FindAllString("café 北京 Москва", -1)
// []string{"café", "北京", "Москва"}

digitsAnyScript := regexp.MustCompile(`\p{Nd}+`)
digitsAnyScript.FindString("価格 ١٢٣٤") // "١٢٣٤" (Arabic-Indic digits)
```

Compare with `\w`, which is exactly `[0-9A-Za-z_]` — ASCII-only and
deliberately conservative. If your input is user-facing text in any
language, switch to `\p{L}` and `\p{Nd}`.

## 6. `(?i)` and case-folding cost

The `(?i)` flag is Unicode-aware, not ASCII-only. It folds case using
the full Unicode case-folding table, so `(?i)ß` matches `SS`,
`(?i)ı` (dotless i) matches `I`, and so on.

This is correct but slower than ASCII-only case-insensitivity. If you
*know* your input is ASCII, the cheap workaround is:

```go
// Equivalent to (?i)hello for ASCII inputs only
re := regexp.MustCompile(`[Hh][Ee][Ll][Ll][Oo]`)
```

Or use Go-side normalization:

```go
re := regexp.MustCompile(`hello`)
re.MatchString(strings.ToLower(input))
```

The `strings.ToLower` allocates once per call but uses a tight ASCII
fast-path internally. For tight inner loops on ASCII, that's faster
than `(?i)` for short patterns.

For mixed-script input (any user-supplied text in any language), keep
`(?i)`. It's correct; the overhead is a few percent in most patterns.

## 7. Anchored matching: when does `^` cost less?

A pattern that starts with `^` is *anchored* — it must match at
position 0 (or at line start, with `(?m)`). RE2 detects this and skips
the unanchored search loop, which can be a 10-100x speedup on long
inputs.

```go
// Slow on a 10 MB input where the match is at position 0
slow := regexp.MustCompile(`http://`)

// Fast — RE2 only checks position 0
fast := regexp.MustCompile(`^http://`)
```

If you only care about the prefix, anchor. If you only care that *some
substring* matches anywhere, leave it unanchored.

The same applies to `\A`. `^` plus `(?m)` does not cause a bound
search — it still has to check every line start.

For "match the whole input," use `\A...\z`:

```go
isHexOnly := regexp.MustCompile(`\A[0-9a-fA-F]+\z`)
```

This compiles to an automaton that fails at the first non-hex byte
without any branching to "try later positions."

## 8. Assertion vs match: don't waste a `Find` if you only need a bool

A common bug is using `FindString` for a yes/no check:

```go
if re.FindString(s) != "" { ... } // wrong-shaped check
```

Two reasons not to do this:

1. **It allocates** — `FindString` returns a substring, which on Go's
   string-of-bytes model usually shares the backing array but still
   allocates a new header.
2. **An empty match is indistinguishable.** A pattern like `(?:)` or
   `\b` can produce a successful empty match. The check above treats
   that as "no match."

Use `MatchString` instead:

```go
if re.MatchString(s) { ... } // correct — bool, possibly faster, never wrong
```

`MatchString` can also short-circuit at the first byte that disproves
the pattern. `Find*` has to actually find and return the match.

## 9. `FindReader` and `MatchReader` — streaming input

`MatchReader(r io.RuneReader)` matches against a streaming source
without loading the whole thing:

```go
import "bufio"

f, _ := os.Open("huge.log")
defer f.Close()
br := bufio.NewReader(f)

re := regexp.MustCompile(`ERROR`)
if re.MatchReader(br) {
    fmt.Println("found an ERROR somewhere in the file")
}
```

There's no `FindAllReader` or `ReplaceAllReader`. `MatchReader` exists
because match (boolean) can stop at first hit; finding all matches in
a stream would either need to buffer the whole thing or define some
windowing semantic, neither of which the package commits to.

The `io.RuneReader` interface (one rune at a time) is what the
matcher actually consumes. `bufio.Reader` implements it, as do
`strings.Reader` and `bytes.Reader`. You don't usually wrap your file
manually — the `bufio` wrapper does the work.

For "scan a huge file line by line and match each line," keep using
`bufio.Scanner` plus `re.Match(line)`. That's the idiomatic Go
pattern; `MatchReader` is for cases where the pattern itself spans
across what would be lines (multi-line patterns over the whole
stream).

## 10. `LiteralPrefix` and pattern introspection

A useful, lesser-known method:

```go
prefix, complete := re.LiteralPrefix()
```

Returns the literal prefix the pattern is guaranteed to start with,
and whether the pattern is *entirely* literal (no metacharacters).

```go
re := regexp.MustCompile(`^https://example\.com/`)
re.LiteralPrefix() // "https://example.com/", false (the trailing / makes it match-anywhere after)

re := regexp.MustCompile(`^foo$`)
re.LiteralPrefix() // "foo", true (entirely literal)
```

Use it to fall through to a fast path:

```go
type matcher struct {
    re      *regexp.Regexp
    literal string
    isLit   bool
}

func newMatcher(pat string) (*matcher, error) {
    re, err := regexp.Compile(pat)
    if err != nil { return nil, err }
    p, lit := re.LiteralPrefix()
    return &matcher{re: re, literal: p, isLit: lit}, nil
}

func (m *matcher) Match(s string) bool {
    if m.isLit {
        return strings.Contains(s, m.literal)
    }
    return m.re.MatchString(s)
}
```

For a config-driven filter where most patterns are plain strings,
this can be a 10-20x speedup.

## 11. `NumSubexp`, `SubexpNames`, `SubexpIndex`

When you parse user-supplied patterns, you often need to know what
captures are available before running the match.

```go
re := regexp.MustCompile(`(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})`)

re.NumSubexp()      // 3
re.SubexpNames()    // []string{"", "year", "month", "day"}  (index 0 is always "")
re.SubexpIndex("month") // 2 (or -1 if no such name)
```

`SubexpIndex` is the cleanest way to pull a named capture out of a
`FindStringSubmatch` result without iterating:

```go
m := re.FindStringSubmatch("2026-05-06")
month := m[re.SubexpIndex("month")]
```

You can build a `map[string]string` if you want to pass captures
around:

```go
func captures(re *regexp.Regexp, m []string) map[string]string {
    out := make(map[string]string, re.NumSubexp())
    for i, name := range re.SubexpNames() {
        if i > 0 && name != "" {
            out[name] = m[i]
        }
    }
    return out
}
```

The map costs an allocation; for a hot loop, prefer
`SubexpIndex`-based direct access.

## 12. `Longest()` — make a pattern leftmost-longest at runtime

Not a constructor, but a property toggle: `re.Longest()` changes a
compiled pattern from RE2's default leftmost-first semantics to POSIX
leftmost-longest.

```go
re := regexp.MustCompile(`a|aa`)
re.FindString("aaa") // "a" — leftmost-first
re.Longest()
re.FindString("aaa") // "aa" — leftmost-longest
```

This is the same effect as `regexp.CompilePOSIX`, but applied to an
already-compiled pattern. Most code never needs it — leftmost-first
is what you usually want. We'll cover the difference in detail in
[senior.md](senior.md).

## 13. Common patterns, the careful versions

The "rough" versions in [junior.md](junior.md) are good enough for
quick-and-dirty filtering. Here are the tighter ones:

### IPv4

```go
ipv4 := regexp.MustCompile(
    `\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}` +
    `(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b`)
```

Each octet is `0-255`. The pattern still allows leading zeros in
small numbers (`007.000.000.001`); strip those with a separate check
or use `net.ParseIP`. **For real validation, use `net.ParseIP` —
faster, exact, and gives you the parsed value.**

### ISO 8601 date (calendar form, no timezone)

```go
iso8601date := regexp.MustCompile(
    `^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
```

Doesn't validate impossible dates like `2026-02-30`; for that, use
`time.Parse(time.DateOnly, s)`.

### Identifier (Go-like)

```go
goIdent := regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_]*$`)
```

Note the use of `\p{L}` — Go identifiers can include any Unicode
letter, not just ASCII.

### URL (rough, only for triage)

```go
roughURL := regexp.MustCompile(
    `https?://[\w.\-]+(?::\d+)?(/[\w./\-?%=&]*)?`)
```

Don't try to write a real URL regex. The grammar is large and
unambiguous parsing requires a proper parser. Use `net/url` for
real work.

### Email

There is no correct email regex. The RFC 5322 grammar is famously
hostile. The pragmatic check:

```go
emailish := regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
```

Pair with `net/mail.ParseAddress` for real validation. Use the regex
only for "looks vaguely like one" filtering.

## 14. Replace with structured logic

A worked example. We have log lines like:

```
2026-05-06T12:00:00Z [INFO] user=alice ip=10.0.0.1 path=/foo
```

We want to redact the IP — replace each `ip=...` with `ip=redacted`,
preserving the surrounding text.

```go
re := regexp.MustCompile(`(ip=)\S+`)
out := re.ReplaceAllString(line, "${1}redacted")
```

The `${1}` keeps the literal `ip=` prefix; the `\S+` is replaced
with `redacted`. Using `${1}` rather than `$1` avoids the
`$1redacted` "unknown name" pitfall.

For a more complex case — preserve the IP's class but redact the host
bits — use the func form:

```go
re := regexp.MustCompile(`ip=(\S+)`)
out := re.ReplaceAllStringFunc(line, func(match string) string {
    sm := re.FindStringSubmatch(match)
    parts := strings.Split(sm[1], ".")
    if len(parts) == 4 {
        return "ip=" + parts[0] + "." + parts[1] + ".x.x"
    }
    return "ip=invalid"
})
```

The double-match (outer scan + inner `FindStringSubmatch`) is
wasteful. For high-throughput rewrites, walk indices manually:

```go
re := regexp.MustCompile(`ip=(\S+)`)
matches := re.FindAllStringSubmatchIndex(line, -1)
var b strings.Builder
last := 0
for _, m := range matches {
    b.WriteString(line[last:m[0]])
    parts := strings.Split(line[m[2]:m[3]], ".")
    if len(parts) == 4 {
        fmt.Fprintf(&b, "ip=%s.%s.x.x", parts[0], parts[1])
    } else {
        b.WriteString("ip=invalid")
    }
    last = m[1]
}
b.WriteString(line[last:])
out := b.String()
```

One pass, one allocation amortized per match. Compare with the
`ReplaceAllStringFunc` form, which scans twice.

## 15. The `[]byte` API in a streaming pipeline

When you're already working in `[]byte` (HTTP request body, file
contents, output of some other parser), stay there:

```go
var statusRE = regexp.MustCompile(`"status"\s*:\s*"(\w+)"`)

func extractStatus(body []byte) string {
    m := statusRE.FindSubmatch(body)
    if m == nil {
        return ""
    }
    return string(m[1])
}
```

The `string(m[1])` is the only allocation. If you don't need to keep
the value past the next regex call, use the index form and slice
directly:

```go
m := statusRE.FindSubmatchIndex(body)
if m != nil {
    status := body[m[2]:m[3]] // []byte view, no allocation
    // use status before the next call that might overwrite the input
}
```

This is the same trick as `bufio.Reader.ReadSlice` — you get a view
into a buffer, valid until the next operation. Convenient and fast,
but easy to misuse if the surrounding code is unclear about
ownership.

## 16. Putting it together: a tiny templating language

Here's a compact example exercising most of this file. We'll
implement `{{name}}` substitution — a one-pass replace with a lookup
function and an explicit error on unknown names.

```go
var tpl = regexp.MustCompile(`\{\{(\w+)\}\}`)

func render(input string, vars map[string]string) (string, error) {
    var missing []string
    out := tpl.ReplaceAllStringFunc(input, func(m string) string {
        sm := tpl.FindStringSubmatch(m)
        v, ok := vars[sm[1]]
        if !ok {
            missing = append(missing, sm[1])
            return m
        }
        return v
    })
    if len(missing) > 0 {
        return out, fmt.Errorf("unknown vars: %s", strings.Join(missing, ", "))
    }
    return out, nil
}
```

Worth noting:

- The pattern is escaped — `\{` and `\}` because `{` is a
  metacharacter (start of a counted repetition).
- We capture `(\w+)` and reach for it inside the callback.
- The `missing` slice is closed over by the callback. This is the
  idiomatic way to collect side data alongside a replace.

For a production templater, consider `text/template` — it supports
conditionals, ranges, and is likely faster for non-trivial work.
But for "drop in a few names," the regex form above is 30 lines and
zero dependencies.

## 17. What to read next

- [senior.md](senior.md) — the RE2 algorithm, leftmost-first vs
  POSIX leftmost-longest, concurrency rules, `regexp/syntax`.
- [professional.md](professional.md) — production patterns: pattern
  caches, allocation-free matching, observability.
- [optimize.md](optimize.md) — when correct isn't fast enough.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file.
