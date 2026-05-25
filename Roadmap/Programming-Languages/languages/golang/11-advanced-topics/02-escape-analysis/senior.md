# Escape Analysis — Senior

## 1. Mental model

Think of escape analysis as building a directed graph:

- Nodes = expressions and locations (variables, parameters, result slots, heap, global namespace).
- Edges = "the value at A can flow to B".

After construction, the compiler walks reachability from a small set of *roots* (heap, globals, returned results) backward. Any node reachable from those roots represents a value that must outlive the current frame, so its source location is heap-allocated.

Three properties shape every interesting decision:

1. **Conservative** — when in doubt, escape.
2. **Intra-function with summaries** — cross-function flow is approximated by per-function lattices.
3. **Inlining-driven** — inlining concretizes flow that summaries can only approximate.

---

## 2. The escape lattice

Internally, each location holds a *leak level*, a bit set indicating which sinks the location may reach. The relevant sinks:

| Sink | What it represents |
|------|--------------------|
| Heap | Must outlive the frame |
| Returned via result `i` | Escapes if and only if the result escapes in the caller |
| Mutator parameter | Stored back through a pointer parameter |
| Outer closure scope | Captured by a closure that may escape |

A summary like `leaks param x to {heap, ~r0}` means: this parameter's pointer may end up on the heap or come back through result 0. Callers union the leak set into their own analysis.

---

## 3. The `-m=3` debugging mode

```bash
go build -gcflags="-m=3 -l=4" ./... 2> esc.txt
```

`-m=3` dumps detailed escape strings; `-l=4` aggressively inlines. The output is verbose but invaluable when you need to know exactly *why* a value escaped.

Look for sequences like:

```
flow: x = &T literal:
  from &T{...} (address-of) at f.go:10
  from x = &T{...} at f.go:10
flow: ~r0 = x:
  from return x at f.go:12
```

A flow line is the compiler tracing the path from your allocation to a sink.

---

## 4. The "leak to heap" by interface conversion

```go
func loud(v any) {
    fmt.Println(v)
}

func hot() {
    for i := 0; i < N; i++ {
        loud(i)              // boxes i into any → heap allocation per call
    }
}
```

This pattern shows up everywhere: `log.Print`, `fmt.Sprintf("%v", x)`, the `slog` interface methods, generic `errors.As`. None of them are buggy — they pay an allocation per call because that's the contract of `any`.

In Go 1.21+ the standard library's `log/slog` uses `slog.Attr` and typed accessors to avoid most of this. The advice in hot paths: prefer typed APIs, use generics, build a single composite log value and pass it as a whole if you must.

---

## 5. The result-pointer trick (don't be clever)

A common "optimization":

```go
type Buf struct{ data [4096]byte }

func (b *Buf) Read(r io.Reader) (int, error) {
    return r.Read(b.data[:])
}

func consume(r io.Reader) {
    var b Buf
    b.Read(r)
}
```

Intent: `b` stays on the stack because we use `&b` only via the method, and the slice into `b.data` is "obviously" bounded. The compiler usually agrees — but if `Buf` is large or the method is not inlined (e.g., via interface), the analyzer may give up and heap-allocate `b`. Always verify with `-m`.

A safer transformation: pass the buffer in.

```go
func read(r io.Reader, buf *[4096]byte) (int, error) {
    return r.Read(buf[:])
}
```

Now the caller owns the buffer, and the analyzer has no excuse to escape it (unless the caller itself escapes the buffer).

---

## 6. Channels and goroutines

Sending on a channel is a heap escape candidate. The value being sent is conceptually copied into the channel's buffer, which lives on the heap. For struct values this is a copy; for pointers it's transferring the pointer (and pinning the pointee).

```go
ch := make(chan *Job, 1)
j := &Job{}                  // j → heap (sent on channel)
ch <- j
```

Receiving a value into a fresh variable: the value is copied from the channel into the receiver's frame. That receiver variable is **not** automatically escaped; it follows the usual rules.

Goroutine-launched functions inherit standard escape rules: arguments that the goroutine retains escape, arguments only read inside don't.

---

## 7. Method value vs. method expression

```go
type T struct{ v int }

func (t T) Get() int { return t.v }

func a() {
    t := T{42}
    f := t.Get               // method value: captures t (by value)
    _ = f()
}

func b() {
    f := T.Get               // method expression: takes t as first arg, captures nothing
    _ = f(T{42})
}
```

A method value captures the receiver — that capture follows closure escape rules. A method expression is just a regular function. If you assign a method value to a heap-resident variable, the receiver escapes.

---

## 8. `defer` and escape

`defer f(args)` evaluates the arguments immediately and stores them in a deferred call record. The record lives on the goroutine's stack (Go 1.14+, "open-coded defers") for the common case. Pathological cases — defers inside loops, defers via function values, more than 8 defers per function — fall back to a heap-allocated record.

```go
for _, f := range files {
    f, _ := os.Open(...)
    defer f.Close()           // heap-allocated record per iteration in pre-1.14 / pathological cases
}
```

In Go 1.14+ this is much better, but the deeper bug — defers don't fire until the function returns — is still the bigger problem.

---

## 9. The "stack-allocated map" myth

Maps are always heap. Period.

```go
m := map[string]int{}
```

The map header itself is small but lives on the heap; its buckets, definitely on the heap. There is no stack-allocated map in current Go. If you need a tiny lookup, prefer a fixed array or a `switch` for compile-time constant keys.

For very small int-keyed sparse data, a slice can beat a map. For string-keyed small dictionaries with known keys, a `switch` beats both.

---

## 10. Slicing a stack-only array

```go
func f() int {
    var a [16]int           // stack
    s := a[:]               // s's backing array is a's storage; doesn't escape
    return sum(s)
}
```

The slice header points into the stack array. As long as `s` doesn't escape, `a` remains on the stack. The moment you return `s` or store it in a heap-resident container, `a` is moved to the heap.

This pattern — fixed-size local array, slice it, hand to a helper — is a common zero-allocation technique.

---

## 11. Compiler version drift

Escape analysis changes between Go versions. Notable improvements:

- Go 1.17: more accurate analysis through method values.
- Go 1.20: better handling of zero-sized slices and certain closure patterns.
- Go 1.21: improved analysis for inlined methods on pointer receivers.
- Go 1.22+: incremental improvements to interface conversion detection.

A bench that shows `0 allocs/op` today may show `1 alloc/op` tomorrow if a compiler heuristic flips. Treat zero-alloc benchmarks as **regression guards**, not invariants.

---

## 12. Adversarial code review

When reviewing code where allocations matter, look for:

| Pattern | Likely escape |
|---------|---------------|
| `return &localStruct{...}` | Yes |
| `interface{}` parameter in a hot loop | Yes |
| `fmt.Sprintf` in a hot path | Yes (format args slice, formatter, result) |
| `reflect.X` anywhere on the path | Yes |
| Closure stored in a struct field | Captures escape |
| `make([]T, 0, capacity)` where the slice is returned | Yes |
| `&T.Method` where `T` is the local receiver | Captures `T` to heap |

Most of these are fine in normal code. They're only "bugs" in measured-hot paths.

---

## 13. When escape is *correct*

Don't fight the analyzer for its own sake. A heap allocation is the right answer when:

- The lifetime is genuinely longer than the call.
- The object is too large for the stack.
- Predictable structure beats a fragile zero-alloc optimization that breaks on the next Go upgrade.

The goal of escape analysis literacy is to make informed choices — sometimes the choice is "accept the allocation; it's fine".

---

## 14. Summary

Escape analysis is a conservative, intra-function pass with cross-function summaries, refined by inlining. Senior engineers read `-m` output fluently, use `benchstat` to track regressions, and know which patterns (returned addresses, interface conversion, reflection, unsafe, closures) reliably cause escape. The goal isn't zero allocations everywhere — it's understanding which allocations you're paying for and why.

---

## Further reading
- `cmd/compile/internal/escape/doc.go`
- Go release notes (each version) — compiler section
- "Generics can make your Go code slower": https://planetscale.com/blog/generics-can-make-your-go-code-slower
- Bill Kennedy's escape series (ardanlabs.com)
