# String Internals — Find the Bug

A collection of realistic string-internals bugs. For each: the symptom, the (often subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose string-related issues in Go production code.

---

## Bug 1: The map key that wouldn't match

```go
func count(text []byte) map[string]int {
    m := make(map[string]int)
    for _, word := range bytes.Fields(text) {
        k := string(word)
        m[k]++
    }
    fmt.Println(m["the"])
    return m
}
```

**Symptom.** The map shows entries for every word, including `"the"`, but the function `m["the"]` lookup in a separate place sometimes returns 0 even when the word was clearly counted.

**Cause.** It is not, in fact, this snippet. This snippet is correct. The bug is that callers of `count` use the returned map in surprising ways. Look closely: `m["the"]` works because `"the"` is the literal stored in RODATA, and the map keys were `string(word)` copies from byte slices — both compare by bytes, both work. The pitfall everyone *imagines* exists ("the byte slice was reused so the string keys are corrupted") does **not** happen because `string(word)` always copies bytes.

**Fix.** None needed. The trap here is in the reader's intuition, not in the code. Every `string(b)` conversion **copies** unless you've explicitly used `unsafe.String`. The next bug shows what happens when you do.

---

## Bug 2: The `unsafe.String` that pinned the world

```go
type Cache struct {
    items map[string]string
}

func (c *Cache) Store(b []byte) {
    parts := bytes.SplitN(b, []byte{':'}, 2)
    if len(parts) != 2 { return }
    key := unsafe.String(&parts[0][0], len(parts[0]))
    value := unsafe.String(&parts[1][0], len(parts[1]))
    c.items[key] = value
}
```

**Symptom.** Memory usage of the service grows steadily over hours, well past any "working set" estimate. Eventually the process OOMs. The cache itself reports only a few hundred MB of entries. `pprof -inuse_space` shows `runtime.makeslice` at the top of the heap profile.

**Cause.** `unsafe.String` over a slice of a slice: `parts[0]` and `parts[1]` are sub-slices of `b`, which is the original byte buffer. Both `key` and `value` therefore point into `b`. Stored in `c.items`, they keep the **entire** original buffer alive — not just the 20-byte key and the 50-byte value, but the whole network buffer that `b` came from (potentially many KB).

Multiplied by millions of cache entries, the leak is the difference between `bytes_actually_used` and `parent_buffer_size`. For typical traffic, that's 10-100×.

**Fix.** Either copy on store, or don't use `unsafe.String`:

```go
func (c *Cache) Store(b []byte) {
    parts := bytes.SplitN(b, []byte{':'}, 2)
    if len(parts) != 2 { return }
    c.items[string(parts[0])] = string(parts[1])   // each conversion allocates exactly its slice's worth
}
```

If you must use `unsafe.String` for the lookup path, force a copy at the cache boundary:

```go
c.items[strings.Clone(unsafeKey)] = strings.Clone(unsafeValue)
```

`strings.Clone` allocates a fresh backing array exactly sized for the string, severing the link to `b`.

---

## Bug 3: The "fast" concat in a hot loop

```go
func formatRows(rows [][]string) string {
    out := ""
    for _, row := range rows {
        for _, cell := range row {
            out += cell + "\t"
        }
        out += "\n"
    }
    return out
}
```

**Symptom.** Function runs fine on small inputs (1000 rows). On large inputs (1 million rows of 10 cells each), it allocates ~100 GB and takes 30 seconds. The output string is only 200 MB.

**Cause.** Iterated `+=`. Each iteration builds a new string by allocating `len(out) + len(cell) + 1` bytes and copying `out`'s entire current contents plus the new cell. For N iterations, that's O(N²) bytes copied. At 10 million iterations, the constant factor is enormous.

The inner `cell + "\t"` is **one** allocation (single concat expression collapsed). The outer `out += ...` is the killer.

**Fix.** Use `strings.Builder` with pre-sized capacity:

```go
func formatRows(rows [][]string) string {
    total := len(rows) // for newlines
    for _, row := range rows {
        for _, cell := range row { total += len(cell) + 1 }
    }
    var b strings.Builder
    b.Grow(total)
    for _, row := range rows {
        for _, cell := range row {
            b.WriteString(cell)
            b.WriteByte('\t')
        }
        b.WriteByte('\n')
    }
    return b.String()
}
```

On the same input: one allocation, ~200 MB peak, 200 ms wall clock.

---

## Bug 4: The `string(int)` that produced gibberish

```go
func userKey(userID int) string {
    return "user:" + string(userID)
}
```

**Symptom.** Cache keys look like `"user:\x05"` or `"user:A"` instead of `"user:5"` or `"user:65"`. Cache hit rate is essentially zero because every user gets a distinct (and corrupted) key.

**Cause.** `string(userID)` interprets the int as a Unicode code point and produces the UTF-8 encoding. `string(5)` is the byte `0x05` (one byte, unprintable). `string(65)` is `"A"`. `string(0x1F600)` is `"😀"`. Nobody ever wants this when stringifying a user ID.

**Fix.** Use `strconv`:

```go
func userKey(userID int) string {
    return "user:" + strconv.Itoa(userID)
}
```

`go vet` flags this pattern since Go 1.15 — add `go vet ./...` to CI to catch it before review.

---

## Bug 5: The substring that leaked a 100 MB document

```go
type Parser struct {
    headers map[string]string
}

func (p *Parser) Parse(doc string) {
    // doc is a 100 MB HTML response body
    for _, line := range strings.Split(doc, "\n") {
        if i := strings.Index(line, ":"); i > 0 {
            p.headers[line[:i]] = line[i+1:]
        }
    }
}
```

**Symptom.** Parser holds 5 KB of header data. The process holds 100 MB. Heap profile blames `runtime.mallocgc` in the parser call path; the actual bytes are unidentified.

**Cause.** Strings produced by slicing (`line[:i]` and `line[i+1:]`) share the backing array of `doc`. Every header key and value, however short, keeps the entire 100 MB document alive. Once `Parse` returns, the local `doc` and `line` references go out of scope — but the strings in `p.headers` keep the backing array pinned. GC cannot reclaim it.

**Fix.** Clone the strings that will be retained:

```go
p.headers[strings.Clone(line[:i])] = strings.Clone(line[i+1:])
```

Now each header lives in its own 10-100 byte backing array. After `Parse` returns and `doc` is unreferenced, the 100 MB can be freed.

This is the most common form of "GC won't reclaim my memory" bug in Go string code. The diagnostic is: the leaked memory's size matches the *source* string, not the held string.

---

## Bug 6: The map lookup that allocated forever

```go
type Router struct {
    routes map[string]Handler
}

func (r *Router) Dispatch(path []byte) Handler {
    key := string(path)
    if h, ok := r.routes[key]; ok { return h }
    return nil
}
```

**Symptom.** A profiling session shows `runtime.slicebytetostring` as 8 % of CPU. The map has 100 routes; lookups happen 50 000 times per second. The allocation rate is exactly 50 000 strings per second.

**Cause.** Assigning `string(path)` to a variable defeats the `m[string(b)]` compiler optimisation. The compiler can only elide the copy when the conversion is used **directly** as the map key, because then escape analysis can prove the temporary string doesn't outlive the lookup.

Once you store it in `key`, the compiler must assume `key` could escape (it doesn't here, but the analysis is conservative across function boundaries), so a real string must be allocated.

**Fix.** Inline the conversion:

```go
func (r *Router) Dispatch(path []byte) Handler {
    if h, ok := r.routes[string(path)]; ok { return h }
    return nil
}
```

Zero allocations per dispatch. Verify with `go tool objdump`:

```
go tool objdump -s 'router.Dispatch' ./binary | grep mapaccess
# before fix: CALL runtime.mapaccess2(SB)
# after fix:  CALL runtime.mapaccess2_faststr(SB)
```

The `_faststr` suffix confirms the optimisation engaged.

---

## Bug 7: The `[]byte` that mutated a string

```go
func capitalize(s string) string {
    b := unsafe.Slice(unsafe.StringData(s), len(s))
    if len(b) > 0 && b[0] >= 'a' && b[0] <= 'z' {
        b[0] -= 32
    }
    return string(b)
}

func main() {
    capitalize("hello") // SEGFAULT
}
```

**Symptom.** Process crashes with SIGSEGV at the byte write. On some platforms it doesn't crash but mutates the string literal in place, breaking every other holder of the same literal.

**Cause.** `"hello"` is a string literal stored in the `.rodata` section, marked read-only by the OS. Writing to its bytes triggers a page fault. Even on systems where the page is writable (some embedded targets), the linker has deduplicated this literal across the binary, so the write would corrupt every other use of `"hello"` in the program.

`unsafe.Slice(unsafe.StringData(s), len(s))` builds a slice header aliasing the string's bytes; the slice type is mutable but the underlying memory is not. The runtime cannot intercept the write.

**Fix.** Don't mutate string bytes. Allocate a new buffer:

```go
func capitalize(s string) string {
    if len(s) == 0 || s[0] < 'a' || s[0] > 'z' { return s }
    b := []byte(s)
    b[0] -= 32
    return string(b)
}
```

Or use `strings.ToUpper(s[:1]) + s[1:]` if you don't mind two allocations.

The rule: `unsafe.Slice(unsafe.StringData(s), len(s))` is read-only. The compiler and runtime trust you. Don't write through it.

---

## Bug 8: The `range` that skipped characters

```go
func indexLetters(s string) map[byte]int {
    out := make(map[byte]int)
    for i := 0; i < len(s); i++ {
        out[s[i]]++
    }
    return out
}

func main() {
    m := indexLetters("café")
    fmt.Println(m) // map[101:1 99:1 102:1 169:1 195:1]
}
```

**Symptom.** Output contains entries `195` and `169` instead of the expected `é`. Tests pass for ASCII input but fail for any Latin-1+ text.

**Cause.** `for i := 0; i < len(s); i++` iterates over **bytes**, not runes. `s[i]` returns a byte. `é` is encoded as `0xC3 0xA9` in UTF-8, so iterating yields the two bytes 195 and 169 separately. They are not character codes; they are intermediate UTF-8 bytes.

**Fix.** Use `range` to decode runes:

```go
func indexLetters(s string) map[rune]int {
    out := make(map[rune]int)
    for _, r := range s {
        out[r]++
    }
    return out
}
```

Note the return type changes from `map[byte]int` to `map[rune]int`. If the original signature is enforced by an API, the bug isn't fixable without a wider change — the API itself is wrong for non-ASCII input.

---

## Bug 9: The `bytes.Buffer` returned as string

```go
var pool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func format(name string, age int) string {
    buf := pool.Get().(*bytes.Buffer)
    buf.Reset()
    defer pool.Put(buf)
    buf.WriteString("name=")
    buf.WriteString(name)
    buf.WriteString(" age=")
    buf.WriteString(strconv.Itoa(age))
    return unsafe.String(&buf.Bytes()[0], buf.Len())
}
```

**Symptom.** Returned strings appear correct under low load but garble unpredictably under high concurrency. Sometimes `"name=Alice age=30"`, sometimes `"name=Bob age=Alice age=30"`.

**Cause.** The `defer pool.Put(buf)` returns the buffer to the pool **before** the caller is done reading the returned string. Another goroutine takes the buffer, `Reset`s it, and writes new content — corrupting the bytes the first string still references.

`unsafe.String` and `sync.Pool` are a foot-gun combination. The pool assumes the returned object can be reused after `Put`; `unsafe.String` assumes the bytes are immutable. These contradict.

**Fix.** Either don't pool, or copy out before returning:

```go
// Option A: copy out
result := string(buf.Bytes())  // explicit copy
pool.Put(buf)
return result

// Option B: don't pool
var buf bytes.Buffer
// ... write ...
return unsafe.String(&buf.Bytes()[0], buf.Len())  // buf's array is not pooled; safe
```

Option B is simpler but loses the allocation benefit of pooling. Option A keeps the pool but pays for one copy. For most workloads, Option A wins because the copy is fast and the pool eliminates the larger Buffer allocation overhead.

Rule: never combine `unsafe.String` with `sync.Pool` unless you have a custodian pattern where the consumer signals it is done before the buffer returns to the pool.

---

## Bug 10: The empty string that wasn't

```go
func main() {
    var s string
    var b []byte = nil
    s2 := string(b)
    fmt.Println(s == "")            // true
    fmt.Println(s2 == "")           // true
    fmt.Println(s == s2)            // true

    s3 := string([]byte{})
    fmt.Println(s == s3)            // true

    // Now try the inverse:
    b2 := []byte(s)
    fmt.Println(b2 == nil)          // false ?
}
```

**Symptom.** Code checking `if b == nil` to detect "no data" never sees nil, even when the source string was empty. JSON encoding emits `""` for `nil` and `[]` for empty byte slice — but the program always produces `""` (which is what we want, but for the wrong reason).

**Cause.** `[]byte(s)` always returns a **non-nil** slice. Even for `s == ""`, the result is an empty (but non-nil) slice. The conversion calls `runtime.stringtoslicebyte`, which allocates a (zero-length) backing array and returns a header pointing at it.

Conversely, both `nil` `[]byte` and empty `[]byte` convert to the empty string `""`. The conversion is lossy — you cannot recover the nil/non-nil distinction.

**Fix.** If you need to preserve nil-ness across the conversion, check explicitly:

```go
func bytesOrNil(s string) []byte {
    if s == "" { return nil }
    return []byte(s)
}

func stringOrNil(b []byte) *string {
    if b == nil { return nil }
    s := string(b)
    return &s
}
```

For most code, this distinction doesn't matter and you can ignore it. For JSON / protobuf interop where presence is semantically meaningful, encode it in the type system (`*string`, `sql.NullString`).

---

## Bug 11: The Builder that lost its bytes

```go
func build(parts []string) string {
    var b strings.Builder
    for _, p := range parts {
        b.WriteString(p)
    }
    s := b.String()
    b.Reset()
    b.WriteString("scratch")
    return s
}
```

**Symptom.** The returned string `s` is sometimes correct, sometimes corrupted to start with `"scratch"`. Tests pass on one machine, fail on another. Stress tests reveal corruption depending on input size.

**Cause.** `b.String()` returns a string that aliases the Builder's underlying byte buffer via `unsafe.String`. The Builder's documented contract is that further writes after `String()` will **reallocate** the buffer, so the returned string remains valid. **But `Reset` does not reallocate** — it sets the buffer's length back to zero and lets subsequent writes reuse the existing backing array. Those writes corrupt the bytes `s` still references.

Look at `strings.Builder`'s source:

```go
func (b *Builder) Reset() {
    b.addr = nil
    b.buf = nil   // sets the slice to nil
}
```

In recent Go versions (1.10+), `Reset` actually does drop the slice — so subsequent `WriteString` allocates a fresh array, and the bug above is avoided. But the principle is general: if you ever poke at the Builder's bytes via `unsafe`, you can re-create this bug.

**Fix.** Either don't reuse the Builder, or `Reset` it (modern Go), or — the safest — never modify a Builder after calling `String()`. The standard library enforces this with a `noescape` field that prevents copying, but it can't prevent every form of misuse.

```go
func build(parts []string) string {
    var b strings.Builder
    for _, p := range parts { b.WriteString(p) }
    return b.String()
    // do nothing else with b
}
```

---

## Bug 12: The decoded string with the wrong length

```go
func cleanInput(s string) string {
    runes := []rune(s)
    for i, r := range runes {
        if r < 0x20 { runes[i] = ' ' }
    }
    return string(runes)
}

func main() {
    out := cleanInput("hi\x07there")
    fmt.Println(len(out))  // 9 -- but the input was 8?
}
```

**Symptom.** Input length differs from output length even though the operation is "replace one byte with a space". Downstream code that assumes byte-for-byte mapping (offset positions, span tracking) breaks.

**Cause.** `\x07` in UTF-8 is a single byte (0x07, the BEL character). When decoded into a rune slice, it becomes one `rune` (0x00000007). Replaced with space (0x20), still one rune. But when **re-encoded** back to UTF-8, space is also one byte. So in this specific case the lengths should match.

The actual bug is more subtle. Try the same with input containing high-Unicode characters:

```go
out := cleanInput("hi\x07   there")  // input has   (line separator, 3 bytes UTF-8)
fmt.Println(len("hi\x07   there"), len(out))  // 13 -> 13: lucky
```

But replacing ` ` (3 bytes) with `' '` (1 byte) changes the length:

```go
func cleanInput(s string) string {
    runes := []rune(s)
    for i, r := range runes {
        if r == 0x2028 { runes[i] = ' ' }
    }
    return string(runes)
}
out := cleanInput("a b")  // input len 5 (1 + 3 + 1)
fmt.Println(len(out))           // 3
```

**Cause.** Any rune-level transformation changes byte length unless the replacement encodes to the same number of bytes. Downstream code relying on byte offsets into the input string is now wrong.

**Fix.** Either work in bytes throughout (preserves lengths but limits operations to byte-safe ones), or accept the length change and recompute any byte offsets you cared about:

```go
// Option A: byte-level (preserves length, only safe for ASCII control bytes)
b := []byte(s)
for i := range b { if b[i] < 0x20 { b[i] = ' ' } }
return string(b)

// Option B: rune-level (changes length; document this)
// ...as before...
```

The general rule: rune-level edits to a UTF-8 string may change its byte length.

---

## Summary

These twelve bugs cover the most common ways Go string internals trip up real programs:

- Misunderstanding `string(b)` as zero-copy when it actually copies (Bug 1's inverse).
- Pinning large parents through slicing or `unsafe.String` (Bugs 2, 5).
- Concatenation cost in loops (Bug 3).
- `string(int)` interpreting as Unicode (Bug 4).
- Losing compiler optimisations by introducing intermediate variables (Bug 6).
- Mutating immutable bytes via `unsafe.Slice` (Bug 7).
- Byte iteration over multi-byte UTF-8 (Bug 8).
- Pooled buffers escaping through `unsafe.String` (Bug 9).
- Nil vs empty for `[]byte` ↔ string (Bug 10).
- Builder aliasing after Reset (Bug 11).
- Length changes from rune-level edits (Bug 12).

If you can spot the bug class in the first few lines of a snippet, you have working knowledge of string internals. The next file, [optimize.md](optimize.md), is the systematic positive guidance — how to write string code that avoids all twelve.
