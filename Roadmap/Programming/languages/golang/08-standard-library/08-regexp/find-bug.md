# 8.8 `regexp` — Find the Bug

> **Audience.** You've read [middle.md](middle.md) and
> [senior.md](senior.md), and you want to train your eye for the
> bugs that actually ship. Each snippet is short, looks roughly
> right, and contains at least one real bug from the patterns the
> earlier files describe. Read the snippet, find the bug, then read
> the analysis. The bugs are mostly contractual or performance — not
> visual.

## 1. Compiling in a hot loop

```go
func looksLikeID(s string) bool {
    re := regexp.MustCompile(`^[A-Z]{2}\d{6}$`)
    return re.MatchString(s)
}
```

### Analysis

`regexp.MustCompile` runs every time `looksLikeID` is called. A
function that costs 50 ns to evaluate (one regex match) is now
costing 10-50 microseconds (compile + match) — a 200-1000x slowdown.
On a hot path, it's the difference between a 100 µs handler and a
50 ms handler.

The fix:

```go
var idRE = regexp.MustCompile(`^[A-Z]{2}\d{6}$`)

func looksLikeID(s string) bool {
    return idRE.MatchString(s)
}
```

`go vet` doesn't catch this. Static analyzers like `staticcheck` and
`gocritic` do, with rules `SA1000` and `regexpMust`. Add them to
your CI.

## 2. Wrong replace syntax

```go
re := regexp.MustCompile(`(\w+) (\w+)`)
out := re.ReplaceAllString("Alice Smith", "\\2 \\1")
fmt.Println(out)
```

### Analysis

The replacement uses `\\2 \\1` (Perl/PCRE-style backreferences in the
replacement). Go uses `$N` instead. The output is the literal text
`\2 \1`, not `Smith Alice`.

The fix:

```go
out := re.ReplaceAllString("Alice Smith", "$2 $1")
```

To put a literal `$` in the replacement, use `$$`. To use the
literal-replacement form (no `$N` interpretation at all), call
`ReplaceAllLiteralString`.

## 3. The `$1abc` ambiguity

```go
re := regexp.MustCompile(`(\d+)`)
out := re.ReplaceAllString("count: 42", "$1abc")
fmt.Println(out)
```

### Analysis

The replacement string `$1abc` is parsed as "capture group named
`1abc`," which doesn't exist. The substitution becomes empty, so the
output is `count: ` (with no `42abc` and no `42`).

The fix is to use `${1}abc`, which makes the boundary explicit:

```go
out := re.ReplaceAllString("count: 42", "${1}abc")
// "count: 42abc"
```

This is the most common "why does my replace produce the wrong
thing" question on Go-related forums.

## 4. The longest-alternative pitfall

```go
re := regexp.MustCompile(`http|https`)
fmt.Println(re.FindString("https://example.com"))
```

### Analysis

Leftmost-first picks the first alternative that matches at the
leftmost position. Both `http` and `https` match at position 0;
because `http` comes first in the alternation, that's what's
returned. The result is `http`, not `https`.

The fix is to put the longer alternative first:

```go
re := regexp.MustCompile(`https|http`)
```

Or use `CompilePOSIX` for leftmost-longest semantics — but at the
cost of speed and Perl-syntax features.

The same bug strikes lexer-style patterns: `(int|integer)` matches
`integer` as `int` because of leftmost-first ordering.

## 5. `FindString != ""` for a bool check

```go
if re.FindString(input) != "" {
    process(input)
}
```

### Analysis

Two issues:

1. **Allocates and computes a substring.** `FindString` materializes
   the matched text. For a bool decision, that's unnecessary work —
   `MatchString` answers in less time and zero allocations.
2. **Empty match treated as no match.** A pattern that can match
   empty (`a*`, `\b`, `(?:)`) returns `""` on a successful empty
   match. The check above incorrectly says "no match" when an empty
   match did occur.

The fix:

```go
if re.MatchString(input) {
    process(input)
}
```

## 6. `bytes` API unnecessarily wrapped through `string`

```go
func extract(body []byte) string {
    re := regexp.MustCompile(`status=(\w+)`)
    m := re.FindStringSubmatch(string(body))
    if m == nil { return "" }
    return m[1]
}
```

### Analysis

Beyond the compile-in-hot-path bug, the `string(body)` allocates a
copy of the entire body. For a 1 MB body this is 1 MB of allocations
per call.

The fix is to use the byte methods:

```go
var statusRE = regexp.MustCompile(`status=(\w+)`)

func extract(body []byte) string {
    m := statusRE.FindSubmatch(body)
    if m == nil { return "" }
    return string(m[1]) // small allocation: just the captured value
}
```

The `*Regexp` is the same object — only the input/output types differ.

## 7. Forgetting to anchor

```go
var pathRE = regexp.MustCompile(`/users/(\d+)`)

func userID(path string) (int, bool) {
    m := pathRE.FindStringSubmatch(path)
    if m == nil { return 0, false }
    n, _ := strconv.Atoi(m[1])
    return n, true
}
```

### Analysis

The pattern is unanchored, so it matches `/users/42` *and*
`/api/users/42` *and* `/admin/users/42/extra`. If the caller assumes
this validates the full path shape, it doesn't.

It's also slower than anchored: unanchored patterns must try every
starting position, while `\A` anchors stop after position 0.

The fix:

```go
var pathRE = regexp.MustCompile(`\A/users/(\d+)\z`)
```

Or accept the unanchored form but document the looseness ("matches
any path that contains `/users/<id>`").

## 8. `(?i)` for ASCII-only data

```go
var levelRE = regexp.MustCompile(`(?i)\b(error|warn|info|debug)\b`)
```

### Analysis

Not strictly a *bug* — the pattern is correct — but `(?i)` enables
full Unicode case-folding. For log levels which are guaranteed
ASCII, that's wasted CPU.

The faster equivalent:

```go
var levelRE = regexp.MustCompile(`\b(?:ERROR|WARN|INFO|DEBUG|error|warn|info|debug|Error|Warn|Info|Debug)\b`)
```

Or even simpler: lowercase the input before matching.

```go
var levelRE = regexp.MustCompile(`\b(error|warn|info|debug)\b`)

func match(line string) bool {
    return levelRE.MatchString(strings.ToLower(line))
}
```

The `strings.ToLower` is ASCII-fast in Go, often faster than `(?i)`
folding.

## 9. Greedy `.*` swallowing too much

```go
re := regexp.MustCompile(`<a href="(.*)">`)
m := re.FindStringSubmatch(`<a href="x"><a href="y">`)
fmt.Println(m[1])
```

### Analysis

The greedy `.*` matches as much as possible. The captured text is
`x"><a href="y`, not `x` as the author probably intended.

The fix is to use a non-greedy quantifier or a more precise class:

```go
re := regexp.MustCompile(`<a href="(.*?)">`) // lazy: stops at first match
re := regexp.MustCompile(`<a href="([^"]*)">`) // class: anything but a quote
```

The class version is faster and cleaner — it expresses intent
directly. Lazy quantifiers in RE2 don't backtrack (the engine still
runs the NFA simulation), but for *correctness* they give the
expected result.

(And as always: don't parse HTML with regex. Use `golang.org/x/net/html`.)

## 10. Mutating `Longest()` from multiple goroutines

```go
var re = regexp.MustCompile(`a|aa`)

func match(s string) string {
    re.Longest()
    return re.FindString(s)
}
```

### Analysis

`Longest()` is a *mutating* method. Calling it concurrently with
match operations races. The first call mutates the regex; the second
call (from another goroutine) might race with a `FindString` in
progress.

The fix: call `Longest()` once at setup, or use `CompilePOSIX` from
the start.

```go
var re = regexp.MustCompilePOSIX(`a|aa`) // already leftmost-longest

func match(s string) string {
    return re.FindString(s)
}
```

## 11. `Copy()` left over from old code

```go
func handle(req *Request) {
    local := globalRE.Copy()
    if local.MatchString(req.Body) {
        // ...
    }
}
```

### Analysis

`Copy` is deprecated since Go 1.6. The package now maintains a free-
list of per-call match state internally, so concurrent calls on the
shared `*Regexp` are safe and don't contend. The `Copy` here adds an
allocation per call without buying anything.

The fix:

```go
func handle(req *Request) {
    if globalRE.MatchString(req.Body) {
        // ...
    }
}
```

When you find `Copy` in a code review, flag it. Removing it is safe.

## 12. Missing scanner buffer size

```go
var lineRE = regexp.MustCompile(`error: (\w+)`)

func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close()

    s := bufio.NewScanner(f)
    for s.Scan() {
        if m := lineRE.FindStringSubmatch(s.Text()); m != nil {
            log.Println(m[1])
        }
    }
    return s.Err()
}
```

### Analysis

`bufio.Scanner` has a default token cap of 64 KiB. A single line
longer than that returns `bufio.ErrTooLong` from `Scan()`, which
is reported by `s.Err()`. The scanner has *advanced past* the long
line, so the matcher never sees it.

The fix: raise the cap.

```go
s := bufio.NewScanner(f)
s.Buffer(make([]byte, 64*1024), 1<<20) // up to 1 MiB per line
```

This is a cross-leaf bug — see
[`../01-io-and-file-handling/senior.md`](../01-io-and-file-handling/senior.md)
section 16. It bites regex users particularly often because log
lines from production services occasionally have huge embedded
payloads.

## 13. Allocation in a hot loop via `Text()`

```go
var ipRE = regexp.MustCompile(`\b\d{1,3}(\.\d{1,3}){3}\b`)

func countIPs(r io.Reader) (int, error) {
    s := bufio.NewScanner(r)
    n := 0
    for s.Scan() {
        if ipRE.MatchString(s.Text()) {
            n++
        }
    }
    return n, s.Err()
}
```

### Analysis

`s.Text()` allocates a string per line. For a 100 MB log with a
million lines, that's a million allocations.

The fix: use `s.Bytes()` and the `[]byte` API.

```go
for s.Scan() {
    if ipRE.Match(s.Bytes()) {
        n++
    }
}
```

`s.Bytes()` returns a view into the scanner's buffer (no
allocation); `Match([]byte)` accepts it directly. The match
operation is the same; only the input wrapping differs.

## 14. Naive replace double-scan

```go
re := regexp.MustCompile(`\d+`)
out := re.ReplaceAllStringFunc(input, func(match string) string {
    sm := re.FindStringSubmatch(match)
    n, _ := strconv.Atoi(sm[0])
    return strconv.Itoa(n * 2)
})
```

### Analysis

Two issues:

1. The callback receives the whole match. There's no need to call
   `FindStringSubmatch` inside it — the match is already `match`.
2. Even if you did need submatches, calling `FindStringSubmatch`
   *inside* the callback runs the regex a second time on the same
   data. Wasteful.

For the simple case:

```go
out := re.ReplaceAllStringFunc(input, func(match string) string {
    n, _ := strconv.Atoi(match)
    return strconv.Itoa(n * 2)
})
```

For a case where you genuinely need submatches in the callback, walk
indices manually with `FindAllStringSubmatchIndex` — see
[middle.md](middle.md) section 14.

## 15. Trusting an `Atoi` after `\d`

```go
var idRE = regexp.MustCompile(`id=(\d+)`)

func extractID(s string) int {
    m := idRE.FindStringSubmatch(s)
    if m == nil { return 0 }
    n, _ := strconv.Atoi(m[1])
    return n
}
```

### Analysis

The pattern guarantees `m[1]` is one or more digits. So `Atoi` can't
return a parse error… but it can return an `*strconv.NumError` for
overflow. `\d+` matches arbitrary-length digit strings; one with 25
digits won't fit in `int`, and `Atoi` returns the platform max with
an error.

The silent ignore loses the overflow case.

The fix: cap the digit count, *or* check the error.

```go
var idRE = regexp.MustCompile(`id=(\d{1,18})`) // capped digits

// or
n, err := strconv.Atoi(m[1])
if err != nil { return 0 } // explicit, but at least non-silent
```

## 16. `(?P<name>` versus `(?<name>`

```go
re := regexp.MustCompile(`(?<year>\d{4})`)
```

### Analysis

Compile error: "invalid or unsupported Perl syntax: `(?<`". Go uses
the Python-style `(?P<name>...)`, not the Perl-style `(?<name>...)`.

The fix:

```go
re := regexp.MustCompile(`(?P<year>\d{4})`)
```

Migrators from JavaScript, Java, .NET, or PCRE hit this constantly.

## 17. `\b` in a `[]byte` context with non-ASCII

```go
re := regexp.MustCompile(`\bword\b`)
m := re.FindString("préword and wordé")
```

### Analysis

`\b` is a word-boundary assertion. In Go's regex, "word" is defined
by `\w` — which is ASCII-only `[0-9A-Za-z_]`. So between `é` (a
non-word character per Go's definition) and `w`, there's a word
boundary. The pattern matches both `word` instances inside `préword`
and `wordé`.

If you intended Unicode word boundaries, you have to build them
manually with Unicode classes:

```go
re := regexp.MustCompile(`(?:^|[^\p{L}])word(?:[^\p{L}]|$)`)
```

Or pre-segment the input using `bufio.Scanner` with a custom split
function.

This is a real footgun for international text. Document the
ASCII-only behavior of `\b` in any code that's expected to handle
mixed-script input.

## 18. Building patterns from user input without escaping

```go
func search(needle, haystack string) bool {
    re := regexp.MustCompile(needle)
    return re.MatchString(haystack)
}
```

### Analysis

Two bugs:

1. **`MustCompile` panics on bad patterns.** If `needle` is `(`, the
   server crashes. Use `Compile` and handle the error.
2. **The user can inject regex metacharacters.** Searching for `a.b`
   matches `axb`, not the literal `a.b`. If you want a substring
   search, escape the input with `regexp.QuoteMeta`.

The fix depends on intent:

```go
// User wants to search for an exact literal string:
re, err := regexp.Compile(regexp.QuoteMeta(needle))
if err != nil { return false }

// User wants to write regex syntax, you accept that:
re, err := regexp.Compile(needle)
if err != nil { return false }
```

`regexp.QuoteMeta` is the package's escape-for-literal helper. Use
it any time the input is supposed to be a string, not a pattern.

## 19. `Split` on empty pattern produces surprises

```go
re := regexp.MustCompile(``)
parts := re.Split("abc", -1)
fmt.Println(parts, len(parts))
```

### Analysis

The empty pattern matches at every position, including before the
first character and after the last. `Split` produces:
`["", "a", "b", "c", ""]` — five pieces from a three-character
string. Callers expecting "split by some delimiter" get five empty-
or-letter pieces and are confused.

If you want to split into individual runes, use a different
approach:

```go
runes := []rune("abc") // []rune{'a', 'b', 'c'}
```

If you really do want regex-driven splitting and the empty match is
a special case, filter:

```go
parts := re.Split(input, -1)
out := parts[:0]
for _, p := range parts {
    if p != "" {
        out = append(out, p)
    }
}
```

## 20. `MustCompile` on user input

```go
func searchHandler(w http.ResponseWriter, r *http.Request) {
    pattern := r.FormValue("q")
    re := regexp.MustCompile(pattern)
    results := matchAll(re, corpus)
    json.NewEncoder(w).Encode(results)
}
```

### Analysis

`MustCompile` panics on a bad pattern. A user submitting `(` crashes
the goroutine, which on a non-recovered server crashes the entire
process. Even with `recover` middleware, a malicious user can DoS
the service by sending a stream of bad patterns.

The fix is `Compile` plus error handling:

```go
re, err := regexp.Compile(pattern)
if err != nil {
    http.Error(w, "invalid pattern: "+err.Error(), 400)
    return
}
```

Add the bounds from [professional.md](professional.md) section 2:
length cap, complexity cap, possibly compile cache.

## 21. Mismatched submatch count

```go
re := regexp.MustCompile(`(a)|(b)`)
m := re.FindStringSubmatch("a")
fmt.Println(m[2])
```

### Analysis

The pattern has two capture groups. When the input is `a`, only the
first group participates; the second one didn't match, so its entry
in the submatch slice is `""` — but the slice itself has length
`NumSubexp+1 = 3`. The print shows an empty string, which the
author probably didn't expect.

The fix is to check submatch indices explicitly using the index API:

```go
m := re.FindStringSubmatchIndex("a")
if m[4] >= 0 {
    fmt.Println("matched group b")
} else {
    fmt.Println("matched group a")
}
```

Or use named captures with `SubexpIndex`:

```go
re := regexp.MustCompile(`(?P<a>a)|(?P<b>b)`)
m := re.FindStringSubmatch("a")
ai := re.SubexpIndex("a")
bi := re.SubexpIndex("b")
if m[ai] != "" { /* group a */ }
if m[bi] != "" { /* group b */ }
```

## 22. Reading: what to read next

- [optimize.md](optimize.md) — when the bug isn't correctness but
  throughput.
- [tasks.md](tasks.md) — exercises building each of the patterns
  these bugs subvert.
- [interview.md](interview.md) — pattern-spotting questions in
  conversational form.
