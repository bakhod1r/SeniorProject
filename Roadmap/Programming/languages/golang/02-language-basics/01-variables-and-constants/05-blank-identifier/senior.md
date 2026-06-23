# Go Blank Identifier — Senior Level

## 1. Overview

Senior-level mastery of `_` requires understanding how the compiler models it. The blank identifier is **not a variable** in the type-checker's symbol table sense. It is a special-cased syntactic token that the parser recognizes, the type-checker accepts in specific positions, and the SSA backend lowers to "no destination". Each occurrence is a fresh anonymous slot — there is no storage, no escape decision, and no GC root.

This document covers:

- How `cmd/compile/internal/types2` models `_`.
- The legal positions for `_` in the grammar.
- Code generation: why `_ = expr` evaluates `expr`.
- Blank-imports: how `init` triggering interacts with name-table population.
- Compile-time interface assertions at the IR level.
- Subtle interactions with shadowing, name resolution, and the spec.

---

## 2. The Type Checker's View

In `go/types` and the equivalent compiler-internal package `cmd/compile/internal/types2`, identifiers are resolved to `*Object` entries (variables, constants, types, functions, packages). The blank identifier is the exception. The relevant code path:

1. Parser produces `*ast.Ident{Name: "_"}` like any other identifier.
2. The type checker, when resolving an identifier in **expression position**, returns an error if the name is `_`. There is no `*Object` to point to.
3. In **declaration / LHS position**, the type checker accepts `_` and records that this slot is anonymous: it does not enter a binding into the current scope.

The relevant rule in the spec:

> "The blank identifier may be used as any other identifier in a declaration, but it does not introduce a binding and thus is not declared."

So `_ := 5` is parsed and type-checked, but it produces no symbol. Likewise `var _ T = expr` introduces no symbol.

### Implication: each `_` is fresh

```go
_, _ := 1, 2 // legal: two anonymous LHS slots
```

You cannot say "the second `_` shadows the first" because neither was declared. This is why writing `_ := 1; fmt.Println(_)` fails — `_` is never in scope.

---

## 3. Where `_` Is Allowed

The spec defines `_` as one of the predeclared identifiers, but its usage is restricted by individual productions. The legal positions:

### 3.1 LHS of an assignment (regular or short)

```go
_, x = a, b
_, y := f()
```

### 3.2 As a variable name in `var` or `const` declarations

```go
var _ = sideEffectExpr()
const _ = 42 // legal but pointless
```

`var _ = expr` evaluates `expr` at package init time, discarding the result. This is a way to run package-level setup code that does not fit `init` (e.g., a registration that depends on the order of declarations within the file).

### 3.3 As a struct field name

```go
type Aligned struct {
    A uint64
    _ [56]byte // pad to 64 bytes for cache-line alignment
    B uint64
}
```

Anonymous fields named `_` are legal but cannot be referenced. They contribute to size and alignment.

### 3.4 As a method receiver

```go
func (_ *T) M() {}
```

Equivalent to a named-but-unused receiver.

### 3.5 As a function parameter or result name

```go
func ignore(_ int, _ string) {}
func produce() (_ int, err error) { return 0, nil }
```

### 3.6 As a type parameter name (Go 1.18+)

```go
func F[_ any]() {} // very rare; usually meaningless
```

### 3.7 As an import name

```go
import _ "net/http/pprof"
```

This is an **import declaration with the local package name set to `_`**. Spec wording: "An import declaration with PackageName `_` is called a blank import. It causes the imported package's `init` functions to run while making no exported names visible."

### 3.8 NOT allowed: in expressions

```go
fmt.Println(_)         // INVALID
var x = _              // INVALID
_ + 1                  // INVALID (not even a syntactic LHS)
```

The compiler emits "cannot use _ as value" or similar.

---

## 4. Code Generation

### 4.1 `_ = expr` Still Evaluates

The compiler walks `expr` for side effects regardless of the `_` LHS. After type-checking, an assignment to `_` becomes an SSA instruction whose result is unused. The backend's dead-code elimination may drop the result computation **only if it has no side effects**.

```go
_ = expensiveCall() // expensiveCall STILL runs
_ = 1 + 2           // pure expression — DCE removes it
_ = unsafePtr       // not stored; unsafePtr was already in a register
```

This matters: people sometimes use `_ = expr` thinking "the compiler skips it". It does not. Only purity-preserving simplifications happen.

### 4.2 Multiple-Return Discards

```go
n, _ := strconv.Atoi(s)
```

The compiler still has to receive the second return value (because the ABI dictates the return layout). It then drops it. There is no "skip the second return" optimization.

### 4.3 Struct Fields Named `_`

These fields contribute to the struct's `unsafe.Sizeof` and field offset calculations, but the field selector `s._` is not allowed at the source level. At the IR level the field exists in the type descriptor.

```go
type S struct {
    A int
    _ [4]byte // 4 bytes of padding
    B int
}

unsafe.Sizeof(S{}) // includes the 4 padding bytes
```

The compiler may use these for ABI-significant alignment (rare in user code; common in `runtime` for cache-line guards).

### 4.4 Range Discards

`for _, v := range s` lowers to:

```
for i := 0; i < len(s); i++ {
    v := s[i]
    body...
}
```

The "index" path simply does not assign anywhere. There is no anonymous storage for `_` in the lowered loop.

---

## 5. Blank Imports In Detail

A blank import:

```go
import _ "github.com/example/driver"
```

Is parsed into an `*ast.ImportSpec` with `Name: &ast.Ident{Name: "_"}`. The loader still loads the package: it must, because `init` functions and global var initializers run on first use of the package, which happens via the `import` graph regardless of name binding.

What changes:

1. The local package name is set to `_`. There is no `driver.X` accessor in the importing file.
2. The compiler does not emit "imported and not used" because `_`-imported packages are exempt from that rule.
3. All `init` functions in the imported package run at program startup, in dependency order.

The spec is explicit:

> "To import a package solely for its side-effects (initialization), use the blank identifier as explicit package name: `import _ "lib/math"`."

Effect on link-time behavior: the package's symbols (including its `init`) are linked into the binary. Dead-code elimination at link time does not remove an `init` function — it must run.

---

## 6. Compile-Time Interface Assertions: IR

Consider:

```go
var _ io.Reader = (*MyReader)(nil)
```

The compiler:

1. Parses the declaration; sees the LHS is `_`.
2. Type-checks: the RHS has type `*MyReader`. The declared type on the LHS is `io.Reader` (an interface). The compiler must compute the implicit conversion `*MyReader → io.Reader`.
3. To compute the conversion, it verifies `*MyReader` has all methods in `io.Reader`'s method set. If not, **compile error at this line**.
4. If the check passes, the conversion is valid. The result is assigned to `_`, which means the value is never stored. SSA emits no instruction for the assignment itself.

The cost at runtime: zero. The check happens at compile time.

For `var _ Iface = MyValue{}` where `MyValue{}` requires construction, the compiler emits the constructor — but if it has no side effects, DCE removes it. Practically, the construction might still run for zero-value structs because SSA cannot always prove the constructor has no side effects (it usually can for a literal).

The `(*T)(nil)` form is preferred because:

- No constructor cost at all.
- Works even when `T` is not zero-initializable (e.g., requires invariants).
- Reads as "type-only check".

---

## 7. Subtle Interactions

### 7.1 `_` Cannot Be Shadowed

You cannot write `_ := 1; { _ := 2; ... }` and have anything meaningful happen — both `_`s are independent anonymous slots, not nested bindings. There is no "outer `_`" to shadow.

### 7.2 `_` Is Not in Any Scope

Identifier resolution: when the compiler sees `_` in expression position, it does not look up `_` in any scope; it immediately emits "cannot use _ as value". So `_` does not interact with any scoping rules — no shadowing, no closure capture.

### 7.3 Blank `var` at Package Level Is Ordered

```go
var _ = registerThing("foo")
var _ = registerThing("bar")
```

These are evaluated in the order their declarations appear in the file (after dependency resolution). They are equivalent to two `init` statements but bound to the file-level declaration list. Useful when you want a registration to happen at a precise point relative to other vars.

### 7.4 Blank Identifier in Generics

```go
func Apply[_ comparable, V any](v V) V { return v }
```

Allowed but pointless — you cannot reference the type. You would only do this if a constraint solver requires the parameter and you do not name it. In practice, name it `T` and ignore.

### 7.5 Blank Identifier in `select`

```go
select {
case _, ok := <-ch:
    if !ok { return }
case <-time.After(time.Second):
    return
}
```

You can `_` the value from a channel receive while keeping the `ok`. If you only want `ok`, that is the pattern. If you want neither value nor `ok`, write `case <-ch:` with no LHS.

### 7.6 Blank Identifier as a Type Switch Variable

```go
switch v.(type) {
case int:
    // ...
}
```

`v.(type)` does not bind a new variable; it just dispatches on type. The form `switch x := v.(type)` does bind `x`. There is no `switch _ := v.(type)` pattern needed; the `v.(type)` form already discards.

---

## 8. Performance Notes

The blank identifier itself has zero runtime cost. There is no allocation, no instruction, nothing.

What does cost: the **expression on the right side**. A novice optimization mistake is writing `_ = heavyComputation()` to "skip" the computation. The computation runs at full speed.

For interface assertions: zero runtime cost. The check is purely at compile time.

For blank imports: the imported package is loaded and its `init` runs. Cost depends on what `init` does. For `database/sql` drivers and `image` decoders, it is trivial — registering a few function pointers. For `net/http/pprof`, slightly more — registering a handful of HTTP handlers.

---

## 9. Edge Cases the Type Checker Handles

### 9.1 Mismatched assertion

```go
type X struct{}
var _ fmt.Stringer = X{} // fails: X has no String() method
```

Error: `cannot use X{} (untyped value) as fmt.Stringer value: missing method String`.

### 9.2 Value-vs-pointer mismatch

```go
type Y struct{}
func (y *Y) String() string { return "y" }
var _ fmt.Stringer = Y{} // fails: only *Y implements Stringer
```

Error: `cannot use Y{} as fmt.Stringer: missing method String (String has pointer receiver)`.

### 9.3 Generic interface

```go
type Container[T any] interface {
    Get() T
}

type MyBox struct{ v int }
func (b *MyBox) Get() int { return b.v }

var _ Container[int] = (*MyBox)(nil) // OK
var _ Container[string] = (*MyBox)(nil) // ERROR: Get returns int, not string
```

The check is parameterized correctly.

### 9.4 Embedded interface

```go
type ReadCloser interface {
    io.Reader
    io.Closer
}
var _ ReadCloser = (*MyType)(nil)
```

Checks both embedded methods.

---

## 10. Heuristics for Senior Reviewers

When reviewing code, ask:

1. **Why this `_`?** A senior author can explain every blank in a PR. If they cannot, the `_` probably hides a bug.
2. **Could `_ = expr` be removed entirely?** If `expr` has no side effects, yes — and removing it makes intent clearer. If it does have side effects, the assignment to `_` is a code smell unless commented.
3. **Is this assertion in the right place?** Compile-time interface assertions belong in the package that **defines the type**. Putting them in the consuming package is unusual and signals a missing layer.
4. **Is the blank import the canonical way to get this side effect?** Drivers, decoders, pprof — yes. For your own packages, exposing an explicit `Register()` function is usually cleaner than relying on `init`.

---

## 11. Summary

- `_` is special-cased in the type checker; it is not a variable.
- It produces no binding, has no scope, and cannot be read.
- `_ = expr` evaluates `expr` for side effects; the compiler does not skip the expression.
- Blank imports trigger `init` while exposing no names.
- Compile-time interface assertions cost zero at runtime and catch refactoring mistakes early.
- Multiple `_`s in the same statement are independent; there is no continuity across them.

This special status is what makes `_` so useful — and so easy to misuse. Senior authors treat every `_` as a small claim about intent that the team can verify at review time.

---

## 12. Compiler IR Walk-Through

For the line:

```go
n, _ := strconv.Atoi("42")
```

The compiler proceeds roughly as follows:

1. **Parse:** produces an `*ast.AssignStmt` with `Lhs: [Ident{n}, Ident{_}]`, `Rhs: [CallExpr{strconv.Atoi("42")}]`, `Tok: :=`.
2. **Type check:**
   - Resolve `strconv.Atoi`. Its signature is `func(string) (int, error)`.
   - The call expression has tuple type `(int, error)`.
   - The LHS has 2 slots: `n` (new) and `_` (anonymous).
   - Add `n: int` to the local scope. Skip `_`.
3. **SSA build:**
   - Emit the call: `result := CALL strconv.Atoi("42")`.
   - Extract the first component: `n_value := result.0`.
   - Discard the second component (no instruction needed).
   - Emit `STORE n, n_value` for the local `n`.

Compare with the same code using a real name:

```go
n, err := strconv.Atoi("42")
_ = err
```

Steps 1-3 are similar, but the compiler creates an `err` binding, emits a `STORE err, err_value`, then later sees `_ = err` and emits a `LOAD err` followed by a discard. SSA's DCE pass eliminates both the load and the store because nothing else reads `err`.

End result: identical machine code in both cases.

---

## 13. Spec Excerpts and Their Implications

The Go spec is brief on `_`. Three key passages and their implications:

### Passage 1
> "The blank identifier may be used as any other identifier in a declaration, but it does not introduce a binding and thus is not declared."

**Implication:** `_` participates in declarations syntactically, but no scope entry is made. The compiler recognizes it specifically and routes around the binding pipeline.

### Passage 2 (Import Declarations)
> "To import a package solely for its side-effects (initialization), use the blank identifier as explicit package name: `import _ "lib/math"`."

**Implication:** Blank imports are first-class; the compiler treats them as legitimate, not as a workaround.

### Passage 3 (Assignments)
> "The blank identifier provides a way to ignore right-hand side values in an assignment."

**Implication:** Discarding values is the primary intent. The spec does not enumerate "tricks"; the underscore is plainly a discard mechanism.

---

## 14. Tooling Surface

### 14.1 `go vet`

`go vet` does not specifically warn about `_`. It would warn about unreachable code, unused struct tags, etc., but `_` itself is never flagged.

### 14.2 `staticcheck`

The `SA4006` check (assignment to unused variable) does not fire on `_` because `_` is anonymous; there is no "previous value" to be replaced.

The `SA1019` check (use of deprecated symbols) is unaffected by `_`.

### 14.3 `errcheck`

`errcheck` is the linter most directly relevant. It flags discarded errors, including:

```go
_, _ = f() // flagged if f returns error
_ = f()    // flagged if f returns error
```

Configure via `.errcheck-excludes` to whitelist functions whose errors are commonly discarded (e.g., `fmt.Println`).

### 14.4 `golangci-lint`

A typical config enables `errcheck`, `unused`, `staticcheck`, `gosimple`. None of these specifically forbid `_`; they enforce semantics around it.

### 14.5 `revive`

The `unused-parameter` rule suggests `_` for unused parameters. The `early-return` and `unused-receiver` rules may interact with `_` patterns. None directly forbid the blank identifier.

---

## 15. Comparison with Other Languages

| Language | Equivalent | Notes |
|----------|-----------|-------|
| Go | `_` | Write-only; no binding; predeclared |
| Rust | `_` | Wildcard pattern; cannot be read |
| OCaml | `_` | Wildcard pattern; matches anything; no binding |
| Haskell | `_` | Wildcard pattern; in matches and `let`s |
| Scala | `_` | Underscore has many meanings; one is wildcard |
| Erlang | `_` | Don't-care variable; convention is `_Name` to suppress warnings |
| Elixir | `_` | Same as Erlang heritage |
| Python | `_` | Convention only; reads/writes `_` are normal |
| JavaScript | `_` | No special meaning; convention via lodash etc. |

Go's `_` is closest to OCaml's: a true language feature with a clear "no binding" semantics.

---

## 16. Closing Notes

Senior-level mastery of the blank identifier means:

- Recognizing every legal position (LHS, var/const, range, struct field, parameter, receiver, import, type parameter).
- Knowing the compiler's special-case handling (no symbol, no scope, no DCE issues).
- Understanding that RHS expressions still evaluate.
- Treating compile-time interface assertions as a low-cost insurance pattern.
- Choosing `(*T)(nil)` over `T{}` for assertions by default.
- Distinguishing legitimate discards from anti-patterns.
- Defending against tooling that mistakes side-effect imports for unused.

In review, ask of every `_`: "Why is this discarded? What invariant does this assertion enforce? What side effect does this import trigger?" If the author cannot answer in one sentence, the code probably hides a bug or papers over a refactor.

The blank identifier is one of Go's smallest features and one of its most idiomatically loaded. Use it deliberately.
