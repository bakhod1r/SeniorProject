## `//go:linkname` Directive — Specification

> **Focus:** Precise reference for the `//go:linkname` compiler directive — its syntax, semantics, restrictions, version history, and interactions with the compiler and linker.
>
> **Sources:**
> - `cmd/compile` documentation: https://pkg.go.dev/cmd/compile
> - Go runtime source: https://github.com/golang/go/tree/master/src/runtime
> - Go 1.23 release notes: https://go.dev/doc/go1.23
> - Russ Cox proposal on restricting `//go:linkname`: https://github.com/golang/go/issues/67401

---

## 1. Syntax

The directive is a magic comment recognized by `cmd/compile`. Two forms exist.

```go
//go:linkname localname
//go:linkname localname importpath.name
```

| Form | Effect |
|------|--------|
| One argument | Declares `localname` as a linker-visible symbol that **other** packages may refer to via the two-argument form. |
| Two arguments | Rebinds the local name `localname` in this package to the external symbol `importpath.name`. |

`importpath` is the canonical import path of the package that owns the target (e.g., `runtime`, `time`, `sync`). `name` is the unqualified function or variable name as it appears in that package's source (it may be unexported).

The directive **must** appear immediately above the declaration it modifies (no blank lines between).

---

## 2. Semantics

`//go:linkname` is processed by the compiler and resolved by the linker. It does not produce code at the call site; instead, it changes the **symbol name** the compiler emits for the local declaration.

Two patterns dominate:

1. **Body-less local declaration** linked to an external implementation.

   ```go
   //go:linkname nanotime runtime.nanotime
   func nanotime() int64
   ```

   The compiler emits a call to `runtime.nanotime`; the linker resolves it to the actual symbol at link time. No function body is allowed locally.

2. **Local variable** linked to an external variable.

   ```go
   //go:linkname startNanoTime runtime.startNanoTime
   var startNanoTime int64
   ```

   The local `startNanoTime` is the **same** storage as `runtime.startNanoTime`. Reads and writes go through the same word in memory.

---

## 3. The Go 1.23 restriction

Starting in **Go 1.23**, `//go:linkname` is gated behind an `unsafe` import. A package that uses the directive must import `unsafe`, even if it does not call any function from the package.

```go
package mypkg

import _ "unsafe" // required by //go:linkname

//go:linkname nanotime runtime.nanotime
func nanotime() int64
```

If the `unsafe` import is missing, the compiler reports:

```
linkname directive must be used with import "unsafe"
```

The blank import is a signal that the package is opting out of the language's normal safety guarantees, the same convention used for `unsafe.Pointer` itself.

---

## 4. Targeting unexported symbols

The directive bypasses Go's package visibility rules. A two-argument `//go:linkname` may name an unexported symbol of another package:

```go
//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

`runtime.fastrand` is lowercase and unexported. Without `//go:linkname`, no other package could call it. The directive is the only mechanism in Go that breaks export visibility.

The compiler does not require source access to the target package; only the linker needs to resolve the symbol. As long as the named symbol exists in the final binary, the link succeeds.

---

## 5. Restrictions

| Rule | Consequence if violated |
|------|--------------------------|
| Local declaration must have no body when linking to a function. | `missing function body` compile error. |
| `unsafe` must be imported (Go 1.23+). | `linkname directive must be used with import "unsafe"` error. |
| Directive must be on the line immediately above the declaration. | Directive silently ignored. |
| Signature must match the target. | Memory corruption, crashes, or wrong results at runtime. |
| Build tags filter the file as usual. | Directive only applies in selected build configurations. |
| Cannot link to a symbol that does not exist in the final binary. | Linker error: `relocation target X not defined`. |

There is no syntactic check that the local signature matches the remote one — the compiler accepts any signature and the linker only resolves names. The programmer is responsible for keeping the two in sync.

---

## 6. Compiler and linker pipeline

```
source.go        ── compile ──▶  .o file        ── link ──▶  binary
   │                                │                          │
   //go:linkname  ───────────────▶ symbol table entry
   localname        ──renamed──▶  external symbol name
```

| Stage | What happens |
|-------|--------------|
| `cmd/compile` parses the directive | Records a `LSym.Type = ABIInternal` and overrides the linker name. |
| Object file emitted | The local symbol carries the foreign name as its link name. |
| `cmd/link` resolves references | At link time the local references collapse onto the target symbol. |
| Final binary | A single symbol; both packages observe the same code or data. |

Because the resolution is at link time, you can compile a package against header declarations only — the bodies of `runtime.nanotime`, `runtime.fastrand`, etc., are never visible to your compiler invocation.

---

## 7. Common targets in the standard library

These symbols are routinely linked from inside the standard library and (carefully) from external packages.

| Symbol | Package | Purpose |
|--------|---------|---------|
| `runtime.nanotime` | `runtime` | Monotonic clock in nanoseconds; used by `time` |
| `runtime.fastrand` | `runtime` | Cheap pseudo-random uint32 for jitter and load balancing |
| `runtime.fastrandu` | `runtime` | Variant returning `uint` (newer Go versions) |
| `runtime.sync_runtime_Semacquire` | `runtime` | Goroutine semaphore acquire; backs `sync.Mutex` |
| `runtime.sync_runtime_Semrelease` | `runtime` | Counterpart release; backs `sync.Mutex.Unlock` |
| `runtime.activeModules` | `runtime` | Loaded module table; used by `plugin` |
| `runtime.startNanoTime` | `runtime` | Wall-clock baseline at start; used by `time` |

The `sync` package's mutex implementation calls into the runtime through these `runtime_` symbols so the runtime can park and unpark goroutines without exporting the goroutine APIs.

---

## 8. The bidirectional pattern

The standard library frequently uses both ends of the same link to form a closed contract between `runtime` and a user-facing package.

In `runtime/sema.go`:

```go
//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(addr *uint32) { ... }
```

In `sync/runtime.go`:

```go
//go:linkname runtime_Semacquire
func runtime_Semacquire(s *uint32)
```

The `runtime` side defines the body and announces "I provide the symbol `sync.runtime_Semacquire`". The `sync` side declares a body-less function with the matching local name, and the linker connects them. This pattern keeps the bridging symbols invisible to user code.

---

## 9. Interaction with other directives

`//go:linkname` is frequently combined with other compiler directives.

| Directive | Combined effect |
|-----------|-----------------|
| `//go:noescape` | Tells the compiler the linked function does not let arguments escape, enabling stack allocation across the call. |
| `//go:nosplit` | The linked function must not trigger stack growth. Used for runtime-internal calls that cannot tolerate stack copies. |
| `//go:noinline` | Prevents inlining; rare since linkname targets often have no Go-visible body. |
| `//go:uintptrescapes` | Treat `uintptr` arguments as escaped pointers for GC purposes; used at the syscall boundary. |

Each of these directives must appear on its own line above the declaration; order among them does not matter.

---

## 10. Version history

| Version | Change |
|---------|--------|
| Go 1.0 (pre-public) | `//go:linkname` exists for internal stdlib use. |
| Go 1.5 onwards | Public knowledge of the directive spreads; some libraries adopt it. |
| Go 1.18 | First documentation hardening — release notes mention reliance on `runtime.nanotime` as fragile. |
| Go 1.21 | `runtime.fastrand` renamed; many external linknames break. The team signals the long-term intent to restrict the directive. |
| Go 1.23 | `unsafe` import becomes mandatory for `//go:linkname` use. New `internal/linkname` allow-listing being prototyped. |
| Future | The Go team has stated that external use will be progressively restricted; `golang.org/x/sys` and similar packages have explicit migration plans. |

The trajectory is clear: `//go:linkname` is for the standard library; external use will become harder, not easier.

---

## 11. Constraints summary

| Constraint | Where enforced |
|------------|----------------|
| Directive syntax exactly `//go:linkname localname [importpath.name]` | Compiler frontend |
| No blank line between directive and declaration | Compiler frontend |
| `unsafe` import required (1.23+) | Compiler frontend |
| Function declaration without body when linking to a function | Compiler |
| Symbol resolvable at link time | Linker |
| Caller's signature matches target | Programmer; **not** verified |

The unverified signature match is the single largest source of trouble: a function rename or argument-order change in the standard library produces a binary that links but corrupts memory.

---

## 12. Tooling

| Tool | Purpose |
|------|---------|
| `go build -ldflags="-checklinkname=0"` | Disables the new (Go 1.23+) link-time check on disallowed external linknames. |
| `go vet` | Warns on certain misuse patterns of `//go:linkname`. |
| `go tool nm <binary>` | Reveals which linkname targets are actually present. |
| `objdump -d` / `go tool objdump` | Lets you see the resolved call addresses for linkname-bound symbols. |
| `cmd/link` log (`-v`) | Prints the symbol resolution decisions. |

The `-checklinkname` linker flag (added in 1.23) lets release engineers detect external dependencies on internal symbols during integration testing.

---

## 13. Non-goals

`//go:linkname` is **not**:

- A way to override Go's type system. Signature mismatches are silently miscompiled.
- A general FFI mechanism. Use `cgo` for C interop.
- A stable public API. Linkname targets in `runtime` may be renamed or removed between releases.
- A substitute for proper API design. The standard library uses it as an internal bridging tool, not a public extension point.

---

## 14. Related references

- `cmd/compile` directives index: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- `runtime` source for popular linkname targets: https://github.com/golang/go/blob/master/src/runtime/time.go
- The 1.23 restriction discussion: https://github.com/golang/go/issues/67401
- "What is //go:linkname?" — Dave Cheney: https://dave.cheney.net/
