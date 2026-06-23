# 8.4 `encoding/json` — Find the Bug

> Fourteen short snippets, each with a real `encoding/json` bug.
> Read the snippet, identify the bug, then check the analysis. Some
> are silent data corruption; some are panics; some are subtle logic
> bugs that pass tests but break in production.

## Bug 1 — The big-integer trap

```go
func parseRequest(body []byte) (int64, error) {
    var m map[string]any
    if err := json.Unmarshal(body, &m); err != nil {
        return 0, err
    }
    return int64(m["account_id"].(float64)), nil
}

// body: {"account_id":9007199254740993}
// returns: 9007199254740992  (off by one!)
```

**Bug.** `Unmarshal` into `interface{}` decodes JSON numbers as
`float64`. The JSON literal `9007199254740993` is bigger than 2^53,
the largest integer representable in IEEE 754 double precision. The
parsed `float64` is `9.007199254740992e+15`, and the `int64`
conversion loses the extra unit. The value silently corrupts.

**Fix.** Use `Decoder.UseNumber()` and parse explicitly, or decode
into a typed struct field of `int64`:

```go
type Req struct{ AccountID int64 `json:"account_id"` }
var r Req
json.Unmarshal(body, &r) // exact
```

## Bug 2 — `omitempty` on a struct field

```go
type Audit struct {
    Created time.Time `json:"created,omitempty"`
}

a := Audit{} // zero time
b, _ := json.Marshal(a)
fmt.Println(string(b))
// {"created":"0001-01-01T00:00:00Z"}
```

**Bug.** `omitempty` doesn't omit zero structs. `time.Time` is a
struct, and the zero time is a valid struct value, so it's
serialized. The field always appears with the zero date even when
the user expected it to be omitted.

**Fix.** Use `*time.Time` so `nil` is the empty case:

```go
type Audit struct {
    Created *time.Time `json:"created,omitempty"`
}
```

## Bug 3 — Pointer-receiver `MarshalJSON` not invoked

```go
type Status struct{ code int }

func (s *Status) MarshalJSON() ([]byte, error) {
    return []byte(`"` + strconv.Itoa(s.code) + `"`), nil
}

type Resp struct{ Status Status `json:"status"` }

b, _ := json.Marshal(Resp{Status: Status{code: 7}})
fmt.Println(string(b))
// {"status":{}}  -- code is unexported, custom marshaler not called
```

**Bug.** Two bugs in one. The custom `MarshalJSON` is on `*Status`,
not `Status`, so the value-typed embedding in `Resp` doesn't see
it. The encoder takes the default struct path. Then `code` is
unexported, so it gets dropped, leaving `{}`.

**Fix.** Either change to value receiver, or store as a pointer in
`Resp`:

```go
func (s Status) MarshalJSON() ([]byte, error) { ... }
```

## Bug 4 — Lowercase Go field, no tag

```go
type User struct {
    ID    string
    email string // lowercase
}

u := User{ID: "u1", email: "a@b.com"}
b, _ := json.Marshal(u)
fmt.Println(string(b))
// {"ID":"u1"}  -- email silently dropped
```

**Bug.** Lowercase Go field names are unexported. `encoding/json`
can't read them via reflection and silently skips. The bug usually
hides because tests verify what's in the JSON, not what's missing.

**Fix.** Capitalize and tag:

```go
type User struct {
    ID    string `json:"id"`
    Email string `json:"email"`
}
```

## Bug 5 — `UnmarshalJSON` mutates before validation

```go
type Quantity int

func (q *Quantity) UnmarshalJSON(b []byte) error {
    var n int
    if err := json.Unmarshal(b, &n); err != nil {
        return err
    }
    *q = Quantity(n)         // mutate
    if n < 0 {
        return fmt.Errorf("negative quantity")
    }
    return nil
}
```

**Bug.** The receiver is updated **before** validation. A caller
that sees the error and continues anyway (e.g., logs and proceeds
with defaults) will be holding a `Quantity` with the negative
value. In a struct decode, sibling fields may already be filled in;
the mutation has leaked invariant violations into the partial
result.

**Fix.** Validate first, mutate last:

```go
func (q *Quantity) UnmarshalJSON(b []byte) error {
    var n int
    if err := json.Unmarshal(b, &n); err != nil {
        return err
    }
    if n < 0 {
        return fmt.Errorf("negative quantity")
    }
    *q = Quantity(n)
    return nil
}
```

## Bug 6 — `Encoder` without `Flush`

```go
func writeAll(path string, items []Item) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()

    bw := bufio.NewWriter(f)
    enc := json.NewEncoder(bw)
    for _, it := range items {
        if err := enc.Encode(it); err != nil {
            return err
        }
    }
    return nil
}
```

**Bug.** `bufio.Writer` buffers. Without `bw.Flush()`, the trailing
chunk of data sits in the buffer and never reaches the file. You'll
see a truncated file every time. `f.Close()` doesn't flush bufio's
buffer — they're separate layers.

**Fix.**

```go
defer func() {
    if ferr := bw.Flush(); err == nil {
        err = ferr
    }
}()
```

(Or skip the `bufio.Writer` entirely — `json.Encoder` already
buffers internally per `Encode` call.)

## Bug 7 — `RawMessage` aliasing the decoder buffer

```go
func parseEnvelopes(r io.Reader) ([]json.RawMessage, error) {
    dec := json.NewDecoder(r)
    var out []json.RawMessage
    for {
        var raw json.RawMessage
        if err := dec.Decode(&raw); err != nil {
            if err == io.EOF { break }
            return nil, err
        }
        out = append(out, raw)
    }
    return out, nil
}
```

**Bug.** `json.RawMessage` returned from `Decoder.Decode` aliases
the decoder's internal buffer. When the decoder reads more bytes,
it can overwrite the bytes the previous `RawMessage` points at. By
the time you process `out`, every entry may point at the same
trailing bytes.

(Whether this actually corrupts depends on internals — Go 1.22's
implementation copies into a per-field buffer for `RawMessage`, but
relying on that is fragile. The contract says: don't retain.)

**Fix.** Copy each `RawMessage` immediately:

```go
cp := make(json.RawMessage, len(raw))
copy(cp, raw)
out = append(out, cp)
```

## Bug 8 — Marshaling a cycle

```go
type Node struct {
    ID   string
    Next *Node
}

a := &Node{ID: "a"}
b := &Node{ID: "b"}
a.Next = b
b.Next = a // cycle

data, _ := json.Marshal(a)
```

**Bug.** Marshaling a cyclic structure used to stack-overflow; since
Go 1.20 it returns `*json.UnsupportedValueError("encountered a
cycle")`. Either way, the marshal fails. The bug is that the
domain model uses pointer cycles for graph navigation, but the
serialization needs to break them.

**Fix.** Marshal a serializable view:

```go
type NodeWire struct {
    ID     string
    NextID string `json:"next_id,omitempty"`
}

func (n *Node) Wire() NodeWire {
    w := NodeWire{ID: n.ID}
    if n.Next != nil { w.NextID = n.Next.ID }
    return w
}
```

ID-only references break the cycle. Reconstruct on the read side
via a lookup map.

## Bug 9 — `Decoder` reading too much

```go
func parseHeader(r io.Reader) (Header, error) {
    var h Header
    dec := json.NewDecoder(r)
    if err := dec.Decode(&h); err != nil {
        return h, err
    }
    return h, nil
}

// Caller then tries to read the rest:
hdr, _ := parseHeader(r)
body, _ := io.ReadAll(r) // missing some bytes!
```

**Bug.** `json.Decoder` reads ahead into its internal buffer for
efficiency. After `Decode`, it may have consumed bytes from `r`
that belong to the rest of the stream. The caller's subsequent
`io.ReadAll(r)` misses those bytes.

**Fix.** Use `Decoder.Buffered()` and stitch:

```go
rest := io.MultiReader(dec.Buffered(), r)
body, _ := io.ReadAll(rest)
```

## Bug 10 — Comparing `RawMessage` with `==`

```go
type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

if env.Payload == json.RawMessage("null") {
    // never compiles, or never matches
}
```

**Bug.** `json.RawMessage` is `[]byte`. Slice values can't be
compared with `==`; the only legal `==` for slices is against
`nil`. Even when this compiles (against a single `nil`), comparing
two `[]byte`s with `==` gives the wrong answer (compares pointers,
not contents).

**Fix.**

```go
if bytes.Equal(env.Payload, []byte("null")) { ... }
```

Or `string(env.Payload) == "null"` for short comparisons.

## Bug 11 — HTTP body not drained before next request

```go
func (c *Client) checkOnce() error {
    resp, err := c.http.Get("/health")
    if err != nil { return err }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    var v Health
    return json.NewDecoder(resp.Body).Decode(&v)
}
```

**Bug.** When the status check fails, the body is closed without
being read. The HTTP client cannot reuse the underlying TCP
connection because there are unread bytes pending. Under load, the
client opens a new connection per failed health check, exhausting
file descriptors and TIME_WAIT sockets.

**Fix.** Always drain before close:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

## Bug 12 — Treating `SyntaxError` as recoverable

```go
dec := json.NewDecoder(stream)
for {
    var v Event
    if err := dec.Decode(&v); err != nil {
        if errors.Is(err, io.EOF) { break }
        log.Printf("skipping bad event: %v", err)
        continue // hope for the best
    }
    process(v)
}
```

**Bug.** A `*json.SyntaxError` puts the decoder in an undefined
state. The next `Decode` may produce garbage, hang, or report a
new error from the wrong place. You can't simply skip a malformed
event and continue — the decoder doesn't have a "skip to next
value" primitive in this state.

**Fix.** Either treat parse errors as fatal (close the stream and
return), or use a line-oriented format like NDJSON and read the
next line into a fresh decoder:

```go
sc := bufio.NewScanner(stream)
sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
for sc.Scan() {
    var v Event
    if err := json.Unmarshal(sc.Bytes(), &v); err != nil {
        log.Printf("skipping bad line: %v", err)
        continue
    }
    process(v)
}
```

## Bug 13 — Tag typo silently ignored

```go
type Item struct {
    Name string `json:"name"`
    Cost int    `json:"cost,omitempt"` // typo
}

i := Item{Name: "x", Cost: 0}
b, _ := json.Marshal(i)
fmt.Println(string(b))
// {"name":"x","cost":0}  -- "cost" is always present, defeating the intent
```

**Bug.** Unknown tag options are silently ignored. The typo
`omitempt` (missing `y`) is treated as no option at all, and the
field is always serialized. Tests that check "the field is omitted
when zero" pass against the original code but break after a
typo-induced regression.

**Fix.** Code review, or a static analyzer (`golangci-lint` with
the right linter) that checks struct tags. If you wrote the
typed code yourself, run `go vet` — it catches some struct tag
errors but not all.

## Bug 14 — `MarshalJSON` on embedded type swallowing the outer struct

```go
type ID struct{ Value string }

func (i ID) MarshalJSON() ([]byte, error) {
    return []byte(`"` + i.Value + `"`), nil
}

type Resource struct {
    ID
    Name string `json:"name"`
}

b, _ := json.Marshal(Resource{ID: ID{"r-1"}, Name: "thing"})
fmt.Println(string(b))
// "r-1"  -- Name is gone!
```

**Bug.** Embedding a type that implements `Marshaler` promotes the
method onto the outer type. The encoder calls `Resource.MarshalJSON`
(inherited from `ID`) and ignores `Name` entirely. The output is
just the embedded type's representation.

**Fix.** Make the embed a named field:

```go
type Resource struct {
    ID   ID     `json:"id"`
    Name string `json:"name"`
}
// Output: {"id":"r-1","name":"thing"}
```

Or override `MarshalJSON` on `Resource` to do what you want:

```go
func (r Resource) MarshalJSON() ([]byte, error) {
    type alias Resource
    return json.Marshal(alias(r))
}
```

## Drill yourself

For each bug:

1. Read only the snippet (cover the analysis). Try to spot the bug
   in 30 seconds.
2. Predict the actual output before reading the analysis.
3. After reading the fix, write it from memory.
4. Find a similar bug in your own codebase (you'll find at least
   one).

The bugs cluster into themes:

- **Type mismatch / silent coercion** (1, 4, 13).
- **`omitempty` and zero-value definition** (2).
- **Method-set surprises** (3, 14).
- **Receiver mutation order** (5).
- **Buffer ownership** (6, 7, 9).
- **HTTP and `Decoder` lifecycle** (11, 12).
- **Domain-model fit** (8).
- **API misuse** (10).

When debugging real `encoding/json` mysteries, walk this list as a
checklist. Most production bugs we see are one of these.
