# 8.8 `regexp` — Senior

> **Audience.** You've shipped code that uses regex and you've been
> bitten at least once by leftmost-first semantics, an unanchored
> pattern eating CPU on a long input, or a `(?i)` flag that turned
> out to be more expensive than expected. This file is the precise
> contract: the RE2 algorithm at a high level, the match semantics
> the package guarantees, the concurrency rules, and the `regexp/syntax`
> escape hatch when you need to inspect the pattern itself.

## 1. RE2, in 200 words

RE2 compiles a pattern to a non-deterministic finite automaton (NFA)
and simulates it against the input. Unlike a backtracking engine
(PCRE, Perl, JavaScript) which tries one path through the NFA and
backtracks on failure, RE2 follows *all* paths simultaneously,
maintaining the set of currently-active states.

The consequence: every byte of input causes a constant amount of work
proportional to the size of the *pattern*, not the input. So matching
is `O(n*m)` where `n` is input length and `m` is pattern size, with
small constants. It is never exponential. There is no input — and no
pattern — that can make Go's regex run for minutes.

The cost: the NFA state-set semantics can't express features that
require remembering specific characters from earlier in the match.
Backreferences (`\1`) and lookaround (`(?=...)`, `(?<=...)`) are out
of reach. RE2 chose linear-time guarantees over these features, and
Go inherited that choice.

For the deep dive: Russ Cox, "Regular Expression Matching Can Be
Simple And Fast" (https://swtch.com/~rsc/regexp/regexp1.html). It's
the foundational write-up by Go's principal author of `regexp`.

## 2. The match-semantics rule: leftmost-first

The default semantics — and what Perl, JavaScript, and most modern
engines use — is **leftmost-first**:

> The match is the one starting at the leftmost position. Among
> alternatives at that position, the *first* (in pattern order) that
> completes a match wins.

```go
re := regexp.MustCompile(`a|aa`)
re.FindString("aaa") // "a" — alternative `a` comes first in the pattern
```

Both alternatives can match starting at position 0. Leftmost-first
picks `a` because it appears first in the alternation. The match ends
after one character.

Compare with **leftmost-longest** (POSIX ERE):

```go
re := regexp.MustCompilePOSIX(`a|aa`)
re.FindString("aaa") // "aa" — POSIX picks the longer match
```

The two semantics agree on most patterns. They diverge when:

- An alternation has alternatives of different lengths.
- A quantifier inside a group is greedy vs lazy in a way that makes
  the leftmost match end at different positions.

Why does Go default to leftmost-first?

1. It's what programmers expect from Perl-influenced regex.
2. It's faster — the engine can stop at the first complete match
   from the starting position, instead of running to the end of the
   input to confirm no longer match exists.
3. It's predictable. POSIX leftmost-longest has corner cases where
   tiny pattern changes cause large semantic shifts.

Use `CompilePOSIX` (or `re.Longest()`) only when you have a specific
reason — e.g., implementing a tool whose users expect POSIX `ere`
semantics (`grep -E`, `awk`).

## 3. Greedy vs lazy quantifiers, exactly

`a*` is *greedy*: it tries to match as many `a`s as possible. `a*?`
is *lazy*: it tries to match as few as possible. The semantics
interact with leftmost-first in subtle ways.

```go
greedy := regexp.MustCompile(`a.*b`)
greedy.FindString("axbycb") // "axbycb" — greedy .* eats up to the last b

lazy := regexp.MustCompile(`a.*?b`)
lazy.FindString("axbycb")   // "axb" — lazy .* stops at the first b
```

Both are leftmost: the match starts at the first `a`. Greedy and lazy
differ on *where it ends*.

Important: lazy quantifiers don't make patterns faster in RE2. The
NFA still tracks all states. The choice is purely semantic. (In a
backtracking engine, lazy can be faster *or* slower depending on
input shape; in RE2, they're equivalent in cost.)

## 4. The `regexp` package's specific guarantees

The contract, distilled from the package docs:

| Guarantee | Detail |
|-----------|--------|
| Linear time | Match time is `O(input length × pattern size)` regardless of input |
| Memory bounded | Match memory is `O(pattern size)`, independent of input |
| UTF-8 native | Patterns and inputs are UTF-8; `.` matches a rune, not a byte |
| Concurrency | A compiled `*Regexp` is safe for concurrent use |
| Determinism | Same pattern + same input produces the same match every time |
| Empty matches | A pattern that *can* match empty (`a*`) will produce zero-width matches |
| FindAll never overlaps | Each match starts at or after the end of the previous match |

The "match a rune" detail matters. `.` matches one Unicode codepoint,
which in UTF-8 is between 1 and 4 bytes. If you want to match exactly
one byte, you can't with the default flags.

## 5. UTF-8 vs bytes: when does it matter?

`regexp` operates on UTF-8. Every quantifier, every `.`, every
character class measures in *runes*, not bytes. The bytes of a malformed
sequence are fed through as the Unicode replacement character `U+FFFD`.

```go
re := regexp.MustCompile(`.`)
re.FindAllString("café", -1) // []string{"c", "a", "f", "é"} — 4 runes
len(re.FindAllString("café", -1)) // 4
len("café")                       // 5 (UTF-8 bytes)
```

If your input is *known* to be ASCII (logs in known charset, protocol
fields with byte-level grammar), you might want byte-level matching.
The `regexp` package doesn't directly support a "match exactly one
byte" mode, but you can:

1. **Use a byte-range character class:** `[\x00-\xff]` matches any
   single byte if the input is interpreted byte-by-byte. But the
   matcher still UTF-8 decodes, so a non-ASCII byte sequence is
   treated as `U+FFFD`.

2. **Use a different tool:** for binary data without UTF-8 framing,
   `bytes.Index`, hand-written state machines, or a parser are
   usually right.

For text data, accept the UTF-8 model and use the Unicode classes.

## 6. The `Regexp.Match` family on raw bytes

`Match([]byte)` doesn't validate UTF-8. It runs the matcher over the
raw bytes, decoding as it goes. Invalid sequences become `U+FFFD` for
matching purposes; the byte offsets returned are still byte offsets
into the original slice.

```go
re := regexp.MustCompile(`.`)
loc := re.FindIndex([]byte{0xc3, 0xa9, 0x66}) // "éf" in UTF-8
// loc == []int{0, 2}  — the "é" is 2 bytes
```

So `[]byte` and `string` methods produce identical match locations
for the same data. The difference is only in allocation.

## 7. Concurrency: when is `*Regexp` safe?

> A Regexp is safe for concurrent use by multiple goroutines, except
> for configuration methods, such as Longest.

What "safe" means precisely:

- All `Find*`, `Match*`, `ReplaceAll*`, and `Split*` methods can be
  called concurrently from any number of goroutines on the same
  `*Regexp`. No locking required by the caller.
- `Longest()` and `LiteralPrefix()` are read-only after compile, but
  `Longest()` mutates internal state — call it once at setup, not
  concurrently with matches.
- The match operation internally uses a per-call state (a "thread
  list"). The package maintains a small free-list of these so that
  concurrent calls don't allocate from scratch each time.

```go
// Safe pattern: package-level compile, used everywhere.
var emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+$`)

func handler(w http.ResponseWriter, r *http.Request) {
    if !emailRE.MatchString(r.FormValue("email")) {
        http.Error(w, "bad email", 400)
        return
    }
    // ...
}
```

A million concurrent requests share the one `*Regexp` with no extra
machinery on your side.

## 8. `(*Regexp).Copy` is deprecated

Before Go 1.6, the matcher kept a single state buffer per `*Regexp`
that was *not* safe for concurrent use. The `Copy` method existed so
that each goroutine could have its own buffer.

Since Go 1.6, the package maintains a free-list of state buffers
internally. `Copy` is documented as deprecated and is a thin shallow
copy — there's no reason to call it. Don't.

```go
// Pre-1.6 code (don't write today):
local := globalRE.Copy()
local.MatchString(s)

// Post-1.6 code (just use it):
globalRE.MatchString(s)
```

Older codebases sometimes have leftover `Copy` calls. Removing them
is safe and shrinks allocations.

## 9. Compile cost — and why you cache

`regexp.Compile` does real work:

1. Parses the pattern into an AST (see `regexp/syntax`).
2. Simplifies the AST (e.g., merges adjacent literal characters).
3. Compiles the AST to a program for the NFA simulator.
4. Optimizes the program for common cases (e.g., literal prefix
   detection, anchored detection).

Typical cost: tens of microseconds for a simple pattern, low
milliseconds for a long alternation with many alternatives. Compared
to a single match call (microseconds), compile is 10-1000x more
expensive.

The rule:

- Compile patterns *once*, at package init, into package-level vars.
- Never compile inside a hot loop.
- For patterns from external sources (config, user input), cache
  compiled results by pattern string. We'll cover this in
  [professional.md](professional.md).

```go
// Wrong: compile cost paid per call.
func bad(s string) bool {
    re := regexp.MustCompile(`\d+`)
    return re.MatchString(s)
}

// Right: compile cost paid once.
var digitRE = regexp.MustCompile(`\d+`)
func good(s string) bool {
    return digitRE.MatchString(s)
}
```

`go vet` doesn't catch this. A custom analyzer (or just a code
review) can.

## 10. ReDoS — Go is immune (and that matters)

A "ReDoS" attack is when a malicious input combined with a vulnerable
pattern causes a backtracking engine to spin for seconds or minutes,
denying service. Classic example:

```
pattern: ^(a+)+$
input:   aaaaaaaaaaaaaaaaaaaaaaaab
```

Perl, JavaScript, and Java's default engines all run this for many
seconds on a 30-character input. The same pattern in Go:

```go
re := regexp.MustCompile(`^(a+)+$`)
re.MatchString("aaaaaaaaaaaaaaaaaaaaaaaab") // returns false in microseconds
```

Linear time, regardless of pattern shape. There is no input that can
turn an arbitrary Go regex into a CPU bomb. This is the practical
dividend of choosing RE2.

What you still have to worry about:

- Compile time can be quadratic in pattern length for pathological
  patterns. Don't compile attacker-controlled patterns without a
  size cap (`if len(pattern) > 1000 { reject }`).
- A pattern that's correct but inefficient can still be slow on a
  long input — `O(n*m)` is linear but `m` can be large.
- A regex *plus* a Go-side loop that does work per match can be slow
  for reasons unrelated to the regex.

But the catastrophic backtracking class of bugs is closed off by the
engine choice. You can run user-supplied patterns against
user-supplied inputs and bound the work.

## 11. Anchored vs unanchored: the prefilter

When the pattern is unanchored, RE2 has to start the match at every
position. Internally, it uses a few optimizations:

1. **Literal prefix scan.** If the pattern starts with a literal
   string (`^foo` or `foo`), the engine searches for that literal
   using a Boyer-Moore-style scan and only runs the NFA from
   matches.
2. **One-pass mode.** For patterns where each input byte unambiguously
   transitions the NFA to one state, the engine uses a faster
   loop with no state-set bookkeeping.
3. **DFA caching.** RE2 lazily builds a DFA for the parts of the NFA
   it actually visits. This makes hot patterns much faster on long
   inputs after warmup.

You don't have direct control over these — but the choices in your
pattern affect which optimizations apply:

| Pattern shape | Effect |
|---------------|--------|
| Anchored at start (`^foo` or `\Afoo`) | NFA runs only at position 0 |
| Literal prefix (`error: \w+`) | Boyer-Moore scan for "error: " skips most of the input |
| Pure alternation of literals (`a|b|c|d`) | Matched as a single literal-set scan |
| Complex regex with many alternatives | Slower; consider splitting into multiple compiled patterns |

The biggest wins come from anchoring and literal prefixes. If you
have a pattern that should match at the beginning of a string, the
`^` is free *correctness* and free *speed*.

## 12. `regexp/syntax` — inspect the AST

The companion package `regexp/syntax` parses patterns into ASTs you
can walk programmatically. Useful when you build pattern-aware tools:
linters, query optimizers, schema generators.

```go
import "regexp/syntax"

re, err := syntax.Parse(`(?P<year>\d{4})-(?P<month>\d{2})`, syntax.Perl)
if err != nil { return err }

fmt.Println(re.String()) // canonical form
fmt.Println(re.Op)       // syntax.OpConcat
for i, sub := range re.Sub {
    fmt.Printf("  sub %d: %v %s\n", i, sub.Op, sub.Name)
}
```

The flags argument to `Parse` controls dialect:

| Flag | Effect |
|------|--------|
| `syntax.Perl` | Perl-style (the default for `regexp.Compile`) |
| `syntax.POSIX` | POSIX ERE; longer match wins |
| `syntax.UnicodeGroups` | Allow `\p{...}` |
| `syntax.OneLine` | `^` and `$` are absolute (default) |

`MatchString`-style work doesn't need this. It's an escape hatch for
tooling.

A real use case: extracting capture group names from a config-defined
pattern to validate they match a target struct's fields:

```go
func captureNames(pattern string) ([]string, error) {
    parsed, err := syntax.Parse(pattern, syntax.Perl)
    if err != nil { return nil, err }
    var names []string
    var walk func(*syntax.Regexp)
    walk = func(r *syntax.Regexp) {
        if r.Op == syntax.OpCapture && r.Name != "" {
            names = append(names, r.Name)
        }
        for _, s := range r.Sub {
            walk(s)
        }
    }
    walk(parsed)
    return names, nil
}
```

You could also call `re.SubexpNames()` on the compiled `*Regexp` —
but `regexp/syntax` works on a pattern string before you've committed
to compiling it.

## 13. Empty matches and `FindAll` semantics

A pattern that can match empty produces zero-width matches. The
`FindAll` family handles them by advancing one position past the
empty match before the next search:

```go
re := regexp.MustCompile(`a*`)
re.FindAllString("aaba", -1) // []string{"aa", "", "a", ""}
```

Reading the result: at position 0, `a*` matches `"aa"`. At position
2 (between the two non-`a` runs), it matches `""`. At position 2 (now
moved to 3), it matches `"a"`. At position 4 (after the last `a`),
it matches `""`.

The advance-after-empty rule prevents an infinite loop, but the
output looks weird until you know the rule. If you want to skip empty
matches, filter:

```go
matches := re.FindAllString(s, -1)
nonEmpty := matches[:0]
for _, m := range matches {
    if m != "" {
        nonEmpty = append(nonEmpty, m)
    }
}
```

Or use a pattern that requires at least one character: `a+` instead
of `a*`.

`Split` has the same flavor: `regexp.MustCompile("").Split("abc",
-1)` produces `["", "a", "b", "c", ""]` — five pieces from three
characters.

## 14. The "longest match" pitfall in alternations

A subtle leftmost-first gotcha:

```go
re := regexp.MustCompile(`http|https`)
re.FindString("https://example.com") // "http"
```

The pattern matches at position 0, and `http` is the first
alternative that succeeds. Even though `https` is also valid (and
longer), leftmost-first picks `http`.

The fix: put the longer alternative first.

```go
re := regexp.MustCompile(`https|http`)
re.FindString("https://example.com") // "https"
```

This bug shows up most often in keyword-tokenization patterns: `int`
appears before `integer` in the pattern, and the lexer happily
splits `integer` into `int` plus `eger`.

POSIX leftmost-longest avoids this — it picks the longest match —
but trades it for the surprises in section 2. Most Go code lives
with the rule and orders alternatives carefully.

## 15. `MatchReader` and `RuneReader`

The streaming variant works against an `io.RuneReader`:

```go
type RuneReader interface {
    ReadRune() (r rune, size int, err error)
}
```

`bufio.Reader`, `strings.Reader`, and `bytes.Reader` all implement it.
For a generic `io.Reader`, wrap with `bufio.NewReader`:

```go
re := regexp.MustCompile(`ERROR`)
br := bufio.NewReader(file)
matched := re.MatchReader(br)
```

The matcher consumes runes one at a time. It does not buffer beyond
what the simulator needs to make a decision. The reader's position
advances during the match, so a successful `MatchReader` leaves the
reader pointing at the byte *after* the match (or at end of stream).

A failed match consumes the entire stream (the matcher has to read to
EOF to know nothing matches). For long files, this is what you'd
expect — the matcher needs every byte to be sure.

`MatchReader` is the only streaming method. There's no
`FindReader` because a single "find" doesn't fit the streaming
model: it would need to buffer the matched text or commit to some
windowing semantic. The package author chose not to ship a partial
solution.

## 16. The cost of `(?i)` — the table

| Pattern | Approx. throughput |
|---------|--------------------|
| `hello` | 5-10 GB/s — literal scan |
| `[Hh]ello` | 4-8 GB/s — small char class |
| `[Hh][Ee][Ll][Ll][Oo]` | 1-2 GB/s — char-class chain |
| `(?i)hello` | 0.5-1 GB/s — Unicode case-folding |
| `(?i)\p{L}+` | 0.1-0.3 GB/s — Unicode classes plus folding |

Numbers from a 2024 mid-range Linux server, single core, on synthetic
inputs. Yours will differ, but the ratios are stable.

The takeaway: `(?i)` is correct and Unicode-aware, but it's the
slowest of the case-insensitive options. For ASCII-known input, manual
char classes are several times faster. For mixed-script input, you
need `(?i)` — the manual chains don't fold across scripts.

## 17. `Longest` vs `CompilePOSIX` — the tiny difference

`CompilePOSIX(p)` is `Compile(p)` followed by `re.Longest()`. There
is no syntax difference. The same patterns compile in both modes;
only the match semantics change.

You'd reach for `CompilePOSIX` over `Compile` plus `Longest` when:

- The compile-time check should *fail* on patterns that aren't valid
  POSIX ERE. `CompilePOSIX` rejects Perl extensions (the back-slash
  classes `\d`, `\w`, named groups `(?P<...>)`, the inline flags
  `(?i)`). `Compile` accepts them.

So `CompilePOSIX` is two restrictions: longer match wins, *and* no
Perl features. Useful for implementing tools whose grammar is locked
to POSIX. Useless otherwise.

## 18. The `Regexp.NumSubexp` and pattern arity

A pattern's "subexpression count" is the number of capturing groups,
counting only `(...)` and `(?P<name>...)`, not `(?:...)`.

```go
re := regexp.MustCompile(`(a)(b)(?:c)(d)`)
re.NumSubexp() // 3 — the (?:c) doesn't count
```

`FindStringSubmatch` returns a slice of length `NumSubexp()+1`:
index 0 is the whole match, then each capture in order.

When you wrap a regex in another regex (e.g., add a prefix), the
capture indices shift. Use named captures plus `SubexpIndex` to make
your code robust to that:

```go
const corePat = `(?P<key>\w+)=(?P<val>\w+)`
const wrappedPat = `\[` + corePat + `\]`

re := regexp.MustCompile(wrappedPat)
m := re.FindStringSubmatch("[name=alice]")
fmt.Println(m[re.SubexpIndex("val")]) // "alice"
```

If you used numeric indices (`m[1]`, `m[2]`), changing the wrapper
shifts the indices and silently breaks the code.

## 19. Matching across CRLF and other line-end variants

`(?m)` makes `^` and `$` match at line boundaries, but the package
defines a "line boundary" as `\n` only. CRLF (`\r\n`) on Windows
terminations leave a trailing `\r` in the match if you use `$`:

```go
re := regexp.MustCompile(`(?m)^foo$`)
re.FindString("foo\r\n") // "foo\r" — the \r is matched by .
```

The fix: explicitly allow `\r` before `$`:

```go
re := regexp.MustCompile(`(?m)^foo\r?$`)
re.FindString("foo\r\n") // "foo"
```

Or strip CRLF before matching, which is usually cleaner. `bufio.
Scanner` strips both LF and CRLF by default — letting you avoid the
issue when you process files line by line.

## 20. Reading the bytecode

For deep debugging, `*Regexp` exposes its compiled program via the
`String()` method (which prints the pattern, not the bytecode). The
bytecode itself is internal and not exported.

If you need to see what the compiler did, the `regexp/syntax`
package's `Prog` type is the public form:

```go
import "regexp/syntax"

re, _ := syntax.Parse(`a|b`, syntax.Perl)
prog, _ := syntax.Compile(re)
fmt.Println(prog)
// 0       fail
// 1*      alt -> 2, 4
// 2       rune1 "a" -> 5
// ...
```

This is useful when a pattern doesn't perform as expected — you can
see whether the compiler hoisted the literal prefix, whether the
alternation collapsed to a char class, etc. In practice, very few
applications need this depth.

## 21. Cross-leaf: scanning files line-by-line

The standard production pattern is `bufio.Scanner` plus a
package-level `*Regexp`:

```go
var errRE = regexp.MustCompile(`(?i)\berror\b`)

func countErrorLines(r io.Reader) (int, error) {
    s := bufio.NewScanner(r)
    s.Buffer(make([]byte, 64*1024), 1<<20) // long lines
    n := 0
    for s.Scan() {
        if errRE.Match(s.Bytes()) {
            n++
        }
    }
    return n, s.Err()
}
```

Two cross-leaf details worth re-stating:

- Use `s.Bytes()` rather than `s.Text()` — `s.Bytes()` is a view into
  the scanner's buffer (no allocation) and `re.Match([]byte)` doesn't
  need a string. This is from
  [`../01-io-and-file-handling/middle.md`](../01-io-and-file-handling/middle.md)
  section 13 and saves an allocation per line.
- Raise the scanner's token cap if your lines might be long. The
  default 64 KiB cap is for typical text logs, not for JSON-per-line
  or binary-encoded lines. See the same file for the `Buffer` method.

## 22. Reading: what to read next

- [professional.md](professional.md) — the patterns used in production:
  pattern caches, allocation-free matching at scale, observability,
  rejecting expensive patterns at compile time.
- [specification.md](specification.md) — the formal method matrix
  and syntax tables in one place.
- [optimize.md](optimize.md) — when correct isn't fast enough.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file.

External:

- Russ Cox, "Regular Expression Matching Can Be Simple And Fast"
  (https://swtch.com/~rsc/regexp/regexp1.html). The foundational
  paper behind RE2.
- The RE2 syntax reference:
  https://github.com/google/re2/wiki/Syntax.
- Alfred Aho, "Algorithms for Finding Patterns in Strings" (1990) —
  the classic algorithmic survey, if you want the longer history.
