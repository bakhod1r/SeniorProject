# 8.4 `encoding/json` — Professional

> **Audience.** You're shipping JSON APIs and pipelines that handle
> real traffic, accept untrusted input, and have to evolve without
> breaking clients. This file is the production playbook: schema
> versioning, defensive limits, structured error responses,
> large-payload streaming, and secret redaction in logs.

## 1. Schema versioning via tags

There are two common patterns for evolving a JSON schema without
breaking older clients:

### Additive evolution (preferred)

Add new optional fields. Old clients ignore them; new clients use
them. Existing fields keep their semantics forever.

```go
// v1
type User struct {
    ID    string `json:"id"`
    Email string `json:"email"`
}

// v2 — adds Phone, doesn't change anything else
type User struct {
    ID    string `json:"id"`
    Email string `json:"email"`
    Phone string `json:"phone,omitempty"` // new in v2
}
```

`omitempty` keeps the v1 wire format byte-identical when `Phone` is
empty. Old clients ignoring `Phone` still work.

### Versioned envelope

For breaking changes, wrap the payload in an envelope with an
explicit version:

```go
type Envelope struct {
    Version int             `json:"version"`
    Payload json.RawMessage `json:"payload"`
}

func decode(b []byte) (any, error) {
    var env Envelope
    if err := json.Unmarshal(b, &env); err != nil {
        return nil, err
    }
    switch env.Version {
    case 1:
        var v UserV1
        return v, json.Unmarshal(env.Payload, &v)
    case 2:
        var v UserV2
        return v, json.Unmarshal(env.Payload, &v)
    default:
        return nil, fmt.Errorf("unsupported version %d", env.Version)
    }
}
```

`RawMessage` is what makes the dispatch single-pass — you decode the
envelope, then decode the payload into the right concrete type. No
intermediate `map[string]any`.

The two patterns mix. Most services do additive evolution within a
major version and bump the envelope version only for genuinely
incompatible changes (renamed fields, removed fields, changed
semantics).

## 2. Backwards-compatible request decoding

Old clients send the v1 shape. New clients send the v2 shape. Your
handler accepts both:

```go
type CreateUserRequest struct {
    Email string `json:"email"`
    Phone string `json:"phone,omitempty"`
    // Legacy v1 field name; new clients send "phone".
    PhoneLegacy string `json:"phone_number,omitempty"`
}

func (r *CreateUserRequest) Normalize() {
    if r.Phone == "" && r.PhoneLegacy != "" {
        r.Phone = r.PhoneLegacy
    }
    r.PhoneLegacy = "" // don't propagate
}
```

Decode then normalize. The normalization step centralizes
"accept the old name, expose only the new name" logic so the rest
of the handler doesn't deal with it.

For deprecation of an old field, keep it accepting input for a
documented window, log when it's used, then remove it after metrics
say no clients still send it. **Don't delete a field on the same
release you ship its replacement.**

## 3. Defensive limits: `MaxBytesReader` before `Decoder`

Untrusted JSON can be arbitrarily large or arbitrarily deeply
nested. Both can exhaust memory. The first defense is a body-size
cap:

```go
const maxBody = 1 << 20 // 1 MiB

func handler(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, maxBody)
    defer r.Body.Close()

    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()

    var req CreateUserRequest
    if err := dec.Decode(&req); err != nil {
        // err is wrapped in *http.MaxBytesError if the cap was hit.
        var maxErr *http.MaxBytesError
        if errors.As(err, &maxErr) {
            http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
            return
        }
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    // ...
}
```

`http.MaxBytesReader` (since Go 1.19, returning `*http.MaxBytesError`)
is the standard, server-aware wrapper:

- Limits how many bytes can be read from the request body.
- Tells the connection to close after the limit is hit (so a
  misbehaving client can't keep pumping bytes past the cap).
- Returns a typed error that `errors.As` recognizes.

This is the right place for the limit, not inside business logic.
Apply it at the handler boundary so every code path benefits.

For batch decoding (no `Decoder`), use `io.LimitReader` and check
the result length:

```go
limited := io.LimitReader(r.Body, maxBody+1)
data, err := io.ReadAll(limited)
if err != nil { return err }
if int64(len(data)) > maxBody {
    return errors.New("payload too large")
}
```

The `+1` lets you distinguish "exactly at the cap" from "more than
the cap."

## 4. Depth limits

JSON has no depth limit in the spec; `encoding/json` has a built-in
recursion bound of 10000 (constants buried in the source). For
adversarial inputs, this is too high — a deeply nested object with
10000 levels of `{` consumes substantial stack space and time.

The package-level limit isn't user-configurable. To enforce a
tighter bound, walk the input first with `Decoder.Token`:

```go
func validateDepth(r io.Reader, max int) error {
    dec := json.NewDecoder(r)
    depth := 0
    for {
        tok, err := dec.Token()
        if err == io.EOF { return nil }
        if err != nil { return err }
        if d, ok := tok.(json.Delim); ok {
            switch d {
            case '{', '[':
                depth++
                if depth > max {
                    return fmt.Errorf("max depth %d exceeded", max)
                }
            case '}', ']':
                depth--
            }
        }
    }
}
```

The downside: this walks the input once for validation, then your
real decoder walks it again. For high-volume endpoints, that's
wasteful. The pragmatic alternative is to enforce depth via a body
size limit (a `1 MiB` cap implies depth bounds, since each nesting
level needs at least one byte) and let the package's hard cap
handle pathological cases.

## 5. Structured error responses

A consistent error envelope makes API errors machine-readable and
client-friendly. The minimum:

```go
type APIError struct {
    Code    string            `json:"code"`
    Message string            `json:"message"`
    Details map[string]string `json:"details,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, msg string, details map[string]string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(APIError{
        Code:    code,
        Message: msg,
        Details: details,
    })
}
```

Two production refinements:

### Map decoder errors to API errors

```go
func decodeRequest(r *http.Request, v any) (status int, code string, err error) {
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    if err := dec.Decode(v); err != nil {
        var se *json.SyntaxError
        var ue *json.UnmarshalTypeError
        var me *http.MaxBytesError
        switch {
        case errors.As(err, &me):
            return http.StatusRequestEntityTooLarge, "request_too_large", err
        case errors.As(err, &se):
            return http.StatusBadRequest, "invalid_json",
                fmt.Errorf("invalid JSON at byte %d: %w", se.Offset, err)
        case errors.As(err, &ue):
            return http.StatusBadRequest, "invalid_field",
                fmt.Errorf("field %q: expected %v, got %s", ue.Field, ue.Type, ue.Value)
        case strings.HasPrefix(err.Error(), "json: unknown field"):
            return http.StatusBadRequest, "unknown_field", err
        case errors.Is(err, io.EOF):
            return http.StatusBadRequest, "empty_body", errors.New("empty request body")
        default:
            return http.StatusBadRequest, "decode_error", err
        }
    }
    return 0, "", nil
}
```

The "unknown field" check via `strings.HasPrefix` is the only string
match — `DisallowUnknownFields` doesn't return a typed error. Annoying
but stable across Go versions.

### Don't leak Go types into client errors

By default, `UnmarshalTypeError.Type` is a `reflect.Type` whose
`String()` looks like `main.User`. That leaks your package and type
names. Map to user-friendly names at the boundary:

```go
typeNames := map[reflect.Type]string{
    reflect.TypeOf(""):        "string",
    reflect.TypeOf(0):         "integer",
    reflect.TypeOf(false):     "boolean",
    reflect.TypeOf(time.Time{}): "timestamp",
}
```

Ditto for the `Field` path — fine for internal logs, summarize for
user-visible messages.

## 6. Large-payload streaming

For responses big enough that buffering them all in memory would be
painful, stream with `Encoder` and `Flusher`:

```go
func (s *Server) ExportUsers(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/x-ndjson")
    fl, _ := w.(http.Flusher)
    enc := json.NewEncoder(w)

    rows, err := s.db.QueryContext(r.Context(), "SELECT id,email FROM users")
    if err != nil {
        http.Error(w, "db error", http.StatusInternalServerError)
        return
    }
    defer rows.Close()

    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Email); err != nil {
            return
        }
        if err := enc.Encode(u); err != nil {
            return
        }
        if fl != nil { fl.Flush() }
    }
}
```

Memory stays at one row's worth, regardless of table size. The
client streams in NDJSON and processes each line as it arrives.

For very large responses (gigabytes), pair the streaming encoder
with `gzip.NewWriter`:

```go
w.Header().Set("Content-Encoding", "gzip")
gw := gzip.NewWriter(w)
defer gw.Close()

enc := json.NewEncoder(gw)
for /* rows */ {
    enc.Encode(row)
}
```

The encoder writes uncompressed JSON into the gzip writer, which
compresses and streams to the response. Both stay flat in memory.

A common bug: forgetting to close the gzip writer leaves the gzip
trailer unwritten and the response is unparseable on the client.
Use `defer gw.Close()` and check the error if it matters.

## 7. NDJSON for response chunking

When a single logical response is too big to ship as one JSON value
(or when you want to start sending while still computing later
parts), chunk it as NDJSON:

```go
// Server side: write a header, then a stream of items, then a footer.
type Header struct{ Total int `json:"total"` }
type Item struct{ ID string `json:"id"` }
type Footer struct{ Done bool `json:"done"` }

enc := json.NewEncoder(w)
enc.Encode(Header{Total: total})
for _, it := range items {
    enc.Encode(it)
    if fl != nil { fl.Flush() }
}
enc.Encode(Footer{Done: true})
```

Clients decode in order and dispatch by shape. The pattern composes
with progress reporting, partial failure (write an error line and
continue), and reconnection (the client knows the last `id` it saw).

## 8. Polymorphic responses without type discriminators

Sometimes you can't add a discriminator field (a third-party schema,
a strict spec). The fallback: detect by required fields.

```go
type Order struct {
    OrderID string `json:"order_id"`
    Total   int    `json:"total"`
}
type Refund struct {
    RefundID string `json:"refund_id"`
    Amount   int    `json:"amount"`
}

func decode(b []byte) (any, error) {
    var probe struct {
        OrderID  string `json:"order_id"`
        RefundID string `json:"refund_id"`
    }
    if err := json.Unmarshal(b, &probe); err != nil {
        return nil, err
    }
    switch {
    case probe.OrderID != "":
        var o Order
        return o, json.Unmarshal(b, &o)
    case probe.RefundID != "":
        var r Refund
        return r, json.Unmarshal(b, &r)
    default:
        return nil, errors.New("unrecognized payload")
    }
}
```

Two passes over the bytes, but the probe pass is cheap (it
ignores fields it doesn't care about). For high-volume endpoints,
push the producer to add a discriminator field — it's worth the
schema change.

## 9. Validation layers

`encoding/json` does syntactic validation (is this JSON?) and weak
structural validation (does this fit the Go type?). It does *not*
validate domain rules. You need a layer for those.

Two patterns:

### Validate inline in `UnmarshalJSON`

```go
type Username string

func (u *Username) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil { return err }
    if len(s) < 3 || len(s) > 32 {
        return fmt.Errorf("username length must be 3..32 (got %d)", len(s))
    }
    if !validUsernameRE.MatchString(s) {
        return fmt.Errorf("username contains invalid characters")
    }
    *u = Username(s)
    return nil
}
```

Pros: validation happens at decode time, no separate pass. Cons:
errors come out one at a time (the decoder stops at the first); hard
to surface multiple field errors together.

### Validate after decode

```go
func (r *CreateUserRequest) Validate() error {
    var errs []error
    if len(r.Email) == 0 || !strings.Contains(r.Email, "@") {
        errs = append(errs, errors.New("email is required and must contain @"))
    }
    if len(r.Username) < 3 {
        errs = append(errs, errors.New("username must be at least 3 chars"))
    }
    return errors.Join(errs...)
}
```

Pros: collect all errors in one pass, surface them together. Cons:
two passes over the data (decode + validate), slightly more code.

For user-facing APIs, the second pattern is usually better — your
error response can list every problem the user needs to fix, not
just the first one. Combine with `errors.Join` (Go 1.20+) and a
walker that maps each error to a field path.

## 10. Secret redaction in logs

The most common production JSON bug: logging a struct that contains
a password or API token. The default `log.Printf("%+v", req)` will
happily print the secret.

Three layers of defense:

### Custom `MarshalJSON` that redacts

```go
type Password string

func (p Password) MarshalJSON() ([]byte, error) {
    return []byte(`"[REDACTED]"`), nil
}

func (p *Password) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil { return err }
    *p = Password(s)
    return nil
}
```

Now any `json.Marshal` of a `Password` returns `"[REDACTED]"`, and
the value can still be read by your business logic via direct field
access.

### Custom `String()` for `%v` logging

```go
func (p Password) String() string  { return "[REDACTED]" }
func (p Password) GoString() string { return "[REDACTED]" }
```

`fmt`'s `%v` and `%+v` use `String()` if the type implements it.
`%#v` uses `GoString()`. With both methods, your password is safe
from any common logger format.

### Strip secrets at the boundary

Before logging a request struct, copy it into a redacted DTO:

```go
type loggableRequest CreateUserRequest

func (r CreateUserRequest) Loggable() loggableRequest {
    r.Password = ""
    return loggableRequest(r)
}

log.Printf("request: %+v", req.Loggable())
```

Combine all three: custom marshaler for hard-to-miss safety, custom
String for `%v` traps, and explicit redaction at the boundary for
clarity.

## 11. Idempotency and request hashing

For idempotent endpoints, clients send a `Idempotency-Key` header
plus a JSON body. The server hashes the body (after canonicalization)
to verify the key matches the same request:

```go
func canonicalJSON(v any) ([]byte, error) {
    // Marshal-then-decode-then-marshal canonicalizes via map sorting.
    b, err := json.Marshal(v)
    if err != nil { return nil, err }

    var m map[string]any
    if err := json.Unmarshal(b, &m); err != nil { return nil, err }

    var buf bytes.Buffer
    enc := json.NewEncoder(&buf)
    enc.SetEscapeHTML(false)
    if err := enc.Encode(m); err != nil { return nil, err }
    return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func hashBody(v any) (string, error) {
    b, err := canonicalJSON(v)
    if err != nil { return "", err }
    sum := sha256.Sum256(b)
    return hex.EncodeToString(sum[:]), nil
}
```

The trick is sorting object keys — `json.Marshal` on a `map` sorts
lexicographically, so re-marshaling through a map gives you a
canonical form. On a `struct`, fields serialize in declaration order,
which is fragile.

For floating-point precision-sensitive cases (financial, signed
payloads), use `json.Decoder.UseNumber()` and a custom
canonicalization that preserves exact digits.

## 12. Trailing data and the "extra bytes" check

A subtle production bug: the server accepts a JSON request with
trailing garbage:

```go
var req Req
err := json.Unmarshal([]byte(`{"x":1} extra-trash-here`), &req)
// err is nil! Trailing data is ignored.
```

`Unmarshal` parses the first JSON value and stops. Use the streaming
decoder if you want strict end-of-input:

```go
dec := json.NewDecoder(r.Body)
if err := dec.Decode(&req); err != nil { ... }

var trailing json.RawMessage
if err := dec.Decode(&trailing); err != io.EOF {
    return errors.New("unexpected trailing data")
}
```

A second `Decode` returning `io.EOF` confirms the input was exactly
one value. Anything else means the client sent extra bytes; reject
the request to surface client bugs early.

## 13. Time zones and timestamps

`time.Time` marshals as RFC 3339 with nanosecond precision and a
zone offset:

```go
t := time.Date(2026, 5, 6, 12, 0, 0, 0, time.FixedZone("EST", -5*3600))
b, _ := json.Marshal(t)
// "2026-05-06T12:00:00-05:00"
```

For wire interoperability:

- **Always emit UTC** in API responses unless the consumer explicitly
  needs the original zone. `t.UTC()` before marshaling.
- **Always parse without assuming a zone**. `time.Parse(time.RFC3339, s)`
  preserves the zone in the input; if the input lacks one, treat as
  UTC explicitly.
- **Strip nanoseconds** if the consumer is JavaScript or another
  language that loses them. `t.Truncate(time.Second)` before encode.
- **Use `time.Time` for UTC moments**; use a custom type for "wall
  clock in some zone" or "calendar date with no time" — those are
  not what `time.Time` is.

For dates without times, define your own:

```go
type Date struct{ time.Time }

func (d Date) MarshalJSON() ([]byte, error) {
    return json.Marshal(d.Format("2006-01-02"))
}
func (d *Date) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil { return err }
    t, err := time.Parse("2006-01-02", s)
    if err != nil { return err }
    d.Time = t
    return nil
}
```

## 14. Backwards compat with renamed fields

Renaming a field on the wire is a breaking change. To do it safely:

```go
type User struct {
    Email     string `json:"email"`           // new name
    EmailOld  string `json:"emailAddress,omitempty"` // accept old name on input
}

func (u *User) Normalize() {
    if u.Email == "" && u.EmailOld != "" {
        u.Email = u.EmailOld
    }
    u.EmailOld = "" // never serialize back
}
```

On output, `EmailOld` is zero so `omitempty` drops it. On input,
both names work. Run with metrics to track which clients still send
the old name; remove the alias when traffic drops to zero.

For the inverse (you want to send a new field name to clients
without breaking parsers that strict-validate field names): coordinate
with clients first, ship the new name in a new endpoint version,
keep the old endpoint serving the old shape.

## 15. Request and response logging at the boundary

A common middleware pattern: log every request and response body for
debugging. The naive implementation reads the body, logs it, then
hands a `bytes.Reader` to the handler:

```go
func logBody(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        body, _ := io.ReadAll(r.Body)
        log.Printf("request: %s", body)
        r.Body = io.NopCloser(bytes.NewReader(body))
        h.ServeHTTP(w, r)
    })
}
```

Three production refinements:

1. **Cap the log size.** A 100 MiB body shouldn't go into your logs.
   Read up to a cap, note if truncated.
2. **Redact** at this layer too — strip known sensitive fields
   before logging. `gjson` or a regex is the usual approach.
3. **Sample.** Logging every body of every request floods the log
   pipeline. Sample 1% in production, 100% in dev.

For responses, wrap the `ResponseWriter` to capture the body:

```go
type captureWriter struct {
    http.ResponseWriter
    buf    bytes.Buffer
    status int
}

func (c *captureWriter) WriteHeader(s int)            { c.status = s; c.ResponseWriter.WriteHeader(s) }
func (c *captureWriter) Write(p []byte) (int, error) {
    c.buf.Write(p)
    return c.ResponseWriter.Write(p)
}
```

Same caveats: cap the buffer, redact, sample.

## 16. A note on `encoding/json` and observability

Custom `MarshalJSON`/`UnmarshalJSON` are excellent points to attach
metrics — they run on every encode/decode of the type:

```go
var (
    decodeCount   atomic.Int64
    decodeLatency = newHistogram("decode_latency_seconds")
)

func (r *Request) UnmarshalJSON(b []byte) error {
    start := time.Now()
    defer func() {
        decodeCount.Add(1)
        decodeLatency.Observe(time.Since(start).Seconds())
    }()
    type alias Request
    var a alias
    if err := json.Unmarshal(b, &a); err != nil { return err }
    *r = Request(a)
    return nil
}
```

Use sparingly — every method call is overhead. Reserve for the few
types that are hot or that you suspect of latency anomalies.

## 17. What to read next

- [optimize.md](optimize.md) — when the production patterns are
  correct but the throughput isn't.
- [find-bug.md](find-bug.md) — production-shaped bugs to recognize.
- [interview.md](interview.md) — questions you should be able to
  answer cold.
