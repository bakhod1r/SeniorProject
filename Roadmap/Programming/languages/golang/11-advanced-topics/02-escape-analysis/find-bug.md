# Escape Analysis — Find the Bug

A library of realistic "why is this allocating?" scenarios. For each: code, the surprising allocation, the cause, the fix.

---

## Bug 1: The interface upgrade

```go
type Writer interface { Write(p []byte) (int, error) }

func send(w Writer, msg string) error {
    _, err := w.Write([]byte(msg))   // copy: expected
    return err
}

func init() {
    send(os.Stdout, "hello")
}
```

**Symptom.** `pprof` shows allocations from `runtime.convT*` at the `send(os.Stdout, ...)` call site.

**Cause.** `os.Stdout` is `*os.File`. It implements `Writer`. The conversion `*os.File` → `Writer` allocates an interface header if the pointee can't be inlined — but it shouldn't here. The real allocation: `[]byte(msg)` copies the string.

**Fix.** Use `io.WriteString(w, msg)` — it takes a `string` directly and avoids the copy.

---

## Bug 2: The variadic with `any`

```go
func logf(args ...any) {
    for _, a := range args {
        fmt.Println(a)
    }
}

func main() {
    logf(1, "two", 3.0)
}
```

**Symptom.** Three allocations per call from `runtime.convT*`.

**Cause.** Each argument is converted to `any`. For numeric types the conversion allocates.

**Fix.** Use a typed signature where possible. For loggers, prefer `slog`'s typed attrs:

```go
slog.Info("op", slog.Int("count", 1), slog.String("name", "two"))
```

---

## Bug 3: The "passed by value" pointer

```go
type Node struct { val int; next *Node }

func walk(n Node) int {                   // takes Node by value
    total := 0
    for cur := &n; cur != nil; cur = cur.next {
        total += cur.val
    }
    return total
}
```

**Symptom.** `n` moves to heap.

**Cause.** `&n` takes the address of the parameter; the analyzer can't prove it doesn't escape (it could be saved by the loop body in theory). Even though we know it can't, the compiler is conservative.

**Fix.** Either take a `*Node` directly, or copy the relevant field into a local you don't take the address of.

---

## Bug 4: The "return error wrapper"

```go
func read() error {
    if err := doRead(); err != nil {
        return fmt.Errorf("read failed: %w", err)   // allocates per call
    }
    return nil
}
```

**Symptom.** Many small allocations on the error path. In a service that sees a normal rate of soft errors (cancelled contexts, EOFs, retried requests), this is non-negligible.

**Cause.** `fmt.Errorf` allocates: the formatted string, a `*fmt.wrapError`, and copies the message.

**Fix.** Use sentinel errors for known cases:

```go
var ErrReadFailed = errors.New("read failed")

func read() error {
    if err := doRead(); err != nil {
        return fmt.Errorf("%w: %w", ErrReadFailed, err)  // still allocs, but explicit
    }
    return nil
}
```

For hot, structured paths consider custom error types with `Unwrap` rather than format strings.

---

## Bug 5: The closure that copies a big struct

```go
func register(cfg Config) {                       // Config is 1 KiB
    handler := func() { use(cfg) }                // captures cfg by value
    handlers = append(handlers, handler)
}
```

**Symptom.** Heap allocation of ~1 KiB per registration.

**Cause.** The closure escapes (stored in a slice). Its captured variables escape with it, and they include the whole `Config`.

**Fix.** Pass a pointer or a smaller derived value:

```go
func register(cfg *Config) {
    handler := func() { use(cfg) }
    handlers = append(handlers, handler)
}
```

If `Config` is intended to be immutable, sharing a pointer is correct anyway.

---

## Bug 6: The `time.Format` parade

```go
func log(t time.Time, msg string) {
    fmt.Printf("[%s] %s\n", t.Format(time.RFC3339), msg)
}
```

**Symptom.** Each call allocates: the formatted time string and the formatted output string.

**Cause.** `Format` returns a new string; `Printf` builds a new buffer.

**Fix.**

```go
var buf [40]byte
b := t.AppendFormat(buf[:0], time.RFC3339)
fmt.Fprintln(w, string(b), msg)
```

Still allocates the final string, but skips the intermediate. For a logger writing to a `*bufio.Writer`, you can avoid even that.

---

## Bug 7: The slice mistake

```go
type Service struct {
    log []string
}

func (s *Service) Add(line string) {
    s.log = append(s.log, line)              // backing array escapes (long-lived)
}
```

**Symptom.** The string literal `line` itself doesn't escape. But every dynamically constructed argument does, because the backing slice is long-lived.

**Cause.** This isn't a bug per se — `Service` is supposed to hold the log. The issue is when callers expect to retain ownership of `line` and assume `Add` is cheap.

**Fix.** Document: "Add copies `line` into the service's log; the caller may reuse the underlying memory." Optionally, accept a `[]byte` if avoiding the string allocation matters at the call site.

---

## Bug 8: The map of structs by key

```go
func find(items []Item, name string) *Item {
    m := make(map[string]*Item, len(items))
    for i := range items {
        m[items[i].Name] = &items[i]
    }
    return m[name]
}
```

**Symptom.** Heap allocation of the map every call. Worse: `&items[i]` causes the slice's backing array to be retained as long as any returned pointer is live.

**Cause.** The map is local but doesn't escape, so theoretically it could be optimized — but maps always heap. And the pointer-to-element pins the whole slice.

**Fix.** If you only need one lookup, linear scan:

```go
func find(items []Item, name string) *Item {
    for i := range items {
        if items[i].Name == name { return &items[i] }
    }
    return nil
}
```

For repeated lookups, build the map once and reuse.

---

## Bug 9: The "leaked" return

```go
func process() (result []int, err error) {
    result = make([]int, 0, 100)
    if err = setup(); err != nil { return }
    // ... fill result ...
    return
}
```

**Symptom.** `result` is on the heap even when `setup` fails (and result is therefore empty).

**Cause.** Named return values that escape force the underlying slice's backing array to be heap-allocated unconditionally. The compiler can't predict at compile time whether the slice will be returned with content.

**Fix.** Local then return:

```go
func process() ([]int, error) {
    if err := setup(); err != nil { return nil, err }
    result := make([]int, 0, 100)
    // ... fill result ...
    return result, nil
}
```

The slice is still on the heap (it's returned), but we avoid allocating in the error path.

---

## Bug 10: The reflect tax

```go
func render(v any) string {
    return fmt.Sprintf("%v", v)
}
```

**Symptom.** Allocations multiplied: the call passes `v` as `any` (one box), `fmt.Sprintf` reflects over it, builds a slice of formatters, constructs the result, etc.

**Cause.** Every `%v` chain goes through `reflect.Value` internally; the value escapes; the result is built in a freshly allocated buffer.

**Fix.** If the type is known, format directly:

```go
func renderUser(u User) string {
    return u.Name + ":" + strconv.Itoa(u.ID)
}
```

For variable types, accept the cost as the price of polymorphism.

---

## Bug 11: The struct that's "just one field"

```go
type Counter struct {
    n int
}

func incBad(c Counter) Counter {
    c.n++
    return c
}

var c = Counter{}

func loop() {
    for i := 0; i < 1e6; i++ {
        c = incBad(c)
    }
}
```

**Symptom.** Surprisingly low alloc count — none! But profiling shows the loop is slower than expected.

**Cause.** No heap allocation; the cost is the value copy on every call. For a one-field struct this is fine; for a 1 KiB struct in a hot loop it's an unmissable cost.

**Fix.** Use a pointer receiver for mutation:

```go
func (c *Counter) Inc() { c.n++ }
```

This is correct behavior tracking: don't conflate "no heap" with "no cost".

---

## Bug 12: The map with growth allocations

```go
m := make(map[string]int)             // no hint
for i := 0; i < 1e6; i++ {
    m[strconv.Itoa(i)] = i
}
```

**Symptom.** Many `runtime.mapassign` and bucket reallocations in the profile.

**Cause.** No size hint; the map rehashes geometrically as it grows. Each rehash is O(N).

**Fix.**

```go
m := make(map[string]int, 1e6)
```

The hint reserves bucket space, avoiding most rehashes.

---

## Bug 13: The deferred closure

```go
func handle(req *Request) {
    defer func() {                              // closure captures req
        recordMetric(req)
    }()
    process(req)
}
```

**Symptom.** Each call allocates a deferred call record on the heap (in pre-1.14 Go) or has at least the closure value escape.

**Cause.** The closure captures `req` and the deferred record itself.

**Fix.** If possible, defer a top-level function:

```go
func handle(req *Request) {
    defer recordMetric(req)                     // args evaluated immediately, no closure
    process(req)
}
```

This avoids the closure allocation in pre-1.14 and is generally cheaper.

---

## 14. Summary

The recurring shapes: interface boxing, `fmt.Errorf` wrapping, captured closures, map without size hints, pointer-into-slice pinning, time/format intermediate strings, and `reflect`/`any` cascades. Recognize them in code review, confirm with `-gcflags="-m"`, and pick the smallest restructure that delivers the win.

---

## Further reading
- `slog` performance notes: https://go.dev/blog/slog
- Go 1.14 defer improvements: https://go.dev/blog/go1.14
- `runtime.convT*` family: https://github.com/golang/go/blob/master/src/runtime/iface.go
