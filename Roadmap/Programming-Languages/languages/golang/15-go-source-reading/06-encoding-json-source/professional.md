# encoding/json Source — Professional

> Focus: a senior-level source walkthrough of `encoding/json` as it ships in Go 1.22+. The package is small (~5 kLOC across `encode.go`, `decode.go`, `scanner.go`, `stream.go`, `indent.go`, `fold.go`, `tags.go`) yet it is the single most-used reflection-heavy library in the standard library and the canonical reference implementation of "interface-first, reflect-second, cache-everything" dispatch. The interesting reading is not the public API — it is the encoder-cache dance, the scanner state machine, and the reasons every replacement library beats it. Source excerpts below are paraphrased and trimmed; line numbers drift across releases. Treat the package as the spec; treat this document as the map.

---

## 1. `Marshal` → `newEncodeState` → `e.marshal`

The exported entry point is bookkeeping around an internal `encodeState`. Everything interesting lives below.

```go
// from encoding/json/encode.go, simplified
func Marshal(v any) ([]byte, error) {
    e := newEncodeState()
    defer encodeStatePool.Put(e)
    if err := e.marshal(v, encOpts{escapeHTML: true}); err != nil {
        return nil, err
    }
    buf := append([]byte(nil), e.Bytes()...) // copy out, return pool buffer
    return buf, nil
}

type encodeState struct {
    bytes.Buffer
    ptrLevel uint
    ptrSeen  map[any]struct{}
}

var encodeStatePool sync.Pool
```

`encodeState` is a `bytes.Buffer` plus a `ptrLevel` counter for cycle detection. It is recycled through `sync.Pool`: rent a buffer, fill it, copy the result out, return it. The pool is the first performance lever — it removes the per-call buffer allocation that would otherwise dominate small payloads. It is also why `Marshal` cannot return the internal buffer directly; the buffer outlives the call and would race on reuse. `e.marshal` is one line — `e.reflectValue(reflect.ValueOf(v), opts)` — dispatching into the encoder cache.

---

## 2. `valueEncoder` — interface or reflect

```go
// from encoding/json/encode.go, simplified
func (e *encodeState) reflectValue(v reflect.Value, opts encOpts) {
    valueEncoder(v)(e, v, opts)
}

func valueEncoder(v reflect.Value) encoderFunc {
    if !v.IsValid() { return invalidValueEncoder }
    return typeEncoder(v.Type())
}

type encoderFunc func(e *encodeState, v reflect.Value, opts encOpts)
```

One-step dispatch from a `reflect.Value` to a function pointer. Every encoder in the package shares the same signature, which is what makes the cache cheap — one indirect call regardless of the type behind it.

---

## 3. `typeEncoder` — the `sync.Map` cache

```go
// from encoding/json/encode.go, simplified
var encoderCache sync.Map // map[reflect.Type]encoderFunc

func typeEncoder(t reflect.Type) encoderFunc {
    if fi, ok := encoderCache.Load(t); ok {
        return fi.(encoderFunc)
    }
    // Placeholder that waits on the real encoder so recursive types
    // don't deadlock or build twice.
    var (
        wg sync.WaitGroup
        f  encoderFunc
    )
    wg.Add(1)
    fi, loaded := encoderCache.LoadOrStore(t, encoderFunc(func(e *encodeState, v reflect.Value, opts encOpts) {
        wg.Wait()
        f(e, v, opts)
    }))
    if loaded { return fi.(encoderFunc) }
    f = newTypeEncoder(t, true)
    wg.Done()
    encoderCache.Store(t, f)
    return f
}
```

The `WaitGroup` is the load-bearing detail. A recursive type — `type Node struct{ Next *Node }` — would otherwise call `newTypeEncoder(t)` from inside `newTypeEncoder(t)`. The placeholder closure parks the recursive call on `wg.Wait()` until the outer build completes; every subsequent invocation hits the cached real encoder. `sync.Map` is right here: writes are rare (once per type, ever), reads dominate, contention on a `sync.Mutex` would be visible under load.

---

## 4. `newTypeEncoder` — the type switch

```go
// from encoding/json/encode.go, simplified
func newTypeEncoder(t reflect.Type, allowAddr bool) encoderFunc {
    // Marshaler/TextMarshaler check happens FIRST.
    if t.Kind() != reflect.Pointer && allowAddr && reflect.PointerTo(t).Implements(marshalerType) {
        return newCondAddrEncoder(addrMarshalerEncoder, newTypeEncoder(t, false))
    }
    if t.Implements(marshalerType)     { return marshalerEncoder }
    if t.Implements(textMarshalerType) { return textMarshalerEncoder }

    switch t.Kind() {
    case reflect.Bool:                              return boolEncoder
    case reflect.Int, reflect.Int8, reflect.Int16,
         reflect.Int32, reflect.Int64:              return intEncoder
    case reflect.Uint, reflect.Uint8, reflect.Uint16,
         reflect.Uint32, reflect.Uint64:            return uintEncoder
    case reflect.Float32:                           return float32Encoder
    case reflect.Float64:                           return float64Encoder
    case reflect.String:                            return stringEncoder
    case reflect.Interface:                         return interfaceEncoder
    case reflect.Struct:                            return newStructEncoder(t)
    case reflect.Map:                               return newMapEncoder(t)
    case reflect.Slice:                             return newSliceEncoder(t)
    case reflect.Array:                             return newArrayEncoder(t)
    case reflect.Pointer:                           return newPtrEncoder(t)
    default:                                        return unsupportedTypeEncoder
    }
}
```

Three points:

1. `Marshaler` is checked *before* `Kind`. A type that implements `MarshalJSON()` short-circuits all reflection.
2. `condAddrEncoder` handles the addressable/non-addressable split — a method on `*T` is only available when `v.CanAddr()`. This is the source of the famous "value receiver vs pointer receiver" footguns at the JSON boundary.
3. Composite kinds recurse via `typeEncoder` for the element type, populating the cache on the way down. Building the encoder tree is O(reachable types); thereafter O(1).

---

## 5. `structEncoder` — pre-computed field walk

The struct encoder is the centre of the package. Every struct type has a pre-computed `[]field` list — name, index path, tag options, encoder pointer — built once and cached.

```go
// from encoding/json/encode.go, simplified
type structEncoder struct{ fields structFields }

type field struct {
    name      string
    nameNonEsc, nameEscHTML string  // precomputed `"name":`
    tag       bool
    index     []int        // path through embedded structs
    typ       reflect.Type
    omitEmpty bool
    quoted    bool
    encoder   encoderFunc
}

func (se structEncoder) encode(e *encodeState, v reflect.Value, opts encOpts) {
    next := byte('{')
FieldLoop:
    for i := range se.fields.list {
        f := &se.fields.list[i]
        fv := v
        for _, idx := range f.index {
            if fv.Kind() == reflect.Pointer {
                if fv.IsNil() { continue FieldLoop }
                fv = fv.Elem()
            }
            fv = fv.Field(idx)
        }
        if f.omitEmpty && isEmptyValue(fv) { continue }
        e.WriteByte(next); next = ','
        if opts.escapeHTML { e.WriteString(f.nameEscHTML) } else { e.WriteString(f.nameNonEsc) }
        opts.quoted = f.quoted
        f.encoder(e, fv, opts)
    }
    if next == '{' { e.WriteString("{}") } else { e.WriteByte('}') }
}
```

Each field carries a *pre-rendered name string* — two of them, one for `escapeHTML=true` and one for `false`, including the surrounding quotes and trailing colon. The hot path is a slice walk with `WriteString` calls; no per-field reflection on the name, no map lookup, no allocation. `isEmptyValue` does the standard `omitempty` check — zero numerics, empty strings, nil pointers/interfaces, zero-length slices/maps. `time.Time{}` is not considered empty, which is the most-reported "this is not a bug" issue against the package.

---

## 6. `cachedTypeFields` — tag parsing, dedup, sort

The field list construction is the most reflection-heavy code in the package and runs once per struct type ever marshaled.

```go
// from encoding/json/encode.go, simplified
var fieldCache sync.Map // map[reflect.Type]structFields

func cachedTypeFields(t reflect.Type) structFields {
    if f, ok := fieldCache.Load(t); ok { return f.(structFields) }
    f, _ := fieldCache.LoadOrStore(t, typeFields(t))
    return f.(structFields)
}

func typeFields(t reflect.Type) structFields {
    // BFS over the type graph, following embedded struct fields.
    current := []field{}
    next := []field{{typ: t}}
    visited := map[reflect.Type]bool{}
    var fields []field

    for len(next) > 0 {
        current, next = next, current[:0]
        nextCount := map[reflect.Type]int{}

        for _, f := range current {
            if visited[f.typ] { continue }
            visited[f.typ] = true

            for i := 0; i < f.typ.NumField(); i++ {
                sf := f.typ.Field(i)
                if !sf.IsExported() && (!sf.Anonymous || sf.Type.Kind() != reflect.Struct) {
                    continue
                }
                tag := sf.Tag.Get("json")
                if tag == "-" { continue }
                name, opts := parseTag(tag)
                index := append(append([]int{}, f.index...), i)
                ft := sf.Type
                if ft.Name() == "" && ft.Kind() == reflect.Pointer { ft = ft.Elem() }

                if name != "" || !sf.Anonymous || ft.Kind() != reflect.Struct {
                    tagged := name != ""
                    if name == "" { name = sf.Name }
                    fields = append(fields, field{
                        name: name, tag: tagged, index: index, typ: ft,
                        omitEmpty: opts.Contains("omitempty"),
                        quoted:    opts.Contains("string") && isQuotable(ft),
                    })
                    continue
                }
                // Embedded struct: schedule for next BFS level.
                nextCount[ft]++
                if nextCount[ft] == 1 {
                    next = append(next, field{name: ft.Name(), index: index, typ: ft})
                }
            }
        }
    }

    // Sort by (name, depth, tag, index sequence) then dedup by Go visibility rules.
    sort.Slice(fields, func(i, j int) bool { /* name, depth, tag, index */ return false })

    out := fields[:0]
    for i := 0; i < len(fields); {
        run := 1
        for i+run < len(fields) && fields[i+run].name == fields[i].name { run++ }
        if run == 1 {
            out = append(out, fields[i])
        } else if dominant, ok := dominantField(fields[i : i+run]); ok {
            out = append(out, dominant)
        }
        i += run
    }
    fields = out
    sort.Sort(byIndex(fields))

    // Precompute name bytes and assign each field its encoder.
    for i := range fields {
        f := &fields[i]
        f.nameNonEsc  = `"` + f.name + `":`
        f.nameEscHTML = `"` + htmlReplacer.Replace(f.name) + `":`
        f.encoder     = typeEncoder(typeByIndex(t, f.index))
    }
    return structFields{list: fields, nameIndex: buildNameIndex(fields)}
}
```

Three subtleties carry most of the package's correctness:

- **BFS, not DFS, over embedded types.** Shallower fields shadow deeper ones — exactly Go's own visibility rules. A DFS would silently flip the precedence.
- **Tag wins over name; shallow wins over deep.** `dominantField` returns the unambiguous winner. Two equally-deep fields with the same name produce no field at all (the entire group is dropped), matching the language's "ambiguous selector" compile error.
- **`nameEscHTML` is precomputed.** `htmlReplacer` rewrites `<`, `>`, `&` into `<`, `>`, `&`. Doing this once per type instead of per `Marshal` call is most of the package's "fast enough" performance.

The decoder's companion cache in `decode.go` follows the same shape but adds a lowercased `nameIndex` for the case-insensitive match `Unmarshal` performs.

---

## 7. `Marshaler` short-circuit

Before the type switch, `newTypeEncoder` checks two interface implementations:

```go
// from encoding/json/encode.go, simplified
var marshalerType = reflect.TypeOf((*Marshaler)(nil)).Elem()

func marshalerEncoder(e *encodeState, v reflect.Value, opts encOpts) {
    if v.Kind() == reflect.Pointer && v.IsNil() {
        e.WriteString("null"); return
    }
    m, ok := v.Interface().(Marshaler)
    if !ok { e.WriteString("null"); return }

    b, err := m.MarshalJSON()
    if err != nil { e.error(&MarshalerError{v.Type(), err, "MarshalJSON"}) }

    // Validate by re-scanning; reject invalid JSON from user code.
    b2, err := appendCompact(e.AvailableBuffer(), b, opts.escapeHTML)
    if err != nil { e.error(&MarshalerError{v.Type(), err, "MarshalJSON"}) }
    e.Buffer.Write(b2)
}
```

The validate-on-output step is non-trivial: `MarshalJSON` output is re-scanned through `compact` to ensure it is well-formed and to apply HTML escaping. A `MarshalJSON` that returns invalid JSON fails the parent `Marshal`. This is why `json.RawMessage` (§14) has to satisfy the validator without paying the cost twice. Custom marshalers are correctness escape hatches, not performance levers — until they avoid reflection on a hot type entirely.

---

## 8. `Unmarshal` → `newDecodeState` → `d.unmarshal`

The decoder mirrors the encoder's shape but owns the *scanner* — JSON is parsed top-down by a state machine, not by reflection.

```go
// from encoding/json/decode.go, simplified
func Unmarshal(data []byte, v any) error {
    var d decodeState
    if err := checkValid(data, &d.scan); err != nil { return err }
    d.init(data)
    return d.unmarshal(v)
}

type decodeState struct {
    data    []byte
    off     int      // read offset
    opcode  int      // most recent scanner opcode
    scan    scanner
    savedError error
    useNumber  bool
    disallowUnknownFields bool
}

func (d *decodeState) unmarshal(v any) error {
    rv := reflect.ValueOf(v)
    if rv.Kind() != reflect.Pointer || rv.IsNil() {
        return &InvalidUnmarshalError{reflect.TypeOf(v)}
    }
    d.scan.reset()
    d.scanWhile(scanSkipSpace)
    if err := d.value(rv); err != nil { return d.addErrorContext(err) }
    return d.savedError
}
```

Two passes: `checkValid` runs the scanner over the whole input first, returning early on syntax errors and avoiding the half-decoded-into-target failure mode. Then `d.value(rv)` walks the input again, this time dispatching tokens into the target. The double-pass costs ~2× scan time but gives an atomic "either fully succeeds or fully fails at the syntax level" guarantee.

---

## 9. The scanner — state machine in `scanner.go`

The scanner is the deepest and least-known piece of the package. It is a hand-rolled deterministic state machine that reads one byte at a time and emits *opcodes*, not tokens. Each state is a function pointer.

```go
// from encoding/json/scanner.go, simplified
type scanner struct {
    step       func(*scanner, byte) int
    parseState []int  // stack of contexts
    endTop     bool
    err        error
    bytes      int64
}

const (
    scanContinue     = iota
    scanBeginLiteral
    scanBeginObject
    scanObjectKey
    scanObjectValue
    scanEndObject
    scanBeginArray
    scanArrayValue
    scanEndArray
    scanSkipSpace
    scanEnd
    scanError
)

func stateBeginValue(s *scanner, c byte) int {
    if c <= ' ' && isSpace(c) { return scanSkipSpace }
    switch c {
    case '{': s.step = stateBeginStringOrEmpty
              s.pushParseState(c, parseObjectKey, scanBeginObject)
              return scanBeginObject
    case '[': s.step = stateBeginValueOrEmpty
              s.pushParseState(c, parseArrayValue, scanBeginArray)
              return scanBeginArray
    case '"': s.step = stateInString; return scanBeginLiteral
    case '-': s.step = stateNeg;      return scanBeginLiteral
    case '0': s.step = state0;        return scanBeginLiteral
    case 't': s.step = stateT;        return scanBeginLiteral
    case 'f': s.step = stateF;        return scanBeginLiteral
    case 'n': s.step = stateN;        return scanBeginLiteral
    }
    if '1' <= c && c <= '9' { s.step = state1; return scanBeginLiteral }
    return s.error(c, "looking for beginning of value")
}

func stateInString(s *scanner, c byte) int {
    if c == '"'  { s.step = stateEndValue; return scanContinue }
    if c == '\\' { s.step = stateInStringEsc; return scanContinue }
    if c < 0x20  { return s.error(c, "in string literal") }
    return scanContinue
}
```

Each `state*` function is a few branches; the whole scanner fits in L1. The `step` indirection costs one indirect call per byte — this is why `goccy/go-json` (which inlines the dispatch) beats the stdlib on small payloads. `parseState` is the bracket-matching stack; `endTop` after the final close is how `Unmarshal` rejects `{"a":1}garbage`. The state machine produces zero allocations — `parseState` is reused, function pointers live in the binary, tokens are not materialised.

---

## 10. `decode.go::value` — dispatch on first byte

Once `Unmarshal` has cleared `checkValid`, the actual decode walks the scanner forward and routes by lookahead byte.

```go
// from encoding/json/decode.go, simplified
func (d *decodeState) value(v reflect.Value) error {
    switch d.opcode {
    case scanBeginArray:
        if v.IsValid() { if err := d.array(v); err != nil { return err } } else { d.skip() }
        d.scanNext()
    case scanBeginObject:
        if v.IsValid() { if err := d.object(v); err != nil { return err } } else { d.skip() }
        d.scanNext()
    case scanBeginLiteral:
        start := d.readIndex()
        d.rescanLiteral()
        if v.IsValid() {
            if err := d.literalStore(d.data[start:d.readIndex()], v, false); err != nil {
                return err
            }
        }
    default:
        panic(phasePanicMsg)
    }
    return nil
}
```

Three cases mirror the JSON grammar exactly: array, object, literal. `d.skip()` is the path taken when the target is invalid (unexported field, `nil` interface) — the scanner consumes the structure without writing. `literalStore` does type coercion — `"42"` into `int`, `true` into `*bool`. The most-bitten case is `null` into a `*T`, which sets `*v = nil`, not `*v = T{}`.

---

## 11. `object` — field cache or map fallback

```go
// from encoding/json/decode.go, simplified
func (d *decodeState) object(v reflect.Value) error {
    u, _, pv := indirect(v, false)
    if u != nil {
        start := d.readIndex(); d.rescanLiteral()
        return u.UnmarshalJSON(d.data[start:d.readIndex()])
    }
    v = pv
    t := v.Type()

    var fields structFields
    switch v.Kind() {
    case reflect.Map:
        if v.IsNil() { v.Set(reflect.MakeMap(t)) }
    case reflect.Struct:
        fields = cachedTypeFields(t)
    case reflect.Interface:
        if v.NumMethod() == 0 {
            v.Set(reflect.ValueOf(d.objectInterface())) // map[string]any
            return nil
        }
        fallthrough
    default:
        d.saveError(&UnmarshalTypeError{Value: "object", Type: t}); d.skip(); return nil
    }

    for {
        d.scanWhile(scanSkipSpace)
        if d.opcode == scanEndObject { break }
        start := d.readIndex(); d.rescanLiteral()
        key, _ := unquoteBytes(d.data[start:d.readIndex()])

        var subv reflect.Value
        if v.Kind() == reflect.Map {
            subv = reflect.New(t.Elem()).Elem()
        } else {
            if i, ok := fields.nameIndex[string(key)]; ok {
                subv = subvByIndex(v, fields.list[i].index)
            } else {
                // case-fold fallback
                for i := range fields.list {
                    if fields.list[i].equalFold(fields.list[i].nameBytes, key) {
                        subv = subvByIndex(v, fields.list[i].index); break
                    }
                }
                if !subv.IsValid() && d.disallowUnknownFields {
                    d.saveError(fmt.Errorf("json: unknown field %q", key))
                }
            }
        }

        d.scanWhile(scanSkipSpace)
        if err := d.value(subv); err != nil { return err }

        if v.Kind() == reflect.Map {
            v.SetMapIndex(reflect.ValueOf(string(key)), subv)
        }
        d.scanWhile(scanSkipSpace)
        if d.opcode == scanEndObject { break }
    }
    return nil
}
```

The struct-vs-map split is where most user-facing surprises live. Struct decoding is the fast path — one map lookup per key, then recursion via the field's pre-computed encoder. Map decoding goes through `reflect.MakeMap` and `SetMapIndex` per key, each of which allocates. The interface-with-zero-methods branch is the `any` shortcut — allocate a `map[string]any` and recurse. Case-folded matching is the second-bitten quirk: `{"FullName":"x"}` unmarshals into a struct field `Fullname` because `equalFold` is case-insensitive. `disallowUnknownFields` (a `Decoder` option) is the only mitigation; the case-fold itself is by design.

---

## 12. `Decoder.Decode` — streaming reads

`Decoder` wraps `decodeState` and adds a refill loop that pulls bytes from an `io.Reader` until one full JSON value has been parsed.

```go
// from encoding/json/stream.go, simplified
type Decoder struct {
    r       io.Reader
    buf     []byte
    d       decodeState
    scanp   int     // start of unread data in buf
    err     error
}

func (dec *Decoder) Decode(v any) error {
    if dec.err != nil { return dec.err }
    if err := dec.tokenPrepareForDecode(); err != nil { return err }
    n, err := dec.readValue()
    if err != nil { return err }
    dec.d.init(dec.buf[dec.scanp : dec.scanp+n])
    dec.scanp += n
    return dec.d.unmarshal(v)
}

func (dec *Decoder) readValue() (int, error) {
    dec.scan.reset()
    scanp := dec.scanp
    for {
        for ; scanp < len(dec.buf); scanp++ {
            switch dec.scan.step(&dec.scan, dec.buf[scanp]) {
            case scanEnd:        scanp++; return scanp - dec.scanp, nil
            case scanEndObject, scanEndArray:
                if dec.scan.endTop { scanp++; return scanp - dec.scanp, nil }
            case scanError:
                dec.err = dec.scan.err; return 0, dec.scan.err
            }
        }
        n := scanp - dec.scanp
        if err := dec.refill(); err != nil { return 0, err }
        scanp = dec.scanp + n
    }
}
```

Per call: drive the scanner over the existing buffer; when bytes run out, `refill` reads more from `r`; when a top-level value closes, return its byte range. Then `decodeState` runs over exactly that range. The buffer is reused across calls. `Decoder` is therefore strictly cheaper than `Unmarshal(buf)` on a multi-value stream: no full-input syntax check, just incremental scan-then-decode per value. It is also the only stdlib API that gracefully handles concatenated JSON (`{"a":1}{"b":2}` as two `Decode` calls). `Decoder.Token()` exposes the scanner directly — the basis of any custom streaming consumer.

---

## 13. `Encoder.Encode` — streaming writes

```go
// from encoding/json/stream.go, simplified
type Encoder struct {
    w          io.Writer
    err        error
    escapeHTML bool
    indentBuf    []byte
    indentPrefix string
    indentValue  string
}

func (enc *Encoder) Encode(v any) error {
    if enc.err != nil { return enc.err }
    e := newEncodeState()
    defer encodeStatePool.Put(e)

    if err := e.marshal(v, encOpts{escapeHTML: enc.escapeHTML}); err != nil {
        return err
    }
    e.WriteByte('\n')

    b := e.Bytes()
    if enc.indentPrefix != "" || enc.indentValue != "" {
        var err error
        enc.indentBuf, err = appendIndent(enc.indentBuf[:0], b, enc.indentPrefix, enc.indentValue)
        if err != nil { return err }
        b = enc.indentBuf
    }
    if _, err := enc.w.Write(b); err != nil { enc.err = err; return err }
    return nil
}
```

Each `Encode` rents the same `encodeState` pool, fills it, writes it to `w`, appends a newline. The trailing newline is the streaming contract: each call produces one self-delimited line, which a `Decoder` on the other end consumes one `Decode` at a time. This is what makes `json.Encoder`/`json.Decoder` the de facto NDJSON implementation in Go. Indent is a post-pass — the encoder writes compact, then `appendIndent` rewrites with whitespace, allocating a second buffer.

---

## 14. `RawMessage` — the pass-through

```go
// from encoding/json/stream.go, simplified
type RawMessage []byte

func (m RawMessage) MarshalJSON() ([]byte, error) {
    if m == nil { return []byte("null"), nil }
    return m, nil
}

func (m *RawMessage) UnmarshalJSON(data []byte) error {
    if m == nil {
        return errors.New("json.RawMessage: UnmarshalJSON on nil pointer")
    }
    *m = append((*m)[0:0], data...)
    return nil
}
```

Six lines. `MarshalJSON` returns the underlying bytes; the validator (§7) checks they are well-formed and rewrites HTML-unsafe runes. `UnmarshalJSON` copies the raw bytes the scanner already validated. Use cases — deferred decoding (route by `{"type":"x"}` discriminator, decode the rest later), lazy passthrough (proxy a payload without inspecting), schemaless storage — are all built on this pair.

---

## 15. Performance bottlenecks

The package is *correct*, *self-contained*, and famously *slow*. Every replacement library — `jsoniter`, `goccy/go-json`, `bytedance/sonic`, `segmentio/encoding/json` — wins on the same handful of issues.

| Bottleneck | Where | Impact |
|---|---|---|
| Reflect dispatch per field | `structEncoder.encode`, `object` | Indirect call per field; ~10 ns each, not inlinable |
| Interface boxing | `reflectValue(reflect.ValueOf(v))` | One `reflect.Value` allocation per top-level call |
| `sync.Map` cache lookup | `typeEncoder` | One atomic load per call after warmup |
| HTML-escape validator | `appendCompact` after `MarshalJSON` | Rescans every byte of user-supplied JSON |
| Validate-then-decode double pass | `Unmarshal` → `checkValid` → `unmarshal` | Two scanner traversals over the input |
| Map allocation per object key | `object` map fallback | `reflect.New`, `SetMapIndex` allocate |
| No JIT/codegen | every encoder | Replacement libraries generate per-type encoders |
| Indent post-pass | `Encoder.Encode` with indent | Allocates a second buffer the size of output |
| String fields don't alias input | `literalStore`, `unquoteBytes` | Allocate new `string` even when they could alias |
| No escape-analysis-friendly buffer return | `Marshal` final copy | `append([]byte(nil), e.Bytes()...)` is mandatory because `e` returns to the pool |

The package's design prizes *zero foot-guns and zero codegen* over speed. For < 10 kB payloads at < 10 kQPS it is fast enough. For high-throughput RPC, ingestion pipelines, or anything where JSON parsing tops the CPU profile, the standard replacement order is: `goccy/go-json` (drop-in, codegen-free, ~3× faster) → `bytedance/sonic` (drop-in for amd64, JIT, ~5× faster) → switch to protobuf/MessagePack and stop parsing JSON on the hot path.

---

## 16. Encoder cache and dispatch — diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Marshal(v any)                                                       │
│   ↓                                                                  │
│ encodeStatePool.Get() ──→ encodeState{Buffer, ptrLevel, ptrSeen}     │
│   ↓                                                                  │
│ e.marshal(v, encOpts)                                                │
│   ↓                                                                  │
│ valueEncoder(reflect.ValueOf(v))                                     │
│   ↓                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐     │
│ │ typeEncoder(t reflect.Type)                                  │     │
│ │                                                              │     │
│ │   encoderCache.Load(t) ──hit──→  cached encoderFunc  ───┐    │     │
│ │       │ miss                                            │    │     │
│ │       ↓                                                 │    │     │
│ │   LoadOrStore(t, placeholder)                           │    │     │
│ │       ↓                                                 │    │     │
│ │   newTypeEncoder(t):                                    │    │     │
│ │       ├── Marshaler        →  marshalerEncoder          │    │     │
│ │       ├── TextMarshaler    →  textMarshalerEncoder      │    │     │
│ │       └── switch Kind {                                 │    │     │
│ │           Bool   → boolEncoder                          │    │     │
│ │           Int*   → intEncoder                           │    │     │
│ │           String → stringEncoder                        │    │     │
│ │           Struct → newStructEncoder(t) ─┐               │    │     │
│ │           Map    → newMapEncoder(t)     │               │    │     │
│ │           Slice  → newSliceEncoder(t)   │ recurses      │    │     │
│ │           Ptr    → newPtrEncoder(t)     │ via           │    │     │
│ │           Iface  → interfaceEncoder     │ typeEncoder   │    │     │
│ │       }                                  └───────────────┘    │     │
│ │   encoderCache.Store(t, real)  ←──── populate cache           │     │
│ └──────────────────────────────────────────────────────────────┘     │
│   ↓                                                                  │
│ encoder(e, v, opts)   ── writes JSON bytes into e.Buffer             │
│   ↓                                                                  │
│ buf := append(nil, e.Bytes()...)   ── copy out, return pool buffer   │
└──────────────────────────────────────────────────────────────────────┘

structEncoder dispatch (after warmup):

  structEncoder { fields: [field1, field2, ..., fieldN] }
       │
       └── for each field i:                                    O(1) lookup
              ├── walk index path  v.Field(idx[0]).Field(...)   O(depth)
              ├── omitempty check                               O(1)
              ├── e.WriteString(field.nameEscHTML)              precomputed
              └── field.encoder(e, fv, opts) ──┐
                                               └─→ recurse into typeEncoder

cachedTypeFields(t):

  reflect.Type t ──→ fieldCache.Load(t) ──hit──→ structFields { list, nameIndex }
                            │ miss
                            ↓
                        typeFields(t):
                            BFS over embedded types
                            ↓ parse json tags
                            ↓ sort by (name, depth, tag, index)
                            ↓ dominantField dedup
                            ↓ precompute nameEscHTML / nameNonEsc bytes
                            ↓ assign each field its typeEncoder
                        ↓
                        fieldCache.Store(t, structFields)
```

Two caches, two `sync.Map` instances: `encoderCache` keys `reflect.Type → encoderFunc`; `fieldCache` keys `reflect.Type → structFields`. The decoder has its own pair in `decode.go`. Both follow the same `LoadOrStore` + `WaitGroup` pattern to break recursion safely. After warmup, every `Marshal` is one `sync.Map.Load`, a `WriteString`, and a slice of pre-computed encoder calls — no reflection on the hot path beyond `v.Field(idx)`.

---

## 17. Reading order recommendation

The package is small but interleaved; reading it linearly will lose you. The order below traces the dependency chain from leaves to root:

1. **`tags.go`** (~30 lines). `parseTag`, `tagOptions.Contains`. Everything else assumes you know how `,omitempty` and `,string` are detected.
2. **`scanner.go`** (~600 lines). The state machine. Read top-to-bottom; each `state*` references the next.
3. **`fold.go`** (~100 lines). `equalFold` — Unicode-aware case-insensitive byte comparison.
4. **`encode.go::Marshal` through `typeEncoder`**. Dispatch front door and cache trick. The `WaitGroup` placeholder is the part most readers miss.
5. **`encode.go::newTypeEncoder` and the per-kind encoders** (`boolEncoder`, `intEncoder`, `stringEncoder`).
6. **`encode.go::typeFields` and `cachedTypeFields`**. The single most complex function in the package. Re-read after seeing `structEncoder.encode`.
7. **`encode.go::structEncoder`, `mapEncoder`, `sliceEncoder`, `ptrEncoder`**. By this point the cache flow is obvious.
8. **`decode.go::Unmarshal`, `decodeState`, `d.value`**. Decoder front door and grammar dispatch.
9. **`decode.go::object`, `array`, `literalStore`**. Where reflection meets the scanner.
10. **`decode.go::typeFields` (decoder side)**. Mirror of step 6 with case-fold support.
11. **`stream.go`**. `Decoder.Decode`, `Encoder.Encode`, `Token`, `RawMessage`.
12. **`indent.go`**. Post-pass formatters; read last.

Two read-throughs is honest. The first is for the shape; the second is for the cache and tag-precedence subtleties. The package rewards re-reading because so much of the cleverness is in second-order behaviour — recursion, cycles, type ambiguity, adversarial input.

---

## Closing principles

`encoding/json` is the canonical example of *correctness-first, performance-second, codegen-never* Go standard-library design. It is also the canonical example of how far you can push reflection if you cache aggressively and pre-render every string.

1. **Dispatch is cached, not computed.** Every per-type cost is paid once and amortised. The `sync.Map` + `WaitGroup` pattern survives recursive types without deadlocking.
2. **`Marshaler` is checked before reflection.** The single user-facing performance lever the package exposes.
3. **The scanner is a function-pointer state machine.** No allocations, no token materialisation. Replacement libraries beat it by inlining the dispatch.
4. **`structEncoder` walks a pre-computed slice.** Tags, names, encoders, HTML-escaped byte strings are precomputed. The hot path is `WriteString` plus an indirect call.
5. **Field resolution follows Go's visibility rules.** BFS over embedded types, dominant-field dedup, tag-then-depth precedence.
6. **The decoder validates twice.** `checkValid` first, then `unmarshal`. Atomic syntax errors at 2× scan cost.
7. **`Decoder.Decode` streams; `Unmarshal` does not.** Concatenated values, NDJSON, infinite streams are `Decoder` territory.
8. **`RawMessage` is six lines.** Defer decoding, route by discriminator, store opaque JSON.
9. **The performance ceiling is reflection, not algorithm.** Replacement libraries win on the same axes — codegen, JIT, skipping the validator pass.
10. **Read it bottom-up.** Tags → scanner → cache → encoders → decoder → stream.

The right reading: *the package is a slow, careful, correct reflector with two caches and a state machine, and that is exactly what most Go programs need*. The day the JSON parser shows up at the top of your profile is the day to switch to `goccy/go-json` or `sonic` and move on. Until then, `encoding/json` is the boring, dependable substrate against which every other Go serialisation library is measured.

---

## Further reading

- `encoding/json` source under `$GOROOT/src/encoding/json/`
- Russ Cox, *JSON and Go* (golang.org/blog) — original design notes
- `goccy/go-json` — codegen-free drop-in replacement; read `decoder.go` for the inlined dispatch
- `bytedance/sonic` — JIT-compiled JSON; `internal/encoder` shows per-type codegen
- `segmentio/encoding/json` — reflection-heavy but allocation-tuned alternative
- `json-iterator/go` — original "faster encoding/json" benchmark target
- Go proposal #5901, *streaming Decoder/Encoder* — historical context on `Decoder` design
- Go proposal #11489, *case-sensitive matching* — closed; case-fold is by design
- Go issue #14750, *time.Time zero value with omitempty* — the canonical "not a bug" thread
- `encoding/xml.Decoder.Token` — sibling state machine with the same dispatch shape
