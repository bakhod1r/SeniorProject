# Go Named Return Values — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is a named return value in Go?**

**Answer**: A return parameter with a name in the function signature. The name acts as a local variable initialized to its type's zero value. A naked `return` (no expressions) returns the current values of all named results.

```go
func split(sum int) (x, y int) {
    x = sum / 2
    y = sum - x
    return // returns x and y
}
```

---

**Q2: What's a "naked return"?**

**Answer**: A `return` statement with no expressions. Allowed only when results are named:

```go
func f() (n int) {
    n = 42
    return // returns 42
}
```

A naked return with unnamed results is a compile error.

---

**Q3: Can you mix naked and explicit returns in one function?**

**Answer**: Yes:

```go
func validate(x int) (n int, err error) {
    if x < 0 {
        err = fmt.Errorf("negative")
        return // naked
    }
    return x, nil // explicit
}
```

Both work. Choose for clarity within each branch.

---

**Q4: What's the difference between these two functions?**
```go
func a() int { return 0 }
func b() (n int) { return }
```

**Answer**: Both return 0. Function `a` returns the constant 0 explicitly. Function `b` returns the named result `n`, which is zero-initialized and never assigned. Functionally identical; `b` is using named return purely for syntax.

---

**Q5: Can a deferred function modify a named return?**

**Answer**: Yes. Defer runs after the explicit `return` assigns to named results but before the function returns to the caller:

```go
func f() (n int) {
    defer func() { n++ }()
    return 5 // n = 5; defer makes n = 6; returns 6
}
```

This is the basis of cleanup-error capture and panic-to-error patterns.

---

## Middle Level Questions

**Q6: When should you use named returns?**

**Answer**: Three main cases:
1. **Documentation**: `(n int, err error)` is clearer than `(int, error)`.
2. **Defer modification**: cleanup-error capture, panic-to-error.
3. **Short functions** where naked return is concise.

Avoid named returns when:
- Function is long and naked return is far from assignments.
- Result names don't add semantic value.
- You're forced to mix multiple naked-return paths and assignments.

---

**Q7: How does the cleanup-error capture pattern work?**

**Answer**:

```go
func op() (err error) {
    res, err := acquire()
    if err != nil { return err }
    defer func() {
        if cerr := res.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    // ... do work, possibly setting err ...
    return nil
}
```

The deferred function:
1. Calls `Close()`.
2. If close fails AND no other error occurred, propagates the close error via `err`.

The pattern requires named return because `defer` needs to read and write `err`.

---

**Q8: How do you convert a panic to an error?**

**Answer**: `defer + recover + named error`:

```go
func safe() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    risky()
    return nil
}
```

If `risky()` panics, the deferred function catches it, assigns to `err`, and the function returns normally with that error.

---

**Q9: What's the difference between `defer fmt.Println(n)` and `defer func() { fmt.Println(n) }()` when `n` is a named return?**

**Answer**:

```go
func f() (n int) {
    n = 1
    defer fmt.Println(n)              // captures n=1 NOW (eager arg)
    defer func() { fmt.Println(n) }() // captures n by ref (lazy arg)
    n = 99
    return
}
// Output (LIFO):
// 99 (from closure)
// 1  (from eager defer)
```

`defer call(args)` evaluates args eagerly. `defer func(){...}()` captures by reference.

---

**Q10: What happens if you forget to assign a named result?**

**Answer**: It returns the zero value of its type (silently). For example:

```go
func f() (n int, err error) {
    if condition {
        err = fmt.Errorf("oops")
        return // returns (0, err)
    }
    // forgot: n = computeN()
    return // returns (0, nil) — silent bug
}
```

This is the main risk of naked returns. Test all paths.

---

**Q11: Can named returns be used with generics?**

**Answer**: Yes:

```go
func Zero[T any]() (v T) {
    return // returns zero of T
}

n := Zero[int]()    // 0
s := Zero[string]() // ""
```

Named results work normally with type parameters.

---

**Q12: Can you take the address of a named return?**

**Answer**: Yes, named returns are normal local variables:

```go
func f() (n int) {
    p := &n
    *p = 42
    return // returns 42
}
```

If the address escapes, `n` moves to the heap.

---

## Senior Level Questions

**Q13: Walk through what happens when `return 5` executes in a function with `(n int)` named return and a defer that does `n++`.**

**Answer**:

1. Evaluate the expression `5`.
2. Assign `n = 5` (named result is set).
3. Run deferred functions in LIFO order. The defer increments `n` to 6.
4. The function returns the current value of `n`, which is 6.

So `return 5` in this function returns 6.

---

**Q14: Does defer + named return have any performance overhead?**

**Answer**: Minimal. Open-coded defer (Go 1.14+) inlines the deferred body into each return path. The named-result modification is a register/stack write (~1 cycle).

For ≤ 8 defers without loop-defer, the cost is essentially zero compared to no-defer code.

For complex defer chains (loops, > 8 defers), each defer adds ~30 ns (stack-allocated path) or ~50 ns (heap-allocated).

---

**Q15: What's the difference in compiled code between named and unnamed returns?**

**Answer**: After optimization, often identical. Named returns are sugar:
- Unnamed: write to result register, RET.
- Named: write to local var (which IS the result register), RET.

The inliner expands both forms similarly. After inlining, the named-return decoration disappears.

For functions with explicit assignments to named results throughout the body (vs at-return-time evaluation), the SSA may differ slightly, but the optimizer flattens this.

---

**Q16: How does open-coded defer interact with named-return modification?**

**Answer**: Open-coded defer inlines the deferred body at each return point. For a defer that modifies a named return:

```go
func f() (n int) {
    defer func() { n++ }()
    return 5
}
```

The compiler emits something like:
```
return_path:
    MOVQ $5, n_register   ; n = 5 (from `return 5`)
    INCQ n_register        ; defer body: n++
    RET                    ; return n_register (= 6)
```

The defer is inlined directly into the return path. No closure allocation, no heap defer record.

---

**Q17: What happens if a deferred function panics while running?**

**Answer**: The new panic replaces the original (if any). The deferred-function chain continues processing later defers.

```go
func f() {
    defer func() { panic("from defer") }()
    panic("from body")
}

// Top-level panic message: "from defer"
```

The original panic's stack info is preserved in the runtime's panic chain but the message displayed is the most recent.

For named-return + recover patterns, you should NOT panic inside the recover handler — it would replace the recovered panic with a new one and re-trigger unwinding.

---

**Q18: How do you use named returns to implement transaction auto-rollback?**

**Answer**:

```go
func transfer(db *sql.DB, from, to string, amount int) (err error) {
    tx, err := db.Begin()
    if err != nil { return err }
    defer func() {
        if err != nil {
            tx.Rollback() // rollback if any error
        } else {
            if cerr := tx.Commit(); cerr != nil {
                err = cerr // capture commit error
            }
        }
    }()
    if _, err = tx.Exec("UPDATE accounts SET bal = bal - ? WHERE id = ?", amount, from); err != nil { return }
    if _, err = tx.Exec("UPDATE accounts SET bal = bal + ? WHERE id = ?", amount, to); err != nil { return }
    return
}
```

The deferred function inspects `err`:
- Non-nil: rollback.
- Nil: commit (and capture any commit error).

Named `err` is the single source of truth.

---

**Q19: What's the typed-nil-interface gotcha and how does it interact with named returns?**

**Answer**: Returning a typed nil pointer through an interface result (like `error`) creates a non-nil interface:

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "" }

func bad() (err error) {
    var p *MyErr // nil
    err = p      // err is now (*MyErr, nil) — non-nil interface!
    return
}

err := bad()
fmt.Println(err == nil) // false
```

The interface holds a non-nil type word + nil data; both must be nil for `err == nil` to be true.

Fix: assign literal nil:
```go
func good() (err error) {
    err = nil // both words zero
    return
}
```

---

**Q20: Can deferred functions read each other's modifications to named results?**

**Answer**: Yes. Defers run in LIFO order; each one can see modifications by previously-run defers.

```go
func f() (n int) {
    defer func() { n *= 2 }()  // runs LAST: doubles
    defer func() { n += 1 }()  // runs SECOND: adds 1
    n = 5
    return                      // n = 5; defer1: n=6; defer2: n=12
}
fmt.Println(f()) // 12
```

LIFO order: last deferred = first executed.

---

## Scenario-Based Questions

**Q21: A function returns (data, error). On error paths, the data is sometimes populated. Callers complain about confusing behavior. How do you fix?**

**Answer**: Enforce the convention "zero value with error":

```go
func op() (data Data, err error) {
    // ... do work, may set err ...
    if err != nil {
        data = Data{} // explicitly clear
        return
    }
    return
}
```

Or using defer:
```go
func op() (data Data, err error) {
    defer func() {
        if err != nil { data = Data{} }
    }()
    // ... do work ...
    return
}
```

Now callers can rely on `data` being zero when err is non-nil.

---

**Q22: A long function uses naked return on multiple paths. A reviewer asks you to refactor. How?**

**Answer**:
1. **Split into smaller helpers** if the function is too complex.
2. **Switch to explicit return** for clarity:
   ```go
   // Before
   func longFunc() (a, b int, err error) {
       // ... complex logic with many naked returns ...
       return
   }
   
   // After
   func longFunc() (int, int, error) {
       // ... complex logic ...
       return aValue, bValue, nil // explicit at every return
   }
   ```
3. **Keep named returns** if defer needs to modify them; otherwise drop them.

The goal: any reader can quickly see what's being returned at each `return` site.

---

**Q23: A team argues that named returns "always" improve readability. When do you disagree?**

**Answer**: When:
- The function is > 20 lines and the assignment site is far from the return.
- Naked return on multiple paths makes it unclear which paths set which results.
- The names are vague (e.g., `result`, `value`) and add no semantic value.
- The function is trivial (`func f() int { return 0 }`) — naming is noise.

Named returns are most useful for short functions, defer-modification patterns, and as documentation when names ARE meaningful.

---

**Q24: A function uses defer to capture close errors but tests show the close error isn't propagated. What might be wrong?**

**Answer**: Common bugs:

1. **Result not named**:
   ```go
   func op() error {
       defer func() {
           if cerr := f.Close(); cerr != nil {
               // can't modify the unnamed return
           }
       }()
       return work()
   }
   ```
   Fix: name the result `(err error)`.

2. **Defer evaluates eagerly**:
   ```go
   defer fmt.Println(err) // captures err NOW (probably nil)
   ```
   Fix: use `defer func() { fmt.Println(err) }()`.

3. **Logic bug**: `if cerr != nil && err == nil` — verify the conditions.

4. **Return reassignment misses**: ensure `err = ...` everywhere, not just in some branches.

Test each path.

---

## FAQ

**Are named returns required for cleanup-error capture?**

Yes. Defer can only modify named results. With unnamed results, defer can't change what the caller receives.

---

**Why does naked return get a bad reputation?**

Long functions with naked return require the reader to scroll up to find what's being returned. The convention "explicit when long, naked when short" balances readability with concision.

---

**Can I use generics with named results?**

Yes. `func F[T any]() (v T)` works normally; `v` is initialized to `T`'s zero value.

---

**What if I want some results named and others not?**

Not allowed. All named or all unnamed in the same result list.

---

**Does naked return work with `panic`/`recover`?**

Yes. In a deferred function with `recover`, you set the named error via `err = ...` and the function returns with that error (regardless of what the original `return` would have produced — because the panic interrupted normal flow).

---

**Is there a performance penalty for naming results?**

No. Identical compiled code in most cases.

---

**Can methods have named return values?**

Yes. Methods are functions with a receiver; named returns work the same way.

---

**Where can I see how the compiler treats named returns?**

`cmd/compile/internal/walk/order.go` and `cmd/compile/internal/ssa/` for the lowering. `cmd/compile/internal/ssa/decompose.go` for slot allocation.
