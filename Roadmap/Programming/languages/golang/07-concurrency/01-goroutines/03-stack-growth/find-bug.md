# Goroutine Stack Growth — Find the Bug

## Table of Contents
1. [Introduction](#introduction)
2. [Bug 1 — Unbounded Recursion](#bug-1--unbounded-recursion)
3. [Bug 2 — Recursion with a Base Case That Never Matches](#bug-2--recursion-with-a-base-case-that-never-matches)
4. [Bug 3 — Deep JSON Parser Overflow](#bug-3--deep-json-parser-overflow)
5. [Bug 4 — Hidden Recursion via Mutual Calls](#bug-4--hidden-recursion-via-mutual-calls)
6. [Bug 5 — Large Local Array in a Loop](#bug-5--large-local-array-in-a-loop)
7. [Bug 6 — Unsafe Pointer Across a Function Call](#bug-6--unsafe-pointer-across-a-function-call)
8. [Bug 7 — Recursive Closure Capturing Itself](#bug-7--recursive-closure-capturing-itself)
9. [Bug 8 — Misuse of //go:nosplit](#bug-8--misuse-of-gonosplit)
10. [Bug 9 — Cgo Stack Overflow on g0](#bug-9--cgo-stack-overflow-on-g0)
11. [Bug 10 — Recursive Defer Closure](#bug-10--recursive-defer-closure)
12. [Bug 11 — Tree Walker with Pathological Input](#bug-11--tree-walker-with-pathological-input)
13. [Bug 12 — Memory Leak Masquerading as Stack Bloat](#bug-12--memory-leak-masquerading-as-stack-bloat)

---

## Introduction

Stack-related bugs are some of the most painful in Go because:

1. They manifest as `fatal error: stack overflow`, which is unrecoverable.
2. They often only appear under adversarial input or long-running production.
3. They are not visible until the runtime gives up.

Each bug below comes with a runnable reproducer, the symptom, the diagnosis, and the fix. The goal is pattern recognition: when you see this shape of code or this error message, you should know what to look for.

---

## Bug 1 — Unbounded Recursion

### Code

```go
package main

func factorial(n int) int {
    return n * factorial(n-1)
}

func main() {
    println(factorial(10))
}
```

### Symptom

```
runtime: goroutine stack exceeds 1000000000-byte limit
runtime: sp=0xc02009c378 stack=[0xc02009c000, 0xc04009c000]
fatal error: stack overflow
```

The program eats CPU for several seconds before crashing.

### Diagnosis

`factorial` has no base case. Every call invokes itself, never returning. The runtime doubles the stack repeatedly (2 → 4 → … → 1 GB) and then aborts.

### Fix

```go
func factorial(n int) int {
    if n <= 1 {
        return 1
    }
    return n * factorial(n-1)
}
```

### Lesson

Always have a visible, reachable base case. Code review should specifically check recursive functions for termination.

---

## Bug 2 — Recursion with a Base Case That Never Matches

### Code

```go
package main

func countdown(n int) {
    if n == 0 {
        return
    }
    countdown(n - 2)  // bug: decrements by 2
}

func main() {
    countdown(99) // odd number — n becomes negative, base case never hit
}
```

### Symptom

Same stack-overflow message as Bug 1. The function decrements by 2, so from an odd starting value, `n` becomes negative and stays negative forever.

### Diagnosis

The base case `n == 0` is unreachable from an odd starting value. The function recurses into the negative integers.

### Fix

```go
func countdown(n int) {
    if n <= 0 {
        return
    }
    countdown(n - 2)
}
```

Or assert the precondition:

```go
func countdown(n int) {
    if n < 0 || n%2 != 0 {
        panic("countdown requires non-negative even input")
    }
    if n == 0 {
        return
    }
    countdown(n - 2)
}
```

### Lesson

Base cases must handle *all* paths that converge to termination, not just one. Test with edge inputs: 0, 1, negative numbers, off-by-one.

---

## Bug 3 — Deep JSON Parser Overflow

### Code

```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
)

func main() {
    // Build deeply nested input: [[[[...]]]]
    depth := 10_000_000
    s := strings.Repeat("[", depth) + strings.Repeat("]", depth)

    var v any
    err := json.Unmarshal([]byte(s), &v)
    fmt.Println("err:", err)
}
```

### Symptom

```
err: json: exceeded max depth
```

`encoding/json` returns a clean error rather than crashing. (Since Go 1.x added a max-depth check, this is the safe outcome.)

### What if you wrote your own parser?

```go
package main

import (
    "fmt"
    "strings"
)

type parser struct {
    s   string
    pos int
}

func (p *parser) parseArr() any {
    p.pos++ // consume '['
    var arr []any
    for p.pos < len(p.s) && p.s[p.pos] != ']' {
        arr = append(arr, p.parseValue())
    }
    p.pos++ // consume ']'
    return arr
}

func (p *parser) parseValue() any {
    switch p.s[p.pos] {
    case '[':
        return p.parseArr()
    default:
        return nil
    }
}

func main() {
    depth := 100_000
    s := strings.Repeat("[", depth) + strings.Repeat("]", depth)
    p := &parser{s: s}
    p.parseValue()
    fmt.Println("ok")
}
```

### Symptom (custom parser)

```
fatal error: stack overflow
```

Hand-written parser without a depth limit crashes on deep input.

### Fix

Add a depth counter:

```go
const maxDepth = 1000

func (p *parser) parseValue(depth int) (any, error) {
    if depth > maxDepth {
        return nil, fmt.Errorf("nesting too deep")
    }
    switch p.s[p.pos] {
    case '[':
        return p.parseArr(depth + 1)
    default:
        return nil, nil
    }
}
```

### Lesson

Any code parsing untrusted input must cap depth. Adversarial inputs are 1 KB long but trigger gigabytes of stack consumption.

---

## Bug 4 — Hidden Recursion via Mutual Calls

### Code

```go
package main

func isEven(n int) bool {
    if n == 0 {
        return true
    }
    return isOdd(n - 1)
}

func isOdd(n int) bool {
    if n == 0 {
        return false
    }
    return isEven(n - 1)
}

func main() {
    println(isEven(1_000_000_000))
}
```

### Symptom

Stack overflow. The recursion is a mile deep — each call uses ~50 bytes of stack but a billion calls is 50 GB notional, capped at 1 GB.

### Diagnosis

Mutual recursion. Each function looks innocent in isolation, but together they unwind into 1B nested frames.

### Fix

```go
func isEven(n int) bool {
    return n%2 == 0
}
```

Or iteratively:

```go
func isEven(n int) bool {
    for n > 1 {
        n -= 2
    }
    return n == 0
}
```

### Lesson

Look for mutual recursion. The compiler does not "see" it as a cycle in a way that warns you. Static analysis tools (e.g., `staticcheck`) catch some patterns but not all.

---

## Bug 5 — Large Local Array in a Loop

### Code

```go
package main

import "fmt"

func process(in []byte) [4096]byte {
    var out [4096]byte
    for i, b := range in {
        out[i%4096] = b
    }
    return out
}

func main() {
    in := make([]byte, 100)
    for i := 0; i < 100_000; i++ {
        go process(in)
    }
    select {}
}
```

### Symptom

Profile shows `runtime.morestack_noctxt` consuming significant CPU. Memory usage (StackSys) is higher than expected.

### Diagnosis

`process` declares a 4 KB local. Each fresh goroutine starts with a 2 KB stack and immediately needs to grow to fit `out`. Every goroutine pays for one growth.

### Fix

Move the buffer to the heap, ideally with `sync.Pool`:

```go
var pool = sync.Pool{New: func() any {
    return new([4096]byte)
}}

func process(in []byte) *[4096]byte {
    out := pool.Get().(*[4096]byte)
    for i, b := range in {
        out[i%4096] = b
    }
    return out
}
```

Caller now `defer pool.Put(out)` after use.

### Lesson

Locals larger than ~1 KB cost a stack growth per fresh goroutine. Heap-allocate (or pool) anything over a few hundred bytes.

---

## Bug 6 — Unsafe Pointer Across a Function Call

### Code

```go
package main

import (
    "fmt"
    "unsafe"
)

func use(ptr uintptr) int {
    return *(*int)(unsafe.Pointer(ptr))
}

func mayGrow() {
    // Force the stack to grow.
    var pad [4096]byte
    _ = pad
}

func main() {
    x := 42
    ptr := uintptr(unsafe.Pointer(&x))
    mayGrow()
    fmt.Println(use(ptr)) // may print garbage!
}
```

### Symptom

The output is unpredictable. On some runs, prints `42`. On others, prints arbitrary memory contents or segfaults.

### Diagnosis

`ptr` is stored as a `uintptr`. The compiler's stack map does not mark it as a pointer. When `mayGrow()` triggers stack growth, the runtime moves `&x` to a new address but does *not* update `ptr`. After return, `ptr` is a stale address pointing into freed memory.

### Fix

Use `unsafe.Pointer`, not `uintptr`. The runtime knows `unsafe.Pointer` is a pointer and adjusts it on stack moves:

```go
func main() {
    x := 42
    ptr := unsafe.Pointer(&x)
    mayGrow()
    fmt.Println(*(*int)(ptr)) // correct
}
```

Better: do not pass raw memory addresses around. Use proper Go pointers.

### Lesson

`uintptr` is *not* a pointer — it's an integer. The runtime cannot track it across stack moves. Any time you convert to `uintptr`, the resulting value's validity is bounded to the immediate expression.

---

## Bug 7 — Recursive Closure Capturing Itself

### Code

```go
package main

func main() {
    var fib func(int) int
    fib = func(n int) int {
        if n < 2 {
            return n
        }
        return fib(n-1) + fib(n-2)
    }
    println(fib(50))
}
```

### Symptom

For `fib(50)`, the program runs forever — not a stack overflow, but exponential time. For `fib(10000)` or deep tail-recursive variants, you'd see overflow.

### Diagnosis

Recursive closure. The closure captures `fib` by reference. Each call is a separate frame. The base case exists but the recursion is exponential — not stack-overflow per se but CPU-bound. With deeper recursive structure (e.g., `fib(n-1) + fib(n-1)`) and a higher `n`, you'd blow the stack.

### Fix

For Fibonacci specifically, use iteration:

```go
func fib(n int) int {
    a, b := 0, 1
    for i := 0; i < n; i++ {
        a, b = b, a+b
    }
    return a
}
```

For general recursive algorithms, ensure termination is reachable and depth is bounded.

### Lesson

Closures that recurse are still recursion. The same depth concerns apply.

---

## Bug 8 — Misuse of //go:nosplit

### Code

```go
package main

//go:nosplit
func helper() {
    var pad [2048]byte // 2 KB local
    _ = pad
}

func main() {
    helper()
}
```

### Symptom

```
fatal: morestack on g0
```

or a panic when running.

### Diagnosis

`//go:nosplit` tells the compiler not to emit the stack-growth check. The runtime guarantees ~928 bytes of nosplit budget. A 2 KB local in a nosplit function overflows that budget. The runtime detects it (via a sanity check that examines frame size statically when emitting nosplit code) or crashes at run time.

### Fix

Remove the `//go:nosplit`. It is a runtime-internal directive; user code almost never needs it.

```go
func helper() {
    var pad [2048]byte
    _ = pad
}
```

### Lesson

Do not use `//go:nosplit` in user code. It is a runtime tool, not a performance lever.

---

## Bug 9 — Cgo Stack Overflow on g0

### Code (Go side)

```go
package main

// #include <stdio.h>
// extern void deepC(int n);
// extern void recurse(int n);
// void recurse(int n) {
//     char pad[1024];
//     pad[0] = (char)n;
//     if (n > 0) recurse(n - 1);
// }
import "C"

func main() {
    C.recurse(C.int(100_000))
}
```

### Symptom

Segmentation fault (not a Go panic). The C function recursed too deep for the M's `g0` stack.

### Diagnosis

cgo switches to the M's `g0` system stack to run C code. `g0` is typically 8 KB (Linux) and *not growable*. 100,000 recursive C calls with 1 KB frames each would need 100 MB of stack. The OS thread's stack overflows; the kernel sends SIGSEGV.

### Fix

Don't recurse deeply in cgo. Make `recurse` iterative, or chunk the work to return periodically to Go.

### Lesson

cgo's stack is fixed, like a normal C thread. Goroutine-style "infinite stack" assumptions don't apply.

---

## Bug 10 — Recursive Defer Closure

### Code

```go
package main

func deferLoop(n int) {
    if n == 0 {
        return
    }
    defer deferLoop(n - 1)
}

func main() {
    deferLoop(1_000_000)
}
```

### Symptom

```
fatal error: stack overflow
```

or, in better Go versions, eventually OOMs the heap because defer records are allocated on the heap.

### Diagnosis

Each `defer deferLoop(n-1)` registers a deferred call with N-1 still to recurse. The recursion unwinds normally before the defers fire — so there's both the recursion's stack depth (small) and the defer chain (deep). When the function returns, the deferred chain fires N times, each one calling `deferLoop` recursively *again*.

Worse: each `defer` allocates a record. A million defers is millions of allocations.

### Fix

Don't recurse via defer. Use a loop:

```go
func deferLoop(n int) {
    for ; n > 0; n-- {
        // any cleanup
    }
}
```

### Lesson

`defer` inside recursion compounds. Each frame both recurses and registers a defer.

---

## Bug 11 — Tree Walker with Pathological Input

### Code

```go
package main

type Node struct {
    Left, Right *Node
    Value       int
}

func depth(n *Node) int {
    if n == nil {
        return 0
    }
    l := depth(n.Left)
    r := depth(n.Right)
    if l > r {
        return l + 1
    }
    return r + 1
}

func main() {
    // Build a left-skewed tree of depth 1M.
    var root *Node
    for i := 0; i < 1_000_000; i++ {
        root = &Node{Left: root, Value: i}
    }
    println(depth(root))
}
```

### Symptom

```
fatal error: stack overflow
```

### Diagnosis

`depth` recurses to the depth of the tree. A 1M-deep skewed tree means 1M nested calls. Each ~50 bytes of stack frame = 50 MB notional, capped at 1 GB after several growths.

### Fix

Iterative tree walk with an explicit stack:

```go
func depth(root *Node) int {
    if root == nil {
        return 0
    }
    type entry struct {
        n     *Node
        depth int
    }
    stack := []entry{{root, 1}}
    maxDepth := 0
    for len(stack) > 0 {
        e := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        if e.depth > maxDepth {
            maxDepth = e.depth
        }
        if e.n.Left != nil {
            stack = append(stack, entry{e.n.Left, e.depth + 1})
        }
        if e.n.Right != nil {
            stack = append(stack, entry{e.n.Right, e.depth + 1})
        }
    }
    return maxDepth
}
```

### Lesson

Tree algorithms assuming "average depth = log N" fail on adversarial inputs. Always assume pathological tree shapes are possible if input comes from outside.

---

## Bug 12 — Memory Leak Masquerading as Stack Bloat

### Code

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
)

func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        var buf [16 * 1024]byte // 16 KB
        _ = buf
        for {
            // busy-spin so we don't get scheduled
            for i := 0; i < 1<<24; i++ {}
        }
    }()
    w.Write([]byte("ok"))
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

### Symptom

After serving 10,000 requests:

```
StackInuse: 1.5 GB
StackSys:   1.5 GB
Goroutines: 10000
```

### Diagnosis

Every request spawns a goroutine that never exits. Each goroutine's stack grew once (due to the 16 KB local), so each is ~16 KB. 10,000 × 16 KB = 160 MB. Plus the per-goroutine overhead. The stack metrics show what looks like "stack bloat" but is actually a goroutine leak.

### Fix

Terminate the goroutine when the request context is cancelled, or limit its lifetime:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    go func() {
        var buf [16 * 1024]byte
        _ = buf
        select {
        case <-ctx.Done():
            return
        case <-time.After(5 * time.Second):
            return
        }
    }()
    w.Write([]byte("ok"))
}
```

Or better: don't spawn a goroutine at all if the work doesn't outlive the request.

### Lesson

High StackSys / StackInuse often indicates goroutine leaks, not "individual goroutines using too much stack." Always count goroutines first; address the leak before micro-optimising stack usage.

---

## Summary

Stack-related bugs fall into a few patterns:

| Pattern | Symptom | Fix |
|---|---|---|
| Unbounded recursion | `stack overflow` | Base case |
| Adversarial nested input | `stack overflow` from request | Cap depth |
| Unsafe `uintptr` across calls | Random crashes/garbage | Use `unsafe.Pointer` |
| Cgo deep C recursion | SIGSEGV | Iterative C |
| Large locals × many goroutines | `morestack` in pprof | `sync.Pool` |
| Goroutine leak | High StackSys | Cancel via context |
| Mutual recursion | `stack overflow` | Reachable base; iteration |
| `//go:nosplit` misuse | `morestack on g0` | Remove directive |
| Defer in recursion | OOM or overflow | Hoist defer out of loop |
| Tree on adversarial input | `stack overflow` | Iterative walk |

When you see `runtime: goroutine stack exceeds N-byte limit`:

1. Read the traceback — find the function calling itself.
2. Check for unbounded recursion, mutual recursion, or unbounded input depth.
3. Fix the algorithm, not the limit.

When you see `morestack_noctxt` in pprof: large frames or many short-lived goroutines.

When you see high `StackSys` with stable goroutine count: stacks have grown but not shrunk; consider periodic `runtime.GC()` to right-size, or investigate why they grew.
