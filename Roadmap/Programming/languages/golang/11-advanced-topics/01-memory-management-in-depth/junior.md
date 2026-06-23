# Memory Management in Depth — Junior

## 1. What is "memory" in a Go program?

Every variable, slice, map, and goroutine your program creates needs space in RAM. Go takes care of two big jobs for you:

1. **Allocating** that space when you create a value.
2. **Freeing** it once the value is no longer reachable.

The second job is done by the **garbage collector (GC)** — a background process inside the Go runtime that finds memory you no longer use and reclaims it. You never call `free`.

---

## 2. Two homes for your data: stack and heap

Go has two places where values live.

| Location | Who owns it | When it goes away |
|----------|-------------|-------------------|
| **Stack** | A single goroutine, one frame per function call | When the function returns |
| **Heap** | Shared by all goroutines | When the GC sees no one references it anymore |

Allocating on the stack is essentially free — it's a pointer bump. The heap costs more because the runtime has to track the object so the GC can later reclaim it.

You don't choose where a value lives — the **compiler** decides via *escape analysis*. Your job is to write clear code and understand the consequences.

---

## 3. A first look at escape analysis

```go
func makeOnStack() int {
    x := 42
    return x          // value is copied out; x stays on the stack
}

func makeOnHeap() *int {
    x := 42
    return &x         // address escapes; x must live on the heap
}
```

You can ask the compiler to show its work:

```bash
go build -gcflags="-m" ./...
```

Sample output:

```
./main.go:7:2: moved to heap: x
```

Don't optimize this prematurely. Just know: **returning pointers to locals makes them escape**.

---

## 4. The garbage collector in one paragraph

The GC walks the graph of all reachable objects starting from globals, the stacks of every goroutine, and active CPU registers. Whatever it cannot reach is dead and will be reused for new allocations. It runs concurrently with your program, so most of the work happens *while your code runs*, with only two very short pauses per cycle.

Default behavior: GC runs when the heap doubles from the last "live set". That's controlled by the `GOGC` environment variable (default `100`, meaning "trigger at 2× live").

---

## 5. Seeing the GC at work

The simplest way to see GC activity is `GODEBUG=gctrace=1`:

```bash
GODEBUG=gctrace=1 go run .
```

You'll see lines like:

```
gc 1 @0.025s 2%: 0.018+0.42+0.005 ms clock, ...
```

Each line is one full GC cycle: when it ran, what fraction of CPU it used, and how long each phase took.

---

## 6. Reading basic stats from code

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)

    fmt.Printf("Live heap: %d KiB\n", m.HeapAlloc/1024)
    fmt.Printf("GC cycles: %d\n", m.NumGC)
}
```

The two fields above are the ones you'll look at first. `HeapAlloc` is "how much heap memory is currently alive"; `NumGC` is "how many times the GC has run".

---

## 7. A small experiment

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats

    runtime.ReadMemStats(&m)
    fmt.Printf("before: %d KiB\n", m.HeapAlloc/1024)

    big := make([]byte, 10<<20) // 10 MiB
    _ = big

    runtime.ReadMemStats(&m)
    fmt.Printf("after alloc: %d KiB\n", m.HeapAlloc/1024)

    big = nil
    runtime.GC()                 // force a collection so we can observe
    runtime.ReadMemStats(&m)
    fmt.Printf("after GC: %d KiB\n", m.HeapAlloc/1024)
}
```

Output (approximate):

```
before: 100 KiB
after alloc: 10336 KiB
after GC: 96 KiB
```

This is the entire lifecycle: allocate → use → drop the reference → GC reclaims.

> ⚠️ `runtime.GC()` is for **experimenting and tests only**. Don't sprinkle it through real code — the runtime decides when to GC, and forcing it hurts performance.

---

## 8. Common beginner misunderstandings

| Misconception | Reality |
|---------------|---------|
| "Setting a variable to `nil` frees memory" | It just drops the reference. Memory is reclaimed at the next GC cycle. |
| "Maps shrink when you delete keys" | They don't. To free a map, drop the whole reference. |
| "`runtime.GC()` makes my program faster" | It usually makes it slower. The runtime already paces itself. |
| "Stack allocation is always faster" | Allocation is faster, but huge stack frames can still be slow to set up. |
| "Goroutines are free" | Each goroutine takes ~2 KiB initially; a million goroutines = real memory. |

---

## 9. Things you can do today

1. Run your program with `GODEBUG=gctrace=1` once and look at the output.
2. Build with `-gcflags="-m"` and skim the escape messages for one of your packages.
3. Read `runtime.MemStats` (`HeapAlloc`, `NumGC`) at a few points in a test to get intuition.
4. Replace `make([]T, 0)` with `make([]T, 0, knownCap)` where you can — it avoids reallocations.

---

## 10. Summary

Go memory comes from either the **stack** (fast, automatic, scoped to a function call) or the **heap** (managed by the **garbage collector**). The compiler chooses for you using **escape analysis**. The GC runs concurrently and is paced by `GOGC` (default 100 = "collect when heap doubles"). Use `GODEBUG=gctrace=1` and `runtime.MemStats` to peek inside. Don't call `runtime.GC()` in production code.

---

## Further reading
- A guide to the Go GC: https://go.dev/doc/gc-guide
- `runtime` package: https://pkg.go.dev/runtime
- Effective Go — Allocation: https://go.dev/doc/effective_go#allocation_new
