# `encoding/json` Source — Tasks

20 hands-on tasks for working with — and reading — `encoding/json`. Targeted at Go 1.22+. Each task has acceptance criteria; the reference solutions compile.

> Skip nothing, but skip *order*: junior → middle → senior → staff. The staff tasks assume the senior ones are easy.

---

## Task 1: Marshal a struct to JSON

**Goal:** Encode a Go struct to JSON and print it.
**Difficulty:** Junior
**Skills:** `json.Marshal`, struct tags, basic types.

### Steps
1. Define a struct `User` with `Name string`, `Age int`, `Active bool`.
2. Construct a value and call `json.Marshal`.
3. Print the result with `fmt.Println(string(b))`.

### Acceptance criteria
- Program prints `{"Name":"...","Age":...,"Active":...}`.
- No errors.

<details><summary>Hint</summary>

`json.Marshal` returns `([]byte, error)`. Always check the error.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
)

type User struct {
	Name   string
	Age    int
	Active bool
}

func main() {
	u := User{Name: "Aybek", Age: 30, Active: true}
	b, err := json.Marshal(u)
	if err != nil {
		panic(err)
	}
	fmt.Println(string(b))
}
```

</details>

---

## Task 2: Unmarshal JSON into a struct

**Goal:** Decode JSON into a typed Go value.
**Difficulty:** Junior
**Skills:** `json.Unmarshal`.

### Steps
1. Define a `User` struct matching the JSON shape.
2. Call `json.Unmarshal([]byte(...), &u)`.
3. Print individual fields.

### Acceptance criteria
- Decoded fields match the JSON.
- Unknown JSON fields are silently ignored (default behavior).

<details><summary>Hint</summary>

`Unmarshal` needs a pointer destination.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
)

type User struct {
	Name string
	Age  int
}

func main() {
	data := []byte(`{"Name":"Aybek","Age":30,"Extra":"ignored"}`)
	var u User
	if err := json.Unmarshal(data, &u); err != nil {
		panic(err)
	}
	fmt.Printf("Name=%s Age=%d\n", u.Name, u.Age)
}
```

</details>

---

## Task 3: Struct tags with `omitempty` and `-`

**Goal:** Control field naming, omission, and exclusion.
**Difficulty:** Junior
**Skills:** Struct tags.

### Steps
1. Define a struct with three fields: an always-included `id`, an `email` that should omit when empty, and a `password` that must never appear.
2. Marshal twice — once with `email` set, once empty — and observe.

### Acceptance criteria
- `password` never appears.
- When email is empty, the key is missing.
- When email is set, the key appears.

<details><summary>Hint</summary>

Tags: `json:"id"`, `json:"email,omitempty"`, `json:"-"`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Account struct {
	ID       int    `json:"id"`
	Email    string `json:"email,omitempty"`
	Password string `json:"-"`
}

func main() {
	withEmail, _ := json.Marshal(Account{ID: 1, Email: "a@b.com", Password: "secret"})
	noEmail, _ := json.Marshal(Account{ID: 2, Password: "secret"})
	fmt.Println(string(withEmail))
	fmt.Println(string(noEmail))
}
```

Expected output:
```
{"id":1,"email":"a@b.com"}
{"id":2}
```

</details>

---

## Task 4: Locate `Marshal` in source

**Goal:** Open `$GOROOT/src/encoding/json/encode.go` and find the `Marshal` function entry point.
**Difficulty:** Junior
**Skills:** Reading stdlib source.

### Steps
1. Run `go env GOROOT` to find the source root.
2. Open `$GOROOT/src/encoding/json/encode.go`.
3. Find `func Marshal(v any) ([]byte, error)`.
4. Note the line number, and identify the helper it calls (`newEncodeState`, `marshal`, etc.).

### Acceptance criteria
- You can quote the `Marshal` function signature.
- You can name the next-level function it dispatches to.

<details><summary>Hint</summary>

```bash
grep -n "^func Marshal" $(go env GOROOT)/src/encoding/json/encode.go
```

</details>

<details><summary>Reference solution</summary>

```bash
$ grep -n "^func Marshal" $(go env GOROOT)/src/encoding/json/encode.go
# Output (line number varies by Go version):
# 156:func Marshal(v any) ([]byte, error) {
# 175:func MarshalIndent(v any, prefix, indent string) ([]byte, error) {
```

`Marshal` calls `newEncodeState()` to get a pooled `encodeState`, then `e.marshal(v, encOpts{escapeHTML: true})`. The pooled state is returned to `encodeStatePool` via `defer`. The actual encoding work is dispatched to `valueEncoder(rv)` based on `reflect.Value`.

</details>

---

## Task 5: Custom `Marshaler` / `Unmarshaler` for a Duration

**Goal:** Implement `json.Marshaler` and `json.Unmarshaler` on a custom type so that a duration round-trips as a string like `"1h30m"`.
**Difficulty:** Middle
**Skills:** Interfaces, `time.Duration`, `time.ParseDuration`.

### Steps
1. Define `type Duration time.Duration`.
2. Implement `MarshalJSON() ([]byte, error)` producing `"1h30m"`.
3. Implement `UnmarshalJSON(b []byte) error` parsing the same.
4. Test round-trip.

### Acceptance criteria
- Marshaling produces `"1h30m"` not `5400000000000`.
- Unmarshaling parses back to the same `Duration` value.

<details><summary>Hint</summary>

`json.Marshal` checks for `Marshaler` *before* falling back to reflection. The method must be on the same type (pointer or value) you marshal.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type Duration time.Duration

func (d Duration) MarshalJSON() ([]byte, error) {
	return []byte(strconv.Quote(time.Duration(d).String())), nil
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	s, err := strconv.Unquote(string(b))
	if err != nil {
		return err
	}
	parsed, err := time.ParseDuration(s)
	if err != nil {
		return err
	}
	*d = Duration(parsed)
	return nil
}

type Config struct {
	Timeout Duration `json:"timeout"`
}

func main() {
	c := Config{Timeout: Duration(90 * time.Minute)}
	b, _ := json.Marshal(c)
	fmt.Println(string(b))

	var back Config
	_ = json.Unmarshal(b, &back)
	fmt.Println(time.Duration(back.Timeout))
}
```

</details>

---

## Task 6: Stream a large JSON array

**Goal:** Use `Decoder.Token` to consume the opening `[`, then `Decoder.Decode` per element. This avoids holding the whole array in memory.
**Difficulty:** Middle
**Skills:** `json.Decoder`, streaming.

### Steps
1. Construct a JSON file or strings.Reader containing `[{...},{...},...]`.
2. Create a `*Decoder`.
3. Read one token; assert it's `json.Delim('[')`.
4. Loop while `d.More()`: `d.Decode(&item)`, process.
5. Read the closing `]`.

### Acceptance criteria
- Memory does not scale with array length.
- Each element is processed individually.

<details><summary>Hint</summary>

`Delim` is its own type; type-assert it.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Item struct {
	ID int `json:"id"`
}

func main() {
	r := strings.NewReader(`[{"id":1},{"id":2},{"id":3}]`)
	dec := json.NewDecoder(r)

	// Opening [
	tok, err := dec.Token()
	if err != nil {
		panic(err)
	}
	if d, ok := tok.(json.Delim); !ok || d != '[' {
		panic("expected [")
	}

	for dec.More() {
		var it Item
		if err := dec.Decode(&it); err != nil {
			panic(err)
		}
		fmt.Println("got", it.ID)
	}

	// Closing ]
	_, _ = dec.Token()
}
```

</details>

---

## Task 7: `RawMessage` for delayed polymorphic parsing

**Goal:** Use `json.RawMessage` to peek at a discriminator field and decode the payload only after.
**Difficulty:** Middle
**Skills:** `json.RawMessage`, two-phase decode.

### Steps
1. Define an envelope: `Type string`, `Payload json.RawMessage`.
2. Unmarshal once into the envelope.
3. Switch on `Type`; unmarshal `Payload` into the right concrete type.

### Acceptance criteria
- Heterogeneous payloads decode correctly.
- The `Payload` bytes are parsed once total.

<details><summary>Hint</summary>

`RawMessage` is `[]byte`; pass `&rm` to `Unmarshal`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type LoginEvent struct {
	User string `json:"user"`
}

type PurchaseEvent struct {
	Item  string  `json:"item"`
	Price float64 `json:"price"`
}

func main() {
	data := []byte(`{"type":"login","payload":{"user":"aybek"}}`)
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		panic(err)
	}
	switch env.Type {
	case "login":
		var ev LoginEvent
		_ = json.Unmarshal(env.Payload, &ev)
		fmt.Printf("login: %s\n", ev.User)
	case "purchase":
		var ev PurchaseEvent
		_ = json.Unmarshal(env.Payload, &ev)
		fmt.Printf("purchase: %s for %.2f\n", ev.Item, ev.Price)
	}
}
```

</details>

---

## Task 8: `DisallowUnknownFields` for schema drift detection

**Goal:** Reject payloads with unexpected fields, catching schema drift at the boundary.
**Difficulty:** Middle
**Skills:** `Decoder.DisallowUnknownFields`.

### Steps
1. Build a `*Decoder`.
2. Call `dec.DisallowUnknownFields()`.
3. Decode known-good and known-bad payloads.

### Acceptance criteria
- Known-good payload decodes successfully.
- Payload with extra field returns an error mentioning the unknown field.

<details><summary>Hint</summary>

This only works via `Decoder`, not `json.Unmarshal`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Request struct {
	Name string `json:"name"`
}

func decode(s string) error {
	dec := json.NewDecoder(strings.NewReader(s))
	dec.DisallowUnknownFields()
	var r Request
	return dec.Decode(&r)
}

func main() {
	fmt.Println(decode(`{"name":"ok"}`))                       // <nil>
	fmt.Println(decode(`{"name":"ok","unexpected":"surprise"}`)) // json: unknown field "unexpected"
}
```

</details>

---

## Task 9: `json.Number` for big integers

**Goal:** Preserve precision of integers larger than `2^53` (which lose precision as `float64`).
**Difficulty:** Middle
**Skills:** `Decoder.UseNumber`, `json.Number`.

### Steps
1. Build a `*Decoder`; call `UseNumber()`.
2. Decode into `map[string]json.Number` or a struct with `json.Number` field.
3. Convert via `.Int64()` or `.Float64()` only when you need the typed value.

### Acceptance criteria
- A 19-digit integer round-trips without precision loss.
- Using default decoding (no `UseNumber`) loses precision (demonstrate).

<details><summary>Hint</summary>

`json.Number` is just a `string`; methods convert on demand.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

func main() {
	const data = `{"id":9007199254740993}`

	// Default: float64 → precision loss.
	var loose map[string]any
	_ = json.Unmarshal([]byte(data), &loose)
	fmt.Printf("loose: %v\n", loose["id"])

	// With UseNumber: preserve digits.
	dec := json.NewDecoder(strings.NewReader(data))
	dec.UseNumber()
	var precise map[string]json.Number
	_ = dec.Decode(&precise)
	id := precise["id"]
	asInt, err := id.Int64()
	fmt.Printf("precise string: %s, Int64: %d, err: %v\n", id, asInt, err)
}
```

</details>

---

## Task 10: Map a `scanner.go` state transition

**Goal:** Read `encoding/json/scanner.go` and explain one state transition (e.g., `stateBeginValue` → `stateInString`).
**Difficulty:** Middle
**Skills:** Source reading.

### Steps
1. Open `$GOROOT/src/encoding/json/scanner.go`.
2. Find `stateBeginValue`.
3. Trace the case `'"'` → it sets `s.step = stateInString` and returns `scanBeginLiteral`.
4. Write a 3-sentence summary of the state machine for strings.

### Acceptance criteria
- You can name three states and one transition each.

<details><summary>Hint</summary>

Each state is a function with signature `func(*scanner, byte) int`.

</details>

<details><summary>Reference solution</summary>

The scanner is a byte-at-a-time state machine. Each state is a function pointer (`s.step`).

- `stateBeginValue('"')`: sees `"`, sets `s.step = stateInString`, returns `scanBeginLiteral`.
- `stateInString('\\')`: sees a backslash, sets `s.step = stateInStringEsc`, returns `scanContinue`.
- `stateInString('"')`: sees the closing quote, sets `s.step = stateEndValue`, returns `scanContinue`.

Three states, three transitions; the same pattern (`s.step = ...`) chains them. The scanner doesn't allocate per byte; it returns small integer "actions" that the parent caller (`Decoder.refill`/`readValue`) interprets.

</details>

---

## Task 11: Benchmark stdlib vs codegen alternative

**Goal:** Measure the cost difference between reflect-based and codegen-based JSON.
**Difficulty:** Senior
**Skills:** Benchmarking, `go test -bench`.

### Steps
1. Define a moderately complex struct.
2. Write a benchmark that calls `json.Marshal` in a loop.
3. (Optional) Generate an `easyjson` or `sonic`-based marshaler for the same type. Compare.
4. Report ns/op, B/op, allocs/op.

### Acceptance criteria
- Benchmarks run via `go test -bench=. -benchmem`.
- You can identify the bottleneck (reflect calls, allocations).

<details><summary>Hint</summary>

Even without a codegen library, benchmark `json.Marshal` against a hand-written `MarshalJSON` and you'll see the gap.

</details>

<details><summary>Reference solution</summary>

```go
// bench_test.go
package bench

import (
	"encoding/json"
	"strconv"
	"testing"
)

type Event struct {
	ID    int64  `json:"id"`
	Type  string `json:"type"`
	User  string `json:"user"`
	Value int    `json:"value"`
}

var e = Event{ID: 12345, Type: "login", User: "aybek", Value: 42}

func BenchmarkStdlibMarshal(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, _ = json.Marshal(e)
	}
}

// Hand-rolled — what a codegen library would produce.
func (e Event) MarshalManual() []byte {
	buf := make([]byte, 0, 96)
	buf = append(buf, `{"id":`...)
	buf = strconv.AppendInt(buf, e.ID, 10)
	buf = append(buf, `,"type":"`...)
	buf = append(buf, e.Type...)
	buf = append(buf, `","user":"`...)
	buf = append(buf, e.User...)
	buf = append(buf, `","value":`...)
	buf = strconv.AppendInt(buf, int64(e.Value), 10)
	buf = append(buf, '}')
	return buf
}

func BenchmarkManualMarshal(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = e.MarshalManual()
	}
}
```

Run `go test -bench=. -benchmem`. Expected order: manual is ~5-10x faster, fewer allocations.

</details>

---

## Task 12: Pre-warm the `typeEncoder` cache

**Goal:** Avoid the first-call latency for `Marshal` of a complex type by pre-warming the reflect cache at startup.
**Difficulty:** Senior
**Skills:** `init`, cold-start optimization.

### Steps
1. In `init()`, marshal one zero value of each type your service handles.
2. Measure first-call vs second-call latency before and after.

### Acceptance criteria
- After pre-warming, first request to a handler has the same latency as steady state.

<details><summary>Hint</summary>

The cache key is `reflect.Type`. One marshal per type is sufficient.

</details>

<details><summary>Reference solution</summary>

```go
package svc

import "encoding/json"

type Request struct {
	UserID int    `json:"user_id"`
	Action string `json:"action"`
}

type Response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func init() {
	// Warm typeEncoder cache for known wire types.
	_, _ = json.Marshal(Request{})
	_, _ = json.Marshal(Response{})
}
```

This populates `encoding/json`'s internal `sync.Map` keyed by `reflect.Type`. First request thereafter sees a cache hit.

</details>

---

## Task 13: DoS guard with `MaxBytesReader`

**Goal:** Reject oversized JSON payloads before allocation explodes.
**Difficulty:** Senior
**Skills:** `http.MaxBytesReader`, `Decoder`.

### Steps
1. Wrap `r.Body` with `http.MaxBytesReader(w, r.Body, 1<<20)` (1 MiB).
2. Decode via `Decoder.Decode`.
3. If `Decode` returns an error, distinguish "request too large" vs "malformed JSON".

### Acceptance criteria
- Payloads over 1 MiB are rejected with HTTP 413.
- Smaller malformed payloads return 400.

<details><summary>Hint</summary>

`MaxBytesReader` returns `*http.MaxBytesError` on overrun (Go 1.19+).

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

type Req struct{ Msg string }

func handler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var q Req
	if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	fmt.Fprintf(w, "got %q\n", q.Msg)
}

func main() {
	http.HandleFunc("/", handler)
	_ = http.ListenAndServe(":8080", nil)
}
```

</details>

---

## Task 14: Stream a 100MB JSON file with minimal memory

**Goal:** Process a 100MB JSON file (containing a top-level array of objects) without allocating ~100MB.
**Difficulty:** Senior
**Skills:** `Decoder` with `io.Reader`, streaming pattern.

### Steps
1. Generate a 100MB test file containing many JSON objects in an array.
2. Open with `os.Open`; pass to `json.NewDecoder`.
3. Process each element via the `Decode-in-loop` pattern from Task 6.
4. Measure RSS via `runtime.MemStats`.

### Acceptance criteria
- RSS stays well below file size (< 10MB target).
- All elements are processed.

<details><summary>Hint</summary>

Don't read the file into memory first. The `Decoder` reads as needed.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
)

type Item struct {
	ID int `json:"id"`
}

func main() {
	f, err := os.Open("big.json")
	if err != nil {
		panic(err)
	}
	defer f.Close()

	dec := json.NewDecoder(f)
	tok, _ := dec.Token()
	if d, ok := tok.(json.Delim); !ok || d != '[' {
		panic("expected [")
	}

	count := 0
	for dec.More() {
		var it Item
		if err := dec.Decode(&it); err != nil {
			panic(err)
		}
		count++
	}
	_, _ = dec.Token()

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("decoded %d items; HeapAlloc=%dKB\n", count, m.HeapAlloc/1024)
}
```

</details>

---

## Task 15: Custom marshaler for a fixed date format

**Goal:** Emit `time.Time` as `"2006-01-02"` (date only) rather than RFC3339.
**Difficulty:** Senior
**Skills:** Wrapper type, `Marshaler`/`Unmarshaler`.

### Steps
1. Define `type Date time.Time` (or a struct wrapping `time.Time`).
2. Implement `MarshalJSON`/`UnmarshalJSON` using `time.Format("2006-01-02")` and `time.Parse`.
3. Round-trip a value.

### Acceptance criteria
- Output is `"2026-05-29"` not `"2026-05-29T00:00:00Z"`.
- Round-trip preserves the date.

<details><summary>Hint</summary>

Apply the method to the wrapper type, not `time.Time` directly (you can't add methods to non-local types).

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type Date time.Time

const dateLayout = "2006-01-02"

func (d Date) MarshalJSON() ([]byte, error) {
	return []byte(strconv.Quote(time.Time(d).Format(dateLayout))), nil
}

func (d *Date) UnmarshalJSON(b []byte) error {
	s, err := strconv.Unquote(string(b))
	if err != nil {
		return err
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return err
	}
	*d = Date(t)
	return nil
}

type Booking struct {
	When Date `json:"when"`
}

func main() {
	b := Booking{When: Date(time.Date(2026, 5, 29, 0, 0, 0, 0, time.UTC))}
	out, _ := json.Marshal(b)
	fmt.Println(string(out))

	var back Booking
	_ = json.Unmarshal(out, &back)
	fmt.Println(time.Time(back.When))
}
```

</details>

---

## Task 16: Diff two JSON documents

**Goal:** Decode two JSON documents into `any` and recursively report differences.
**Difficulty:** Senior
**Skills:** `any`, type switches, recursion.

### Steps
1. Decode each document via `json.Unmarshal(data, &v)` where `v` is `any`.
2. Walk both recursively; report differences at each path.

### Acceptance criteria
- Differences in scalar values, missing keys, and array elements are reported with their JSON path.

<details><summary>Hint</summary>

Recall: `any` decoding produces `map[string]any` for objects, `[]any` for arrays, `float64` for numbers, `string` for strings, `bool`, `nil`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"reflect"
)

func diff(path string, a, b any) {
	if reflect.DeepEqual(a, b) {
		return
	}
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok {
			fmt.Printf("%s: type changed (%T -> %T)\n", path, a, b)
			return
		}
		for k, av2 := range av {
			diff(path+"."+k, av2, bv[k])
		}
		for k := range bv {
			if _, in := av[k]; !in {
				fmt.Printf("%s.%s: added (%v)\n", path, k, bv[k])
			}
		}
	case []any:
		bv, ok := b.([]any)
		if !ok {
			fmt.Printf("%s: type changed (%T -> %T)\n", path, a, b)
			return
		}
		n := len(av)
		if len(bv) > n {
			n = len(bv)
		}
		for i := 0; i < n; i++ {
			var ai, bi any
			if i < len(av) {
				ai = av[i]
			}
			if i < len(bv) {
				bi = bv[i]
			}
			diff(fmt.Sprintf("%s[%d]", path, i), ai, bi)
		}
	default:
		fmt.Printf("%s: %v -> %v\n", path, a, b)
	}
}

func main() {
	a := []byte(`{"name":"a","tags":["x","y"],"n":1}`)
	b := []byte(`{"name":"a","tags":["x","z"],"n":2,"new":true}`)

	var av, bv any
	_ = json.Unmarshal(a, &av)
	_ = json.Unmarshal(b, &bv)
	diff("$", av, bv)
}
```

</details>

---

## Task 17: pprof a Marshal-heavy service

**Goal:** Identify the JSON hotspot in a service via CPU profile.
**Difficulty:** Senior
**Skills:** `net/http/pprof`, `go tool pprof`.

### Steps
1. Build an HTTP service that marshals a complex struct on every request.
2. Import `_ "net/http/pprof"` and expose `:6060`.
3. Drive load with `hey` or `wrk` for 30s.
4. Capture `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10`.
5. Find `encoding/json.(*encodeState).reflectValue` (or similar) in the top.

### Acceptance criteria
- The profile shows JSON encoding among the top frames.
- You can identify where pre-warming (Task 12) or codegen (Task 11) would help.

<details><summary>Hint</summary>

Reflect-heavy frames show as `encoding/json.typeEncoder`, `structEncoder.encode`, `reflect.Value.Field`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"net/http"
	_ "net/http/pprof"
)

type Bundle struct {
	ID    int                    `json:"id"`
	Items []map[string]any       `json:"items"`
	Meta  map[string]interface{} `json:"meta"`
}

var b = Bundle{
	ID: 1,
	Items: []map[string]any{
		{"sku": "A", "qty": 1, "price": 9.99},
		{"sku": "B", "qty": 2, "price": 4.50},
	},
	Meta: map[string]interface{}{"region": "eu", "v": 3},
}

func handler(w http.ResponseWriter, r *http.Request) {
	out, _ := json.Marshal(b)
	w.Write(out)
}

func main() {
	go func() { _ = http.ListenAndServe(":6060", nil) }()
	http.HandleFunc("/", handler)
	_ = http.ListenAndServe(":8080", nil)
}
```

Drive with `hey -z 30s http://localhost:8080/`, then `go tool pprof -top http://localhost:6060/debug/pprof/profile?seconds=10`.

</details>

---

## Task 18: Compare `encoding/json` vs `encoding/json/v2`

**Goal:** Write a 1-page comparison of v1 vs v2 (proposal 71497, available as experimental in Go 1.25+).
**Difficulty:** Staff
**Skills:** Proposal reading, source comparison.

### Steps
1. Read the v2 proposal at <https://github.com/golang/go/issues/71497>.
2. Skim the experimental package at <https://github.com/go-json-experiment/json>.
3. Note: options-as-args (vs Encoder methods), explicit zero handling, faster decoder, deterministic ordering, type-strict scanning.
4. Write a markdown table: v1 behavior / v2 behavior / migration impact.

### Acceptance criteria
- A markdown table with at least 8 rows covering API shape, options, performance, correctness, omitempty, durations, unknown fields, scanning.

<details><summary>Hint</summary>

The single biggest semantic change: v2 has `omitzero` (truly zero) separate from `omitempty` (a slightly different "empty" definition).

</details>

<details><summary>Reference solution</summary>

| Aspect | v1 (`encoding/json`) | v2 (`encoding/json/v2`) | Migration |
|---|---|---|---|
| API shape | `Marshal(v)`, `Decoder.X()` methods | `Marshal(v, opts...)` functional options | Mostly mechanical; opts replace setters |
| `omitempty` | "empty" = zero value, but inconsistent (zero `time.Time` not empty) | `omitzero` (true Go zero); `omitempty` redefined for slices/maps only | Audit tags; some fields newly omitted |
| Unknown fields | Default: ignore | Default: still ignore; `RejectUnknownMembers` cleaner than v1 `DisallowUnknownFields` | Cleaner API |
| Performance | Reflect-cached; ~2-4x slower than codegen | Substantially faster decoder; cache more efficient | Free speedup on upgrade |
| Number handling | float64 by default; `json.Number` opt-in | Same defaults; explicit options for arbitrary precision | Same defaults |
| Map ordering on Marshal | Lexicographic | Lexicographic by default, configurable | Same default |
| `MarshalJSON`/`UnmarshalJSON` | Same | Same; new MarshalerTo/UnmarshalerFrom for streaming | Optional; faster for big payloads |
| HTML escape | On by default; `SetEscapeHTML(false)` opt-out | Off by default; opt-in | Audit any places relying on HTML escape |
| Time | RFC3339 always | Same default; opts for layout/duration handling | Less ceremony for date-only |
| Errors | Generic `*json.SyntaxError` | Structured, with byte offsets and path | Easier to surface to clients |

Notes:
- v2 lives in `encoding/json/v2` (proposed for stdlib) and `github.com/go-json-experiment/json` (experimental package).
- The intent is that v1 keeps working unchanged; v2 is opt-in.
- Migration is gradual: v2's `MarshalEncode`/`UnmarshalDecode` can interop with v1 types via `Marshaler`/`Unmarshaler` methods.

</details>

---

## Task 19: JSON-Lines (NDJSON) encoder/decoder pair

**Goal:** Build a streaming encoder/decoder for newline-delimited JSON (one object per line). Common for logs and Kafka payloads.
**Difficulty:** Staff
**Skills:** `Encoder`, `Decoder`, line semantics.

### Steps
1. Encoder side: use `json.NewEncoder(w)` — it already writes a trailing newline after each `Encode`. That's already NDJSON.
2. Decoder side: use `json.NewDecoder(r)` — it tolerates whitespace between values. That's already NDJSON.
3. Wrap each side to add convenience (channels, error handling, batch flush).

### Acceptance criteria
- Encoder writes one valid JSON object per line.
- Decoder yields one value per Decode until EOF.
- Works through a pipe (`io.Pipe`) without buffering whole stream.

<details><summary>Hint</summary>

`Encoder.Encode` already appends `\n`. No extra work.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type Event struct {
	ID  int    `json:"id"`
	Msg string `json:"msg"`
}

func encodeAll(w io.Writer, events []Event) error {
	enc := json.NewEncoder(w)
	for _, e := range events {
		if err := enc.Encode(e); err != nil {
			return err
		}
	}
	return nil
}

func decodeAll(r io.Reader) ([]Event, error) {
	dec := json.NewDecoder(r)
	var out []Event
	for {
		var e Event
		if err := dec.Decode(&e); err != nil {
			if err == io.EOF {
				return out, nil
			}
			return nil, err
		}
		out = append(out, e)
	}
}

func main() {
	var buf strings.Builder
	_ = encodeAll(&buf, []Event{
		{ID: 1, Msg: "hello"},
		{ID: 2, Msg: "world"},
	})
	fmt.Print(buf.String())

	events, _ := decodeAll(strings.NewReader(buf.String()))
	fmt.Printf("decoded %d events\n", len(events))
}
```

Output:
```
{"id":1,"msg":"hello"}
{"id":2,"msg":"world"}
decoded 2 events
```

</details>

---

## Task 20: Schema-evolution decoder with version field

**Goal:** Decode payloads where the schema has evolved across versions. Older clients still send v1; newer clients send v2 with extra fields and renamed members.
**Difficulty:** Staff
**Skills:** Two-phase decode, polymorphism, version dispatch.

### Steps
1. Define a wire format with a `"version"` field at the top.
2. First-phase decode peeks at the version.
3. Second-phase decodes into the version-specific struct.
4. Convert each version into a canonical internal type.

### Acceptance criteria
- v1 and v2 payloads both decode into the same internal `User` type.
- Forward compatibility: a v3 payload is rejected cleanly with a version error.

<details><summary>Hint</summary>

Use `json.RawMessage` for the body so you parse it twice efficiently: first the discriminator, then the payload.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"fmt"
)

// Internal canonical type.
type User struct {
	ID    int
	Email string
}

// Wire formats per version.
type wireV1 struct {
	UID  int    `json:"uid"`
	Mail string `json:"mail"`
}

type wireV2 struct {
	ID    int    `json:"id"`
	Email string `json:"email"`
}

type envelope struct {
	Version int             `json:"version"`
	Data    json.RawMessage `json:"data"`
}

func parseUser(data []byte) (User, error) {
	var env envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return User{}, err
	}
	switch env.Version {
	case 1:
		var w wireV1
		if err := json.Unmarshal(env.Data, &w); err != nil {
			return User{}, err
		}
		return User{ID: w.UID, Email: w.Mail}, nil
	case 2:
		var w wireV2
		if err := json.Unmarshal(env.Data, &w); err != nil {
			return User{}, err
		}
		return User{ID: w.ID, Email: w.Email}, nil
	default:
		return User{}, fmt.Errorf("unsupported version %d", env.Version)
	}
}

func main() {
	v1 := []byte(`{"version":1,"data":{"uid":7,"mail":"a@b.com"}}`)
	v2 := []byte(`{"version":2,"data":{"id":8,"email":"c@d.com"}}`)
	v3 := []byte(`{"version":3,"data":{}}`)

	for _, b := range [][]byte{v1, v2, v3} {
		u, err := parseUser(b)
		fmt.Printf("user=%+v err=%v\n", u, err)
	}
}
```

</details>

---

## Self-grading rubric

| Level | Tasks done | What it means |
|---|---|---|
| Junior | 1-4 | You can use `encoding/json` for basic encode/decode and know about tags. |
| Middle | 5-10 | You can implement custom marshalers, stream large data, and read scanner source. |
| Senior | 11-17 | You can profile, optimize, and harden JSON for production. |
| Staff | 18-20 | You can reason about API design (v1/v2), build streaming wire protocols, and design schema-evolution strategies. |

Aim for 80% completion at your target level before moving up.

---

## Stretch challenges

**S1: Build a `Decoder` middleware that records the JSON path of every decode error.** When a request fails to decode, return a detailed `{"error":"field 'user.address.zip' expected string, got number"}` instead of the default generic message. Hint: wrap `Decoder.Decode` and intercept `*json.UnmarshalTypeError`.

**S2: Implement a streaming JSON-to-CSV converter.** Read a JSON-Lines file via `Decoder`, identify the schema from the first record, emit CSV rows. Bonus: handle nested objects via dot notation. Memory must not scale with input length.

**S3: Build a JSON-schema validator on top of `json.RawMessage`.** Given a schema (subset of JSON Schema: required fields, types, min/max), validate payloads without unmarshaling into typed structs. Compare to existing libraries (`xeipuuv/gojsonschema`) for completeness and speed.
