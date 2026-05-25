# cgo Basics — Find the Bug

Common cgo bugs with cause and fix.

---

## Bug 1: Forgetting to `C.free`

```go
func encode(s string) {
    cs := C.CString(s)
    C.process(cs)
    // missing: C.free(unsafe.Pointer(cs))
}
```

**Symptom.** Memory leak. RSS grows steadily, `HeapAlloc` stays flat.

**Cause.** `C.CString` allocates with `malloc`; only the Go side is tracked by the GC.

**Fix.**

```go
cs := C.CString(s)
defer C.free(unsafe.Pointer(cs))
C.process(cs)
```

---

## Bug 2: Go pointer to Go pointer

```go
type Req struct {
    Data []byte
}

req := &Req{Data: make([]byte, 100)}
C.process(unsafe.Pointer(req))   // panic: cgo argument has Go pointer to Go pointer
```

**Symptom.** Runtime panic with "Go pointer to Go pointer".

**Cause.** `*Req` is a Go pointer, and `req.Data` is also a Go pointer (slice header). The rule: Go pointers passed to C must not point at memory containing other Go pointers.

**Fix.** Either pass the data alone, or copy to a C-allocated buffer:

```go
cbuf := C.malloc(C.size_t(len(req.Data)))
defer C.free(cbuf)
C.memcpy(cbuf, unsafe.Pointer(&req.Data[0]), C.size_t(len(req.Data)))
C.process(cbuf)
```

---

## Bug 3: C retains a Go pointer

```go
buf := make([]byte, 1024)
C.set_callback_buffer(unsafe.Pointer(&buf[0]))
// some time later, C calls back using that pointer
```

**Symptom.** Eventually reads garbage; possibly crashes.

**Cause.** The runtime doesn't know C is holding the pointer. The slice can be moved (during stack growth) or freed (if `buf` becomes unreachable).

**Fix.** Use C memory for anything C will hold beyond the call:

```go
cbuf := C.malloc(1024)
defer C.free(cbuf)
C.set_callback_buffer(cbuf)
// fill cbuf via memcpy or by getting C to write to it
```

---

## Bug 4: Missing `runtime.KeepAlive`

```go
buf := make([]byte, 4096)
ret := C.long_running_io((*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
return int(ret), nil
// buf could be GC'd before C returns if it's not used after this line
```

**Symptom.** Sporadic crashes under GC pressure; works fine in tests, fails in production.

**Cause.** The compiler may consider `buf`'s last Go use to be the `&buf[0]` evaluation. A concurrent GC could move/collect the underlying memory before the C call completes.

**Fix.**

```go
ret := C.long_running_io((*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
runtime.KeepAlive(buf)
return int(ret), nil
```

---

## Bug 5: Thread-unsafe C library

```go
// Many goroutines call this concurrently
func Lookup(key string) string {
    return C.GoString(C.lib_lookup(C.CString(key)))
}
```

**Symptom.** Random crashes, garbage results.

**Cause.** The C library uses static internal state; multiple goroutines stomp on it.

**Fix.** Serialize via a mutex, or use a worker goroutine pattern.

```go
var libMu sync.Mutex

func Lookup(key string) string {
    libMu.Lock()
    defer libMu.Unlock()
    cs := C.CString(key)
    defer C.free(unsafe.Pointer(cs))
    return C.GoString(C.lib_lookup(cs))
}
```

---

## Bug 6: `LockOSThread` missing for GUI

```go
func main() {
    initGLContext()      // OpenGL
    for {
        renderFrame()    // may run on a different OS thread each iteration
    }
}
```

**Symptom.** OpenGL calls fail intermittently; "context current" errors.

**Cause.** OpenGL contexts are thread-bound. Without `LockOSThread`, Go may schedule the goroutine on different threads.

**Fix.**

```go
func main() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initGLContext()
    for { renderFrame() }
}
```

---

## Bug 7: Stale header path

```go
// #cgo CFLAGS: -I/opt/local/include
// #include <foo.h>
import "C"
```

**Symptom.** Build fails on a developer's machine; works on yours.

**Cause.** `/opt/local/include` doesn't exist on their system.

**Fix.** Use `pkg-config` when possible:

```go
// #cgo pkg-config: foo
import "C"
```

Or document the requirement in the README and provide a script to set `CGO_CFLAGS`.

---

## Bug 8: C function not visible to Go

```go
/*
void helper(int x);  // declaration only
*/
import "C"
```

**Symptom.** "undefined reference to `helper`" at link time.

**Cause.** Only a declaration, no definition. Cgo can't find the symbol.

**Fix.** Either provide a static definition in the preamble, or link against a library that defines it:

```go
/*
static void helper(int x) { /* impl */ }
*/
import "C"
```

Or:

```go
// #cgo LDFLAGS: -lmylib
// extern void helper(int x);  // defined in libmylib
import "C"
```

---

## Bug 9: `errno` lost across cgo

```go
ret := C.some_libc_func()
if ret < 0 {
    return fmt.Errorf("failed")   // can't see errno
}
```

**Symptom.** Error reports are useless.

**Cause.** Cgo doesn't propagate `errno` automatically.

**Fix.** Read `errno` immediately after the call:

```go
ret, err := C.some_libc_func()      // tuple form captures errno
if ret < 0 {
    return fmt.Errorf("failed: %w", err)
}
```

The two-result form of a C call captures `errno`-style errors.

---

## Bug 10: Long blocking C call freezing service

```go
for {
    select {
    case req := <-in:
        result := C.slow_blocking_op(req.arg)  // blocks 30 seconds
        req.res <- result
    }
}
```

**Symptom.** Service stops accepting requests under load; thread count climbs.

**Cause.** Each goroutine in a long C call holds an OS thread. With enough concurrent slow ops, the runtime hits its thread limit.

**Fix.** Bound concurrency:

```go
sem := make(chan struct{}, 32)

go func() {
    for req := range in {
        sem <- struct{}{}
        go func(r Req) {
            defer func() { <-sem }()
            r.res <- C.slow_blocking_op(r.arg)
        }(req)
    }
}()
```

---

## Bug 11: `unsafe.Pointer` arithmetic gone wrong

```go
arr := [4]C.int{1, 2, 3, 4}
p := unsafe.Pointer(&arr[0])
p = unsafe.Add(p, 100)        // past the array
C.use_int(*(*C.int)(p))         // reads garbage
```

**Symptom.** Garbage values or crashes.

**Cause.** Arithmetic past the original object is undefined.

**Fix.** Bound the arithmetic:

```go
for i := 0; i < len(arr); i++ {
    C.use_int(arr[i])
}
```

---

## Bug 12: Static binary build failure

```bash
go build -ldflags='-linkmode=external -extldflags="-static"' ./...
# /usr/lib/.../libssl.a not found
```

**Symptom.** Link fails with "library not found".

**Cause.** Distros often don't ship static archives. On Debian/Ubuntu, `libssl-dev` provides headers and a dynamic library only; you need `libssl-dev` plus the static archive from Alpine or a custom build.

**Fix.** Build inside an Alpine container, which ships static archives:

```dockerfile
FROM golang:1.24-alpine
RUN apk add --no-cache build-base openssl-dev openssl-libs-static
```

---

## Bug 13: cgo and `_test.go` test files

```go
// foo_test.go
package mypkg

/*
#include <something.h>
*/
import "C"

func TestFoo(t *testing.T) { C.something() }
```

**Symptom.** `go test` compiles slowly or fails on certain systems.

**Cause.** Test files using cgo carry all the platform requirements of normal cgo files. Adding cgo to tests can complicate CI for testing.

**Fix.** If possible, keep tests pure Go. If you need cgo in tests, ensure CI has the right C toolchain.

---

## 14. Summary

Cgo bugs cluster around: memory ownership (free, KeepAlive), pointer rules, thread safety, library paths, and build configuration. Each is preventable with discipline: paired allocations, mutex-guarded calls, `runtime.KeepAlive` after async C calls, and explicit toolchain dependencies. Capture these patterns in your cgo bridge package, and the application code can mostly ignore them.

---

## Further reading
- `cmd/cgo` pointer rules
- `runtime.KeepAlive` docs
- Cgo and threads: https://github.com/golang/go/wiki/cgo
