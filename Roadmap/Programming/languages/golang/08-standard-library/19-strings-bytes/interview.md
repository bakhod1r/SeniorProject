# 8.19 `strings` and `bytes` — Interview

> **Audience.** Both sides of the table. Candidates use these to drill
> their understanding; interviewers use them to filter for the
> difference between "memorized the package list" and "has shipped
> production text-processing code". Questions are tagged by level.
> Each answer is the strong-response shape.

## Junior

### Q1. What is a Go `string` at the runtime level?

A `string` is a two-word header: a pointer to read-only bytes and a
length. `len(s)` returns that byte length, not a character count.
The bytes themselves live in immutable backing memory; a string
slice is zero-copy because it produces a new header that points into
the same backing data.

### Q2. Why is `s += "x"` inside a loop slow?

Each `+=` allocates a new backing array sized for the result and
copies the old bytes plus the new bytes into it. For a loop of N
appends, that's O(N²) total work and N intermediate allocations.
`strings.Builder` accumulates writes into a growing buffer (amortized
O(1) per write) and returns the final string with one allocation.

### Q3. When do you use `bytes.Buffer` instead of `strings.Builder`?

`bytes.Buffer` is read/write and implements `io.Reader` plus
`io.Writer`. Use it when you need to read what you wrote (a streaming
buffer), when the consumer takes `io.Reader`, or when you need to
keep working with `[]byte` after building. `strings.Builder` is
write-only and produces a `string` for free at the end.

### Q4. What does `strings.Cut("a=b", "=")` return?

`("a", "b", true)`. `Cut` splits on the first occurrence of the
separator and returns three values: the part before, the part after,
and a bool for "was the separator present". If absent, the call
returns `(s, "", false)`. It replaces the older `SplitN(..., 2)`
idiom and avoids the intermediate slice.

### Q5. What's wrong with `for i := 0; i < len(s); i++ { fmt.Println(s[i]) }` on a string with emoji?

It iterates by byte. Multi-byte UTF-8 runes get split across
iterations; you see individual bytes that don't form characters.
Use `for i, r := range s` for rune iteration, where `r` is the
decoded rune and `i` is the byte index of the rune's start.

## Middle

### Q6. Why does `strings.Builder` panic when copied by value?

A `Builder` returns a string that aliases its internal buffer. If
you copied the Builder and continued writing to either copy, the
returned string would also see the writes (or worse: the buffer
would be reallocated and the returned string's pointer would now
dangle behind a stale view). The first call to a method records the
Builder's address; any later call from a different address panics
with "illegal use of non-zero Builder copied by value".

### Q7. When does `[]byte(s)` not allocate?

It always allocates a new backing array unless the compiler can
prove the temporary never escapes. The optimized patterns are
limited: map lookups (`m[string(b)]`), comparisons against literals,
`len(string(b))`, and `for range string(b)`. For everything else,
the conversion copies.

### Q8. What does `strings.NewReplacer` give you over multiple `ReplaceAll` calls?

A single pass over the input, regardless of how many replacement
pairs you have. Each `ReplaceAll` walks the whole string. With
`Replacer`, the constructor builds a trie or hash table once; each
call to `Replace` makes one pass. Construct the `Replacer` at
package scope to amortize construction across calls.

### Q9. When is `strings.Split` the wrong choice?

When you only need the first or last piece, when the input is large
enough that materializing all parts is expensive, or when you'll
process parts one at a time. For "split once" use `Cut`. For
streaming a large file, use `bufio.Scanner`. For "split on multiple
separators", use `strings.FieldsFunc`.

### Q10. What does `bytes.Buffer.Bytes()` return, and how long is it valid?

It returns a slice that points into the buffer's internal storage —
no copy. The slice is valid only until the next mutating call
(`Read`, `Write`, `Reset`, `Grow`, `Truncate`, `Next`). After that,
the buffer may have reallocated or advanced its read offset, and
the slice points at stale or freed memory. Copy with
`append([]byte(nil), b.Bytes()...)` if you need to keep it longer.

### Q11. What's the difference between `strings.Fields("a  b")` and `strings.Split("a  b", " ")`?

`Fields` splits on any run of Unicode whitespace and collapses runs,
returning `["a", "b"]`. `Split(s, " ")` splits on the literal byte
`' '` only, treating consecutive separators as producing empty
pieces: `["a", "", "b"]`. Choose `Fields` for human-typed input;
choose `Split` for machine-generated data with a known separator.

## Senior

### Q12. Walk me through what `strings.Index(s, substr)` actually does.

The fast path is `len(substr) == 1`, which dispatches to
`IndexByte` — assembly using SIMD compare-equal-byte (e.g.,
`PCMPEQB` on amd64) that scans 16 bytes per cycle. For longer
substrings, the implementation uses an internal Rabin-Karp variant
with an inline check for the first byte (still via IndexByte) and
a hash check on each candidate match. On modern CPUs, the
single-byte case is dramatically faster than the general case; this
is why "find a delimiter" is fast and "find a long string" is fast
in the average case but can degrade to O(n×m) on adversarial input.

### Q13. How does `strings.Builder.String()` return a string without copying?

Through `unsafe.String` (or pre-1.20 equivalent: a struct cast):
the Builder's internal `[]byte` is reinterpreted as a string with
the same data pointer and length. The string header now aliases the
slice's backing array. Subsequent writes grow the slice, possibly
reallocating; the returned string is unaffected because the string
header's pointer is unchanged. The `copyCheck` panic prevents the
caller from continuing to write to a copy of the Builder, which
would expose the alias.

### Q14. When would you use `unsafe.String(&b[0], len(b))`?

When you have a `[]byte` you're certain will not be mutated for the
lifetime of the resulting string and you've profiled that the copy
from `string(b)` is a real cost. Common case: parsing where the
input buffer is owned by the parser and the returned strings are
short-lived. Wrong case: returning the string to a caller while the
buffer goes back to a `sync.Pool` — the next pool consumer mutates
the bytes that your caller is reading.

### Q15. Explain `strings.EqualFold` and when it's wrong.

It implements Unicode simple case folding: it walks both strings
rune by rune, folds each rune, and compares. It handles most
real-world cases (German `ß` ↔ `SS`, common diacritics). It does
not handle Turkish dotless `i` (`İ`/`i` vs `I`/`ı`), full case
folding (multi-rune mappings beyond a couple of hard-coded cases),
or locale-sensitive collation. For protocol identifiers and ASCII
data, use it freely. For user-visible comparison or sorting,
reach for `golang.org/x/text/cases` and `collate`.

### Q16. Why is `bytes.IndexByte` faster than a hand-written loop?

It's per-architecture assembly that uses SIMD instructions to
compare 16 (SSE2), 32 (AVX2), or 64 (AVX-512) bytes per cycle. A
Go `for` loop produces one byte per iteration: a load, a compare,
a conditional branch — three instructions for one byte. The asm
version does the same three instructions for sixteen bytes. The
30×–50× speedup matches that ratio.

### Q17. What is the small-buffer optimization in `bytes.Buffer`, and what happened to it?

Historically, `bytes.Buffer` had an inline 64-byte `bootstrap`
array that backed small buffers without a separate allocation. In
recent Go versions, this was removed in favor of the standard
"grow-on-demand" pattern; the rationale is that `sync.Pool` plus
ordinary slice growth performs at least as well in benchmarks and
the special case complicated the code. The first write still
triggers an allocation; you can elide it with
`bytes.NewBuffer(make([]byte, 0, 256))` if you know the size.

## Professional / Staff

### Q18. Design a sanitizer that turns a string into a single-line, printable, length-capped log entry. What's the algorithm and what allocations does it need?

One pass with `for i, r := range s`. Reach for a pooled
`strings.Builder` sized to `min(len(s), maxLen)`. For each rune:
strip control characters, map `\r`/`\n`/`\t` to space, replace
non-printable runes with `?`, copy printable runes through. Stop at
`maxLen` and append `...` if truncated. Allocations: one Builder
from the pool (amortized free), one final string of size ≤ maxLen.
The `Reset` before returning to the pool is required. Builders
whose final capacity exceeds a sensible threshold (e.g., 4 KiB) are
dropped rather than returned, so the pool doesn't fill with large
buffers.

### Q19. You're running a service that processes 100k JSON objects per second. The profile shows 8% of CPU in `runtime.mallocgc` from `[]byte(s)` conversions inside your custom marshaler. Walk me through the fix.

First, confirm the conversions are unnecessary. If the resulting
`[]byte` is read-only (used for hashing, comparison, indexing), the
conversion is wasted. If you control the producer, return `[]byte`
directly. If you receive a `string` from outside, switch to
`unsafe.SliceData(s)` + `unsafe.Slice` for the hot path, with a
documented immutability contract. Re-profile; the alloc count
should drop to ~zero from that site. If the bytes really need to
be mutated, the conversion is mandatory — instead, hoist it out
of the loop and reuse the slice.

### Q20. Your team has six developers and a strings/bytes-heavy codebase. What policies do you set?

Three rules that cover most failures:
1. `Replacer` instances at package scope, never inside a function.
   A simple linter catches violations.
2. No `fmt.Sprintf` in the serialization path. Use `Builder` +
   `Append*` from `strconv` instead. Code review enforces this.
3. Every use of `unsafe.String`/`unsafe.Slice` carries a comment
   stating the immutability invariant and the owner. A `grep` for
   these calls is part of the on-call runbook.
Additionally: bound every external-input string by size at the
ingress (`http.MaxBytesReader`, `io.LimitReader`), validate UTF-8
once at the trust boundary, and prefer `strings.Builder` over
`bytes.Buffer` whenever the result is a string.

### Q21. You profile a hot loop and see 80% of time in `runtime.aeshashbody`. What's happening and what do you do?

You're hashing large strings as map keys (`m[s]` with `len(s) > ~64`).
The hash is O(key length); a million map lookups with 1KB keys is a
gigabyte of hashing per second. Options, in order of effort:

1. Pre-hash to a fixed-size summary (e.g., `sha256.Sum256` and use
   the `[32]byte` as the key). Hash once, lookup many.
2. Intern strings: maintain a `map[string]*string` so equal strings
   share a pointer, and use pointer identity for downstream comparisons.
3. Restructure to avoid the map: a `[]string` plus binary search if
   the set is small and stable.

The right pick depends on whether keys are stable (intern works),
whether you control the producer (move hashing upstream), and
whether you can change the data structure (struct of slices, etc.).

## Bonus

### Q22. What happens if you call `strings.NewReplacer("a", "b", "c")`?

It panics — `NewReplacer` requires an even number of arguments
(old-new pairs). The panic message is "strings.NewReplacer: odd
argument count". This is a constructor-time check; you cannot reach
a runtime `Replace` call with a malformed Replacer.

### Q23. What's wrong with `strings.Replace(s, "", "x", -1)`?

`strings.Replace` and `ReplaceAll` document this case: an empty
`old` matches at the start, between every pair of UTF-8 runes, and
at the end. So replacing `""` with `"x"` in `"ab"` produces
`"xaxbx"`. The behavior is documented but rarely the user's
intent. If you want "insert before every rune", use `strings.Map`
or a `Builder` with `WriteRune`.

### Q24. Why doesn't `strings` package have a `Reverse` function?

Because reverse-by-rune is the only correct version, and writing it
in three lines is clearer than calling a function that hides the
choice between byte-reverse and rune-reverse. The standard idiom:

```go
func reverse(s string) string {
    r := []rune(s)
    for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
        r[i], r[j] = r[j], r[i]
    }
    return string(r)
}
```

For combining characters or grapheme clusters, even this is wrong;
use `golang.org/x/text/unicode/norm` first.
