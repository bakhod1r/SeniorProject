# Cross-Package Methods — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. The rule: **you may only define methods on a type declared in your own package**. To attach behaviour to a foreign type (`time.Time`, `net.IP`, `*sql.DB`, `http.Client`, ...), wrap it with a defined type or embed it in a struct.

---

## Easy 🟢

### Task 1 — Wrap `time.Time` as `MyTime`
Define `type MyTime time.Time` and add `Format24h() string` returning the time as `"15:04:05"`. You will need to convert `MyTime` back to `time.Time` inside the body.

```go
type MyTime time.Time
// Write: func (m MyTime) Format24h() string
```

### Task 2 — Why this fails
Explain in a one-line comment why the snippet below does not compile, then rewrite it correctly using `MyTime`.

```go
// func (t time.Time) Hello() string { return "hi" }
```

### Task 3 — Round-trip conversion
Add `NewMyTime(t time.Time) MyTime` and `Std() time.Time`. Demonstrate `MyTime(t)` and `time.Time(mt)` conversions in `main`.

### Task 4 — `MyTime.IsWeekend()`
Add `IsWeekend() bool` to `MyTime`. Use the wrapped value's `Weekday()`.

### Task 5 — `String()` method on `MyTime`
Make `MyTime` satisfy `fmt.Stringer` by returning RFC3339-formatted text.

---

## Medium 🟡

### Task 6 — `Duration` wrapper with `Format` and `Parse`
Build `type Duration time.Duration` with:

```go
func (d Duration) Format() string              // "1h2m3s" → "1h 2m 3s"
func ParseDuration(s string) (Duration, error) // accepts "1h 2m 3s"
```

Delegate to `time.ParseDuration` after stripping spaces.

### Task 7 — Alias vs defined type
You are exposing this API:

```go
// Variant A
type UserID = string

// Variant B
type UserID string
func (u UserID) IsValid() bool { return u != "" }
```

Decide which variant to ship if the goal is to **prevent passing a raw `string` where a `UserID` is expected** while still allowing `IsValid()` as a method.

### Task 8 — `PrivateIP` wrapping `net.IP`
Define `type PrivateIP net.IP` and add `IsRFC1918() bool` returning `true` for `10/8`, `172.16/12`, `192.168/16`. Use `net.ParseCIDR`.

```go
type PrivateIP net.IP
// Write: func (p PrivateIP) IsRFC1918() bool
```

### Task 9 — `bytes.Buffer` via embedding
Wrap `*bytes.Buffer` in `LineBuffer` exposing a new `WriteLine(s string)` method while keeping every existing `bytes.Buffer` method available via embedding.

```go
type LineBuffer struct{ *bytes.Buffer }
// Write: func (lb *LineBuffer) WriteLine(s string)
```

### Task 10 — Convert vs construct
Given `t := time.Now()`, show three forms and say which is preferred:

```go
mt1 := MyTime(t)          // conversion
mt2 := NewMyTime(t)       // constructor
mt3 := *(*MyTime)(&t)     // unsafe-style alias dance
```

---

## Hard 🔴

### Task 11 — `RetryClient` wrapping `http.Client`
Wrap `*http.Client` to add automatic retries on `5xx` responses. Use **embedding** so `Get`, `Post`, ... stay usable, but override `Do` to retry up to `n` times with a small delay.

```go
type RetryClient struct {
    *http.Client
    Max int
}
// Write: func (c *RetryClient) Do(req *http.Request) (*http.Response, error)
```

### Task 12 — `json.Marshaler` on a wrapped `time.Time`
Define `type EpochTime time.Time` and implement `MarshalJSON` to encode Unix seconds (`1714997123`) instead of RFC3339. Also implement `UnmarshalJSON`.

### Task 13 — `MeteredDB` wrapping `*sql.DB`
Wrap `*sql.DB` so every `QueryContext` and `ExecContext` call increments counters. Keep the rest of the API reachable via embedding.

```go
type MeteredDB struct {
    *sql.DB
    Queries atomic.Int64
    Execs   atomic.Int64
}
```

### Task 14 — Refactor `func Print(t time.Time)` into a method
Given:

```go
package report
import "time"

func Print(t time.Time) string {
    return "report at " + t.Format(time.RFC3339)
}
```

Rewrite `Print` as a method on `type ReportTime time.Time` so the call site reads `ReportTime(t).Print()`. Explain why `func (t time.Time) Print() string` is illegal here.

### Task 15 — `LoggingHandler` wrapping `http.Handler`
Implement `type LoggingHandler struct{ http.Handler }`. Log `method + url + duration` and delegate to the embedded `ServeHTTP`. Show it satisfies `http.Handler` via promotion.

---

## Expert 🟣

### Task 16 — Generic `Pointer[T]` wrapper
Define a generic wrapper around any type:

```go
type Pointer[T any] struct{ v *T }
// Write: New, Get, Set, IsNil
// Bonus: explain why a method `String()` constrained to T: fmt.Stringer
//        is impossible, and give the package-level alternative.
```

### Task 17 — Embedding chain that re-exposes the underlying API
Build the chain `A → B → C`:

- `A` is `*sql.DB` (foreign std type)
- `B` is `MeteredDB` from Task 13
- `C` is `TracingDB` that embeds `*MeteredDB` and adds spans

Verify you can still call `.Ping()` on a `*TracingDB` — two levels deep — purely through promotion.

### Task 18 — Method set rules across the wrap
Given `type MyTime time.Time`, answer in a comment block:

1. Does `MyTime` inherit `time.Time.Format`?
2. Does `MyTime` inherit `(*time.Time).UnmarshalJSON`?
3. What happens to interfaces that `time.Time` satisfied (e.g. `json.Marshaler`)?

Then write a tiny program demonstrating each answer.

### Task 19 — Plugin registry indexed by wrapper methods
Build a registry of "report renderers", each one a wrapper over `time.Time`:

```go
type Renderer interface{ Render() string }

type AsRFC3339 time.Time
type AsUnix    time.Time
type AsKitchen time.Time
```

Pick the renderer by name, convert the incoming `time.Time` into the right wrapper and call `Render()`.

### Task 20 — Wrap vs alias for a public API
You are designing a `Money` type for a public library:

```go
// A: alias — zero overhead, no new method set
type Money = int64

// B: defined type — own method set, conversions required
type Money int64
```

Pick one and justify in a comment block. Write the chosen code with `Add`, `Sub`, `String`, plus `FromCents(int64) Money`.

---

## Solutions

### Solution 1

```go
type MyTime time.Time

func (m MyTime) Format24h() string {
    return time.Time(m).Format("15:04:05")
}
```
`MyTime` does NOT inherit methods from `time.Time` — only the layout. Convert back inside the method.

### Solution 2

```go
// time.Time lives in the "time" package — we cannot define methods on it
// from any other package. Wrap it, then attach methods to the wrapper.

type MyTime time.Time
func (m MyTime) Hello() string { return "hi" }
```

### Solution 3

```go
type MyTime time.Time

func NewMyTime(t time.Time) MyTime { return MyTime(t) }
func (m MyTime) Std() time.Time    { return time.Time(m) }

func main() {
    t    := time.Now()
    mt   := MyTime(t)       // conversion
    back := time.Time(mt)   // and back
    _ = back
}
```

### Solution 4

```go
func (m MyTime) IsWeekend() bool {
    wd := time.Time(m).Weekday()
    return wd == time.Saturday || wd == time.Sunday
}
```

### Solution 5

```go
func (m MyTime) String() string {
    return time.Time(m).Format(time.RFC3339)
}
```

`time.Time`'s own `String()` is NOT promoted — defined type, not embedding.

### Solution 6

```go
type Duration time.Duration

func (d Duration) Format() string {
    s := time.Duration(d).String() // "1h2m3s"
    s = strings.ReplaceAll(s, "h", "h ")
    s = strings.ReplaceAll(s, "m", "m ")
    return strings.TrimSpace(s)
}

func ParseDuration(s string) (Duration, error) {
    td, err := time.ParseDuration(strings.ReplaceAll(s, " ", ""))
    if err != nil { return 0, err }
    return Duration(td), nil
}
```

### Solution 7

```go
// Variant A (alias) — UserID == string, so raw strings flow in freely AND
// methods on UserID would actually be methods on string (illegal cross-pkg).
// Variant B (defined type) creates a NEW type:
//   - compiler refuses raw strings without an explicit conversion
//   - we own the method set: IsValid() lives on UserID
// Ship Variant B.

type UserID string
func (u UserID) IsValid() bool { return u != "" }
```

### Solution 8

```go
type PrivateIP net.IP

var rfc1918 = func() []*net.IPNet {
    out := []*net.IPNet{}
    for _, c := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"} {
        _, n, _ := net.ParseCIDR(c)
        out = append(out, n)
    }
    return out
}()

func (p PrivateIP) IsRFC1918() bool {
    ip := net.IP(p).To4()
    if ip == nil { return false }
    for _, n := range rfc1918 {
        if n.Contains(ip) { return true }
    }
    return false
}
```

### Solution 9

```go
type LineBuffer struct{ *bytes.Buffer }

func New() *LineBuffer { return &LineBuffer{Buffer: &bytes.Buffer{}} }

func (lb *LineBuffer) WriteLine(s string) {
    lb.WriteString(s) // promoted from *bytes.Buffer
    lb.WriteByte('\n')
}
// lb.Len(), lb.String(), lb.Reset() ... all promoted via embedding.
```
Embedding (not a defined type) fully promotes the wrapped `*bytes.Buffer` method set.

### Solution 10

```go
mt1 := MyTime(t)        // preferred: zero-cost conversion
mt2 := NewMyTime(t)     // good when you want validation/normalisation
mt3 := *(*MyTime)(&t)   // never — same effect, hides intent, looks unsafe
// Conversion is idiomatic; reach for a constructor only with logic.
```

### Solution 11

```go
type RetryClient struct {
    *http.Client
    Max int
}

func (c *RetryClient) Do(req *http.Request) (*http.Response, error) {
    var resp *http.Response
    var err  error
    for attempt := 0; attempt <= c.Max; attempt++ {
        resp, err = c.Client.Do(req) // embedded *http.Client.Do
        if err == nil && resp.StatusCode < 500 { return resp, nil }
        if resp != nil { resp.Body.Close() }
        time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
    }
    return resp, err
}
// c.Get(url), c.Post(...) still work — promoted from *http.Client.
```

### Solution 12

```go
type EpochTime time.Time

func (e EpochTime) MarshalJSON() ([]byte, error) {
    return []byte(strconv.FormatInt(time.Time(e).Unix(), 10)), nil
}

func (e *EpochTime) UnmarshalJSON(data []byte) error {
    sec, err := strconv.ParseInt(string(data), 10, 64)
    if err != nil { return err }
    *e = EpochTime(time.Unix(sec, 0).UTC())
    return nil
}
```
`encoding/json` finds our `MarshalJSON` via the interface table; `time.Time`'s default is bypassed.

### Solution 13

```go
type MeteredDB struct {
    *sql.DB
    Queries, Execs atomic.Int64
}

func Wrap(db *sql.DB) *MeteredDB { return &MeteredDB{DB: db} }

func (m *MeteredDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    m.Queries.Add(1)
    return m.DB.QueryContext(ctx, q, args...)
}
func (m *MeteredDB) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
    m.Execs.Add(1)
    return m.DB.ExecContext(ctx, q, args...)
}
// m.Ping(), m.Close(), m.Stats() ... promoted from *sql.DB.
```

### Solution 14

```go
// `func (t time.Time) Print() string` is illegal — Go forbids defining
// methods on a type from another package. Wrap it instead.
type ReportTime time.Time

func (r ReportTime) Print() string {
    return "report at " + time.Time(r).Format(time.RFC3339)
}
// Call site: ReportTime(t).Print()
```

### Solution 15

```go
type LoggingHandler struct{ http.Handler }

func (h LoggingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    h.Handler.ServeHTTP(w, r)
    log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
}
// LoggingHandler{Handler: mux} satisfies http.Handler via our override.
```

### Solution 16

```go
type Pointer[T any] struct{ v *T }

func New[T any](x T) *Pointer[T]  { return &Pointer[T]{v: &x} }
func (p *Pointer[T]) Get() T      { return *p.v }
func (p *Pointer[T]) Set(x T)     { *p.v = x }
func (p *Pointer[T]) IsNil() bool { return p == nil || p.v == nil }

// Methods cannot introduce their own type-parameter constraints, so
// `String()` requiring T: fmt.Stringer is impossible. Use a package-level
// generic function instead:
func Format[T fmt.Stringer](p *Pointer[T]) string {
    if p.IsNil() { return "<nil>" }
    return (*p.v).String()
}
```

### Solution 17

```go
type TracingDB struct{ *metricsdb.MeteredDB }

func (t *TracingDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    log.Printf("trace: %q", q)
    return t.MeteredDB.QueryContext(ctx, q, args...) // → MeteredDB → *sql.DB
}

func main() {
    raw, _ := sql.Open("postgres", "")
    t := &TracingDB{metricsdb.Wrap(raw)}
    _ = t.Ping() // promoted *sql.DB.Ping through two wrappers
}
```

### Solution 18

```go
// 1. NO. `type MyTime time.Time` is a defined type — its method set
//    starts empty. Format() is not inherited.
// 2. NO, same reason; UnmarshalJSON is also on *time.Time, not the value.
// 3. Interfaces are LOST. MyTime no longer satisfies json.Marshaler,
//    fmt.Stringer, etc. — re-implement them (see Solution 12).

func main() {
    t  := time.Now()
    mt := MyTime(t)
    _  = t.Format(time.RFC3339)             // OK
    // _ = mt.Format(time.RFC3339)          // compile error
    _  = time.Time(mt).Format(time.RFC3339) // OK after conversion
}
```

### Solution 19

```go
type Renderer interface{ Render() string }

type AsRFC3339 time.Time
type AsUnix    time.Time
type AsKitchen time.Time

func (a AsRFC3339) Render() string { return time.Time(a).Format(time.RFC3339) }
func (a AsUnix)    Render() string { return time.Time(a).UTC().Format("2006-01-02") }
func (a AsKitchen) Render() string { return time.Time(a).Format(time.Kitchen) }

var registry = map[string]func(time.Time) Renderer{
    "rfc3339": func(t time.Time) Renderer { return AsRFC3339(t) },
    "unix":    func(t time.Time) Renderer { return AsUnix(t) },
    "kitchen": func(t time.Time) Renderer { return AsKitchen(t) },
}

func Render(name string, t time.Time) string {
    if fn, ok := registry[name]; ok { return fn(t).Render() }
    return ""
}
```

### Solution 20

```go
// Public APIs benefit from defined types: callers cannot accidentally pass
// a raw int64, and we attach behaviour (String, Cents, Add, Sub) directly.
// Aliases surrender both properties — choose B.
type Money int64

func FromCents(c int64) Money     { return Money(c) }
func (m Money) Cents() int64      { return int64(m) }
func (m Money) Add(o Money) Money { return m + o }
func (m Money) Sub(o Money) Money { return m - o }
func (m Money) String() string {
    sign, n := "", int64(m)
    if n < 0 { sign, n = "-", -n }
    return fmt.Sprintf("%s$%d.%02d", sign, n/100, n%100)
}
```
