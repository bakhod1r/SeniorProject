# 8.4 `encoding/json` — Middle

> **Audience.** You're past the basics in [junior.md](junior.md) and
> you're writing services that talk JSON over HTTP, stream large
> payloads, and consume schemas you don't fully control. This file
> covers custom (un)marshalers in depth, `RawMessage` for delayed
> parsing, the `Encoder`/`Decoder` streaming pair, NDJSON, polymorphic
> decoding via type discriminators, and the configuration knobs
> (`DisallowUnknownFields`, `UseNumber`, `SetEscapeHTML`) you reach for
> in production.

## 1. The Marshaler/Unmarshaler interfaces in depth

```go
type Marshaler interface {
    MarshalJSON() ([]byte, error)
}

type Unmarshaler interface {
    UnmarshalJSON([]byte) error
}
```

Two contracts:

1. **`MarshalJSON` returns a complete JSON value.** Not a fragment,
   not a string to splice in — a full value: object, array, number,
   string, `true`, `false`, or `null`. Whatever you return must
   successfully round-trip through `json.Compact`. The encoder calls
   `json.Compact` on your output (since Go 1.7) to ensure no leading
   whitespace bleeds into the surrounding stream, so badly formed
   output gets caught.

2. **`UnmarshalJSON` receives the raw JSON value as bytes**, exactly
   as it appeared in the source (no whitespace stripping, no quote
   removal). The slice is owned by the decoder; if you need to retain
   it past the call, copy it.

A common mistake is calling the receiver type's own `MarshalJSON`
recursively to "use the default":

```go
type T struct { ... }

func (t T) MarshalJSON() ([]byte, error) {
    return json.Marshal(t) // INFINITE RECURSION — calls itself
}
```

The trick to "default plus a tweak" is to declare a type alias that
strips the methods, then marshal *that*:

```go
func (t T) MarshalJSON() ([]byte, error) {
    type alias T            // same shape, no MarshalJSON method
    return json.Marshal(alias(t))
}
```

`alias` has the same memory layout and the same struct tags but
doesn't carry `T`'s method set. The encoder hits the default
struct path. You can do work before or after:

```go
func (t T) MarshalJSON() ([]byte, error) {
    type alias T
    return json.Marshal(struct {
        alias
        Computed string `json:"computed"`
    }{
        alias:    alias(t),
        Computed: t.compute(),
    })
}
```

Same trick on the unmarshal side — declare an alias to recurse
without recursing:

```go
func (t *T) UnmarshalJSON(b []byte) error {
    type alias T
    var a alias
    if err := json.Unmarshal(b, &a); err != nil {
        return err
    }
    if err := validate(a); err != nil {
        return err
    }
    *t = T(a)
    return nil
}
```

This is the pattern for "validate during decode" and for "compute
derived fields from raw input."

## 2. `json.RawMessage` — defer parsing

```go
type RawMessage []byte
```

`RawMessage` implements both `Marshaler` and `Unmarshaler`. On
unmarshal, it captures the raw JSON bytes for that field without
parsing them. On marshal, it writes those bytes back as-is.

The two big use cases:

### Capture an unknown field, decide later

```go
type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

src := []byte(`{"type":"order","payload":{"id":"o-1","total":99}}`)
var env Envelope
json.Unmarshal(src, &env)

switch env.Type {
case "order":
    var o Order
    json.Unmarshal(env.Payload, &o)
case "shipment":
    var s Shipment
    json.Unmarshal(env.Payload, &s)
}
```

The first decode parses only the envelope; `Payload` holds the inner
bytes verbatim. The second decode hits a tiny, well-typed slice. You
pay the parsing cost only once per field, not the full document
twice.

### Pass-through of pre-formatted JSON

When you've already got JSON bytes (from a database column, a cache,
another service) and want to embed them in a larger document without
parsing:

```go
type Resp struct {
    Status string          `json:"status"`
    Data   json.RawMessage `json:"data"`
}

cached := []byte(`{"big":"object","with":"many","fields":true}`)
b, _ := json.Marshal(Resp{Status: "ok", Data: cached})
// {"status":"ok","data":{"big":"object","with":"many","fields":true}}
```

`Marshal` writes `Data` as-is — no parse, no re-encode. If `cached`
is invalid JSON, `Marshal` returns an error (it validates the bytes
via `json.Compact`).

### Two warnings

1. `json.RawMessage` is `[]byte`. Treat it as immutable bytes you
   borrowed from the decoder. If you'll keep it past the immediate
   use, copy it: `cp := append(json.RawMessage{}, env.Payload...)`.
2. `RawMessage` is *not* a string. Comparing `env.Payload == "..."`
   doesn't compile; comparing two `RawMessage`s with `==` doesn't
   compile either. Use `bytes.Equal`.

## 3. `json.Number` and `Decoder.UseNumber`

Recall from junior.md: a JSON number decoded into `interface{}`
becomes `float64`, losing precision past 2^53. The fix:

```go
var v any
dec := json.NewDecoder(strings.NewReader(`{"id":9007199254740993}`))
dec.UseNumber()
dec.Decode(&v)
// v == map[string]interface{}{"id": json.Number("9007199254740993")}
```

`json.Number` is a string type:

```go
type Number string

func (n Number) Float64() (float64, error)
func (n Number) Int64() (int64, error)
func (n Number) String() string
```

It preserves the *exact* digits the producer sent. You decide later
whether to parse as integer or float:

```go
m := v.(map[string]any)
n := m["id"].(json.Number)
id, err := n.Int64()
if err != nil {
    // It's a float (or out of int64 range). Fall back.
    f, _ := n.Float64()
    _ = f
}
```

Three rules of thumb:

- For typed structs, you don't need `json.Number` — decode straight
  into `int64` and the decoder uses the literal's digits.
- For `map[string]any` from arbitrary JSON, set `UseNumber()` on
  the decoder by default. The cost is one allocation per number
  (the string), but precision matters more than that allocation.
- `MarshalJSON` on `Number` writes the literal back unchanged. So
  decoding with `UseNumber` and re-encoding gives you byte-for-byte
  fidelity for numbers.

`json.Marshal` with `Number` works too — you can construct a
`json.Number` from a string and inject it into JSON without rounding:

```go
b, _ := json.Marshal(json.Number("1e1000"))
// "1e1000" — written through verbatim
```

Validation happens on `Number.Float64`/`Int64`, not at marshal time.

## 4. The `TextMarshaler` fallback

`encoding/json` checks for `Marshaler` first, then for
`encoding.TextMarshaler`:

```go
type TextMarshaler interface {
    MarshalText() (text []byte, err error)
}

type TextUnmarshaler interface {
    UnmarshalText(text []byte) error
}
```

If your type implements `TextMarshaler` but not `Marshaler`, JSON
uses the text form and wraps it in quotes. Example: `time.Time`
implements both, but `MarshalJSON` (which produces RFC 3339) wins.

The `TextMarshaler` path is the one that lets you use custom types as
**map keys**:

```go
type Color struct{ R, G, B uint8 }

func (c Color) MarshalText() ([]byte, error) {
    return []byte(fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B)), nil
}

func (c *Color) UnmarshalText(b []byte) error {
    _, err := fmt.Sscanf(string(b), "#%02x%02x%02x", &c.R, &c.G, &c.B)
    return err
}

m := map[Color]string{
    {255, 0, 0}: "red",
    {0, 255, 0}: "green",
}
b, _ := json.Marshal(m)
// {"#00ff00":"green","#ff0000":"red"}
```

Without `MarshalText`, the encoder would refuse the map (key isn't
`string` or numeric). With it, the key gets stringified per element.

Same for any type used as a map key: `net.IP`, `uuid.UUID`,
`big.Int`, custom enums. If you can write a unique stringification,
you can use it as a map key.

## 5. The streaming pair: `Decoder` and `Encoder`

```go
type Decoder struct{ ... }
func NewDecoder(r io.Reader) *Decoder
func (d *Decoder) Decode(v any) error
func (d *Decoder) Buffered() io.Reader
func (d *Decoder) DisallowUnknownFields()
func (d *Decoder) UseNumber()
func (d *Decoder) More() bool
func (d *Decoder) Token() (Token, error)
func (d *Decoder) InputOffset() int64

type Encoder struct{ ... }
func NewEncoder(w io.Writer) *Encoder
func (e *Encoder) Encode(v any) error
func (e *Encoder) SetEscapeHTML(on bool)
func (e *Encoder) SetIndent(prefix, indent string)
```

Two patterns. First, **decode a stream of values**, one after the
other:

```go
dec := json.NewDecoder(r)
for {
    var v Event
    if err := dec.Decode(&v); err != nil {
        if errors.Is(err, io.EOF) {
            break
        }
        return err
    }
    handle(v)
}
```

`Decode` parses one complete JSON value (object, array, scalar) and
returns. The next call resumes after it, skipping whitespace. This is
how `Decoder` handles **NDJSON** (newline-delimited JSON), JSON-Lines
log files, JSON streams over HTTP, and concatenated JSON values from
any source.

Second, **encode a stream of values** to a writer:

```go
enc := json.NewEncoder(w)
for _, ev := range events {
    if err := enc.Encode(ev); err != nil {
        return err
    }
}
```

`Encode` writes one JSON value followed by a newline (`\n`) to `w`.
That trailing newline is what makes `Encoder` produce NDJSON
naturally — every value lands on its own line, no separator between.

## 6. NDJSON: the streaming format you'll see most

NDJSON (also called JSON Lines, or `application/x-ndjson`) is a
container format: one JSON value per line, separated by `\n`. It's
the dominant choice for log shipping (Loki, Elastic), streaming APIs
(OpenAI, Anthropic, GitHub events), and message queues that
serialize JSON. It plays nicely with line-oriented Unix tools too.

Producing NDJSON is just `Encoder.Encode` in a loop:

```go
func writeNDJSON(w io.Writer, events <-chan Event) error {
    enc := json.NewEncoder(w)
    for e := range events {
        if err := enc.Encode(e); err != nil {
            return err
        }
    }
    return nil
}
```

Consuming NDJSON is `Decoder.Decode` in a loop, using `io.EOF` as
the terminator:

```go
func readNDJSON(r io.Reader, fn func(Event) error) error {
    dec := json.NewDecoder(r)
    for {
        var e Event
        if err := dec.Decode(&e); err != nil {
            if errors.Is(err, io.EOF) {
                return nil
            }
            return err
        }
        if err := fn(e); err != nil {
            return err
        }
    }
}
```

Two non-obvious facts:

1. The `Decoder` skips whitespace between values. So `\n`, `\r\n`,
   tabs, or no separator at all (concatenated JSON) all work. The
   `\n` from `Encoder` is purely for human/tool readability.

2. The `Decoder` is buffered. After a successful `Decode`, the
   decoder may have read further into `r` than the value's last byte.
   Use `Decoder.Buffered()` to retrieve the unread tail if you need
   to switch the underlying reader to a different parser
   mid-stream.

A streaming HTTP handler that writes NDJSON:

```go
func (s *Server) Stream(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/x-ndjson")
    w.Header().Set("Cache-Control", "no-cache")

    fl, _ := w.(http.Flusher)
    enc := json.NewEncoder(w)

    for {
        select {
        case <-r.Context().Done():
            return
        case e := <-s.events:
            if err := enc.Encode(e); err != nil {
                return
            }
            if fl != nil {
                fl.Flush() // push to client immediately
            }
        }
    }
}
```

`http.Flusher` is the bit that turns a buffered `ResponseWriter` into
a true streaming response. Without `Flush`, the bytes sit in the
HTTP server's send buffer and the client may not see them until the
buffer fills.

## 7. Reading huge JSON arrays without loading the whole thing

A common API shape: one big JSON array of records. Loading the
entire response into memory is fine for thousands of records, painful
for millions. The streaming-friendly approach uses `Decoder.Token`
to peel off the leading `[`, then `Decoder.Decode` per element:

```go
func streamArray(r io.Reader, fn func(json.RawMessage) error) error {
    dec := json.NewDecoder(r)

    // Read the opening bracket.
    tok, err := dec.Token()
    if err != nil { return err }
    if d, ok := tok.(json.Delim); !ok || d != '[' {
        return fmt.Errorf("expected [, got %v", tok)
    }

    // Decode each element until we see the closing bracket.
    for dec.More() {
        var raw json.RawMessage
        if err := dec.Decode(&raw); err != nil {
            return err
        }
        if err := fn(raw); err != nil {
            return err
        }
    }

    // Read the closing bracket.
    if _, err := dec.Token(); err != nil {
        return err
    }
    return nil
}
```

`Decoder.More` returns `true` as long as there's another element in
the current array or object. `Token()` advances one token at a time
(delimiters, scalars, keys); `Decode()` consumes a whole value.
Mixing them is fully supported — see senior.md for the state machine.

`fn(raw)` gets a `json.RawMessage` for each element. The caller can
unmarshal it into whatever type fits, or pass it through. Memory
stays at one element's worth.

## 8. `Encoder.SetEscapeHTML` — turn off the HTML safety

By default, `Encoder` (and `Marshal`) escape `<`, `>`, and `&` as
`<`, `>`, `&`:

```go
b, _ := json.Marshal("<script>alert(1)</script>")
fmt.Println(string(b))
// "<script>alert(1)</script>"
```

This makes the output safe to embed inside an HTML `<script>` tag
without further escaping. For most APIs, you don't want this — the
client wants literal `<`. Turn it off on the `Encoder`:

```go
enc := json.NewEncoder(w)
enc.SetEscapeHTML(false)
enc.Encode("<script>alert(1)</script>")
// "<script>alert(1)</script>\n"
```

There's no equivalent on `Marshal`. If you need raw HTML chars in
batch output, use a `bytes.Buffer` plus an `Encoder`:

```go
var buf bytes.Buffer
enc := json.NewEncoder(&buf)
enc.SetEscapeHTML(false)
enc.Encode(v)
return buf.Bytes() // includes trailing \n; trim if you care
```

Trade-offs: HTML-escape-on (the default) is the correct, paranoid
choice when the bytes might be embedded in HTML. Off is the right
choice for pure JSON-over-the-wire. Almost every microservice wants
it off.

## 9. `Decoder.DisallowUnknownFields` — strict input validation

By default, fields in the JSON that don't match any field on the
target struct are silently dropped:

```go
type Req struct{ Name string `json:"name"` }
src := []byte(`{"name":"x","admin":true}`)
var r Req
json.Unmarshal(src, &r) // no error, "admin" silently dropped
```

For internal APIs, this is dangerous: a misspelled field
(`"administrator":true`) silently does nothing instead of granting
admin. Or a required field is sent with a typo and the validation
layer doesn't catch it because the field name doesn't match
*anything*.

Flip it on with the streaming decoder:

```go
dec := json.NewDecoder(bytes.NewReader(src))
dec.DisallowUnknownFields()
err := dec.Decode(&r)
// err: json: unknown field "admin"
```

`DisallowUnknownFields` is `Decoder`-only — there's no
`Unmarshal`-with-strict-mode. The workaround for batch decoding:

```go
func unmarshalStrict(data []byte, v any) error {
    dec := json.NewDecoder(bytes.NewReader(data))
    dec.DisallowUnknownFields()
    return dec.Decode(v)
}
```

Use it for any input you control the schema of. Don't use it for
inputs that legitimately have extra fields (third-party webhooks,
forward-compatible APIs).

## 10. Polymorphic decoding with a type discriminator

JSON has no built-in notion of "this object is a Foo, that one is a
Bar." You add a discriminator field — a string with the type name —
and a small dispatch table:

```go
type Event interface {
    isEvent()
}

type OrderPlaced struct {
    OrderID string `json:"order_id"`
    Total   int    `json:"total"`
}
func (OrderPlaced) isEvent() {}

type ItemShipped struct {
    OrderID string `json:"order_id"`
    Carrier string `json:"carrier"`
}
func (ItemShipped) isEvent() {}

type envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

func decodeEvent(b []byte) (Event, error) {
    var env envelope
    if err := json.Unmarshal(b, &env); err != nil {
        return nil, err
    }
    var ev Event
    switch env.Type {
    case "order_placed":
        var v OrderPlaced
        if err := json.Unmarshal(env.Payload, &v); err != nil {
            return nil, err
        }
        ev = v
    case "item_shipped":
        var v ItemShipped
        if err := json.Unmarshal(env.Payload, &v); err != nil {
            return nil, err
        }
        ev = v
    default:
        return nil, fmt.Errorf("unknown event type %q", env.Type)
    }
    return ev, nil
}
```

The pattern:

1. Wrap every event in an envelope with a `type` discriminator.
2. Decode the envelope; the payload is `RawMessage`.
3. Switch on `type`; decode the payload into the right concrete type.

The marriage to `RawMessage` is what makes this efficient. Without
it, you'd need two passes over the bytes — once to find the type,
once to decode the payload — or a `map[string]any` intermediate that
allocates and loses precision.

For the marshal direction:

```go
func encodeEvent(ev Event) ([]byte, error) {
    var typ string
    switch ev.(type) {
    case OrderPlaced: typ = "order_placed"
    case ItemShipped: typ = "item_shipped"
    default: return nil, fmt.Errorf("unknown event %T", ev)
    }
    payload, err := json.Marshal(ev)
    if err != nil { return nil, err }
    return json.Marshal(envelope{Type: typ, Payload: payload})
}
```

A common variant: the discriminator is a sibling of the data fields,
not in a separate `payload` object. Then you decode twice — once
into the envelope to find the type, once into the concrete type from
the same bytes:

```go
type envelope struct{ Type string `json:"type"` }

func decodeEvent(b []byte) (Event, error) {
    var env envelope
    if err := json.Unmarshal(b, &env); err != nil {
        return nil, err
    }
    switch env.Type {
    case "order_placed":
        var v OrderPlaced
        if err := json.Unmarshal(b, &v); err != nil {
            return nil, err
        }
        return v, nil
    // ...
    }
}
```

Two unmarshals on the same bytes — slightly more work, but the
input format is flatter.

## 11. The "either string or array" pattern

Many APIs use a field that's a single string when there's one value
and an array of strings when there are several. Decode into a wrapper
type with a custom `UnmarshalJSON`:

```go
type Strings []string

func (s *Strings) UnmarshalJSON(b []byte) error {
    if len(b) > 0 && b[0] == '[' {
        var arr []string
        if err := json.Unmarshal(b, &arr); err != nil {
            return err
        }
        *s = arr
        return nil
    }
    var single string
    if err := json.Unmarshal(b, &single); err != nil {
        return err
    }
    *s = []string{single}
    return nil
}
```

Same shape for "either object or array of objects," "either int or
string-encoded int," etc. The skeleton is always:

1. Look at the first non-whitespace byte to dispatch.
2. Unmarshal into the matching shape via `json.Unmarshal`.
3. Convert into the canonical Go form.

Don't pre-trim whitespace — `json.Unmarshal` handles it. Don't peel
off quotes by hand — let it do that too.

## 12. `time.Duration` as a JSON string

Recall the trap from junior.md: `time.Duration` is `int64` of
nanoseconds, so JSON serializes it as a giant integer. The fix:

```go
type Duration time.Duration

func (d Duration) MarshalJSON() ([]byte, error) {
    return json.Marshal(time.Duration(d).String())
}

func (d *Duration) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil {
        // Allow numeric nanoseconds too.
        var n int64
        if err2 := json.Unmarshal(b, &n); err2 == nil {
            *d = Duration(n)
            return nil
        }
        return err
    }
    parsed, err := time.ParseDuration(s)
    if err != nil { return err }
    *d = Duration(parsed)
    return nil
}
```

Now `"5s"`, `"500ms"`, `"1h30m"` all round-trip cleanly. The
unmarshal path also accepts a raw integer for backward compatibility
with old configs.

A common alternative is to keep the field as `time.Duration` in your
domain types and convert at the JSON boundary in a "config DTO":

```go
type rawConfig struct {
    Timeout string `json:"timeout"`
}
type Config struct {
    Timeout time.Duration
}

func (c *Config) UnmarshalJSON(b []byte) error {
    var raw rawConfig
    if err := json.Unmarshal(b, &raw); err != nil {
        return err
    }
    d, err := time.ParseDuration(raw.Timeout)
    if err != nil { return err }
    c.Timeout = d
    return nil
}
```

Either pattern works. Which to pick is mostly a question of how many
duration fields you have and whether the wire type matches the
domain type.

## 13. Validation during unmarshal

Custom `UnmarshalJSON` is the right place to validate input. The
shape:

```go
type Email string

func (e *Email) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil {
        return err
    }
    if !strings.Contains(s, "@") {
        return fmt.Errorf("invalid email %q", s)
    }
    *e = Email(s)
    return nil
}
```

Two cautions:

1. **Don't mutate `*e` until you've validated.** A failure in the
   middle of `UnmarshalJSON` leaves the receiver half-updated, which
   leaks invariant violations to callers that don't check the error.
2. **Wrap the validation error** so callers can `errors.Is`/`As` it
   for typed handling. Returning a plain `errors.New` collapses all
   field errors into one bucket.

The decoder wraps your error with field-path context automatically
when the failure happens during a struct decode — your error becomes
`json: cannot unmarshal ... into Go struct field UpdateUser.email of
type main.Email`. You don't need to add the field name yourself.

## 14. The pointer-receiver gotcha for `MarshalJSON`

This catches everyone exactly once:

```go
type T struct{ ... }

func (t *T) MarshalJSON() ([]byte, error) { ... } // pointer receiver

x := T{}
b, _ := json.Marshal(x)  // calls the default struct marshaler!
b, _ = json.Marshal(&x)  // calls T.MarshalJSON
```

Why: Go's method set rules. A value of type `T` does not have
pointer-receiver methods in its method set. The encoder asks "does
`T` implement `Marshaler`?" — and the answer is no, because
`MarshalJSON` is on `*T`. The encoder falls back to the default.

The fix is one of:

1. **Make `MarshalJSON` a value receiver** unless it has to mutate
   `t`. Almost always, it doesn't.
2. **Always pass a pointer** to `Marshal` and `Encode`. Hard to
   enforce on indirect calls (struct fields, slices).
3. **For struct fields**, use `*T` so the field already holds a
   pointer.

The cleanest convention: `MarshalJSON` on value, `UnmarshalJSON` on
pointer. The encoder finds it from either side; the decoder needs
the pointer anyway because it mutates.

```go
func (t T) MarshalJSON() ([]byte, error)    { ... }
func (t *T) UnmarshalJSON(b []byte) error   { ... }
```

## 15. `json.MarshalerError`

When a custom `MarshalJSON` returns an error, the encoder wraps it:

```go
type MarshalerError struct {
    Type reflect.Type
    Err  error
    sourceFunc string
}

func (e *MarshalerError) Error() string
func (e *MarshalerError) Unwrap() error
```

Use `errors.Unwrap` or `errors.As` to get back the original error
your `MarshalJSON` returned:

```go
b, err := json.Marshal(v)
if err != nil {
    var me *json.MarshalerError
    if errors.As(err, &me) {
        log.Printf("custom marshaler for %v failed: %v", me.Type, me.Err)
    }
}
```

This matters in production because by default the wrapper's `Error`
string includes a Go type name (`main.Order`), which leaks
implementation details into client error messages. Strip them at the
API boundary.

## 16. Encoding maps with deterministic key order

`json.Marshal` on a `map[string]V` sorts the keys lexicographically.
This is documented behavior — useful for canonical encodings,
content-addressed caching, signing payloads:

```go
m := map[string]int{"b": 2, "a": 1, "c": 3}
b, _ := json.Marshal(m)
// {"a":1,"b":2,"c":3}
```

If your key type is non-string and uses `TextMarshaler`, the keys
are sorted by their text form, then encoded.

This is a key reason to prefer maps to anonymous structs when you
need a stable canonical form: structs serialize fields in declaration
order, which is fragile (someone reorders the struct, your hash
changes). Maps serialize in sort order, which is stable across
refactors.

## 17. The `json.Valid` cheap pre-check

```go
ok := json.Valid([]byte(`{"a":1}`)) // true
ok = json.Valid([]byte(`{not json}`)) // false
```

`Valid` parses the bytes without building a Go value — much cheaper
than `Unmarshal` into `interface{}` if all you want to know is "is
this JSON?". Use it as a guard before passing bytes to `RawMessage`,
or as a quick sanity check on third-party payloads before you do
work on them.

It doesn't tell you *what's* wrong (no `SyntaxError` with offset).
For diagnostics, use `Unmarshal` and capture the typed error.

## 18. `json.Decoder.Buffered`

After `Decoder.Decode`, the decoder may hold bytes it read past the
end of the value. To get them back (e.g., to switch to a different
parser):

```go
dec := json.NewDecoder(r)
var hdr Header
dec.Decode(&hdr)

// The remaining stream, reconstructed as an io.Reader.
rest := io.MultiReader(dec.Buffered(), r)
```

Useful when a wire format starts with a JSON header followed by raw
bytes (a chunked download), or when you want to hand the rest of the
stream off to another component.

## 19. A real-world "robust API client" pattern

Putting the pieces together:

```go
type Client struct {
    http *http.Client
    base string
}

func (c *Client) Do(ctx context.Context, method, path string, in, out any) error {
    var body io.Reader
    if in != nil {
        b, err := json.Marshal(in)
        if err != nil { return fmt.Errorf("marshal request: %w", err) }
        body = bytes.NewReader(b)
    }

    req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
    if err != nil { return err }
    if body != nil {
        req.Header.Set("Content-Type", "application/json")
    }
    req.Header.Set("Accept", "application/json")

    resp, err := c.http.Do(req)
    if err != nil { return err }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()

    // Cap the response body to defend against runaway servers.
    limited := io.LimitReader(resp.Body, 10<<20) // 10 MiB

    if resp.StatusCode >= 400 {
        var apiErr APIError
        if err := json.NewDecoder(limited).Decode(&apiErr); err != nil {
            return fmt.Errorf("status %d, decode error: %w", resp.StatusCode, err)
        }
        return &apiErr
    }

    if out != nil {
        dec := json.NewDecoder(limited)
        dec.DisallowUnknownFields()
        if err := dec.Decode(out); err != nil {
            return fmt.Errorf("decode response: %w", err)
        }
    }
    return nil
}
```

Pieces from this leaf and the next:

- `json.Marshal` for the request body.
- `Decoder` for the response (no full buffer).
- `DisallowUnknownFields` to surface schema drift early.
- `LimitReader` from `io` to cap memory.
- `io.Copy(io.Discard, resp.Body)` to drain so the connection is
  reusable.

That shape covers maybe 80% of API clients in production Go code.

## 20. Common middle-tier mistakes

| Symptom | Likely cause |
|---------|--------------|
| Custom `MarshalJSON` not called | Pointer receiver but value passed to `Marshal` |
| `json: error calling MarshalJSON ... encountered a cycle` | Recursive `json.Marshal(t)` inside `(t T) MarshalJSON`; use type alias |
| Trailing newline in `Encoder` output unwanted | Strip it, or use `Marshal` + `Write` instead |
| Tokens out of order from `Decoder.Token` | Mixed `Token` and `Decode` calls without state-tracking; see senior.md |
| `RawMessage` data corrupted later | Aliased the decoder's buffer; copy with `append([]byte{}, raw...)` |
| `DisallowUnknownFields` rejects fields you do want | Forward-compatibility broken; either accept extras or freeze the schema |
| `omitempty` doesn't omit a struct/time | Documented behavior; use `*T` for true optional |

## 21. What to read next

- [senior.md](senior.md) — the exact tag and embedding rules,
  `json.Number`, the `Token` state machine, error positions,
  encoding cycles.
- [professional.md](professional.md) — schema versioning, defensive
  limits, structured error envelopes, redaction.
- [find-bug.md](find-bug.md) — drills based on the traps in this
  file, especially the pointer-receiver and `RawMessage` aliasing
  ones.
- [tasks.md](tasks.md) — exercises that build a polymorphic decoder,
  an NDJSON client, and a JSON-merge-patch implementation.
