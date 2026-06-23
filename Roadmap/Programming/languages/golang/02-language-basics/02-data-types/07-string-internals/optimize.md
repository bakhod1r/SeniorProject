# String Internals — Optimize

## 1. Goal of this file

Reduce string-related allocations, copies, and CPU cost in Go services. The levers, in roughly the order they pay off:

1. Stop concatenating with `+` in loops.
2. Pre-size `strings.Builder` with `Grow`.
3. Preserve compiler-recognised no-alloc patterns (`m[string(b)]`, range over `string(b)`).
4. Avoid `string ⟷ []byte` round-trips that have no purpose.
5. Use `strconv.AppendX` to write into a single buffer.
6. Apply `unsafe.String` at controlled boundaries.
7. Use `strings.Clone` to release pinned backing arrays.
8. Decide when (and when not) to intern at runtime.
9. Watch for boxing into `interface{}` on hot paths.
10. Hit the right map fast paths.

Realistic gain on a typical Go service after sweeping these: 30–60 % reduction in allocations per request, 10–30 % CPU reduction, and a similar drop in GC pressure.

---

## 2. Measurement baseline first

Before optimising, capture a baseline. The output of `go test -bench=. -benchmem` for the function under scrutiny is the minimum:

```bash
go test -bench=BenchmarkX -benchmem -benchtime=2s -count=5 ./pkg/...
```

Record: ns/op, B/op, allocs/op. A 5× change is meaningful; a 1.2× change is noise. Keep the baseline file in version control so the next reviewer can verify the win.

For larger units, capture an allocation profile:

```bash
go test -bench=BenchmarkX -memprofile=mem.out ./pkg/...
go tool pprof -alloc_space mem.out
(pprof) top 20
(pprof) list myFunction
```

The top entries usually contain `runtime.slicebytetostring`, `runtime.stringtoslicebyte`, `runtime.concatstring2`, `runtime.growslice`, or `runtime.mallocgc` called from string operations. Each is a specific optimisation opportunity.

---

## 3. Recipe 1: Eliminate `+` in loops

The single biggest win in most string-heavy code. Three variants in order of generality:

### 3.1 Use `strings.Join` for a flat slice

```go
// Before
result := ""
for _, p := range parts { result += p }

// After
result := strings.Join(parts, "")
```

`Join` precomputes the total length, allocates once, copies all parts. One allocation regardless of `len(parts)`.

For a non-empty separator, `Join` is the cleanest answer:

```go
csv := strings.Join(fields, ",")
```

### 3.2 Use `strings.Builder` with `Grow` for incremental construction

```go
var b strings.Builder
b.Grow(estimateTotal())  // pre-size if you can
for _, p := range parts {
    if condition(p) {
        b.WriteString(p)
        b.WriteByte('\n')
    }
}
return b.String()
```

`Builder.String()` returns the buffer without copying (via `unsafe.String` under the hood). If you call `Grow` with a sufficient capacity, the entire build is one allocation.

### 3.3 Use `[]byte` and `append` for maximum control

```go
buf := make([]byte, 0, estimateTotal())
for _, p := range parts {
    buf = append(buf, p...)
    buf = append(buf, '\n')
}
return string(buf)
```

Functionally identical to Builder but slightly cheaper because there is no extra struct or accessor methods. The final `string(buf)` allocates and copies (one allocation). If you can use `unsafe.String(&buf[0], len(buf))`, you save even that.

Benchmark numbers, 1000 short strings to join, on modern x86:

| Method | ns/op | allocs/op |
|--------|-------|-----------|
| `+= in loop` | 850 000 | 1000 |
| `Builder` no Grow | 25 000 | 9 |
| `Builder` with Grow | 12 000 | 2 |
| `Join` | 11 000 | 1 |
| `[]byte` + `string()` | 11 500 | 1 |
| `[]byte` + `unsafe.String` | 9 000 | 0 |

The `+=` form is **70×** slower and 1000× more allocations than `Join`.

---

## 4. Recipe 2: Replace `fmt.Sprintf` on the hot path

`fmt.Sprintf` is convenient and slow. Hot-path replacements:

### 4.1 Number formatting

```go
// Before
key := fmt.Sprintf("user:%d", id)

// After
key := "user:" + strconv.Itoa(id)
```

`strconv.Itoa` is allocation-free for small numbers (cached) and one allocation for the result. `Sprintf` allocates 3-5 strings to do the same work.

For repeated key building, use a buffer:

```go
buf := make([]byte, 0, 32)
buf = append(buf, "user:"...)
buf = strconv.AppendInt(buf, int64(id), 10)
key := string(buf)  // one alloc
```

### 4.2 String concatenation

```go
// Before
greeting := fmt.Sprintf("hello, %s!", name)

// After
greeting := "hello, " + name + "!"
```

The compiler folds the three-operand concat into a single `concatstring3` call. One allocation.

### 4.3 Mixed types — use `strconv.Append*` into a buffer

```go
buf := make([]byte, 0, 64)
buf = append(buf, "id="...)
buf = strconv.AppendInt(buf, int64(id), 10)
buf = append(buf, " name="...)
buf = strconv.AppendQuote(buf, name)
buf = append(buf, " active="...)
buf = strconv.AppendBool(buf, active)
log := string(buf)
```

Equivalent to `fmt.Sprintf("id=%d name=%q active=%t", id, name, active)` but one allocation instead of several, and no format string parsing at runtime.

The `Append*` family in `strconv` exists exactly for this pattern. `log/slog` uses it internally.

---

## 5. Recipe 3: Preserve `m[string(b)]` no-alloc map lookups

```go
// Optimised (compiler emits mapaccess1_faststr, no allocation)
if v, ok := m[string(b)]; ok { ... }

// De-optimised (the key is materialised)
k := string(b)
if v, ok := m[k]; ok { ... }
```

The compiler can only elide the copy when the conversion is **directly** in the index expression. Storing it in a variable defeats escape analysis. This works for:

- Index: `m[string(b)]`
- Assign: `m[string(b)] = v`
- Comma-ok: `v, ok := m[string(b)]`
- Delete: `delete(m, string(b))`
- Comparison: `string(b) == "lit"`
- Range: `for i, c := range string(b)`
- Length: `len(string(b))` (folds to `len(b)`)
- Switch: `switch string(b) { case "a": ... }`

Audit your hot paths for the de-optimised forms. Each is one allocation per call.

Verify with `go tool objdump`:

```bash
go tool objdump -s 'YourFunc' ./binary | grep -E 'mapaccess|slicebytetostring'
```

Want: `mapaccess1_faststr` or `mapaccess2_faststr`. Don't want: plain `mapaccess1`, `mapaccess2`, or any `slicebytetostring` call near the map operation.

---

## 6. Recipe 4: Avoid round-trip conversions

A common mistake born of habit:

```go
data := []byte(req.URL.Path)        // convert to byte slice
header := req.Header.Get("Auth")
sig := string(data) + ":" + header  // convert back to string
```

The `[]byte(...)` + `string(...)` round-trip allocates twice for no purpose. Just use the original string:

```go
sig := req.URL.Path + ":" + header
```

Audit any function that takes `string` and returns `string` for unnecessary `[]byte` intermediates. The most common pattern looks like:

```go
func normalise(s string) string {
    b := []byte(s)         // alloc 1
    for i := range b { b[i] = byte(unicode.ToLower(rune(b[i]))) }  // wrong for non-ASCII anyway
    return string(b)        // alloc 2
}
```

Use `strings.ToLower` (which uses the Unicode-aware path and allocates exactly once when needed, zero times when not):

```go
return strings.ToLower(s)
```

---

## 7. Recipe 5: `strconv.AppendX` into a single buffer

For any composite-key construction:

```go
// Identity formatter common in caches, indexes, log fields
func key(userID, orgID int, action string) string {
    buf := make([]byte, 0, 64)
    buf = append(buf, "u:"...)
    buf = strconv.AppendInt(buf, int64(userID), 10)
    buf = append(buf, " o:"...)
    buf = strconv.AppendInt(buf, int64(orgID), 10)
    buf = append(buf, " a:"...)
    buf = append(buf, action...)
    return string(buf)
}
```

One allocation for `buf`, one for the final string conversion. Total: 2. Replace with `fmt.Sprintf` and you get 5-7.

If `key`'s callers are all in one package and you can prove the result is read-only, `unsafe.String(&buf[0], len(buf))` brings it down to one allocation.

---

## 8. Recipe 6: `unsafe.String` at boundaries you control

`unsafe.String` is the zero-copy escape hatch. Used incorrectly it leaks memory or corrupts strings. Used correctly it removes the last copy from hot paths.

### 8.1 Safe usage patterns

**Pattern A — finalise a freshly built buffer:**

```go
func buildKey(prefix string, n int) string {
    buf := make([]byte, 0, len(prefix)+20)
    buf = append(buf, prefix...)
    buf = strconv.AppendInt(buf, int64(n), 10)
    return unsafe.String(&buf[0], len(buf))
}
```

`buf` is local, escapes only via the return, never touched again. Safe.

**Pattern B — read-only access to a `[]byte` in a short scope:**

```go
func equalsLiteral(b []byte, lit string) bool {
    return unsafe.String(&b[0], len(b)) == lit
}
```

The string exists only for the comparison. Caller hasn't modified `b`. Safe.

(The compiler already does this for `string(b) == lit`; the manual form is for when the comparison is hidden inside a helper.)

### 8.2 Unsafe usage patterns

**Anti-pattern: pooled buffer + `unsafe.String`:**

The buffer returns to the pool, gets reused by another goroutine, the string observes corrupted bytes. Always copy out of pooled buffers before returning.

**Anti-pattern: sub-slice + `unsafe.String` + long retention:**

```go
key := unsafe.String(&request[10:18][0], 8)
cache[key] = ...   // pins request forever
```

Either don't use `unsafe.String` here, or follow with `strings.Clone(key)` before storing.

### 8.3 Decision rule

Use `unsafe.String` when **all** of these are true:

- You own the bytes (no shared writes possible).
- The string's lifetime is provably bounded by the bytes' lifetime.
- You are on a hot path where the saved copy is measured.

If any condition is uncertain, use plain `string(b)`. The cost of one copy is much less than the cost of an intermittent corruption bug.

---

## 9. Recipe 7: `strings.Clone` to release pinned arrays

A string sliced from a much larger string keeps the large array alive. Standard symptom: heap profile shows the original large array, but the only reachable references are tiny substrings.

```go
// Before
parser.tokens[i] = doc[start:end]   // pins doc

// After
parser.tokens[i] = strings.Clone(doc[start:end])   // 100 bytes allocated; doc can be freed
```

When to clone:

- After parsing a large document into many small held strings.
- After slicing strings out of network responses for long-term storage.
- After splitting a string into tokens you intend to keep beyond the parent's lifetime.

When not to clone:

- Short-lived slices used and discarded within the same call.
- Substrings that are about the same size as the parent (the clone is a no-op net of overhead).
- Code in the hot path where the parent will be alive anyway.

Rule of thumb: clone if the substring is ≤ 10 % of the parent's size and will outlive the parent.

---

## 10. Recipe 8: Runtime interning — when it helps

Go does not intern runtime strings automatically. Sometimes you want to.

```go
type Interner struct {
    mu    sync.RWMutex
    pool  map[string]string
}

func (in *Interner) Intern(s string) string {
    in.mu.RLock()
    if v, ok := in.pool[s]; ok { in.mu.RUnlock(); return v }
    in.mu.RUnlock()

    in.mu.Lock()
    defer in.mu.Unlock()
    if v, ok := in.pool[s]; ok { return v }
    cloned := strings.Clone(s)
    in.pool[cloned] = cloned
    return cloned
}
```

This pays off when:

- Many strings have a small set of distinct values (e.g. HTTP methods, status names, tag keys).
- The strings are stored in large numbers (millions of records with one of 50 distinct values).
- The dedup ratio is high (10× or more).

It hurts when:

- Values are mostly unique (you pay a lock + lookup for nothing).
- The pool grows unbounded (memory leak; the pool itself becomes the problem).
- Multiple goroutines hammer the lock (contention dominates).

For high-throughput interning, look at `sync.Map` or a sharded `map`. For an upper bound on pool size, use an LRU.

Standard library doesn't ship an interner. Several third-party packages do; `unique.Make` (Go 1.23+, in package `unique`) provides type-parameterised interning with a built-in concurrent map, no manual mutex needed.

```go
import "unique"

h := unique.Make("hello")    // unique.Handle[string]
s := h.Value()                // "hello", possibly shared backing
```

Two `Make` calls with equal strings return handles that compare equal in O(1) (pointer comparison). Use when you have millions of entries with high dedup ratio.

---

## 11. Recipe 9: Watch for `string → interface{}` boxing

```go
slog.Info("processed", "key", key)   // key is a string
```

Each argument after `"key"` is passed as `any`. A string going through `any` is boxed: the runtime allocates 16 bytes for the string header copy and stashes its address in the interface's data word. One allocation per logged field.

Mitigations:

- Use `slog.String("key", key)` instead of variadic args — uses a typed `Attr` that the handler unwraps without boxing.
- For high-throughput logging, the typed-attr form is 2-3× faster than the key/value form.

The same applies to anywhere a string is stored in an `interface{}` field:

```go
type Event struct {
    Data any
}

ev := Event{Data: someString}   // allocates
```

Use a typed field if you can: `Data string` or `Data []byte`.

---

## 12. Recipe 10: Map-key choice and the faststr path

For `map[string]V`, the runtime has dedicated `mapaccess*_faststr` helpers. They are chosen by the compiler when:

- Key type is exactly `string` (not a named type with underlying string).
- Value size matches one of the optimised cases (or the generic fast path).

If you've defined a named string type for clarity:

```go
type RouteKey string
m := map[RouteKey]Handler{}
```

The compiler may **not** use the faststr path because the type is `RouteKey`, not `string`. Convert at the boundary:

```go
m[RouteKey(string(b))]   // works but two conversions
```

Or, more pragmatically, keep the map type as `map[string]Handler` and document the semantic.

Verify with objdump:

```bash
go tool objdump -s 'Lookup' ./binary | grep mapaccess
```

Want `_faststr`. If you see plain `mapaccess1`/`mapaccess2`, investigate why (likely a named key type or an interface-typed map).

---

## 13. Recipe 11: Pre-size everything

Any growable buffer that ends up holding a string benefits from pre-sizing:

```go
// Map
m := make(map[string]int, expectedSize)

// Slice
buf := make([]byte, 0, expectedSize)

// Builder
var b strings.Builder
b.Grow(expectedSize)

// bytes.Buffer
var bb bytes.Buffer
bb.Grow(expectedSize)
```

`Grow`/`make` with a capacity hint typically replaces 5-10 allocations with 1. The hint can be a rough estimate; over-allocation by 2× is preferable to under-allocation by half.

For unknown sizes, a heuristic from prior runs is often available — log the actual `len(result)` for a week, take p90 as your hint.

---

## 14. Recipe 12: Substring search

`strings.Contains`, `strings.Index`, `strings.HasPrefix`, `strings.HasSuffix` are all O(n) and SIMD-accelerated. They are essentially free.

What is **not** free:

- `regexp.MustCompile("foo|bar").MatchString(s)` — heavy machinery for simple alternation. Use multiple `strings.Contains` calls.
- `strings.Index(s, sep) >= 0` — same as `strings.Contains(s, sep)` but more typing. Use `Contains`.
- `len(strings.Split(s, sep)) > 1` — allocates a slice just to check existence. Use `strings.Contains` or `strings.IndexByte`.

For very large texts and very long patterns, consider `regexp.Compile` once and reuse, or `bytes.Index` (same algorithm, same cost) when you're already working with bytes.

---

## 15. Recipe 13: Slice and substring tools

Standard library helpers worth memorising:

| Helper | Use |
|--------|-----|
| `strings.Cut(s, sep)` | Split on first separator. Returns three values — no slice allocation. |
| `strings.CutPrefix(s, prefix)` | Optionally trim prefix. No allocation. |
| `strings.CutSuffix(s, suffix)` | Optionally trim suffix. No allocation. |
| `strings.SplitN(s, sep, n)` | Bounded split. Smaller slice allocation than full `Split`. |
| `strings.Fields(s)` | Split on whitespace. Allocates a slice but skips empty entries. |
| `strings.TrimSpace(s)` | Returns a slice into `s` (no allocation if trimming is needed and substring fits). |

`Cut`, `CutPrefix`, `CutSuffix` (Go 1.18+) are the cleanest way to parse `"key=value"` style strings without allocating a slice.

```go
// Before
parts := strings.SplitN(line, "=", 2)
if len(parts) == 2 { k, v := parts[0], parts[1]; ... }   // allocates parts

// After
k, v, ok := strings.Cut(line, "=")
if ok { ... }                                              // zero allocations
```

---

## 16. Recipe 14: Reading large files into strings

Don't:

```go
data, _ := os.ReadFile("big.txt")
s := string(data)           // copies all of data
process(s)
```

Do:

```go
data, _ := os.ReadFile("big.txt")
s := unsafe.String(&data[0], len(data))   // no copy
process(s)
// data must not be modified or freed before process returns
```

Or, even better:

```go
f, _ := os.Open("big.txt")
defer f.Close()
scanner := bufio.NewScanner(f)
for scanner.Scan() {
    line := scanner.Text()   // string per line; bytes are copied
    process(line)
}
```

Streaming with `bufio.Scanner` avoids loading the entire file into memory. For very large files, the streaming approach reduces peak memory by orders of magnitude.

`scanner.Text()` copies; `scanner.Bytes()` returns a slice into the scanner's buffer (valid only until the next `Scan()`). Choose based on what you do with the result.

---

## 17. Recipe 15: JSON encoding hot paths

`encoding/json` is allocation-heavy. For high-throughput services consider:

- `encoding/json/v2` (Go 1.24+ experimental, opt-in via build tag) — uses `unsafe.String` internally for zero-copy field decoding.
- `goccy/go-json`, `json-iterator/go`, `bytedance/sonic` — third-party, drop-in or near-drop-in replacements, 2-10× faster on string-heavy structures.
- Pre-marshal repeated values: a status object that never changes can be `json.Marshal`-ed once at startup, the resulting `[]byte` written directly to responses.

For specific hot fields, hand-encode:

```go
func writeID(w *bufio.Writer, id int) {
    w.WriteString(`{"id":`)
    w.WriteString(strconv.Itoa(id))
    w.WriteByte('}')
}
```

This is 5-10× faster than the equivalent struct marshalling for one-field responses.

---

## 18. Decision tree: which optimisation to apply

```
Is the function on a hot path (>1000 calls/s in production)?
├── No → don't optimise; readability wins
└── Yes
    ├── Does it concatenate? → strings.Builder + Grow, or Join
    ├── Does it format numbers? → strconv.AppendX into buffer
    ├── Does it look up in a map by []byte? → use m[string(b)] directly
    ├── Does it return a string from a []byte buffer? → consider unsafe.String
    ├── Does it slice a large string for storage? → strings.Clone the slice
    ├── Does it call fmt.Sprintf? → replace with + or AppendX
    ├── Does it convert string ⟷ []byte multiple times? → pick one type
    └── Does it use map[NamedString]V? → switch to map[string]V if possible
```

The order matters: each step costs no readability and gains measurable performance.

---

## 19. Avoid the over-optimisation trap

The compiler is good. The runtime is fast. `string(b)` is one memcpy. Don't `unsafe.String` everything reflexively — every use is one more line of code reviewers must verify is safe, one more potential bug class.

Heuristics:

- If a function is called fewer than 100 times per request and runs in microseconds, leave it alone.
- If a function is called millions of times per second, every allocation counts.
- If a function returns a string the caller will keep for ~1 ms, the conversion cost is irrelevant.
- If a function returns a string the caller will hand to another goroutine and you used `unsafe.String`, you have a race condition.

Profile first. The intuition "this allocates because it converts" is right about 70 % of the time and wrong the other 30 %. Compiler optimisations are surprising.

---

## 20. A worked optimisation

A real example. Function:

```go
func cacheKey(req *http.Request) string {
    return fmt.Sprintf("%s|%s|%d|%s",
        req.Method, req.URL.Path,
        req.ContentLength,
        req.Header.Get("Authorization"))
}
```

Profile showed `runtime.mallocgc` at 9 % of CPU, `fmt.Sprintf` at 6 %. Called 30 000/s.

Step 1 — replace `Sprintf`:

```go
func cacheKey(req *http.Request) string {
    auth := req.Header.Get("Authorization")
    return req.Method + "|" + req.URL.Path + "|" +
        strconv.FormatInt(req.ContentLength, 10) + "|" + auth
}
```

CPU: 7 %. Better but still a lot.

Step 2 — single buffer:

```go
func cacheKey(req *http.Request) string {
    auth := req.Header.Get("Authorization")
    buf := make([]byte, 0, len(req.Method)+len(req.URL.Path)+len(auth)+30)
    buf = append(buf, req.Method...)
    buf = append(buf, '|')
    buf = append(buf, req.URL.Path...)
    buf = append(buf, '|')
    buf = strconv.AppendInt(buf, req.ContentLength, 10)
    buf = append(buf, '|')
    buf = append(buf, auth...)
    return string(buf)
}
```

CPU: 3 %. Allocations per call dropped from 6 to 1.

Step 3 — `unsafe.String` was considered. Rejected in review because `cacheKey` is called from many places, including some that pass the result to long-lived maps. The risk of bug-on-call-site-change wasn't worth saving one more allocation.

Final result: 6× allocation reduction, 3× CPU reduction in this function alone. Total service CPU dropped ~4 % from this single change. Code complexity rose marginally; the new version is documented.

---

## 21. Checklist

Before merging string-heavy code, verify:

- [ ] No `+=` in a loop with more than ~3 iterations.
- [ ] `strings.Builder` calls have `Grow(estimatedSize)`.
- [ ] No `fmt.Sprintf` in functions called more than 1000/s in production.
- [ ] Byte→string conversions for map lookups use `m[string(b)]` directly (no temp variable).
- [ ] Substrings retained beyond their parent's lifetime are `strings.Clone`-d.
- [ ] No `string ⟷ []byte` round-trip without a clear purpose.
- [ ] `unsafe.String` calls are documented with the bytes' lifetime contract.
- [ ] No `unsafe.String` over pooled buffers without a copy.
- [ ] Map types use plain `string` keys, not named string types, where possible.
- [ ] Hot-path logging uses typed `slog.Attr` (`slog.String`, `slog.Int`) instead of variadic key/value pairs.

---

## 22. Summary

String optimisation in Go is mostly about not allocating. The compiler hands you several no-alloc patterns for free — preserve them. The runtime offers `Builder`, `Join`, `Clone`, and `unsafe.String`/`StringData` — use the right one. Avoid `fmt.Sprintf` and `+= in loops` on hot paths. Profile before and after. Most production wins come from a handful of changes in a handful of functions — find them with `pprof -alloc_space`, fix them, move on. Cross-reference [find-bug.md](find-bug.md) for the failure modes that lurk in unoptimised code, and [professional.md](professional.md) for the broader production context.
