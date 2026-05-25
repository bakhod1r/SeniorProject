## `//go:linkname` Directive — Junior

## 1. A magic comment that bends the linker

You may have noticed lines that look like comments but seem important:

```go
//go:linkname nanotime runtime.nanotime
func nanotime() int64
```

That comment is a **compiler directive**. It tells the Go toolchain: "this local function is actually a different function from another package — link them together at build time."

In other words, the comment swaps out the symbol the linker uses for `nanotime` so that when your code calls `nanotime()` it really runs `runtime.nanotime()` from inside the Go runtime.

Notice two things:

1. The local function has **no body**. Just the signature.
2. The package being targeted is `runtime`, and `nanotime` starts with a lowercase letter — it is unexported. You should not be able to call it from outside the runtime package. The directive lets you do it anyway.

This is unusual power, and the rest of this page explains why it exists, when it is used, and why you almost never want to write it yourself.

---

## 2. Why does this exist?

The Go standard library has parts of itself that need to call into the runtime — for example, `sync.Mutex` needs to park and unpark goroutines. The goroutine APIs are not exported (they live in `runtime` with lowercase names), but the standard library has to reach them somehow.

The Go team had three options:

1. Export every internal runtime function publicly. That would freeze them as part of the Go 1 compatibility promise.
2. Put `sync.Mutex` inside the `runtime` package. That would create an import cycle and bloat the runtime.
3. Invent a special mechanism that lets specific files in specific packages call into specific runtime symbols.

They chose option 3. That mechanism is `//go:linkname`. It is an **internal tool** for the standard library, exposed as a directive that anyone can technically write, but supported only for stdlib use.

---

## 3. Where you actually see it

You will encounter `//go:linkname` in three places:

| Place | Example |
|-------|---------|
| Inside the Go standard library | `sync/runtime.go`, `time/time.go`, `os/wait_wait6.go` |
| Inside `golang.org/x/sys` (Go-supported repo) | Access to OS-level pieces not exposed elsewhere |
| Inside third-party libraries | Usually performance hacks; often broken on new Go versions |

You will **not** see it in well-written application code. If you are writing a web server, a CLI tool, or a typical library, you should not need it.

---

## 4. Reading a real example from `time`

The `time` package needs a monotonic clock reading. The standard library implements one in the runtime; the `time` package links it in:

```go
// time/time.go (paraphrased)

import _ "unsafe" // required by //go:linkname

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64
```

Now `time.Now()` can call `runtimeNano()` and end up running the runtime's monotonic clock function without `runtime.nanotime` having to be exported.

The `import _ "unsafe"` is a blank import. The `unsafe` package is not used anywhere in the file — the import is there to satisfy a compiler rule that took effect in Go 1.23.

---

## 5. The Go 1.23 rule: import `unsafe`

Before Go 1.23, you could use `//go:linkname` without importing `unsafe`. The Go team noticed that this made the directive too easy to scatter through code, so they tightened it.

In Go 1.23 and later:

```go
package mypkg

import _ "unsafe" // mandatory; the directive needs it

//go:linkname x runtime.something
var x int
```

If you forget the blank import, the compiler complains:

```
linkname directive must be used with import "unsafe"
```

This is a deliberate signal: "you are leaving the safe Go world." It is the same convention used to mark `unsafe.Pointer` use.

---

## 6. The basic syntax, briefly

There are two forms.

```go
//go:linkname localname importpath.name   // two-argument: link local to remote
//go:linkname localname                   // one-argument: expose local under that name
```

The two-argument form is what you will see and (rarely) write. The one-argument form is used inside the runtime to announce: "this symbol is available for other packages to link against."

The directive must be on the line **directly above** the declaration. A blank line between them, and the directive is silently ignored.

---

## 7. Why you usually should not write it

The directive is the most fragile mechanism in Go. Three things can break it:

1. **The target gets renamed.** `runtime.fastrand` is a famous example: it was renamed in Go 1.21 and any code that linked to it stopped compiling.
2. **The target's signature changes.** The compiler accepts any local signature; if the remote function now takes one more argument, calls produce memory corruption.
3. **The target is removed.** Nothing in the Go 1 compatibility promise covers internal symbols.

In all three cases your code will not just fail to compile — it may compile and produce wrong results at runtime. You are gambling that the runtime's internals will not change for the lifetime of your binary.

---

## 8. The simple alternative: just call the public API

Most reasons people reach for `//go:linkname` evaporate when they read the public documentation:

| Want to do | Use this instead |
|------------|------------------|
| Read a fast monotonic time | `time.Since(start)` is already monotonic from Go 1.9 onwards |
| Generate a random number | `math/rand/v2` (Go 1.22+) is very fast and seeded automatically |
| Lock a mutex | `sync.Mutex` already calls the runtime internals for you |
| Schedule a goroutine | `go func() {}` |
| Access OS features | `golang.org/x/sys` exposes most of what is needed |

`//go:linkname` is the answer to **none** of the above for ordinary applications.

---

## 9. What to take away as a junior

If you remember one thing from this page, make it this: `//go:linkname` is a special-purpose tool for the Go standard library and its closest allies. When you see it in third-party code, treat it as a yellow flag — the code is making promises the Go team has not promised back.

If you are tempted to write it yourself, stop and search for the public API first. It almost certainly exists.

---

## 10. A safe demonstration to try locally

If you want to feel the directive in action without depending on internal symbols, you can do the simplest possible thing — link to `runtime.nanotime` and print it:

```go
package main

import (
	"fmt"
	_ "unsafe"
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

func main() {
	fmt.Println(nanotime())
}
```

Build it: `go run .`

Now imagine that a future Go release renames `runtime.nanotime`. Your code will fail to link, or worse, will link to something with a different return type and print garbage. This is exactly the risk you sign up for by writing the directive.

---

## 11. Summary

`//go:linkname` is a compiler directive that **renames a local symbol to point at another package's symbol at link time**, including unexported ones. The standard library uses it to bridge the gap between `runtime` and user-facing packages like `sync` and `time`. As of Go 1.23 the directive requires a blank `import _ "unsafe"`. For ordinary application code, you should not write it — every reasonable use case is covered by a public API that the Go team has committed to maintain.

---

## Further reading
- `cmd/compile` directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- Russ Cox on restricting `//go:linkname`: https://github.com/golang/go/issues/67401
- Go 1.23 release notes: https://go.dev/doc/go1.23
