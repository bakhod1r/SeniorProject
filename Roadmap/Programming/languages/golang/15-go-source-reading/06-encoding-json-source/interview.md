# encoding/json Source — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus a "what NOT to say" list and a 5-minute pre-interview checklist. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. `encoding/json` is a small package in surface area and a deep one in implementation taste: the interview signal is whether you can explain the reflection-driven type encoder cache, justify when to reach for `Decoder` vs `Unmarshal`, name a real DoS defence for untrusted input, and stay honest about the trade-offs that drove the v2 proposal.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is `encoding/json`?

**Short answer:** `encoding/json` is the Go standard library's JSON codec — it converts Go values to JSON bytes (`Marshal`) and JSON bytes to Go values (`Unmarshal`), plus streaming variants (`Encoder`/`Decoder`). It's reflection-based by default, so it works on arbitrary structs without code generation, and it honours struct tags (`json:"name,omitempty"`) for field naming and behaviour. The package ships in the stdlib, has been stable since Go 1.0, and is the de-facto JSON tool in Go even when faster alternatives exist.

```go
type User struct {
    ID    int64  `json:"id"`
    Email string `json:"email,omitempty"`
}

b, _ := json.Marshal(User{ID: 1, Email: "x@y.z"}) // {"id":1,"email":"x@y.z"}
var u User
_ = json.Unmarshal(b, &u)
```

**Follow-up:** Why is it reflection-based and not codegen? Answer: stdlib policy — no code generation step in `go build`, so the codec has to discover field layout at runtime via `reflect`. The cost is speed (5–10x slower than codegen libraries), the benefit is "just works on any struct".

---

### Q2. `Marshal` vs `Encoder.Encode` — when do you reach for each?

**Short answer:** `json.Marshal(v)` returns `([]byte, error)` — you get the complete encoded value in memory. `json.NewEncoder(w).Encode(v)` writes to an `io.Writer` and appends a trailing newline, useful for streaming multiple values to a connection or file. Reach for `Marshal` when you need the bytes (HTTP response body, log line, fixture), reach for `Encoder` when writing to a network/file stream where buffering one value at a time matters. Note the newline gotcha — `Encode` adds `\n`, `Marshal` does not, so they're not drop-in replacements when wire format matters.

```go
// One-shot — bytes in hand.
b, err := json.Marshal(payload)
w.Write(b)

// Stream — many values to a network connection.
enc := json.NewEncoder(conn)
for ev := range events {
    if err := enc.Encode(ev); err != nil { return err }
}
```

**Follow-up:** Performance difference? Answer: `Encoder` reuses an internal buffer across `Encode` calls, so encoding many values in a loop is cheaper than `Marshal` in a loop. For one-shot encoding the difference is noise.

---

### Q3. Why use struct tags?

**Short answer:** Struct tags tell `encoding/json` how to map Go field names to JSON keys and how to handle special cases. `json:"name"` renames the field on the wire; `json:"name,omitempty"` omits zero-value fields; `json:"-"` excludes the field entirely; `json:",string"` forces numeric encoding as a JSON string for languages with precision issues. Without tags, exported fields use their Go name verbatim (`FirstName` becomes `"FirstName"`, not the conventional `"first_name"`). Tags are the only place to put per-field codec hints — there's no global config.

```go
type Account struct {
    ID        uint64 `json:"id,string"`       // emitted as "9007199254740993"
    Username  string `json:"username"`        // renamed
    Internal  string `json:"-"`               // never emitted
    Avatar    string `json:"avatar,omitempty"`// dropped when ""
}
```

**Follow-up:** Are tags validated at compile time? Answer: no — they're string literals, malformed tags fail silently at runtime (field gets default behaviour). Use `go vet` or staticcheck to catch the common typos.

---

### Q4. What does `omitempty` actually do?

**Short answer:** `omitempty` skips the field during encoding if it holds the **zero value** for its type — `false` for bool, `0` for numerics, `""` for string, `nil` for pointer/interface/slice/map/chan/func, length-zero for slice/map. The semantics are checked by `isEmptyValue` in the encoder, which is a fixed list — there's no "empty" hook you can extend. The common gotcha: `time.Time{}` is *not* considered empty by `omitempty`, because its zero value is a struct and the check doesn't recurse into struct fields; you need a `*time.Time` or a custom marshaller to drop it.

```go
type Event struct {
    At    time.Time `json:"at,omitempty"`   // still emitted when zero (struct gotcha)
    Tags  []string  `json:"tags,omitempty"` // dropped when len(Tags)==0
    Owner *User     `json:"owner,omitempty"`// dropped when nil
}
```

**Follow-up:** Distinguishing "not set" from "set to zero"? Answer: use a pointer type. `Age int` with `omitempty` drops both "not set" and "set to 0" — they're indistinguishable. `Age *int` with `omitempty` drops only `nil`; a pointer to `0` survives.

---

### Q5. Difference between `Decoder` and `Unmarshal`?

**Short answer:** `json.Unmarshal(data, &v)` takes a `[]byte` and decodes one value — you must have the whole input in memory. `json.NewDecoder(r).Decode(&v)` reads from an `io.Reader` and decodes one value at a time, so you can stream a sequence of JSON values or save memory on large inputs. `Decoder` also exposes `Token()` for incremental parsing and `More()` for stream loops. Default settings differ: `Decoder` accepts trailing garbage (you get one value, the rest stays in the reader); `Unmarshal` rejects trailing non-whitespace. Use `DisallowUnknownFields()` on `Decoder` to harden APIs against typos in untrusted input.

```go
// NDJSON consumer — one Decode per line, no manual splitting needed.
dec := json.NewDecoder(rd)
for {
    var ev Event
    if err := dec.Decode(&ev); err == io.EOF { break } else if err != nil { return err }
    handle(ev)
}
```

**Follow-up:** Can `Decoder` read multiple JSON objects from a single stream? Answer: yes — call `Decode` repeatedly, each call consumes one top-level value. This is how you parse NDJSON (newline-delimited JSON) cleanly. `Unmarshal` cannot do this without manual splitting.

---

## 3. Middle questions (Q6–Q12)

### Q6. Walk through what happens when you call `Marshal(myStruct)`.

**Short answer:** Four phases. (1) **Reflect on the type** — `reflect.TypeOf(v)` gives the concrete type; the encoder looks up or builds an encoder function for it. (2) **Type encoder cache** — `typeEncoder` returns a cached `encoderFunc` keyed by `reflect.Type`, built once per type per program. For a struct, this means walking fields, parsing tags, deciding `omitempty`/`string`/skip, and assembling a struct encoder that calls per-field encoders. (3) **Execute** — the encoder function writes to an `encodeState` buffer, recursing into fields, slices, maps, pointers. (4) **Return** — the buffer's contents become the returned `[]byte`. Reflection happens once per type (cached); subsequent calls reuse the prebuilt encoder, which still uses `reflect.Value` accessors but avoids the type analysis cost.

```go
// Sketch of the inner loop — what the stdlib does in encode.go.
func typeEncoder(t reflect.Type) encoderFunc {
    if fi, ok := encoderCache.Load(t); ok { return fi.(encoderFunc) }
    f := newTypeEncoder(t, true)        // builds struct/slice/map/etc. encoder
    encoderCache.Store(t, f)
    return f
}
```

**Follow-up:** Where is the cache stored? Answer: `var encoderCache sync.Map` in `encode.go`. It's process-global, never evicted; types are kept alive forever, which is fine because Go programs don't dynamically create types in practice.

---

### Q7. What is `typeEncoder` and how does the cache work?

**Short answer:** `typeEncoder(t reflect.Type) encoderFunc` returns the cached encoder function for type `t`, building one if absent. The cache is a `sync.Map` keyed by `reflect.Type`. The build step walks the type: structs get `structEncoder` (compiled field list), slices get `sliceEncoder`, maps get `mapEncoder`, pointers get `condAddrEncoder`, and so on. For recursive types (`type Node struct{ Children []*Node }`), the code uses an indirection trick — it stores a placeholder during construction so a self-reference resolves to "the encoder we're currently building" without an infinite loop. The pattern is `sync.WaitGroup` + the partially-built encoder published behind a mutex; once the build completes, the placeholder is replaced.

**Follow-up:** Why `sync.Map` instead of a regular map plus mutex? Answer: read-heavy workload — once warm, the cache is almost entirely reads. `sync.Map` is optimised for this pattern (read path is lock-free after the first hit). The same shape appears in `encoding/gob` and `reflect` itself.

---

### Q8. Why are reflective marshallers slow?

**Short answer:** Three costs add up. (1) **Reflection itself** — `reflect.Value.Field(i)`, `Interface()`, and `Kind()` are slow compared to direct field access; each call goes through a type descriptor and may allocate. (2) **Interface boxing** — every field value passes through `interface{}` (now `any`), which heap-allocates small values like ints. (3) **Branch density** — the encoder switches on `Kind()` at every level, defeating branch prediction. Codegen libraries (`easyjson`, `ffjson`) generate per-type `MarshalJSON` methods that read fields directly with no reflection, no boxing, and predictable branches — typically 5–10x faster, sometimes more. `encoding/json/v2` keeps reflection but compiles a tighter per-type "marshaller program" to reduce the per-call overhead.

```
(pprof) top
   flat  flat%   sum%        cum   cum%
 1.43s 18.1% 18.1%      1.43s 18.1%  reflect.Value.Interface
 0.92s 11.6% 29.7%      4.10s 51.9%  encoding/json.(*encodeState).reflectValue
 0.71s  9.0% 38.7%      0.71s  9.0%  runtime.mallocgc
```

**Follow-up:** Profile data — what shows up at the top? Answer: `reflect.Value.Interface`, `reflect.Value.MethodByName`, `runtime.mallocgc` (small allocations), and `encoding/json.(*encodeState).reflectValue`. The fix isn't tweaks; it's switching to codegen or v2.

---

### Q9. How does `omitempty` distinguish zero from nil for different kinds?

**Short answer:** `isEmptyValue(v reflect.Value)` in `encode.go` switches on `v.Kind()`:

| Kind | "Empty" means |
|------|---------------|
| Bool | `false` |
| Int*, Uint*, Float* | `0` |
| String | `""` |
| Array, Map, Slice, String | `Len() == 0` |
| Interface, Pointer | `IsNil()` |

So for `[]int`, both `nil` and `[]int{}` are "empty" (both have length 0). For `*int`, only `nil` is empty — a pointer to `0` survives. For `struct{}`, the check doesn't recurse; struct values are never considered empty, which is the `time.Time` gotcha. The function is intentionally narrow because "what's empty" is genuinely ambiguous for structs and the stdlib refuses to guess.

**Follow-up:** How do you make a struct field omit when it's zero? Answer: implement `MarshalJSON` returning `nil, nil` for zero (encoder writes `null`) — or wrap in `*T` and use `omitempty` — or use a custom `,omitzero` proposal which v2 finally adds.

---

### Q10. What is `json.RawMessage` and when do you use it?

**Short answer:** `json.RawMessage` is `[]byte` with `MarshalJSON`/`UnmarshalJSON` that pass the bytes through verbatim — the encoder writes them as-is, the decoder stores the raw JSON without parsing. Use cases: (a) **lazy decoding** — keep a polymorphic field as raw bytes, parse it later once you know the concrete type (`Kind` discriminator pattern); (b) **pass-through proxies** — a service that forwards a JSON blob without inspecting it; (c) **embedded JSON in another structure** — `type Event struct { Kind string; Payload json.RawMessage }`. The bytes must be valid JSON or the outer Marshal will fail validation on emit. `RawMessage` is one of the most underused tools in the stdlib for polymorphic decoding done right.

```go
type Envelope struct {
    Kind    string          `json:"kind"`
    Payload json.RawMessage `json:"payload"`
}

func dispatch(b []byte) error {
    var env Envelope
    if err := json.Unmarshal(b, &env); err != nil { return err }
    switch env.Kind {
    case "click":
        var c ClickEvent
        return json.Unmarshal(env.Payload, &c)
    case "purchase":
        var p PurchaseEvent
        return json.Unmarshal(env.Payload, &p)
    }
    return fmt.Errorf("unknown kind %q", env.Kind)
}
```

**Follow-up:** Why not just use `string` or `[]byte`? Answer: `[]byte` is base64-encoded by default in JSON (the encoder treats `[]byte` specially as binary). `RawMessage` overrides that with custom Marshal/Unmarshal — the bytes are emitted as JSON, not as base64.

---

### Q11. When use `json.Number` instead of `float64`?

**Short answer:** `json.Number` is a string-backed numeric type that preserves the exact textual form of a JSON number — useful when (a) the value exceeds `float64` precision (`int64` IDs above `2^53` lose precision when round-tripped through `float64`), (b) you need to preserve trailing zeros or original formatting, (c) you want to defer the int-vs-float decision until you know the target. Enable it on a decoder with `dec.UseNumber()`; then numbers decode into `json.Number` (a `string` alias) instead of `float64`. Convert with `Int64()`, `Float64()`, or `String()` when you know what the value should be.

```go
dec := json.NewDecoder(strings.NewReader(`{"id": 9007199254740993}`))
dec.UseNumber()
var m map[string]any
_ = dec.Decode(&m)
id, _ := m["id"].(json.Number).Int64() // 9007199254740993 — exact
```

**Follow-up:** What goes wrong without `UseNumber` for a `uint64` ID? Answer: JSON parses it into `float64`; values above `2^53` are silently rounded. A user ID like `9007199254740993` becomes `9007199254740992`. The bug is silent and irreversible — `UseNumber` is the only stdlib fix.

---

### Q12. How do `Marshaler` and `Unmarshaler` work?

**Short answer:** Two interfaces let a type customise its own JSON form. `MarshalJSON() ([]byte, error)` is called by the encoder when present — the returned bytes must be valid JSON and are spliced into the output verbatim. `UnmarshalJSON(data []byte) error` is called by the decoder — `data` is the raw JSON for this value (whitespace-trimmed, but otherwise unparsed), and the method is responsible for populating the receiver. The encoder detects these interfaces via type assertion before falling back to reflection; this is the official extension point for non-trivial types (`time.Time`, `big.Int`, custom enums).

```go
type Color struct{ R, G, B uint8 }

func (c Color) MarshalJSON() ([]byte, error) {
    return []byte(fmt.Sprintf(`"#%02X%02X%02X"`, c.R, c.G, c.B)), nil
}

func (c *Color) UnmarshalJSON(data []byte) error {
    var s string
    if err := json.Unmarshal(data, &s); err != nil { return err }
    _, err := fmt.Sscanf(s, "#%02X%02X%02X", &c.R, &c.G, &c.B)
    return err
}
```

**Follow-up:** Value receiver vs pointer receiver — does it matter? Answer: yes. `MarshalJSON` on a value receiver works for both `T` and `*T`. `UnmarshalJSON` must be on a pointer receiver because it mutates; if you put it on a value receiver, the decoder calls a no-op copy and nothing happens.

---

## 4. Senior questions (Q13–Q20)

### Q13. You're profiling a JSON-heavy service. Where do you look first?

**Short answer:** Five hotspots, in order. (1) **CPU profile (`pprof`)** — look for `reflect.Value.Interface`, `encoding/json.(*encodeState).reflectValue`, `mallocgc`. If those dominate, the codec itself is the bottleneck. (2) **Allocation profile** — `Marshal` allocates the entire output buffer; `Encoder.Encode` reuses a buffer across calls. Switching to `Encoder` for write-heavy paths can cut allocs by 30–50%. (3) **Decode-side `Decoder` vs `Unmarshal`** — `Unmarshal` copies the input; `Decoder` doesn't necessarily. For multi-MB payloads, switching matters. (4) **Tag waste** — fields tagged but never present on the wire still cost reflection on encode. Audit struct definitions against actual payloads. (5) **Schema mismatch** — `map[string]any` decode is 5–10x slower than a typed struct because every value goes through `interface{}` boxing. Always decode into a typed struct when the schema is known. Once you've squeezed the stdlib codec, drop to `easyjson` or `sonic` for the remaining hot paths.

```go
// Concrete wins from the four steps above on a typical service.
// Before: 12k req/s, 38% CPU in encoding/json, p99=42ms
// (1) Encoder reuse for writes        → 30% fewer allocs on the hot path
// (2) Typed structs instead of any    → 5x faster decode
// (3) DisallowUnknownFields           → silently dropped bugs surface
// (4) Hot type via easyjson           → 4x faster encode on that path
// After:  21k req/s, 18% CPU in JSON, p99=22ms
```

**Follow-up:** When does `easyjson` or `sonic` not help? Answer: when JSON isn't the bottleneck — your slow service might be the database, the downstream API, or GC pressure unrelated to JSON. Profile first; switching codecs without evidence is cargo culting.

---

### Q14. Compare `easyjson`, `sonic`, and `encoding/json`.

**Short answer:**

| Library | Approach | Speed vs stdlib | Cost |
|---------|----------|------------------|------|
| `encoding/json` | Reflection + cached type encoders | 1x (baseline) | None — stdlib |
| `easyjson` (mailru) | `go generate` codegen per type | 4–6x faster encode, 3–5x decode | Generated files in repo, regen on schema change |
| `sonic` (bytedance) | JIT-compiled per-type encoders + SIMD parsing | 8–15x faster, sometimes 20x | CGo-free but amd64/arm64 only, larger binary, less mature |
| `json-iterator/go` | Reflection but with a tighter per-type code path | 2–3x faster | Drop-in API compatibility, smaller binary impact |

Pick by constraint: stdlib for "just works"; `json-iterator` for a free 2x with one import change; `easyjson` for predictable codegen wins on a stable schema; `sonic` for absolute peak performance on supported architectures. Read each library's benchmarks against *your* payload — the speedups vary wildly by schema shape (deeply nested vs flat, small vs large strings, lots of numbers vs lots of strings).

**Follow-up:** Why isn't sonic's approach in the stdlib? Answer: JIT means runtime code generation, which conflicts with Go's static binary model and security stance (no executable heap pages by default). The stdlib can't ship a JIT; `sonic` accepts the trade by relying on architecture-specific machine code generation. `encoding/json/v2` is the stdlib's answer — same model as v1 but with a faster compiled per-type marshaller.

---

### Q15. Stream a 1GB JSON file via `Decoder`. What's the pattern?

**Short answer:** Don't decode the whole array into memory — use `Decoder.Token()` to advance past the opening `[`, then loop with `Decode` for each element. The pattern:

```go
func StreamArray(r io.Reader, handle func(json.RawMessage) error) error {
    dec := json.NewDecoder(r)
    // Expect opening '['
    t, err := dec.Token()
    if err != nil { return err }
    if d, ok := t.(json.Delim); !ok || d != '[' {
        return fmt.Errorf("expected array, got %v", t)
    }
    for dec.More() {
        var raw json.RawMessage
        if err := dec.Decode(&raw); err != nil { return err }
        if err := handle(raw); err != nil { return err }
    }
    // Consume closing ']'
    _, err = dec.Token()
    return err
}
```

Senior moves: (a) `Token()` for the structural delimiters, `Decode` for the element values — mixing the two APIs is the key to streaming an array; (b) `RawMessage` so each element is opaque bytes until the caller decodes it (lets you skip elements without paying their parse cost); (c) `dec.More()` is the loop condition — it returns false at the closing `]`; (d) bound memory by the largest single element, not the file size; (e) wrap with `bufio.NewReaderSize(r, 1<<20)` for IO efficiency on real disks.

**Follow-up:** What if the file is NDJSON (one object per line, no enclosing array)? Answer: drop the bracket handling — just call `Decode` in a loop until `io.EOF`. `Decoder` handles NDJSON natively because each call consumes one top-level value.

---

### Q16. How do you validate decoded JSON against a schema?

**Short answer:** Three levels. (1) **Structural** — decode into a typed struct; missing fields are zero-valued, extra fields silently dropped. Add `dec.DisallowUnknownFields()` to fail on unexpected keys, useful for tight APIs. (2) **Field-level** — implement `Validate() error` on the struct and call it after `Decode`; checks like "Age >= 0", "Email matches regex", "Status in {active, deleted}" live there. Some teams use struct tags + a validator library (`go-playground/validator`) to declare these inline. (3) **JSON Schema** — for cross-language schemas or generated docs, libraries like `santhosh-tekuri/jsonschema` validate against a JSON Schema document. Heavier, but the schema becomes the source of truth and you can publish it. The right level depends on whether the schema is internal (1+2 suffices) or contractual with external consumers (3 is worth the cost).

**Follow-up:** Why not use struct tags for all validation? Answer: tags are strings, no compile-time checking, the validation lives far from the type definition, and complex constraints (cross-field invariants, conditional requirements) don't fit in a tag. `Validate()` is verbose but explicit; tag-based is concise but lies easily.

---

### Q17. JavaScript's number type loses precision above `2^53`. How do you handle a `uint64` ID?

**Short answer:** Three approaches, ordered by robustness. (1) **Encode as a JSON string** — add `json:",string"` to the field; the encoder writes `"9007199254740993"`, the decoder accepts both string and number forms. JavaScript receives a string and uses `BigInt(s)` or stays in string form. This is the standard fix for IDs crossing a JS boundary. (2) **Use `json.Number` on decode** — on the Go side, `dec.UseNumber()` preserves the exact text; convert with `Int64()` when consuming. Doesn't help JavaScript, but prevents Go-side rounding when bouncing through `map[string]any`. (3) **Schema discipline** — establish at the API layer that IDs are always strings, never numbers, and enforce in code review or schema validation. The combination of (1) for encode and (3) for the contract is what production APIs end up doing.

**Follow-up:** Doesn't `,string` break old JSON consumers that expect a number? Answer: yes, it's a breaking change for the wire format. Roll it out behind a new endpoint or version; don't flip an existing field.

---

### Q18. Build a custom type that marshals to a special form.

**Short answer:** Implement `MarshalJSON`/`UnmarshalJSON` on the type. Example: a `Duration` that round-trips as `"5m30s"` instead of nanoseconds.

```go
type Duration time.Duration

func (d Duration) MarshalJSON() ([]byte, error) {
    return []byte(strconv.Quote(time.Duration(d).String())), nil
}

func (d *Duration) UnmarshalJSON(data []byte) error {
    var s string
    if err := json.Unmarshal(data, &s); err != nil { return err }
    parsed, err := time.ParseDuration(s)
    if err != nil { return err }
    *d = Duration(parsed)
    return nil
}
```

Senior moves: (a) `MarshalJSON` returns the JSON-encoded string (note `strconv.Quote` for the surrounding quotes — emitting bare `5m30s` would be invalid JSON); (b) `UnmarshalJSON` delegates to the stdlib to parse the JSON string first, then to `time.ParseDuration` for the domain parse; (c) pointer receiver on `UnmarshalJSON` is mandatory; (d) accept multiple wire forms (e.g. number nanoseconds *and* string `"5m"`) by peeking at the first byte of `data` and branching.

**Follow-up:** What if you also need YAML and TOML support? Answer: implement the equivalent interfaces (`MarshalYAML`, `MarshalText`). `encoding.TextMarshaler` is honoured by both `encoding/json` and many other codecs as a fallback — implementing it once gets you JSON, XML attribute encoding, and other text-based codecs for free.

---

### Q19. DoS protection for untrusted JSON — what are the attack surfaces?

**Short answer:** Five attack vectors and their defences.

1. **Memory blow-up** — a 10MB JSON of `[[[...]]]` decodes into a small Go value but allocates intermediate buffers proportional to depth. Cap input size with `io.LimitReader(r, maxBytes)` *before* the decoder sees it.
2. **Deep nesting → stack overflow** — `encoding/json` panics on extreme depth (around 10k nested levels). For untrusted input, pre-scan with a depth counter or use a parser that rejects beyond a safe limit. v2 adds explicit depth control; v1 doesn't.
3. **Hash flooding via large maps** — adversarial keys hashing to the same bucket degrade map operations to O(n). Go's runtime randomizes the hash seed per process, mitigating this; still, cap the number of keys per object you'll accept.
4. **Duplicate keys** — JSON allows them, `encoding/json` accepts the last value silently. For security-sensitive payloads (auth tokens, billing), this enables ambiguity attacks (CVE-2017-12635 in CouchDB). Use a custom parser or `dec.DisallowUnknownFields` plus a strict schema that flags duplicates.
5. **Unicode escapes / character set tricks** — surrogate pair edge cases, overlong UTF-8 sequences, embedded NULs. `encoding/json` handles standard cases but doesn't normalise; if you compare JSON strings to allowlists, normalise to NFC first.

The package-level fix is hardening at the parser boundary: `io.LimitReader`, `DisallowUnknownFields`, schema validation, and depth caps. Don't trust user input through the codec alone.

```go
func DecodeSafe(r io.Reader, max int64, v any) error {
    lr := io.LimitReader(r, max)
    dec := json.NewDecoder(lr)
    dec.DisallowUnknownFields()
    if err := dec.Decode(v); err != nil { return err }
    // Reject trailing junk and partial reads up to the limit.
    if _, err := dec.Token(); err != io.EOF { return errors.New("trailing data") }
    return nil
}
```

**Follow-up:** How big a depth limit is safe? Answer: 100–1000 levels is more than legitimate APIs use and stops the stack-blowup attack. Anything claiming deeper nesting is either pathological or recursive data that should be stored differently.

---

### Q20. Forward-compatible schema design — what's the discipline?

**Short answer:** Six rules for JSON APIs that need to evolve without breaking clients. (1) **Never remove a field** — clients may depend on it; deprecate first, mark in docs, remove only after a long sunset. (2) **Add new fields without `omitempty`** when they have a meaningful zero (`Visible: false` is information); use `omitempty` only when "absent" and "zero" are equivalent for consumers. (3) **Pointer-or-omitempty for tristate** — `Visible *bool` with `omitempty` distinguishes "true", "false", and "not specified"; flat `bool` cannot. (4) **Tag versioning explicitly** — embed `Version int` on root payloads so consumers know which schema they're parsing; old consumers fall through to defaults, new consumers branch on version. (5) **Discriminated unions over polymorphism** — `Kind string` + `Payload json.RawMessage` is forward-compatible (new kinds appear as unknown kinds, gracefully ignored); inheritance-style polymorphism breaks the day you add a subtype. (6) **Reserve the schema** — publish a JSON Schema document alongside the API; treat schema additions as part of the API contract.

```go
// Forward-compatible event payload.
type Event struct {
    Version int             `json:"version"`         // schema discriminator
    Kind    string          `json:"kind"`            // event kind discriminator
    Payload json.RawMessage `json:"payload"`         // opaque until kind is known
    Tags    []string        `json:"tags,omitempty"`  // additive field
    Hidden  *bool           `json:"hidden,omitempty"`// tristate flag
}
```

**Follow-up:** How do you handle removing a field for real? Answer: announce deprecation, log usage on the server, wait until usage drops, then remove. For SaaS APIs, this is months; for internal microservices, days. Hard-removing a field without a deprecation window is how production outages happen.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. Critique `encoding/json`'s design vs `json-iterator/go`.

**Short answer:** `encoding/json` optimises for stability and "works on any struct"; `json-iterator/go` optimises for speed while keeping the same API. Three design contrasts. (1) **Hot path locality** — stdlib's encoder builds an `encoderFunc` per type but then executes through several layers of `reflect.Value` indirection; `jsoniter` flattens the hot path with direct field access via `unsafe.Pointer` arithmetic, avoiding `reflect.Value` allocation per field. The cost is a deeper reliance on `unsafe`, which the stdlib won't accept. (2) **API extension model** — stdlib's only extension points are `Marshaler`/`Unmarshaler` interfaces. `jsoniter` adds plugins (custom encoders/decoders per type at runtime registered globally), more powerful but introduces global state that's hard to reason about. (3) **Error message quality** — stdlib's `UnmarshalTypeError` is precise (field path, expected type, actual JSON token); `jsoniter`'s messages historically lagged, though they've improved. Staff perspective: stdlib's conservatism is the right call for the stdlib (stability beats speed in a package used by every Go program); `jsoniter` is the right call when you've measured and need the speed without committing to codegen.

```go
// jsoniter — drop-in replacement, often 2-3x faster with one import swap.
import jsoniter "github.com/json-iterator/go"
var json = jsoniter.ConfigCompatibleWithStandardLibrary

b, err := json.Marshal(v)        // same signature as encoding/json
err = json.Unmarshal(data, &v)
```

**Follow-up:** Why does the Go team not just absorb `jsoniter`? Answer: API surface compatibility is harder than it looks (subtle behaviour differences in numeric handling, error types, escape sequences), and the `unsafe` reliance is incompatible with stdlib hygiene. v2 is the Go team's answer — same conservative model, much faster.

---

### Q22. Discuss the `encoding/json/v2` proposal.

**Short answer:** `encoding/json/v2` (proposal #71497, accepted, available as `GOEXPERIMENT=jsonv2` in Go 1.24+) is a major redesign aimed at correctness and performance gains without breaking v1. Key changes. (1) **`MarshalEncode`/`UnmarshalDecode` low-level API** — operate on a token stream, letting callers compose encoders without a final buffer. (2) **Per-call options** — `Marshal(v, json.Deterministic(true))`, `json.RejectUnknownMembers(true)`; behaviour configured per call, not per type. (3) **`omitzero` tag option** — finally distinguishes "field is its type's zero value" from "field's `IsZero()` returns true" or "field is empty"; the `time.Time` gotcha is fixed. (4) **`MarshalJSONTo(enc *jsontext.Encoder)` / `UnmarshalJSONFrom`** — new interfaces that operate on the token stream, avoiding the buffer-then-emit pattern of v1's `MarshalJSON`. (5) **Strict mode by default** — duplicate keys, invalid UTF-8, and unknown members can be opted into errors at decode time without external wrappers. (6) **Performance** — early benchmarks show 1.5–3x faster than v1 with the same reflection-based model, closing much of the gap to codegen libraries. Staff move: v2 is additive (v1 stays for compatibility), so projects can migrate per-package. The big-picture lesson: a decade of `encoding/json` use surfaced concrete pain points (omitempty semantics, polymorphic decode, performance, strict-mode options), and v2 is the Go team's accumulated response.

```go
// v2 sketch — per-call options + omitzero tag.
import "encoding/json/v2"

type Event struct {
    At    time.Time `json:"at,omitzero"` // finally drops zero structs
    Tags  []string  `json:"tags,omitempty"`
}

b, _ := json.Marshal(Event{}, json.Deterministic(true)) // sorted keys, per call
```

**Follow-up:** Should you migrate now? Answer: for new code in Go 1.24+, yes — the API is cleaner. For existing code, wait until v2 is stable and migrate hot paths first. Don't rush an API-surface change for a 2x speed win that may not affect your service.

---

### Q23. When would you write your own JSON parser?

**Short answer:** Four scenarios. (1) **Extreme performance on a narrow schema** — a parser specialised to one schema (no general JSON support) can outperform `sonic` by another 2–5x; e.g. a financial firm parsing market-data JSON where each field's offset is known. The cost is total rigidity. (2) **Streaming with semantic interruption** — pause parse mid-document, emit a partial result, resume — neither stdlib nor third-party JSON libraries support this cleanly. (3) **Custom validation woven into parsing** — reject a document at the first invalid field without finishing parse, when finishing is expensive. (4) **Non-standard variants** — JSON5, JSONC (with comments), HJSON, BSON-like extensions; none of these are JSON, and trying to bend `encoding/json` to handle them is worse than writing a small custom parser. Staff move: 99% of the time you should not write a JSON parser. Use stdlib; if slow, switch to `easyjson` or `sonic`; if still slow, profile and find the real bottleneck (likely not the codec). Custom parsers are months of work and a maintenance liability; the bar to clear is "all faster options have been exhausted and the speed-up justifies the headcount".

**Follow-up:** Examples of teams that did write one? Answer: JetStream/NATS for low-latency control messages, certain HFT firms for market-data feeds, the Caddy team's JSON5-with-extensions config layer. All have specific reasons; none of them recommend the path.

---

### Q24. Compare to Rust's `serde`.

**Short answer:** `serde` and `encoding/json` solve the same problem with opposite mechanics. **`serde`** is compile-time codegen via Rust's macro system: `#[derive(Serialize, Deserialize)]` generates per-type marshallers at build time, with no runtime reflection. Performance is on par with hand-written code; correctness is checked by the compiler. **`encoding/json`** is runtime reflection over `reflect.Type` with a cache; performance is 5–10x slower than codegen, but no build step is required. The trade reflects each language's philosophy: Rust embraces compile-time generation (macros are first-class), Go avoids it (no macros, codegen is opt-in via `go generate`). What `serde` does better: speed (it's roughly as fast as `sonic`), type-driven schema (the type system *is* the schema), and zero-cost abstraction (free abstractions, since they compile away). What `encoding/json` does better: simplicity (one function call, no derives), reflectivity (works on dynamically-typed values without codegen), and stdlib stability (no version pinning). v2 narrows the speed gap but the codegen-vs-reflection divide is structural and won't fully close.

**Follow-up:** Could Go ship something `serde`-like? Answer: only with macros, which the Go team has long refused. The closest is `go generate` + a tool like `easyjson` — codegen as an explicit pre-build step, opted into per project. v2's compiled-per-type encoder is the spiritual halfway: still reflection-driven, but the per-type encoder is closer to compiled code than v1's was.

---

### Q25. Trade-off of reflection-based vs codegen.

**Short answer:** Six axes to weigh.

| Axis | Reflection (`encoding/json`) | Codegen (`easyjson`) |
|------|-----------------------------|----------------------|
| **Speed** | 1x baseline | 4–10x faster |
| **Memory / allocs** | Higher; interface boxing per field | Lower; direct field access |
| **Binary size** | Small (one decoder) | Larger (per-type code) |
| **Build complexity** | None | `go generate` step in CI |
| **Type changes** | Just edit the struct | Edit struct + regen |
| **Debuggability** | Step into stdlib, well-known | Step into generated code, sometimes opaque |
| **First-time correctness** | Bugs in reflection are stdlib bugs (rare) | Bugs in generated code are project bugs (more common) |

Staff move: choose by *workload* and *team*. Default to reflection because most services are not JSON-bound, the speed loss is rarely the production bottleneck, and the maintenance overhead of codegen is real (forget to regen → silent staleness). Switch to codegen when (a) JSON is provably the bottleneck under load, (b) the schema changes rarely, (c) the team has CI discipline to regen automatically. The middle path — `jsoniter` or v2 — gets 2–3x for free without touching build pipelines, and is the right answer most of the time. Codegen for "just in case" is gold-plating; reach for it once data justifies it.

```go
//go:generate easyjson -all hot_types.go

// HotType has generated MarshalJSON/UnmarshalJSON in hot_types_easyjson.go.
// ColdType has no generated code; encoding/json falls back to reflection.
// Same Marshal/Unmarshal call site for both — easyjson's methods are picked
// up via the Marshaler interface, no API change required at call sites.
```

**Follow-up:** Hybrid possible? Answer: yes. Use codegen for hot types (high-volume payloads), reflection for cold types (admin endpoints, debugging). The codec libraries respect this — `easyjson` generates per-type `MarshalJSON`, which `encoding/json` honours automatically; types without generated code fall back to reflection. Mix freely; the cost is just remembering which is which.

---

## 6. What NOT to say

Phrases that broadcast "I haven't read the source" or "I've never run this in production".

- **"`json.Marshal` is fast enough."** Sometimes true, sometimes catastrophically wrong. Don't generalise without profile data; show that you'd measure first.
- **"Use `map[string]interface{}` to be flexible."** Throws away static typing, makes the code 5–10x slower, and pushes type assertions to every consumer. A typed struct with `json.RawMessage` for polymorphic fields is almost always better.
- **"Just use `easyjson` everywhere."** Codegen overhead and binary bloat are real; recommending it as default ignores the trade-off.
- **"`omitempty` skips zero structs."** It doesn't — `time.Time{}` survives `omitempty`. Demonstrates lack of hands-on experience.
- **"JSON Numbers are always floats."** Spec says numbers, not floats. Production Go decodes into `float64` by default, but `json.Number` exists for a reason; mis-stating this masks the `2^53` precision bug.
- **"`encoding/json` is thread-safe so we just share the Decoder."** Marshal/Unmarshal are safe on independent values, but a single `Decoder` is *not* safe for concurrent use — it has internal state. Confusing the two leaks into real bugs.
- **"Just turn off `DisallowUnknownFields` for compatibility."** It defaults off. Recommending to disable a hardening flag that isn't on suggests you've never used it.
- **"Custom `MarshalJSON` for performance."** No — custom `MarshalJSON` is slower than reflection (you build a string, the encoder validates it). Custom marshallers are for *form*, not speed.
- **"Streaming with `Unmarshal`."** `Unmarshal` requires the whole input; you can't stream with it. Streaming means `Decoder`, full stop.
- **"`json.RawMessage` is unsafe."** It validates on emit, holds raw JSON on decode — perfectly safe and the right tool for polymorphic schemas. Calling it unsafe shows you haven't read the docs.
- **"Just write your own parser, JSON isn't that complex."** It is — Unicode escapes, surrogate pairs, number edge cases, depth limits, duplicate keys. Custom parsers are a year of bugs; stdlib has had two decades of bug fixes.

---

## 7. 5-minute pre-interview checklist

Run through this list out loud the morning of the interview. If any item stumps you, re-read the matching question above.

1. **One-liner for `encoding/json`.** "Reflection-based JSON codec in the stdlib, with `Encoder`/`Decoder` for streams and `Marshal`/`Unmarshal` for one-shot."
2. **Marshal vs Encode.** `Marshal` returns bytes; `Encode` writes to an `io.Writer` and appends a newline. Use `Encoder` for streams.
3. **`omitempty` for `time.Time`.** Doesn't work — struct zeros aren't "empty". Use `*time.Time` or a custom marshaller, or wait for v2's `omitzero`.
4. **`Decoder.DisallowUnknownFields()`.** Strict-mode flag for untrusted input; fails on unexpected keys.
5. **Type encoder cache.** `sync.Map` keyed by `reflect.Type`, built once per type per process, shared across goroutines.
6. **Why reflection is slow.** `reflect.Value.Interface` allocates, switch-on-Kind defeats branch prediction, interface boxing for small types.
7. **`RawMessage` use case.** Lazy / polymorphic decoding. Hold the bytes, parse later when the discriminator is known.
8. **`json.Number` use case.** Preserve full numeric precision on decode (`int64` IDs above `2^53` lose data in `float64`).
9. **Streaming a 1GB file.** `Decoder.Token()` to consume `[`, loop with `Decoder.Decode` and `dec.More()`, consume closing `]`.
10. **DoS defences.** `io.LimitReader`, `DisallowUnknownFields`, depth caps, key-count caps, schema validation at the parser.
11. **`MarshalJSON` vs `UnmarshalJSON` receiver.** Marshal can be value receiver; Unmarshal must be pointer receiver (it mutates).
12. **The `,string` tag.** Forces a numeric field to encode as a JSON string — the standard fix for JavaScript precision loss on big ints.
13. **easyjson vs sonic vs stdlib.** Codegen (predictable, build step) vs JIT (peak speed, arch-limited) vs reflection (just works, slowest).
14. **`encoding/json/v2` highlights.** `omitzero`, per-call options, token-stream interfaces, strict mode, faster.
15. **One-line trade-off.** Reflection: zero build cost, slower. Codegen: build step, faster. Pick by profile data.

---
