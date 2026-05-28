# encoding/json Source — Professional

> Focus: a senior-level source walkthrough of `encoding/json` as it ships in Go 1.22+. The package is small (~5 kLOC across `encode.go`, `decode.go`, `scanner.go`, `stream.go`, `indent.go`, `fold.go`, `tags.go`) yet it is the single most-used reflection-heavy library in the standard library and the canonical reference implementation of "interface-first, reflect-second, cache-everything" dispatch. The interesting reading is not the public API — it is the encoder-cache dance, the scanner state machine, and the reasons every benchmark on the open internet beats it. Source excerpts below are paraphrased and trimmed; line numbers drift across releases. Treat the package as the spec; treat this document as the map.

---

## 1. `Marshal` → `newEncodeState` → `e.marshal`

The exported entry point is three lines of bookkeeping around an internal `encodeState`. Everything interesting lives below.

```go
// from encoding/json/encode.go, simplified
func Marshal(v any) ([]byte, error) {
    e := newEncodeState()
    defer encodeStatePool.Put(e)

    err := e.marshal(v, encOpts{escapeHTML: true})
    if err != nil { return nil, err }

    buf := append([]byte(nil), e.Bytes()...) // copy out, return pool buffer
    return buf, nil
}
```

`encodeState` is a `bytes.Buffer` plus a scratch `[64]byte` for number formatting and a `ptrLevel` counter for cycle detection on pointer chains. It is recycled through `sync.Pool` — every `Marshal` call rents a buffer, fills it, copies the result out, returns the buffer.

```go
// from encoding/json/encode.go, simplified
type encodeState struct {
    bytes.Buffer            // accumulated output
    ptrLevel uint
    ptrSeen  map[any]struct{}
}

var encodeStatePool sync.Pool

func newEncodeState() *encodeState {
    if v := encodeStatePool.Get(); v != nil {
        e := v.(*encodeState)
        e.Reset()
        e.ptrLevel = 0
        if len(e.ptrSeen) > 0 { clear(e.ptrSeen) }
        return e
    }
    return &encodeState{ptrSeen: make(map[any]struct{})}
}
```

The pool is the first performance lever — it removes the per-call buffer allocation that would otherwise dominate small payloads. The pool is also the reason `Marshal` cannot return the internal buffer directly; the buffer outlives the call and would race on reuse.

`e.marshal` is one line — `e.reflectValue(reflect.ValueOf(v), opts)` — that dispatches into the encoder cache.

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
```

`valueEncoder` is a one-step dispatch from a `reflect.Value` to a function pointer (`encoderFunc`). Every encoder in the package has the same signature:

```go
type encoderFunc func(e *encodeState, v reflect.Value, opts encOpts)
```

Uniform signature is what makes the cache cheap — every entry is the same shape, and the dispatch is one indirect call regardless of the type behind it. The actual lookup happens in `typeEncoder`.

---

## 3. `typeEncoder` — the `sync.Map` cache

```go
// from encoding/json/encode.go, simplified
var encoderCache sync.Map // map[reflect.Type]encoderFunc

func typeEncoder(t reflect.Type) encoderFunc {
    if fi, ok := encoderCache.Load(t); ok {
        return fi.(encoderFunc)
    }

    // Concurrent-safety dance: install a placeholder that waits on the
    // real encoder, so recursive types don't deadlock or build twice.
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

The `WaitGroup` trick is the load-bearing detail. A recursive type — `type Node struct{ Next *Node }` — would otherwise call `newTypeEncoder(t)` from inside `newTypeEncoder(t)`, looping forever. The placeholder closure parks the recursive call on `wg.Wait()` until the outer build completes; then every subsequent invocation hits the cached entry. The same pattern appears in `decode.go::cachedTypeFields`.

`sync.Map` is the right tool here: writes are rare (once per type, ever), reads dominate (every `Marshal` call after warmup), and contention on a `sync.Mutex` would be visible under load.

---

## 4. `newTypeEncoder` — the type switch

```go
// from encoding/json/encode.go, simplified
func newTypeEncoder(t reflect.Type, allowAddr bool) encoderFunc {
    // Marshaler/encoding.TextMarshaler check happens FIRST.
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
         reflect.Uint32, reflect.Uint64, reflect.Uintptr: return uintEncoder
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

Three things to note:

1. **`Marshaler` is checked before `Kind`.** A type that implements `MarshalJSON()` short-circuits all reflection — the encoder is just `m.MarshalJSON()` and copy the bytes. This is the optimisation knob the package exposes to user code.
2. **`condAddrEncoder` handles the addressable/non-addressable split.** A method set on `*T` is only available when the value is addressable; the conditional encoder picks `addrMarshalerEncoder` when `v.CanAddr()` and falls back otherwise. This is the source of the famous "value receiver vs pointer receiver" footguns at the JSON boundary.
3. **Composite kinds recurse.** `newStructEncoder`, `newMapEncoder`, `newSliceEncoder`, `newPtrEncoder` all call back into `typeEncoder` for the element type, populating the cache on the way down. Building the encoder tree for a complex type is O(reachable types); after that it's O(1) lookups.

---

## 5. `structEncoder` — pre-computed field walk

The struct encoder is the centre of the package. Every struct type has a pre-computed `[]field` list — name, index path, tag options, encoder pointer — built once and cached.

```go
// from encoding/json/encode.go, simplified
type structEncoder struct{ fields structFields }

type structFields struct {
    list      []field
    nameIndex map[string]int
}

type field struct {
    name      string
    nameBytes []byte
    nameNonEsc, nameEscHTML string
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

Each field carries a *pre-rendered name string* — two of them, one for `escapeHTML=true` and one for `false`, including the surrounding quotes and trailing colon. The hot path is a slice walk with `WriteString` calls; no per-field reflection on the name, no map lookup, no allocation. The expensive work happened once, during `cachedTypeFields`.

`isEmptyValue` does the standard `omitempty` check — zero numerics, empty strings, nil pointers/interfaces, zero-length slices/maps. It is one of the small surface areas the package punts on: `time.Time{}` is *not* considered empty, which is the most-reported "this is not a bug" issue against the package.

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
    // current: types to visit at this BFS level
    // next:    types to visit at the next level
    current := []field{}
    next := []field{{typ: t}}
    var visited = map[reflect.Type]bool{}
    var fields []field

    for len(next) > 0 {
        current, next = next, current[:0]
        count, nextCount := map[reflect.Type]int{}, map[reflect.Type]int{}

        for _, f := range current {
            if visited[f.typ] { continue }
            visited[f.typ] = true

            for i := 0; i < f.typ.NumField(); i++ {
                sf := f.typ.Field(i)
                if sf.Anonymous {
                    t := sf.Type
                    if t.Kind() == reflect.Pointer { t = t.Elem() }
                    if !sf.IsExported() && t.Kind() != reflect.Struct { continue }
                } else if !sf.IsExported() { continue }

                tag := sf.Tag.Get("json")
                if tag == "-" { continue }
                name, opts := parseTag(tag)
                if !isValidTag(name) { name = "" }

                index := make([]int, len(f.index)+1)
                copy(index, f.index); index[len(f.index)] = i

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
                // Record embedded struct for next BFS level.
                nextCount[ft]++
                if nextCount[ft] == 1 {
                    next = append(next, field{name: ft.Name(), index: index, typ: ft})
                }
            }
        }
    }

    // Sort by name, then by tag priority, then by depth, then by index sequence.
    sort.Slice(fields, func(i, j int) bool {
        if fields[i].name != fields[j].name { return fields[i].name < fields[j].name }
        if len(fields[i].index) != len(fields[j].index) { return len(fields[i].index) < len(fields[j].index) }
        if fields[i].tag != fields[j].tag { return fields[i].tag }
        return byIndex(fields).Less(i, j)
    })

    // Dedup: among fields with the same name, keep the unambiguous winner;
    // drop the entire name-group if no winner exists (Go visibility rules).
    out := fields[:0]
    for advance, i := 0, 0; i < len(fields); i += advance {
        fi := fields[i]
        name := fi.name
        for advance = 1; i+advance < len(fields); advance++ {
            if fields[i+advance].name != name { break }
        }
        if advance == 1 { out = append(out, fi); continue }
        if dominant, ok := dominantField(fields[i : i+advance]); ok {
            out = append(out, dominant)
        }
    }
    fields = out
    sort.Sort(byIndex(fields))

    // Precompute name bytes + assign each field its encoder.
    for i := range fields {
        f := &fields[i]
        f.nameBytes = []byte(f.name)
        f.nameNonEsc = `"` + f.name + `":`
        f.nameEscHTML = `"` + htmlReplacer.Replace(f.name) + `":`
        f.encoder = typeEncoder(typeByIndex(t, f.index))
    }

    nameIndex := make(map[string]int, len(fields))
    for i, f := range fields { nameIndex[f.name] = i }
    return structFields{fields, nameIndex}
}
```

Three subtleties carry most of the package's correctness:

- **BFS, not DFS, over embedded types.** Shallower fields shadow deeper ones — exactly Go's own visibility rules. A DFS would silently flip the precedence.
- **Tag wins over name; depth wins over depth.** `dominantField` returns the unambiguous winner by `(tagged depth, untagged depth)`. Two equally-deep fields with the same name produce no field at all (the entire group is dropped), matching the language's "ambiguous selector" compile error.
- **`nameEscHTML` is precomputed.** `htmlReplacer` rewrites `<`, `>`, `&` into `<`, `>`, `&`. Doing this once per type instead of per `Marshal` call is most of the package's "fast enough" performance.

The companion cache for the decoder, in `decode.go`, follows the same shape but builds a `fieldByIndex`-friendly `map[string]int` keyed by lowercased name for the case-insensitive match `Unmarshal` performs.

---

## 7. `Marshaler` short-circuit

Before the type switch, `newTypeEncoder` checks two interface implementations. Their encoders are tiny:

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

The validate-on-output step is non-trivial: `MarshalJSON` from user code is re-scanned through `compact` to ensure it is well-formed and to apply HTML escaping. A `MarshalJSON` that returns invalid JSON fails the parent `Marshal`. This is the reason `json.RawMessage` (§14) is a thin wrapper — it has to satisfy the validator without paying the cost twice.

Performance consequence: implementing `MarshalJSON` to "go fast" usually goes slower than the reflection encoder, because the validator runs anyway. Custom marshalers are correctness escape hatches, not performance levers — until they avoid reflection on a hot type entirely, in which case the saving is large.

---

## 8. `Unmarshal` → `newDecodeState` → `d.unmarshal`

The decoder mirrors the encoder's shape but is structurally larger because it owns the *scanner* — JSON is parsed top-down by a state machine, not by reflection.

```go
// from encoding/json/decode.go, simplified
func Unmarshal(data []byte, v any) error {
    var d decodeState
    err := checkValid(data, &d.scan)
    if err != nil { return err }

    d.init(data)
    return d.unmarshal(v)
}

type decodeState struct {
    data         []byte
    off          int      // read offset
    opcode       int      // most recent scanner opcode
    scan         scanner
    errorContext *errorContext
    savedError   error
    useNumber    bool
    disallowUnknownFields bool
}

func (d *decodeState) unmarshal(v any) error {
    rv := reflect.ValueOf(v)
    if rv.Kind() != reflect.Pointer || rv.IsNil() {
        return &InvalidUnmarshalError{reflect.TypeOf(v)}
    }
    d.scan.reset()
    d.scanWhile(scanSkipSpace)
    err := d.value(rv)
    if err != nil { return d.addErrorContext(err) }
    return d.savedError
}
```

Two passes: `checkValid` runs the scanner over the whole input first, returning early on syntax errors and avoiding the half-decoded-into-target failure mode. Then `d.value(rv)` walks the input again, this time dispatching tokens into the target. The double-pass costs ~2× scan time but is what lets `Unmarshal` give an atomic "either fully succeeds or fully fails (at the syntax level)" guarantee.

`d.value` is the dispatch table that ties scanner state to reflect-driven writes — see §10.

---

## 9. The scanner — state-machine in `scanner.go`

The scanner is the deepest and least-known piece of the package. It is a hand-rolled deterministic state machine that reads one byte at a time and emits *opcodes*, not tokens. Each state is a function pointer.

```go
// from encoding/json/scanner.go, simplified
type scanner struct {
    step       func(*scanner, byte) int
    parseState []int  // stack of contexts: arrayKey/objectKey/objectVal
    endTop     bool
    err        error
    bytes      int64
}

// opcodes returned by step()
const (
    scanContinue     = iota // uninteresting byte
    scanBeginLiteral        // beginning a primitive (true/false/null/number)
    scanBeginObject         // saw '{'
    scanObjectKey           // saw ':' after object key
    scanObjectValue         // saw ',' after object value
    scanEndObject           // saw '}'
    scanBeginArray          // saw '['
    scanArrayValue          // saw ',' in array
    scanEndArray            // saw ']'
    scanSkipSpace
    scanEnd
    scanError
)
```

State transitions are wired with function-pointer swaps:

```go
// from encoding/json/scanner.go, simplified
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
    if c == '"' { s.step = stateEndValue; return scanContinue }
    if c == '\\' { s.step = stateInStringEsc; return scanContinue }
    if c < 0x20 { return s.error(c, "in string literal") }
    return scanContinue
}
```

Each `state*` function is a few branches; the whole scanner is small enough to fit in L1. The `step` indirection costs one indirect call per byte, which is why benchmarks against `goccy/go-json` (which inlines the dispatch) show large gaps on small payloads.

`parseState` is the bracket-matching stack — `pushParseState` on `{` and `[`, `popParseState` on `}` and `]`. The check `endTop` after the final close ensures no trailing non-whitespace data; this is how `Unmarshal` rejects `{"a":1}garbage`.

The state machine produces no allocations — `parseState` is reused across calls, the function pointers live in the binary, and tokens themselves are not materialised; they exist only as offsets into the input byte slice.

---

## 10. `decode.go::value` — dispatch on first byte

Once `Unmarshal` has cleared `checkValid`, the actual decode walks the scanner forward and routes by lookahead byte.

```go
// from encoding/json/decode.go, simplified
func (d *decodeState) value(v reflect.Value) error {
    switch d.opcode {
    default:
        panic(phasePanicMsg)
    case scanBeginArray:
        if v.IsValid() {
            if err := d.array(v); err != nil { return err }
        } else {
            d.skip()
        }
        d.scanNext()
    case scanBeginObject:
        if v.IsValid() {
            if err := d.object(v); err != nil { return err }
        } else {
            d.skip()
        }
        d.scanNext()
    case scanBeginLiteral:
        // start may be a number, true/false/null, or a string
        start := d.readIndex()
        d.rescanLiteral()
        if v.IsValid() {
            if err := d.literalStore(d.data[start:d.readIndex()], v, false); err != nil {
                return err
            }
        }
    }
    return nil
}
```

The three cases mirror the JSON grammar exactly: array, object, or literal. `d.skip()` is the path taken when the target is invalid (e.g. an unexported field, or a `nil` interface during exploratory decode) — the scanner consumes the structure without writing anywhere. This is the same primitive `Decoder.Token` exposes (§12).

`literalStore` does the type-coercion work — `"42"` into `int`, `42` into `string`, `true` into `*bool`. The matrix of allowed coercions is in the comments at the top of `decode.go`; the most-bitten case is `null` into a `*T`, which sets `*v = nil`, not `*v = T{}`.

---

## 11. `object` — field cache or map fallback

```go
// from encoding/json/decode.go, simplified
func (d *decodeState) object(v reflect.Value) error {
    // Unwrap pointer/interface to the underlying.
    u, ut, pv := indirect(v, false)
    if u != nil {
        // Target implements Unmarshaler — hand it the raw object.
        start := d.readIndex()
        d.rescanLiteral()
        return u.UnmarshalJSON(d.data[start:d.readIndex()])
    }
    _ = ut // similar branch for TextUnmarshaler

    v = pv
    t := v.Type()

    var fields structFields
    switch v.Kind() {
    case reflect.Map:
        // map fallback path — see below.
        switch t.Key().Kind() {
        case reflect.String,
             reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
             reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
        default:
            if !reflect.PointerTo(t.Key()).Implements(textUnmarshalerType) {
                d.saveError(&UnmarshalTypeError{Value: "object", Type: t, Offset: int64(d.off)})
                d.skip()
                return nil
            }
        }
        if v.IsNil() { v.Set(reflect.MakeMap(t)) }
    case reflect.Struct:
        fields = cachedTypeFields(t)
    case reflect.Interface:
        if v.NumMethod() == 0 {
            // Decode into map[string]any.
            oi := d.objectInterface()
            v.Set(reflect.ValueOf(oi))
            return nil
        }
        fallthrough
    default:
        d.saveError(&UnmarshalTypeError{Value: "object", Type: t, Offset: int64(d.off)})
        d.skip()
        return nil
    }

    var mapElem reflect.Value
    for {
        d.scanWhile(scanSkipSpace)
        if d.opcode == scanEndObject { break }
        if d.opcode != scanBeginLiteral { panic(phasePanicMsg) }

        start := d.readIndex()
        d.rescanLiteral()
        item := d.data[start:d.readIndex()]
        key, _ := unquoteBytes(item)

        var subv reflect.Value
        destring := false
        if v.Kind() == reflect.Map {
            elemType := t.Elem()
            if !mapElem.IsValid() { mapElem = reflect.New(elemType).Elem() } else { mapElem.SetZero() }
            subv = mapElem
        } else {
            // Lookup by exact then case-folded match.
            if i, ok := fields.nameIndex[string(key)]; ok {
                f := &fields.list[i]
                subv = subvByIndex(v, f.index)
                destring = f.quoted
            } else {
                for i := range fields.list {
                    f := &fields.list[i]
                    if f.equalFold(f.nameBytes, key) {
                        subv = subvByIndex(v, f.index); destring = f.quoted; break
                    }
                }
                if !subv.IsValid() && d.disallowUnknownFields {
                    d.saveError(fmt.Errorf("json: unknown field %q", key))
                }
            }
        }

        d.scanWhile(scanSkipSpace)
        if d.opcode != scanObjectKey { panic(phasePanicMsg) }
        d.scanWhile(scanSkipSpace)

        if destring {
            // Field tagged ",string": the JSON value is a quoted scalar.
            ...
        } else {
            if err := d.value(subv); err != nil { return err }
        }

        if v.Kind() == reflect.Map {
            kv := reflect.ValueOf(stringKeyOrUnmarshal(key, t.Key()))
            v.SetMapIndex(kv, subv)
        }

        d.scanWhile(scanSkipSpace)
        if d.opcode == scanEndObject { break }
        if d.opcode != scanObjectValue { panic(phasePanicMsg) }
    }
    return nil
}
```

The struct-vs-map split is where most user-facing surprises live. Struct decoding is the fast path — one map lookup per key, then recursion via the field's pre-computed encoder. Map decoding goes through `reflect.MakeMap` and `SetMapIndex` per key, each of which allocates. The interface-with-zero-methods branch is the `any` shortcut — `objectInterface` allocates a `map[string]any` and recurses.

Case-folded matching is the second-bitten quirk: `{"FullName":"x"}` unmarshals into a struct field named `Fullname` because `equalFold` is case-insensitive. `disallowUnknownFields` (a `Decoder` option, not a `Marshal` option) is the only mitigation; the case-fold itself is by design and matches the encoder's tag-then-name precedence.

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
    scanned int64
    tokenState int
    tokenStack []int
    err     error
}

func NewDecoder(r io.Reader) *Decoder { return &Decoder{r: r} }

func (dec *Decoder) Decode(v any) error {
    if dec.err != nil { return dec.err }

    if err := dec.tokenPrepareForDecode(); err != nil { return err }
    if !dec.tokenValueAllowed() { return &SyntaxError{msg: "not at beginning of value"} }

    // Read until the next complete value.
    n, err := dec.readValue()
    if err != nil { return err }

    dec.d.init(dec.buf[dec.scanp : dec.scanp+n])
    dec.scanp += n
    err = dec.d.unmarshal(v)
    dec.tokenValueEnd()
    return err
}

func (dec *Decoder) readValue() (int, error) {
    dec.scan.reset()
    scanp := dec.scanp
    var err error
Input:
    for {
        // Look for the end of a value in the buffered data.
        for ; scanp < len(dec.buf); scanp++ {
            c := dec.buf[scanp]
            dec.scan.bytes++
            switch dec.scan.step(&dec.scan, c) {
            case scanEnd:        scanp++; break Input
            case scanEndObject, scanEndArray:
                if dec.scan.endTop { scanp++; break Input }
            case scanError:
                dec.err = dec.scan.err; return 0, dec.scan.err
            }
        }
        if err != nil {
            if err == io.EOF {
                if dec.scan.step(&dec.scan, ' ') == scanEnd { break Input }
                if nonSpace(dec.buf) { err = io.ErrUnexpectedEOF }
            }
            dec.err = err; return 0, err
        }
        n := scanp - dec.scanp
        err = dec.refill()
        scanp = dec.scanp + n
    }
    return scanp - dec.scanp, nil
}
```

Per call: drive the scanner over the existing buffer; when the buffer runs out, `refill` reads more from `r`; when a top-level value closes, return its byte range. Then `decodeState` runs over exactly that range. The buffer is reused across calls — `scanp` advances and bytes are shifted down when the buffer grows beyond a threshold.

`Decoder` is therefore strictly cheaper than `Unmarshal(buf)` on a multi-value stream: no `bytes.Buffer` for the input, no full-input syntax check, just incremental scan-then-decode per value. It is also the only stdlib API that gracefully handles concatenated JSON (`{"a":1}{"b":2}` as two `Decode` calls).

`Decoder.Token()` exposes the scanner directly, returning `json.Delim`, strings, numbers, and `bool`/`nil` for incremental walking — the basis of any custom streaming consumer.

---

## 13. `Encoder.Encode` — streaming writes

The encoder side is even simpler. Each `Encode` rents the same `encodeState` pool, fills it, writes it to the underlying `io.Writer`, and appends a newline.

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

func NewEncoder(w io.Writer) *Encoder { return &Encoder{w: w, escapeHTML: true} }

func (enc *Encoder) Encode(v any) error {
    if enc.err != nil { return enc.err }

    e := newEncodeState()
    defer encodeStatePool.Put(e)

    err := e.marshal(v, encOpts{escapeHTML: enc.escapeHTML})
    if err != nil { return err }

    e.WriteByte('\n')

    b := e.Bytes()
    if enc.indentPrefix != "" || enc.indentValue != "" {
        enc.indentBuf, err = appendIndent(enc.indentBuf[:0], b, enc.indentPrefix, enc.indentValue)
        if err != nil { return err }
        b = enc.indentBuf
    }
    if _, err = enc.w.Write(b); err != nil { enc.err = err }
    return err
}
```

The trailing newline is the streaming contract: each call produces one self-delimited line, which a `Decoder` on the other end will consume one `Decode` at a time. This is what makes `json.Encoder`/`json.Decoder` the de facto NDJSON implementation in Go even though the package never uses that name.

Indent is implemented as a post-pass over the buffered output — the encoder writes compact, then `appendIndent` rewrites with whitespace. This is wasteful for indented output (which has to allocate the second buffer) but keeps the hot encoder simple.

---

## 14. `RawMessage` — the pass-through

`RawMessage` is the package's escape hatch: a `[]byte` that survives a round-trip through `Marshal`/`Unmarshal` without being re-parsed.

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

`MarshalJSON` returns the underlying bytes; the validator (§7) checks they are well-formed JSON and rewrites HTML-unsafe runes. `UnmarshalJSON` copies the raw bytes the scanner already validated into the target. The whole type is six lines.

The use cases — deferred decoding (route by `{"type":"x"}` discriminator, decode the rest later), lazy passthrough (proxy a payload without inspecting), schema-less storage (database column of opaque JSON) — are all built on this pair of methods.

---

## 15. Performance bottlenecks

The package is *correct*, *self-contained*, and famously *slow*. Every replacement library — `jsoniter`, `goccy/go-json`, `bytedance/sonic`, `segmentio/encoding/json` — wins on the same handful of issues.

| Bottleneck | Where | Impact |
|---|---|---|
| Reflect dispatch per field | `structEncoder.encode`, `object` | Indirect call per field; ~10 ns each, can't be inlined |
| Interface boxing in `valueEncoder` | `reflectValue(reflect.ValueOf(v))` | One `reflect.Value` allocation per top-level `Marshal`; small but non-zero |
| `sync.Map` cache lookup | `typeEncoder` | One atomic load per top-level call after warmup; cheap but not free |
| HTML escape pass | `appendCompact` after `MarshalJSON` | Rescans every byte of user-supplied JSON; doubles cost of custom marshalers |
| Validate-then-decode double pass | `Unmarshal` → `checkValid` → `unmarshal` | Two scanner traversals over the input bytes |
| Map allocation per object key | `object` map fallback | `reflect.New(elemType).Elem()`, `SetMapIndex` allocate |
| No JIT/codegen | every encoder | Specialised libraries generate per-type encode/decode at startup or `go generate` time |
| Indent as post-pass | `Encoder.Encode` with non-empty indent | Allocates a second buffer the size of the output |
| `encoding/json` doesn't keep field bytes sliced from input | `literalStore`, `unquoteBytes` | String fields allocate new `string` even when they could alias input bytes |
| No escape-analysis-friendly buffer return | `Marshal` final copy | Final `append([]byte(nil), e.Bytes()...)` is mandatory because `e` returns to the pool |

The package's design prizes *zero foot-guns and zero codegen* over speed. For most server workloads — < 10 kB payloads, < 10 kQPS — it is fast enough. For high-throughput RPC, ingestion pipelines, or anything where JSON parsing shows up at the top of a CPU profile, the calculus changes. The standard replacement order is: `goccy/go-json` (drop-in, codegen-free, ~3× faster) → `bytedance/sonic` (drop-in for amd64, JIT, ~5× faster) → switch to protobuf/MessagePack and stop parsing JSON on the hot path.

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
│ │   encoderCache.Load(t) ──hit──→  cached encoderFunc  ────┐   │     │
│ │       │                                                  │   │     │
│ │       miss                                               │   │     │
│ │       ↓                                                  │   │     │
│ │   LoadOrStore(t, placeholder)                            │   │     │
│ │       ↓                                                  │   │     │
│ │   newTypeEncoder(t):                                     │   │     │
│ │       ├── Marshaler        →  marshalerEncoder    ──┐    │   │     │
│ │       ├── TextMarshaler    →  textMarshalerEncoder ─┤    │   │     │
│ │       └── switch Kind {                              │    │   │     │
│ │           Bool   → boolEncoder                       │    │   │     │
│ │           Int*   → intEncoder                        │    │   │     │
│ │           String → stringEncoder                     │    │   │     │
│ │           Struct → newStructEncoder(t) ─┐            │    │   │     │
│ │           Map    → newMapEncoder(t)     │            │    │   │     │
│ │           Slice  → newSliceEncoder(t)   │ recurses   │    │   │     │
│ │           Ptr    → newPtrEncoder(t)     │ via        │    │   │     │
│ │           Iface  → interfaceEncoder     │ typeEncoder│    │   │     │
│ │       }                                  └────────────┘    │   │     │
│ │                                                            │   │     │
│ │   encoderCache.Store(t, real)  ←──────── populate cache ───┘   │     │
│ └────────────────────────────────────────────────────────────────┘   │
│   ↓                                                                  │
│ encoder(e, v, opts)   ── writes JSON bytes into e.Buffer             │
│   ↓                                                                  │
│ buf := append(nil, e.Bytes()...)   ── copy out, return pool buffer   │
│   ↓                                                                  │
│ encodeStatePool.Put(e)                                               │
└──────────────────────────────────────────────────────────────────────┘

structEncoder dispatch (one struct type, after warmup):

  structEncoder { fields: [field1, field2, ..., fieldN] }
       │
       └── for each field i in fields:                          O(1) lookup
              ├── walk index path  v.Field(idx[0]).Field(...)   O(depth)
              ├── omitempty check                               O(1)
              ├── e.WriteString(field.nameEscHTML)              precomputed
              └── field.encoder(e, fv, opts) ──┐
                                               └─→ recurse into typeEncoder

cachedTypeFields(t):

  reflect.Type t ──→ fieldCache.Load(t) ──hit──→ structFields { list, nameIndex }
                            │
                            miss
                            ↓
                        typeFields(t):
                            BFS over embedded types
                            ↓
                            parse json tags
                            ↓
                            sort by (name, tag, depth, index)
                            ↓
                            dominantField dedup
                            ↓
                            precompute nameEscHTML / nameNonEsc bytes
                            ↓
                            assign each field its typeEncoder
                        ↓
                        fieldCache.Store(t, structFields)
```

Two caches, two `sync.Map` instances: `encoderCache` keys `reflect.Type → encoderFunc`; `fieldCache` keys `reflect.Type → structFields`. The decoder side has its own pair in `decode.go`. Both follow the same `LoadOrStore` + `WaitGroup` pattern to break recursion safely. After warmup every `Marshal` is a single `sync.Map.Load`, a `WriteString`, and a slice of pre-computed encoder calls — no reflection on the hot path beyond `v.Field(idx)`.

---

## 17. Reading order recommendation

The package is small but interleaved; reading it linearly will lose you. The order below traces the dependency chain from leaves to root:

1. **`tags.go`** (~30 lines). Tag parsing — `parseTag`, `tagOptions.Contains`. Read first; everything else assumes you know how `,omitempty` and `,string` are detected.
2. **`scanner.go`** (~600 lines). The state machine. Read top-to-bottom; each `state*` function references the next. Skip the comments about `checkValid` on the first pass — they make sense after `decode.go`.
3. **`fold.go`** (~100 lines). `equalFold` — Unicode-aware case-insensitive byte comparison. Used by the decoder; trivial but you'll see it referenced.
4. **`encode.go::Marshal`** through **`encode.go::typeEncoder`**. The dispatch front door and the cache trick. Read carefully — the `WaitGroup` placeholder is the part most readers miss.
5. **`encode.go::newTypeEncoder`** and the per-kind encoders (`boolEncoder`, `intEncoder`, `stringEncoder`). One screen each; they show the shape.
6. **`encode.go::typeFields` and `cachedTypeFields`**. The reflection-heavy field-list builder. The single most complex function in the package. Re-read once you've seen `structEncoder.encode`.
7. **`encode.go::structEncoder`, `mapEncoder`, `sliceEncoder`, `ptrEncoder`**. The composite encoders. By this point the cache flow is obvious.
8. **`decode.go::Unmarshal`, `decodeState`, `d.value`**. The decoder's front door and grammar dispatch.
9. **`decode.go::object`, `array`, `literalStore`**. Where reflection meets the scanner. `object` is the bulk; the rest is variations.
10. **`decode.go::typeFields` (decoder side)**. Mirror of step 6 with a `nameIndex` map and case-fold support.
11. **`stream.go`**. `Decoder.Decode`/`Encoder.Encode`/`Token`/`RawMessage`. Small and self-contained once you have the core.
12. **`indent.go`**. Post-pass formatters; read last.

Two read-throughs is honest. The first is for the shape; the second is for the cache and tag-precedence subtleties. The package rewards re-reading more than most stdlib code because so much of the cleverness is in the second-order behaviour — what happens on recursion, on cycles, on type ambiguity, on adversarial input.

---

## Closing principles

`encoding/json` is the canonical example of *correctness-first, performance-second, codegen-never* Go standard-library design. It is also the canonical example of how far you can push reflection if you cache aggressively and pre-render every string.

1. **Dispatch is cached, not computed.** Every per-type cost is paid once and amortised across every `Marshal` call. The `sync.Map` + `WaitGroup` pattern survives recursive types without deadlocking.
2. **The `Marshaler` interface check happens before reflection.** This is the single user-facing performance lever the package exposes. Implement it on hot types; let reflection handle the rest.
3. **The scanner is a function-pointer state machine.** No allocations, no token materialisation, ~3 ns/byte. Replaceable libraries beat it by inlining the dispatch and JIT-compiling per-type fast paths.
4. **`structEncoder` walks a pre-computed slice.** Tags, names, encoders, HTML-escaped byte strings are all precomputed by `cachedTypeFields`. The hot path is `WriteString` plus indirect call.
5. **Field resolution follows Go's visibility rules exactly.** BFS over embedded types, dominant-field dedup, tag-then-depth precedence. Read `typeFields` once carefully; everything else falls out.
6. **The decoder validates twice.** `checkValid` first, then `unmarshal`. Atomic syntax errors at the cost of a 2× scan. Replacement libraries skip this for speed; they also crash on partial input.
7. **`Decoder.Decode` streams; `Unmarshal` does not.** The difference is one refill loop. Concatenated values, NDJSON, and infinite streams are `Decoder` territory.
8. **`RawMessage` is six lines.** Defer decoding, route by discriminator, store opaque JSON. The whole pattern is `MarshalJSON`/`UnmarshalJSON` that copy bytes.
9. **The package's performance ceiling is reflection, not algorithm.** Every replacement library wins on the same axes — codegen, JIT, avoiding the validator pass. The standard library will not adopt them because the costs (binary size, build complexity, IR generation) exceed the benefit for the median user.
10. **Read it bottom-up.** Tags → scanner → cache → encoders → decoder → stream. The interleaved file order will mislead you; the dependency order will not.

The right reading is *the package is a slow, careful, correct reflector with two caches and a state machine, and that is exactly what most Go programs need*. The day the JSON parser shows up at the top of your profile is the day to read this document, switch to `goccy/go-json` or `sonic`, and move on. Until then, `encoding/json` is the boring, dependable substrate against which every other Go serialisation library is measured.

---

## Further reading

- `encoding/json` source tree under `$GOROOT/src/encoding/json/`
- Russ Cox, *JSON and Go* (golang.org/blog) — the original design notes
- `goccy/go-json` source — codegen-free drop-in replacement; read `decoder.go` for the inlined dispatch trick
- `bytedance/sonic` source — JIT-compiled JSON; the `internal/encoder` package shows per-type codegen
- `segmentio/encoding/json` — reflection-heavy but allocation-tuned alternative
- `json-iterator/go` — the original "faster encoding/json" benchmark target
- Go proposal #5901, *encoding/json: streaming Decoder/Encoder* — historical context on `Decoder` design
- Go proposal #11489, *encoding/json: option for case-sensitive matching* — closed; case-fold is by design
- Go issue #14750, *time.Time zero value with omitempty* — the canonical "this is not a bug" thread
- `encoding/xml.Decoder.Token` source — sibling state machine; same dispatch shape
