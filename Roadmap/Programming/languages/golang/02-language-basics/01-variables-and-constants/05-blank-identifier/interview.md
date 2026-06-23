# Go Blank Identifier — Interview Questions

## Table of Contents

1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is the blank identifier in Go and where can it appear?**

**Answer:** The blank identifier is the underscore character `_`. It is a write-only sink — a destination that discards the value assigned to it. Each occurrence is independent; there is no storage and no scope.

Legal positions for `_`:
- LHS of an assignment: `_, err := f()`
- Variable declaration name: `var _ = expr`, `var _ I = (*T)(nil)`
- Range loop index/value: `for _, v := range s`
- Struct field name: `_ [4]byte`
- Function parameter or return name: `func f(_ int) (_ int, err error)`
- Method receiver: `func (_ *T) M()`
- Import name: `import _ "pkg"`

It cannot appear in expressions: `fmt.Println(_)` is a compile error.

---

**Q2: Why can't you read from `_`?**

**Answer:** The blank identifier is special-cased in the Go compiler. It is not a variable — it has no storage, no address, and no entry in any scope. The type checker rejects `_` in expression position with "cannot use _ as value".

The reason is intent: `_` exists to **discard** values, not to **store** them. If you need to read a value, give it a real name. If two parts of the code want to refer to the same value, there must be a binding — and bindings have names.

```go
n, _ := strconv.Atoi("42")
fmt.Println(_) // COMPILE ERROR: cannot use _ as value
```

The compiler does not "remember" the value the second slot received; that value was thrown away.

---

**Q3: Give 3 distinct uses of `_` in Go and explain each.**

**Answer:**

1. **Discarding return values:**
   ```go
   n, _ := strconv.Atoi(s)
   ```
   Many Go functions return `(value, error)` or `(value, ok)`. When you only need part, `_` drops the rest.

2. **Side-effect imports:**
   ```go
   import _ "github.com/lib/pq"
   ```
   The package is loaded and its `init` runs (registering a driver, decoder, or HTTP handler), but no names from the package are bound in the importing file. Without `_`, the compiler would refuse the import as unused.

3. **Compile-time interface assertions:**
   ```go
   var _ io.Reader = (*MyReader)(nil)
   ```
   Forces the compiler to verify that `*MyReader` implements `io.Reader` at compile time. If a method is renamed or removed, this line fails to compile, catching the breakage early.

Other uses: discarding the index in `for _, v := range s`, padding in structs (`_ [56]byte`), unused method receiver (`func (_ *T) M()`).

---

**Q4: What does `import _ "net/http/pprof"` do?**

**Answer:** It loads the `net/http/pprof` package solely for its side effect. The package's `init` function registers HTTP handlers under `/debug/pprof/*` on `http.DefaultServeMux`:

```go
// From net/http/pprof/pprof.go
func init() {
    http.HandleFunc("/debug/pprof/", Index)
    http.HandleFunc("/debug/pprof/cmdline", Cmdline)
    http.HandleFunc("/debug/pprof/profile", Profile)
    http.HandleFunc("/debug/pprof/symbol", Symbol)
    http.HandleFunc("/debug/pprof/trace", Trace)
}
```

Once you start serving the default mux (`http.ListenAndServe(addr, nil)`), the profiling endpoints are accessible. The blank import is essential because:
- Without `_`, the import would fail: "imported and not used".
- With a normal import like `import "net/http/pprof"`, the same problem arises if you do not reference any name.

The package exists primarily to be imported blank.

---

**Q5: Explain `var _ MyInterface = (*MyStruct)(nil)` and when to use it.**

**Answer:** This is the **compile-time interface assertion** pattern. It declares an anonymous variable of type `MyInterface` and assigns the typed nil `(*MyStruct)(nil)` to it. The assignment forces the compiler to verify that `*MyStruct` satisfies `MyInterface`.

If `*MyStruct` is missing a method, the assignment fails to type-check, and the compiler points at this line.

```go
type Beeper interface { Beep() }
type Robot struct{}
func (r *Robot) Beep() {}
var _ Beeper = (*Robot)(nil) // compiles; *Robot satisfies Beeper

type Snail struct{}
var _ Beeper = (*Snail)(nil) // FAILS: *Snail has no method Beep
```

**When to use it:**
- You define a type and want to guarantee it implements a specific interface, even if no test currently uses it as one.
- You want to catch refactoring breakage immediately (renaming a method, changing a signature).
- You publish a library; downstream code may rely on the interface contract; your assertion locks it in.

**Best practice:**
- Place the assertion in the **package that defines the type**, not the consumer.
- Use `(*T)(nil)` instead of `T{}` to avoid running constructors and to make pointer-receiver methods visible.
- Group multiple assertions in a `var (...)` block for readability.

The runtime cost is zero — the line produces no instruction.

---

**Q6: What's the difference between `_` and `nil`?**

**Answer:** They are unrelated:

- `_` is the **blank identifier**: a destination, used on the LHS of assignments and a few declaration positions. It cannot be read or compared.
- `nil` is a **value**: the typed zero of pointers, interfaces, slices, maps, channels, and function types. It is read like any other value.

```go
_ = nil          // legal: discards nil
if x == nil { }  // legal: compares against nil
if x == _ { }    // INVALID: cannot use _ as value
fmt.Println(_)   // INVALID
fmt.Println(nil) // legal: prints "<nil>"
```

Confusing the two is common for beginners because both can mean "absence" in informal speech.

---

**Q7: Can you use `_` to silence the "declared but not used" error?**

**Answer:** Technically yes, but it is almost always a code smell.

```go
x := compute()
_ = x // suppresses the unused-variable error
```

The compiler error exists to catch dead code. Suppressing it with `_ = x` defeats the check. If you intend to keep the call for its side effect, write directly:

```go
_ = compute()
```

If the variable will be used soon, leave the error in place as a TODO marker. If the call really should be removed, remove it. The pattern `_ = x` (where `x` is a previously-declared name) is best avoided.

---

## Middle Level Questions

**Q8: What does `_ = expr` actually do at the IR level?**

**Answer:** The compiler still **evaluates** `expr` for side effects. The result is computed and dropped. Dead-code elimination may remove the computation only if it is provably pure (no side effects).

```go
_ = heavyComputation() // heavyComputation runs; result discarded
_ = 1 + 2              // pure; DCE removes the line
_ = fmt.Println("hi")  // Println runs; returned (n, err) discarded
```

This is why `_ = expensiveCall()` is suspect — the underscore does not mean "skip", it means "ignore the return value". The work happens.

---

**Q9: How does the compiler treat each `_` in `_, _ = a, b`?**

**Answer:** Each `_` is an independent anonymous slot. Neither one introduces a binding into the scope. The compiler:

1. Evaluates the RHS `a, b` (as an n-tuple of values).
2. Matches each LHS slot against a value.
3. For `_` slots, it discards the value (assigns to "no destination").

Crucially, the two `_`s are not the same name. There is no shadowing, no scope, no continuity. You cannot reference either later because there is nothing to reference.

This is why `_ := 1; _ := 2` requires `var _ = 1; var _ = 2` to compile — the short declaration `:=` requires at least one new binding name on the LHS, and `_` does not bind.

---

**Q10: Where should compile-time interface assertions live?**

**Answer:** In the **package that defines the type**, not in the consuming package. The reason is breakage detection:

- Assertion in defining package → CI for that package fails the moment the implementation breaks.
- Assertion in consuming package → CI for the consumer fails only when it next compiles, possibly after the broken library has been published.

```go
// in mylib/reader.go (correct location)
type Reader struct{}
func (r *Reader) Read(p []byte) (int, error) { /* ... */ }
var _ io.Reader = (*Reader)(nil)
```

Putting the same line in `cmd/myapp/main.go` is legal but useless — by the time `main` recompiles, the library is already broken in everyone else's builds.

---

**Q11: When should you NOT use `_`?**

**Answer:**

- To silence `errcheck` on errors that matter (`_ = json.Unmarshal(b, &v)` is a bug).
- To suppress "declared but not used" for a variable you forgot to use.
- For function parameters that you might use later (name them).
- In a library package's blank import that should be the binary's choice (`import _ "github.com/lib/pq"` belongs in `main`).
- As a method receiver when the method actually needs `self`.
- As an attempt to "skip" expensive work (`_ = expensive()` runs `expensive`).

The blank identifier should communicate **intent**: "I considered this value and chose to discard it." Using it to dodge the compiler or linters defeats the design.

---

**Q12: What happens if you have `var _ = registerThing()` at package level?**

**Answer:** Package-level `var _ = expr` evaluates `expr` once during package initialization, in declaration order. The result is discarded. This is a way to run setup code at a precise point in the file's declaration order, equivalent to `init()` but with finer control.

```go
package mypkg

var _ = sql.Register("postgres", &Driver{})
```

This is exactly what `lib/pq` and many other registries do. It is a formal alternative to `func init() { sql.Register(...) }`. Pick whichever reads better; the effect is identical.

---

**Q13: How do you avoid pinning a large struct via a closure?**

**Answer:** Capture only the data you need, not the whole struct:

```go
// Pins big.Buf
func use(b *Big) func() byte { return func() byte { return b.Buf[0] } }

// Pins one byte
func use(b *Big) func() byte { x := b.Buf[0]; return func() byte { return x } }
```

If you do not need the parameter at all, use `_` for the parameter name to make escape analysis aggressive about not extending its lifetime:

```go
func register(_ *Big) func() { return func() {} }
```

The `_` parameter is not bound to any local; the slice header / pointer is not captured.

---

**Q14: What is the difference between `var _ I = T{}` and `var _ I = (*T)(nil)`?**

**Answer:**

- `var _ I = T{}` constructs a zero-valued `T` and asserts that the **value type** `T` satisfies `I`. Only methods with **value receivers** count.
- `var _ I = (*T)(nil)` uses a typed nil pointer to assert that the **pointer type** `*T` satisfies `I`. Methods with **pointer or value receivers** both count (because `*T`'s method set includes both).

Use `(*T)(nil)` when:
- `T` has any pointer-receiver methods that participate in `I`.
- Constructing a zero `T` has side effects or is expensive.
- You want a broader check (pointer type's method set is a superset).

Use `T{}` only when:
- All of `T`'s methods relevant to `I` are value-receiver.
- Constructing `T{}` is trivial and side-effect-free.

In practice, most teams default to `(*T)(nil)`.

---

## Senior Level Questions

**Q15: How does the type checker handle `_` differently from a normal identifier?**

**Answer:** In `go/types` (and `cmd/compile/internal/types2`):

- **Normal identifier:** Resolved to a `*Object` (variable, constant, type, function, package). Bound into a scope. Reachable by name.
- **`_`:** Special-cased. In LHS positions, no `*Object` is created and nothing is added to the scope. In expression positions, the type checker emits "cannot use _ as value".

This means `_` is structurally different from any other identifier: it is recognized syntactically and rejected from the binding pipeline. The spec wording: "The blank identifier may be used as any other identifier in a declaration, but it does not introduce a binding and thus is not declared."

Each `_` is an independent anonymous slot. There is no "the symbol `_`".

---

**Q16: What is the runtime cost of a compile-time interface assertion?**

**Answer:** Zero. The check is performed at compile time:

1. The RHS expression `(*T)(nil)` produces a typed nil pointer.
2. The assignment to a variable of interface type triggers an implicit conversion.
3. The conversion check verifies that `*T`'s method set is a superset of the interface's method set.
4. The result is assigned to `_`, which produces no storage.
5. SSA emits no instruction. The constant `nil` may be elided entirely by DCE.

You can verify with `go tool compile -S` and grep for the surrounding code; you will not see any code for the assertion line.

The compile-time cost is also negligible — a method-set comparison per assertion, completing in microseconds.

---

**Q17: How does a blank import interact with package initialization order?**

**Answer:** Blank imports are no different from normal imports for initialization. The package's `init` functions run when the package is first loaded, in dependency order. The only difference for blank imports is that **no name** from the imported package is bound in the importing file's namespace.

Order rules:
1. Each package's `var` declarations initialize in declaration order, respecting dependencies.
2. After all package-level vars are initialized, `init` functions run.
3. Multiple `init` functions in the same package run in the order they appear in source files (file order is unspecified across files but stable within a file).
4. Importing package's `init` runs after all imported packages' `init` (transitively).

If `pkg A` blank-imports `pkg B`, then `B`'s `init` runs before `A`'s. The blank import does not change this; it is purely about name binding.

---

**Q18: How does Go 1.22's loop-variable change interact with `_`?**

**Answer:** It does not, directly. The Go 1.22 change makes each iteration of a `for` loop produce a fresh copy of the loop variable. This affects closures capturing loop variables. The `_` form does not capture anything (there is nothing to capture), so it is unaffected.

```go
for _, v := range slice {
    go func() { fmt.Println(v) }() // captures v
}
```

In Go 1.22+, each goroutine sees its own `v`. The `_` (discarded index) is irrelevant to the change.

---

**Q19: What does the spec say about the blank identifier's "predeclared" status?**

**Answer:** The Go spec lists `_` among the predeclared identifiers (alongside `nil`, `true`, `false`, etc.). However, its semantics are governed by individual productions and a special clause:

> "The blank identifier may be used as any other identifier in a declaration, but it does not introduce a binding and thus is not declared."

So `_` is "predeclared" in the sense that it is a reserved name with special meaning, but it never creates a symbol. The spec sections on Assignments, Range clauses, Import declarations, and Variable declarations each explicitly mention `_`'s allowed usage in their context.

---

**Q20: How does `_` behave in a generic function?**

**Answer:** Same as in non-generic code. `_` can:

- Discard returns: `n, _ := f[T](x)`
- Be a type parameter name (rare and useless): `func F[_ any]() {}`
- Discard the iteration variable: `for _, v := range s` works inside a generic function with `s []T`.

There is nothing generic-specific about `_`. Type inference operates on the RHS, not the `_` slot.

---

## Scenario-Based Questions

**Q21: Your team's CI fails with "undefined: pq" after a goimports run. What happened?**

**Answer:** A blank import (`_ "github.com/lib/pq"`) was likely removed by `goimports` because the package looked unused. With the import gone, the postgres driver does not register, and `sql.Open("postgres", ...)` fails at runtime. The "undefined: pq" might also indicate code referencing `pq.X` directly, which is rare for blank-import users.

**Recovery:**
1. Restore the blank import.
2. Add a comment so it survives next time: `_ "github.com/lib/pq" // registers postgres driver`.
3. Configure `goimports` (or your IDE) to leave blank imports alone.

---

**Q22: A senior engineer keeps writing `var _ I = (*T)(nil)` in every package. Is this overkill?**

**Answer:** It depends. For:

- **Library types meant to satisfy a specific interface** — yes, always assert. The line is free; the safety is real.
- **Internal helper types** — optional. If tests already exercise the type as the interface, the assertion is redundant.
- **Types that obviously satisfy a rich, well-tested interface** (e.g., your own `MyError` satisfying `error`) — the standard library's `errors` package does not assert, and that is fine.

Most large Go codebases (CockroachDB, Kubernetes, etcd, Prometheus) use the pattern liberally. It is not overkill; it is a low-cost insurance policy. The only argument against is noise.

---

**Q23: Your binary keeps growing every release. You suspect blank imports. How do you investigate?**

**Answer:** Use `go tool nm` and `go build -ldflags="-w -s"` to compare binary sizes with and without specific blank imports.

```bash
go build -o app
ls -lh app

# Remove a suspect blank import, build again
go build -o app2
ls -lh app2

diff -u <(go tool nm app | sort) <(go tool nm app2 | sort)
```

Common culprits:
- `_ "net/http/pprof"` — adds ~200KB.
- `_ "github.com/lib/pq"` — adds ~2MB.
- `_ "image/png"`, `_ "image/jpeg"` — small but additive.

Use build tags to exclude unused drivers:

```go
//go:build pgsql
package main
import _ "github.com/lib/pq"
```

`go build -tags=pgsql` includes; default build excludes.

---

**Q24: A code reviewer says "every `_` is suspicious — explain it." How do you respond?**

**Answer:** A reasonable rule of thumb. Each `_` is a small claim about intent. To answer "why this `_`", you should be able to point to one of:

- "We discard the error because [specific reason]."
- "We use the index but not the value here."
- "This is a side-effect import that registers [driver/decoder/handler]."
- "This is a compile-time assertion that `*T` implements `I`."
- "This struct field reserves space for binary compatibility / cache-line alignment."

If you cannot answer, the `_` probably hides a bug or papers over a refactor opportunity. Add a comment explaining the choice — `_` does not deserve more silence than any other code.

---

**Q25: How do you teach a junior engineer the difference between `_` and a named-but-unused parameter?**

**Answer:** Both compile. The difference is **how loud the intent is**.

```go
func handler(_ context.Context, req Request) Response { /* ignores ctx */ }
func handler(ctx context.Context, req Request) Response { /* also ignores ctx */ }
```

- The `_` form says: "I will never use ctx; this is a deliberate signature constraint."
- The named form says: "ctx is here in case I need it later; I happen not to use it now."

Linters like `revive`'s `unused-parameter` rule prefer `_`. Some teams enable it; others reject it as noise. A consistent codebase is more important than the exact policy.

The teaching example: imagine the function will need `ctx` next sprint. With `_`, you must rename. With `ctx`, you just start using it. For stable APIs (e.g., `http.Handler`), `_` is fine.

---

## FAQ

**Q: Can `_` appear on the right side of an expression?**

No. `_` is write-only. `fmt.Println(_)`, `_ + 1`, `if _ == nil` all fail to compile.

**Q: Is `_` a keyword?**

No, it is a predeclared identifier with special semantics. You can write `var _ = 5`; you cannot reassign the keyword "for".

**Q: Can I shadow `_`?**

No. `_` is not a binding. There is nothing to shadow. Each `_` is a fresh anonymous slot.

**Q: Why does `_ = err` compile but `_ := err` fail?**

`:=` is short variable declaration; it requires at least one new non-blank name on the LHS. `_ = err` is a regular assignment to the blank identifier — no new declaration, perfectly legal.

**Q: Can a blank import affect compilation order?**

Indirectly. The blank-imported package and its transitive dependencies must initialize before the importing package. The order rules are the same as for normal imports.

**Q: Is `_` faster than a real variable?**

The same. The compiler eliminates unused stores in both cases; there is no measurable difference. Pick the form that reads best.

**Q: Can I have multiple `_` in the same struct?**

Yes:

```go
type S struct {
    _ [4]byte
    A int
    _ [4]byte
}
```

Each `_` is an independent anonymous field.

**Q: What happens if I assign to `_` in a loop?**

```go
for i := 0; i < 10; i++ {
    _ = i
}
```

Nothing useful; the compiler likely DCE's the assignment. The loop runs as before.

**Q: Can `_` be exported?**

No. It is not a name; it cannot be capitalized; it is not addressable. The concept does not apply.

**Q: Are there any languages where `_` works the same way?**

Several: Erlang, Elixir, Rust, Scala, OCaml all have analogous "discard" patterns. Go's `_` is closest to OCaml's wildcard pattern.
