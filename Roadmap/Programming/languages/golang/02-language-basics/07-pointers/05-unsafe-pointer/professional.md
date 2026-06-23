# Unsafe Pointer — Professional

## 1. The production framing

Shipping code that uses `unsafe.Pointer` is a different discipline from writing it. The compiler doesn't help, code review must compensate, every reviewer must speak the rules, and the post-deploy debugging surface includes "intermittent corruption that never reproduces". This file is the production playbook: when reaching for `unsafe.Pointer` is justified, how to package it so the unsafe surface area is small, how to test it, and how to monitor for the bugs that escape testing.

The cardinal rule of `unsafe` in production: **isolate, document, test, and pay attention.** Spread `unsafe.Pointer` calls through your codebase and you have no chance of auditing them. Confine them to a single package with `// unsafe:` comments on every site and you have a chance.

---

## 2. Legitimate production uses

These are the patterns that earn their `unsafe` budget in real services. Anything else, prefer the safe alternative.

| Use case | Pattern | Why |
|----------|---------|-----|
| Zero-copy `[]byte` ↔ `string` in JSON / log encoders | `unsafe.String` + `unsafe.SliceData` | Saves allocation per request; measurable in p99 |
| Reading fixed-layout binary headers (network packets, file formats) | `(*T)(unsafe.Pointer(&buf[0]))` | Avoids per-field `binary.Read` calls; 5–10× faster |
| mmap regions as typed slices | `unsafe.Slice` over the mmap pointer | The whole point of mmap is zero-copy view |
| Cgo: passing Go memory to a C function | `unsafe.Pointer` + `runtime.Pinner` | No alternative |
| Accessing unexported runtime fields (`runtime.MemStats` internals, scheduler stats) | `//go:linkname` + `unsafe.Pointer` | Last resort for observability that isn't otherwise exposed |
| Custom hash tables / arenas / pools where layout is hand-optimized | Pattern 1 (re-type) | Same allocator can serve multiple types via the same chunk |

What does **not** earn its budget:

| "Optimization" | Why it's wrong |
|---------------|----------------|
| "Faster than `*T`" generic pointer | They're the same at runtime |
| "Reading an unexported field of another package" | Usually a sign of API misuse; ask for an export |
| "Avoiding a type assertion" | The assertion is faster than the `unsafe` machinery to set up |
| "Skipping a bounds check" | The bound check is a single compare; `unsafe.Add` doesn't remove it from the loop |

If a teammate proposes `unsafe.Pointer` outside the first table, push back. The default answer is "no" unless there's a benchmark.

---

## 3. Zero-copy `[]byte` ↔ `string` in production

The most common production pattern. Modern API:

```go
package zerocopy

import "unsafe"

// BytesToString returns a string that aliases the bytes of b.
// The caller must NOT mutate b after calling this. The returned string's
// lifetime is bounded by b's lifetime.
func BytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}

// StringToBytes returns a byte slice that aliases the bytes of s.
// The caller must NOT mutate the returned slice. Doing so corrupts s
// and any string sharing the same backing array.
func StringToBytes(s string) []byte {
    if s == "" {
        return nil
    }
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

Place this in one package. Every caller of `unsafe`-typed string/byte conversion goes through it. Code review focuses on the *callers* — they're the ones whose contracts must say "doesn't mutate".

The cost without `unsafe`:

```go
s := string(b)   // allocates len(b) bytes, copies them
b := []byte(s)   // same, the other way
```

For a JSON encoder writing 100 fields, that's 100 allocations and 100 copies per request. At 10 000 RPS, that's 1 million allocations per second and the corresponding GC pressure. Replacing with `BytesToString` / `StringToBytes` in the hot path cuts allocation count to zero for the string ↔ byte conversion.

Benchmark before, benchmark after, decide. The 1.20-era `string([]byte)` for short strings (< 32 bytes) can sometimes be stack-allocated by the compiler, so the win may be smaller than expected.

---

## 4. mmap and zero-copy ingestion

For large file or shared-memory workloads, `mmap` + `unsafe.Slice` is the canonical pattern:

```go
package mmap

import (
    "os"
    "syscall"
    "unsafe"
)

type Region struct {
    addr unsafe.Pointer
    size int
}

func Open(path string) (*Region, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    defer f.Close()

    info, err := f.Stat()
    if err != nil { return nil, err }
    size := int(info.Size())

    data, err := syscall.Mmap(int(f.Fd()), 0, size,
        syscall.PROT_READ, syscall.MAP_SHARED)
    if err != nil { return nil, err }

    return &Region{
        addr: unsafe.Pointer(&data[0]),
        size: size,
    }, nil
}

func (r *Region) AsBytes() []byte {
    return unsafe.Slice((*byte)(r.addr), r.size)
}

func (r *Region) AsUint64s() []uint64 {
    if r.size%8 != 0 {
        panic("region size not a multiple of 8")
    }
    return unsafe.Slice((*uint64)(r.addr), r.size/8)
}

func (r *Region) Close() error {
    return syscall.Munmap(unsafe.Slice((*byte)(r.addr), r.size))
}
```

The `AsBytes` / `AsUint64s` views share the same underlying memory. Reads from disk happen lazily as the kernel pages in the mmap region. For a 10 GiB file, you allocate zero Go heap memory to make all of it readable.

Three production cautions:

1. **Alignment.** `AsUint64s` requires 8-byte alignment of `r.addr`. `mmap` always returns page-aligned pointers (4 KiB on Linux), so this is satisfied — but document it.
2. **Lifetime.** The returned slice's backing memory is freed by `Munmap`. After `r.Close()`, any slice you held is dangling. Don't hand them out beyond the `Region`'s lifetime.
3. **Mutation.** `PROT_READ` mmap is read-only at the OS level; writes fault with `SIGSEGV`. If you map `PROT_READ|PROT_WRITE`, mutating the slice rewrites the file (page cache + writeback). This is a feature, not a bug, but production code must be explicit about which it is.

---

## 5. Hardening unsafe code: contracts, panics, and assertions

Code that uses `unsafe.Pointer` should fail loudly when its assumptions break, not silently corrupt memory.

```go
package layoutchecks

import (
    "fmt"
    "unsafe"
)

type Packet struct {
    Magic   uint32
    Version uint16
    Flags   uint16
    Length  uint64
}

// Verify layout assumptions at package init. If the runtime layout changes
// (compiler version, GOARCH change, struct edit), the program panics
// at startup instead of corrupting data later.
func init() {
    if got, want := unsafe.Sizeof(Packet{}), uintptr(16); got != want {
        panic(fmt.Sprintf("Packet size: got %d, want %d", got, want))
    }
    if got, want := unsafe.Offsetof(Packet{}.Length), uintptr(8); got != want {
        panic(fmt.Sprintf("Packet.Length offset: got %d, want %d", got, want))
    }
    if got := unsafe.Alignof(Packet{}); got != 8 {
        panic(fmt.Sprintf("Packet alignment: got %d, want 8", got))
    }
}
```

If a Go version changes struct padding, or someone edits the struct, the program crashes at startup with a clear message — instead of producing wrong bytes for a year.

For runtime-input validation:

```go
func ParsePacket(buf []byte) (*Packet, error) {
    const sz = unsafe.Sizeof(Packet{})
    if uintptr(len(buf)) < sz {
        return nil, fmt.Errorf("packet: short buffer, got %d want %d", len(buf), sz)
    }
    addr := uintptr(unsafe.Pointer(&buf[0]))
    if addr%unsafe.Alignof(Packet{}) != 0 {
        // Alignment check — fail rather than return a misaligned *Packet
        return nil, fmt.Errorf("packet: buffer not %d-byte aligned", unsafe.Alignof(Packet{}))
    }
    return (*Packet)(unsafe.Pointer(&buf[0])), nil
}
```

The alignment check is the difference between a SIGBUS on ARM in production and a clean error message in the API layer.

---

## 6. Cgo interop in production

The canonical production cgo pattern uses `runtime.Pinner` (Go 1.21+):

```go
package ffi

/*
#include <stdint.h>
void process(const uint8_t *data, size_t len);
*/
import "C"

import (
    "runtime"
    "unsafe"
)

// CallProcess passes a Go-allocated buffer to a C function that may store
// the pointer briefly.
func CallProcess(buf []byte) {
    var pinner runtime.Pinner
    if len(buf) > 0 {
        pinner.Pin(&buf[0])
    }
    defer pinner.Unpin()

    if len(buf) == 0 {
        C.process(nil, 0)
        return
    }
    C.process((*C.uint8_t)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
}
```

`Pin` keeps the address stable across the C call — no stack-grow, no GC move, no surprise. `Unpin` releases the pin. This is the **only** safe way to pass mutable Go memory to a C function that will hold the pointer.

Without `Pinner`, the rules in [cgo's pointer-passing FAQ](https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers) require that the C code not retain the pointer beyond the call. Many C APIs (callbacks, async I/O setups) can't honor that, so pre-1.21 the workaround was `C.malloc` + copy. `Pinner` removes the cost.

For C-allocated memory returned to Go, the inverse:

```go
func ReadFromC() []byte {
    var cdata *C.uint8_t
    var clen C.size_t
    C.read_data(&cdata, &clen)
    defer C.free(unsafe.Pointer(cdata))   // C owns the memory

    // Copy into a Go-owned slice for use beyond the function.
    return C.GoBytes(unsafe.Pointer(cdata), C.int(clen))
}
```

`C.GoBytes` copies. The version that aliases (`unsafe.Slice((*byte)(unsafe.Pointer(cdata)), int(clen))`) is faster but means the Go slice dangles after `C.free`. Choose explicitly; document the choice.

---

## 7. Testing strategy: `-race`, `checkptr`, and table-driven layout tests

Three layers of automated testing for `unsafe`-touching code:

| Layer | Tool | What it catches |
|-------|------|-----------------|
| Unit tests | `go test` | Behaviour: input → output |
| `-race` | `go test -race` | Aliased writes from concurrent goroutines |
| `checkptr` | `go test -gcflags=all=-d=checkptr` | Alignment, bounds, pointer validity |

A typical CI config for an `unsafe`-heavy package:

```yaml
test:
  steps:
    - go vet ./...
    - go test ./...
    - go test -race ./...
    - go test -gcflags=all=-d=checkptr ./...
    - go test -fuzz=. -fuzztime=60s ./unsafepath/...
```

Fuzz tests are particularly effective for parsing code that uses `unsafe`: they generate inputs the human reviewer didn't anticipate.

```go
func FuzzParsePacket(f *testing.F) {
    f.Add([]byte{0xDE, 0xAD, 0xBE, 0xEF, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0, 0, 0x2A})
    f.Fuzz(func(t *testing.T, in []byte) {
        p, err := ParsePacket(in)
        if err != nil {
            return // expected for malformed input
        }
        _ = p.Length // shouldn't panic
    })
}
```

`checkptr` will catch any misaligned access produced by the fuzzer's inputs. Without it, the fuzzer might miss the bug on amd64 (which forgives misalignment) and only fail in production on ARM.

---

## 8. Code review checklist

A reviewable PR that touches `unsafe.Pointer` includes:

1. **A doc comment** on each function explaining the lifetime and mutability contract.
2. **An `init()` layout assertion** if the code depends on struct sizes or offsets.
3. **A `runtime.KeepAlive`** in any place where a value's address flows through `uintptr` or into a C call.
4. **A benchmark** justifying the `unsafe` usage. "It's faster" without numbers is not justification.
5. **A `-race` and `checkptr` CI gate** added to the package's test matrix.
6. **No `uintptr`-typed package-level variables.** Any `uintptr` should be a local, ideally inside a single expression.

If a PR fails any of these, request changes. The amount of effort `unsafe` takes upfront is much less than the effort to debug a heap corruption in production.

---

## 9. Build tags and platform isolation

`unsafe` code sometimes depends on architecture-specific assumptions (alignment, endianness, word size). Use build tags to isolate:

```go
// +build amd64 arm64

package fastparse

// 64-bit-specific zero-copy parser.
```

```go
// +build !amd64,!arm64

package fastparse

// Safe fallback for other architectures.
```

For endianness:

```go
import "encoding/binary"

var nativeEndian binary.ByteOrder = func() binary.ByteOrder {
    var x uint16 = 1
    if *(*byte)(unsafe.Pointer(&x)) == 1 {
        return binary.LittleEndian
    }
    return binary.BigEndian
}()
```

This `init` block determines endianness at startup. Pinning to little-endian for code that runs only on x86/ARM (which are little-endian in practice) is fine; but if you might ever ship to s390x or some PowerPC variant, write the fallback.

---

## 10. Observability and panic recovery

`unsafe` bugs typically manifest as one of:

- `fatal error: unexpected fault address 0x...` (segfault during a load)
- `panic: runtime error: index out of range` (slice header mismatch)
- `runtime: writebarrier ...` (GC barrier hit at an invalid pointer)
- Silent wrong data (worst case)

For the panic-recoverable cases, structured logging at the recovery point helps:

```go
defer func() {
    if r := recover(); r != nil {
        log.Error("panic in unsafe parse",
            slog.Any("recover", r),
            slog.String("stack", string(debug.Stack())))
        // Re-panic if you want the process to die; swallow if you have a fallback.
        panic(r)
    }
}()
```

For the silent-wrong-data case, defensive verification helps:

```go
result := fastParse(buf)
if validate(result) != nil {
    // fastParse produced garbage. Fall back to slowParse for this request,
    // and emit a metric so we can investigate.
    metrics.IncCounter("fast_parse_invalid_result")
    return slowParse(buf)
}
return result
```

The fallback path means a corrupted parse manifests as latency, not as wrong output to a user. The metric tells you it happened so you can investigate.

---

## 11. Profiling and benchmarking

The justification for `unsafe` is always performance. Benchmark before and after, on a realistic workload:

```go
func BenchmarkBytesToString_Safe(b *testing.B) {
    data := []byte(strings.Repeat("x", 1024))
    b.ResetTimer()
    var sink string
    for i := 0; i < b.N; i++ {
        sink = string(data)
    }
    _ = sink
}

func BenchmarkBytesToString_Unsafe(b *testing.B) {
    data := []byte(strings.Repeat("x", 1024))
    b.ResetTimer()
    var sink string
    for i := 0; i < b.N; i++ {
        sink = BytesToString(data)
    }
    _ = sink
}
```

Typical numbers on a 1 KiB byte slice:

```
BenchmarkBytesToString_Safe-8     5000000   320 ns/op   1024 B/op   1 allocs/op
BenchmarkBytesToString_Unsafe-8 200000000     0.5 ns/op      0 B/op   0 allocs/op
```

The 640× speedup is real; so is the zero-allocation result. For high-RPS services this compounds into measurable cost-per-request drops.

For the integration view, `go test -benchmem -cpuprofile=cpu.out -memprofile=mem.out`, then `pprof` to see whether the unsafe path actually dominates production CPU and allocations. If the safe path was 0.1% of CPU, the optimization doesn't pay back the review cost.

---

## 12. Migrating away from deprecated `reflect.SliceHeader` / `StringHeader`

Legacy code looks like:

```go
// Pre-1.20
func bytesToString(b []byte) string {
    sh := (*reflect.SliceHeader)(unsafe.Pointer(&b))
    var s string
    sth := (*reflect.StringHeader)(unsafe.Pointer(&s))
    sth.Data = sh.Data
    sth.Len = sh.Len
    return s
}
```

Modern replacement:

```go
// 1.20+
func bytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

The migration is mechanical but worth doing because:

- The old code triggers `staticcheck` warnings (`SA1019: reflect.StringHeader is deprecated`).
- The deprecation will likely tighten over time; the warning may become an error.
- The new code is checked by `unsafeptr`; the old code is grandfathered (not checked).
- The new code is shorter, more obviously correct, and self-documenting.

Write a CI gate that runs `staticcheck` with `SA1019` enabled. Any new use of `reflect.SliceHeader` or `reflect.StringHeader` fails the build.

---

## 13. Lifetime contracts and the `noescape` trap

A subtle production bug: a function returns a value whose memory is shared with an input that the caller frees.

```go
// BAD — returns a string aliasing the local buf, which dies when the
// caller goes out of scope.
func parseName(buf []byte) string {
    return unsafe.String(unsafe.SliceData(buf[10:30]), 20)
}

func handler() {
    raw := getBuffer()
    name := parseName(raw)
    putBuffer(raw)   // returns to pool, may be reused
    log.Print(name)  // name now aliases freed memory
}
```

The fix is either to copy (defeats the purpose of `unsafe`) or to document the lifetime contract:

```go
// parseName returns a string aliasing buf. The returned string is valid
// only as long as buf is not modified or freed. Caller must copy if the
// string needs to outlive buf.
func parseName(buf []byte) string {
    return unsafe.String(unsafe.SliceData(buf[10:30]), 20)
}
```

Then make the caller obey:

```go
name := strings.Clone(parseName(raw))   // explicit copy at the lifetime boundary
putBuffer(raw)
log.Print(name)
```

`strings.Clone` (Go 1.18+) does the copy you want, with an explicit name that says "I'm severing the aliasing". Audit usages of `parseName` for this pattern.

---

## 14. The runbook for "we shipped a corruption bug"

When a production incident is traced to `unsafe`:

1. **Roll back.** Don't try to hotfix `unsafe` code under time pressure. Revert to the last known-good binary.
2. **Reproduce locally** with `-race` and `-gcflags=all=-d=checkptr`. If those don't fail, try GOARCH=arm64 emulation (`GOARCH=arm64 go test ...`).
3. **Add the missing assertion.** If the bug was misalignment, add an `Alignof` check at the boundary. If it was lifetime, document and audit callers.
4. **Add the missing test.** A fuzz test, a `-race` test, a property test — whichever surfaces the bug deterministically.
5. **Decide if `unsafe` was justified at all.** Often "we shipped a corruption bug" is followed by "we removed the `unsafe` and the safe version is 5 % slower, which we can absorb". Sometimes that's the right answer.

The post-mortem must include: which of the six patterns was violated, why `vet`/`checkptr` didn't catch it, and what test would have caught it. If the team can't answer these three, the same class of bug will recur.

---

## 15. Summary

Production `unsafe.Pointer` is a discipline: isolate every use behind a documented wrapper, assert layout at init, plumb `runtime.Pinner` for cgo, gate every change behind `-race` and `-d=checkptr` in CI, and require a benchmark to justify the unsafe code path. The legitimate uses (zero-copy string conversion, mmap regions, cgo interop, fixed-layout parsers) are narrow; most "optimizations" don't pay back the review and operational cost. When an incident does happen, the runbook is: roll back, reproduce with the dynamic checkers, add the missing assertion and test, and re-litigate whether `unsafe` was justified. The next files go deeper into the precise specification, the interview rote-knowledge, and exercises to build the muscle memory.

---

## Further reading
- `runtime.Pinner` docs: https://pkg.go.dev/runtime#Pinner
- cgo pointer-passing rules: https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers
- `staticcheck` SA1019 (deprecation): https://staticcheck.dev/docs/checks/#SA1019
- Go testing fuzz documentation: https://go.dev/security/fuzz/
- `strings.Clone`: https://pkg.go.dev/strings#Clone
- `bytes.Clone`: https://pkg.go.dev/bytes#Clone
- Related: [unsafe-package](../../../11-advanced-topics/04-unsafe-package/)
- Related: [memory-management](../04-memory-management/)
