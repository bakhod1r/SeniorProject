# Go Nil Pointer Dereference — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What does the runtime error `invalid memory address or nil pointer dereference` mean?**

**Answer**: It means your program tried to read or write through a pointer that was set to `nil`. Every Go pointer type has a zero value of `nil` — until you assign an address (with `&x` or a constructor), the pointer points nowhere. Attempting to dereference it (via `*p`, `p.Field`, `p.Method()` if the method touches fields, or `f()` for a nil function variable) triggers a CPU page fault that the runtime turns into this panic.

```go
var p *int
*p // panic: invalid memory address or nil pointer dereference
```

The fix is either to assign a real address before use, to add an `if p != nil` check, or to redesign so the pointer cannot be nil at the use site.

---

**Q2: Can you call a method on a nil pointer in Go? When does it panic?**

**Answer**: Yes — calling a method on a nil pointer is allowed by the language, **but** the body must not dereference the receiver. If the method has a pointer receiver and never reads any field, the call succeeds. If it reads fields (or calls value-receiver methods, which copy through the pointer), it panics.

```go
type Counter struct{ n int }

func (c *Counter) Type() string { return "Counter" } // safe on nil
func (c *Counter) Get() int     { return c.n }       // panics on nil

var c *Counter
fmt.Println(c.Type()) // ok — "Counter"
fmt.Println(c.Get())  // panic
```

A "nil-safe method" is one that explicitly handles the nil case:
```go
func (c *Counter) Get() int {
    if c == nil {
        return 0
    }
    return c.n
}
```

---

**Q3: What's the difference between a nil pointer, a nil slice, and a nil map?**

**Answer**:
- **Nil pointer (`*T`)**: dereferencing panics with "invalid memory address or nil pointer dereference".
- **Nil slice (`[]T`)**: len is 0, range iterates zero times, append works (allocates new). Indexing panics with "index out of range", not nil pointer.
- **Nil map (`map[K]V`)**: reading returns the zero value of V (no panic). Writing panics with "assignment to entry in nil map".
- **Nil channel**: sends/receives block forever. Closing panics.
- **Nil function**: calling it panics with the same nil pointer message (the funcval's code pointer is nil).

The error messages differ for each case, helping you diagnose what kind of nil you hit.

---

**Q4: What does `*p` mean when `p` is a pointer?**

**Answer**: It dereferences `p` — reads the value stored at the address `p` points to. If `p` is nil, this is the canonical nil pointer dereference.

For struct pointers, `p.Field` automatically dereferences (`(*p).Field`). For methods with value receivers, calling `p.Method()` also dereferences `p` to copy the receiver.

```go
x := 10
p := &x
fmt.Println(*p) // 10

var q *int
fmt.Println(*q) // panic
```

---

**Q5: How do you protect against nil pointer panics in Go?**

**Answer**: Several patterns:

1. **Check before use**: `if p != nil { ... }`.
2. **Use constructors**: functions that always return non-nil or an error.
3. **Use `(value, ok)` patterns** for absence: `u, ok := find(id)`.
4. **Provide nil-safe methods** for optional dependencies.
5. **Validate untrusted input** at the boundary.
6. **Use `errors.As`** instead of typed comparisons to avoid the typed-nil-error trap.
7. **Recover at boundaries** (HTTP handlers, goroutine top-levels) for unforeseen panics.
8. **Run static analyzers** like `staticcheck`, `nilness`, `nilaway`.

The goal is to make nil dereferences impossible by design where possible, and detect them quickly where not.

---

**Q6: What is `recover()` and how does it relate to nil pointer panics?**

**Answer**: `recover()` is a builtin that, when called inside a deferred function, stops a panicking goroutine. The panic value is returned. After recover, normal execution resumes from the deferred function's caller (the function in which the defer was registered).

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}()
var p *int
*p = 1 // panic, but recover catches it
```

Recover does NOT fix the bug — it just prevents the process from crashing. Use it at boundaries (HTTP handlers, goroutine wrappers), not as a substitute for proper nil checking.

---

## Middle Level Questions

**Q7: Why does `var p *MyError = nil; var e error = p; e != nil` evaluate to true?**

**Answer**: This is the classic typed-nil-in-interface bug. An interface value in Go is two words: a type tag (pointing to the dynamic type's method table) and a data pointer.

When you assign `p` (a nil `*MyError`) to `e` (an `error` interface), the interface receives:
- Type tag: `*MyError` (non-nil — there IS a type).
- Data pointer: nil (the actual pointer value is nil).

`e == nil` is true only when BOTH words are nil. Here, the type tag is non-nil, so `e != nil`.

**Fix**: never return a typed nil from a function returning an interface. Return the bare nil interface:

```go
// Wrong
func op() error {
    var p *MyError
    return p // typed nil
}

// Right
func op() error {
    if cond {
        return &MyError{...}
    }
    return nil // bare nil
}
```

`errors.As` handles the typed-nil case correctly:
```go
var target *MyError
if errors.As(err, &target) {
    // target is non-nil here
}
```

---

**Q8: What's the difference between a panic and a fatal runtime error?**

**Answer**: A **panic** is recoverable via `recover()` in a deferred function. The panic value is captured, deferred functions of unwound frames run, and execution can continue.

A **fatal runtime error** (e.g., concurrent map writes detected, stack overflow, signal during signal handler) is NOT recoverable. The runtime calls `runtime.fatalpanic`, prints the trace, and exits.

Nil pointer dereference is a panic, so it IS recoverable. Concurrent map modification is a fatal runtime error, so it is not.

---

**Q9: Can you safely defer a method call on a possibly-nil pointer?**

**Answer**: Yes, the `defer` registration itself does not dereference. Whether the eventual call panics depends on the method body.

```go
defer p.Cleanup() // method-value bound now; receiver evaluation happens now
```

Wait — there's a subtlety. `defer p.Method()` with a value receiver evaluates `p` (and copies it) at defer time. If `p` is nil and the method has a value receiver, the defer registration itself panics.

For pointer receivers, the receiver is captured by reference; no immediate dereference. The call happens later; whether it panics depends on the body.

To be safe, conditionally register:
```go
if p != nil {
    defer p.Cleanup()
}
```

---

**Q10: How does the typed-nil pattern cause real bugs in production?**

**Answer**: Common scenarios:

1. **Helper that wraps errors**: `func wrap(err error) error { return &CtxErr{cause: err} }`. If used as `return wrap(maybeErr)` where maybeErr is sometimes nil and sometimes not, returning the wrapper either wraps or — if the function uses a typed-nil pattern internally — produces typed nil.

2. **Deferred error transform**: Defers that always reassign `err = something(err)` can produce typed nil if `something` returns a typed nil.

3. **Returning a struct pointer when you meant to return error**: `func op() error { var e *MyErr; ...; return e }` always returns non-nil interface even if `e` was never set.

The `staticcheck` rule SA4023 catches some of these. `errors.As` is the safe extraction primitive.

---

**Q11: What's the difference between `interface{}` being nil and a typed nil inside `interface{}`?**

**Answer**:
- `var i interface{} = nil`: both type and data words are nil. `i == nil` is true.
- `var p *T = nil; var i interface{} = p`: type word is `*T`, data word is nil. `i == nil` is false.

The `reflect` package can distinguish:
```go
v := reflect.ValueOf(i)
if v.Kind() == reflect.Ptr && v.IsNil() {
    // typed nil
}
```

---

**Q12: Why does `var f func(); f()` produce a "nil pointer dereference" panic?**

**Answer**: A function value (`func(...)`) is implemented as a pointer to a `funcval` struct, whose first field is the actual function code address. Calling the function loads this code address and indirect-jumps.

For a nil function value, the funcval pointer is nil. Loading from address 0 to read the code pointer faults — same SIGSEGV that a struct field access on nil produces. The runtime prints the standard nil pointer message.

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=...]
```

---

## Senior Level Questions

**Q13: Walk through how the runtime converts a SIGSEGV into a Go panic.**

**Answer**:
1. The CPU executes a load/store using a forbidden address (e.g., 0). The MMU raises a page fault.
2. The kernel translates the fault into SIGSEGV and delivers it to the process.
3. Go installs a signal handler at startup (`runtime.sigtrampgo` etc.).
4. The handler inspects the signal info: address, instruction pointer, signal code.
5. For an address in the nil page, the handler classifies it as a nil pointer dereference.
6. The handler modifies the saved program counter on the signal stack to point at `runtime.sigpanic`.
7. When the signal handler returns to user space, execution resumes at `sigpanic`, which calls `panicmem`.
8. `panicmem` calls `panic` with the appropriate value (`*runtime.PanicNilError` since Go 1.21).
9. The normal panic machinery walks deferred functions, optionally recovers, or terminates the goroutine.

---

**Q14: What is `*runtime.PanicNilError` and when was it introduced?**

**Answer**: `*runtime.PanicNilError` is a typed panic value introduced in Go 1.21 to specifically represent nil pointer dereferences (and `panic(nil)`).

Before 1.21, the panic value was an untyped `runtime.errorString` with a generic message. To detect nil panics in recovery code, you had to compare strings.

After 1.21:
```go
defer func() {
    if r := recover(); r != nil {
        if _, ok := r.(*runtime.PanicNilError); ok {
            // specifically nil
        }
    }
}()
```

The change allows libraries (logging, monitoring) to categorize panics by kind without string parsing.

---

**Q15: How does the compiler decide whether to emit an explicit nil check?**

**Answer**: The compiler relies on a few rules:

1. **Loads at small offsets** (within the protected nil page, typically 64 KB) need no explicit check — the load itself faults.
2. **Loads at large offsets** (past the nil page) need explicit checks because the address could land in valid memory.
3. **Pointers proven non-nil** (via SSA's `prove` pass — e.g., result of `&x`, `new`, or after a guard) skip the check entirely.
4. **Function calls through funcval** rely on the load itself to fault.

The `nilcheckelim` SSA pass walks the dominator tree and removes redundant checks. The `prove` pass adds non-nilness facts based on guards. Together they minimize check overhead.

You can inspect the decisions:
```bash
go build -gcflags="-d=nil" main.go
```

---

**Q16: What's the difference between the panic generated by `*p` (nil) and `(*p).field` (where p is nil)?**

**Answer**: At the runtime level, both produce the same SIGSEGV signal. The difference is the offset:
- `*p` accesses offset 0 — `addr=0x0` in the panic.
- `(*p).field` where field is at offset 16 — `addr=0x10` in the panic.

The Go runtime treats both as nil pointer dereferences if the address is in the protected nil page. The panic message is identical, but the `addr` field in the diagnostic differs and helps you identify which field tripped the panic.

---

**Q17: Can you recover from a nil pointer dereference? What are the gotchas?**

**Answer**: Yes, recover works for nil pointer panics. Gotchas:

1. **Recover must be in a deferred function in the same goroutine** as the panic. Cross-goroutine recovery doesn't exist — each goroutine has its own deferred-function chain.
2. **Recover only works during a panic** — calling it outside returns nil immediately.
3. **Re-panic** if you want outer handlers to see it: `panic(r)` after logging.
4. **Stack trace is captured at panic time**; if you recover and re-panic far away, the trace can be confusing.
5. **Defer machinery has cost** — using recover in hot paths slows things down (open-coded defers help in modern Go).
6. **Recover does not catch all crashes** — fatal runtime errors (concurrent map writes detected, stack overflow in some cases) bypass recovery.

For nil panics specifically, `*runtime.PanicNilError` (Go 1.21+) helps distinguish from other panic kinds in your recovery handler.

---

**Q18: How do you instrument production code to detect rates of nil pointer panics?**

**Answer**:
1. **Recover at every boundary** (HTTP handlers, goroutines, plugin runners) and increment a counter:
```go
var nilPanics = expvar.NewInt("nil_panics_total")
defer func() {
    if r := recover(); r != nil {
        if _, ok := r.(*runtime.PanicNilError); ok {
            nilPanics.Add(1)
        }
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

2. **Ship stacks to an error tracker** (Sentry, Honeycomb) for deduplication and trending.

3. **Alert on rate** > N/min — typically indicates a recently shipped bug.

4. **Sample stacks** for analysis — group by fingerprint (top 5 frames hash).

5. **SLO**: declare nil-panic rate = 0 as an objective; any non-zero is a violation.

---

**Q19: What's the SSA "nilcheckelim" pass and what does it do?**

**Answer**: It's the compiler pass in `cmd/compile/internal/ssa/nilcheck.go` that eliminates redundant nil checks. The algorithm walks the dominator tree, tracking which pointer values have been proven non-nil at each block (via earlier dereferences or comparisons).

When it encounters a `OpNilCheck` on a pointer already known non-nil, it removes the check. The companion `prove` pass adds non-nilness facts from explicit comparisons (`if p != nil`).

In real code, the pass eliminates >90% of the static nil checks the front-end emits. The remaining checks (large offsets, unproven pointers) are unavoidable correctness checks.

---

**Q20: Why must low-memory pages be unmapped on the platforms Go targets?**

**Answer**: Go's nil-deref-as-panic mechanism relies on the OS to make address 0 (and a region above it) unmapped, so any access faults. Linux's `vm.mmap_min_addr` (typically 65536) reserves the first 64 KB. Other platforms have similar mechanisms.

If a program were able to map page 0, a nil dereference at offset 0 might silently succeed and read whatever was mapped — defeating Go's safety.

This is why Go includes explicit nil checks for offsets above the protected page (the safety net's coverage is limited by the OS-protected region size).

---

## Scenario-Based Questions

**Q21: A service crashes with `invalid memory address or nil pointer dereference` in production. How do you investigate?**

**Answer**:
1. **Read the panic trace**: identify the file:line of the dereferencing operation.
2. **Find the variable**: which pointer was nil at that line?
3. **Trace the assignment chain**: where was that variable set? Which code path leads to nil?
4. **Reproduce locally** with the failing input if possible.
5. **Check for missing error handling**: was a constructor that returns `(*T, error)` checked correctly?
6. **Add defensive nil check** at the immediate site (short-term fix).
7. **Refactor** to make the nil case impossible by design (long-term fix).
8. **Add a test** with the failing scenario to prevent regression.
9. **Consider** if other similar patterns in the codebase need the same fix.

---

**Q22: Your team gets a code review suggesting "add a nil check here just in case". When do you push back?**

**Answer**: Push back when:
- The pointer is the result of `&x` or `new()` — provably non-nil.
- The function's contract says the parameter is non-nil; a check there masks misuse instead of catching it.
- The check is in a critical-path inner loop where the contract is enforced upstream.
- The check just returns silently without error — better to crash with a clear panic and fix the caller.

Accept when:
- The pointer crossed a trust boundary (untrusted input, RPC argument).
- The function can be called with nil legitimately and the check provides reasonable behavior.
- Static analysis (nilness, nilaway) suggests the pointer might be nil under some path.

The principle: nil checks should be at boundaries and at documented optional inputs, not sprinkled defensively.

---

**Q23: A test passes locally but fails intermittently in CI with a nil panic. Where do you look?**

**Answer**:
1. **Concurrency**: test may have a race that exposes a partially-initialized pointer.
2. **Timing**: lazy initialization that completes before the assertion locally but not always in CI.
3. **Order dependence**: previous tests leave global state that the failing test assumes.
4. **Resource-dependent**: a config/file/database connection sometimes fails, leaving a nil.
5. **Platform-specific**: a syscall returns differently on different OSes.

Investigate with `-race`, `-count=100`, and `-shuffle=on`. Add structured logging at the failing site. Make the failure reproducible before fixing.

---

**Q24: Your service depends on a library that returns typed nil errors. How do you defend?**

**Answer**:
1. **Wrap the library call** in an adapter that converts typed nil to bare nil:
```go
func libCall() error {
    err := lib.Op()
    if err == nil {
        return nil
    }
    // Detect typed nil
    v := reflect.ValueOf(err)
    if v.Kind() == reflect.Ptr && v.IsNil() {
        return nil
    }
    return err
}
```

2. **Use `errors.As`** to extract concrete types safely:
```go
var target *lib.SomeError
if errors.As(err, &target) {
    // target is guaranteed non-nil here
}
```

3. **File a bug upstream** with a clear example.

4. **Add a test** that exercises the typed-nil path.

5. **Document** the workaround for other team members.

---

**Q25: A junior developer added `if x != nil` everywhere "to be safe". What's wrong?**

**Answer**:
- **Code clutter**: harder to read.
- **Hides API contracts**: callers can't tell which pointers are documented as possibly-nil.
- **Catches nothing new**: if the contract is non-nil, a real nil here is a bug to surface, not silence.
- **Performance overhead**: minor, but unnecessary.
- **False sense of security**: a check that returns a default for nil may mask a real bug for months.

Better approach: nil check at boundaries, document optional inputs, let internal violations panic loudly during development. Static analysis tools (nilness, nilaway) catch real risk areas.

---

## FAQ

**Why doesn't Go have nullable types like Kotlin?**

Go's design favors simplicity and explicit checks over a richer type system. Adding nullable annotations would be a large language change. The community uses static analyzers (nilness, nilaway) and conventions to fill the gap.

---

**Is `nil` the same as zero?**

For pointer types, yes — the zero value of `*T` is nil. For numeric types, the zero value is 0 (no nil). For interfaces, the zero value is `nil` (both words). For structs, the zero value is a struct with all fields zero-valued.

---

**Can I tell at compile time which pointers might be nil?**

Not via the type system. Static analyzers (`nilness`, `nilaway`) infer this with various levels of sophistication. The Go compiler itself does not annotate nullability.

---

**What's the difference between `panic("nil")` and a nil pointer dereference?**

`panic("nil")` is a user-initiated panic with the string `"nil"`. A nil pointer dereference is a runtime panic with `*runtime.PanicNilError` (Go 1.21+). Both are recoverable; the panic value differs.

---

**Why is `var p *int; fmt.Println(p)` not a panic?**

`fmt.Println` doesn't dereference the pointer — it prints `<nil>` based on the pointer's value (which is nil). Only operations that load through the pointer panic.

---

**Can `recover` catch a `os.Exit` or `log.Fatal`?**

No. `os.Exit` terminates the process without running deferred functions. `log.Fatal` calls `os.Exit(1)` after logging. Neither produces a panic; recover does nothing.

---

**Where is the panic message defined in the Go runtime?**

`src/runtime/panic.go` — the `*PanicNilError` type's `Error()` method returns the string. Pre-1.21, the message was hard-coded in `runtime.errorString`.

---

**Does Go's GC scan nil pointers?**

Yes — GC scans the pointer field, sees nil, and skips it. The scan is conservative; nil is a valid value that simply doesn't reference anything. No panic; no work.
