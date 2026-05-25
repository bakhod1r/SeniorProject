# String Internals — Interview Questions

A set of interview-style questions on Go string internals, with concise but complete answers. Most appear in real interviews for mid- to senior-level Go positions.

---

## Q1. How is a Go string represented in memory?

A two-word header: a pointer to the bytes and an `int` length. On 64-bit platforms that is 16 bytes total. The runtime defines it as `stringStruct{str unsafe.Pointer, len int}` in `runtime/string.go`. The bytes themselves live elsewhere — in RODATA for literals, on the heap for runtime-built strings.

---

## Q2. Why does `len(s)` run in O(1)?

Because the length is stored in the header. `len(s)` reads the second word and returns it. No iteration, no decoding, no byte access. This is true even for strings containing multi-byte UTF-8 characters; the stored length is the byte count, not the rune count.

---

## Q3. What does `s[i]` return?

A `byte` (alias for `uint8`), the byte at position `i`. It does **not** return a rune. If `s` contains multi-byte characters, `s[i]` may be a middle byte of a code point — interpreted on its own it is meaningless.

---

## Q4. Why is `&s[i]` illegal?

Because strings are immutable and the runtime relies on this to put literals in read-only memory and to share backing arrays between slices. If you could take the address of a string byte, you could write through it and break those invariants.

---

## Q5. How does `range` over a string work?

The compiler emits a UTF-8 decoder loop. Each iteration calls (an inlined version of) `utf8.DecodeRuneInString`, yielding `(byteOffset, rune)`. The byte offset advances by 1–4 bytes per iteration depending on the rune's encoded length. Invalid UTF-8 yields `0xFFFD` with the offset advancing by 1.

---

## Q6. Where do string literals live?

In the binary's RODATA (read-only data) segment. The linker deduplicates identical literals across the entire program, so two occurrences of `"hello"` in source code share the same bytes at runtime. You can verify with `go tool nm` looking for `go:string.*` symbols.

---

## Q7. Why does `string(b)` allocate when `b` is `[]byte`?

Because the resulting string must be independent of `b`. Mutating `b` afterwards must not change the string (immutability). So the runtime allocates a new backing array, copies the bytes, and returns a string header pointing at the copy.

---

## Q8. When does `string(b)` *not* allocate?

The compiler recognises specific patterns and rewrites them to use `slicebytetostringtmp`, which builds an aliasing header without copying:

- `m[string(b)]` — map indexing.
- `string(b) == "lit"` — equality with a string.
- `for i, c := range string(b)` — range over the conversion.
- `len(string(b))` — folds to `len(b)`.
- `switch string(b)` — switch selector.

Assigning the result to a variable first (`s := string(b)`) defeats the optimisation.

---

## Q9. What is `unsafe.String` and when was it added?

Added in Go 1.20. `unsafe.String(ptr *byte, n IntegerType) string` constructs a string header `{ptr, n}` without copying. The caller must guarantee the bytes are alive and not modified for as long as the string is reachable. It replaces the older pattern of constructing a `reflect.StringHeader` and casting.

---

## Q10. What is `unsafe.StringData`?

`unsafe.StringData(s) *byte` returns the data pointer of `s`. Combined with `unsafe.Slice`, you can create a `[]byte` aliasing the string's bytes — but you must not write to them (the bytes may be in RODATA, segfault on write, or shared with other holders of the string).

---

## Q11. Why is `reflect.StringHeader` deprecated?

Three reasons: its `Data` field is a `uintptr`, which loses GC tracking (the bytes can be reclaimed while you hold a header to them); the layout could change in future Go versions; and `unsafe.String`/`unsafe.StringData` provide the same functionality with proper pointer semantics. Existing code still works but new code should use the `unsafe` functions.

---

## Q12. What happens when you concatenate two strings with `+`?

The compiler emits a call to `runtime.concatstring2`, which allocates a new byte array of total length, copies both operands in, and returns a string header pointing at the new array. A single `+` chain (`a + b + c`) compiles to one `concatstring3` call — one allocation total, not one per operator.

---

## Q13. Why is concatenation in a loop O(N²)?

Each iteration produces a new string, so on iteration `k` you allocate and copy `k×average_size` bytes. Over N iterations that's O(N²) bytes copied and N separate allocations. Use `strings.Builder` with `Grow` or `strings.Join` for O(N) behaviour.

---

## Q14. How does `strings.Builder` avoid the copy in `String()`?

The Builder maintains an internal `[]byte` that grows via `append`. When `String()` is called, it returns a string built with `unsafe.String(&buf[0], len(buf))` — pointing directly at the byte array, no copy. The Builder enforces a no-further-mutation contract: subsequent writes will allocate a new buffer so the returned string remains valid.

---

## Q15. What's wrong with `string(65)`?

It evaluates to `"A"`, the UTF-8 encoding of the Unicode code point with value 65. People expect `"65"` (decimal). `go vet` warns since Go 1.15. To convert a number to its decimal string, use `strconv.Itoa(65)` or `fmt.Sprintf("%d", 65)`.

---

## Q16. Why is `string([]byte{0x41}) == "A"` allocation-free?

The runtime's `slicebytetostring` has a fast path for `n == 1`: it returns a string whose data pointer references `runtime.staticuint64s[0x41]`, a pre-built table of 256 single-byte strings. No allocation. Added in Go 1.13.

---

## Q17. What is the `m[string(b)]` fast path?

When the key of a `map[string]V` is converted from a `[]byte` directly in the index expression, the compiler emits `runtime.mapaccess1_faststr` (or its assign/delete equivalents) and feeds it an aliasing string built without copying `b`. Zero allocation for the lookup. Lose the optimisation by storing `string(b)` into a variable first.

---

## Q18. What happens when you slice a string?

`s[a:b]` produces a new header: `Data = s.Data + a`, `Len = b - a`. No bytes are copied. The new substring shares the backing array with `s`. This is why slicing is essentially free, but also why a small substring can pin a large parent array in memory.

---

## Q19. How do you release the backing array of a substring?

Use `strings.Clone(s[a:b])` (Go 1.18+). It allocates a fresh backing array exactly sized for the slice and returns a new string pointing at it. The original (potentially large) parent string becomes eligible for GC.

---

## Q20. What is the zero value of `string`?

The empty string `""`. There is no "nil string" in Go; `string` is a value type with no nullable form. `var s string` produces a header with a nil data pointer and zero length, which compares equal to `""`.

---

## Q21. How are strings compared for equality?

`a == b` first checks `len(a) == len(b)` (cheap, just two word loads). If equal, it calls `runtime.memequal` over the bytes — an assembly routine using SIMD (SSE2/AVX2 on amd64, NEON on arm64). For short strings this is one or two instructions; for long strings it is memory-bandwidth-bound.

---

## Q22. Why does `range` give byte index but `for i := 0; i < len(s); i++` also gives byte index?

Both use byte offsets because that is the only natural index into a UTF-8 string. The runtime doesn't compute character positions because doing so requires walking the bytes (O(n)). If you need rune positions, use `[]rune(s)` (allocates) or maintain a separate index.

---

## Q23. How much memory does a 1 KB string cost?

16 bytes for the header (on 64-bit) plus 1024 bytes for the data, plus allocator overhead — typically rounded up to the next size class. For 1024 bytes, the allocator likely returns a 1024-byte slot, so total cost is ~1040 bytes. For very short strings, the header alone (16 bytes) is larger than the data.

---

## Q24. Are strings safe to share between goroutines?

Yes. Strings are immutable, so concurrent reads are race-free by definition. There is no need for synchronisation when multiple goroutines read the same string. The only caveat is when you've used `unsafe.String` and the underlying bytes are concurrently modified — then the race detector applies and you can corrupt observers.

---

## Q25. Why is `string(rune)` allocation-free for ASCII?

Both `string(rune)` and `string(byte)` go through `runtime.intstring`, which emits a 4-byte buffer on the caller's stack (when escape analysis allows). For ASCII values the result is one byte; the buffer is reused. The string header points into the stack buffer. If the result doesn't escape, no heap allocation occurs.

---

## Q26. How does `strings.Join` differ from a Builder loop?

`strings.Join` precomputes the total length by summing all part lengths, allocates once with exactly the right capacity, and copies all parts in. A `Builder` loop without `Grow` will reallocate (and copy everything so far) as the buffer doubles, leading to log₂(N) allocations and 2N bytes copied. `Join` is one allocation and N bytes copied — strictly better when you have a flat slice.

---

## Q27. What is the `tmpBuf` optimisation in `concatstrings`?

A 32-byte buffer the compiler allocates on the caller's stack when escape analysis proves the result of a concatenation doesn't outlive the caller. `concatstrings` writes into this buffer when the total length fits, avoiding `mallocgc`. Defined as `tmpStringBufSize = 32` in `runtime/string.go`.

---

## Q28. What's the difference between `bytes.Equal(a, b)` and `string(a) == string(b)`?

Behaviourally identical. Performance: `bytes.Equal` is one assembly call (`bytealg.Equal`); `string(a) == string(b)` involves two conversions that the compiler may or may not elide depending on context. If both sides are byte slices, prefer `bytes.Equal` to make intent explicit and avoid relying on optimiser behaviour.

---

## Q29. How does `strings.Contains` find a substring?

Through `bytealg.IndexString`. For very short needles (1–2 bytes), it uses SIMD (`PCMPEQB` on amd64) to check 16 or 32 bytes per instruction. For longer needles, it switches to a Rabin-Karp variant tuned for cache behaviour. Worst-case behaviour is O(n*m) but typical inputs run in near-O(n).

---

## Q30. What does `s := "" + s` do?

Almost nothing. The compiler emits `concatstring2` which sees the empty operand, drops it, and returns `s` unchanged. No allocation. Same for `s + ""` and even `"" + s + ""`.

---

## Q31. Why does adding a `string` to an `interface{}` allocate?

Because the empty interface stores a `(type, data)` pair where `data` is a single word. A string is 16 bytes — too large to fit in one word. The runtime calls `runtime.convTstring`, which allocates a heap copy of the string header (16 bytes) and stores its address in the interface's data word. Result: a small but real allocation per boxing.

---

## Q32. How does `fmt.Sprintf("%s", s)` differ from `s`?

`fmt.Sprintf` runs the format parser, boxes `s` into an `interface{}` (allocates the header copy from Q31), writes through a `[]byte` buffer (potentially pool-borrowed), and converts the buffer to a string at the end. For `"%s", s` specifically the result is byte-equivalent to `s`, but with 2-4 extra allocations. Just use `s`.

---

## Q33. What is `staticuint64s` and how does it help strings?

A 256-entry table of `uint64` values where the low byte at index `i` is `i`. The runtime uses it for two optimisations: (1) `string([]byte{x})` returns a header pointing at `&staticuint64s[x]`, no allocation; (2) `interface{}` boxing of small `uint8`/`uint16` values uses the same table. Both improve common cases (single-character map keys, small integers in `any`).

---

## Q34. Can you mutate a string through cgo?

Technically yes, with `unsafe`, and it is undefined behaviour. The Go documentation explicitly forbids it. C code receiving a Go string (via `C.CString` or `C.GoStringN`) gets a copy, not the original bytes — precisely so the C code can't observe (or worse, modify) the Go memory.

---

## Q35. Why doesn't Go intern runtime strings automatically?

Because it would cost a hash table lookup on every string creation — making every conversion, concatenation, and decode slower for the rare case where the bytes are repeated. Literals are interned at compile time because the linker has perfect global knowledge. Runtime interning is an application-level decision and should be implemented explicitly with a `map[string]string` cache when it pays off.

---

## Q36. How do you reliably measure string allocations in a function?

Use `testing.B.ReportAllocs` in a benchmark:

```go
func BenchmarkX(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = makeKey(...)
    }
}
```

Run with `go test -bench=. -benchmem`. The `allocs/op` column shows allocation count per call. Anything > 0 in a hot path warrants investigation. Pair with `-memprofile` and `pprof` to find the source.

---

## Q37. Is `len([]byte(s))` the same as `len(s)`?

Yes in result, no in cost. The first form converts `s` to a `[]byte` (allocates and copies) then takes its length; the second reads the header. The compiler does *not* optimise `len([]byte(s))` to `len(s)` because the byte slice escapes through the `len` call form. Always prefer `len(s)`.

---

## Q38. What is "lexicographic byte-wise" ordering?

Comparing strings byte-by-byte, treating each byte as an unsigned integer 0-255. So `"a" < "b"` because 0x61 < 0x62. This is not Unicode collation order: `"ä"` (0xC3 0xA4) sorts *after* `"z"` (0x7A) because 0xC3 > 0x7A. For locale-aware sorting, use `golang.org/x/text/collate`.

---

## Q39. How does `strings.EqualFold` work?

It walks both strings rune by rune (using `utf8.DecodeRuneInString`), case-folds each rune via `unicode.SimpleFold`, and compares. Allocation-free; O(n) in time. For ASCII input it has a fast path that avoids the decoder. Use for HTTP header comparison, case-insensitive routing, etc.

---

## Q40. Three things to optimise in this code:

```go
func handle(req []byte) {
    for _, line := range bytes.Split(req, []byte{'\n'}) {
        s := string(line)
        if s == "GET" { handleGet() }
        m[string(line[:8])] = s
    }
}
```

1. `string(line)` then `s == "GET"` — assigning to `s` defeats the no-alloc compare; either inline `if string(line) == "GET"` or keep `s` only after the test.
2. `string(line[:8])` as a map key — already optimised (the conversion is in the index expression), but `s` stored as the value will keep `line` alive; clone with `strings.Clone(s)` if `req` is large.
3. `bytes.Split` allocates a new `[][]byte`. For line scanning, `bufio.Scanner` reuses a buffer and is allocation-free per line.

---

## Q41. What's the difference between `[]byte(s)` and `unsafe.Slice(unsafe.StringData(s), len(s))`?

`[]byte(s)` allocates a new slice and copies the bytes — the result is a separate, mutable buffer.
`unsafe.Slice(unsafe.StringData(s), len(s))` builds a slice header aliasing the string's bytes — no copy, but writing to it is undefined behaviour (the bytes may be RODATA or shared).

Use `unsafe.Slice` only when you have provable, exclusive ownership of `s` and need read-only `[]byte` access in a tight scope.

---

## Q42. Final question — describe end-to-end what happens during `s := string(b)` where `b` is `[]byte` of length 100.

1. Compiler sees `OCONV` from `[]byte` to `string`.
2. Escape analysis checks how `s` is used. If `s` escapes (assigned, returned, passed to interface), generate a normal call. If it doesn't, allocate a `tmpBuf` on the stack (but 100 > 32, so this won't help here).
3. Emit `runtime.slicebytetostring(buf=nil, ptr=&b[0], n=100)`.
4. `slicebytetostring` checks `n == 0` (no), `n == 1` (no), then asks `mallocgc(100, nil, false)` for a 100-byte heap block (no pointers, no scanning needed).
5. `memmove` copies `b`'s bytes into the new block.
6. Build a `stringStruct{str: blockPtr, len: 100}` and reinterpret as `string`.
7. Return.

Result: one heap allocation, one 100-byte memcpy, two-word header on the stack.

---

## Summary

These questions cover the layout (`stringStruct`), the conversion semantics, the optimisations (`m[string(b)]`, `staticuint64s`, `tmpBuf`), the safe and unsafe ways to share bytes (`unsafe.String`, `strings.Clone`), and the patterns to avoid (`string(int)`, `+=` in a loop, `fmt.Sprintf` on hot paths). A solid answer to any single one signals mid-level fluency; answering all 42 cleanly suggests senior-level mastery.
