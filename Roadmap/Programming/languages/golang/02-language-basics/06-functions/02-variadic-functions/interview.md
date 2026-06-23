# Go Variadic Functions — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: How do you declare a variadic function in Go?**

**Answer**: Add `...` before the type of the **last** parameter:

```go
func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}
```

Inside the function, `nums` is a `[]int`. You can call:
- `sum()` — zero args, `nums == nil`
- `sum(1)` — one arg
- `sum(1, 2, 3)` — three args

---

**Q2: Can a variadic parameter appear anywhere in the parameter list?**

**Answer**: No. It must be the **last** parameter. Compile error otherwise:

```go
// func bad(rest ...int, last string) {} // compile error: can only use ... with final parameter
func ok(first string, rest ...int) {}     // OK
```

---

**Q3: What happens if you call a variadic function with no arguments?**

**Answer**: The variadic parameter is the **zero value** of its slice type, which is `nil`. `len(nil) == 0`, ranging over nil is a no-op, no panic.

```go
func describe(args ...int) {
    fmt.Println(args == nil, len(args)) // true 0
}
describe()
```

---

**Q4: How do you pass an existing slice to a variadic function?**

**Answer**: Use the **spread operator** `...` at the call site:

```go
nums := []int{1, 2, 3}
sum(nums...) // equivalent to sum(1, 2, 3)
// sum(nums) // compile error: cannot use []int as int
```

Note: the spread `...` at the call site is a different feature from the `...T` in the declaration, but they look similar.

---

**Q5: What does `fmt.Println(...interface{})` mean? How is it variadic?**

**Answer**: `fmt.Println` is declared as:

```go
func Println(a ...interface{}) (n int, err error)
// Or in Go 1.18+:
func Println(a ...any) (n int, err error)
```

The `...interface{}` (or `...any`) means "any number of values of any type." Each argument is **boxed** into an interface value, which is why `fmt.*` family is convenient but allocation-heavy.

---

**Q6: Can you mix individual arguments with the spread operator at one call site?**

**Answer**: **No**. You must choose one form per call:

```go
nums := []int{2, 3, 4}
// sum(1, nums...) // compile error
sum(1, 2, 3, 4)         // all individual
sum(append([]int{1}, nums...)...) // build a combined slice first
```

---

**Q7: What's the difference between these two calls?**

```go
func describe(args ...int) { fmt.Println(len(args), args) }

s := []int{1, 2, 3}
describe(s)     // ?
describe(s...)  // ?
```

**Answer**:
- `describe(s)` is a **compile error** because `s` is `[]int` and the function expects `int` (variadic of int).
- `describe(s...)` works: `args == s` (same backing array). Output: `3 [1 2 3]`.

If the parameter were `...any`, then:
- `describe(s)` would compile and print `1 [[1 2 3]]` (one arg, which is the slice).
- `describe(s...)` would NOT compile because `[]int` is not `[]any`.

---

## Middle Level Questions

**Q8: Does spreading a slice (`f(s...)`) make a copy?**

**Answer**: **No**. Spread shares the same backing array:

```go
func zero(xs ...int) {
    for i := range xs {
        xs[i] = 0
    }
}

s := []int{1, 2, 3}
zero(s...)
fmt.Println(s) // [0 0 0] — caller's slice was zeroed
```

To isolate caller from callee mutations, defensively copy:

```go
func zero(xs ...int) {
    xs = append([]int(nil), xs...) // local copy
    for i := range xs {
        xs[i] = 0
    }
}
```

---

**Q9: What's the difference between `f(args)` and `f(args...)` when forwarding a variadic?**

**Answer**:

```go
func inner(args ...any) { fmt.Println(args) }

func wrong(args ...any) { inner(args) }    // passes []any as ONE arg
func right(args ...any) { inner(args...) } // forwards each element

right("a", "b", "c") // inner sees 3 args
wrong("a", "b", "c") // inner sees 1 arg: [a b c]
```

This is the most common variadic bug. Always spread when forwarding.

---

**Q10: Why is `...any` slow?**

**Answer**: Each argument to a `...any` parameter is **boxed** into an interface value:
- For a non-pointer type like `int`, boxing requires packing the value with a type descriptor word, which may allocate (~16 bytes per arg).
- For a pointer type, boxing is essentially free.

A single `fmt.Printf("%d %s", 42, "hi")` typically allocates:
- 1 implicit `[]any{}` slice (often stack-allocated).
- 1 boxed `int` (or 0 if 42 is in `runtime.staticuint64s`, which covers 0..255).
- 1 boxed `string`.

For high-frequency calls, structured logging libraries like `zap` use typed `Field` constructors instead of `...any` to avoid this.

---

**Q11: How do you concatenate two slices using a variadic function?**

**Answer**: Use `append` with spread:

```go
a := []int{1, 2, 3}
b := []int{4, 5, 6}
c := append(a, b...) // [1 2 3 4 5 6]
```

`append(s, vs ...T)` is itself a variadic function. The spread `b...` passes each element of `b` as a variadic arg.

---

**Q12: What is `errors.Join(errs ...error)` and how does it use variadics?**

**Answer**: Since Go 1.20, `errors.Join` combines multiple errors into a single error value:

```go
err := errors.Join(err1, err2, err3)
// err.Error() = "error1\nerror2\nerror3"
// errors.Is(err, err1) == true
```

It's variadic in `error`. nil errors are filtered out. If all args are nil (or none provided), returns nil. The result implements `Unwrap() []error` so `errors.Is`/`errors.As` traverse all branches.

---

**Q13: Can a method be variadic?**

**Answer**: Yes, in its **parameter list** (not its receiver list):

```go
type T struct{}
func (t T) Add(xs ...int) int { /* ... */ return 0 }
// func (t ...T) Bad() {} // compile error
```

Method values and method expressions work normally with variadic methods.

---

**Q14: Can generics be variadic?**

**Answer**: Yes, since Go 1.18:

```go
func Sum[T int | float64](xs ...T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

Sum(1, 2, 3)         // T=int, returns 6
Sum(1.5, 2.5)        // T=float64, returns 4.0
```

Calling with no args requires explicit type parameter: `Sum[int]()`.

---

**Q15: How do `append` and `copy` differ when used with variadic-style spread?**

**Answer**:
- `append(dst, vs...)` adds elements to dst, may reallocate.
- `copy(dst, src)` copies up to `min(len(dst), len(src))` elements; no spread because `copy` is not variadic.

```go
src := []int{1, 2, 3, 4}
dst := make([]int, 3)
copy(dst, src)  // dst = [1 2 3], 4 dropped
combined := append([]int{}, src...) // independent copy of src
```

---

## Senior Level Questions

**Q16: When does the implicit slice for a variadic call go on the heap?**

**Answer**: The compiler decides via **escape analysis**:
- If the called function does not retain the slice past its return → stack-allocated (zero alloc).
- If the slice escapes (stored to global, sent on channel, captured by escaping closure) → heap.

Verify:
```bash
go build -gcflags="-m=2"
# look for "[]int{...} does not escape" or "escapes to heap"
```

For most short-lived calls (`fmt.Println(1, 2)`), the slice typically escapes because `fmt` keeps it briefly through `pp` formatting state. For pure-leaf functions like a typed `sum(...int)`, it stays on the stack.

---

**Q17: How do you avoid the per-arg boxing of `...any` in a hot path?**

**Answer**: Two main approaches:

1. **Typed variadics** with concrete types:
   ```go
   type Field struct { K string; Int int; Str string; Type fieldType }
   func log(msg string, fs ...Field) {}
   ```

2. **Generics** (Go 1.18+):
   ```go
   func PrintAll[T any](xs ...T) { for _, x := range xs { fmt.Println(x) } }
   ```

Both eliminate boxing in the variadic path. `zap` and `zerolog` use the typed-Field approach in production.

---

**Q18: A variadic API takes `f(items ...Item)` and stores them. What's the bug?**

**Answer**: If the function stores the slice directly (`s.items = items`), it **aliases the caller's backing array**. Subsequent mutations by the caller corrupt the stored data.

**Fix** — defensive copy:
```go
func (s *S) Set(items ...Item) {
    s.items = append([]Item(nil), items...) // independent backing array
}
```

This is especially critical when the variadic is spread (`s.Set(slice...)`).

---

**Q19: Can you call a variadic function via reflection?**

**Answer**: Yes, two ways:

```go
v := reflect.ValueOf(sum)

// Like literal call: pass each value separately
v.Call([]reflect.Value{
    reflect.ValueOf(1), reflect.ValueOf(2), reflect.ValueOf(3),
})

// Like spread: pass the slice as the variadic
v.CallSlice([]reflect.Value{
    reflect.ValueOf([]int{1, 2, 3}),
})
```

`Call` matches `f(1, 2, 3)`; `CallSlice` matches `f(slice...)`.

---

**Q20: Why can't you call a variadic C function (like `printf`) directly from Go via CGO?**

**Answer**: CGO does not support variadic C functions. The call ABI for variadic C functions is platform-specific and complex (e.g., on x86-64 Linux, callers must set `%al` to the count of XMM args used). Go's CGO does not implement this.

**Workaround**: Write a non-variadic C wrapper for each shape you need:
```c
int print_int(const char *fmt, int v) { return printf(fmt, v); }
```

Then call `C.print_int` from Go.

---

**Q21: What is the cost difference between literal-args and spread for variadic?**

**Answer**:

```
sum(1, 2, 3)       — implicit slice built (often stack-allocated)
                     ~2-5 ns per call overhead vs direct
sum(s...)          — slice header passed; ~0 overhead
sum(big...)        — same; size of backing array doesn't matter for the call itself
```

The literal form has higher per-call overhead because the compiler must construct a slice. The spread form is essentially a slice-header pass.

---

**Q22: Explain why `slices.Concat` exists and how it differs from a loop with append.**

**Answer**: `slices.Concat[S ~[]E, E any](slices ...S) S` (Go 1.21+) joins multiple slices into one, with a single allocation. Naive code:

```go
var out []int
for _, s := range groups {
    out = append(out, s...)
}
```

This re-allocates `out` ~log2(N) times via append's amortized growth. `slices.Concat` does:

```go
n := 0
for _, s := range groups {
    n += len(s)
}
out := make([]int, 0, n)
for _, s := range groups {
    out = append(out, s...)
}
```

One allocation. ~2-3× faster. Use it whenever you concatenate a known set of slices.

---

**Q23: What can you change about a public variadic API without breaking callers?**

**Answer**: Very little. You can:
- **Rename** the variadic parameter (only the name, not the type).
- **Add documentation**.

You CANNOT:
- Change `...T` to `[]T` (breaks literal-arg call sites).
- Change `[]T` to `...T` (breaks `f(slice)` call sites; they'd need `f(slice...)`).
- Change element type from `T1` to `T2`.
- Add a new parameter before the variadic.
- Remove the variadic.

Once shipped in a public package, the variadic shape is locked for the life of that major version. Add a new function (`FooV2`) instead of evolving in place.

---

## Scenario-Based Questions

**Q24: Your structured logger uses `func Info(msg string, args ...any)`. Profiling shows 8% CPU in `runtime.convT64`. How do you fix it?**

**Answer**: That's per-int boxing. Options:

1. **Replace `...any` with typed Field**:
   ```go
   func Info(msg string, fs ...Field) {}
   func String(k, v string) Field { ... }
   func Int(k string, v int) Field { ... }

   log.Info("login", log.String("user", "ada"), log.Int("attempts", 3))
   ```
2. **Migrate to `slog`** (Go 1.21+):
   ```go
   slog.Info("login", "user", "ada", "attempts", 3)
   // slog.Info("login", slog.String("user", "ada"), slog.Int("attempts", 3))
   ```
3. **Use `zap` or `zerolog`**: both have zero-allocation paths for typical fields.

Keep `...any` only for low-frequency `Errorf`-style messages.

---

**Q25: You have a `func process(events ...Event)` that hands `events` to a goroutine for batching. Tests pass; production has data corruption. What's the bug?**

**Answer**: When called with `process(slice...)`, the goroutine sees the caller's backing array. The producer reuses the slice (`slice = slice[:0]; slice = append(slice, ...)`) — the goroutine reads corrupted data.

**Fix** — defensive copy at the boundary:
```go
func process(events ...Event) {
    snapshot := append([]Event(nil), events...)
    go batch(snapshot...)
}
```

Run with `go test -race` to catch this in CI.

---

**Q26: A library exposes `func Init(plugins ...Plugin)`. The author wants to add a `bool verbose` flag without breaking callers. How?**

**Answer**: Cannot add a parameter before the variadic without breaking call sites. Options:

1. **Add an option-style variadic plugin** (`PluginVerbose(true)`):
   ```go
   func Init(plugins ...Plugin) {}
   ```
   Add a `Plugin` implementation that toggles verbose.

2. **Add a new function** with the new shape:
   ```go
   func InitWithOpts(verbose bool, plugins ...Plugin) {}
   // Init unchanged for backward compatibility
   ```

3. **Add a `SetVerbose(bool)` package-level function** to be called before `Init`.

The first option is most idiomatic in Go.

---

**Q27: A hot benchmark shows `sum(1, 2, 3, 4, 5)` is 5× slower than `sum5(1,2,3,4,5)`. How do you decide whether to specialize?**

**Answer**: Measure first:
- If the call rate is < ~1M/s, the difference doesn't matter — keep the variadic.
- If the call site has a known fixed arity (always 5 args), and it's in a hot loop (>10M/s), provide a specialized version:
  ```go
  func sum5(a, b, c, d, e int) int { return a+b+c+d+e }
  ```
- If most calls are variable-arity but a few are fixed, you can still call `sum(...)` from `sum5`:
  ```go
  func sum5(a, b, c, d, e int) int { return sum(a, b, c, d, e) }
  ```
  Inlining will collapse the difference.

In production, usually the answer is "leave the variadic unless profiles show it matters." Premature specialization adds maintenance burden.

---

## FAQ

**Why doesn't Go let me mix literal args with spread (`f(1, s...)`)?**

The spec is intentionally strict: each call uses one form or the other. Mixing would create ambiguity around which argument goes to which parameter when types overlap. The workaround — `f(append([]T{1}, s...)...)` — is verbose but explicit.

---

**Why do I need `args...` when forwarding?**

Because `args` is a `[]T` value. Passing `args` to a `...T` parameter wraps it into a NEW one-element slice (`[][]T{args}`). The spread `args...` flattens it.

---

**Should I always defensively copy a variadic in my function?**

Only when you store or mutate the slice. If you only read and the function is short-lived, the spread alias is fine.

---

**Why does Go have `slices.Concat` if `append` already handles concatenation?**

`slices.Concat` pre-allocates capacity for all inputs combined, avoiding `append`'s repeated reallocation. It's a small but consistent performance win for multi-slice concatenation.

---

**Can I have an empty variadic without it being `nil`?**

The implicit slice for `f()` is `nil`. There's no way to call with an empty non-nil slice using literal form — you must spread an empty non-nil slice: `f([]int{}...)`.

---

**How does `errors.Join` handle nil arguments?**

`errors.Join(nil)` returns `nil`. `errors.Join(nil, err)` returns just `err` (not wrapped). If all args are nil or none provided, returns nil. This makes it safe to call without pre-filtering.

---

**Is `len(args) == 0` the right check for "no args"?**

Yes. Whether the slice is nil or empty doesn't matter — both have `len() == 0`. Don't compare to `nil` directly:

```go
if args == nil { /* misses the empty-but-non-nil case */ }
if len(args) == 0 { /* covers both */ }
```

---

**Where do I learn what the compiler did with my variadic call?**

```bash
go build -gcflags="-m=2"        # escape decisions; look for "implicit slice"
go build -gcflags="-S"          # see the implicit array build in assembly
go build -gcflags="-m -m"       # inlining decisions
go test -bench=. -benchmem      # measure allocations
```
