## `//go:linkname` Directive — Find the Bug

Realistic `//go:linkname` bugs, each with symptom, cause, and fix.

---

## Bug 1: Missing `import _ "unsafe"` on Go 1.23+

```go
package main

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

func main() {
    println(runtimeNano())
}
```

**Symptom.** Compile fails:

```
./main.go:3:1: linkname directive must be used with import "unsafe"
```

**Cause.** Go 1.23 requires every file with a `//go:linkname` directive to import `unsafe`, even if no symbol from `unsafe` is referenced.

**Fix.** Add the blank import:

```go
import _ "unsafe"
```

The import contributes nothing to the program except permission to use the directive. Place it with the other imports.

---

## Bug 2: A body next to a linkname

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64 {
    return 0
}
```

**Symptom.** Linker error at the end of the build:

```
duplicate symbol runtime.nanotime
```

Or, depending on Go version, a compile error: `runtimeNano: function with body conflicts with linkname`.

**Cause.** A function declaration with a body provides a definition. The linkname directive tells the linker the symbol is defined elsewhere. The linker now has two definitions.

**Fix.** Remove the body. The whole point of the directive is to borrow another package's body:

```go
//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64
```

---

## Bug 3: Blank line silently disables the directive

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime

func runtimeNano() int64
```

**Symptom.** Compile error: `missing function body`.

**Cause.** A blank line between the directive and the declaration breaks the association. The compiler treats the directive as a stray comment and the declaration as a normal body-less function (which is illegal).

**Fix.** Remove the blank line. Directives must be immediately above their declarations:

```go
//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64
```

This is one of the most subtle bugs because `gofmt` does **not** flag the blank line, and the error message points at the function, not the directive.

---

## Bug 4: Signature mismatch with the runtime target

```go
import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() (uint32, error)
```

**Symptom.** Builds fine. At runtime, the returned `error` is garbage — often a non-nil interface pointing at uninitialized memory. Calls that check `err != nil` behave randomly.

**Cause.** `runtime.fastrand` returns one `uint32`. The local declaration claims it returns `(uint32, error)`. The compiler accepts both signatures and emits ABI code expecting two return values. The runtime function writes only one, and the second return slot keeps whatever the stack happened to contain.

**Fix.** Match the target signature exactly:

```go
//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

There is no automatic check for this; you must read the runtime source. For runtime function signatures, the canonical reference is `src/runtime/stubs.go`.

---

## Bug 5: Mis-typed import path

```go
import _ "unsafe"

//go:linkname runtimeNano rumtime.nanotime
func runtimeNano() int64
```

**Symptom.** Compilation succeeds. Linking fails:

```
relocation target rumtime.nanotime not defined
```

Sometimes the error appears minutes into a large build.

**Cause.** The compiler does not validate the import path against the package's actual imports. Any string up to a period is accepted as a package name and only checked when the linker tries to resolve it.

**Fix.** Correct the spelling and re-build. Add an explicit sanity test:

```go
func TestRuntimeNanoLink(t *testing.T) {
    if runtimeNano() == 0 {
        t.Fatal("runtimeNano returned zero — linkname likely broken")
    }
}
```

A test that calls every linkname-bound function once is a cheap way to catch typos that escape code review.

---

## Bug 6: Target removed in newer Go version

```go
//go:build go1.21

import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

**Symptom.** Builds fine on Go 1.20. On Go 1.21:

```
relocation target runtime.fastrand not defined
```

**Cause.** `runtime.fastrand` was renamed in Go 1.21. The build tag `go1.21` includes the file on **all** Go versions ≥ 1.21, not "exactly 1.21".

**Fix.** Use a bounded build tag and provide a replacement for newer versions:

```go
// fastrand_pre122.go
//go:build go1.20 && !go1.22

import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

```go
// fastrand_post122.go
//go:build go1.22

import "math/rand/v2"

func fastrand() uint32 { return rand.Uint32() }
```

Note `go1.NN` build tags are *minimum* versions. Use the `!go1.MM` form to cap the upper bound.

---

## Bug 7: Calling a linked function before runtime init

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

var startupTime = runtimeNano()
```

**Symptom.** `runtimeNano()` returns 0 or a small bogus value when consumed by other package-level vars; behavior varies by Go version.

**Cause.** Package-level variable initialization runs **after** the runtime is up — but the order across packages is not what the source line order suggests. The monotonic clock is only initialized at a specific point in runtime startup, and calling `runtime.nanotime` before that point returns unreliable values.

**Fix.** Defer the call until at least `init()`:

```go
var startupTime int64

func init() {
    startupTime = runtimeNano()
}
```

Better yet, use `time.Now()` which has well-defined initialization semantics.

---

## Bug 8: Calling a `//go:nosplit` linked function from a stack-growing context

```go
import _ "unsafe"

//go:linkname newobject runtime.newobject
func newobject(typ unsafe.Pointer) unsafe.Pointer
```

**Symptom.** Random crashes, often `runtime: cannot allocate memory` or `unexpected fault address` at high goroutine load.

**Cause.** Many runtime-internal functions are marked `//go:nosplit` because they run on tiny stacks during scheduler operations. Calling them from a normal Go context may trigger nested allocations the runtime cannot service.

**Fix.** Do not link to runtime-internal allocator functions. If you genuinely need to allocate, use the language: `new(T)`, `make([]T, n)`, etc. The compiler emits the correct call sequence.

If you must, contain the call in a leaf function and avoid passing through it from arbitrary call sites.

---

## Bug 9: Aliased variable changed unexpectedly

```go
import _ "unsafe"

//go:linkname gcController runtime.gcController
var gcController struct { ... }
```

**Symptom.** The struct definition matches Go 1.20. After upgrading to Go 1.21, fields read back garbage; the layout changed.

**Cause.** Variable linkname requires the local type to match the remote type's memory layout. Runtime internal structs are routinely reshaped between releases — fields added, removed, reordered. Your local definition is now wrong.

**Fix.** Linking variables is far more fragile than linking functions. Avoid it entirely if possible. If you must, copy the **exact** current struct definition from the runtime source, build-tag-gate per Go version, and re-test on every release.

For diagnostics that look like this, use `runtime/metrics` instead — it provides versioned access to similar information.

---

## Bug 10: Multiple linknames in the same file, one fails

```go
import _ "unsafe"

//go:linkname a runtime.foo
func a()

//go:linkname b runtime.bar
func b()
```

**Symptom.** The linker reports an error about `runtime.bar`. You comment out the `b` linkname, and now `runtime.foo` errors too — even though it was fine before.

**Cause.** This is usually a build configuration mishap: the file has no build tags but contains symbols that exist only on some Go versions or platforms. When one symbol is missing, the linker reports the error and stops; the second linkname's resolution is not retried.

**Fix.** Split each linkname into its own file with its own build tags:

```go
// a_linkname.go
//go:build go1.20

//go:linkname a runtime.foo
func a()
```

```go
// b_linkname.go
//go:build go1.21

//go:linkname b runtime.bar
func b()
```

Now each linkname's failure mode is independent.

---

## Bug 11: Using `runtime.fastrand` for security

```go
import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() uint32

func newSessionToken() string {
    var b [16]byte
    for i := 0; i < 16; i += 4 {
        binary.LittleEndian.PutUint32(b[i:], fastrand())
    }
    return hex.EncodeToString(b[:])
}
```

**Symptom.** Security review flags predictable session tokens. Penetration tests show feasible session-fixation under load.

**Cause.** `runtime.fastrand` is a non-cryptographic PRNG seeded per-P at goroutine startup. With ~60 bits of internal state per P, observing a few outputs lets an attacker predict the next.

**Fix.** Use `crypto/rand`:

```go
import "crypto/rand"

func newSessionToken() string {
    var b [16]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}
```

`crypto/rand` is slower (microseconds, not nanoseconds) but security-grade. No session token generation hot path should ever care about the difference.

---

## Bug 12: Forgetting that linkname disables inlining

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

func hot(items []int) int64 {
    var sum int64
    for _, v := range items {
        sum += int64(v) * runtimeNano()
    }
    return sum
}
```

**Symptom.** Adding the linkname was supposed to speed up the loop. Benchmark shows it actually got slower than `time.Now().UnixNano()`.

**Cause.** `runtimeNano` cannot be inlined because the compiler has no body to inline. `time.Now().UnixNano()` can sometimes be inlined or partially inlined. In a tight loop, the call overhead of the linkname version may exceed the savings.

**Fix.** Measure both. If the result is inconclusive, prefer the public API. Or hoist the call out of the loop:

```go
now := runtimeNano()
for _, v := range items {
    sum += int64(v) * now
}
```

The hoist is usually the better optimization regardless of which clock you use.

---

## 13. Summary

Most `//go:linkname` bugs cluster around six themes: missing `unsafe` import (Go 1.23+), body-with-linkname conflicts, blank-line-disabled directives, signature mismatches that silently miscompile, build tags that do not actually constrain Go versions, and linking to runtime internals that change between releases. The bugs are unusual in Go because they cross compile-time, link-time, and runtime layers; only a CI matrix across Go versions reliably catches them. When in doubt, test that each linked function returns a sensible value on every supported Go release.

---

## Further reading
- `cmd/compile` directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- Go 1.23 release notes (linkname): https://go.dev/doc/go1.23
- `runtime/stubs.go` for canonical signatures: https://github.com/golang/go/blob/master/src/runtime/stubs.go
- `math/rand/v2`: https://pkg.go.dev/math/rand/v2
