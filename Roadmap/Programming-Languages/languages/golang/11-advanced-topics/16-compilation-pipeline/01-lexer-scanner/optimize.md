# Lexer / Scanner — Optimize

Scanning touches **every byte of every file** you compile. This file is about
making a tokenizer fast: buffer reuse, allocation avoidance, byte-vs-rune
scanning, benchmarking, and the specific tricks the gc scanner uses. The
lessons apply both to extending tooling and to writing your own lexers.

## 1. Why scanning speed matters (and where it doesn't)

In a full `go build`, the scanner is a *small* fraction of wall time — type
checking and SSA codegen dominate. So the first optimization rule is **don't
micro-optimize a tokenizer that runs once per file in a batch tool**; profile
first.

Scanning speed *does* matter when:

- An editor backend (`gopls`) re-scans on every keystroke across many files.
- A linter runs over a huge monorepo in CI on every commit.
- You wrote a lexer for a hot inner loop (a template engine, a DSL evaluated
  per request).

For those, the techniques below are real wins. For a one-shot CLI, correctness
and clarity beat cleverness.

## 2. The sentinel trick: one comparison per byte

The gc scanner's hottest idea is making the common case — ASCII — cost a
single comparison. From `source.nextch`:

```go
// fast common case: at least one ASCII character
if s.ch = rune(s.buf[s.r]); s.ch < sentinel { // sentinel = utf8.RuneSelf (0x80)
	s.r++
	s.chw = 1
	if s.ch == 0 {
		s.error("invalid NUL character")
		goto redo
	}
	return
}
// slow path: multibyte rune, refill, EOF, BOM, invalid UTF-8 ...
```

The buffer is **sentinel-terminated**: `buf[e] == utf8.RuneSelf`. That single
`if s.ch < sentinel` does double duty:

1. It is true for every ASCII byte (`< 0x80`) — the fast path.
2. It is false at end-of-buffer too (the sentinel is `0x80`), so the same
   branch routes you into refill/EOF handling — **no separate bounds check**.

For Go source, which is overwhelmingly ASCII, almost every character takes the
fast path: one comparison, one increment, return. No `utf8.DecodeRune`, no
allocation, no second branch.

**Takeaway for your own lexer:** terminate your buffer with a sentinel that
fails your fast-path test, so "out of input" and "needs slow handling" collapse
into one branch.

## 3. Byte scanning vs rune scanning

`utf8.DecodeRune` is not free — it reads up to 4 bytes and does several
branches. Decoding *every* byte to a rune would be wasteful because most of
the scanner's decisions only need the raw byte:

- Operators, delimiters, digits, ASCII letters — all `< 0x80`, decided on the
  byte.
- Only inside identifiers/strings, when a byte is `>= 0x80`, do you need a full
  rune (to validate it is a Unicode letter, or to advance correctly).

The gc scanner therefore works on **bytes** in the fast path and only decodes a
rune on the slow path. Its identifier scanner mirrors this:

```go
func (s *scanner) ident() {
	// accelerate common case (7-bit ASCII)
	for isLetter(s.ch) || isDecimal(s.ch) {
		s.nextch()
	}
	// general case: only reached for non-ASCII identifier characters
	if s.ch >= utf8.RuneSelf {
		for s.atIdentChar(false) {
			s.nextch()
		}
	}
	// ...
}
```

The ASCII loop runs with cheap comparisons; the Unicode loop (with the more
expensive `unicode.IsLetter`-style checks) only runs when a non-ASCII byte
actually appears.

**Takeaway:** branch on the raw byte first; only decode a full rune when the
byte is non-ASCII and you truly need the code point.

## 4. Zero-copy segments: avoid allocating literal text

Allocations are the usual enemy in a tokenizer. The gc scanner hands out the
literal text as a **slice into the buffer**, copying to a string only when it
must keep the text:

```go
func (s *source) segment() []byte { return s.buf[s.b : s.r-s.chw] }

// the scanner only stringifies when it retains the token:
func (s *scanner) setLit(kind LitKind, ok bool) {
	s.nlsemi = true
	s.tok = _Literal
	s.lit = string(s.segment()) // allocation happens HERE, only for kept literals
	// ...
}
```

Operators, delimiters, semicolons, and discarded comments **never allocate** —
they have no `lit`. Only identifiers and literals (which the parser needs as
text) become strings.

**Takeaways for your own lexer:**

- Return `[]byte` slices into your buffer for transient inspection; convert to
  `string` only when the token's text must outlive the buffer.
- For tokens with no text payload (punctuation), store nothing.
- If you intern identifiers (common in compilers), look up the `[]byte` in a
  set *before* allocating a string — a `map[string]T` keyed by a `[]byte` via
  `string(b)` in the index expression does not allocate in modern Go.

## 5. Buffer reuse across files

`source.init` keeps an existing buffer if one is present:

```go
func (s *source) init(in io.Reader, errh func(...)) {
	// ...
	if s.buf == nil {
		s.buf = make([]byte, nextSize(0)) // only allocate the first time
	}
	s.buf[0] = sentinel
	// ... reset indices, no new allocation ...
}
```

A scanner reused for many files reuses one byte buffer; only a file larger than
the current buffer triggers a grow (`nextSize` doubles to 1 MB, then grows
linearly). The same applies to tooling: keep one `scanner.Scanner` value and
call `Init` per file rather than allocating a fresh scanner each time.

```go
var s scanner.Scanner
for _, f := range files {
	src, _ := os.ReadFile(f)
	file := fset.AddFile(f, fset.Base(), len(src))
	s.Init(file, src, handler, 0) // reuses s's internal state
	for {
		_, tok, _ := s.Scan()
		if tok == token.EOF { break }
	}
}
```

## 6. Perfect-hash keyword lookup

A naive keyword check does a map lookup or a `switch` per identifier. The gc
scanner uses a **perfect hash** into a fixed 64-entry array, then one string
compare to confirm:

```go
func hash(s []byte) uint {
	return (uint(s[0])<<4 ^ uint(s[1]) + uint(len(s))) & uint(len(keywordMap)-1)
}

var keywordMap [1 << 6]token // 64 slots, sized to a power of two

// in ident():
if tok := keywordMap[hash(lit)]; tok != 0 && tokStrFast(tok) == string(lit) {
	s.tok = tok // keyword
	return
}
s.tok = _Name   // identifier
```

No map, no allocation, no linear scan — a multiply/xor/add, a mask, one array
index, and (only on a hash hit) one string compare. Because the 25 keywords
were chosen to land in distinct slots, there are no collisions to resolve.

**Takeaway:** for a fixed small keyword set, a perfect hash over a power-of-two
array beats a `map[string]Token` and avoids GC pressure entirely.

## 7. Interning identifiers without extra allocations

Compilers see the same identifier thousands of times (`i`, `err`, `ctx`, your
type names). Allocating a fresh string for each occurrence wastes memory and
GC time. The trick — also used elsewhere in the toolchain — is to look the
bytes up in a map keyed by `string`, relying on the Go compiler's special case
that `m[string(b)]` for a `[]byte` `b` **does not allocate** a string just to
do the lookup:

```go
type interner struct{ m map[string]string }

func (in *interner) intern(b []byte) string {
	if s, ok := in.m[string(b)]; ok { // no allocation for this lookup
		return s
	}
	s := string(b) // allocate exactly once, the first time we see it
	in.m[s] = s
	return s
}
```

Now N occurrences of the same identifier share one backing string and cost one
allocation total, not N. The same `m[string(b)]` no-alloc rule applies to any
set membership test on bytes — including, conceptually, the keyword check,
though the gc scanner uses a perfect-hash array there instead of a map.

## 8. A before/after: killing per-token allocations

Suppose a naive tokenizer stringifies every token:

```go
// SLOW: allocates a string for every token, even '(' and '+'
func (t *tok) text() string { return string(t.bytes) }
```

`go test -bench -benchmem` on a 1 MB file might show:

```
BenchmarkScan-8   50  24_000_000 ns/op  120 MB/s  180000 allocs/op
```

180k allocs/op is the smell. Fix it by only materializing text for tokens that
carry it:

```go
// FAST: punctuation/operators have no text; only names/literals stringify
func (t *tok) text() string {
	switch t.kind {
	case kindName, kindLiteral:
		return string(t.bytes)
	default:
		return "" // punctuation: no allocation
	}
}
```

Re-run:

```
BenchmarkScan-8  200   6_000_000 ns/op  480 MB/s   42000 allocs/op
```

Both throughput (4×) and allocations (4×) improve, because punctuation and
operators — the majority of tokens — now allocate nothing. Adding an interner
(previous section) drops the remaining allocs further. The general lesson:
**find the per-token allocation in pprof's alloc profile and remove it.**

## 9. Benchmarking a tokenizer

Measure before and after. A `go/scanner` benchmark:

```go
func BenchmarkScan(b *testing.B) {
	src, _ := os.ReadFile("biginput.go")
	fset := token.NewFileSet()

	b.SetBytes(int64(len(src)))      // report MB/s
	b.ReportAllocs()                  // catch hidden allocations
	b.ResetTimer()

	var s scanner.Scanner
	for i := 0; i < b.N; i++ {
		file := fset.AddFile("x.go", fset.Base(), len(src))
		s.Init(file, src, nil, 0)
		for {
			_, tok, _ := s.Scan()
			if tok == token.EOF {
				break
			}
		}
	}
}
```

Run with allocation and CPU profiling:

```bash
go test -bench=Scan -benchmem
go test -bench=Scan -cpuprofile=cpu.out
go tool pprof -top cpu.out
```

`-benchmem` + `b.ReportAllocs()` is the most important: a tokenizer that
allocates per token is the #1 performance bug. `b.SetBytes(len(src))` turns the
output into MB/s, which is the natural unit for a scanner.

Note: re-`AddFile` per iteration above is to mirror real per-file cost; if you
only want raw scan throughput, scan a pre-added file repeatedly.

## 10. Common tokenizer performance bugs

| Symptom in pprof / benchmem        | Likely cause                                   | Fix                                          |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| allocs/op grows with token count    | `string(...)` per token, even punctuation      | only stringify kept literals/idents          |
| time dominated by `utf8.DecodeRune` | decoding a rune for every byte                 | branch on raw byte; decode only when `>=0x80` |
| `runtime.growslice` hot             | buffer regrowing per file                      | reuse one buffer; size it once               |
| `runtime.mapaccess` in keyword path | `map[string]Token` keyword lookup              | perfect hash over a fixed array              |
| GC time high                        | per-token heap objects                         | flat struct fields, no token nodes           |
| many small `Read` calls             | unbuffered `io.Reader`                          | read the whole file, or buffer the reader    |

## 11. When NOT to optimize

- **Don't** hand-roll UTF-8 decoding to "beat" `unicode/utf8` — it is already
  assembly-optimized and the gc scanner uses it on the slow path.
- **Don't** drop the error handler to save a call; correctness on malformed
  input matters more than a nanosecond.
- **Don't** cache tokens in a slice "for speed" if you only iterate once —
  that adds allocation and memory pressure for no gain. The gc scanner
  deliberately produces tokens on demand with no buffer.

## 12. Optimization checklist

- [ ] Sentinel-terminate the buffer so the fast-path test also detects EOF.
- [ ] Branch on the raw byte first; decode a full rune only for `>= 0x80`.
- [ ] Return `[]byte` slices for transient text; allocate `string` only when
      the text is retained.
- [ ] Punctuation/operator tokens carry no allocated text.
- [ ] Reuse one buffer (and one scanner) across files; size it once.
- [ ] Use a perfect hash (or at least a `[]byte`-keyed lookup) for keywords.
- [ ] Benchmark with `b.SetBytes` (MB/s) and `b.ReportAllocs()` (allocs/op).
- [ ] Profile (`-cpuprofile`) before optimizing; let pprof pick the target.
- [ ] Keep tokens as flat struct fields, not heap nodes; produce on demand.

## 13. Summary

The gc scanner is fast because of a few deliberate choices: a
sentinel-terminated buffer that fuses the ASCII test with the bounds check,
byte-level decisions with rune decoding only when necessary, zero-copy
segments that allocate only for retained literals, buffer/scanner reuse across
files, and a perfect-hash keyword lookup. Apply the same patterns to your own
lexers, but measure first — for batch tooling the scanner is rarely the
bottleneck.

## Further reading

- `source.go` (sentinel buffer, `nextch`, `fill`): https://go.dev/src/cmd/compile/internal/syntax/source.go
- `scanner.go` (ident, keyword hash, `setLit`): https://go.dev/src/cmd/compile/internal/syntax/scanner.go
- `unicode/utf8` docs: https://pkg.go.dev/unicode/utf8
- `testing` benchmark docs (`SetBytes`, `ReportAllocs`): https://pkg.go.dev/testing#B
- `runtime/pprof` / `go tool pprof`: https://pkg.go.dev/runtime/pprof
