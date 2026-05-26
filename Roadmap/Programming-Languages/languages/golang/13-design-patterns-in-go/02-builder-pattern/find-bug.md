# Builder Pattern — Find the Bug

A collection of realistic, broken builder snippets. Each one looks correct at a glance and has shipped to production somewhere. For each: the symptom, the cause traced to a rule from `junior.md` or `middle.md`, and the fix. Read them in order — by the end you should spot every shape in a PR before it lands.

---

## Bug 1: The naked `return`

```go
package server

import "time"

type Server struct {
    addr         string
    readTimeout  time.Duration
    writeTimeout time.Duration
}

type Builder struct {
    addr         string
    readTimeout  time.Duration
    writeTimeout time.Duration
    err          error
}

func NewServerBuilder() *Builder { return &Builder{} }

func (b *Builder) Addr(a string) *Builder {
    if b.err != nil {
        return b
    }
    if a == "" {
        b.err = errors.New("Addr: empty")
        return
    }
    b.addr = a
    return b
}
```

**Question.** This file doesn't compile. What's the bug, and what is the dangerous "fix" a hurried developer reaches for first?

<details><summary>Answer</summary>

**Bug.** The error branch in `Addr` writes `return` with no value, but the function signature says `*Builder`. Compile error: `not enough return values`.

The dangerous fix: changing the error branch to `return nil`. Now the file compiles, but every chained call after a bad `Addr` panics with a nil pointer dereference:

```go
b := NewServerBuilder().Addr("").ReadTimeout(5*time.Second)
//                              ^^ Addr returned nil; next call panics
```

**Why it's there.** Muscle memory from non-builder code where `return` after setting an error field is normal. In a builder, every step must return `b` — even on the error path. That's how the deferred-error pattern works (`junior.md` §7.1): the *next* step sees `b.err != nil` and short-circuits.

**How to spot in review.** Search for `return` (without a value) inside any method that declares a `*Builder` return type. Better: any method on a builder with a body longer than one `return b` line, scan every branch for a `return` keyword and confirm each one returns `b`.

**Fix.**

```go
func (b *Builder) Addr(a string) *Builder {
    if b.err != nil {
        return b
    }
    if a == "" {
        b.err = errors.New("Addr: empty")
        return b   // <-- still return the builder
    }
    b.addr = a
    return b
}
```

**Why it's common.** The deferred-error pattern is unintuitive on first read. Newcomers expect a step that "failed" to do something different from a step that "succeeded". In this pattern, both look identical from the outside — only `b.err` differs. The discipline is: every path returns `b`, every method.
</details>

---

## Bug 2: Pointer receiver, value return

```go
type Builder struct {
    addr        string
    readTimeout time.Duration
    err         error
}

func NewBuilder() *Builder { return &Builder{} }

func (b *Builder) Addr(a string) Builder {
    b.addr = a
    return *b
}

func (b *Builder) ReadTimeout(d time.Duration) Builder {
    b.readTimeout = d
    return *b
}

func (b *Builder) Build() (*Server, error) {
    return &Server{addr: b.addr, readTimeout: b.readTimeout}, nil
}
```

**Question.** A caller writes the chain below. What does the assembled `Server` see?

```go
srv, _ := NewBuilder().Addr(":8080").ReadTimeout(5 * time.Second).Build()
```

<details><summary>Answer</summary>

**Bug.** The chain returns *values* (`Builder`, not `*Builder`), but `Build()` is defined on `*Builder`. The chained value is *addressable* in this exact call expression, so Go silently auto-addresses it for the `Build()` call — but `Build()` reads the temporary's fields, not the original `&Builder{}`'s.

Specifically: `Addr` mutates `*b` (the original heap builder), then returns a *copy* (`*b`). `ReadTimeout` is called on the copy's address — a *new* `*Builder` pointing at the copy's storage. The copy now has both `addr` and `readTimeout` set; `Build()` reads them and produces a correct-looking `*Server`.

So far so harmless. The bug detonates when the caller stores an intermediate:

```go
b := NewBuilder()
b1 := b.Addr(":8080")        // b1 is a Builder VALUE; b's addr was set, but b1 is a separate copy
b2 := b1.ReadTimeout(5*time.Second)  // operates on &b1 (a local), mutates it
srv, _ := b2.Build()          // sees both fields by luck
fmt.Println(b.addr)           // ":8080" — got set
fmt.Println(b.readTimeout)    // 0       — never got set! ReadTimeout went to b1.
```

The original builder `b` is half-configured. Reusing it (e.g., for a second `Build`) produces a wrong server.

**Why it's there.** From `junior.md` §6.2 and §12 Q1: returning `Builder` from a `*Builder` method silently changes the semantics. The chain looks identical at the call site; the bug only shows up when the caller saves an intermediate.

**How to spot in review.** Mismatch between method-receiver type and return type. `func (b *Builder) X(...) Builder` is the smell. Either both pointer or both value, never a mix.

**Fix.**

```go
func (b *Builder) Addr(a string) *Builder {
    b.addr = a
    return b
}

func (b *Builder) ReadTimeout(d time.Duration) *Builder {
    b.readTimeout = d
    return b
}
```

If the design genuinely wants value semantics for forkable builders (`junior.md` §5.2), use value receivers throughout:

```go
func (b Builder) Addr(a string) Builder         { b.addr = a; return b }
func (b Builder) ReadTimeout(d time.Duration) Builder { b.readTimeout = d; return b }
```

**Why it's common.** "Returning a value seems safer than returning a pointer" is a half-remembered rule from other contexts. In builders, the receiver and return must agree.
</details>

---

## Bug 3: The shallow `Clone()`

```go
type Builder struct {
    table   string
    columns []string
    wheres  []string
    args    []any
    err     error
}

func (b *Builder) Clone() *Builder {
    c := *b
    return &c
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}
```

**Question.** A test writes:

```go
base := Select("id").From("users").Where("active = ?", true)
prod := base.Clone().Where("region = ?", "us")
test := base.Clone().Where("region = ?", "eu")
prodSQL, _, _ := prod.Build()
testSQL, _, _ := test.Build()
```

What are `prodSQL` and `testSQL`? (Assume the underlying slice had enough capacity.)

<details><summary>Answer</summary>

**Bug.** Both queries end with the *same* second condition — whichever was appended last. If `prod` was built first, both queries look like `... WHERE active = ? AND region = ? AND region = ?` with the last region value being `"eu"`. If `test` was built first, same shape but with `"us"`.

**Why it's there.** `c := *b` is a shallow copy. `c.wheres` and `b.wheres` share the same backing array. If the array had spare capacity, `append` writes into the *same* memory cell for both clones. The second `Where` overwrites the first.

If the array had no spare capacity, the first append allocates a new backing array for one clone, and the second append modifies a different array for the other — and you don't see the bug. Some test runs pass; some fail. The behaviour depends on `cap(b.wheres)`, which is invisible to the reader.

From `middle.md` §4.2 and §13.1: shallow copy of a struct copies slice *headers*, not the underlying arrays. Two clones own pointers to the same memory.

**How to spot in review.** Any `Clone()` method whose body is `c := *b; return &c` is wrong if the struct has any slice, map, or pointer-to-mutable field. Audit each field; for every reference-typed one, copy explicitly.

**Fix.**

```go
func (b *Builder) Clone() *Builder {
    c := *b
    c.columns = append([]string(nil), b.columns...)
    c.wheres  = append([]string(nil), b.wheres...)
    c.args    = append([]any(nil),    b.args...)
    return &c
}
```

`append([]string(nil), src...)` produces a fresh slice with its own backing array, regardless of `cap(src)`. Now mutations on either clone are isolated.

**Why it's common.** "Shallow copy is enough for most types" is a half-truth that works for primitives and pointers-you-mean-to-share, and explodes for slices/maps. The discipline is: every `Clone()` enumerates the struct's reference-typed fields and copies them. No exceptions.
</details>

---

## Bug 4: Receiver shadowing

```go
type Builder struct {
    addr string
    err  error
}

func (b *Builder) Addr(a string) *Builder {
    if b.err != nil { return b }
    b := *b                     // (!)
    b.addr = a
    return &b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    return &Server{addr: b.addr}, nil
}
```

**Question.** A caller writes the obvious chain. Does it work?

```go
srv, _ := (&Builder{}).Addr(":8080").Build()
fmt.Println(srv.addr)
```

<details><summary>Answer</summary>

**Bug.** This particular chain happens to print `":8080"`. The bug bites when the caller saves an intermediate or chains across multiple steps:

```go
b := &Builder{}
b1 := b.Addr(":8080")
fmt.Println(b.addr)  // ""  — original is untouched
fmt.Println(b1.addr) // ":8080" — went to the local copy
```

The line `b := *b` declares a *new local variable* named `b`, initialised from the receiver's pointee. Subsequent assignments touch the local, not the original. `return &b` returns the address of the local. The original `*Builder` (the one chained from) is never mutated.

For a two-step chain:

```go
b := &Builder{}
b.Addr(":8080").ReadTimeout(5*time.Second)
fmt.Println(b.addr)         // "" — Addr's local copy died
fmt.Println(b.readTimeout)  // 0  — same story
```

Both methods mutate disposable locals. The original builder stays empty. `Build()` returns an empty `Server` (or fails the `addr == ""` check, depending on the version).

**Why it's there.** From `junior.md` §11.1: someone wrote `b := *b` thinking "let me work on a copy so I don't mutate the caller's builder". That's the *wrong* mental model — the entire point of pointer-receiver builders is to mutate in place. The shadow turns a mutating builder into a per-step copying builder by accident.

**How to spot in review.** `b := *b` (or `*b = X`) anywhere inside a builder method. Either spelling is a smell. The receiver is already the right thing; don't dereference it into a local.

**Fix.**

```go
func (b *Builder) Addr(a string) *Builder {
    if b.err != nil { return b }
    b.addr = a
    return b
}
```

If the design wants per-step copies (value semantics), use value receivers from the start:

```go
func (b Builder) Addr(a string) Builder {
    b.addr = a
    return b
}
```

This is the *correct* way to copy — Go handles the copy at the call boundary, not in the body.

**Why it's common.** Developers coming from immutable-data languages (Rust, F#, Clojure) instinctively reach for "copy then mutate the copy". In Go's pointer-receiver builder, mutating the receiver *is* the design. Trust the pattern.
</details>

---

## Bug 5: `Build()` returns the builder's map

```go
type Server struct {
    addr    string
    headers map[string]string
}

type Builder struct {
    addr    string
    headers map[string]string
    err     error
}

func NewBuilder() *Builder {
    return &Builder{headers: map[string]string{}}
}

func (b *Builder) Addr(a string) *Builder { b.addr = a; return b }

func (b *Builder) Header(k, v string) *Builder {
    b.headers[k] = v
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    return &Server{
        addr:    b.addr,
        headers: b.headers,
    }, nil
}
```

**Question.** A caller writes:

```go
b := NewBuilder().Addr(":8080").Header("X-Trace-Id", "abc")
srv, _ := b.Build()
b.Header("X-Trace-Id", "def")     // intends to build a second server
srv2, _ := b.Build()
fmt.Println(srv.headers["X-Trace-Id"])  // ?
```

<details><summary>Answer</summary>

**Bug.** `"def"`. Both servers share the same backing map. Mutating the builder after the first `Build()` mutates `srv` too. The first server's header silently changes after it was supposedly "built".

From `junior.md` §10.2 and §8: `Build()` copies the *fields* of the builder into the Server, but a map field is a *header* pointing at a backing hash table. Copying the header copies the pointer. Both Server and Builder now point at the same map.

The same trap applies to slices, channels, pointers, and any struct field containing those. `Build()` must deep-copy reference-typed fields, or the Server escapes the builder's control.

**How to spot in review.** In `Build()`, every field assignment of the form `field: b.fieldOfReferenceType` is suspect. Slices, maps, channels, `*T`, `[]T`, `chan T` all need a copy or an explicit decision to share.

**Fix.**

```go
func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    h := make(map[string]string, len(b.headers))
    for k, v := range b.headers {
        h[k] = v
    }
    return &Server{
        addr:    b.addr,
        headers: h,
    }, nil
}
```

Alternative: forbid reusing the builder after `Build()`. Set `b.headers = nil` at the end of `Build()` so the next call sees a clean slate (or errors out). This is uglier in API terms — most callers don't expect a method to "consume" the receiver.

The cleanest discipline is: build is single-use (`junior.md` §8), and `Build()` deep-copies reference-typed fields to insulate the produced object from the builder's later state.

**Why it's common.** Map and slice copies look like noise — three or four extra lines of "obvious" copying. Skipping them looks like a small optimisation. It isn't: it's a correctness bug that ships and bites in production.
</details>

---

## Bug 6: The error step that doesn't short-circuit

```go
type Builder struct {
    table  string
    wheres []string
    args   []any
    err    error
}

func Select(cols ...string) *Builder {
    if len(cols) == 0 {
        return &Builder{err: errors.New("Select: no columns")}
    }
    return &Builder{}
}

func (b *Builder) From(t string) *Builder {
    if t == "" {
        b.err = errors.New("From: empty table")
    }
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) Build() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    return "SELECT ... FROM " + b.table + " WHERE " + strings.Join(b.wheres, " AND "), b.args, nil
}
```

**Question.** A caller writes:

```go
sql, args, err := Select("id").From("").Where("active = ?", true).Build()
```

What's wrong with the assembled SQL, and what's the deeper bug?

<details><summary>Answer</summary>

**Bug — surface.** `Build()` returns the error from `From("")` (good), but along the way the builder still ran `Where`, allocated slice memory, and stored args. The cost is small here; in a heavier builder (e.g., one that opens a file or starts a goroutine per step), the work done after the first error is real.

**Bug — deep.** `From` and `Where` don't check `b.err`. The pattern from `junior.md` §7.1 requires *every* step to short-circuit on a non-nil `b.err`. Without that check, later steps continue to execute and may *overwrite* the captured error.

Watch this:

```go
sql, _, err := Select().From("").Where("x = ?", 1).Build()
//             ^^^^^^^^ Select returned a builder with err set
//                       ^^^^^^^ From overwrites b.err with its own "From: empty table"
//                                 — original "Select: no columns" is lost
```

The user sees `From: empty table`. They have no idea the first error was `Select: no columns`. They go fix the `From` call and run again — and now `Select` is the first error to surface. They spent debugging time finding errors in the wrong order.

**Why it's there.** Forgetting the `if b.err != nil { return b }` guard at the start of each step. From `junior.md` §7.1: the guard is not optional. It is part of the deferred-error pattern's contract.

**How to spot in review.** Every step method on a builder with an `err` field should start with the guard. Grep for step methods, look for the first line; if it isn't a guard, flag it.

**Fix.** Add the guard everywhere, and stop overwriting:

```go
func (b *Builder) From(t string) *Builder {
    if b.err != nil { return b }
    if t == "" {
        b.err = errors.New("From: empty table")
        return b
    }
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}
```

**Why it's common.** Each step looks innocent on its own — "I'm just setting a field". The guard's purpose only becomes clear when steps are *chained*; in isolation, it looks like dead code. Reviewers without the chain in mind miss it.
</details>

---

## Bug 7: The step that returns `nil` on error

```go
type Builder struct {
    addr string
    err  error
}

func (b *Builder) Addr(a string) *Builder {
    if a == "" {
        return nil
    }
    b.addr = a
    return b
}

func (b *Builder) ReadTimeout(d time.Duration) *Builder {
    b.readTimeout = d
    return b
}
```

**Question.** A caller writes:

```go
srv, err := NewBuilder().Addr("").ReadTimeout(5*time.Second).Build()
```

What happens?

<details><summary>Answer</summary>

**Bug.** `Addr("")` returns `nil`. The chained `.ReadTimeout(...)` is then called on a nil `*Builder`. Inside `ReadTimeout`, the body writes `b.readTimeout = d` — that's `(*b).readTimeout = d` with `b == nil`, which is a nil pointer dereference. Panic.

The caller sees a panic from line 1 of `ReadTimeout`. They blame `ReadTimeout`. The actual bug is in `Addr`, two methods upstream.

**Why it's there.** The author wanted to "report" an error without an error field. Returning `nil` looked like "skip the rest of the chain". It isn't — it's a time bomb in every later step.

From `junior.md` §10.1: returning `nil` from a builder step is one of the canonical disasters. The pattern requires every step to return `b`, including (especially) the error path.

**How to spot in review.** Any step method with `return nil` in its body. There is no legitimate use of `return nil` from a builder step. The error path returns `b` after setting `b.err`; the success path returns `b`. There is no third option.

**Fix.** Use the deferred-error pattern (`junior.md` §7.1):

```go
func (b *Builder) Addr(a string) *Builder {
    if b.err != nil { return b }
    if a == "" {
        b.err = errors.New("Addr: empty")
        return b
    }
    b.addr = a
    return b
}
```

If the codebase doesn't have an `err` field on the builder and adding one is a big change, panic loudly *at this step* instead of returning `nil`:

```go
func (b *Builder) Addr(a string) *Builder {
    if a == "" {
        panic("Addr: empty (programmer error)")
    }
    b.addr = a
    return b
}
```

The panic blames the right line. The nil return blames the wrong one.

**Why it's common.** Developers reach for `nil` as a "no result" sentinel out of habit. In builders, there is no "no result" — the builder itself is the carrier of state, and discarding it mid-chain leaves the chain holding nothing.
</details>

---

## Bug 8: Reusing a builder after `Build()`

```go
type Builder struct {
    addr   string
    routes []string
    err    error
}

func NewBuilder() *Builder { return &Builder{} }

func (b *Builder) Addr(a string) *Builder {
    if b.err != nil { return b }
    b.addr = a
    return b
}

func (b *Builder) Route(r string) *Builder {
    if b.err != nil { return b }
    b.routes = append(b.routes, r)
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    if b.addr == "" {
        b.err = errors.New("Build: Addr required")
        return nil, b.err
    }
    return &Server{addr: b.addr, routes: b.routes}, nil
}
```

**Question.** A test writes:

```go
b := NewBuilder()
s1, _ := b.Addr(":8080").Route("/health").Build()
s2, _ := b.Addr(":9090").Route("/metrics").Build()
```

How is `s2` different from what the caller expected? List two distinct problems.

<details><summary>Answer</summary>

**Bug — problem 1: leaked routes.** `s2.routes` is `["/health", "/metrics"]`, not `["/metrics"]`. `Route` appends; the second `Build()` sees the union of both calls' routes. The builder's `routes` slice was never cleared.

**Bug — problem 2: shared slice.** `s1.routes` and `s2.routes` both point at the same underlying array (the builder's `b.routes`). When the second `Route(":metrics")` appends, the append *may* mutate `s1.routes[1]` in-place if the slice had spare capacity. `s1.routes` becomes `["/health", "/metrics"]` after the second `Build()` — even though `s1` was "finished" first. Bug 5 with a twist: the corruption happens *after* `Build()` returns, while `s1` is supposedly in the caller's hands.

**Why it's there.** From `junior.md` §8: the builder is single-use. Calling `Build()` twice is undefined; the pattern doesn't say "reset between builds" because there is no defined "reset". The author here didn't *think* of `Build()` as terminal — they treated the builder like a reusable factory.

**How to spot in review.** Any code path that calls `.Build()` on a builder, then continues to call step methods on the same builder. Test code is the most frequent offender: "let me build a few variants from this base builder". That's exactly the smell.

**Fix.** Either build a factory function and call it twice:

```go
func newCommonBuilder() *Builder {
    return NewBuilder().Route("/health")
}

s1, _ := newCommonBuilder().Addr(":8080").Build()
s2, _ := newCommonBuilder().Addr(":9090").Route("/metrics").Build()
```

Or implement an explicit `Clone()` (with deep copy of slices, see Bug 3) and document that the builder is single-use without it:

```go
base := NewBuilder().Route("/health")
s1, _ := base.Clone().Addr(":8080").Build()
s2, _ := base.Clone().Addr(":9090").Route("/metrics").Build()
```

Or — heavier — make `Build()` deep-copy the slice so the second `Build()` doesn't share state with the first:

```go
func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    if b.addr == "" { return nil, errors.New("Build: Addr required") }
    routes := append([]string(nil), b.routes...)  // own copy
    return &Server{addr: b.addr, routes: routes}, nil
}
```

That handles problem 2. Problem 1 (the leaked routes) still requires the caller not to reuse the builder.

**Why it's common.** Test fixtures. A developer writes a builder that produces a Server, then realises they want three slightly different servers in three tests. The path of least resistance is "configure once, build many" — which is exactly what the pattern forbids.
</details>

---

## Bug 9: Embedded builder breaks the chain type

```go
type BaseBuilder struct {
    name string
    err  error
}

func (b *BaseBuilder) Name(n string) *BaseBuilder {
    if b.err != nil { return b }
    b.name = n
    return b
}

type ServerBuilder struct {
    *BaseBuilder
    addr string
}

func NewServerBuilder() *ServerBuilder {
    return &ServerBuilder{BaseBuilder: &BaseBuilder{}}
}

func (b *ServerBuilder) Addr(a string) *ServerBuilder {
    if b.err != nil { return b }
    b.addr = a
    return b
}

func (b *ServerBuilder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    return &Server{name: b.name, addr: b.addr}, nil
}
```

**Question.** What happens at the marked line?

```go
srv, err := NewServerBuilder().
    Name("api").
    Addr(":8080").   // (!)
    Build()
```

<details><summary>Answer</summary>

**Bug.** Compile error: `b.Addr undefined (type *BaseBuilder has no field or method Addr)`. The chain after `Name(...)` is operating on a `*BaseBuilder`, not the `*ServerBuilder` the caller started with.

**Why it's there.** From `junior.md` §11.3: when a method on an embedded type returns `*EmbeddedType`, the chain's static type degrades. `Name` is defined on `*BaseBuilder` and returns `*BaseBuilder`. Even though the receiver was a `*ServerBuilder` via embedding promotion, the *return type* is fixed by the method's declaration. The next method call (`Addr`) looks for an `Addr` method on `*BaseBuilder` and doesn't find one.

This is one of the canonical traps of trying to share builder code via embedding. Go's method promotion does not extend to return types.

**How to spot in review.** Any builder that embeds another builder type, and the embedded methods return the *base* type. The smell is a chain that compiles fine for the first few calls (the ones on the base type), then fails as soon as the caller tries to chain a derived-type method. The compile error is loud but confusing — the reader's instinct is "why isn't Addr a method?" rather than "the chain's type degraded".

**Fix — Option A: don't chain across types.** Promote `Name` to a non-chain setter that returns nothing:

```go
type ServerBuilder struct {
    *BaseBuilder
    addr string
}

// non-chain
func (b *ServerBuilder) SetName(n string) {
    if b.err != nil { return }
    b.name = n
}
```

Callers write `b := NewServerBuilder(); b.SetName("api"); b.Addr(":8080").Build()` — multi-step instead of fluent. Loses the chained style.

**Fix — Option B: override on the derived type.**

```go
func (b *ServerBuilder) Name(n string) *ServerBuilder {
    b.BaseBuilder.Name(n)
    return b
}
```

`ServerBuilder.Name` shadows the promoted `BaseBuilder.Name`. Now `NewServerBuilder().Name(...)` returns `*ServerBuilder` (the override). The chain stays in the derived type.

This is repetitive — every base method needs an override on every derived type. It's the price of fluent chains plus inheritance.

**Fix — Option C: don't embed. Compose.**

```go
type ServerBuilder struct {
    base BaseConfig   // a value struct, not a builder
    addr string
    err  error
}

func (b *ServerBuilder) Name(n string) *ServerBuilder {
    if b.err != nil { return b }
    b.base.name = n
    return b
}
```

The "base" is data, not behaviour. The `ServerBuilder` owns all its own step methods. Most idiomatic Go.

**Why it's common.** Developers see Go's struct embedding and think "Java inheritance, finally". Embedding promotes methods, but it doesn't rewrite return types. The fluent builder is exactly the pattern that exposes this gap.
</details>

---

## Bug 10: Stage builder, wrong stage

```go
type AddrStage struct {
    err error
}

type ConfigStage struct {
    addr string
    err  error
}

type FinalStage struct {
    addr    string
    timeout time.Duration
    err     error
}

func NewServerBuilder() *AddrStage { return &AddrStage{} }

func (s *AddrStage) Addr(a string) *ConfigStage {
    if a == "" {
        return &ConfigStage{err: errors.New("Addr: empty")}
    }
    return &ConfigStage{addr: a}
}

func (s *ConfigStage) ReadTimeout(d time.Duration) *FinalStage {
    return &FinalStage{addr: s.addr, timeout: d, err: s.err}
}

// (!)
func (s *AddrStage) UseTLS(cert, key string) *FinalStage {
    return &FinalStage{err: s.err}
}

func (s *FinalStage) Build() (*Server, error) {
    if s.err != nil { return nil, s.err }
    return &Server{addr: s.addr, timeout: s.timeout}, nil
}
```

**Question.** This compiles. A caller writes the chain below. What goes wrong, and what *should* the type system have prevented?

```go
srv, err := NewServerBuilder().
    UseTLS("cert.pem", "key.pem").
    Build()
```

<details><summary>Answer</summary>

**Bug.** Compiles and runs. Produces a `*Server` with `addr == ""` and `timeout == 0`. `Build()` doesn't check `addr`, so it returns "successfully" — but the Server is unusable.

The deeper bug: `UseTLS` is defined on `*AddrStage`, which means the compiler lets the caller skip the `Addr` stage entirely. The whole point of stage typing (`junior.md` §5.3) is that the compiler enforces the ordering — `NewServerBuilder().ReadTimeout(...)` should be a compile error because `ReadTimeout` isn't defined on `*AddrStage`.

Here, defining `UseTLS` on the *wrong* stage opens an escape hatch around the compile-time enforcement. The user takes it (or trips into it) and produces an unconfigured Server.

**Why it's there.** Someone copy-pasted a method definition and forgot to update the receiver. Or someone "fixed" a compile error by changing `*ConfigStage` to `*AddrStage`. The change makes the test pass; it also undoes the type-level protection.

From `junior.md` §5.3: stage typing is "powerful but verbose. Three types per builder. Each new step is a refactor." When the refactor is sloppy, the protection silently breaks.

**How to spot in review.** When stage types are in play, every step method's receiver type must match its *position* in the intended sequence. There should be one method per stage transition, no more. If a stage has two methods returning the same next stage, ask why — usually one of them is misplaced.

A useful invariant: each stage type should appear as a method receiver *exactly* in the methods that consume that stage. If you grep `*AddrStage` and find more methods than transitions out of `AddrStage`, something is off.

**Fix.** Move `UseTLS` to the right stage — between `Addr` and the final build:

```go
func (s *ConfigStage) UseTLS(cert, key string) *FinalStage {
    return &FinalStage{addr: s.addr, err: s.err /* ... */}
}
```

If `UseTLS` is optional (the user can `Build` without TLS), the design is more complex: you need either two paths out of `ConfigStage` (both pointing to a stage from which `Build` is reachable), or a single `FinalStage` that supports both `UseTLS(...).Build()` and `Build()` directly.

The simplest fix when stage typing gets this awkward is to abandon it in favour of the runtime guard from `middle.md` §11.3 (a `phase` int field with panic on order violations).

**Why it's common.** Stage typing's appeal is "the compiler enforces order". Its cost is that every refactor must update three types. When the refactor cost is paid lazily, the type-level protection erodes; the API still looks stage-typed but no longer enforces what it claims to.
</details>

---

## Bug 11: `Validate()` and `Build()` disagree

```go
type Builder struct {
    addr     string
    routes   []string
    pingPath string
    err      error
}

func (b *Builder) Addr(a string) *Builder         { /* ... */ b.addr = a; return b }
func (b *Builder) Route(r string) *Builder        { /* ... */ b.routes = append(b.routes, r); return b }
func (b *Builder) PingPath(p string) *Builder     { /* ... */ b.pingPath = p; return b }

func (b *Builder) Validate() error {
    if b.err != nil { return b.err }
    if b.addr == "" { return errors.New("Addr required") }
    return nil
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    if b.addr == "" {
        return nil, errors.New("Build: Addr required")
    }
    if b.pingPath != "" {
        found := false
        for _, r := range b.routes {
            if r == b.pingPath { found = true; break }
        }
        if !found {
            return nil, fmt.Errorf("Build: PingPath %q is not in Route list", b.pingPath)
        }
    }
    return &Server{ /* ... */ }, nil
}
```

**Question.** A caller writes:

```go
b := NewBuilder().Addr(":8080").PingPath("/health")
if err := b.Validate(); err != nil { return err }
srv, err := b.Build()
```

What happens?

<details><summary>Answer</summary>

**Bug.** `Validate()` returns nil. The caller proceeds to `Build()`, which returns an error: "PingPath /health is not in Route list". The caller's pre-flight validation passed; the actual build failed.

If this code is behind a UI that says "configuration is valid" after `Validate()` and *then* tries to build, the user sees a contradictory experience: "valid" followed by "invalid". The error message also blames `Build`, even though the problem was *visible* at `Validate` time.

**Why it's there.** From `middle.md` §10.4: `Validate()` is a convenience, not a contract. If it returns nil, the caller expects `Build()` to succeed (modulo I/O errors, like loading a TLS cert). When `Build()` has validation logic that `Validate()` doesn't run, the two terminals disagree.

The deeper rule: validation logic must live in *one* place. Either both terminals call the same helper, or one of them is a thin wrapper around the other.

**How to spot in review.** Two terminals (`Validate`, `Build`, `Plan`, etc.) with overlapping validation logic. If you can grep for the same error message string in two methods, you've found it. If you can construct an input where `Validate` and `Build` produce different verdicts, the design is wrong.

**Fix.** Factor validation into a helper called by both terminals:

```go
func (b *Builder) validate() error {
    if b.err != nil { return b.err }
    if b.addr == "" { return errors.New("Addr required") }
    if b.pingPath != "" {
        found := false
        for _, r := range b.routes {
            if r == b.pingPath { found = true; break }
        }
        if !found {
            return fmt.Errorf("PingPath %q is not in Route list", b.pingPath)
        }
    }
    return nil
}

func (b *Builder) Validate() error { return b.validate() }

func (b *Builder) Build() (*Server, error) {
    if err := b.validate(); err != nil {
        return nil, err
    }
    return &Server{ /* ... */ }, nil
}
```

Now both terminals agree by construction. Adding a new validation rule means editing one function.

**Why it's common.** `Validate()` is often added later, as a convenience. The author implements it by reading `Build()` and translating "the important checks" into a new function. Translation is lossy. The pre-existing `Build()` logic drifts as new fields appear; `Validate()` lags behind.
</details>

---

## Bug 12: Concurrent step calls

```go
type Builder struct {
    routes []string
    err    error
}

func (b *Builder) Route(r string) *Builder {
    if b.err != nil { return b }
    b.routes = append(b.routes, r)
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    return &Server{routes: b.routes}, nil
}

// in registerRoutes:
func registerRoutes(b *Builder, all []string) {
    var wg sync.WaitGroup
    for _, r := range all {
        wg.Add(1)
        go func(route string) {
            defer wg.Done()
            b.Route(route)
        }(r)
    }
    wg.Wait()
}
```

**Question.** A caller passes 100 routes to `registerRoutes`. How many routes are on the resulting Server?

<details><summary>Answer</summary>

**Bug.** Some number between 1 and 100, non-deterministically. The race detector (`go test -race`) flags it immediately: `DATA RACE on field routes`.

Multiple goroutines call `b.Route` concurrently. `Route` does `b.routes = append(b.routes, r)`. `append` reads `len(b.routes)`, allocates (maybe), writes the new element, writes the new slice header. None of that is atomic. Concurrent appends produce:

- Lost updates (two goroutines read the same length, both write to index N, one wins).
- Slice header tearing (one goroutine reads the header mid-write from another).
- Heap corruption in pathological cases (the runtime panics or worse).

**Why it's there.** From `junior.md` §11.2: builders are single-threaded by design. The pattern's invariant is "one goroutine accumulates, one goroutine calls Build". The author here treated the builder like a thread-safe collection.

**How to spot in review.** Any `go` statement that calls a method on a builder. The pattern is "build serially, then act in parallel" — never "build in parallel".

If concurrent assembly is genuinely required (say, scraping routes from N microservices in parallel), the fix is to gather results into a slice or channel, then call the builder serially with the gathered data:

```go
func registerRoutes(b *Builder, all []string) {
    ch := make(chan string, len(all))
    var wg sync.WaitGroup
    for _, r := range all {
        wg.Add(1)
        go func(route string) {
            defer wg.Done()
            ch <- route  // or actually some I/O that produces the route
        }(r)
    }
    wg.Wait()
    close(ch)
    for r := range ch {
        b.Route(r)
    }
}
```

The builder sees serial calls. The parallelism lives in the producers, not the consumer.

**Fix.** Don't synchronise the builder. Move the parallelism out of the chain. See `middle.md` §13.5: adding a mutex to step methods is fighting the pattern, not honouring it.

**Why it's common.** "I have a slice of things to register; goroutines are how Go does parallel work" — the chain of thought is intuitive and ignores the builder's contract. The race detector finds it on the first test run *if* the developer remembers to enable it.
</details>

---

## Bug 13: `With(opts...)` panics on a nil option

```go
type Builder struct {
    addr    string
    retries int
}

type Option func(*Builder)

func WithRetries(n int) Option {
    return func(b *Builder) { b.retries = n }
}

func (b *Builder) With(opts ...Option) *Builder {
    for _, o := range opts {
        o(b)
    }
    return b
}

// elsewhere:
func defaultOpts(prod bool) []Option {
    var opts []Option
    if prod {
        opts = append(opts, WithRetries(5))
    }
    opts = append(opts, nil)   // (!) accidentally
    return opts
}
```

**Question.** What happens?

<details><summary>Answer</summary>

**Bug.** `panic: runtime error: invalid memory address or nil pointer dereference`. The loop in `With` calls `o(b)` without checking `o == nil`. A nil function value panics on invocation.

The `nil` may have been appended deliberately as a placeholder, or generated by a conditional expression that returns `nil` on the negative branch:

```go
opts = append(opts, withTracingIf(prod, tracer))   // returns nil if !prod
```

Either way, one `nil` in a slice of options crashes the entire chain.

**Why it's there.** From `middle.md` §15.4: any `for _, o := range opts` over options must skip nils. The pattern shows up in functional options *and* in builders that accept options via `With(...)`.

**How to spot in review.** Any `for _, X := range Xs` where `X` is then *called* as a function. If the slice can contain nils (which it almost always can — slices are nil-safe at the slot level), the call must check.

**Fix.**

```go
func (b *Builder) With(opts ...Option) *Builder {
    for _, o := range opts {
        if o == nil { continue }
        o(b)
    }
    return b
}
```

One-line guard. Costs nothing in the hot path. Saves a panic in production.

A stronger version: at option *construction*, reject nil inputs:

```go
func WithRetries(n int) Option {
    if n < 0 { panic("WithRetries: negative") }
    return func(b *Builder) { b.retries = n }
}
```

But this doesn't help when a nil is appended *outside* the option constructors (the `withTracingIf` case above). The defensive skip in `With` is the right line of defence.

**Why it's common.** Slices and nil-safety in Go is one of the trickier intersections. A slice can be non-nil but contain nil elements. Iterating without a nil check feels redundant until you ship the first panic.
</details>

---

## Bug 14: SQL injection via `Where()` concatenation

```go
type Builder struct {
    table  string
    wheres []string
    args   []any
    err    error
}

func (b *Builder) From(t string) *Builder         { b.table = t; return b }
func (b *Builder) Where(cond string) *Builder     { b.wheres = append(b.wheres, cond); return b }

func (b *Builder) Build() (string, []any, error) {
    var sb strings.Builder
    sb.WriteString("SELECT * FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    return sb.String(), b.args, nil
}

// caller:
func findUser(db *sql.DB, name string) (*User, error) {
    sql, args, _ := NewBuilder().
        From("users").
        Where("name = '" + name + "'").
        Build()
    row := db.QueryRow(sql, args...)
    // ...
}
```

**Question.** A caller passes `name = "admin' OR '1'='1"`. What does the resulting SQL look like, and why is the *builder's API* partly to blame?

<details><summary>Answer</summary>

**Bug.** The SQL becomes:

```sql
SELECT * FROM users WHERE name = 'admin' OR '1'='1'
```

Classic SQL injection. The `OR '1'='1'` defeats the filter; the query returns every user.

The caller wrote the injection by concatenating `name` into the `Where` argument. They were the proximate cause — but the builder's API *invited* the bug. `Where(string)` takes a raw SQL fragment with no parameterisation. A user who has internalised "concatenate into the query" everywhere they touch SQL gets no help from the type system.

From `junior.md` §9: the canonical SQL builder takes `Where(cond string, args ...any)` and treats the cond as a *template* with `?` placeholders. The args go through the driver's parameterisation, which escapes them safely.

**How to spot in review.** Any `Where`, `Filter`, `Match`-style method on a query builder that doesn't accept `args ...any`. The smell is `WhereCond(string)` with no companion arg path. Even worse: `Where(string)` *and* `args` on the builder elsewhere — the API has the right idea but the wrong call shape.

In review: grep for `Where(` followed by string concatenation (`"+`, `fmt.Sprintf`, `bytes.Buffer.WriteString` of a user-controlled value). Each match is potentially exploitable.

**Fix.** Take args at the call site, defer parameterisation to the driver:

```go
func (b *Builder) Where(cond string, args ...any) *Builder {
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

// caller:
func findUser(db *sql.DB, name string) (*User, error) {
    sql, args, _ := NewBuilder().
        From("users").
        Where("name = ?", name).      // placeholder + arg
        Build()
    row := db.QueryRow(sql, args...)
    // ...
}
```

Inside `Build()`, the `?` placeholders are interleaved with the args (in order). The driver substitutes them safely at execution time. `name = "admin' OR '1'='1"` becomes the string literal value of the `name` column comparison, not part of the SQL grammar.

For the `table` field — also a potential injection point — the right answer is *not* to parameterise (table names can't be SQL params in most drivers). Instead, validate against an allow-list of known tables:

```go
var allowedTables = map[string]bool{"users": true, "orders": true /* ... */}

func (b *Builder) From(t string) *Builder {
    if b.err != nil { return b }
    if !allowedTables[t] {
        b.err = fmt.Errorf("From: table %q not allowed", t)
        return b
    }
    b.table = t
    return b
}
```

Identifiers are validated; values are parameterised.

**Why it's common.** SQL builders are written by people who already know SQL. They write `Where("active = 1")` because it reads naturally. They forget that *user input* in the same slot is now data-as-code. The fix is one design decision at API design time; missing it costs you a CVE later.
</details>

---

## Bug 15: `If(cond, fn)` evaluates `fn` always

```go
type Builder struct {
    addr  string
    cert  string
    cache *Cache
    err   error
}

func (b *Builder) Addr(a string) *Builder      { b.addr = a; return b }
func (b *Builder) UseTLS(c string) *Builder    { b.cert = c; return b }
func (b *Builder) UseCache(c *Cache) *Builder  { b.cache = c; return b }

func (b *Builder) If(cond bool, fn *Builder) *Builder {
    if cond {
        return fn
    }
    return b
}

// caller:
func main() {
    srv, _ := NewBuilder().
        Addr(":8080").
        If(useCache, (&Builder{}).UseCache(expensiveCacheInit())).   // (!)
        Build()
    _ = srv
}
```

**Question.** A caller passes `useCache = false`. What happens, and what was the author trying to write?

<details><summary>Answer</summary>

**Bug — surface.** `expensiveCacheInit()` runs even when `useCache` is false. Go evaluates *all* arguments to a function before the function is called. The `If` method receives the already-computed result; the `cond` check happens *after* the cache was built.

For a cheap init, the bug is invisible. For an expensive one (loading 100MB from disk, connecting to Redis, allocating a 1GB buffer), the builder pays the cost of every "conditional" option *regardless* of the condition.

**Bug — design.** Even with eager evaluation aside, the signature `If(cond bool, fn *Builder) *Builder` is wrong. The pattern from `middle.md` §11.2 is `If(cond bool, fn func(*Builder)) *Builder` — the *function* is deferred, not a pre-built builder. The author conflated "another builder" with "a step to apply".

**Why it's there.** From `middle.md` §11.2: the conditional step is one of the trickier patterns. The reader instinct is "If returns one branch or the other", and the author wrote it that way. Go's strict left-to-right argument evaluation breaks the lazy intuition.

**How to spot in review.** Any builder method with a `bool` argument and a second argument that's a *value* (not a `func`). If the second argument involves any computation, that computation happens unconditionally.

Also look for patterns like `If(cond, b.UseCache(c))` at call sites — chaining `UseCache` *inside* the `If` argument list, where the chain runs whether or not `cond` is true.

**Fix.** Take a closure; defer the steps inside it:

```go
func (b *Builder) If(cond bool, fn func(*Builder)) *Builder {
    if cond {
        fn(b)
    }
    return b
}

// caller:
srv, _ := NewBuilder().
    Addr(":8080").
    If(useCache, func(b *Builder) {
        b.UseCache(expensiveCacheInit())
    }).
    Build()
```

Now `expensiveCacheInit()` runs only when `useCache` is true. The closure is the thunk; calling it is what evaluates the expensive expression.

If the conditional step is genuinely just one method call with cheap arguments, the `If` helper is overhead. The explicit form is just as clear:

```go
b := NewBuilder().Addr(":8080")
if useCache {
    b.UseCache(expensiveCacheInit())
}
srv, _ := b.Build()
```

Many Go developers prefer the explicit `if` — see `middle.md` §11.2's note. Adopt `If` only when chains with mid-stream conditions are common enough that the explicit form fragments the code.

**Why it's common.** The fluent style invites "everything must chain". Conditional logic doesn't fit naturally, so authors invent helpers. The helpers are easy to get wrong — especially around evaluation order, which Go enforces strictly. The right reflex: when a chain wants conditional behaviour, either close around it (`If(cond, func(*Builder){...})`) or step outside the chain (`if cond { b.X(...) }`).
</details>

---

## Summary

The bugs cluster around five themes.

1. **The chain's mechanics** (Bugs 1, 2, 4, 7) — `return` without `b`, mismatched receiver/return types, shadowing the receiver, returning `nil` mid-chain. Each breaks the chain in a different invisible way.
2. **Shared mutable state** (Bugs 3, 5, 8) — shallow `Clone()`, leaking the builder's slice/map into the produced object, reusing a builder after `Build()`. All three trace back to "the builder's fields are not just data; they're shared references".
3. **The deferred-error contract** (Bugs 6, 7) — every step must guard on `b.err` at entry; no step may return `nil`; later steps may not overwrite an earlier error.
4. **Compile-time vs runtime enforcement** (Bugs 9, 10, 11) — embedded builders that break the chain's type, stage typing that has an escape hatch, `Validate()` and `Build()` that disagree. The pattern works only when the enforcement matches the design's intent.
5. **The surrounding API** (Bugs 12, 13, 14, 15) — concurrent assembly, nil options, unparameterised SQL, eager evaluation of "conditional" arguments. Each violation is in the *use* of the builder, but the builder's API design either invited it or could have prevented it.

The defences are the same across all of them: every step returns `b`, every step guards on `b.err`, every `Build()` deep-copies reference-typed fields, the builder is single-use unless explicitly cloned, the type system enforces what it claims to, and the API design refuses to invite injection or eager-evaluation traps.

A unit test that constructs a target with various chains and asserts the resulting object's state catches most of these before they ship. `go vet` catches none of them. The race detector catches Bug 12. Code review catches the rest — and now you know what to look for.

---

## Further reading

- `junior.md` §7 (deferred-error pattern)
- `junior.md` §8 (builder is single-use)
- `junior.md` §10 (common junior mistakes)
- `junior.md` §11 (tricky points: shadowing, goroutines, embedding)
- `middle.md` §4 (reusable / forkable builders)
- `middle.md` §10 (validation strategies)
- `middle.md` §13 (common middle-level mistakes)
- `middle.md` §15 (tricky points: chain compilation, With nil-skip)
- Go 1.22 loopvar change: https://go.dev/blog/loopvar-preview
- `squirrel` query builder: https://github.com/Masterminds/squirrel
- `goqu` query builder: https://github.com/doug-martin/goqu
