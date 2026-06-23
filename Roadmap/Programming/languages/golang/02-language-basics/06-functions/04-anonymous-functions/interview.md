# Go Anonymous Functions — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is an anonymous function in Go?**

**Answer**: A function literal — a function declared inline without a name. It's an expression of function type.

```go
double := func(x int) int { return x * 2 }
fmt.Println(double(5)) // 10
```

You can assign it, pass it, return it, store it in a struct, or call it immediately.

---

**Q2: What is an IIFE?**

**Answer**: Immediately-Invoked Function Expression — a function literal with `()` directly after it:

```go
result := func() int { return 42 }()
```

The function is defined and called in the same expression. Useful for scoped initialization or one-shot computation.

---

**Q3: Why can't you recurse anonymously?**

**Answer**: The function has no name to reference inside its own body. Workaround:

```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
```

The variable `fact` is captured; by the time the inner call runs, the variable has been assigned.

---

**Q4: How do you use an anonymous function with `defer`?**

**Answer**: Wrap in `func() {...}()` (note the trailing `()`):

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}()
```

Without `()`, you'd defer a function value (no call), which is a syntax error.

---

**Q5: What are common uses of anonymous functions?**

**Answer**:
- Sort comparators: `sort.Slice(s, func(i,j int) bool {...})`
- `defer + recover` cleanups
- Goroutine bodies: `go func() {...}()`
- Functional options: `WithAddr(":9000")` returns a literal
- Filter/map/reduce callbacks
- Decorators (logging, retry, timing wrappers)

---

## Middle Level Questions

**Q6: What's the difference between a function literal and a closure?**

**Answer**: A function literal is the syntactic form `func(...) {...}`. A closure is what happens at runtime: a function literal that **captures variables** from its enclosing scope.

A literal that captures nothing isn't really a "closure" in the closure-over-state sense; it's just an inline function value.

---

**Q7: How do anonymous functions capture variables?**

**Answer**: **By reference**. Captured variables are shared with the enclosing scope:

```go
x := 1
f := func() int { return x }
x = 99
fmt.Println(f()) // 99
```

Changes outside affect inside, and vice versa. This is what makes the loop-variable capture pitfall important.

---

**Q8: What changed about loop variable capture in Go 1.22?**

**Answer**: Go 1.22+ creates a fresh variable per iteration for ALL three for-loop forms (when the variable is declared with `:=`).

Pre-1.22:
```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // 3 3 3
}
```

Go 1.22+:
```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // 0 1 2
}
```

The change is gated by `go 1.22` in `go.mod`. Older modules retain pre-1.22 behavior.

---

**Q9: Why does `defer func() {...}` (no parens) fail?**

**Answer**: `defer` expects a function CALL expression, not a function value. `func() {...}` alone is a value. Adding `()` makes it a call, which is what defer registers.

```go
// WRONG
defer func() { /* ... */ }

// RIGHT
defer func() { /* ... */ }()
```

---

**Q10: When does a closure heap-allocate?**

**Answer**: When the closure **escapes** the function it was created in:

- Returned from the function.
- Stored in a global, channel, or struct that escapes.
- Captured by another escaping closure.
- Passed to a goroutine that outlives the creator.

Verify with:
```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
```

---

**Q11: Can you compare two function literals?**

**Answer**: **No**. Function values can only be compared to nil. Comparing two functions (`f == g`) is a compile error.

```go
f := func() {}
g := func() {}
// _ = f == g // ERROR
_ = f == nil // OK
```

---

**Q12: What's the IIFE pattern good for?**

**Answer**: Scoping and one-shot initialization:

```go
config := func() *Config {
    raw := loadFile()
    parsed := parse(raw)
    return validate(parsed)
}()
```

The temporaries `raw` and `parsed` are scoped to the IIFE. The result is assigned to `config`.

In Go this is less common than in JavaScript (Go has good package-level scoping), but it's useful when initialization needs intermediate variables you don't want leaking.

---

## Senior Level Questions

**Q13: What is the runtime layout of a closure value?**

**Answer**: A funcval is essentially:

```
funcval {
    code: pointer to compiled body
    // followed by captures (or pointed-to capture struct)
}
```

On amd64, the closure context register is DX. The runtime sets DX to the closure struct address before the indirect call. Inside the body, captures are accessed via offsets from DX.

For non-capturing literals, the funcval is just a code pointer (often a global).

---

**Q14: What's the cost of an indirect call through a function value vs a direct call?**

**Answer**: Roughly:
- Direct call: 1-2 cycles (often inlined to zero).
- Indirect call through funcval: 3-5 cycles + cannot be inlined.

Cost components:
- Load the funcval pointer.
- Load the code pointer from the funcval.
- Indirect branch (may mispredict).
- No inlining → can't constant-fold or BCE.

PGO can devirtualize hot indirect calls for ~50% speedup.

---

**Q15: How does the Go compiler decide stack vs heap for a closure?**

**Answer**: Escape analysis. The compiler proves whether the closure (and its captures) can stay within the enclosing function's lifetime.

Stays on stack:
- Closure not returned, not stored beyond function lifetime.
- Captures don't escape via the closure.

Heap:
- Closure escapes (returned, stored in global, sent on channel, captured by another escaping closure).
- Captured variables that the closure references escape with it.

Verify: `go build -gcflags="-m=2"`.

---

**Q16: How do you avoid the closure allocation in a goroutine body?**

**Answer**: Move the function body to a named function and call it directly:

```go
// Allocates closure (captures arg)
go func() {
    process(arg)
}()

// No closure allocation; arg passed as plain argument
go process(arg)
```

If the goroutine needs more than one captured variable, group them into a struct or pass each as args:

```go
go process(arg1, arg2, arg3)
```

This is meaningful only in hot paths spawning many goroutines; for typical use, the closure cost is negligible.

---

**Q17: Why might a goroutine leak through a closure?**

**Answer**: A long-running goroutine keeps its captured variables alive. If the goroutine never exits, those variables (and their pointees) are pinned forever.

```go
func leak() {
    big := make([]byte, 1<<20)
    go func() {
        for {
            time.Sleep(time.Hour)
            _ = big
        }
    }()
}
```

`big` lives forever because the goroutine references it.

Fix: use context cancellation, exit the goroutine; or capture only what's needed:
```go
go func(needed int) {
    // ... uses only needed, not big ...
}(big[0])
```

---

**Q18: What's the difference between method value and method expression in terms of closures?**

**Answer**:

- **Method value** `c.M`: creates a closure capturing the receiver `c`. Allocates a funcval (and may box the receiver).
- **Method expression** `(*T).M`: creates a function value where the receiver is the FIRST parameter. No allocation, no capture.

```go
type T struct{}
func (t *T) M() {}

t := &T{}
m1 := t.M           // method value: closure with t captured
m1()

m2 := (*T).M        // method expression: func(*T)
m2(t)               // pass receiver explicitly
```

For hot paths, method expressions avoid allocation.

---

**Q19: How does `sync.Once` use closures?**

**Answer**: `Once.Do(f func())` accepts a function value (typically a closure). The closure runs at most once across all goroutines.

```go
var once sync.Once
var cfg *Config

func getCfg() *Config {
    once.Do(func() {
        cfg = loadConfig()
    })
    return cfg
}
```

Internally, `Once` uses an atomic flag and a mutex. The closure captures any state it needs (here, `cfg`).

---

**Q20: What's the compiler synthesized name for a function literal?**

**Answer**: Functions are emitted with names like `pkgPath.enclosingFunc.funcN`:

- `main.main.func1`
- `main.main.func2`

Numbering is per enclosing function, ascending in source order. Visible in stack traces, profilers, `go tool nm`, etc.

This is why named functions give better stack-trace readability.

---

## Scenario-Based Questions

**Q21: Your service spawns 100k goroutines with closure bodies. Profiles show high closure allocation. How do you reduce it?**

**Answer**:
1. **Convert to named function calls** where possible:
   ```go
   for _, item := range items {
       go process(item) // direct call, no closure
   }
   ```
2. **Pre-build a worker pool**: instead of spawning per item, have N worker goroutines drain a channel.
3. **Profile to confirm the closure is the bottleneck** (often the actual work dominates).
4. **Capture less**: each captured pointer adds GC overhead.

---

**Q22: A team's tests are flaky after upgrading to Go 1.22. What might have changed?**

**Answer**: The loop-variable per-iteration change. Code that USED to work because all goroutines saw the SAME final value of `i` may now see DIFFERENT values per iteration.

Example regression:
```go
expected := -1
for i := 0; i < 5; i++ {
    go func() {
        if i == 4 { expected = i } // pre-1.22: always sets to 4; post: race
    }()
}
```

Fix: synchronize properly or restructure the test.

Many tests benefited from the change (fixing latent bugs), but some relied on the old shared-variable behavior.

---

**Q23: A reviewer says "extract this anonymous function to a named one". What are valid reasons to push back?**

**Answer**:
- The literal is < 5 lines and used in exactly one place.
- It captures meaningful local state that would be awkward to pass to a named function.
- Inline reads more naturally (sort comparators, filter predicates).

**Valid reasons to extract**:
- The literal is > 10-15 lines.
- It's used multiple times.
- It needs a unit test in isolation.
- Stack-trace clarity matters in a debugger.

The decision is contextual; both styles are idiomatic.

---

**Q24: A colleague's goroutine doesn't exit. The body is `go func() { for { handle() } }()`. What do you suggest?**

**Answer**: Goroutines without an exit condition are leaks. Suggest:

1. **Add context cancellation**:
   ```go
   go func(ctx context.Context) {
       for {
           select {
           case <-ctx.Done():
               return
           default:
               handle()
           }
       }
   }(ctx)
   ```

2. **Use a quit channel**:
   ```go
   quit := make(chan struct{})
   go func() {
       for {
           select {
           case <-quit:
               return
           default:
               handle()
           }
       }
   }()
   close(quit) // when done
   ```

Either way, design every long-running goroutine to listen for cancellation. Don't rely on process exit to clean up.

---

## FAQ

**When should I use anonymous functions vs named functions?**

- **Anonymous**: one-off use, sort comparators, defer cleanups, goroutine bodies, functional options.
- **Named**: reused in multiple places, > 10 lines, needs direct testing, stack-trace clarity matters.

---

**Are anonymous functions slower than named?**

Without captures: identical performance.
With captures that don't escape: identical (stack-allocated).
With captures that escape: one heap allocation extra.

Indirect calls through function values cannot be inlined; for hot inner loops, prefer direct calls.

---

**Can I take the address of a function literal?**

No directly: `&func(){}` is a compile error. You can take the address of a variable holding the literal:

```go
f := func(){}
p := &f
```

---

**Can a function literal have type parameters (generics)?**

No. Function literals cannot declare type parameters. Wrap in a named generic function:

```go
func id[T any](x T) T { return x }
f := id[int] // f is func(int) int
```

---

**What's the deal with `defer func(){}()` vs `defer fn()`?**

`defer fn()` evaluates `fn` and its args eagerly, defers the call. If `fn` is a closure value, the closure body runs at defer time with the captured variables in their CURRENT state.

`defer func(){}()` defines an inline closure and immediately defers its call. The closure runs at function exit and sees variables in their state THEN.

```go
i := 1
defer fmt.Println(i)         // captures i=1; prints 1
defer func() { fmt.Println(i) }() // captures i by ref; prints 99
i = 99
```

---

**Why does my anonymous function show as `main.main.func1` in stack traces?**

That's the synthesized name. Use named functions if you want clearer traces. Profilers, debuggers, and crash reports all show this generic name.

---

**Where can I see the closure conversion in compiler source?**

`cmd/compile/internal/walk/closure.go` and related files. The `walk` pass handles closure synthesis.
