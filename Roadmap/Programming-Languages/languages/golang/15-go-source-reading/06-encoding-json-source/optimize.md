# encoding/json — Optimization

## 1. How to use this file

Fourteen scenarios where typical `encoding/json` code allocates more, reflects more, or serializes slower than it needs to. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. `encoding/json` cost is dominated by four things: full-buffer materialization (Marshal/Unmarshal vs streaming), reflection on un-cached types, `interface{}` boxing on decode, and indirection through `io.ReadAll` / `string([]byte)` round-trips. Most wins remove one of those four from the hot path. Reading order: Ex. 1, 2, 3, then any order. Ex. 8, 10, 13 are the ones most senior reviews flag.

---

## 2. Exercise 1 — `json.Marshal` per-request → `Encoder` writing to writer

An HTTP handler calls `json.Marshal(resp)` and writes the resulting `[]byte`. Each call allocates a fresh buffer, grows it as the response is built, then copies into the `ResponseWriter`. Two copies, one peak allocation, one full GC root.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    resp := buildResp() // ~8 KB JSON
    data, err := json.Marshal(resp)
    if err != nil { http.Error(w, err.Error(), 500); return }
    w.Header().Set("Content-Type", "application/json")
    w.Write(data)
}
```

```
BenchmarkMarshalThenWrite-8   80000   14500 ns/op   12288 B/op   6 allocs/op  // 8 KB body
```

<details><summary>After</summary>

`json.NewEncoder(w).Encode(resp)` streams directly into the writer. The encoder reuses an internal buffer scratch space and skips the final `bytes.Buffer.Bytes()` copy that `Marshal` performs.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    if err := json.NewEncoder(w).Encode(buildResp()); err != nil {
        http.Error(w, err.Error(), 500)
    }
}
```

```
BenchmarkEncoderToWriter-8   140000   8100 ns/op   4096 B/op   2 allocs/op
```

~1.8× faster, ~3× less garbage.

**Why faster:** `json.Marshal` returns `[]byte` — it must own the full result before returning, which forces a final `append`/copy to a right-sized backing array. `Encoder` writes incrementally as fields serialize, so the internal buffer only needs to hold a chunk, not the entire payload. The 4 KB the encoder does allocate is its scratch buffer, reusable if you pool encoders.
**Trade-off:** `Encoder.Encode` appends a trailing newline — fine for NDJSON and most HTTP clients, breaking for `Content-Length`-strict consumers. Errors mid-encode leave partial bytes on the wire — the client gets garbage if the handler hasn't already set `Content-Length`. Cannot retry after partial write.
**When NOT:** Tiny payloads (< 256 B) where the two-allocation `Marshal` is already fast. Code that needs the byte length before writing (e.g., signing the payload, setting `Content-Length`). Endpoints where the trailing newline trips a strict consumer.
</details>

---

## 3. Exercise 2 — `json.Unmarshal(io.ReadAll(r), ...)` → `json.NewDecoder(r).Decode(...)`

Decoding a request body via `io.ReadAll` then `json.Unmarshal` reads the whole body into memory before parsing. For a 1 MB upload, that's a 1 MB temporary `[]byte` plus the decoded struct.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil { http.Error(w, err.Error(), 400); return }
    var req Request
    if err := json.Unmarshal(body, &req); err != nil {
        http.Error(w, err.Error(), 400); return
    }
    process(req)
}
```

```
BenchmarkReadAllUnmarshal-8   1500   780000 ns/op   1100000 B/op   42 allocs/op  // 1 MB body
```

<details><summary>After</summary>

`json.NewDecoder(r.Body).Decode(&req)` streams: the decoder reads chunks, parses, drops. Peak memory drops to a small buffer plus the struct.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var req Request
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), 400); return
    }
    process(req)
}
```

```
BenchmarkDecoderStream-8   3000   420000 ns/op   8200 B/op   38 allocs/op
```

~1.9× faster, ~130× less peak allocation.

**Why faster:** `io.ReadAll` doubles memory: full body plus the in-flight decoded struct exist simultaneously. The decoder keeps only a chunk in its scratch buffer (~4 KB) and emits parsed fields into the target as it goes. The allocator and GC see one large temp object disappear from the working set.
**Trade-off:** Decoder consumes input lazily — if the client sends garbage after a valid JSON value, you won't notice unless you call `.More()` or check `.Decode(&junk) == io.EOF`. `Decoder` does not enforce a body size — pair with `r.Body = http.MaxBytesReader(w, r.Body, N)` to bound input. For NDJSON, the decoder is the only sane choice; for single-value bodies, the win is only memory, not necessarily wall-time on small payloads.
**When NOT:** Bodies known to be tiny (< 1 KB) where one allocation cost is negligible. Code that wants to log or hash the raw bytes — read once, use the bytes for both. Replay/retry semantics where you need to re-parse the same payload multiple times.
</details>

---

## 4. Exercise 3 — `interface{}` decoding for known schema → typed struct

A handler decodes into `interface{}` then type-asserts each field. Every JSON value materializes as a `map[string]interface{}` or `[]interface{}` — and every leaf becomes a boxed `string`, `float64`, or `bool`.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var v interface{}
    json.NewDecoder(r.Body).Decode(&v)
    m := v.(map[string]interface{})
    userID := int(m["user_id"].(float64))
    name := m["name"].(string)
    process(userID, name)
}
```

```
BenchmarkInterfaceDecode-8   4000   320000 ns/op   45000 B/op   780 allocs/op  // 5 KB body, 50 fields
```

<details><summary>After</summary>

A typed struct skips the boxing entirely: the decoder writes directly into struct fields, knowing each target type at compile time.

```go
type Request struct {
    UserID int    `json:"user_id"`
    Name   string `json:"name"`
    // ...
}

func handler(w http.ResponseWriter, r *http.Request) {
    var req Request
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), 400); return
    }
    process(req.UserID, req.Name)
}
```

```
BenchmarkTypedDecode-8   18000   65000 ns/op   2400 B/op   28 allocs/op
```

~4.9× faster, ~19× less garbage.

**Why faster:** `interface{}` decoding allocates a map header, a hash table backing, 50 string keys, 50 `interface{}` slots (each two words), and box-allocations for non-pointer leaves. Typed decode writes a `string` header into a struct field — no map, no boxing. The decoder also caches a field-name → offset table per type (`structFields`) on first sight, making subsequent decodes pure dispatch.
**Trade-off:** Schema lock-in: adding a field requires a struct change. Strict mode (`DisallowUnknownFields`) breaks consumers; lax mode silently drops typos. Numeric fields default to `float64` if you forget to type them — use `json.Number` if you need int/float distinction.
**When NOT:** Truly schema-less payloads (webhooks, generic event ingestion, JSON-RPC bridges). Tools that pass payloads through without inspection. Code where the field set is dynamic and known only at runtime.
</details>

---

## 5. Exercise 4 — `map[string]interface{}` for known schema → typed struct

A near-duplicate of Ex. 3 but in code that's "trying to be flexible." Allocates a map per request, hashes every key on every access, boxes leaves.

```go
func update(w http.ResponseWriter, r *http.Request) {
    var m map[string]interface{}
    json.NewDecoder(r.Body).Decode(&m)
    if email, ok := m["email"].(string); ok { updateEmail(email) }
    if age, ok := m["age"].(float64); ok { updateAge(int(age)) }
}
```

```
BenchmarkMapStringIface-8   12000   95000 ns/op   8400 B/op   140 allocs/op  // 10-field body
```

<details><summary>After</summary>

Typed struct with pointer fields models optionality without an interface table.

```go
type UpdateReq struct {
    Email *string `json:"email,omitempty"`
    Age   *int    `json:"age,omitempty"`
}

func update(w http.ResponseWriter, r *http.Request) {
    var req UpdateReq
    json.NewDecoder(r.Body).Decode(&req)
    if req.Email != nil { updateEmail(*req.Email) }
    if req.Age != nil { updateAge(*req.Age) }
}
```

```
BenchmarkTypedOptional-8   90000   13000 ns/op   240 B/op   3 allocs/op
```

~7.3× faster, ~35× less garbage.

**Why faster:** Same as Ex. 3 — no map, no boxing — plus pointer-fields encode "present but nil" cleanly. `*string` is two words; `interface{}` holding a `string` is two words but with a type descriptor lookup. Field presence check becomes a nil compare, not a map probe.
**Trade-off:** Pointer fields invite nil deref bugs downstream. Wrap field access in helpers or use the `omitempty` + zero-value-is-meaningful trick when zero is a valid value. Pointer-to-int means the int lives on the heap separately from the struct — measure if the struct is large and pointers chase across cache lines.
**When NOT:** Patch endpoints where 50+ optional fields exist — managing 50 `*T` fields is noisy; consider a dedicated patch struct with explicit presence bits. JSON Merge Patch (RFC 7396) semantics where "null means delete" — `*T` collapses null and absent into the same nil.
</details>

---

## 6. Exercise 5 — `fmt.Sprintf` then Marshal → `MarshalJSON` custom on type

A `Timestamp` type formats itself by stringifying through `fmt.Sprintf("%d", t.Unix())` then letting `json.Marshal` quote it. Each Marshal call goes through `fmt`'s machinery to produce a string the encoder then re-escapes.

```go
type Event struct {
    Name string
    At   time.Time
}

func (e Event) toJSON() ([]byte, error) {
    ts := fmt.Sprintf("%d", e.At.Unix())
    payload := struct {
        Name string `json:"name"`
        At   string `json:"at"`
    }{e.Name, ts}
    return json.Marshal(payload)
}
```

```
BenchmarkSprintfMarshal-8   500000   2400 ns/op   240 B/op   6 allocs/op
```

<details><summary>After</summary>

Implement `MarshalJSON` directly on the timestamp type — emit the integer bytes with `strconv.AppendInt`. The encoder calls it without going through `fmt`.

```go
type Timestamp time.Time

func (t Timestamp) MarshalJSON() ([]byte, error) {
    b := make([]byte, 0, 20)
    b = strconv.AppendInt(b, time.Time(t).Unix(), 10)
    return b, nil
}

type Event struct {
    Name string    `json:"name"`
    At   Timestamp `json:"at"`
}
```

```
BenchmarkCustomMarshalJSON-8   1500000   780 ns/op   80 B/op   2 allocs/op
```

~3× faster, ~3× less garbage.

**Why faster:** `fmt.Sprintf` builds a `[]byte` through a `fmt.pp` pool, parses the format string, reflects on the arg, then returns a `string`. Then `json.Marshal` allocates again to quote it. The custom marshaler skips both: `strconv.AppendInt` writes digits directly into a pre-sized buffer the encoder consumes verbatim.
**Trade-off:** Custom `MarshalJSON` returns a fresh `[]byte` per call — pool the buffer (`sync.Pool`) for very hot paths. If the type implements both `MarshalJSON` and `encoding.TextMarshaler`, `MarshalJSON` wins; document the choice. Errors in custom marshalers are notoriously easy to misuse — return `nil` only when you wrote valid JSON.
**When NOT:** Types stringified once per request — the `fmt` cost is invisible. Code where the human-readable format must match `fmt.Sprintf` output exactly. Tests that round-trip Marshal/Unmarshal — adding a custom marshaler forces a matching unmarshaler.
</details>

---

## 7. Exercise 6 — Struct without `omitempty` for sparse fields → add it (wire size)

A `Response` struct has 30 fields; only 4-5 are populated on the average call. Without `omitempty`, every zero field serializes as `"field":"" ` or `"field":0`, ballooning the response.

```go
type Response struct {
    ID       string `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email"`
    Phone    string `json:"phone"`
    Address  string `json:"address"`
    // ... 25 more fields
}
```

```
BenchmarkNoOmitempty-8   200000   6800 ns/op   2800 B/op   4 allocs/op  // ~2.4 KB wire
```

<details><summary>After</summary>

Add `omitempty` to fields that are zero in the steady-state — the encoder skips them entirely.

```go
type Response struct {
    ID      string `json:"id"`
    Name    string `json:"name,omitempty"`
    Email   string `json:"email,omitempty"`
    Phone   string `json:"phone,omitempty"`
    Address string `json:"address,omitempty"`
    // ... 25 more with omitempty
}
```

```
BenchmarkOmitemptySparse-8   600000   2200 ns/op   480 B/op   2 allocs/op
```

~3× faster, ~6× smaller wire payload.

**Why faster:** The encoder's per-field code path includes an `isEmptyValue` check when `omitempty` is set — short-circuiting strings of length zero, nil slices, zero ints, etc. Fewer bytes mean fewer escape checks, fewer writes, smaller compressed responses, less work for the client to parse. Network savings dwarf CPU savings on real workloads.
**Trade-off:** Schema clients (OpenAPI codegen) may expect every field present — they crash on missing keys unless tolerant. `omitempty` cannot distinguish "absent" from "zero": a deliberately-zero `int` field is indistinguishable from "not set." Use `*int` or a `json.Number` if zero is semantically meaningful. Beware: structs are never empty by `omitempty`'s definition (Go 1.23) — nesting an empty struct still serializes as `{}`.
**When NOT:** Fields that must always be present in the contract (`"version": 0` for a v0 record). Strict consumers that key off presence. Schema-validated APIs where omission means "field invalid."
</details>

---

## 8. Exercise 7 — `json.RawMessage` not used for delayed parsing → use it

A router decodes the envelope, dispatches on `Type`, then decodes the payload into the type-specific struct. Without `RawMessage`, the payload gets decoded twice or parked as `interface{}` and re-marshaled.

```go
type Envelope struct {
    Type    string      `json:"type"`
    Payload interface{} `json:"payload"`
}

func dispatch(body []byte) error {
    var env Envelope
    json.Unmarshal(body, &env)
    payloadBytes, _ := json.Marshal(env.Payload) // re-marshal to bytes
    switch env.Type {
    case "user":
        var u User
        return json.Unmarshal(payloadBytes, &u)
    case "order":
        var o Order
        return json.Unmarshal(payloadBytes, &o)
    }
    return nil
}
```

```
BenchmarkInterfaceEnvelope-8   30000   42000 ns/op   3200 B/op   62 allocs/op
```

<details><summary>After</summary>

`json.RawMessage` defers parsing: the envelope decode stores the raw bytes; the second decode parses them directly.

```go
type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

func dispatch(body []byte) error {
    var env Envelope
    if err := json.Unmarshal(body, &env); err != nil { return err }
    switch env.Type {
    case "user":
        var u User
        return json.Unmarshal(env.Payload, &u)
    case "order":
        var o Order
        return json.Unmarshal(env.Payload, &o)
    }
    return nil
}
```

```
BenchmarkRawMessage-8   90000   13000 ns/op   720 B/op   18 allocs/op
```

~3.2× faster, ~4.4× less garbage.

**Why faster:** Without `RawMessage`, the envelope's `Payload` is decoded into `interface{}` (Ex. 3 cost), then `json.Marshal` re-serializes that interface tree back to bytes (full re-walk + alloc), then `Unmarshal` parses those bytes. With `RawMessage`, the first pass just records the byte range of the payload — no allocation per leaf, no re-marshal. The second pass parses straight into the target type.
**Trade-off:** `RawMessage` retains a reference into the original byte slice — keeping the entire body alive until the `RawMessage` is decoded or discarded. For streaming decoders, this means buffering. The raw bytes are not validated until the second parse — a malformed payload only fails on dispatch, not envelope decode.
**When NOT:** Single-pass decodes where the payload type is known up front — use the typed field directly. Code where you must validate the entire structure in one pass (audit, security gateway). Memory-tight paths where holding the body bytes past the envelope hurts.
</details>

---

## 9. Exercise 8 — Reflect-heavy struct on hot path → codegen for that type only

A trading service serializes `Tick` (price, size, ts, symbol) 200k times/sec. `encoding/json` reflects on the struct every call — the type cache amortizes lookup but `reflect.Value` plumbing still costs.

```go
type Tick struct {
    Symbol string  `json:"symbol"`
    Price  float64 `json:"price"`
    Size   float64 `json:"size"`
    TS     int64   `json:"ts"`
}

func encode(t Tick) ([]byte, error) { return json.Marshal(t) }
```

```
BenchmarkStdlibMarshal-8   3000000   420 ns/op   96 B/op   2 allocs/op
```

<details><summary>After</summary>

`easyjson`-style codegen produces a hand-rolled `MarshalJSON` that writes bytes directly with `strconv.AppendFloat` / `AppendInt` and pre-known field names. No reflection on the hot path.

```go
// generated by easyjson -all tick.go
func (t Tick) MarshalJSON() ([]byte, error) {
    b := make([]byte, 0, 96)
    b = append(b, `{"symbol":`...)
    b = strconv.AppendQuote(b, t.Symbol)
    b = append(b, `,"price":`...)
    b = strconv.AppendFloat(b, t.Price, 'f', -1, 64)
    b = append(b, `,"size":`...)
    b = strconv.AppendFloat(b, t.Size, 'f', -1, 64)
    b = append(b, `,"ts":`...)
    b = strconv.AppendInt(b, t.TS, 10)
    b = append(b, '}')
    return b, nil
}
```

```
BenchmarkCodegenMarshal-8   12000000   95 ns/op   96 B/op   1 allocs/op
```

~4.4× faster.

**Why faster:** The stdlib path: itab dispatch into `(*encodeState).reflectValue` → cached `structEncoder` → per-field `reflect.Value` walks → bytes appended through `encodeState.Buffer`. Codegen collapses all of that to direct `strconv.Append*` calls into a local slice. No `reflect.Value` materialization, no interface conversions on field values, no map lookup for field encoders.
**Trade-off:** Generated code drifts when the struct changes — regenerate or break. `easyjson` and `sonic` skip some stdlib niceties (HTML escaping by default, `MarshalJSON` interface dispatch for nested types). `sonic` uses SIMD on amd64 — wins are bigger but cgo-adjacent on some configurations. Adding codegen to a build pipeline is a one-time cost; auditing the generated output for a security-critical type is ongoing.
**When NOT:** Types serialized < 10k times/sec — reflection cost is invisible. Types with custom marshalers on nested fields — codegen and custom marshalers interact awkwardly. Code that values a single source of truth and doesn't want generated files in `git`.
</details>

---

## 10. Exercise 9 — Repeated parsing of same JSON → cache parsed result

A middleware parses the same JWT-claims payload on every request through the same hot endpoint. The payload is identical across requests for the same token. 10k req/sec × parse cost = wasted CPU.

```go
func extractClaims(token string) (Claims, error) {
    payloadJSON, err := base64Decode(token)
    if err != nil { return Claims{}, err }
    var c Claims
    if err := json.Unmarshal(payloadJSON, &c); err != nil { return Claims{}, err }
    return c, nil
}
```

```
BenchmarkParseEveryRequest-8   400000   3100 ns/op   480 B/op   8 allocs/op
```

<details><summary>After</summary>

`sync.Map` keyed by the token (or a hash of it). First request parses, every subsequent request hits the cache.

```go
var claimsCache sync.Map // token-hash → Claims

func extractClaims(token string) (Claims, error) {
    if v, ok := claimsCache.Load(token); ok {
        return v.(Claims), nil
    }
    payloadJSON, err := base64Decode(token)
    if err != nil { return Claims{}, err }
    var c Claims
    if err := json.Unmarshal(payloadJSON, &c); err != nil { return Claims{}, err }
    claimsCache.Store(token, c)
    return c, nil
}
```

```
BenchmarkCachedClaims-8   8000000   140 ns/op   0 B/op   0 allocs/op
```

~22× faster on cache hits.

**Why faster:** Hit path is one map probe; miss path is the original cost. For a token reused across a session, the amortized cost approaches zero. `sync.Map` is read-optimized — its dirty/clean two-map dance avoids the `RWMutex` cost on read-heavy workloads, which matches "parse once, read many."
**Trade-off:** Unbounded `sync.Map` is a memory leak — tokens churn forever. Pair with TTL-based eviction (`hashicorp/golang-lru/v2` with TTL) or LRU bound. Caching arbitrary JSON keyed by the bytes is also possible but the key (often a hash) must be stable and collision-free. Stale cache vs token revocation — invalidate on revoke, or shorten TTL to your revoke-latency tolerance.
**When NOT:** Payloads unique per request (per-request IDs, timestamps). Sensitive data where caching plaintext claims in process memory is a policy violation. Memory-tight services where a 100k-entry cache is too expensive.
</details>

---

## 11. Exercise 10 — Per-call `bytes.Buffer` for Encoder → reuse via `sync.Pool`

A serializer creates a fresh `bytes.Buffer` and `json.Encoder` per call. Each allocates ~64 B (Buffer) + ~96 B (Encoder) + the buffer's growing backing array.

```go
func serialize(v interface{}) ([]byte, error) {
    var buf bytes.Buffer
    enc := json.NewEncoder(&buf)
    if err := enc.Encode(v); err != nil { return nil, err }
    return buf.Bytes(), nil
}
```

```
BenchmarkBufferPerCall-8   500000   2800 ns/op   1280 B/op   5 allocs/op
```

<details><summary>After</summary>

Pool `*bytes.Buffer` across calls. The buffer's backing array survives between calls, growing once to a stable working size.

```go
var bufPool = sync.Pool{
    New: func() interface{} { return new(bytes.Buffer) },
}

func serialize(v interface{}) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)
    if err := json.NewEncoder(buf).Encode(v); err != nil { return nil, err }
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes()) // copy out before returning to pool
    return out, nil
}
```

```
BenchmarkPooledBuffer-8   1400000   850 ns/op   320 B/op   2 allocs/op
```

~3.3× faster, ~4× less garbage.

**Why faster:** `sync.Pool` keeps a per-P (per-processor) slot of recently-used buffers — `Get` is nearly free under steady-state load. The buffer's backing array survives `Reset` (which just sets `Len=0`), so the second call writes into the previously-grown space without `runtime.growslice`. The `Encoder` struct itself is light — pooling it too marginally helps.
**Trade-off:** Must copy the result before returning the buffer — otherwise the caller holds a slice aliasing pool memory that another goroutine will overwrite. The pool can grow unboundedly under burst load before GC shrinks it. Pooling buffers used for very different sizes (50 B and 5 MB) wastes memory: a small caller pulls the giant buffer; consider size-classed pools.
**When NOT:** Low-concurrency call sites where one allocation per call is fine. Code where the pool's lifetime exceeds the buffer's natural lifetime (long-lived buffers in a `sync.Pool` are GC'd at the next cycle — fine, but don't expect cache-line locality).
</details>

---

## 12. Exercise 11 — Marshal then `[]byte(string(...))` conversion → write bytes directly

A logger marshals a struct, then converts the result through `string(b)` for `log.Println`, then back to `[]byte` to write. Each conversion copies. Lazy reasoning: "I need a string for the API."

```go
func logEvent(e Event) {
    b, _ := json.Marshal(e)
    s := string(b) // copy
    log.Println(s) // log writer accepts string, converts back to []byte internally
}
```

```
BenchmarkMarshalStringRoundtrip-8   500000   2600 ns/op   320 B/op   5 allocs/op
```

<details><summary>After</summary>

Write the bytes directly to the log writer. `log.Logger.Output` and `io.Writer` both take `[]byte`.

```go
func logEvent(e Event) {
    b, _ := json.Marshal(e)
    b = append(b, '\n')
    log.Writer().Write(b)
}
```

```
BenchmarkMarshalBytesDirect-8   1200000   1100 ns/op   160 B/op   2 allocs/op
```

~2.4× faster, ~2× less garbage.

**Why faster:** `string([]byte)` allocates a fresh backing array and copies — the Go spec guarantees `string` is immutable so the conversion can't alias. Same for `[]byte(string)`. The "API requires a string" framing is usually wrong: most writer-side APIs accept either, or have a `[]byte` variant one level up. The compiler can elide some `string([]byte)` conversions in narrow contexts (`m[string(b)]`, `string(b) == ".."`) but not when the result escapes.
**Trade-off:** Manually appending `'\n'` invites format mistakes — wrap in a helper. Skipping `log.Println`'s formatting means losing the logger's prefix/flags — `log.Writer()` is the raw sink. For structured logging (zap, slog), use the library's `[]byte` or `json.RawMessage` accepter — most have one.
**When NOT:** APIs that genuinely need a string (`http.Header.Set`, map keys, error messages). Code already in a hot path where the doubled copy is dwarfed by I/O. One-shot debug logs where readability wins.
</details>

---

## 13. Exercise 12 — Encoding with default float format → custom marshaler with rounded representation

A market-data feed emits `Price` as `float64`. `json.Marshal` uses `strconv.AppendFloat(_, _, 'g', -1, 64)` which produces variable-length output (`12.34`, `12.3456789012`, `1.234e+5`). Clients parse longer strings; bandwidth grows.

```go
type Tick struct {
    Symbol string  `json:"symbol"`
    Price  float64 `json:"price"` // default format: 12.3456789012
}
```

```
BenchmarkDefaultFloat-8   3000000   380 ns/op   80 B/op   2 allocs/op  // ~38 B/wire
```

<details><summary>After</summary>

Custom marshaler that rounds to 4 decimals and writes a bounded string. Wire size shrinks; downstream parsers see fewer digits.

```go
type Price float64

func (p Price) MarshalJSON() ([]byte, error) {
    b := make([]byte, 0, 12)
    b = strconv.AppendFloat(b, float64(p), 'f', 4, 64) // fixed 4 decimals
    return b, nil
}

type Tick struct {
    Symbol string `json:"symbol"`
    Price  Price  `json:"price"`
}
```

```
BenchmarkRoundedFloat-8   5000000   210 ns/op   48 B/op   1 allocs/op
```

~1.8× faster, ~1.7× less garbage, ~30% smaller wire per tick.

**Why faster:** `strconv.AppendFloat` with format `'g'` and precision `-1` runs a shortest-decimal algorithm (Ryū) — fast but variable-output. Forcing format `'f'` with precision `4` is a simpler print path with a known buffer size. Downstream: clients parse 8 chars instead of up to 18 — `strconv.ParseFloat` is roughly linear in input length.
**Trade-off:** Lossy: `12.345678` becomes `12.3457` — unacceptable for accounting, fine for display. Round-trip Marshal/Unmarshal no longer preserves the original — surprise for testers. Custom type creates a type wall — `Price + Price` works but `Price + float64` needs a cast.
**When NOT:** Numbers requiring exact round-trip (financial settlement, scientific data). Code where the float's full precision is the contract. Cases where format `'g'` is already shortest — for `12.0`, both produce `"12"`.
</details>

---

## 14. Exercise 13 — Pre-warm the typeEncoder cache by calling Marshal once at init

`encoding/json` builds a `structEncoder` for each type the first time it's marshaled, then caches it in `encoderCache` (a `sync.Map`). The first call pays the build cost (reflection + slice of field encoders); every subsequent call hits the cache. For latency-sensitive endpoints, that first call hits the request path.

```go
type Response struct {
    ID   string `json:"id"`
    Data []Item `json:"data"`
    Meta Meta   `json:"meta"`
}

// Cold path: first request pays the typeEncoder build cost.
func handler(w http.ResponseWriter, r *http.Request) {
    json.NewEncoder(w).Encode(buildResp())
}
```

```
BenchmarkColdFirstCall-8       1   180000 ns/op   24000 B/op   320 allocs/op  // first ever
BenchmarkWarmSubsequent-8   200000   6200 ns/op   1024 B/op   8 allocs/op
```

<details><summary>After</summary>

`init` (or a startup hook) marshals each hot type once. The cache is warm before the first real request lands.

```go
func init() {
    // Warm the typeEncoder cache for hot types.
    json.Marshal(Response{})
    json.Marshal(Item{})
    json.Marshal(Meta{})
    json.Marshal(Request{})
}

func handler(w http.ResponseWriter, r *http.Request) {
    json.NewEncoder(w).Encode(buildResp()) // cache already warm
}
```

```
BenchmarkFirstCallAfterWarm-8   200000   6300 ns/op   1024 B/op   8 allocs/op
```

~28× faster first call (matches warm steady-state).

**Why faster:** `encoderCache.LoadOrStore` returns immediately on cache hit. The build step (`newTypeEncoder` → `typeFields` → `structEncoder`) walks every exported field via reflection, computes JSON names, sorts, builds a per-field encode function — work proportional to struct depth × field count. Warming pays this once at process start, off the request path.
**Trade-off:** `init` runs sequentially; warming 100 types adds startup time. Marshaling a zero-value struct may trip a custom `MarshalJSON` that doesn't handle zero — guard with a defer/recover or use a known-valid sample. Cache is per-process; container restarts re-pay the cost. For very dynamic schemas, warming becomes futile.
**When NOT:** Services with abundant warm-up traffic (rolling deploys behind LB health checks). Types serialized cold once per day — the win disappears. Code where deterministic startup time matters more than first-request latency.
</details>

---

## 15. Exercise 14 — `json.MarshalIndent` in prod → use Marshal; format only for debug

A handler returns `json.MarshalIndent(resp, "", "  ")` because "it's easier to read in browser dev tools." Indented output is ~30% larger and runs through an extra formatting pass.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    resp := buildResp()
    data, _ := json.MarshalIndent(resp, "", "  ")
    w.Header().Set("Content-Type", "application/json")
    w.Write(data)
}
```

```
BenchmarkMarshalIndent-8   30000   42000 ns/op   18000 B/op   12 allocs/op  // 12 KB indented
```

<details><summary>After</summary>

Use `json.Marshal` (or `Encoder.Encode`) in production. Add a `?pretty=1` query param that gates pretty-print for humans, or rely on `curl | jq` / browser dev tools to format on the consumer side.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    enc := json.NewEncoder(w)
    if r.URL.Query().Get("pretty") == "1" {
        enc.SetIndent("", "  ")
    }
    enc.Encode(buildResp())
}
```

```
BenchmarkMarshalCompact-8   140000   8200 ns/op   4096 B/op   2 allocs/op  // 8.5 KB compact
```

~5.1× faster, ~4.4× less garbage, ~30% smaller wire.

**Why faster:** `MarshalIndent` builds the compact form first, then re-walks it through `json.Indent` to insert whitespace — a full second pass over the bytes. Compact output skips that pass entirely. Network: 30% fewer bytes through the kernel, the LB, the client's TCP buffer. Browsers and `jq` format JSON on the client side at trivial cost — there's no need to pay for it on the server.
**Trade-off:** Gating pretty-print on a query param adds a code path; tests must cover both. Some HTTP debugging tools (older `curl`) display raw bytes and benefit from indentation server-side — fine for staging, not for prod. Logs that capture response bodies are noisier in compact form — pipe through `jq` at read time.
**When NOT:** Internal tooling that's strictly human-consumed (admin dashboards, debug endpoints). APIs explicitly documented to return pretty-printed JSON (rare, usually a mistake). Code where the formatting cost is a rounding error compared to upstream latency.
</details>

---

## 16. When NOT to optimize

`encoding/json` cost dominates only when serialization is on the hot path of a high-frequency operation. If your service does 100 req/sec on 2 KB payloads, every optimization here is irrelevant: admin endpoints, batch jobs that write JSON to disk once per hour, CLI tools that print one struct per invocation — the stdlib is more than fast enough.

**Profile first.** `encoding/json` overhead has four signatures in a CPU profile: `reflect.Value.Interface` and `reflect.PtrTo` on a hot stack → Ex. 3, 4, or 8; `runtime.mallocgc` from `bytes.Buffer.grow` or `encodeState.string` → Ex. 1, 10, or 11; `runtime.convT*` (interface boxing) per leaf → Ex. 3 or 4; `strconv.AppendFloat` / `strconv.Quote` dominating → Ex. 5, 9, or 12.

**Common premature optimizations:** codegen (Ex. 8) on types marshaled < 10k/sec; `RawMessage` (Ex. 7) when the schema is fully known and unchanging; `sync.Pool` for buffers (Ex. 10) in handlers serving < 100 req/sec; cache parsed JSON (Ex. 9) when payloads are unique per call; warming the type cache (Ex. 13) for an internal CLI tool.

**Correctness gaps disguised as optimizations:** returning underlying buffer bytes from a pool (Ex. 10) without copying — caller sees garbage on the next call; `omitempty` (Ex. 6) on a field where zero is meaningful — silently dropped on the wire; `RawMessage` (Ex. 7) keeping a giant body alive far past expected; custom float format (Ex. 12) violating an accounting contract; stream decoder (Ex. 2) without `http.MaxBytesReader` — unbounded body crashes the process; codegen (Ex. 8) drifting from the source struct; cached claims (Ex. 9) never invalidated on token revocation; `Encoder.Encode` (Ex. 1) emitting a newline a strict consumer rejects.

---

## 17. Summary

**Always-ship wins** (default in any new `encoding/json` code): `json.NewEncoder(w).Encode(v)` for HTTP responses (Ex. 1); `json.NewDecoder(r.Body).Decode(&v)` for HTTP requests (Ex. 2); typed structs for known schemas (Ex. 3, 4); `omitempty` on truly optional fields (Ex. 6); `json.RawMessage` for envelope/payload dispatch (Ex. 7); `json.Marshal` not `MarshalIndent` in prod (Ex. 14); cap request bodies with `http.MaxBytesReader`.

**Wins behind a profile** (when measurements justify them): custom `MarshalJSON` over `fmt`-then-Marshal (Ex. 5, when `fmt.pp` shows in profiles); codegen via easyjson/sonic (Ex. 8, when reflect plumbing dominates); parsed-result caching (Ex. 9, when the same payload parses repeatedly); `sync.Pool` for `bytes.Buffer` (Ex. 10, when `runtime.growslice` shows under load); write bytes not strings (Ex. 11, when `string([]byte)` round-trips show); rounded float format (Ex. 12, when wire size or downstream parse cost matters); type-cache warming (Ex. 13, when first-request latency is an SLO).

**Specialty** (only when the design calls for it): codegen plus `sync.Pool` plus pre-warm for trading/feed services emitting millions of messages/sec; size-classed buffer pools for handlers spanning two orders of magnitude in payload size; `json.RawMessage` plus per-type codegen for plugin systems that dispatch on type at the envelope; cached parsed claims with TTL and revocation hook for JWT-heavy gateways.

`encoding/json` cost is materialization, reflection, boxing, and round-trip conversions. Strip those four from the read and write paths by choosing the right primitive: `Encoder`/`Decoder` for streaming, typed structs for known schemas, `RawMessage` for deferred parsing, codegen for the hottest types only. The stdlib is fast enough for almost everything — the wins above are for the specific endpoints your profile actually flags. Measure, then pick the lever; the four signatures above tell you which one.
