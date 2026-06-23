# 8.8 `regexp` — Specification

Reference material. Method matrix, syntax tables, and the formal
guarantees of the RE2-based engine. For prose explanations see
[senior.md](senior.md); for production patterns see
[professional.md](professional.md).

## 1. Construction

| Function | Returns | Behavior on bad pattern |
|----------|---------|--------------------------|
| `Compile(expr string)` | `(*Regexp, error)` | Returns error |
| `MustCompile(expr string)` | `*Regexp` | Panics |
| `CompilePOSIX(expr string)` | `(*Regexp, error)` | Returns error; rejects Perl features |
| `MustCompilePOSIX(expr string)` | `*Regexp` | Panics; rejects Perl features |

`CompilePOSIX` enables leftmost-longest semantics. `(*Regexp).Longest()`
is the runtime equivalent on a `Compile`-built regex.

## 2. Method matrix

For an input of type T (either `string` or `[]byte`):

| Operation | bool | first match | all matches | submatch | submatch all |
|-----------|------|-------------|-------------|----------|--------------|
| string in | `MatchString` | `FindString` | `FindAllString` | `FindStringSubmatch` | `FindAllStringSubmatch` |
| []byte in | `Match` | `Find` | `FindAll` | `FindSubmatch` | `FindAllSubmatch` |
| io.RuneReader in | `MatchReader` | — | — | — | — |
| Index variants | — | `FindStringIndex` / `FindIndex` | `FindAllStringIndex` / `FindAllIndex` | `FindStringSubmatchIndex` / `FindSubmatchIndex` | `FindAllStringSubmatchIndex` / `FindAllSubmatchIndex` |

Replace operations (string and []byte forms):

| Operation | Form |
|-----------|------|
| Replace by literal | `ReplaceAllString(src, repl)` / `ReplaceAll(src, repl)` |
| Replace by literal (no `$` interpretation) | `ReplaceAllLiteralString` / `ReplaceAllLiteral` |
| Replace by callback (whole match) | `ReplaceAllStringFunc(src, fn)` / `ReplaceAllFunc(src, fn)` |
| Apply replacement template to one match | `ExpandString(dst, tpl, src, match)` / `Expand(dst, tpl, src, match)` |

Splitting:

| Method | Returns |
|--------|---------|
| `Split(s string, n int)` | `[]string`; `n < 0` means no cap |

Pattern introspection:

| Method | Purpose |
|--------|---------|
| `String()` | The source pattern as compiled |
| `NumSubexp()` | Count of capturing groups |
| `SubexpNames()` | Slice of names (index 0 always `""`) |
| `SubexpIndex(name)` | Numeric index for a name, or `-1` |
| `LiteralPrefix()` | `(prefix, complete)` — guaranteed literal start |
| `Longest()` | Switch to leftmost-longest semantics (mutating) |
| `Copy()` | Deprecated since Go 1.6; do not use |

## 3. `FindAll*` cap argument

```go
re.FindAll(src, n)
```

| `n` | Meaning |
|-----|---------|
| `n < 0` | All non-overlapping matches |
| `n >= 0` | At most `n` matches; stop early |
| `n == 0` | Returns `nil` (zero matches requested) |

## 4. Submatch index encoding

`FindSubmatchIndex(src)` returns a `[]int` of length `2*(NumSubexp()+1)`:

| Index pair | Meaning |
|-----------|---------|
| `[0:2]` | Start/end of whole match |
| `[2:4]` | Start/end of capture group 1 |
| `[4:6]` | Start/end of capture group 2 |
| ... | ... |

A capture that did not participate is encoded as `-1, -1`. Always
check `>= 0` before slicing.

## 5. Replacement-string syntax

| Syntax | Meaning |
|--------|---------|
| `$0` | Whole match |
| `$N` (N >= 1) | Capture group `N` (greedy: largest `N` that names a real group) |
| `${N}` | Capture group `N` (explicit boundary) |
| `${name}` | Named capture |
| `$$` | Literal `$` |
| `$Nabc` | If `Nabc` is not a name, equivalent to `${N}abc` only if `N` is parseable |

`ReplaceAllLiteralString` skips this interpretation entirely.

## 6. Pattern syntax — characters and escapes

| Syntax | Matches |
|--------|---------|
| literal char | itself |
| `.` | any char except `\n` (any char including `\n` with `(?s)`) |
| `[xyz]` | any of `x`, `y`, `z` |
| `[^xyz]` | not in set |
| `[a-z]` | range |
| `\d` | `[0-9]` |
| `\D` | `[^0-9]` |
| `\s` | `[\t\n\f\r ]` |
| `\S` | `[^\t\n\f\r ]` |
| `\w` | `[0-9A-Za-z_]` |
| `\W` | `[^0-9A-Za-z_]` |
| `\pX` / `\PX` | Unicode property X / not X (one-letter) |
| `\p{Name}` / `\P{Name}` | Unicode property by full name |
| `\xFF` | byte by hex |
| `\x{10FFFF}` | rune by hex |
| `\Q...\E` | literal text (everything between is literal) |
| `\\`, `\.`, `\*`, ... | metacharacters as literals |

## 7. Pattern syntax — operators

| Syntax | Meaning |
|--------|---------|
| `xy` | concatenation |
| `x|y` | alternation |
| `x*` | zero or more (greedy) |
| `x+` | one or more (greedy) |
| `x?` | zero or one (greedy) |
| `x{n}` | exactly n |
| `x{n,}` | n or more |
| `x{n,m}` | between n and m inclusive |
| `x*?`, `x+?`, `x??`, `x{n,m}?` | non-greedy variants |
| `(re)` | numbered capturing group |
| `(?P<name>re)` | named capturing group |
| `(?:re)` | non-capturing group |
| `(?flags)` | set flags from this point |
| `(?flags:re)` | set flags scoped to this group |

Flags (any combination, prefix with `-` to clear):

| Flag | Effect |
|------|--------|
| `i` | case-insensitive |
| `m` | multi-line: `^` `$` match at `\n` boundaries |
| `s` | let `.` match `\n` |
| `U` | swap meaning of `x*` and `x*?` |

## 8. Anchors

| Anchor | Meaning |
|--------|---------|
| `^` | beginning of text (or line with `(?m)`) |
| `$` | end of text (or line with `(?m)`) |
| `\A` | beginning of text (always) |
| `\z` | end of text (always) |
| `\b` | word boundary |
| `\B` | not a word boundary |

## 9. Unicode property classes

The set is the Unicode 13.0+ general categories and scripts:

| Class | Examples |
|-------|----------|
| General categories | `\p{L}`, `\p{Ll}`, `\p{Lu}`, `\p{N}`, `\p{Nd}`, `\p{P}`, `\p{S}`, `\p{Z}`, `\p{C}`, `\p{M}` |
| Scripts | `\p{Latin}`, `\p{Cyrillic}`, `\p{Greek}`, `\p{Han}`, `\p{Arabic}`, `\p{Hiragana}`, `\p{Katakana}` |

`\PX` is the negation of `\pX`. The full list is in
`regexp/syntax/perl_groups.go` (POSIX classes) and
`regexp/syntax/unicode_groups.go` (Unicode categories).

## 10. Match-time guarantees

| Property | Guarantee |
|----------|-----------|
| Time complexity | `O(input × pattern)`, regardless of pattern shape |
| Space complexity | `O(pattern)` for match state |
| Backtracking | None (NFA simulation) |
| ReDoS | Impossible — there is no input that produces super-linear time |
| UTF-8 handling | Patterns and inputs are UTF-8; `.` matches one rune |
| Determinism | Same `*Regexp` + same input always returns the same match |

## 11. Concurrency

| Method | Concurrent calls on same `*Regexp` |
|--------|-------------------------------------|
| `Match*`, `Find*`, `ReplaceAll*`, `Split` | Safe |
| `LiteralPrefix`, `NumSubexp`, `SubexpNames`, `SubexpIndex`, `String` | Safe |
| `Longest` | Not safe to call concurrently with matches |
| `Copy` | Deprecated; do not use |

## 12. Sentinel errors

| Error | Source | Meaning |
|-------|--------|---------|
| `*regexp.Error` (`syntax.Error`) | `Compile` | Pattern syntax invalid |
| `regexp/syntax.Error{Code: ErrInvalidEscape}` | `Compile` | Bad `\` escape |
| `regexp/syntax.Error{Code: ErrInvalidCharClass}` | `Compile` | Bad character class |
| `regexp/syntax.Error{Code: ErrInvalidPerlOp}` | `Compile` | Used unsupported Perl feature (lookaround, backref) |
| `regexp/syntax.Error{Code: ErrInvalidRepeatOp}` | `Compile` | Bad quantifier (`x{,}`, `x{5,2}`) |
| `regexp/syntax.Error{Code: ErrInvalidRepeatSize}` | `Compile` | Repeat counts too large |

The `Error.Code` is comparable; the `Error.Expr` field is the
substring that triggered the error.

## 13. `regexp/syntax` — pattern AST

| Type | Purpose |
|------|---------|
| `Regexp` | Parsed expression node (the *AST* form, not the compiled `*regexp.Regexp`) |
| `Op` (uint8) | Operator type (`OpLiteral`, `OpCharClass`, `OpStar`, ...) |
| `Prog` | Compiled NFA program |
| `Inst` | One instruction in the program |
| `Flags` (uint16) | Parser flags |

| Function | Purpose |
|----------|---------|
| `Parse(s, flags)` | Parse to AST |
| `(*Regexp).String()` | Canonical string form |
| `(*Regexp).Simplify()` | AST normalization |
| `Compile(*Regexp)` | AST to `Prog` |
| `IsWordChar(r)` | Whether `r` is in `\w` |

| Parser flag | Meaning |
|-------------|---------|
| `FoldCase` | `(?i)` |
| `Literal` | Pattern is a literal string |
| `ClassNL` | Allow class to match newline |
| `DotNL` | `(?s)` |
| `OneLine` | `^` and `$` are absolute (not affected by `(?m)`) |
| `NonGreedy` | Default to non-greedy |
| `PerlX` | Allow Perl extensions |
| `UnicodeGroups` | Allow `\p{Name}` |
| `WasDollar` | Internal — `$` was at end of pattern |
| `Simple` | Pattern is "simple" (compiled differently) |
| `MatchNL` | Shorthand for `ClassNL | DotNL` |
| `Perl` | `ClassNL | OneLine | PerlX | UnicodeGroups` |
| `POSIX` | `0` (no extensions) |

`regexp.Compile` uses `Perl`. `regexp.CompilePOSIX` uses `POSIX`.

## 14. POSIX vs default differences

| Aspect | Default (`Compile`) | POSIX (`CompilePOSIX`) |
|--------|---------------------|--------------------------|
| Match selection | Leftmost-first | Leftmost-longest |
| Allowed syntax | All Perl extensions | POSIX ERE only |
| `\d`, `\w`, `\s` | Allowed | Rejected |
| `(?i)`, `(?m)`, `(?s)` | Allowed | Rejected |
| `(?P<name>...)` | Allowed | Rejected |
| `(?:...)` | Allowed | Rejected |
| Backreferences | Rejected | Rejected |
| Lookaround | Rejected | Rejected |

## 15. Empty-match semantics

| Situation | Behavior |
|-----------|----------|
| `Find*All` with a pattern that can match empty | Each empty match advances the cursor by 1 to avoid infinite loop |
| `Split` with empty pattern | Splits between every UTF-8 rune |
| `ReplaceAll*` of empty matches | Replaces each, including the synthesized empty matches |

## 16. Allocation profile of common methods

| Method | Allocations |
|--------|-------------|
| `MatchString(s)` | 0 (in fast path) |
| `Match(b)` | 0 (in fast path) |
| `MatchReader(r)` | 0 (depends on reader) |
| `FindString(s)` | 0-1 (a sub-string is a sub-slice on the same backing array) |
| `Find(b)` | 0 (returns a sub-slice) |
| `FindStringIndex(s)` | 1 (the `[]int{start,end}`) |
| `FindIndex(b)` | 1 |
| `FindStringSubmatch(s)` | 1 + N (N = NumSubexp) |
| `FindSubmatch(b)` | 1 + N |
| `FindAllString(s, -1)` | 1 + matches |
| `FindAllStringSubmatchIndex(s, -1)` | 1 + matches |
| `ReplaceAllString(s, repl)` | 1-2 (one for the result, one if `repl` has refs) |

The package internally maintains a `sync.Pool` of match-state
buffers, so the per-call state is amortized to zero across many
calls.

## 17. `Regexp` cost in pattern complexity

The compile cost is roughly `O(pattern_length²)` worst case — bounded
because the package limits pattern size to `syntax.ErrInternalError`
levels well before practical patterns hit pathological cost.

The match-time program size grows linearly with pattern length, with
small constants. A typical pattern compiles to 10-50 instructions; a
large alternation can produce thousands.

## 18. Cross-references in this leaf

- For prose: [junior.md](junior.md), [middle.md](middle.md),
  [senior.md](senior.md), [professional.md](professional.md).
- For drills: [find-bug.md](find-bug.md), [tasks.md](tasks.md).
- For tuning: [optimize.md](optimize.md).
- Adjacent leaves: [`../01-io-and-file-handling/`](../01-io-and-file-handling/junior.md),
  `../02-strings-and-bytes/`,
  `../14-unicode/`.
