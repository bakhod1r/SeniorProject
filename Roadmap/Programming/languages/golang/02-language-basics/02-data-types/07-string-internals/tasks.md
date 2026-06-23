# String Internals — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. You'll need Go 1.20 or newer (for `unsafe.String` / `unsafe.StringData`).

---

## Task 1: Print the string header

Use `unsafe` to extract and display the data pointer and length of a string.

**Acceptance criteria**
- [ ] Write a function `dumpHeader(s string)` that prints `data=%p len=%d`.
- [ ] Call it for `"hello"`, `""`, and a string returned by `strconv.Itoa(42)`.
- [ ] Verify the empty string has length 0 (its data pointer may be nil or some sentinel).
- [ ] Verify `unsafe.Sizeof(s)` is `16` on a 64-bit machine.

Hint: `unsafe.StringData(s)` returns `*byte`. Use `fmt.Printf("%p", unsafe.Pointer(p))` to print the address.

---

## Task 2: Confirm literal interning

Show that two occurrences of the same string literal share a backing array, while string-built-at-runtime do not.

**Acceptance criteria**
- [ ] Create `a := "hello"` and `b := "hello"` in the same package.
- [ ] Print `unsafe.StringData(a) == unsafe.StringData(b)` — expect `true`.
- [ ] Create `c := strings.Clone("hello")` and `d := strings.Clone("hello")`.
- [ ] Print `unsafe.StringData(c) == unsafe.StringData(d)` — expect `false`.
- [ ] Print all four data pointers and observe that the first two are equal and the second two differ from both.
- [ ] Add a third file that also contains the literal `"hello"`; verify its data pointer matches `a`/`b`.

---

## Task 3: Measure conversion allocations

Use Go's benchmark framework to count allocations for the common conversion patterns.

**Acceptance criteria**
- [ ] Write benchmarks for the following functions:
  - `func direct(b []byte) int { return len(string(b)) }`
  - `func storeFirst(b []byte) int { s := string(b); return len(s) }`
  - `func mapKey(m map[string]int, b []byte) int { return m[string(b)] }`
  - `func mapKeyVar(m map[string]int, b []byte) int { k := string(b); return m[k] }`
- [ ] Run with `go test -bench=. -benchmem`.
- [ ] Confirm `direct` and `mapKey` report `0 allocs/op`.
- [ ] Confirm `storeFirst` and `mapKeyVar` report `1 allocs/op`.
- [ ] Write a short comment in your benchmark file explaining why the difference exists.

---

## Task 4: Reproduce the slice-pins-array problem

Demonstrate that a tiny substring keeps a large parent string in memory.

**Acceptance criteria**
- [ ] Allocate a 10 MB string (e.g. via `strings.Repeat("x", 10*1024*1024)`).
- [ ] Take a 5-byte slice of it: `small := big[100:105]`.
- [ ] Drop the reference to `big` (e.g. set it to `""` and run `runtime.GC()`).
- [ ] Use `runtime.ReadMemStats` to print `HeapAlloc` before and after.
- [ ] Observe that ~10 MB is still resident.
- [ ] Replace `small := big[100:105]` with `small := strings.Clone(big[100:105])` and repeat.
- [ ] Observe that `HeapAlloc` drops by ~10 MB after `GC()`.

Document the difference in a comment with the actual numbers you measured.

---

## Task 5: Build a string using all four methods

Concatenate 1000 small strings using four different approaches and measure their costs.

**Acceptance criteria**
- [ ] Method A: `s := ""; for _, p := range parts { s += p }`.
- [ ] Method B: `strings.Join(parts, "")`.
- [ ] Method C: `var b strings.Builder; for _, p := range parts { b.WriteString(p) }; b.String()`.
- [ ] Method D: same as C but call `b.Grow(totalLen)` first.
- [ ] Benchmark all four with `-benchmem`.
- [ ] Tabulate: ns/op, B/op, allocs/op.
- [ ] Confirm Method A is dramatically worse (O(N²) bytes copied, N allocations).
- [ ] Confirm Methods B and D are tied for fastest.
- [ ] Explain in a comment why Method C is slower than D.

---

## Task 6: Hex-dump a multibyte UTF-8 string

Inspect the byte-level encoding of a string containing non-ASCII characters.

**Acceptance criteria**
- [ ] Pick a string with mixed ASCII, 2-byte (Latin), 3-byte (Cyrillic or CJK), and 4-byte (emoji) characters. Example: `"Aäя漢🎉"`.
- [ ] Print `len(s)` and `utf8.RuneCountInString(s)`.
- [ ] For each byte index, print the byte in hex.
- [ ] For each rune index from `range s`, print the byte offset, the rune in `%c` form, and its `U+%04X` code point.
- [ ] Verify that `len(s)` equals the sum of `utf8.RuneLen(r)` across all runes.

---

## Task 7: Use `unsafe.String` safely and measure

Build a string from a byte buffer using `unsafe.String` and compare to the safe `string(b)` conversion.

**Acceptance criteria**
- [ ] Write `func zeroCopy(b []byte) string { return unsafe.String(&b[0], len(b)) }`.
- [ ] Write `func copyConvert(b []byte) string { return string(b) }`.
- [ ] Benchmark both with `-benchmem`. Use input sizes 16, 1024, 1<<20 bytes.
- [ ] Confirm `zeroCopy` reports `0 allocs/op` at all sizes.
- [ ] Confirm `copyConvert` reports `1 allocs/op` and `B/op` proportional to input size.
- [ ] Document the safety contract in a comment: under what conditions `zeroCopy` is safe to call.
- [ ] Demonstrate a buggy use: pass a slice, hold the string, then mutate the slice; observe the string change.

---

## Task 8: Reproduce the `string(int)` pitfall

Show, and then fix, the classic mistake.

**Acceptance criteria**
- [ ] Run `n := 65; fmt.Println(string(n))` and observe `"A"`.
- [ ] Run `go vet ./...` and observe the warning (Go 1.15+).
- [ ] Replace with `strconv.Itoa(n)` and verify the output is `"65"`.
- [ ] Also test with `n := 0x1F600` and observe `"😀"` vs `"128512"`.
- [ ] Write a brief paragraph explaining when `string(rune)` is the correct call (hint: when you really do mean "encode a code point").

---

## Task 9: Validate the `staticuint64s` fast path

Confirm that `string([]byte{x})` does not allocate for any byte value.

**Acceptance criteria**
- [ ] Write a benchmark that loops `for i := 0; i < b.N; i++ { _ = string([]byte{42}) }`.
- [ ] Run with `-benchmem` and confirm `0 allocs/op`.
- [ ] Write another benchmark `_ = string([]byte{42, 43})` (2 bytes).
- [ ] Confirm this one allocates (1 alloc per iteration).
- [ ] Use `go build -gcflags='-m'` and look for the escape analysis output around the call site.
- [ ] Document the threshold in a comment (`n == 1` triggers the cache).

---

## Task 10: Inspect literal storage with `go tool nm`

Locate string literals in the compiled binary.

**Acceptance criteria**
- [ ] Write a tiny program with several distinct literals and one literal that appears twice.
- [ ] Build it: `go build -o myprog .`.
- [ ] Run `go tool nm -size myprog | grep go:string | head -20`.
- [ ] Observe the `go:string."hello"` style symbols (or modern equivalent).
- [ ] Verify that the literal appearing twice has only **one** symbol — i.e. dedup happened.
- [ ] Try with `-ldflags="-s"` and observe symbols are gone but literals still take space in the binary.
- [ ] Measure binary size before/after stripping with `ls -l`.

---

## Task 11: Build a map-key-from-bytes benchmark

Measure the `m[string(b)]` optimisation in practice.

**Acceptance criteria**
- [ ] Build a `map[string]int` with 1000 entries of 16-byte keys.
- [ ] Create a `[]byte` lookup key matching one of the entries.
- [ ] Benchmark `m[string(b)]` (direct conversion).
- [ ] Benchmark `k := string(b); m[k]` (assigned first).
- [ ] Confirm the second is ~one allocation slower and noticeably higher ns/op.
- [ ] Use `go tool objdump -s '<your-func>' myprog` to find which `mapaccess` variant is called. Confirm `mapaccess1_faststr` for the direct form.

---

## Task 12: Implement `strings.Builder` from scratch

Write a minimal Builder that mirrors the standard library's behaviour.

**Acceptance criteria**
- [ ] Define `type MyBuilder struct { buf []byte }`.
- [ ] Implement `WriteString(s string)` that appends to `buf`.
- [ ] Implement `Grow(n int)` that ensures capacity.
- [ ] Implement `String()` that returns a string with no copy, using `unsafe.String(&b.buf[0], len(b.buf))`.
- [ ] Write tests confirming behaviour.
- [ ] Benchmark against `strings.Builder` — your version should be within 10 % of stdlib performance.
- [ ] Optionally: add a `noescape` field of type `[0]func()` and document why `strings.Builder` does this (prevents copying).

---

## Wrap-up

After completing these tasks you have:

- Manipulated string headers directly with `unsafe`.
- Confirmed compile-time literal interning.
- Measured the allocation cost of every common conversion pattern.
- Demonstrated and fixed the slice-pins-array memory leak.
- Built a custom Builder using `unsafe.String`.
- Used `go tool nm` and `go tool objdump` to inspect runtime behaviour.

These are the foundational skills for diagnosing string-related performance problems in real Go services. The patterns you've measured here will repeat — `+=` in a loop, lost map-key optimisation, conversions in hot paths — and you now have the toolkit to spot them quickly.
