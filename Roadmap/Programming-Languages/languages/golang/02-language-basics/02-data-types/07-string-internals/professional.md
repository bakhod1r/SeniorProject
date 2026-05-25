# String Internals — Professional

## 1. Audience and scope

For engineers shipping Go services where string handling shows up in profiles, in GC traces, or in bug postmortems. We assume you have read [middle.md](middle.md) and [senior.md](senior.md). This file is about applying the internals: production patterns, the safe boundaries of `unsafe.String`, zero-copy I/O paths, GC pressure from large strings, and the profiling workflow that ties it all together.

---

## 2. The four production string problems

In real systems, string-related production issues fall into four buckets. Recognising the bucket determines the fix.

| Problem | Symptom | Root cause |
|---------|---------|------------|
| Conversion allocations | `runtime.slicebytetostring` / `stringtoslicebyte` hot in CPU profile, high `mallocgc` count | `string(b)` / `[]byte(s)` on a per-request path |
| Concatenation blow-up | High alloc rate, GC time dominating CPU, growing P99 | `+=` in a loop or `fmt.Sprintf` on a hot path |
| Slice-keeps-original | Steady memory growth without leak, RSS climbs over hours | Tiny string sliced from huge response retained in cache |
| Conversion + escape | Allocations the source doesn't make obvious | Returning `string(b)`, passing as `interface{}`, storing in field |

Section 3–8 cover each in turn with production-ready patterns. Sections 9–11 cover profiling, `unsafe.String` discipline, and large-string GC behaviour.

---

## 3. `strings.Builder` — the right tool, used wrong

The most common misuse:

```go
// Wrong
func buildKey(parts []string) string {
    var b strings.Builder
    for _, p := range parts { b.WriteString(p) }
    return b.String()
}
```

This allocates **once per growth event** as the internal `[]byte` doubles. For long inputs you do log₂(N) allocations, each copying everything written so far. The fix is one line:

```go
func buildKey(parts []string) string {
    var b strings.Builder
    total := 0
    for _, p := range parts { total += len(p) }
    b.Grow(total)
    for _, p := range parts { b.WriteString(p) }
    return b.String()
}
```

Now there is exactly **one** allocation (the initial `Grow`). The `b.String()` call does **not** allocate — `Builder` transfers ownership of its byte buffer to the returned string via `unsafe.String`, with a guarantee that subsequent writes to the Builder won't observe.

For a single known-size operation, `strings.Join` is even simpler and equivalent:

```go
return strings.Join(parts, "")
```

`strings.Join` precomputes the total length, allocates once, copies all parts, returns the string. Always pre-sized. Always one allocation.

Use `Builder` when:

- The operands are added in an interleaved or conditional pattern that doesn't fit `Join`.
- You need to write formatted output (`fmt.Fprintf(&b, ...)` works because `Builder` implements `io.Writer`).
- You want to incrementally produce a string with bounded peak memory.

Use `Join` when:

- You have a flat `[]string` (or slice of any sliceable string source) to concatenate.

Use `+` when:

- The total is short, the call is not in a loop, and the result doesn't escape.

---

## 4. `unsafe.String` and `unsafe.StringData` in production

`unsafe.String(ptr *byte, n IntegerType) string` creates a string header pointing at existing bytes — no copy. `unsafe.StringData(s) *byte` returns the bytes pointer. Together they enable zero-copy `[]byte ↔ string` at the cost of two contracts.

### The contract, formally

For `s := unsafe.String(p, n)`:

1. The `n` bytes starting at `p` must remain **valid and unmodified** for as long as `s` is reachable.
2. The bytes must be **alive**: nothing reclaims them while `s` exists. This usually means `p` was obtained from a still-alive `[]byte` or `*byte` known to the GC.

For `b := unsafe.Slice(unsafe.StringData(s), len(s))`:

1. The slice must not be **written to**. A string's bytes can be in RODATA (segfault on write) or shared with other holders of the same string (silent corruption).
2. The slice's lifetime must not exceed the string's.

Breaking either contract is undefined behaviour. The runtime will not detect it. The race detector will not catch it.

### Safe patterns

**Pattern A — converting a freshly built, single-use buffer to a returned string:**

```go
func formatID(prefix string, n int) string {
    buf := make([]byte, 0, len(prefix)+20)
    buf = append(buf, prefix...)
    buf = strconv.AppendInt(buf, int64(n), 10)
    return unsafe.String(&buf[0], len(buf))
}
```

`buf` is local, escapes only via the returned string, never touched again. Safe.

**Pattern B — converting an incoming `[]byte` for read-only access in a tight scope:**

```go
func isMethod(line []byte, method string) bool {
    return unsafe.String(&line[0], len(line)) == method
}
```

The string exists only for the comparison. The caller has not modified `line`. Safe.

The compiler already does this for `string(line) == method`, so this is a manual recreation — useful when the comparison is hidden inside a helper the compiler can't pattern-match (e.g., passing through an interface).

**Pattern C — reading from `io.Reader` into a buffer, then exposing as string:**

```go
func ReadAllAsString(r io.Reader) (string, error) {
    var buf bytes.Buffer
    _, err := io.Copy(&buf, r)
    if err != nil { return "", err }
    b := buf.Bytes()
    if len(b) == 0 { return "", nil }
    return unsafe.String(&b[0], len(b)), nil
}
```

The caller is now responsible for not touching the `bytes.Buffer` after this call returns — but since we don't hand the buffer back, this is enforceable.

### Unsafe patterns to avoid

**Anti-pattern: keeping the byte slice around and modifying it.**

```go
buf := []byte("hello")
s := unsafe.String(&buf[0], len(buf))
buf[0] = 'H'           // silently mutates s — broken
fmt.Println(s)         // "Hello" or "hello" depending on observer
```

**Anti-pattern: aliasing a string into a writeable slice.**

```go
s := "GET"
b := unsafe.Slice(unsafe.StringData(s), len(s))
b[0] = 'P'              // SEGV: s is in RODATA
```

The runtime cannot protect you. If you find yourself writing this code, step back and check whether your caller would let you take `[]byte` instead.

---

## 5. Zero-copy I/O patterns

Most Go web frameworks parse request bodies into bytes then convert to strings for routing/dispatch. A naive request handler chain converts the same bytes multiple times. Audit your handler entry points.

### HTTP body to string

`http.Request.Body` is `io.ReadCloser`. The common path is:

```go
data, _ := io.ReadAll(req.Body)
str := string(data)
```

Two allocations: `data` (growing during `ReadAll`) and `str` (copy of `data`). Use:

```go
data, _ := io.ReadAll(req.Body)
str := unsafe.String(&data[0], len(data))
```

if you control the handler and won't modify `data`. One allocation. For large bodies, this is significant.

For repeated small requests, pool the buffer:

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func read(req *http.Request) (string, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)  // careful — see below

    if _, err := io.Copy(buf, req.Body); err != nil { return "", err }
    b := buf.Bytes()
    return unsafe.String(&b[0], len(b)), nil   // WRONG with pool
}
```

This last form is broken: returning the string keeps the underlying bytes alive, but we just Put the buffer back into the pool, where another goroutine might grab and Reset it. The string would then observe corrupted bytes. To use pools safely with zero-copy strings, the buffer must not be returned to the pool until the string is **provably** out of use. That usually means copying:

```go
result := string(b)        // explicit copy — safe with pool
return result, nil
```

Rule: `unsafe.String` and pooled buffers are a foot-gun combination. Use one or the other, not both.

### HTTP route matching

Routes are stored as strings; incoming paths are bytes. Path matching is a hot per-request path. The compiler already optimises `m[string(b)]`. Confirm your router uses this idiom; many do not.

```go
// Verify with `go tool objdump`:
go tool objdump -s 'router.match' ./binary | grep mapaccess
# Want: mapaccess1_faststr
```

If your router builds a tree (Trie) of byte segments rather than full map keys, the rule is to compare with `bytes.Equal(needle, []byte(literal))` — the compiler can constant-fold the `[]byte(literal)` against a sequence of literal bytes, again with no allocation.

---

## 6. Large strings and GC pressure

Strings allocated on the heap participate in GC like any other object. Specifically:

- A string ≥ 32 KB goes through the large-object allocator (`runtime/mheap.go`).
- The runtime scans the string header's `Data` pointer, sees it points at a byte array with no internal pointers (`gcdata` says "all scalars"), and skips scanning the bytes themselves.
- Reclamation of a 1 MB string frees 1 MB at once — same as a slice.

So large strings are not exotic. What is exotic is **fragmentation**: many medium strings (10–100 KB) allocated and freed at different rates fragment the heap, especially under high GC frequency. Symptoms:

- RSS grows over hours but `runtime.MemStats.Alloc` is stable.
- `pprof` heap shows ~normal usage but the OS thinks otherwise.
- `GODEBUG=madvdontneed=1` (Linux) reduces RSS at the cost of more page faults.

Mitigations:

- Use a `sync.Pool` of `*bytes.Buffer` to reuse the underlying arrays.
- Switch large string traffic to `[]byte` end-to-end; reuse the slice with `b = b[:0]`.
- Process large payloads streaming (one `[]byte` chunk at a time) rather than reading into one huge string.

---

## 7. The slice-pins-array problem

Classic memory leak:

```go
type Cache struct {
    items map[string]string
}

func (c *Cache) Put(req []byte) {
    key := string(req[:8])         // 8-byte key
    value := string(req[8:])        // value of unknown size
    c.items[key] = value
}
```

If `req` comes from a network read with a 1 MB buffer, **both `key` and `value` keep that 1 MB buffer alive** — through the strings' `Data` pointers. The runtime cannot reclaim the 1 MB until both strings are dropped.

Actually, no. The `string(...)` conversion **copies** by default, so this specific example is fine: `key` is 8 bytes in its own backing array, `value` is the right size in its own array, and `req` is freed normally.

But if you use the zero-copy alternative:

```go
key := unsafe.String(&req[0], 8)              // pins req
value := unsafe.String(&req[8], len(req)-8)   // pins req again
```

Now both strings pin the original 1 MB buffer. Storing them in `c.items` keeps it alive forever. The fix is to force a copy at the cache boundary:

```go
c.items[strings.Clone(key)] = strings.Clone(value)
```

`strings.Clone(s)` (Go 1.18+) explicitly allocates a fresh backing array sized exactly for `s` and returns a string pointing at it. The old, possibly-much-larger backing array can be freed.

Use `strings.Clone` whenever a short string derived from a possibly-large parent will outlive that parent. The most common cases are caches, deduplication tables, and result fields in long-lived structs.

---

## 8. JSON, log, and metric pipelines

`encoding/json` is one of the largest consumers of strings in a typical Go service. It does:

- Per field: `[]byte` from the parser → `string` for map keys (allocates).
- Per string value: `[]byte` payload → `string` field assignment (allocates).
- Per number: parse into `int64`/`float64` then `strconv.FormatX` (string allocations on encode).

If JSON is in your top-3 CPU in production, look at `encoding/json/v2` (Go 1.24+) or external libraries (`json-iterator/go`, `sonic`, `goccy/go-json`) which use `unsafe.String` to skip the per-string-value copy.

For logging, `log/slog` uses a `[]byte` buffer per record and converts to string only at the writer boundary. If your handler is `slog.NewTextHandler(os.Stdout, nil)`, the final string is the formatted line. If your handler is `slog.NewJSONHandler`, the per-field key strings are still allocated.

For metrics, prefer keyed label types that take `string` directly without splitting and rejoining. Building a label as `fmt.Sprintf("status=%d", code)` once per request flatlines a Prometheus exporter.

---

## 9. Profiling workflow

When you suspect string-related allocation, the diagnostic path is:

### Step 1 — alloc profile

```bash
go test -bench=. -benchmem -memprofile=mem.out ./...
go tool pprof -alloc_space mem.out
(pprof) top 10
(pprof) list myFunction
```

Look for high `alloc_space` from:

- `runtime.slicebytetostring` (you have `string([]byte)` somewhere)
- `runtime.stringtoslicebyte` (you have `[]byte(string)` somewhere)
- `runtime.concatstrings`, `runtime.concatstring2` (concatenation)
- `runtime.growslice` of `[]byte` (often a string Builder without `Grow`)

### Step 2 — escape analysis

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep -E "string|escapes" | head -50
```

For each escape on a string conversion, ask: is there a way to keep it on the stack? Often the answer is "use the conversion inside the map key" or "return earlier".

### Step 3 — heap profile during steady state

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
(pprof) top
(pprof) list
```

In a long-running service, the heap profile shows what's resident. A string-pinning bug looks like `[]byte` arrays much larger than the strings in `items map[string]string` would explain.

### Step 4 — trace

```bash
go test -trace=trace.out ./...
go tool trace trace.out
```

The trace shows GC events. If GC runs every 10 ms and pauses are sub-millisecond, your string allocations are tolerable. If GC is back-to-back with 100 ms pauses, you have an allocation problem; combine with the alloc profile to find the source.

---

## 10. The typed-nil string question

```go
var s string
fmt.Println(s == "")  // true
```

There is no concept of "typed-nil string". The zero value of `string` is the empty string, and the empty string compares equal to itself. There is no distinction between "default" and "explicit empty".

This is different from `[]byte`:

```go
var b []byte
fmt.Println(b == nil)        // true
fmt.Println(len(b) == 0)     // true
fmt.Println(string(b) == "") // true
b2 := []byte{}
fmt.Println(b2 == nil)       // false
fmt.Println(len(b2) == 0)    // true
```

When converting `[]byte` → `string`, both `nil` and empty `[]byte` produce `""`. The string layer does not preserve the distinction. If you need to know whether a JSON field was present-but-empty vs. absent, use `*string` or a custom unmarshalling type — not plain `string`.

When converting `string` → `[]byte`, the empty string produces an empty (non-nil) slice. If your code depends on a nil-vs-non-nil-empty distinction, document it loudly.

---

## 11. Database and ORM gotchas

Most database drivers return text columns as `[]byte` from the wire, then ORMs convert to `string` for the user. Per row, per text column. For a 100-column result set with 1000 rows, you do 100 000 small allocations.

If your ORM or driver supports it:

- `sql.RawBytes` keeps the bytes as a slice you read directly. No allocation, but valid only until the next `rows.Next()` call.
- `pgx` (the Postgres driver) offers `pgtype.Text` with `Bytes()` accessor for the same effect.

For high-throughput query paths, retrieve as `[]byte`, do whatever filtering or hashing you need on the bytes, and only convert to `string` for values you actually retain.

---

## 12. Concurrent string usage

Strings are **immutable**, so concurrent reads are safe by definition. There is no shared-mutable-state question for plain strings — every "modification" produces a new string and leaves the original untouched.

The race detector still has opinions when you cross into `unsafe.String`:

```go
go func() {
    buf := []byte("hello")
    s := unsafe.String(&buf[0], len(buf))
    ch <- s
    buf[0] = 'H'   // race! the receiver may be reading the bytes through s
}()
```

The race detector will flag this if the receiver also touches the bytes. The fix is either: don't modify after handing off, or do not use `unsafe.String`.

For `strings.Builder`, the documented contract is: "It must not be copied after first use." Goroutines sharing one Builder is a data race. Each goroutine should have its own Builder, or you should protect with a mutex (and at that point use `[]byte` and `append`).

---

## 13. Internationalization and `golang.org/x/text`

If your service processes user text in non-ASCII scripts, your assumptions about byte length, character count, sort order, and case conversion all need attention. The standard library handles UTF-8 correctly but does not normalise (NFC/NFD) or collate.

The `golang.org/x/text` repository provides:

- `unicode/norm` — Unicode normalization (`norm.NFC.String(s)`). Two visually identical strings may have different byte sequences if one uses combining diacritics; normalise before hashing or comparing for "logical equality".
- `cases` — locale-aware case folding (`cases.Lower(language.Turkish).String("İ")` differs from `strings.ToLower`).
- `collate` — locale-aware sort orders.

For internal identifiers (paths, IDs, headers) `strings.EqualFold` (ASCII case-insensitive) is usually enough and is allocation-free for short strings. For user-facing content, reach for `x/text`.

---

## 14. Production allocation budget

A rough order-of-magnitude budget for a high-throughput Go service (10 000 QPS, 1 ms p50 latency):

| Operation per request | Allocations |
|----------------------|-------------|
| HTTP request parse (server) | 3–8 (headers map, body, URL) |
| Route matching | 0 (with `m[string(b)]` fast path) |
| JSON unmarshal | 1 per field roughly |
| Business logic strings (IDs, keys) | aim for 0–3 |
| JSON marshal response | 1 per field roughly |
| HTTP response write | 0–2 |

A request that allocates more than 50 strings is suspect. A request that allocates more than 200 strings is a problem. Use `runtime.ReadMemStats` before and after a synthetic request to measure.

---

## 15. A checklist for code review

Before merging any change touching string-heavy code:

- [ ] No `+=` in a loop. Use `Builder` or `Join`.
- [ ] No `fmt.Sprintf` on a per-request hot path. Use `strconv.AppendX` into a buffer.
- [ ] `Builder` calls use `Grow` when the total size is known or estimable.
- [ ] No `unsafe.String` over data we don't fully control.
- [ ] Strings derived from large buffers and retained: `strings.Clone` applied.
- [ ] Map lookups using bytes use the `m[string(b)]` direct form (no temp variable).
- [ ] No `string(int)` accidentally used for stringification.
- [ ] No `[]byte(s)` followed immediately by `string(b)` (round-trip with no purpose).
- [ ] No `reflect.StringHeader` in new code (use `unsafe.String` / `unsafe.StringData`).

---

## 16. A worked production fix

Real example. A service had a function:

```go
func makeKey(userID, action string, ts time.Time) string {
    return fmt.Sprintf("%s:%s:%d", userID, action, ts.Unix())
}
```

In a profile, `runtime.mallocgc` was 14 % of CPU. `fmt.Sprintf` was 8 %. The function ran 50 000 times per second.

Rewritten:

```go
func makeKey(userID, action string, ts time.Time) string {
    buf := make([]byte, 0, len(userID)+len(action)+24)
    buf = append(buf, userID...)
    buf = append(buf, ':')
    buf = append(buf, action...)
    buf = append(buf, ':')
    buf = strconv.AppendInt(buf, ts.Unix(), 10)
    return string(buf)
}
```

Same observable behaviour. CPU dropped 12 %. Allocation count dropped from 4 per call (Sprintf's internal allocations) to 1. A further `unsafe.String(&buf[0], len(buf))` would have removed the last copy but was rejected in review because the function was called from many places and the safety argument was per-call rather than universal.

The lesson: most string CPU problems are solved by writing into a pre-sized `[]byte` and converting once at the end.

---

## 17. Further reading

- `runtime/string.go` — https://github.com/golang/go/blob/master/src/runtime/string.go
- `runtime/map_faststr.go` — https://github.com/golang/go/blob/master/src/runtime/map_faststr.go
- `unsafe` documentation for `String` and `StringData` — https://pkg.go.dev/unsafe
- `strings` package — https://pkg.go.dev/strings
- `cmd/compile` walk passes — `cmd/compile/internal/walk/order.go`
- "Strings, bytes, runes and characters in Go" — https://go.dev/blog/strings (still accurate)

---

## 18. Summary

In production, string handling is mostly about not allocating: pre-size your Builder, use `Join` when you can, avoid `Sprintf` on the hot path, leverage `m[string(b)]` for byte-keyed lookups, and reach for `unsafe.String` only where you control both ends of the byte lifetime. Watch for large-string pinning through slicing; `strings.Clone` is your release valve. Profile alloc_space first, then CPU, then heap; in that order. The runtime gives you a lot for free — your job is to not block it from doing so.
