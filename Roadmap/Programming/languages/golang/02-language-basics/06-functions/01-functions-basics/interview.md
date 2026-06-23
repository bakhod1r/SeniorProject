# Go Functions Basics — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is the syntax of a Go function declaration?**

**Answer**:
```go
func name(parameters) returnType {
    // body
    return value
}
```

Concrete examples:
```go
func add(a, b int) int { return a + b }
func ping() { fmt.Println("pong") }       // no params, no return
func square(x int) int { return x * x }   // one param, one return
```

The `func` keyword is the only way to declare a function.

---

**Q2: How does Go handle function overloading?**

**Answer**: Go does **not** support function overloading. Each function name in a package must be unique.

If you need different behavior for different argument types or counts:

1. Use **distinct names**: `addInts`, `addFloats`.
2. Use **variadic parameters** (`...T`).
3. Use **generics** (Go 1.18+).
4. Use **interface{} / any** for type-erased input.

```go
// Wrong: redeclared add
// func add(a, b int) int { ... }
// func add(a, b float64) float64 { ... } // compile error

// Right: generic
func Add[T int | float64](a, b T) T { return a + b }
```

---

**Q3: Does Go support default parameter values?**

**Answer**: **No.** Every parameter must be passed explicitly at the call site.

The two idiomatic alternatives are:

1. **Multiple named functions**:
   ```go
   func Listen(addr string) error            { return ListenWithTimeout(addr, 30*time.Second) }
   func ListenWithTimeout(addr string, t time.Duration) error { /* ... */ return nil }
   ```

2. **Options struct** (or functional options pattern):
   ```go
   type Opts struct { Timeout time.Duration; MaxConn int }
   func Listen(addr string, opts Opts) error { /* fill defaults inside */ return nil }
   ```

---

**Q4: Can a function return multiple values? How?**

**Answer**: Yes. Wrap the result types in parentheses:

```go
func divmod(a, b int) (int, int) {
    return a / b, a % b
}

q, r := divmod(17, 5) // q=3, r=2
```

The most common usage is the `(value, error)` idiom:

```go
func parseInt(s string) (int, error) {
    return strconv.Atoi(s)
}
```

(Detailed treatment in 2.6.3.)

---

**Q5: What does it mean that "Go passes arguments by value"?**

**Answer**: When you call `f(x)`, the function receives a **copy** of `x`. Modifying the parameter inside the function does not change the caller's variable.

```go
func tryDouble(n int) { n *= 2 }
x := 10
tryDouble(x)
fmt.Println(x) // still 10
```

To mutate the caller's variable, pass a pointer:
```go
func actuallyDouble(n *int) { *n *= 2 }
x := 10
actuallyDouble(&x)
fmt.Println(x) // 20
```

Even slices/maps are passed by value (their *header* is copied, but they share the underlying data — see 2.6.7 and 2.7.3).

---

**Q6: What is the entry point of a Go program?**

**Answer**: `func main()` in package `main`. It takes no parameters and returns no values.

```go
package main

func main() {
    // program starts here
}
```

For CLI args, use `os.Args`:
```go
import "os"

func main() {
    for _, arg := range os.Args {
        fmt.Println(arg)
    }
}
```

---

**Q7: What is `init()` and when does it run?**

**Answer**: `init()` is a special function that the Go runtime calls automatically:

- Once per package, before `main` runs.
- Multiple `init` functions allowed in the same file or across files.
- They run in **source declaration order** within a file, and in import-graph order across packages.
- Cannot be called explicitly by user code.
- Takes no parameters and returns no values.

```go
func init() {
    fmt.Println("setup")
}
```

Use cases: registering drivers (`database/sql`, image formats), sanity-checking config, computing derived constants.

---

**Q8: Why doesn't this compile?**
```go
func mystery() int {
    if true {
        return 1
    }
}
```

**Answer**: The compiler requires every code path of a function with a result to end in a terminating statement. `if true { return 1 }` has no `else` branch, so the path "fall through past the if" is not terminated. Add an `else` or move the return outside:

```go
func mystery() int {
    if true {
        return 1
    }
    return 0 // covers the "didn't return inside if" path
}
```

The compiler is intentionally conservative — it does not analyze the boolean condition.

---

## Middle Level Questions

**Q9: Is a function in Go a value? What can you do with it?**

**Answer**: Yes. A function is a first-class value of a function type. You can:

- Assign it: `f := add`
- Pass it as an argument: `apply(add, 1, 2)`
- Return it: `func make() func(int) int { return ... }`
- Store it in a slice/map/struct: `[]func(){...}`, `map[string]Handler`
- Compare it to nil: `if f == nil { ... }`

You **cannot** compare two function values to each other (`f == g` is a compile error) or take their address (`&add` is invalid; `&someVar` of function type is allowed).

---

**Q10: What's the difference between a method value and a method expression?**

**Answer**:

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

c := &Counter{}

// Method VALUE — bound to a specific receiver
mv := c.Inc                 // type: func()
mv()                        // calls c.Inc()

// Method EXPRESSION — receiver becomes the first argument
me := (*Counter).Inc        // type: func(*Counter)
me(c)                       // calls c.Inc()
```

| | Method value | Method expression |
|---|---|---|
| Receiver | Bound at creation | Passed at call |
| Type | `func(args)` | `func(receiver, args)` |
| Allocation | May box receiver | No allocation |
| Use case | Callbacks tied to a specific instance | Generic callbacks across instances |

---

**Q11: When does `defer` evaluate its arguments?**

**Answer**: **Eagerly**, at the moment the `defer` statement runs. Only the **call** is deferred.

```go
i := 1
defer fmt.Println(i) // captures i==1 right now
i = 2
// At return, prints: 1
```

To defer the evaluation too, wrap in a closure:
```go
i := 1
defer func() { fmt.Println(i) }() // captures i by reference
i = 2
// At return, prints: 2
```

This trips up beginners regularly. Memorize: **args eager, call lazy**.

---

**Q12: What is the functional options pattern? Why use it?**

**Answer**: A pattern for designing constructors that accept a variable number of optional configuration values, each represented as a function that mutates a config struct:

```go
type Server struct {
    Addr    string
    Timeout time.Duration
}

type Option func(*Server)

func WithAddr(a string) Option       { return func(s *Server) { s.Addr = a } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.Timeout = d } }

func NewServer(opts ...Option) *Server {
    s := &Server{Addr: ":8080", Timeout: 30 * time.Second} // defaults
    for _, o := range opts {
        o(s)
    }
    return s
}

s := NewServer(WithAddr(":9000"))
```

**Why**: Go has no default arguments and no overloading. This pattern keeps constructors source-compatible across additions of new options, makes call sites self-documenting, and allows composition.

**Alternative**: a config struct (`NewServer(Config{Addr: ":9000"})`) — simpler, but harder to extend without breaking callers.

---

**Q13: How does init order work across packages?**

**Answer**:
1. Imports are processed depth-first; each package is initialized exactly once.
2. Within a package, package-level variable initializers run in **dependency order**.
3. Then all `init()` functions in the package run in **declaration order**.
4. Files within a package are processed in alphabetical order by filename.
5. Finally, `main.main()` runs (only for the main package).

If package A imports B, then B is fully initialized before A's init runs.

Don't rely on init order *within* a package being predictable across refactors — it's stable but file-name-dependent. Use `sync.Once` for lazy initialization when order would matter.

---

**Q14: What is a "naked return"?**

**Answer**: A `return` statement with no expressions, used in functions with **named return values**:

```go
func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return // naked: returns x and y
}
```

Equivalent to `return x, y`. Useful in short functions, but discouraged in longer ones because the reader has to scroll up to see what is being returned.

(Detailed treatment in 2.6.6.)

---

**Q15: How do you stop a runaway function in Go?**

**Answer**: Several options:

1. **Cooperative cancellation via context**:
   ```go
   func work(ctx context.Context) error {
       for {
           select {
           case <-ctx.Done():
               return ctx.Err()
           default:
               // do unit of work
           }
       }
   }
   ```
2. **Return error from helper**: have the function check a stop condition each iteration.
3. **Don't kill goroutines from outside**: Go has no `Thread.kill`. Long-running goroutines must be designed to listen for cancellation.

Avoid `runtime.Goexit` — it only ends the current goroutine and doesn't unwind cleanly through callers.

---

**Q16: Why doesn't this print "x=2"?**
```go
type S struct{ x int }
func (s S) Print() { fmt.Println("x=", s.x) }

s := S{x: 1}
m := s.Print
s.x = 2
m()
```

**Answer**: Method values bound to a **value receiver** copy the receiver at the time of the binding. `m` was created when `s.x == 1`, so it always prints `x= 1`.

If the receiver were a pointer (`func (s *S) Print()`), it would print `x= 2` because the pointer continues to refer to the live `s`.

---

## Senior Level Questions

**Q17: What is the cost difference between a direct call, a method value call, and an interface call?**

**Answer** (rough, modern amd64):

| Form | Cycles | Inlinable? |
|------|--------|------------|
| Direct call to package-local function | 1-2 | Yes |
| Direct call across packages | 3-4 | Yes (if exported with body) |
| Method value call (`x.M()`) | 5-8 | No |
| Interface call (cached itab) | 3-5 | Devirtualizable in some cases |
| Interface call (cold) | 30+ | No |

**Why the difference**:
- Direct calls can be inlined and use the register ABI fully.
- Method values go through an extra `funcval` indirection.
- Interface calls require an itab lookup (cached in the interface value) and an indirect branch.

**When it matters**: in tight loops calling > 10⁸ times per second. Most application code does not need to optimize this.

---

**Q18: How does the Go compiler decide whether to inline a function?**

**Answer**: A two-phase pass:

1. **Marking** (`canInline`): walks the IR of each function and computes a "cost" metric. If cost < budget (default 80 nodes, raised in recent versions), the function is marked inlinable. Some constructs disqualify: `for` and `range` were excluded historically (allowed since Go 1.20-1.21).
2. **Expansion** (`inlineCalls`): at each call site, if the callee is inlinable, splices in the body.

Hints to verify:
```bash
go build -gcflags="-m -m" 2>&1 | grep -E "inline|cannot"
```

To force-disable for benchmarking:
```go
//go:noinline
func f() { ... }
```

---

**Q19: What is escape analysis and how does it relate to functions?**

**Answer**: Escape analysis is the compiler pass that decides whether each variable lives on the goroutine **stack** (cheap, freed on function return) or the **heap** (subject to garbage collection).

Common reasons a variable in a function escapes:

| Pattern | Escapes? |
|---------|----------|
| `return &local` | Yes |
| Address taken and stored beyond the function | Yes |
| Captured by a closure that escapes | Yes |
| Passed to `interface{}` parameter | Usually yes (boxing) |
| Sent on a channel as a pointer | Yes |
| Stored in a global | Yes |

Inspect:
```bash
go build -gcflags="-m=2" .
```

A heap allocation costs ~25 ns plus eventual GC work; a stack allocation is essentially free. Performance-sensitive functions aim to avoid escapes.

---

**Q20: Walk me through what `defer` does in Go ≥ 1.14.**

**Answer**: Three implementations exist depending on the function shape; the compiler picks one per function:

1. **Open-coded defer** (fast path, ~1-2 ns):
   - Used when the function has ≤ 8 defers and none in a loop.
   - The compiler inlines each deferred call into every return path.
   - A bitmap tracks which defers are active at each program point.
   - During panic, the runtime walks `funcdata` to execute open-coded defers.

2. **Stack-allocated defer** (~30 ns):
   - Used when the function has more than 8 defers, but no defer in a loop.
   - The `_defer` struct is allocated on the caller's stack.
   - Linked into the goroutine's `g._defer` chain; `runtime.deferreturn` walks LIFO at exit.

3. **Heap-allocated defer** (~50 ns):
   - Used when defers occur inside a loop.
   - `_defer` struct allocated on the heap (or pulled from a per-P pool).
   - Same linked-list mechanism as stack defer.

**Implication**: never `defer` inside a hot loop unless you know the iteration count is small. Prefer to extract a helper function so each defer scope is bounded.

---

**Q21: Explain Go's calling convention. How is it different from C?**

**Answer**: Since Go 1.17 (amd64) and 1.18 (arm64), Go uses a **register-based** calling convention (ABIInternal). On amd64:
- Up to 9 integer/pointer arguments in registers (RAX, RBX, RCX, RDI, RSI, R8, R9, R10, R11).
- Up to 15 floating-point arguments in X0-X14.
- Same registers for return values.
- All registers are caller-saved.
- The goroutine pointer is in R14.
- DX is the closure context register.

Differences from C:
- Go reserves registers for runtime support (R14 for `g`, DX for closures).
- Go's calling convention is internal; CGO and assembly stubs use a separate ABI0 (stack-based).
- Argument decomposition: a struct argument is passed field-by-field in registers when it fits, unlike C which often uses memory or special "small struct" rules.
- Go has no `__stdcall` / `__cdecl` distinction — there's only one user-visible convention.

---

**Q22: How does a goroutine grow its stack?**

**Answer**:

1. Each goroutine starts with a small stack (~2 KiB in modern Go).
2. Most function prologues check `SP < g.stackguard0`. If true, the function body is too big for the remaining space.
3. The check fails into `runtime.morestack`, which calls `runtime.newstack`.
4. `newstack` allocates a new stack ~2× the current size (up to the per-goroutine limit, default 1 GiB).
5. **All live values on the old stack are copied** to the new stack.
6. **All pointers in the new stack are adjusted** to refer to new addresses, using compiler-emitted pointer maps.
7. The function resumes from its prologue, this time fitting.

Functions marked `//go:nosplit` skip the check and must be tiny — used in the runtime where stack growth is unsafe (e.g., inside the GC).

**Implication**: very deep recursion eventually hits the per-goroutine limit and crashes with `runtime: goroutine stack exceeds limit`. Go does not implement tail-call optimization.

---

**Q23: A function is at the top of your CPU profile. What's your debugging checklist?**

**Answer**:
1. **Check if the time is in `runtime.mallocgc`** → too many allocations. Profile heap with `pprof -alloc_objects`.
2. **Check if the time is in `runtime.gcBgMarkWorker`** → GC overhead from the function's allocations. Reduce pointer-density.
3. **Check for non-inlined indirect calls** in the body. Look for function-typed fields, interface methods. Consider devirtualizing or inlining manually.
4. **Check for `defer` in hot loops** (see Q20).
5. **Check bounds-check elimination**: `go build -gcflags="-d=ssa/check_bce/debug=1"`. Hot index expressions that can't be proven safe leak performance.
6. **Look at CPU-time vs wall-time**: if wall is much higher, the function may be blocking on I/O or sync, not actually CPU-bound.
7. **Try PGO**: feed the profile back to `go build -pgo=cpu.prof` for inlining/devirtualization gains.
8. **Check goroutine count and contention** (`pprof -mutex`).

---

**Q24: When does `recover` work, and when doesn't it?**

**Answer**: `recover` only stops a panic when called **directly inside a deferred function** in the same goroutine.

**Works**:
```go
defer func() {
    if r := recover(); r != nil {
        // handle
    }
}()
```

**Does NOT work**:
- Called outside a deferred function: returns nil; panic continues.
- Called inside a function called from a deferred function: returns nil.
- Called in a different goroutine: each goroutine's panic is independent.
- After the panic has propagated past the deferred function.

```go
defer recover() // BUG: recover is not directly inside a deferred FUNCTION literal
                // (it's the deferred call itself, but the call is to a builtin
                // — this works, but only catches a panic that is exactly at this point)
```

Practically: always wrap recover in a deferred closure.

---

## Scenario-Based Questions

**Q25: You have a service that handles 100k req/s. Each handler calls a `Logger.Log` method. Profiling shows `Log` is 5% of CPU. How do you optimize?**

**Answer**:
1. **Batching**: instead of one syscall per log line, buffer in memory and flush every N lines or T milliseconds.
2. **Asynchronous writes**: hand log lines to a goroutine via a channel; the handler returns immediately.
3. **Avoid format-string interpolation** for disabled levels: check level first, then format.
   ```go
   if log.Enabled(DEBUG) {
       log.Debug("user=%s id=%d", user, id) // format only when needed
   }
   ```
4. **Use a structured logger** (zap, zerolog) that avoids reflection.
5. **Inline-friendly API**: small leaf methods are inlined; avoid passing large structs by value to log calls.

---

**Q26: A test is non-deterministic: passes locally, fails in CI ~10% of the time. The function under test starts a goroutine and awaits a result. What might be wrong?**

**Answer**: Likely culprits:
- **Race on a captured variable** in the goroutine. Run `go test -race`.
- **Insufficient synchronization** before reading the result; the test may read before the goroutine finishes.
- **Timing dependency**: relying on `time.Sleep` for ordering. Use channels or `sync.WaitGroup`.
- **Init order** between fixture setup and goroutine start.
- **Shared global state** with another test; tests should be independent.

Fix: use `sync.WaitGroup` or a result channel; never use `time.Sleep` for synchronization in tests.

---

**Q27: A user reports `runtime: goroutine stack exceeds 1000000000-byte limit` in production. Where do you start?**

**Answer**:
1. **Identify the goroutine** from the crash trace (top of the stack).
2. **Check for unbounded recursion** in the function chain.
3. **Check for very large stack-allocated arrays/slices** (`var buf [1<<20]byte`).
4. **Check for closure capture chains** that may keep large allocations live.
5. If the recursion is intentional, **rewrite as an iterative loop** with an explicit work-list — Go does not optimize tail calls.
6. As a temporary mitigation, raise the stack limit with `runtime/debug.SetMaxStack`, but this only delays the inevitable.

---

**Q28: A library you import has an `init()` that registers a handler. In tests you want the handler to NOT register. How?**

**Answer**: You typically can't suppress an `init()` in an imported package. Options:

- **Don't import the package** in your test; use build tags to exclude it (`//go:build !test`).
- **Use the `init`-registered handler but reset it** in your test setup if the package exposes a way to deregister.
- **Refactor** to avoid hidden init-time side effects — propose a PR upstream.
- **Use `go vet`'s `-tags`** plus separate test binaries.

This is a common cause of "global state in tests" pain. The lesson: avoid init-time side effects in libraries you publish.

---

## FAQ

**Why doesn't Go have function overloading?**

A deliberate language design choice. Overloading complicates name resolution, error messages, and code reading. Go's authors preferred explicit names (`addInts`, `addFloats`) over compiler-resolved overloads. With generics (Go 1.18+), most use cases for overloading are now expressible via type parameters.

---

**Why doesn't Go have default parameter values?**

Same family of reasons: simplicity, predictability, fewer language features to learn. The functional options pattern fills the gap idiomatically.

---

**Why are functions not comparable to each other?**

Two functions can have identical bodies but different code addresses (e.g., the same literal in different inlining contexts). Comparing function values would have inconsistent semantics depending on whether the compiler inlined or not. The Go authors chose to disallow it entirely; only `f == nil` is well-defined.

---

**Should I prefer named functions or function literals (anonymous)?**

Use **named functions** for anything reused in two or more places, anything tested directly, and anything that benefits from documentation. Use **function literals** for one-off callbacks (`sort.Slice`, goroutine bodies, defer cleanups).

---

**Is `func` always the most efficient way to express a callback?**

For very hot paths, an interface with a single method and a concrete implementation can be more inlinable than a function value (devirtualization in Go 1.21+). For most code, function types are cleaner; reach for interfaces when you need polymorphism beyond a single signature.

---

**Why do my function-typed map values panic?**

Because the zero value of a function type is `nil`, and calling `nil()` panics. Always check:
```go
if h := handlers[name]; h != nil {
    h(args)
}
```
or use a `comma-ok` pattern with a default:
```go
h, ok := handlers[name]
if !ok {
    h = defaultHandler
}
h(args)
```

---

**Where do I learn what the compiler did with my function?**

```bash
go build -gcflags="-m"          # inline + escape decisions
go build -gcflags="-m -m"       # verbose
go build -gcflags="-S"          # generated assembly
GOSSAFUNC=name go build .       # SSA passes (opens ssa.html)
go tool objdump -s "main\.f" prog
go tool nm prog | grep main\.f
```

Make these familiar — they will save you days of speculation.
