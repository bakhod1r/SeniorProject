# Go Multiple Return Values — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: How do you declare a function with multiple return values?**

**Answer**: Wrap the result types in parentheses:

```go
func divmod(a, b int) (int, int) {
    return a / b, a % b
}
```

A single result doesn't need parens: `func square(x int) int`.

---

**Q2: What is the `(value, error)` idiom?**

**Answer**: Go's standard convention for error handling: a function that can fail returns the result first, then an `error` second. `nil` error means success.

```go
n, err := strconv.Atoi("42")
if err != nil {
    // handle
    return
}
// use n
```

Always check `err` first; don't use the value when err != nil.

---

**Q3: What is the comma-ok idiom?**

**Answer**: A two-value form for "lookup with existence flag." Three standard variants:

```go
v, ok := m[k]      // map lookup
s, ok := x.(T)     // type assertion
val, ok := <-ch    // channel receive
```

`ok` is true if the operation found something; false otherwise. The first value is meaningful only when ok is true.

---

**Q4: What does `_` do in a multi-result assignment?**

**Answer**: It discards the corresponding result:

```go
n, _ := strconv.Atoi("42")  // discard error (DANGEROUS — usually a bug)
_, err := f()               // discard value, keep error
```

You must explicitly discard each unwanted result; you cannot just omit them.

---

**Q5: How do you forward multiple return values to another function?**

**Answer**: Pass the multi-result function call directly, BUT only if the parameter list of the receiving function exactly matches:

```go
func divmod(a, b int) (int, int) { return a/b, a%b }
func sum(a, b int) int { return a + b }

result := sum(divmod(17, 5)) // 3 + 2 = 5
```

If the parameter list doesn't match, you must assign to variables first.

---

**Q6: Can you use a multi-result function as a single value?**

**Answer**: **No**. Multi-result is not a tuple. You cannot:
- Assign it to one variable: `n := f()` (compile error if f returns multiple)
- Use it in an expression: `f() + 1`
- Pass it to a single-arg function: `g(f())` (unless f's results match g's params exactly)
- Wrap in interface: `var x any = f()`

---

**Q7: What's wrong with this code?**
```go
n, err := strconv.Atoi(s)
fmt.Println("n is", n)
if err != nil {
    return err
}
```

**Answer**: It uses `n` before checking the error. When `err != nil`, `n` is the zero value (0). The print might show `n is 0` followed by an error return — confusing logging and potentially a bug. Always check err first:

```go
n, err := strconv.Atoi(s)
if err != nil {
    return err
}
fmt.Println("n is", n)
```

---

## Middle Level Questions

**Q8: How does error wrapping with `%w` work?**

**Answer**: `fmt.Errorf("ctx: %w", err)` creates a new error that contains the original error in its chain. The wrapping mechanism enables `errors.Is` and `errors.As` to traverse the chain:

```go
var ErrNotFound = errors.New("not found")

func get(k string) error {
    return fmt.Errorf("get %s: %w", k, ErrNotFound)
}

err := get("x")
fmt.Println(errors.Is(err, ErrNotFound)) // true
```

Without `%w` (using `%v` instead), the chain is broken and `errors.Is` returns false.

---

**Q9: What is the typed-nil-interface bug?**

**Answer**:
```go
type MyErr struct{}
func (e *MyErr) Error() string { return "" }

func bad() error {
    var p *MyErr = nil
    return p
}

err := bad()
fmt.Println(err == nil) // false!
```

The `error` interface stores two words: type and data. When you return a typed nil pointer, the type word is non-nil. `err == nil` requires BOTH words to be nil. Always return literal `nil`:

```go
func good() error {
    if condition {
        return &MyErr{}
    }
    return nil // literal nil, both words zero
}
```

---

**Q10: When should you use a struct return vs multiple values?**

**Answer**: Rule of thumb:
- **2-3 results** → multiple values are fine.
- **4+ results** → use a struct.
- **Results that are conceptually "one thing"** → struct (e.g., `(URL, error)` not `(scheme, host, path, error)`).
- **`(value, error)` or comma-ok pattern** → always multiple values.

Struct returns are easier to evolve (add fields without breaking callers).

---

**Q11: Can you return multiple values from a goroutine?**

**Answer**: **No** directly. Goroutines cannot return values. To get multi-result data from a goroutine, use channels or shared state:

```go
ch := make(chan struct {
    n   int
    err error
}, 1)

go func() {
    n, err := work()
    ch <- struct {
        n   int
        err error
    }{n, err}
}()

res := <-ch
```

Or use `errgroup.Group` for parallel orchestration with error propagation.

---

**Q12: How do you handle errors from multiple parallel goroutines?**

**Answer**: Use `errgroup.Group` (from `golang.org/x/sync/errgroup`):

```go
import "golang.org/x/sync/errgroup"

var g errgroup.Group
var a, b string

g.Go(func() error {
    var err error
    a, err = fetchA()
    return err
})
g.Go(func() error {
    var err error
    b, err = fetchB()
    return err
})

if err := g.Wait(); err != nil {
    return err
}
// use a and b
```

`Wait` returns the first non-nil error. If you want ALL errors, use `errors.Join` with manual collection.

---

**Q13: What's the purpose of the `Must` helper pattern?**

**Answer**: A wrapper that converts `(value, error)` into a single value, panicking on error. Used at package init for inputs known to be valid:

```go
func Must[T any](v T, err error) T {
    if err != nil {
        panic(err)
    }
    return v
}

var emailRe = Must(regexp.Compile(`^[a-z]+@[a-z]+$`))
```

Use only at init time or in tests — never in production hot paths.

---

**Q14: Why does `_, err := f()` not save the value?**

**Answer**: The `_` is the **blank identifier**. It accepts a value at the assignment but discards it. The value is never stored. You're acknowledging the result exists but explicitly throwing it away.

```go
_, err := f() // discard the first result
```

This is required syntax — you can't just omit the underscore.

---

## Senior Level Questions

**Q15: Walk through the calling convention for `func f() (int, error)`.**

**Answer**: With Go 1.17+ register ABI on amd64:

- `int` result → AX
- `error` interface (2 words: itab + data) → BX, CX

So `f()` returns three register values: AX = int, BX = error type word, CX = error data word.

Caller checks `err == nil` by `(BX | CX) == 0`.

For more results, use DI, SI, R8, R9, R10, R11 next; beyond 9 results, spill to caller's stack frame.

---

**Q16: How does the typed-nil-interface bug manifest at the bit level?**

**Answer**: An `error` interface value is two words: `(*itab, unsafe.Pointer)`. Nil interface means `(nil, nil)`. Typed-nil pointer assigned to interface gives `(non-nil itab, nil data)`.

`err == nil` lowers to `(itab | data) == 0`. With non-nil itab, this is false even though the concrete value is nil.

Static analyzers like `golang.org/x/tools/go/analysis/passes/nilness` flag the pattern.

---

**Q17: What is the cost of `errors.New` vs a sentinel error?**

**Answer**:
- `errors.New("msg")`: 1 heap allocation per call (~16 B for `*errorString`).
- Pre-allocated sentinel: 0 allocations per use.

```go
// In hot path — bad:
for ... {
    if invalid {
        return errors.New("invalid") // ALLOCATES per iteration
    }
}

// Better:
var errInvalid = errors.New("invalid")
for ... {
    if invalid {
        return errInvalid // 0 allocs
    }
}
```

`errors.Is(err, errInvalid)` works because the sentinel pointer is unique.

---

**Q18: What does `errors.Is` actually do internally?**

**Answer**: It walks the error chain via `Unwrap()`:

1. Start with `err`.
2. Compare `err == target` (if target is comparable).
3. If `err` has `Is(error) bool` method, call it.
4. If `err` has `Unwrap() error`, recurse on the result.
5. If `err` has `Unwrap() []error` (joined errors), recurse on each.
6. Stop when the chain is exhausted or a match is found.

No allocations. Cost is proportional to chain depth.

---

**Q19: When does open-coded defer apply, and how does it interact with named returns?**

**Answer**: Open-coded defer (Go 1.14+) inlines deferred calls into each return path. Applies when:
- Function has ≤ 8 defers.
- No defer is inside a loop.
- The deferred function is straightforwardly representable.

With named returns, the deferred function can modify the result before the actual return:

```go
func work() (n int, err error) {
    defer func() {
        if err != nil { n = -1 }
    }()
    // ...
    return n, err
}
```

Open-coded defer compiles this into:
```
return_path:
    ; check err
    ; if err != nil: MOVL $-1, AX
    RET
```

Near-zero overhead.

---

**Q20: How do you design a package's error API for composability?**

**Answer**:

1. **Define sentinel errors** for stable conditions callers may handle:
   ```go
   var (
       ErrNotFound = errors.New("pkg: not found")
       ErrInvalid  = errors.New("pkg: invalid")
   )
   ```

2. **Wrap with context** when bubbling up:
   ```go
   return fmt.Errorf("get %q: %w", key, ErrNotFound)
   ```

3. **Define typed errors** when callers need rich data:
   ```go
   type APIError struct { Code int; Msg string }
   func (e *APIError) Error() string { return ... }
   ```

4. **Document which errors callers may inspect** in package docs.

5. **Don't overexpose**: list only the errors that are part of the API contract.

---

## Scenario-Based Questions

**Q21: Your service returns `(*User, error)` and callers check `if u != nil`. Sometimes they get a non-nil user with a non-nil error. What's wrong?**

**Answer**: The constructor is returning a partial user alongside the error:

```go
// BAD
func loadUser(id int) (*User, error) {
    u := &User{ID: id}
    if err := db.Fill(u); err != nil {
        return u, err // partial user with error
    }
    return u, nil
}
```

Fix: return zero value (nil pointer) when err is non-nil:

```go
func loadUser(id int) (*User, error) {
    u := &User{ID: id}
    if err := db.Fill(u); err != nil {
        return nil, err
    }
    return u, nil
}
```

Now callers can rely on `if err == nil` as the only check.

---

**Q22: A retry helper wraps every attempted error and returns the chain. Profiles show it's allocating heavily. How do you fix?**

**Answer**: Wrap only on the final error:

```go
// Bad: allocates per attempt
func retry(attempts int, fn func() error) error {
    var err error
    for i := 0; i < attempts; i++ {
        if err = fn(); err == nil { return nil }
        err = fmt.Errorf("attempt %d: %w", i, err) // alloc per iter
    }
    return err
}

// Good: alloc only at the end
func retry(attempts int, fn func() error) error {
    var lastErr error
    for i := 0; i < attempts; i++ {
        if err := fn(); err == nil { return nil } else {
            lastErr = err
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, lastErr)
}
```

---

**Q23: A team discovers `errors.Is` returns false even though they wrapped with `%w`. What might be wrong?**

**Answer**: Common causes:
- Used `%v` or `%s` instead of `%w` — chain is broken.
- Wrapped a value-typed error; comparison fails because each wrap creates a new value.
- Tested against a different sentinel than the one wrapped.
- The "sentinel" is created via `errors.New` per call (not at package level), so each new error is a different value.

Verify:
```go
err1 := errors.New("foo")
err2 := errors.New("foo") // different instance!
fmt.Println(err1 == err2) // false
```

Define sentinels at package level once.

---

**Q24: A function returns `(io.Reader, error)`. Sometimes the reader is non-nil with a non-nil error. Is this OK?**

**Answer**: For some `io.Reader` implementations, this is **acceptable** — the reader contains partial data and the error indicates an issue. Standard library examples include:
- `http.Response.Body`: data may be partially read, error indicates truncation.
- `bufio.Scanner`: contains buffered data + error.

For most APIs, **no** — return nil with the error to enforce the convention. Document the contract clearly either way.

---

## FAQ

**Why doesn't Go have tuples?**

Go's authors chose multiple return values + struct types to cover the use cases tuples solve in other languages, without adding a separate type concept. Multi-result is a calling convention; structs handle the "named pair" case.

---

**Why is `error` an interface instead of a result type?**

Interfaces let any type implement `Error() string`. This composes with arbitrary error hierarchies (sentinel, typed, wrapped) without forcing a single error type.

---

**Should I use named returns?**

For short functions where the names document the meaning, yes. For long functions, the names get lost; explicit returns are clearer. Use sparingly.

---

**Can I assign multi-result to a struct?**

Not directly:
```go
type Pair struct { A, B int }
// p := Pair(divmod(17, 5)) // ERROR
```

Use intermediate variables:
```go
a, b := divmod(17, 5)
p := Pair{A: a, B: b}
```

Or write a constructor:
```go
func divmodPair(x, y int) Pair { a, b := divmod(x, y); return Pair{A: a, B: b} }
```

---

**Is it OK to discard the error with `_`?**

Almost never. Common exceptions:
- The function's error is documented as never occurring (rare).
- You're in test code where the operation is precondition.
- You log it elsewhere.

Always comment WHY you're discarding.

---

**Why does `errors.Join` exist when I can just concatenate strings?**

`errors.Join` preserves the error chain so `errors.Is` and `errors.As` traverse all branches. String concatenation loses type information. For composing multiple distinct errors (e.g., from parallel operations), `errors.Join` is the right choice.

---

**Where do I look to understand my function's actual generated code?**

```bash
go build -gcflags="-S" .              # assembly
go build -gcflags="-m -m" .           # inlining + escape decisions
go test -bench=. -benchmem            # allocation count
go tool pprof cpu.prof                # hot paths
go vet -nilness ./...                 # typed-nil bugs
```
