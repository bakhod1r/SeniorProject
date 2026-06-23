# 8.8 `regexp` — Junior

> **Audience.** You've matched a few patterns in another language —
> Python, JavaScript, maybe `grep` — and now you need to do it in Go.
> By the end of this file you will know which method to call, how to
> compile a pattern correctly, the syntax that actually works (and the
> common syntax that doesn't), and the dozen patterns that cover most
> day-to-day work.

## 1. The first thing to know: this is RE2, not PCRE

Go's `regexp` package implements [RE2](https://github.com/google/re2),
not Perl Compatible Regular Expressions. The practical consequence:

- **No backreferences.** `(\w+)\s+\1` is *not* a valid pattern in Go.
- **No lookahead or lookbehind.** `(?=...)`, `(?!...)`, `(?<=...)`,
  `(?<!...)` are all unsupported.
- **Everything else is fine.** Character classes, quantifiers,
  alternation, groups, named captures, Unicode classes — all there.

Why the missing features? RE2 guarantees match time linear in the
length of the input, regardless of the pattern. Backreferences and
lookaround would break that guarantee. The trade-off is worth it: a
PCRE engine on a malicious pattern can pin a CPU for minutes. A Go
`regexp` cannot.

If a tutorial tells you to use `(?<=foo)bar` and you copy-paste it
into Go, the compile fails with `error parsing regexp: invalid or
unsupported Perl syntax`. The fix is almost always to restructure the
match — capture the prefix as a group and ignore it, instead of using
lookbehind to assert it.

## 2. Compile, MustCompile, or CompilePOSIX

There are three constructors:

```go
re, err := regexp.Compile(`\d+`)            // returns (*Regexp, error)
re := regexp.MustCompile(`\d+`)             // panics on bad pattern
re := regexp.MustCompile(`(?i)hello`)       // ditto
rePOSIX, _ := regexp.CompilePOSIX(`a|aa`)   // leftmost-longest semantics
```

The rule is simple:

| You're compiling… | Use |
|-------------------|-----|
| A literal pattern at package init | `MustCompile` |
| A user-supplied pattern at runtime | `Compile` (and check the error) |
| A pattern that needs POSIX leftmost-longest | `CompilePOSIX` |

`MustCompile` is the right choice for constants. It runs once at
program startup; if the pattern is wrong, you find out immediately
with a clear panic, not at the moment a request finally exercises that
code path. Don't be afraid of the panic — it can only fire on
program-author bugs, never on user input.

```go
var emailish = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func looksLikeEmail(s string) bool {
    return emailish.MatchString(s)
}
```

`Compile` returns an error you must handle. Reach for it when the
pattern comes from outside your code — a config file, a query string,
a database. Never use `MustCompile` on user input; a malicious user
can crash your service with one bad character.

`CompilePOSIX` changes match semantics, not syntax. We'll cover the
difference in [senior.md](senior.md). For now: 99% of the time you
want `Compile` or `MustCompile`.

## 3. The method matrix, in one table

The `*Regexp` type has a lot of methods. They fit a grid:

| | Bool only | First match | All matches | Replace | Split |
|-|-----------|-------------|-------------|---------|-------|
| **string** | `MatchString` | `FindString` | `FindAllString` | `ReplaceAllString` | `Split` |
| **[]byte** | `Match` | `Find` | `FindAll` | `ReplaceAll` | `Split` (via string) |
| **io.Reader** | `MatchReader` | — | — | — | — |
| **with submatches** | — | `FindStringSubmatch` | `FindAllStringSubmatch` | — | — |
| **with byte indices** | — | `FindStringIndex` | `FindAllStringIndex` | — | — |

Reading the table:

- Pick a row by what you have (a `string`, a `[]byte`, or an
  `io.Reader`).
- Pick a column by what you want (a yes/no answer, the first match,
  every match, a replacement, or the parts between matches).
- Add `Submatch` if you want capture groups, or `Index` if you want
  byte offsets instead of strings.

There are also `*Func` variants (`ReplaceAllStringFunc`,
`ReplaceAllFunc`) that take a callback for replace logic. We'll cover
them in [middle.md](middle.md).

## 4. The four methods you'll use most

Most code uses exactly four:

```go
re := regexp.MustCompile(`\d+`)

re.MatchString("abc 123 def")         // true
re.FindString("abc 123 def")          // "123"
re.FindAllString("a 1 b 22 c 333", -1) // []string{"1", "22", "333"}
re.ReplaceAllString("hi 12 there", "*") // "hi * there"
```

Notes:

- `FindAllString`'s second argument is a max-match cap. `-1` means "no
  cap, return everything." `2` means "stop after 2 matches." Almost
  always pass `-1`.
- `FindString` returns `""` if there is no match. So does an empty
  match. If you need to distinguish "no match" from "matched empty
  string," use `FindStringIndex` and check for a `nil` result.
- `ReplaceAllString` returns the original string if there's no match.
  No allocation in that case (Go 1.22+).

If you're doing a yes/no check, prefer `MatchString` over
`FindString != ""`. `MatchString` can stop at the first match;
`FindString` builds a string slice and returns it.

## 5. The pattern syntax, the ten things you actually need

Most of the syntax is the same as in any regex flavor. The cheat
sheet:

| Syntax | Meaning |
|--------|---------|
| `.` | Any character except `\n` (use `(?s)` to include `\n`) |
| `\d` `\D` | Decimal digit / not a digit |
| `\w` `\W` | Word character `[0-9A-Za-z_]` / not a word character |
| `\s` `\S` | Whitespace / not whitespace |
| `[abc]` | Any of `a`, `b`, `c` |
| `[^abc]` | Anything except `a`, `b`, `c` |
| `[a-z]` | Range |
| `a*` `a+` `a?` | Zero or more, one or more, optional |
| `a{3}` `a{3,}` `a{3,5}` | Exactly 3, at least 3, between 3 and 5 |
| `a*?` `a+?` `a??` `a{3,5}?` | Non-greedy variants |
| `^` `$` | Start / end of text (or line with `(?m)`) |
| `\b` `\B` | Word boundary / not a word boundary |
| `a|b` | Alternation |
| `(abc)` | Capturing group |
| `(?:abc)` | Non-capturing group |
| `(?P<name>abc)` | Named capturing group |
| `(?i)` | Case-insensitive flag |
| `(?m)` | Multiline (`^` and `$` match at line boundaries) |
| `(?s)` | Dot-all (`.` matches `\n`) |

Important Go-specific details:

- The named-group syntax is `(?P<name>...)` (Python style), not
  `(?<name>...)`. The latter is a compile error.
- Inline flags can also be set per-group: `(?i:hello)` matches `hello`
  case-insensitively but doesn't change the rest of the pattern.
- `\d`, `\w`, and `\s` are ASCII-only by default. To match all
  Unicode digits, use `[\p{Nd}]`. To match all Unicode letters, use
  `[\p{L}]`. (More on this in [middle.md](middle.md).)
- There are no inline `(?x)` extended-mode comments. If you want a
  multi-line readable pattern, build the string with normal Go
  concatenation and add comments in Go.

## 6. Raw string literals: stop fighting backslashes

Always write patterns as raw strings (backticks), never as
double-quoted strings:

```go
// CORRECT
re := regexp.MustCompile(`\d+`)

// WRONG: \d is not a valid Go escape — compile error.
re := regexp.MustCompile("\d+")

// WORSE: compiles, but \\d means "backslash, d" twice over.
re := regexp.MustCompile("\\d+")
```

Raw strings let you write `\d`, `\s`, `\b`, `\.`, etc. exactly as the
regex syntax expects them. The only thing you can't put in a raw
string is a backtick itself. If you need one, concatenate:

```go
re := regexp.MustCompile("`" + `[a-z]+` + "`")
```

## 7. Anchors: `^`, `$`, and `\A`, `\z`

By default `^` and `$` match the start and end of the *entire input*,
not of each line:

```go
re := regexp.MustCompile(`^foo$`)
re.MatchString("foo")        // true
re.MatchString("bar\nfoo")    // false — ^ is start of input
```

Add the `(?m)` flag to make them match line boundaries:

```go
re := regexp.MustCompile(`(?m)^foo$`)
re.MatchString("bar\nfoo")    // true
```

`\A` and `\z` are absolute anchors that ignore `(?m)`:

| Anchor | Meaning |
|--------|---------|
| `^` | Start of input, or start of line with `(?m)` |
| `$` | End of input, or end of line with `(?m)` |
| `\A` | Start of input, always |
| `\z` | End of input, always |

Use `\A` and `\z` when you want a "must match the whole string" check
that's robust to flag changes:

```go
re := regexp.MustCompile(`\Aabc\z`) // exactly "abc"
```

## 8. `(?i)` and the others: where flags go

Flags can be set in three places:

```go
// 1. As the first thing in the pattern — applies to whole pattern.
regexp.MustCompile(`(?i)hello`)

// 2. As a flag-only group — applies from that point onward.
regexp.MustCompile(`hello (?i)world`) // "hello" case-sensitive, "world" not

// 3. As a scoped group — applies only inside.
regexp.MustCompile(`(?i:hello) world`) // "hello" case-insensitive, "world" sensitive
```

You can combine flags: `(?im)` is case-insensitive and multiline. To
*disable* a flag inside a scope, prefix with `-`:

```go
regexp.MustCompile(`(?i)foo (?-i:bar) baz`)
// "foo" and "baz" are case-insensitive; "bar" must match exactly.
```

## 9. Groups and submatches

A parenthesized group captures the matching substring:

```go
re := regexp.MustCompile(`(\w+)=(\w+)`)
m := re.FindStringSubmatch("name=alice")
// m[0] == "name=alice"  // the whole match
// m[1] == "name"        // first capture
// m[2] == "alice"       // second capture
```

`FindStringSubmatch` returns a slice where index 0 is the entire
match and indices 1..N are the captures, in order of opening
parenthesis. If a capture didn't participate in the match (it was
inside an alternative that was skipped), the entry is `""`.

`(?:...)` makes a group non-capturing — useful when you want to apply
a quantifier to a sub-pattern but don't want to count it as a
submatch:

```go
re := regexp.MustCompile(`(?:foo|bar)+`) // no capture
```

Named captures use `(?P<name>...)` and are read with `SubexpNames`:

```go
re := regexp.MustCompile(`(?P<key>\w+)=(?P<val>\w+)`)
m := re.FindStringSubmatch("name=alice")
for i, name := range re.SubexpNames() {
    if i > 0 && name != "" {
        fmt.Printf("%s=%s\n", name, m[i])
    }
}
// Output:
// key=name
// val=alice
```

The names are also valid replacement references (next section).

## 10. Replace: `$1`, `${name}`, and the literal-dollar trick

`ReplaceAllString` lets you reference captures in the replacement:

```go
re := regexp.MustCompile(`(\w+) (\w+)`)
re.ReplaceAllString("Alice Smith", "$2 $1")
// "Smith Alice"
```

For named captures, use `${name}`:

```go
re := regexp.MustCompile(`(?P<first>\w+) (?P<last>\w+)`)
re.ReplaceAllString("Alice Smith", "${last}, ${first}")
// "Smith, Alice"
```

The `$` syntax has two pitfalls:

1. **Adjacent text.** `$1abc` looks for a capture named `1abc`, not
   capture 1 followed by literal `abc`. Use `${1}abc` to disambiguate.
2. **Literal dollar.** To put a literal `$` in the replacement, write
   `$$`. A bare `$` followed by anything tries to be a reference.

If you need replace logic that goes beyond capture interpolation,
use `ReplaceAllStringFunc`:

```go
re := regexp.MustCompile(`\d+`)
re.ReplaceAllStringFunc("a 1 b 22", func(m string) string {
    n, _ := strconv.Atoi(m)
    return strconv.Itoa(n * 10)
})
// "a 10 b 220"
```

The callback gets the full match (no submatches). For per-submatch
logic, see [middle.md](middle.md).

## 11. `Split` — the inverse of `FindAll`

`Split` returns the strings between matches:

```go
re := regexp.MustCompile(`\s+`)
re.Split("hello   world  go", -1)
// []string{"hello", "world", "go"}
```

The second argument is a max-piece cap. `-1` means no cap.

Edge cases:

- A leading match produces a leading `""`: `re.Split(" abc", -1)` is
  `["", "abc"]`.
- A trailing match produces a trailing `""`: `re.Split("abc ", -1)` is
  `["abc", ""]`.
- An empty pattern splits between every UTF-8 rune:
  `regexp.MustCompile("").Split("abc", -1)` returns `["", "a", "b",
  "c", ""]`.

For simple whitespace splits, `strings.Fields` is faster and trims
the empties for you. Reach for `regexp.Split` only when the delimiter
itself is a regex.

## 12. `[]byte` vs `string` — pick the matching API

For every `*String` method there's a `[]byte` counterpart that drops
the suffix:

| String | Byte |
|--------|------|
| `MatchString` | `Match` |
| `FindString` | `Find` |
| `FindAllString` | `FindAll` |
| `ReplaceAllString` | `ReplaceAll` |
| `FindStringSubmatch` | `FindSubmatch` |
| `FindAllStringSubmatch` | `FindAllSubmatch` |
| `FindStringIndex` | `FindIndex` |

The rule:

- If your data is already a `[]byte` (a buffer, a file, an HTTP body),
  use the byte methods. Converting to `string` first costs an
  allocation per call.
- If your data is already a `string` (a query parameter, a config
  value), use the string methods. Going through `[]byte(s)` and back
  is wasteful.

`MatchString(s)` is *not* the same as `Match([]byte(s))` for the
allocation profile, even though they always produce the same boolean.

Either way, the *compiled* `*Regexp` is the same — methods don't
recompile. Compile once at package init, call as many times as you
like.

## 13. The tiny patterns you'll write a hundred times

These show up in almost every program. Memorize them.

```go
// Strip whitespace at start or end (don't use this — strings.TrimSpace is faster)
trimSpace := regexp.MustCompile(`^\s+|\s+$`)

// Numeric ID at end of a path: /users/42 -> "42"
trailingID := regexp.MustCompile(`/(\d+)$`)

// Match a "word" by Unicode definition
unicodeWord := regexp.MustCompile(`\p{L}+`)

// Match an IPv4 address (rough — see senior.md for a tight one)
roughIPv4 := regexp.MustCompile(`\b\d{1,3}(\.\d{1,3}){3}\b`)

// Split CSV-ish, simple commas only (don't use for real CSV)
commaSplit := regexp.MustCompile(`\s*,\s*`)

// Find all hashtags in a tweet
hashtag := regexp.MustCompile(`#[\p{L}\p{N}_]+`)
```

Two warnings:

1. **Don't reach for regexp on simple checks.** `strings.Contains`,
   `strings.HasPrefix`, `strings.HasSuffix`, `strings.Cut`, and
   `strings.Fields` are dramatically faster than the equivalent
   regex. Use regex when the pattern actually varies; use plain
   string functions when it doesn't.

2. **Real CSV needs `encoding/csv`, real email needs a parser, real
   URL parsing needs `net/url`.** Regex is great for "rough match"
   and terrible for grammars. The line is when you find yourself
   adding the third special case.

## 14. A complete tiny tool: count words by length

A worked example bringing it all together. Read stdin, count tokens
of each length:

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "regexp"
)

var wordRE = regexp.MustCompile(`\p{L}+`)

func main() {
    counts := map[int]int{}
    sc := bufio.NewScanner(os.Stdin)
    for sc.Scan() {
        for _, w := range wordRE.FindAllString(sc.Text(), -1) {
            counts[len([]rune(w))]++
        }
    }
    if err := sc.Err(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
    for length := 1; length <= 20; length++ {
        if c := counts[length]; c > 0 {
            fmt.Printf("%2d: %d\n", length, c)
        }
    }
}
```

What's worth noting:

- The pattern is compiled *once* as a package var. Compiling inside
  the loop is the most common performance bug.
- We use `\p{L}+` for "Unicode letters" rather than `\w+`, which would
  miss accented and non-Latin words.
- We pair `bufio.Scanner` with `FindAllString` per line. For huge
  files where lines are long, you'd raise the scanner's token cap
  (see [`../01-io-and-file-handling/junior.md`](../01-io-and-file-handling/junior.md)
  section 10).
- `len([]rune(w))` is the rune count; `len(w)` would be the byte
  count, which is wrong for non-ASCII text.

## 15. Common errors at this level

| Symptom | Cause |
|---------|-------|
| `error parsing regexp: invalid escape sequence: '\d'` (compile-time) | Wrote pattern in `"..."` not `` `...` `` |
| `error parsing regexp: invalid or unsupported Perl syntax: '(?<'` | Used `(?<name>...)` instead of `(?P<name>...)` |
| `error parsing regexp: invalid or unsupported Perl syntax: '(?='` | Used lookahead — not supported in RE2 |
| Match returns `""` and you can't tell if it matched | Use `FindIndex`; `nil` means no match, non-nil means match (possibly empty) |
| Replace produces `$1` literally in output | Wrote `\1` instead of `$1` (Go uses `$`) |
| Replace adds a literal dollar by accident | Need `$$` in the replacement string for a real `$` |
| Performance is awful | Pattern is being compiled in a loop — hoist it to a package var |

## 16. `QuoteMeta` — escape user input as a literal

When the user types a search string and you need to use it inside a
larger regex, escape the metacharacters first:

```go
needle := "a.b" // user wants the literal three characters
re := regexp.MustCompile(`\b` + regexp.QuoteMeta(needle) + `\b`)
re.FindString("a.b is here") // "a.b" — exact substring
re.FindString("axb is here") // "" — the . is literal
```

Without `QuoteMeta`, `a.b` would be a regex matching `axb`, `a-b`,
and any other three-character string with `a` and `b` at the ends.
That's almost never what the user typed.

`QuoteMeta` escapes everything that has special meaning: `\`, `.`,
`+`, `*`, `?`, `(`, `)`, `[`, `]`, `{`, `}`, `^`, `$`, `|`. It does
not escape characters that are already literal.

The same advice for any pattern-building helper that accepts a
user-supplied substring. Forgetting `QuoteMeta` is a common bug at
the junior level — and a security bug if the user can supply a
denial-of-service-flavored pattern through a string field.

## 17. The `\Q...\E` escape — same idea, inline

A second way to embed literals in a pattern: `\Q...\E` makes
everything between literal:

```go
re := regexp.MustCompile(`\Q[a]\E.*`)
// Matches the literal string "[a]" followed by anything.
```

This is mostly useful when you have a pattern that includes a fixed
chunk you want to write out plainly without escape-soup:

```go
re := regexp.MustCompile(`\Qhttp://example.com/api/v1/\E\w+`)
```

Compare with manually escaping each special character:
`http://example\.com/api/v1/\w+`. The `\Q...\E` form is easier to
read and harder to typo.

## 18. Reading the result of `FindAllStringSubmatch`

When a pattern has captures, `FindAllStringSubmatch` returns one
slice per match, where each inner slice has length `1 + NumSubexp`.

```go
re := regexp.MustCompile(`(\w+)=(\w+)`)
all := re.FindAllStringSubmatch("name=alice age=30", -1)
// all[0] == ["name=alice", "name", "alice"]
// all[1] == ["age=30",     "age",  "30"]

for _, m := range all {
    fmt.Printf("%s = %s\n", m[1], m[2])
}
```

The shape is "match outer, captures inner." Don't confuse this with
`FindAllString`, which returns just the match texts (no captures —
flat `[]string`).

## 19. Errors with `Compile`

When `Compile` returns an error, it's a `*regexp.Error` (which
embeds a `regexp/syntax.Error`). Useful fields:

```go
re, err := regexp.Compile(userPattern)
if err != nil {
    var rerr *syntax.Error
    if errors.As(err, &rerr) {
        // rerr.Code: one of ErrInvalidEscape, ErrInvalidCharClass, etc.
        // rerr.Expr: the substring that triggered the error
        log.Printf("bad regex: %s in %q", rerr.Code, rerr.Expr)
    }
    return err
}
```

For most cases, just surfacing `err.Error()` to the caller is fine —
the error string is human-readable and points at the problem
character.

If you're building a service that accepts user-supplied patterns,
returning the error in an HTTP 400 response is appropriate. Don't
panic, don't swallow.

## 20. A note on testing regex code

For functions that use regex, the test should exercise both
positive and negative cases. The pattern that worked at deploy
slowly stops matching as the inputs evolve — a regression test
catches the drift.

```go
func TestEmailish(t *testing.T) {
    cases := []struct {
        in   string
        want bool
    }{
        {"alice@example.com", true},
        {"alice+tag@example.co.uk", true},
        {"no-at-sign", false},
        {"two@@at", false},
        {"trailing@", false},
        {"", false},
    }
    for _, tc := range cases {
        t.Run(tc.in, func(t *testing.T) {
            if got := looksLikeEmail(tc.in); got != tc.want {
                t.Errorf("got %v want %v", got, tc.want)
            }
        })
    }
}
```

For high-stakes regexes (security filters, billing rules), include
*counter*-examples — strings that look like they should match but
shouldn't. The counter-examples catch drift in both directions and
document the intended scope of the pattern in code that runs in CI.

## 21. What to read next

- [middle.md](middle.md) — submatches, Unicode classes, replace
  callbacks, the index methods, named captures in depth.
- [senior.md](senior.md) — leftmost-first vs leftmost-longest, the
  RE2 algorithm, concurrency, `regexp/syntax`.
- [tasks.md](tasks.md) — exercises that exercise the methods in
  this file.
- The official package docs:
  [`regexp`](https://pkg.go.dev/regexp),
  [`regexp/syntax`](https://pkg.go.dev/regexp/syntax).
- The RE2 syntax reference:
  [https://github.com/google/re2/wiki/Syntax](https://github.com/google/re2/wiki/Syntax).
