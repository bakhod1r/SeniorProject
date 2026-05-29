## 1. How to use this file

Fourteen buggy snippets of `encoding/json` use in Go: structs serialized over HTTP, decoders draining request bodies, marshallers crossing the JS/Go boundary, custom `MarshalJSON` and `UnmarshalJSON` implementations, time formats, byte slices, conflicting tags. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer.

`encoding/json` bugs almost never crash on the happy path. They silently drop a field because reflection skipped it, they round a 64-bit integer because JavaScript's number type is `float64`, they leave a connection un-reusable because the decoder didn't drain trailing whitespace, they call the *value* method instead of the *pointer* method and ship default formatting. Three questions to ask every snippet:

1. *What does `reflect.TypeOf(v)` see when the encoder/decoder walks this struct — exported fields only, with which tags?*
2. *Does the Go type carry more precision or different semantics than the JSON wire format can represent losslessly?*
3. *What happens to bytes left on the stream after `Decode` returns — and to bytes never written because of a silent skip?*

If a snippet can't answer all three, there's a bug. The references below point at the standard library at `src/encoding/json/encode.go` and `src/encoding/json/decode.go` for the canonical implementation behaviour.

---

## Bug 1 — Lowercase struct fields silently skipped by `Marshal`

```go
package main

import (
	"encoding/json"
	"fmt"
)

type User struct {
	id    int64   // BUG: unexported
	name  string  // BUG: unexported
	Email string
}

func main() {
	u := User{id: 7, name: "ada", Email: "ada@example.com"}
	b, _ := json.Marshal(u)
	fmt.Println(string(b)) // {"Email":"ada@example.com"}
}
```

<details><summary>Answer</summary>

**Bug:** `id` and `name` start with lowercase letters and are therefore *unexported*. `encoding/json`'s reflection walk in `encode.go` (`typeFields`) only considers fields where `f.PkgPath == ""` — the standard reflective test for "exported". Unexported fields are skipped silently; the marshaller emits only `Email`.

**Why subtle:** No error returned. No build warning. The output looks like a partial record, and the next service in the chain happily accepts the truncated payload. The producer "wrote it correctly" — Go just refused to read its own private fields.

**Reference:** `src/encoding/json/encode.go`, `typeFields(t reflect.Type)` filters via `sf.PkgPath != "" && !sf.Anonymous` — exactly the unexported test. Comments in that function explicitly call out the rule.

**Fix:** Export the fields and rename via tag if the wire format needs lowercase:

```go
type User struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}
```

**Why common:** "It's a private struct, lowercase is more idiomatic." True for in-process types — fatal once the struct crosses a `Marshal` boundary. The compiler can't help because there's nothing syntactically wrong; only the runtime behaviour is silently wrong.
</details>

---

## Bug 2 — `omitempty` on a struct field never omits

```go
package main

import (
	"encoding/json"
	"fmt"
	"time"
)

type Range struct {
	Start time.Time
	End   time.Time
}

type Query struct {
	UserID int    `json:"user_id"`
	Window Range  `json:"window,omitempty"` // BUG: zero struct is never "empty"
}

func main() {
	q := Query{UserID: 1} // Window left as zero value
	b, _ := json.Marshal(q)
	fmt.Println(string(b))
	// {"user_id":1,"window":{"Start":"0001-01-01T00:00:00Z","End":"0001-01-01T00:00:00Z"}}
}
```

<details><summary>Answer</summary>

**Bug:** `omitempty` does not consult a struct's "zero-ness" — it only treats the false-zero of the *built-in* `isEmptyValue` predicate as empty. That predicate (in `encode.go`) returns true for `false`, `0`, `nil` interface/pointer/map/slice, and empty string. A zero struct is *not* in that list. The `Window` field is rendered in full, including the year-1 timestamps that downstream consumers misinterpret as "epoch 0001".

**Why subtle:** `omitempty` *looks* applied. Tests with non-zero `Window` pass. Tests that omit `Window` produce a payload with a phantom zero range, and consumers happily accept it.

**Reference:** `src/encoding/json/encode.go`, `isEmptyValue(v reflect.Value)` — the canonical list of "empty" kinds. Struct is conspicuously absent. The Go 1.24 `omitzero` tag finally fixes this.

**Fix:** Use a pointer (`*Range`), or upgrade to Go 1.24+ and switch to `json:"window,omitzero"`:

```go
type Query struct {
	UserID int    `json:"user_id"`
	Window *Range `json:"window,omitempty"` // nil pointer is empty
}
```

**Why common:** Reading `omitempty` as "omit when zero" matches every other language's intuition. Go's stdlib chose a narrower definition and didn't fix it for fifteen years. Pointer-or-`omitzero` is the only safe path.
</details>

---

## Bug 3 — `int64` from a JS client silently rounded through `float64`

```go
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Txn struct {
	ID     int64 `json:"id"`
	Amount int64 `json:"amount"`
}

func main() {
	// Comes from a JavaScript client where Number is IEEE-754 double.
	raw := `{"id": 9007199254740993, "amount": 100}` // 2^53 + 1

	var t Txn
	_ = json.NewDecoder(strings.NewReader(raw)).Decode(&t)
	fmt.Println(t.ID)     // 9007199254740992 — rounded down
	fmt.Println(t.Amount) // 100
}
```

<details><summary>Answer</summary>

**Bug:** The JSON spec doesn't distinguish integer from float; JavaScript's `Number` is IEEE-754 binary64 — exact only up to 2^53. The Go decoder reads the number token as a string, then `strconv.ParseInt`s into the `int64` field — but the *producer* already lost precision because it serialized through `float64`. `9007199254740993` round-trips to `9007199254740992` *on the JS side* before it ever touches Go.

The Go-side bug isn't the rounding (which happens upstream) — it's accepting `int64` in the schema when the wire is JS, with no defence and no diagnostic. Real-world Twitter snowflake IDs hit this in 2009.

**Why subtle:** Numerically near 2^53, off-by-one. Below 2^53, exact. The test suite — and the producer's smoke check — usually picks small numbers. Production sees the bug six months in with one customer's ID.

**Reference:** `src/encoding/json/decode.go`, `(*decodeState).literalStore` for number tokens — and the package-level docs that warn `int64` values may not survive a JS round-trip and recommend `json.Number` or `string` tags. See also issue #34472 and the long-standing "JSON-RPC over the wire" lore.

**Fix:** Quote the integer as a string on both sides (`json:"id,string"` on Go, `BigInt.toString()` on JS), or use `json.Number` and never let `float64` touch the value:

```go
type Txn struct {
	ID     int64 `json:"id,string"`     // wire is "9007199254740993"
	Amount int64 `json:"amount,string"`
}
```

**Why common:** JSON looks like it has integers. JavaScript doesn't. The schema is silently wrong everywhere it crosses that boundary.
</details>

---

## Bug 4 — Unmarshal into `map[string]int` with mixed value types

```go
package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	raw := []byte(`{"a": 1, "b": "two", "c": 3}`)
	var m map[string]int
	if err := json.Unmarshal(raw, &m); err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println(m) // never reached
}
```

<details><summary>Answer</summary>

**Bug:** The decoder enforces the *value type* of the map. When it hits `"b": "two"`, it tries to fit a JSON string into an `int` slot and fails — `json: cannot unmarshal string into Go value of type int`. The map is left in whatever partial state the decoder reached before the error (impl-defined; treat as garbage). The caller often reads `m` anyway in the `err != nil` branch and gets confusing data.

**Why subtle:** The error message names the field type, not the *key*. `"cannot unmarshal string into Go value of type int"` doesn't tell you which key. Production logs show the error with no context; the offending key is left as an exercise. Worse: callers debug by rerunning with a different payload and never see the same key fail twice in a row.

**Reference:** `src/encoding/json/decode.go`, `(*decodeState).literalStore` — the type check that produces `*UnmarshalTypeError` carries the JSON value and Go type, but not the field path. The `UnmarshalTypeError.Field` is populated only for *struct* paths, not map keys.

**Fix:** Two paths. If the schema is truly heterogeneous, decode into `map[string]any` (or `map[string]json.RawMessage`) and inspect per key. If the schema is wrong, reject upstream:

```go
var m map[string]json.RawMessage
if err := json.Unmarshal(raw, &m); err != nil { /* still possible: malformed JSON */ }
for k, rm := range m {
	var n int
	if err := json.Unmarshal(rm, &n); err != nil {
		return fmt.Errorf("key %q: %w", k, err) // now you know which key
	}
	// use n
}
```

**Why common:** "Map of ints" reads the schema's *intent*, not its reality. Real producers sometimes write `"two"` because somebody forgot to coerce. Defensive decoding wraps each value with the key for the error message.
</details>

---

## Bug 5 — `Decoder` iteration reads partial document then errors mid-stream

```go
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Event struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func main() {
	// A stream of JSON values (newline-delimited), one corrupt in the middle.
	body := strings.NewReader(`{"id":1,"name":"a"}
{"id":2,"name":"b"}
{"id":3,"name":}
{"id":4,"name":"d"}`)

	dec := json.NewDecoder(body)
	for {
		var e Event
		if err := dec.Decode(&e); err != nil {
			fmt.Println("done:", err)
			return // BUG: stops at #3, never sees #4
		}
		fmt.Println(e)
	}
}
```

<details><summary>Answer</summary>

**Bug:** `Decoder.Decode` is *not* resumable on syntax errors. Once it returns a non-`io.EOF` error, the underlying buffer is in an undefined state — its read offset has advanced past some tokens but not others. Returning from the loop means event #4 is silently lost. Continuing the loop without recovery means the next `Decode` returns the same or another nonsense error.

**Why subtle:** With a well-formed stream the pattern is correct. The break-on-error reflex is right for terminal errors; wrong for per-record errors. Real streams contain bad records (truncated lines, half-flushed writes, attacker-crafted noise) and the loop must skip past them.

**Reference:** `src/encoding/json/stream.go`, `(*Decoder).Decode` — once `dec.err` is set by `readValue` or `unmarshal`, no recovery path exists. The buffer offset (`d.scanp`) isn't advanced to the next value boundary.

**Fix:** Frame the records yourself — use `bufio.Scanner` with a line splitter (or length-prefixed framing), then `Unmarshal` each record independently. Each bad record gives one error, and the next record decodes cleanly:

```go
sc := bufio.NewScanner(body)
for sc.Scan() {
	var e Event
	if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
		log.Printf("skip bad record: %v", err)
		continue
	}
	process(e)
}
```

For a single large JSON value (object/array), `Decoder` is fine. For a *stream of values*, treat framing as a separate concern; `Decoder.Decode` is not a parser-with-error-recovery.

**Why common:** The JSON streaming API looks designed for this — same loop shape as `bufio.Scanner`. The contract is just different: NDJSON is line-framed, the `Decoder` is value-framed and unrecoverable.
</details>

---

## Bug 6 — `Marshal` of a cyclic struct overflows the goroutine stack

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Node struct {
	Name string
	Next *Node `json:"next,omitempty"`
}

func main() {
	a := &Node{Name: "a"}
	b := &Node{Name: "b"}
	a.Next = b
	b.Next = a // cycle

	out, _ := json.Marshal(a) // BUG: recursive descent never terminates
	fmt.Println(string(out))
}
```

<details><summary>Answer</summary>

**Bug:** `encoding/json` has no cycle detection on the encode path. The reflection-based encoder in `encode.go` walks `Next` indefinitely; the recursion blows the goroutine stack. Until Go 1.21 the failure mode was `runtime: goroutine stack exceeds 1000000000-byte limit`; since 1.21 the encoder returns `json: unsupported value: encountered a cycle via *Node`, but only if the encoder happens to hit the depth guard before stack exhaustion.

**Why subtle:** Cycles aren't part of the type system. Linked lists, doubly-linked trees, parent-pointer DAGs, plugin graphs — all "trees" that can close into cycles under adversarial input or hot-reload. The encoder doesn't crash on the happy path; it crashes on the data structure that *used* to be acyclic.

**Reference:** `src/encoding/json/encode.go`, `(*encodeState).reflectValue` and the per-type encoder dispatch — no `seen` set is maintained. Go 1.21's PR #57804 added the cycle check in `ptrEncoder.encode` (a depth limit, not a true visited set).

**Fix:** Three strategies. (1) Break the cycle structurally — store IDs and a flat list rather than pointers. (2) Implement a custom `MarshalJSON` that maintains a `seen map[*Node]bool` and emits a reference token. (3) Define a wire-shape DTO with no cycles and copy:

```go
type nodeDTO struct {
	Name   string `json:"name"`
	NextID string `json:"next_id,omitempty"`
}
```

**Why common:** Cycles in Go structs are easy to build (two `Add` calls) and have no compile-time signal. The JSON encoder's depth-limit is a 1.21 patch over a 15-year-old design hole; the only structural fix is to not pass cyclic shapes to it.
</details>

---

## Bug 7 — `json.RawMessage` field declared by value loses bytes on copy

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Envelope struct {
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"` // BUG: not *json.RawMessage on the marshal side
}

func wrap(kind string, body any) (Envelope, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return Envelope{}, err
	}
	e := Envelope{Kind: kind, Payload: raw}
	return e, nil
}

func main() {
	e, _ := wrap("ping", map[string]int{"seq": 1})
	cp := e               // copy
	cp.Payload = append(cp.Payload[:0], cp.Payload...) // shrink-then-grow on copy
	b, _ := json.Marshal(e)
	fmt.Println(string(b)) // payload looks fine in this caller — but watch e's backing array
}
```

<details><summary>Answer</summary>

**Bug:** `json.RawMessage` is `type RawMessage []byte`. Declaring the field as `RawMessage` (value) rather than `*RawMessage` (pointer) means every assignment copies the *slice header* — three words — but shares the backing array. Two innocent-looking operations break it: (1) appending to `cp.Payload` may write into `e.Payload`'s array if capacity allows; (2) on the *unmarshal* side, the decoder's `(*RawMessage).UnmarshalJSON` mutates the receiver's underlying storage, which is *only* called when the field is addressable — passing a value receiver to a function that needs a pointer to update silently no-ops.

**Why subtle:** The bug appears intermittently because `append` reallocates above capacity and writes-in-place below. Tests with small payloads pass (`cap` happens to equal `len`); production with larger ones corrupt the original. The unmarshal variant is even quieter — the field receives `null` because the pointer-receiver method needed addressability and didn't get it.

**Reference:** `src/encoding/json/stream.go`, `(*RawMessage).UnmarshalJSON` — `*m = append((*m)[0:0], data...)`. The method explicitly mutates `*m`, which requires an addressable receiver. `src/encoding/json/encode.go`, `encodeByteSlice` covers the marshal path.

**Fix:** Use `*json.RawMessage` for fields you both marshal *and* unmarshal, and document the lifetime of the byte slice:

```go
type Envelope struct {
	Kind    string           `json:"kind"`
	Payload *json.RawMessage `json:"payload"`
}
```

If you keep value semantics, never `append` into a `RawMessage` you also store, and always copy with `bytes.Clone` (Go 1.20+) before storing:

```go
e.Payload = append(json.RawMessage(nil), raw...) // own copy
```

**Why common:** `RawMessage` looks like an opaque token. It's a slice header. Slice headers share storage; "I copied the struct" is not "I copied the bytes".
</details>

---

## Bug 8 — `MarshalJSON` on pointer receiver but value passed

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Money struct {
	Cents int64
}

func (m *Money) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`"%d.%02d"`, m.Cents/100, m.Cents%100)), nil
}

type Invoice struct {
	ID    string
	Total Money // BUG: value field; *Money MarshalJSON method not invoked
}

func main() {
	inv := Invoice{ID: "INV-1", Total: Money{Cents: 1299}}
	b, _ := json.Marshal(inv)
	fmt.Println(string(b))
	// {"ID":"INV-1","Total":{"Cents":1299}}   — default encoding, custom method skipped
}
```

<details><summary>Answer</summary>

**Bug:** `MarshalJSON` is declared on `*Money` (pointer receiver). When the encoder reflects on `Invoice.Total`, it sees a `Money` value, not a `*Money`. The method set of `Money` (value type) does *not* include `MarshalJSON`; only the method set of `*Money` does. The encoder falls through to the default struct encoding and emits `{"Cents":1299}` instead of `"12.99"`.

If the field were addressable (a top-level variable, a slice element by index) the encoder *would* take its address and find the method — but a struct field accessed inside a parent value isn't addressable through reflection in the encode path. `Marshal(inv)` is value-passed; the struct copy has no `*Money` to dispatch on.

**Why subtle:** `Marshal(&inv)` would work — the encoder dereferences the top-level pointer, the struct becomes addressable, and the field's `*Money` method is found. So the same code works for one call site and fails for another. Tests are usually written one way.

**Reference:** `src/encoding/json/encode.go`, `newTypeEncoder` calls `t.Implements(marshalerType)` *and* `reflect.PointerTo(t).Implements(marshalerType)` — but the latter only matters if the encoder later sees an addressable value. The decision tree is in `condAddrEncoder`.

**Fix:** Put the method on the value receiver, or always pass pointers down the chain:

```go
func (m Money) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`"%d.%02d"`, m.Cents/100, m.Cents%100)), nil
}
```

Value receiver is the safe default for `MarshalJSON`. Use pointer receiver only if the method genuinely needs to lazily compute or memoize.

**Why common:** Go's pointer-vs-value method dispatch is the single most error-prone interface mechanism in the language. `json.Marshaler` is the most likely interface to be silently *not* satisfied.
</details>

---

## Bug 9 — Custom time format wanted, default `time.Time` shipped

```go
package main

import (
	"encoding/json"
	"fmt"
	"time"
)

// Spec: dates as "YYYY-MM-DD", no time, no zone.
type Booking struct {
	Guest string    `json:"guest"`
	Date  time.Time `json:"date"` // BUG: encodes as RFC3339, not "2026-05-28"
}

func main() {
	t, _ := time.Parse("2006-01-02", "2026-05-28")
	b, _ := json.Marshal(Booking{Guest: "ada", Date: t})
	fmt.Println(string(b))
	// {"guest":"ada","date":"2026-05-28T00:00:00Z"}
}
```

<details><summary>Answer</summary>

**Bug:** `time.Time` implements `MarshalJSON` to emit RFC 3339 with nanosecond precision. There is no way to configure that on the type — it's a method, not a tagged option. The wire shape ships `"2026-05-28T00:00:00Z"`; the consumer expecting `"2026-05-28"` either crashes its date parser or stores the wrong value.

**Why subtle:** The encoded string *parses* back as a date in most consumers' tolerant parsers, so the round-trip "works". Schema validators flag it. Date-only consumers (banking, calendars, legal contracts) need stable lexical equality and the suffix breaks `==`.

**Reference:** `src/time/time.go`, `(Time).MarshalJSON` — hard-coded to `time.RFC3339Nano`. `src/encoding/json/encode.go` dispatches through `marshalerEncoder` because `time.Time` implements `json.Marshaler`; the JSON package never sees the date as a struct to apply a format tag to.

**Fix:** Define a domain type that wraps `time.Time` with the format you actually want:

```go
type Date time.Time

func (d Date) MarshalJSON() ([]byte, error) {
	return []byte(time.Time(d).Format(`"2006-01-02"`)), nil
}
func (d *Date) UnmarshalJSON(b []byte) error {
	t, err := time.Parse(`"2006-01-02"`, string(b))
	if err != nil { return err }
	*d = Date(t)
	return nil
}

type Booking struct {
	Guest string `json:"guest"`
	Date  Date   `json:"date"`
}
```

**Why common:** `time.Time` is the obvious type for "a date". It carries a clock, a monotonic counter, and a location — far more than a calendar date. The wire format reveals the mismatch; the in-memory type hides it.
</details>

---

## Bug 10 — `json.Decoder` leaves trailing data; connection un-reusable

```go
package main

import (
	"encoding/json"
	"net/http"
)

type Req struct {
	ID int `json:"id"`
}

func handler(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req Req
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// BUG: Decode read one value. Trailing whitespace/garbage stays in r.Body.
	// HTTP/1.1 keep-alive needs r.Body fully drained before the next request
	// on this connection. Server will close the conn instead of reusing it.

	w.WriteHeader(http.StatusOK)
}
```

<details><summary>Answer</summary>

**Bug:** `Decoder.Decode` reads exactly *one* JSON value and stops at the value's end token. Trailing whitespace, newlines, or trailing junk (sometimes injected by misbehaved clients) remains in `r.Body`. The `net/http` server requires the request body to be fully consumed before it can reuse the TCP connection for the next request — when it isn't, the server closes the connection. Throughput drops from "keep-alive 1000 req/s" to "open a new TCP connection per request, ~50 req/s with TLS".

**Why subtle:** Functionally everything works. The latency regression is per-request, hidden by the LB, surfaces as p99 spikes and CPU on the TLS handshake. APM tools rarely point at the JSON decoder.

**Reference:** `src/encoding/json/stream.go`, `(*Decoder).Decode` — `d.scanp` advances only to the end of the decoded value. The HTTP keep-alive requirement is documented in `src/net/http/request.go` and enforced in `(*conn).serve`.

**Fix:** After `Decode`, drain the body (`io.Copy(io.Discard, r.Body)`), or impose a body size limit and call `Decoder.More()`/`Decoder.Token()` to assert "no further value" and consume to EOF:

```go
defer r.Body.Close()
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // bound first

dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
if err := dec.Decode(&req); err != nil { /* 400 */ return }

// reject extra JSON values, drain trailing bytes
if dec.More() {
	http.Error(w, "trailing data", http.StatusBadRequest)
	return
}
io.Copy(io.Discard, r.Body)
```

**Why common:** "Read the body, write the response" is the canonical handler shape. The drain is invisible until throughput matters. `http.MaxBytesReader` + `io.Copy(io.Discard, ...)` is the boilerplate every JSON-over-HTTP handler should carry.
</details>

---

## Bug 11 — `defer resp.Body.Close()` forgotten after `Decode`

```go
package main

import (
	"encoding/json"
	"net/http"
)

type Profile struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func fetch(url string) (*Profile, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	// BUG: no defer resp.Body.Close()

	var p Profile
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, err
	}
	return &p, nil
}
```

<details><summary>Answer</summary>

**Bug:** The HTTP response body is an `io.ReadCloser`. The decoder reads from it but never closes it. Each `http.Get` keeps the underlying TCP connection (or the read side of the persistent connection) held open until the GC eventually reaches the `*http.Response` and finalizes — minutes later, or never under steady allocation pressure. The connection pool fills up; subsequent calls block on `dialerTimeout` or `MaxIdleConnsPerHost`. Production "everything went slow" with no obvious cause.

Worse: even on the *error* path from `Decode`, the body must be closed. The current code returns `nil, err` and leaves the body open.

**Why subtle:** Single-request tests pass. Burst tests pass because the pool starts empty. Sustained traffic exhausts the pool; `net/http.Transport` log messages mention `unused connection lost` and `idle conn`-something, not "you forgot Close".

**Reference:** `src/net/http/response.go` — `Response.Body` doc explicitly: *"It is the caller's responsibility to close Body."* Failure to close affects connection reuse, as documented in `(*Transport).RoundTrip`.

**Fix:** `defer` immediately after the error check, *and* drain on the success path so the connection can be reused:

```go
resp, err := http.Get(url)
if err != nil { return nil, err }
defer func() {
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}()

var p Profile
if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
	return nil, err
}
return &p, nil
```

**Why common:** `defer Close()` is the textbook pattern; "forgot to type it" is the textbook mistake. `errcheck` and `bodyclose` linters catch this exact bug.
</details>

---

## Bug 12 — `int` field receives a value larger than 32 bits on a 32-bit build

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Counter struct {
	Hits int `json:"hits"` // BUG: int is 32-bit on GOARCH=386, GOARCH=arm
}

func main() {
	// On a 32-bit build, int is int32: max 2,147,483,647.
	raw := []byte(`{"hits": 5000000000}`) // 5 billion
	var c Counter
	if err := json.Unmarshal(raw, &c); err != nil {
		fmt.Println("error:", err)
		// On 32-bit: json: cannot unmarshal number 5000000000 into Go struct field Counter.hits of type int
		return
	}
	fmt.Println(c.Hits)
}
```

<details><summary>Answer</summary>

**Bug:** Go's `int` is platform-defined: 32 bits on `386`/`arm`/`wasm` and 64 bits on `amd64`/`arm64`. The same JSON payload that decodes cleanly on a developer's `amd64` laptop returns `cannot unmarshal number ... into ... int` on a 32-bit deploy target (embedded device, old container base image, certain WASM runtimes). Across the boundary the schema is unstable.

**Why subtle:** The bug is per-platform. CI on `amd64` passes; the 32-bit IoT firmware or 32-bit ARM container fails in the field. The error message names `int` without revealing the platform width.

**Reference:** `src/encoding/json/decode.go`, `(*decodeState).literalStore` for `reflect.Int` — calls `strconv.ParseInt(s, 10, 64)` then checks `v.OverflowInt(n)`. The overflow check uses the target's bit width, which is platform-dependent for `reflect.Int`.

**Fix:** Use explicit-width types on wire-facing structs:

```go
type Counter struct {
	Hits int64 `json:"hits"`
}
```

For payloads that exceed `int64`, use `json.Number` and route through `big.Int`. Never use bare `int` (or `uint`) in a struct that round-trips JSON; it's a portability hazard in disguise.

**Why common:** `int` is the default in Go style guides for in-process code. JSON crosses processes — and crosses architectures via cross-compilation. The defaults are right for memory but wrong for wire.
</details>

---

## Bug 13 — `[]byte` field silently base64-encoded

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Packet struct {
	Header string `json:"header"`
	Data   []byte `json:"data"` // BUG: not "raw bytes" — base64
}

func main() {
	p := Packet{Header: "v1", Data: []byte{0x48, 0x69}} // "Hi"
	b, _ := json.Marshal(p)
	fmt.Println(string(b))
	// {"header":"v1","data":"SGk="}   — base64-encoded, not [72,105]
}
```

<details><summary>Answer</summary>

**Bug:** `encoding/json` treats `[]byte` specially: it base64-encodes the bytes (RFC 4648, standard alphabet, *with* padding) on encode and base64-decodes on decode. This is documented but rarely remembered. Consumers expecting a numeric array (`[72, 105]`) or a UTF-8 string see `"SGk="` and silently mishandle it. Worse, on the decode side, a producer that ships a JSON array of numbers into a `[]byte` field gets `cannot unmarshal array into Go struct field Packet.data of type []uint8`.

**Why subtle:** The encoded form is valid JSON. The wire protocol still passes JSON Schema validation against `"type": "string"`. The mismatch with the consumer's expectation is a semantic bug, not a syntactic one.

**Reference:** `src/encoding/json/encode.go`, `encodeByteSlice` — encodes via `base64.StdEncoding` directly into the output buffer. Decode side: `(*decodeState).literalStore` for `reflect.Slice` of `reflect.Uint8`, which calls `base64.StdEncoding.Decode`.

**Fix:** Decide what the wire shape should be and pick the matching Go type. Three options:

1. **Base64 (the default):** keep `[]byte`, document the wire format. Use when bytes are opaque (encryption blobs, file contents).
2. **Hex string:** wrap in a domain type with `MarshalJSON`/`UnmarshalJSON` that uses `encoding/hex`.
3. **Array of integers:** use `[]int` or `[]uint8` aliased to a different element type that *doesn't* trigger the base64 shortcut:

```go
type byteArr []uint16 // not []byte, so no base64 shortcut — emits as [72,105]

type Packet struct {
	Header string  `json:"header"`
	Data   byteArr `json:"data"`
}
```

**Why common:** `[]byte` is "bytes". JSON has no byte type, so the package picked base64. The choice is reasonable and surprising; documenting it on every wire-facing struct is the cheap insurance.
</details>

---

## Bug 14 — Two struct fields produce the same JSON name; both dropped

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Mixed struct {
	ID      int    `json:"id"`
	UserID  int    `json:"id"` // BUG: same JSON key as ID
	Name    string `json:"name"`
}

func main() {
	m := Mixed{ID: 1, UserID: 99, Name: "ada"}
	b, _ := json.Marshal(m)
	fmt.Println(string(b))
	// {"name":"ada"}   — both ID and UserID dropped silently
}
```

<details><summary>Answer</summary>

**Bug:** When two fields at the same struct depth tag the same JSON name, `encoding/json`'s tie-breaker (in `typeFields`) drops *both*. The output silently omits the key entirely. No error; no warning; not even a `Marshal` failure. The first time anyone notices is when the consumer reports "id field missing".

Embedded structs that surface a same-named field follow a more nuanced rule: the shallowest one wins, and ties at the same depth still drop. The bug here is two fields *at the same depth* — Go's resolution is "neither, silently".

**Why subtle:** Tests on either field individually look correct because the test author writes `expected` already containing the missing key. Tests that re-encode and assert byte-equal would catch it; tests that decode and compare field values catch it. Tests that just check "no error" miss it entirely.

**Reference:** `src/encoding/json/encode.go`, `typeFields` and `dominantField` — the latter's docstring: *"If there are multiple top-level fields, the boolean will be false: This condition is an error in Go and we skip all the fields."*. The decode side respects the same rule via `field` lookups.

**Fix:** Rename one tag, or use a wrapper type for the embedded case:

```go
type Mixed struct {
	ID     int    `json:"id"`
	UserID int    `json:"user_id"`
	Name   string `json:"name"`
}
```

For the embedded-struct variant of this bug, lift the conflicting field into the outer struct with an explicit tag, or add `json:"-"` to the embedded duplicate.

**Why common:** Tag conflicts arise from refactors — someone renames `User_ID` to `UserID` and forgets the tag, leaving two fields tagged `"id"`. Static linters (`govet`'s `composites` is unrelated; `nilness`, `structtag` partially) don't catch JSON name collisions at the depth-resolution level. Code review on tag changes is the only reliable defence.
</details>

---

## Summary

These bugs cluster into four families.

**Reflection visibility (1, 8, 14):** unexported fields skipped silently, pointer-receiver `MarshalJSON` not invoked on a value field, two fields with the same JSON name both dropped. `encoding/json` is a reflective contract; it only sees what reflection exposes, and the visibility rules diverge from the language's normal scoping rules in ways that compile cleanly but ship wrong bytes.

**Numeric and wire semantics (3, 9, 12, 13):** `int64` rounded through JS `float64`, `time.Time` forced to RFC 3339, `int` size dependent on architecture, `[]byte` silently base64-encoded. JSON's value model is poorer than Go's; every place the type system says "this fits" but the wire format says "this is a string", there's a hidden conversion and a hidden bug.

**Lifecycle and emptiness (2, 10, 11):** `omitempty` not omitting a zero struct, `Decoder` not draining trailing bytes, response body not closed. `encoding/json` doesn't manage its own I/O lifecycle — the caller does — and three small omissions degrade keep-alive throughput, exhaust connection pools, or emit phantom default values that consumers misinterpret.

**Error and structural integrity (4, 5, 6, 7):** mixed-type map fails mid-decode, NDJSON stream un-resumable after a syntax error, cycles overflow the stack, `RawMessage` value semantics lose data on copy. Each one is a place where the package's design favours simplicity over robustness, and production payloads — heterogeneous, partially corrupt, cyclic, or copied — pay the cost.

Review checklist for any `encoding/json` use:

- [ ] Are all wire-facing struct fields exported, with explicit `json:` tags, and do two fields never share the same tag name at the same depth?
- [ ] Do integer fields use explicit widths (`int64`, `int32`) — never bare `int` — and is the `string` tag applied when the wire crosses a JavaScript boundary?
- [ ] Is `omitempty` only applied to types whose zero is in the built-in empty set (bool/number/string/nil-pointer/nil-slice/nil-map), or upgraded to `omitzero` for struct/array fields on Go 1.24+?
- [ ] Do `time.Time` fields go through a domain wrapper type with the exact format the wire requires, rather than relying on `time.Time`'s default RFC 3339?
- [ ] Do `[]byte` fields document base64 encoding on the wire — or use a different element type to avoid the shortcut?
- [ ] Are `MarshalJSON` / `UnmarshalJSON` methods declared on the *value* receiver (or is the field always addressable when encoded)?
- [ ] After `json.NewDecoder(resp.Body).Decode(...)`, does the code `io.Copy(io.Discard, resp.Body)` then `resp.Body.Close()` — even on the error path — and apply `http.MaxBytesReader` upstream?
- [ ] Are NDJSON streams framed by `bufio.Scanner` (per-line `Unmarshal`) rather than relying on `Decoder.Decode` to skip bad records?
- [ ] Are recursive types validated for acyclicity before `Marshal`, or marshalled through a DTO that flattens to IDs?
- [ ] Are `json.RawMessage` fields declared as `*json.RawMessage` when they're decoded into, and are byte slices copied with `bytes.Clone` before being stored?
- [ ] Do unmarshal callers wrap each per-key decode of `map[string]json.RawMessage` with the key in the error message, rather than relying on `UnmarshalTypeError` which has no key context?
