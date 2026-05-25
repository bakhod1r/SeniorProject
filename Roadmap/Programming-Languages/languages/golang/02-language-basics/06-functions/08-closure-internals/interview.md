# Closure Internals — Interview

Author: Bakhodir Yashin Mansur

Thirty-plus question-and-answer pairs covering closure internals at the depth a senior Go interview expects. Questions progress from fundamentals to implementation detail.

---

## Section A — Fundamentals

### Q1. What is a closure in Go at the runtime level?

A closure is a two-part value: a pointer to a function body (code pointer) and a pointer to a struct of captured variables (env). The runtime calls this pair a `funcval`. A `func()` variable in Go holds a pointer to such a funcval.

### Q2. How does Go capture variables in a closure?

By reference. The compiler synthesises a struct whose fields are pointers to the captured variables. The closure and the enclosing scope share the same variable; mutating it through either is visible to the other.

### Q3. Are captured variables on the stack or the heap?

It depends on escape analysis. If the closure outlives the enclosing function's frame (returned, started as a goroutine, stored in a long-lived field), the captured variables escape to the heap. Otherwise they can stay on the stack.

### Q4. Can a closure outlive its enclosing function?

Yes. The variables it captured remain reachable as long as the closure references them. The garbage collector decides when they die, not the function's return.

### Q5. What was the loop-variable bug?

Before Go 1.22, the loop variable in `for i := 0; ...; i++` or `for _, v := range xs` was a single variable for the whole loop. Closures created in the loop body captured that one variable. When the closures ran later, they all observed the loop's terminal value, not the per-iteration value the author expected.

### Q6. How did Go 1.22 fix it?

The spec was changed so each iteration creates a fresh loop variable. Closures now capture the iteration's variable. The fix is per-module — controlled by the `go` directive in `go.mod`. A module declaring `go 1.22` or later uses per-iteration scoping.

### Q7. How do you defeat capture-by-reference when you want a value snapshot?

Two idioms. Shadow with `:=`:

```go
v := v
go func() { use(v) }()
```

Or pass as an argument:

```go
go func(v T) { use(v) }(v)
```

Both create a fresh variable that the closure captures.

### Q8. Is `s.Method` a closure?

Yes. `s.Method` (no call) is a method value — a funcval whose env contains `s` as the receiver. `(*T).Method` (a method expression) is not a closure; it's a plain function taking the receiver as its first argument.

---

## Section B — Allocation and cost

### Q9. How many heap allocations does `f := func(){}; f()` produce?

Zero. The closure captures nothing, so the compiler can emit a static funcval in `.rodata` and call it without allocating. `-gcflags='-m'` would say `can inline` or `does not escape`.

### Q10. How many heap allocations does `f := func(){use(x)}; go f()` produce?

At least one for the funcval+env (escapes because the goroutine outlives the spawning frame). Possibly one more for `x` itself if it wasn't already on the heap.

### Q11. Why can't the compiler inline through a closure call?

A closure call is an indirect call through `funcval.fn`. The compiler doesn't know at compile time which body will be invoked. With limited devirtualisation (Go 1.18+) it can sometimes recover the concrete body, but only when the closure value is statically known.

### Q12. What is the cost of an indirect call through a funcval?

A load (the code pointer), an indirect branch, and a slightly larger live-register set during the call. On modern CPUs the predictable cases are 1–3 ns; cold cases (mispredict) add 5–10 ns. The bigger cost is missed inlining of the body.

### Q13. How do you minimise closure allocations in a hot loop?

Options in order:
1. Pre-allocate the closure outside the loop if it doesn't need per-iteration state.
2. Replace with a method on a struct that already exists.
3. Replace with a generic helper that lets the compiler inline.
4. Use a worker pool: closures are created N times (workers), not per task.

### Q14. Does `sort.Slice(s, func(...) bool {...})` allocate?

No. The closure escapes only into `sort.Slice`'s frame, which is short-lived. Escape analysis lets the funcval and env live on the caller's stack.

### Q15. Does `errgroup.Go(func() error {...})` allocate?

Yes. The closure becomes a goroutine entry. Goroutines outlive the spawning frame, so the funcval and env are on the heap. Each `g.Go` call is at least one closure allocation on top of the goroutine itself.

---

## Section C — Loop bug specifics

### Q16. Why does pre-1.22 `for _, v := range xs { go func(){print(v)}() }` print the last value many times?

`v` is a single variable. The goroutines start while the loop runs but execute later. By execution time `v` holds `xs[len(xs)-1]`. All goroutines print it.

### Q17. Why is `for _, v := range xs { go func(v V){print(v)}(v) }` safe even pre-1.22?

The inner `v` is a fresh parameter, not a capture. Each goroutine has its own copy.

### Q18. Why does `defer` inside a pre-1.22 loop have the same bug?

`defer` registers a call but runs it at function exit. By exit time, any captured loop variable has the loop's terminal value.

### Q19. Is `defer f.Close()` inside a loop bugged the same way?

No — `f` is freshly declared each iteration via `:=`. Each `defer f.Close()` captures the fresh `f`. The pitfall here is *resource accumulation* (N file handles open until the function returns), not capture identity.

### Q20. What does `-gcflags='-d=loopvar=2'` do?

On Go 1.22+, prints every loop where the new per-iteration scoping affects behaviour relative to the old rule. Useful when upgrading a codebase.

---

## Section D — Method values and expressions

### Q21. What's the cost difference between `f := c.Method` and `g := (*Counter).Method`?

`f` is a method value: a funcval with env containing `c`. Allocates if it escapes.
`g` is a method expression: a plain function pointer. Never allocates.

### Q22. When is a method value with a value receiver dangerous?

When the receiver contains identity-bearing fields like `sync.Mutex`, `atomic.*`, channels, or maps. The compiler copies the whole receiver into the env. Operations against the copy don't affect the original. `go vet` warns for lock-by-value.

### Q23. Can a method value capture state that the original method modifies?

If the receiver is a pointer (`*T`), yes — the method value captures the pointer, and modifications through it persist. If the receiver is a value (`T`), no — the captured copy is independent.

### Q24. Is `interface.Method` a closure?

Implementation detail. The compiler treats it as a closure of the interface value (which is itself two words: type + data). In practice you don't write this often; `iface.Method(args)` is more common and doesn't materialise a closure.

---

## Section E — `defer` and closure interaction

### Q25. Why does `defer func(){...}()` capture the final value of named returns?

The deferred function is a closure that captured the named return by reference. By the time it runs (at function exit), the named return has been assigned. The closure sees the assigned value.

### Q26. Why does `defer func(e error){...}(err)` see a different value than `defer func(){...}()`?

The first form snapshots `err` at defer time (parameter copy). The second captures the variable by reference and sees whatever value it has at function exit.

### Q27. What changed about `defer` cost in Go 1.14?

Open-coded defers: when the compiler can enumerate all `defer` statements in a function statically, it inlines the cleanup at every return path. No `_defer` record allocation. This made `defer f.Close()` and other simple cases free.

### Q28. When does open-coded defer not apply?

When a `defer` is inside a loop, a conditional that defies enumeration, or there are more than ~8 deferred calls in a function. The compiler falls back to the older heap-allocated `_defer` chain.

---

## Section F — Compiler and runtime

### Q29. Where does the compiler synthesise the env struct?

`cmd/compile/internal/walk/closure.go`, specifically `walkClosure`. It creates a struct type whose fields are the captured variables (or pointers to them, for by-reference captures), allocates an instance (heap if escapes, stack otherwise), fills it, and wraps it with the body's code pointer to form a funcval.

### Q30. What is `runtime.funcval` and how big is it?

```go
type funcval struct { fn uintptr }
```

One declared field. The captured variables follow in memory; their layout is known only to the compiler. Total size depends on the number and type of captures.

### Q31. What register holds the funcval pointer during a closure call on amd64?

`DX`. On arm64, `R26`. The closure body's prologue reads captured variables via offsets from this register.

### Q32. How does `reflect.MakeFunc` work?

It builds a `*makeFuncImpl` whose first word is a pointer to a per-arch assembly stub (`runtime.makeFuncStub`). The stub reads the funcval, packs the call's arguments into `[]reflect.Value`, invokes the user-supplied Go function, and unpacks the returned values into the caller's result slots. The result behaves as a normal funcval.

### Q33. Why are funcvals two words on the stack but one word in a variable?

A `func()` variable holds *a pointer to* a funcval (one word). The funcval itself, wherever it lives, contains the code pointer plus captured fields. When a closure captures nothing, the entire funcval is a single static rodata symbol; when it captures, the funcval and env are usually one allocation (or stack region).

---

## Section G — Subtle semantics

### Q34. Are two closures with identical bodies equal?

You can't compare them. Go forbids `==` between two non-nil function values. Only `f == nil` is allowed.

### Q35. Can a closure recurse?

Yes, but you need to declare the variable first:

```go
var fact func(int) int
fact = func(n int) int { if n <= 1 { return 1 }; return n * fact(n-1) }
```

The literal captures `fact` (the variable) by reference. Inside the body, `fact` is loaded from the env, then dereferenced to call.

### Q36. What happens if a captured variable is also captured by another closure?

Both closures share the variable. Updates from one are visible to the other. This is the standard pattern for state shared between several callbacks created together.

### Q37. Can a closure capture a goroutine-local variable safely?

There is no goroutine-local storage in Go. Variables are scoped lexically. A closure capturing a variable from goroutine A's function may be invoked by goroutine B (e.g., callback dispatched from a worker). Without synchronisation, this is a data race.

---

## Section H — Patterns and pitfalls

### Q38. Why is `sync.Once.Do(f)` typically called with a closure?

`Do` takes `func()`. The work usually depends on configuration not available at package init time — captured variables in a closure provide it. `Once.Do(initDB)` works only if `initDB` needs no parameters.

### Q39. When should you prefer an interface over a closure for a callback?

When the callback has multiple related operations (`Read`/`Write`/`Close`), when you need type information for assertions, or when you want a mockable boundary in tests. Closures win for one-shot single-method callbacks.

### Q40. How do you debug "the closure captured the wrong thing"?

1. Log captured state at closure-construction time.
2. Use `-gcflags='-m=2'` to see which variables are captured and by reference vs. by value.
3. For a running process, attach `delve` and print `*(*[2]uintptr)(unsafe.Pointer(&f))` to inspect the funcval; cast the env to the synthesised struct type if you know its shape.

### Q41. Why does this code allocate on every call: `func make() func() { return func() {} }`?

The returned closure captures nothing, but it still needs to be a `func()` value. The compiler optimises non-capturing literals to static funcvals, so the call site doesn't allocate per call — but the surface looks like it might. Confirm with `-benchmem`.

### Q42. Will `go vet` catch the pre-1.22 loop-variable bug?

It used to (the `loopclosure` checker). Since Go 1.22 the checker is largely silent because the bug is gone for modules at `go 1.22`. For older modules, `loopclosure` still flags suspicious patterns.

---

## Section I — Quick-fire

### Q43. Funcval size?
One word reference; pointed-at structure is variable.

### Q44. Loop variable change Go version?
1.22.

### Q45. Open-coded defer Go version?
1.14.

### Q46. Closure register on amd64?
DX.

### Q47. Method value vs. expression — which captures?
Value captures the receiver; expression does not.

### Q48. Can a `func() = func() {}` comparison compile?
No. Function values can only be compared to nil.

### Q49. What does `-gcflags='-m'` show for closures?
Capture decisions, escape decisions, inlining decisions per source line.

### Q50. What is `reflect.MakeFunc`?
The only spec-supported API to construct closures dynamically. Returns a funcval-compatible value.

---

## Summary

These questions cover capture semantics (Section A), allocation (B), the loop-variable bug (C), method values (D), defer interaction (E), compiler/runtime layer (F), subtle semantics (G), patterns (H), and quick recall (I). A candidate who can answer them confidently understands closures at the level needed for senior production Go work.

---

## Further reading

- [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md) in this directory
- Go spec, function literals: https://go.dev/ref/spec#Function_literals
- `cmd/compile/internal/walk/closure.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/closure.go
- Loop variable proposal #60078: https://github.com/golang/go/issues/60078
