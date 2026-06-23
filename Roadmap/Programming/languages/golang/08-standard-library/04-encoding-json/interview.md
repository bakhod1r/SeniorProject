# 8.4 `encoding/json` — Interview

> 28 questions and answers covering the practical, semantic, and
> performance aspects of `encoding/json`. Use as a self-test before
> an interview, as a question bank when interviewing, or as a quick
> "do I really know this" pass.

## Basics

### 1. Why does `Unmarshal` require a pointer?

It needs to mutate the target in place. `Unmarshal(data, v)` where
`v` is a value (not a pointer) would receive a copy by Go's
calling convention; any changes would be invisible to the caller.
Passing a non-pointer (or a `nil` pointer) returns
`*json.InvalidUnmarshalError`.

### 2. Are unexported fields serialized?

No. `encoding/json` uses `reflect`, and `reflect` cannot read or
write unexported fields. They are silently skipped on both
marshal and unmarshal. A common trap: a lowercase Go field name
(e.g., `email` instead of `Email`) is treated as unexported and
never round-trips.

### 3. What does `omitempty` consider "empty"?

False, 0, empty string, empty slice/array/map, nil pointer or
interface. Notably **not** empty: a zero-valued struct (including
`time.Time{}`). For truly optional struct/time fields, use a
pointer (`*time.Time`) so `nil` is the empty case.

### 4. How do you distinguish "missing" from "explicit zero"?

Use a pointer. A `*bool` field can be `nil` (missing), `&true`, or
`&false`. A plain `bool` collapses "missing" and `false` into the
same Go value. The same trick works for `*int`, `*string`, `*time.Time`.

### 5. What's the JSON form of `[]byte`?

A base64-encoded string (RFC 4648 std encoding). If you wanted the
literal characters from the byte slice, declare the field as
`string` instead. If you wanted a JSON array of byte values, use
`[]int` or `[]uint8` aliased through a named type.

## The number trap

### 6. How do JSON numbers decode by default?

Into `float64` when the target is `interface{}` or `map[string]any`.
Into the exact native type when the target is `int`, `int64`,
`uint64`, `float32`, etc. The `interface{}` path is lossy for
integers larger than 2^53. Use `Decoder.UseNumber()` to keep them
as `json.Number` (a string) and convert explicitly.

### 7. What's the difference between `json.RawMessage` and `json.Number`?

`RawMessage` is a `[]byte` holding the raw JSON bytes for an
arbitrary value, so you can defer decoding it until later (or
re-emit it without re-encoding). `Number` is a `string` holding
the literal digits of a JSON number, so you can decide whether
to parse as `int64` or `float64` after seeing it. They solve
different problems: `RawMessage` for delayed *parsing*, `Number`
for delayed *type choice*.

### 8. When do you reach for `json.Number`?

When decoding into `interface{}` or `map[string]any` and you
care about integer precision. Or when the field could legally be
either an integer or a float (timestamps in milliseconds vs
fractional seconds, financial amounts where you don't want
binary-float surprises). For typed structs with `int64` fields,
you don't need `Number` — the decoder already uses the integer
parser.

## Custom marshalers

### 9. Why might a custom `MarshalJSON` not get called?

Method-set rules. If `MarshalJSON` is on a pointer receiver
(`func (t *T) MarshalJSON() ...`), then the value type `T` does
not have it in its method set. Calling `json.Marshal(t)` with
`t` of type `T` falls back to the default struct marshaler.
Calling `json.Marshal(&t)` calls the custom one. Convention:
put `MarshalJSON` on the value receiver, `UnmarshalJSON` on the
pointer receiver.

### 10. How do you call the default marshaler from inside a custom one?

Recursing via `json.Marshal(t)` inside `(t T) MarshalJSON()`
infinite-loops. Define a type alias to strip the methods:

```go
func (t T) MarshalJSON() ([]byte, error) {
    type alias T
    return json.Marshal(alias(t))
}
```

`alias` shares the layout and tags but has no `MarshalJSON`
method, so the encoder takes the default struct path.

### 11. Walk through implementing `UnmarshalJSON` for a sum type.

Wrap each variant in an envelope with a type discriminator:

```go
type Event interface{ isEvent() }
type Ping struct{ Time time.Time `json:"time"` }
func (Ping) isEvent() {}
type Click struct{ X, Y int }
func (Click) isEvent() {}

type envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

func DecodeEvent(b []byte) (Event, error) {
    var env envelope
    if err := json.Unmarshal(b, &env); err != nil { return nil, err }
    switch env.Type {
    case "ping":
        var p Ping
        return p, json.Unmarshal(env.Payload, &p)
    case "click":
        var c Click
        return c, json.Unmarshal(env.Payload, &c)
    default:
        return nil, fmt.Errorf("unknown event %q", env.Type)
    }
}
```

The discriminator and `RawMessage` together make the dispatch
single-pass without needing reflection or a `map[string]any`
intermediate.

### 12. What does `MarshalJSON` need to return?

A complete, valid JSON value. Not a fragment. Not a string to splice
in. The encoder validates via `json.Compact`, so malformed bytes
become `*json.MarshalerError`. To emit a JSON string, return
`json.Marshal("the value")` instead of constructing the bytes by
hand.

### 13. What is `json.MarshalerError` and how do I unwrap it?

When a custom `MarshalJSON` returns an error, the package wraps it
in `*json.MarshalerError` with the type that failed. Use
`errors.Unwrap` or `errors.As` to get the original error back.
The wrapper is also why "json: error calling MarshalJSON for type X:
..." appears in user-facing errors — strip it at API boundaries.

## Streaming and decoders

### 14. When do you reach for `Decoder` over `Unmarshal`?

Three cases:

1. **The input is an `io.Reader`.** Skip the `io.ReadAll` step.
2. **You need streaming-only options** — `DisallowUnknownFields` or
   `UseNumber`. They live on `*Decoder`, not on `Unmarshal`.
3. **You're consuming a stream of values** (NDJSON, concatenated
   JSON, an HTTP server-sent event feed). `Decoder.Decode` returns
   one value at a time and tracks position automatically.

### 15. What's `Decoder.More` for?

Inside an open container (object or array), `More()` reports
whether there's another element. At the top level, it reports
whether there's another value in the stream. Pair it with
`Token()` to walk arbitrary JSON, or with `Decode()` to consume
each element of an array without buffering the whole array.

### 16. How does NDJSON work with `Encoder` and `Decoder`?

`Encoder.Encode` writes one JSON value followed by `\n`.
`Decoder.Decode` consumes one JSON value at a time, ignoring
whitespace (including `\n`) between values. The pair naturally
produces and consumes NDJSON. No special framing flag needed.

### 17. What does `Decoder.DisallowUnknownFields` do?

Enables strict input validation: any field in the JSON that
doesn't match a field on the target struct returns an error
("json: unknown field \"foo\""). Use it for internal APIs where a
typo in a field name should fail loudly. Don't use it for inputs
that legitimately have extra fields (third-party webhooks,
forward-compatible APIs).

### 18. What's `Encoder.SetEscapeHTML(false)` for?

By default, `Encoder` and `Marshal` escape `<`, `>`, `&` as
`<`, `>`, `&`. This makes the output safe to embed inside
an HTML `<script>` tag. For pure JSON-over-the-wire, the
escapes are unwanted noise. Turn off with `SetEscapeHTML(false)`
on the encoder. (No equivalent on `Marshal`.)

## Embedding and field resolution

### 19. How does `encoding/json` handle embedded structs with conflicting field names?

Two embedded fields at the same depth with the same JSON name
both get dropped silently. To break the tie, either declare the
field at the outer level, give one of the embedded fields an
explicit JSON tag rename, or wrap in a non-anonymous field.
A tagged field beats an untagged field at the same depth.

### 20. What happens when you embed a type that implements `json.Marshaler`?

The embedded type's `MarshalJSON` is promoted onto the outer
type's method set. The encoder calls the embedded marshaler and
**ignores the rest of the outer struct's fields**. Override by
declaring an explicit `MarshalJSON` on the outer type that uses
the type-alias trick to fall back to the default struct path.

### 21. How do `TextMarshaler` and `Marshaler` interact?

The encoder checks for `Marshaler` first, then for
`TextMarshaler`. `TextMarshaler` is what lets a custom type be
used as a JSON object key (since JSON keys must be strings, the
encoder needs a way to stringify any non-string key type).

## Error types

### 22. What types of errors does `Unmarshal` return?

- `*json.SyntaxError` — bytes aren't valid JSON. Includes `Offset`.
- `*json.UnmarshalTypeError` — JSON value doesn't fit Go target.
  Includes `Field`, `Value`, `Type`.
- `*json.InvalidUnmarshalError` — non-pointer or nil pointer
  passed to `Unmarshal`.

Type-switch via `errors.As` to give precise diagnostics.

### 23. What does `Marshal` panic on?

Cycles through pointers/slices/maps used to panic via stack
overflow; since Go 1.20, the package detects them and returns
`*json.UnsupportedValueError`. NaN, Inf, `chan`, `func`, and
`complex` types also produce typed errors (no panic).

## Maps and keys

### 24. Why is `map[interface{}]X` disallowed?

JSON object keys are strings. `encoding/json` requires the key type
to be `string`, integer, or implement `encoding.TextMarshaler` so
it can be stringified. `interface{}` could hold anything (including
types that aren't stringifiable), so the package rejects it
upfront with `*json.UnsupportedTypeError`.

### 25. How do you serialize a `map[time.Time]int`?

`time.Time` already implements `TextMarshaler` (the RFC 3339 form),
so it works as a map key out of the box:

```go
m := map[time.Time]int{time.Now(): 1}
b, _ := json.Marshal(m)
// {"2026-05-06T12:00:00Z":1}
```

For your own types, implement `MarshalText`/`UnmarshalText` and
they become valid map key types automatically.

## Performance

### 26. Where does `encoding/json` allocate the most?

- One allocation per JSON object decoded into a struct/map.
- One allocation per JSON string into a Go string (always; never
  aliases the input buffer).
- Slice growth as elements are decoded.
- The reflection plan cache hits a `sync.Map` per type (one-time).

For hot paths: pre-size slices, reuse `Encoder` buffers via
`sync.Pool`, use `RawMessage` to skip parsing fields you don't
need, hand-write `MarshalJSON` for the few hot types, or move to
a code generator (`easyjson`, `jsoniter`, `sonic`) when reflection
overhead dominates.

### 27. When should you reach for a non-stdlib JSON library?

When profiling shows `encoding/json` dominating CPU and memory
in a hot path that you can't restructure. `easyjson` and `ffjson`
generate per-type code at build time; `jsoniter` is a drop-in
faster reflection-based implementation; `sonic` (ByteDance) uses
SIMD on amd64 for very high throughput. The trade-off: extra
build steps, less obvious behavior, and you give up the
v2-readiness of the stdlib path. Most production code is fine on
stdlib.

### 28. What's `encoding/json/v2` and should I wait for it?

A proposal (active in 2026) to redesign the package: explicit
options instead of mutable encoder/decoder state, an `omitzero`
that respects `IsZero()` (fixing the `time.Time{}` problem), a
separate `jsontext` package for tokens, and improved performance.
It's not in the standard library yet. Don't wait for it — write
code against v1, and migrate when v2 ships. The migration is
expected to be additive (v1 stays).
