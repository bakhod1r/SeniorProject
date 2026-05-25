# Escape Analysis — Junior

## 1. What is escape analysis?

When you write Go code, every variable is born somewhere — either on the **stack** (cheap, automatic, tied to a function call) or on the **heap** (managed by the garbage collector). The Go compiler decides which, using a process called **escape analysis**. You never make the choice directly. Your job is to understand the rules well enough to write code that doesn't pay surprise costs.

The name comes from a simple idea: if a value's *address* can be observed after the function returns, the value has "escaped" the function. It must outlive the stack frame, so it goes on the heap.

---

## 2. The one-line rule

> If the compiler can prove a value's address never leaves the function, the value lives on the stack. Otherwise, it lives on the heap.

That's the whole concept.

---

## 3. Asking the compiler what it decided

```bash
go build -gcflags="-m" ./...
```

This prints one line per allocation or escape decision. Try it on a tiny file:

```go
// main.go
package main

import "fmt"

func main() {
    x := 42
    fmt.Println(&x)
}
```

```bash
$ go build -gcflags="-m" .
./main.go:7:14: ... argument does not escape
./main.go:7:15: &x escapes to heap
./main.go:6:2: moved to heap: x
```

The compiler explains itself.

---

## 4. The common shapes that escape

### 4.1. Returning a pointer to a local

```go
func makePoint() *Point {
    p := Point{1, 2}
    return &p          // p escapes → heap
}
```

### 4.2. Storing into an `interface{}`

```go
func print(v any) { fmt.Println(v) }

func f() {
    x := 42
    print(x)           // x boxes into any → escapes
}
```

### 4.3. Capturing in a closure that escapes

```go
func counter() func() int {
    n := 0
    return func() int { n++; return n }   // n escapes
}
```

### 4.4. Storing into a heap-resident container

```go
var sink []*int

func add(x int) {
    sink = append(sink, &x)               // &x escapes
}
```

### 4.5. A struct too big for the stack

```go
func big() {
    var a [20 << 20]byte                  // 20 MiB → heap
    _ = a
}
```

---

## 5. The shapes that don't escape

```go
func sum(xs []int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total                          // total stays on the stack
}

func midpoint(a, b Point) Point {
    return Point{ (a.X+b.X)/2, (a.Y+b.Y)/2 }   // no addresses leak
}

func area(r *Rect) int {                  // r came from caller; we only read
    return r.W * r.H
}
```

Reading through a pointer is fine. *Storing* the pointer somewhere that outlives the call is what causes escape.

---

## 6. Why you should care

A heap allocation is more expensive than a stack one:

- Stack: pointer bump, no metadata, zero GC work.
- Heap: size-class lookup, metadata bookkeeping, eventual GC cost (mark + sweep).

For a one-off operation the cost is tiny. In a hot loop that runs a million times per second, those allocations stack up and become the difference between 100 µs latency and 1 ms.

---

## 7. Two concrete patterns to fix early

### 7.1. "Return value, not pointer" for small structs

```go
// allocates
func newPoint() *Point { return &Point{1, 2} }

// no allocation
func newPoint() Point { return Point{1, 2} }
```

For structs that fit in a couple of CPU registers (think ≤ 32 bytes), returning by value is faster.

### 7.2. Use `strings.Builder`, not `+=`

```go
// allocates many times
var s string
for _, p := range parts { s += p }

// one allocation
var b strings.Builder
for _, p := range parts { b.WriteString(p) }
s := b.String()
```

The `+=` form makes a new string each iteration. The builder grows one backing array geometrically.

---

## 8. Common misconceptions

| You might think | Reality |
|------------------|---------|
| "Pointer = heap, value = stack" | False. A *pointer* can point to a stack value if the pointer doesn't escape. |
| "Big structs always escape" | False. A 64-byte struct is fine on the stack as long as you don't leak its address. |
| "`new(T)` always heaps" | False. `new(T)` is just `&T{}`; same escape rules apply. |
| "I should avoid all heap allocations" | Bad goal. Code clarity matters more. Optimize hot paths after measuring. |

---

## 9. A practical workflow

1. Write the code clearly first.
2. If a hot path looks slow, write a benchmark with `-benchmem`.
3. If allocations look high, run `go build -gcflags="-m" ./pkg` and read the lines for that file.
4. Pick one or two big offenders and restructure (return value, preallocate, avoid interface, etc.).
5. Re-bench. If the win is small, leave the change off and move on.

---

## 10. Summary

Escape analysis is the compiler's static check that decides whether each value goes on the **stack** (cheap, scoped to a function) or the **heap** (managed by the GC). The rule: if the value's address could outlive the function, it escapes. Use `-gcflags="-m"` to see the decisions, and care about it only when measurement says you should.

---

## Further reading
- "Allocation efficiency in high-performance Go services" — Segment blog
- `go help build` for the `-gcflags` flag
- Memory management deep dive: [01-memory-management-in-depth](../01-memory-management-in-depth/)
