# cgo Basics — Interview

Common interview questions about cgo.

---

## Q1. What does `import "C"` actually do?

It's a directive to the `cgo` tool, not a normal import. The comment block above it is C source code that cgo extracts, preprocesses, and bridges into the Go namespace via `C.*` identifiers.

---

## Q2. What's the cost of a cgo call?

About 100 ns on modern hardware — significantly more than a Go-to-Go call (~1 ns). The cost covers OS thread stack switching, state save/restore, and the function call itself.

---

## Q3. State the cgo pointer-passing rules.

Go pointers passed to C may not be retained by C past the call's return, and the memory they point at may not contain other Go pointers. C code may not store Go pointers in Go memory either.

---

## Q4. What is `runtime.LockOSThread` for in cgo?

Locks the calling goroutine to its current OS thread. Required when the C library uses thread-local state (OpenGL contexts, JNI environments, some signal handlers). Without it, consecutive cgo calls may run on different threads.

---

## Q5. Why do you need `C.free` after `C.CString`?

`CString` allocates memory using C's `malloc`. The Go GC doesn't know about that memory. Without `C.free`, you leak it.

---

## Q6. What does `runtime.KeepAlive` do for cgo?

Extends the lifetime of a Go object up to a specified program point, preventing the GC from collecting it while C still uses the underlying memory.

---

## Q7. What's the difference between `CGO_ENABLED=0` and `CGO_ENABLED=1`?

`CGO_ENABLED=1` enables cgo and includes the cgo runtime. `CGO_ENABLED=0` disables cgo entirely; the binary doesn't include cgo bridging code and falls back to pure-Go alternatives for stdlib pieces that have them.

---

## Q8. Can cgo code be cross-compiled?

Not easily. The default toolchain compiles host C code. Cross-compilation requires a cross C toolchain (e.g., `aarch64-linux-gnu-gcc`) or building inside a container for the target platform. Simpler: set `CGO_ENABLED=0` if your code permits.

---

## Q9. How do you call a Go function from C?

Export it with `//export FuncName`, then build the package with `-buildmode=c-archive` or `-buildmode=c-shared`. This produces a `.a` or `.so` library plus a generated `.h` that C code can link against.

---

## Q10. How does cgo interact with the goroutine scheduler?

A goroutine in a C call holds an OS thread (`M`) until the call returns. Other goroutines can run on other threads. If too many goroutines block in C simultaneously, the runtime spawns extra threads (up to a limit) to keep Go work moving.

---

## Q11. Can the race detector see C code?

No. `go build -race` instruments Go memory accesses; C accesses are invisible. Races crossing the cgo boundary may not be caught.

---

## Q12. What's the safest way to share data between Go and C?

Copy at the boundary. For Go → C: copy into a `C.malloc`'d buffer. For C → Go: copy via `C.GoString`/`GoBytes`. This eliminates lifetime questions and pointer-rule violations.

---

## Q13. What does `// #cgo pkg-config: foo` do?

cgo runs `pkg-config --cflags foo` and `pkg-config --libs foo` at build time and applies the results as C compile and link flags. Convenient when the library ships `.pc` files.

---

## Q14. Is cgo thread-safe?

Cgo itself is — but the C library you're calling may not be. Many C libraries have nuanced thread-safety (per-handle, global lock required, etc.). Check the library's documentation and synchronize at the cgo boundary if needed.

---

## Q15. How do you build a static cgo binary?

```bash
go build -ldflags='-linkmode=external -extldflags="-static"' ./...
```

Plus the C libraries you depend on must be available as static archives. Alpine's musl libc supports this well; glibc-based systems don't.

---

## Q16. Why are cgo binaries larger?

They include the cgo runtime (a few hundred KiB) and dynamically link libc. Static cgo binaries can include libc and any C dependencies, growing further.

---

## Q17. What's the rule about Go strings and C strings?

Go strings are not NUL-terminated and carry an explicit length. C strings are NUL-terminated `char*`. You can't pass a Go string directly to C; use `C.CString` (Go → C, you must free) or `C.GoString` (C → Go, copies).

---

## Q18. How would you handle errors from a C function?

Translate at the boundary: check the C return code, pull `errno` if relevant (via the two-result form), and return a proper Go `error`. Application code shouldn't deal with C error conventions.

---

## Q19. When should you choose cgo over a pure-Go alternative?

When the C library has no production-ready Go equivalent (specialized codecs, ML runtimes, niche syscalls), when the C boundary is wide (one call processes many items), and when the maintenance cost (build complexity, security updates) is acceptable.

---

## Q20. Bonus — describe a cgo bug you've debugged.

Open-ended. Strong answers identify the root cause (memory leak, pointer rule, thread safety), the diagnostic (memory profile, panic message, `GODEBUG=cgocheck=2`), and the fix. Bonus points for explaining how you isolated cgo into a small package afterward.

---

## Cheat sheet

- `import "C"` with C in the comment above; no blank line.
- `C.CString` + `defer C.free`.
- `C.GoString` copies.
- Pointer rules: no Go pointer in Go pointer.
- `runtime.KeepAlive` after async C calls.
- `runtime.LockOSThread` for thread-local C state.
- Cgo calls cost ~100 ns each.
- `CGO_ENABLED=0` for pure-Go builds.

---

## Further reading
- `cmd/cgo` documentation
- "Cgo is not Go" — Dave Cheney
