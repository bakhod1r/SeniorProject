## `//go:linkname` Directive — Middle

## 1. From comment to linker action

A `//go:linkname` directive is processed in three distinct phases. Knowing each phase makes the directive's behavior predictable instead of magical.

| Phase | Tool | What it does |
|-------|------|--------------|
| Parse | `cmd/compile/internal/syntax` | Recognizes the magic comment on the line above a declaration. |
| Frontend lowering | `cmd/compile/internal/ir` | Marks the declared `Func` or `Var` with a foreign linkname. |
| Object emission | `cmd/compile/internal/ssagen` + `cmd/internal/obj` | Writes the symbol with its external name into the object file's symbol table. |
| Linking | `cmd/link/internal/ld` | Resolves all references to the foreign name as one symbol. |

The end result is that **the symbol in the final binary has only one address**, regardless of how many packages declared local handles to it.

---

## 2. The two-argument form, line by line

```go
//go:linkname foo runtime.bar
func foo()
```

The compiler sees this and emits an entry roughly equivalent to:

```
SYMBOL foo
  Type: function
  ABIInternal
  LinkName: runtime.bar
  Body: <none>
```

When `cmd/link` reads this object, it does not allocate a new function called `foo`. Instead, it records a reference: "wherever `foo` is called, call the symbol named `runtime.bar`." If `runtime.bar` is present in any object file the linker is processing, the references are resolved. If not, the linker fails:

```
relocation target runtime.bar not defined
```

---

## 3. The empty-body trick

The most common use is to **declare** a function without a body and link it to an existing one elsewhere.

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64
```

There is no `{ ... }` block. The compiler would normally reject this with `missing function body`. The `//go:linkname` directive suppresses that check: the body is intentionally absent because the linker will provide it.

If you add a body, the compiler errors out — the linker would have two definitions of the same symbol.

---

## 4. The one-argument form

The one-argument form announces a symbol's availability to other packages.

```go
//go:linkname sync_runtime_Semacquire
func sync_runtime_Semacquire(addr *uint32) {
	// real implementation
}
```

This says: "expose `sync_runtime_Semacquire` to anyone else who declares `//go:linkname someName sync.runtime_Semacquire`." It is the dual of the two-argument form. In the runtime, you find one-argument linkname declarations that publish symbols; in `sync`, you find two-argument linkname declarations that consume them.

This dual pattern is how the standard library couples `runtime` to `sync`, `time`, and a handful of other core packages without polluting the public API of `runtime`.

---

## 5. Package-to-symbol naming

`cmd/link` symbol names are built from the canonical import path plus the unqualified identifier:

```
github.com/example/pkg.FuncName
internal/poll.runtime_pollWait
runtime.nanotime
sync.runtime_Semacquire
```

A `//go:linkname localname importpath.name` argument uses **exactly** this dotted form. If you misspell the import path, the linker fails at the very end of the build — sometimes minutes into a large compilation.

```go
//go:linkname x runtime.fastrand    // OK
//go:linkname x runtime/fastrand    // syntax error in directive
//go:linkname x rumtime.fastrand    // typo: linker error
```

The directive accepts only a dot separator and never validates the import path against actual imports.

---

## 6. Build tags interact normally

A `//go:linkname` directive lives inside a source file. The file's build tags decide whether the directive is even compiled.

```go
//go:build linux

package mypkg

import _ "unsafe"

//go:linkname pipe2 syscall.pipe2
func pipe2(p []int, flags int) (err error)
```

On non-Linux platforms the file is skipped entirely; the linkname has no effect. This is the standard library's approach for OS-specific bridging.

When you write linkname-based code, gate it behind build tags that match the runtime versions and platforms you know it works on:

```go
//go:build go1.20 && !go1.23
```

This file is only built on Go 1.20, 1.21, and 1.22 — versions where (hypothetically) the target symbol exists with the expected signature.

---

## 7. Reading the symbol table

You can verify the result with `go tool nm`:

```bash
$ go build -o app .
$ go tool nm app | grep nanotime
   0x000000000045a1c0 T runtime.nanotime
   0x000000000045a1c0 T main.runtimeNano
```

Two identifiers, the same address. The local declaration `main.runtimeNano` is aliased onto `runtime.nanotime`. This is the link-time equivalent of giving a C function two names.

---

## 8. Comparing with regular Go function calls

| Property | Normal exported call | `//go:linkname` |
|----------|----------------------|-----------------|
| Resolved at | Compile time | Link time |
| Visibility | Respects capitalization | Bypasses capitalization |
| Signature checked | Yes, by compiler | **No**, programmer-responsible |
| Stable across versions | Yes (Go 1 promise) | **No** |
| Inlining possible | Often, especially small funcs | Rare; usually no body to inline |

The signature row is the trap. A renamed parameter type in `runtime` does not break your build — it breaks your runtime, possibly in a way that takes weeks to diagnose.

---

## 9. Stdlib patterns you will recognize

Inside the `time` package, the runtime clock is imported like this:

```go
// src/time/time.go

import _ "unsafe"

// runtimeNano returns the current value of the runtime clock in nanoseconds.
//
//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64
```

Inside the `sync` package, the mutex acquire/release goroutine primitives are imported the same way:

```go
// src/sync/runtime.go

import _ "unsafe"

//go:linkname runtime_Semacquire sync.runtime_Semacquire
func runtime_Semacquire(s *uint32)

//go:linkname runtime_Semrelease sync.runtime_Semrelease
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)
```

Note that the `sync` two-argument linkname's *importpath* is `sync` itself, not `runtime`. That is because **the runtime is the one that announces the symbol with a one-argument linkname pointing at `sync.runtime_Semacquire`**. The `sync` package just declares the name that the runtime promised to provide.

This indirection is intentional: `runtime` knows nothing about `sync`'s import path conventions; it simply publishes symbols under names that other packages choose.

---

## 10. Variable linking

Functions are the common case, but variables work too:

```go
import _ "unsafe"

//go:linkname startNanoTime runtime.startNanoTime
var startNanoTime int64
```

Now `startNanoTime` is the **same word in memory** as `runtime.startNanoTime`. Reads see whatever the runtime wrote; writes are visible to the runtime.

This is more dangerous than function linking because data layout can be more fragile than function signatures — adding a field to a struct shifts every subsequent offset. Use only for primitive types whose representation is settled (`int64`, `uintptr`, `bool`).

---

## 11. The compiler does not validate signatures

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano(extra string) (int64, error)   // wrong signature
```

This **compiles**. The compiler emits a call site that passes one `string` argument on the stack and expects an `int64` plus an `error` returned. At runtime, the call jumps into `runtime.nanotime`, which expects no arguments and returns one `int64`. The result is stack corruption.

There is no `-vet` warning. The signature mismatch is undetectable from the source file containing the linkname; it requires cross-referencing the target package's source. This is the worst single source of subtle bugs in any code that uses the directive.

---

## 12. Multiple linknames in one file

A file can contain any number of linkname directives. The convention in the standard library is to group them at the top of a file dedicated to runtime bridging:

```go
package sync

import _ "unsafe"

//go:linkname runtime_Semacquire sync.runtime_Semacquire
func runtime_Semacquire(s *uint32)

//go:linkname runtime_Semrelease sync.runtime_Semrelease
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)

//go:linkname runtime_SemacquireMutex sync.runtime_SemacquireMutex
func runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int)
```

Keeping them together makes it easy to audit and to update when a runtime release changes a signature.

---

## 13. Common middle-level mistakes

| Mistake | Symptom | Detection |
|---------|---------|-----------|
| Missing `import _ "unsafe"` on Go 1.23+ | Compile error | Build with `go1.23` |
| Body present with linkname | Compile error | `go build` |
| Blank line between directive and decl | Directive ignored, body required | Hand inspection |
| Wrong import path | Linker error at end of build | `go build` |
| Wrong signature | Wrong runtime behavior, may crash | Read the runtime source |
| Linkname target removed in new Go | Linker error | CI matrix across Go versions |

A CI job that builds against `go1.21`, `go1.22`, `go1.23`, and `go1.24` catches most of these before a release ships.

---

## 14. Summary

`//go:linkname` rewrites the symbol name the linker uses for a local declaration. The two-argument form consumes a symbol from another package; the one-argument form publishes a symbol for others. The directive bypasses Go's export rules and signature checks. It is the link-time bridge between the standard library and the runtime, and as of Go 1.23 it requires a blank `import _ "unsafe"`. Verify resolution with `go tool nm`, group linknames in dedicated files, gate them behind build tags matching the Go versions you support, and read the target package's source whenever you upgrade Go.

---

## Further reading
- `cmd/compile` directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- Sample stdlib bridge: https://github.com/golang/go/blob/master/src/sync/runtime.go
- `cmd/link` internals: https://github.com/golang/go/tree/master/src/cmd/link
