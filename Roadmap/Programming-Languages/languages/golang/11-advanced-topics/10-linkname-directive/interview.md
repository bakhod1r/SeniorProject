## `//go:linkname` Directive — Interview Questions

## Q1. What does `//go:linkname` do?

It is a compiler directive that rebinds a local symbol (function or variable) to a foreign symbol at link time. The two-argument form `//go:linkname localname importpath.name` makes the local declaration resolve to the named symbol from another package, including unexported ones. The one-argument form publishes a local symbol under the given name for other packages to consume.

---

## Q2. Why does it exist?

The Go standard library has parts that must call into the runtime — for example, `sync.Mutex` needs to park and unpark goroutines. The runtime intentionally does not export these primitives because doing so would freeze them under the Go 1 compatibility promise. `//go:linkname` lets the standard library cross the package boundary without exposing the bridging symbols to user code.

---

## Q3. What changed in Go 1.23?

Two things. First, every file using `//go:linkname` must `import _ "unsafe"`. Without that import the compiler rejects the directive. Second, the linker added a `-checklinkname` flag (on by default) that warns or errors when external packages try to consume symbols the runtime did not opt-in to expose. An allow-list grandfathers historical uses while the Go team plans the phase-out.

---

## Q4. Give an example used by the standard library.

The `time` package links to `runtime.nanotime` for monotonic time:

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64
```

The `sync` package links to runtime semaphore primitives for `Mutex.Lock` and `Unlock`:

```go
//go:linkname runtime_Semacquire sync.runtime_Semacquire
func runtime_Semacquire(s *uint32)
```

In both cases the runtime owns the body and the consumer package declares a body-less local handle.

---

## Q5. Why is this directive dangerous?

Three reasons. (1) It bypasses Go's package visibility, reaching unexported symbols. (2) It bypasses signature checking — the compiler accepts any local signature, so a runtime change to argument types produces silent miscompilation. (3) Internal runtime symbols are not covered by the Go 1 compatibility promise, so the target can be renamed, removed, or restructured between releases.

---

## Q6. What does the empty-body declaration mean?

When linking to a function, the local declaration has no body. The compiler would normally reject a function declaration without a body, but `//go:linkname` permits it. The compiler emits a symbol with a foreign name, and the linker resolves all references to the actual implementation in the target package. There is exactly one body in the final binary.

---

## Q7. What is the difference between the one-argument and two-argument forms?

The two-argument form **consumes** an external symbol: `//go:linkname local runtime.foo` makes the local name resolve to `runtime.foo`. The one-argument form **publishes** the local symbol under a given name for others to consume: `//go:linkname mypkg_callback` exposes the local `mypkg_callback` for external two-argument linknames pointing to `somepkg.callback`. The standard library uses the publish form in the runtime to expose bridging functions.

---

## Q8. Why do you sometimes need `//go:noescape` alongside `//go:linkname`?

By default the compiler assumes any function call may let its pointer arguments escape. For a linkname-bound function (with no Go-visible body), the compiler has no escape information at all. Without `//go:noescape`, pointer arguments are conservatively heap-allocated. With it, the compiler trusts that the linked function does not retain its arguments, enabling stack allocation. You must verify the runtime function actually has this property before adding the directive.

---

## Q9. Can `//go:linkname` reach exported symbols?

Yes, but there is no reason to. If a symbol is exported you can simply import the package and call it normally, with full type checking and inlining. `//go:linkname` exists specifically to reach symbols you otherwise cannot — unexported runtime internals or stdlib bridging functions.

---

## Q10. What replaces `runtime.fastrand` in modern Go?

`math/rand/v2` (Go 1.22+) provides comparable performance with a public, stable API:

```go
import "math/rand/v2"

n := rand.Uint32()
```

Benchmarks show the gap is within noise on most hardware. Before Go 1.22 the linkname version was meaningfully faster; from 1.22 onward there is little reason to keep it.

---

## Q11. What replaces `runtime.nanotime` for application code?

The `time` package's monotonic clock has been built into `time.Now()` results since Go 1.9. To measure elapsed time:

```go
start := time.Now()
// ... work ...
elapsed := time.Since(start)
```

This is monotonic, correctly accounts for clock adjustments, and is stable across Go versions. The performance gap to `runtime.nanotime` is real but irrelevant outside profilers and very tight loops.

---

## Q12. What happens if you misspell the import path?

The compiler does **not** validate the import path against actual imports. It accepts any identifier-dot-identifier string. The error surfaces at link time:

```
relocation target rumtime.nanotime not defined
```

This may appear minutes into a large build, which is why a small test that calls each linkname-bound function once is worth adding to a package.

---

## Q13. What happens if the signature does not match the target?

The compiler accepts any signature. At runtime the call uses your declared signature's ABI — passing the wrong arguments and reading the wrong return slots. The result is memory corruption, garbage return values, or crashes. There is no warning. The only defense is to read the target package's source and copy the signature verbatim.

---

## Q14. How would you safely use `//go:linkname` in a library you maintain?

Six steps. (1) Document the rationale and the public-API alternative in a comment above the directive. (2) Gate the directive behind precise build tags covering only tested Go versions. (3) Provide a fallback implementation for versions outside the tag range. (4) Add `import _ "unsafe"` (required from Go 1.23). (5) Build the package in a CI matrix including the next Go release (`tip`). (6) Write a regression test that calls each linked function and validates an invariant.

---

## Q15. What is `runtime.sync_runtime_Semacquire`?

A pair of bridging functions (`Semacquire` and `Semrelease`) that the runtime publishes via one-argument `//go:linkname` so the `sync` package can consume them with the two-argument form. They implement goroutine parking and unparking — the primitive on which `sync.Mutex`, `sync.WaitGroup`, and friends are built. Application code should call `sync.Mutex` directly, not link these symbols.

---

## Q16. How do you find every `//go:linkname` in a codebase, including dependencies?

```bash
git grep -n '//go:linkname'
go mod download -json all | jq -r .Dir | \
    xargs -I{} grep -l '//go:linkname' {}/*.go 2>/dev/null
```

The first command finds direct uses. The second walks every downloaded module's Go files and prints those containing the directive. Running this weekly catches new transitive dependencies that introduce linkname use.

---

## Q17. Why does the Go team want to phase out external use?

External use constrains runtime evolution. Every time the team wants to rename or restructure an internal symbol, they discover community packages that depend on the current name. The 1.23 changes — required `unsafe` import, `-checklinkname` flag, eventual hard error — are the first steps of giving the runtime back the freedom to change its internals. The replacement plan provides public APIs (`math/rand/v2`, `runtime/metrics`, etc.) for the major use cases.

---

## Q18. Can you use `//go:linkname` for variables, and what is special about that?

Yes. The directive applies to `var` declarations the same way it applies to `func` declarations:

```go
//go:linkname startNanoTime runtime.startNanoTime
var startNanoTime int64
```

The local variable is the **same word in memory** as the runtime variable. Reads see whatever the runtime wrote; writes are visible to the runtime. Variable linknames are more fragile than function linknames because struct layouts change more often than function signatures. Prefer linking primitive types over composite types.

---

## Q19. How do you verify a linkname actually took effect in the binary?

`go tool nm` lists every symbol in the output and its address:

```bash
$ go tool nm app | grep nanotime
   0x000000000045a1c0 T runtime.nanotime
   0x000000000045a1c0 T main.runtimeNano
```

Two names, identical address — the link succeeded. Two distinct addresses would mean the linkname was silently ignored (most often due to a blank line between the directive and the declaration).

---

## Q20. Imagine you upgraded to Go 1.NN and a linkname-bound symbol disappeared. Walk through the recovery.

(1) Pin the previous Go toolchain in `go.mod` (`toolchain go1.NN-1.X`) to keep production working. (2) Identify every linkname in your codebase and its transitive dependencies. (3) For each broken symbol, find the public-API replacement in the new Go release notes. (4) Implement the replacement behind the same internal function name. (5) Build-tag-gate the linkname version for older Go releases. (6) Run the full test suite on the new Go version in staging. (7) Deploy. (8) Write a postmortem with action items including adding `tip` to CI. The migration usually takes a working day per linkname for a well-instrumented service.

---

## Further reading
- `cmd/compile` directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- `golang/go#67401` (restriction proposal): https://github.com/golang/go/issues/67401
- Go 1.23 release notes: https://go.dev/doc/go1.23
- `math/rand/v2`: https://pkg.go.dev/math/rand/v2
