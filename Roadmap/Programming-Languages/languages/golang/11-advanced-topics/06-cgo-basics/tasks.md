# cgo Basics — Hands-on Tasks

Work through these in order. Requires a C compiler.

---

## Task 1: First cgo program

Write a Go program that calls C's `printf` to print a greeting.

**Acceptance criteria**
- [ ] Builds with `go build`.
- [ ] Prints "Hello from C!" via `C.printf`.
- [ ] You explain the role of the comment block above `import "C"`.

---

## Task 2: String conversion

Implement a function `cToUpper(s string) string` that calls C's `toupper` on each character.

**Acceptance criteria**
- [ ] Returns "HELLO" for "hello".
- [ ] Uses `C.CString` with `defer C.free`.
- [ ] Uses `C.GoString` (or `C.GoStringN`) to return.

---

## Task 3: Bench the boundary

Write a benchmark for an empty C function `noop(void) {}` and an empty Go function `func noop() {}`.

**Acceptance criteria**
- [ ] Bench both.
- [ ] Report the ratio (should be roughly 100×).
- [ ] You write a one-sentence implication for hot loops.

---

## Task 4: Pointer-rule violation

Construct code that triggers the "Go pointer to Go pointer" panic. Then fix it.

**Acceptance criteria**
- [ ] You see the panic at runtime.
- [ ] You fix by copying to a C-allocated buffer.
- [ ] You explain the rule in your own words.

---

## Task 5: `KeepAlive` necessity

Write a C function that takes a buffer pointer, sleeps 100 ms, then writes to it. Call it from Go with a slice. Use `GODEBUG=gctrace=1` to force GC during the call.

**Acceptance criteria**
- [ ] Without `KeepAlive`, you can sometimes observe the issue (may be intermittent).
- [ ] With `KeepAlive`, the program is stable.
- [ ] You document the result.

---

## Task 6: pkg-config

Use `// #cgo pkg-config: zlib` to link against zlib and compute a CRC32.

**Acceptance criteria**
- [ ] Builds without explicit `LDFLAGS`.
- [ ] Computes the same CRC32 as Go's `hash/crc32`.

---

## Task 7: Export a Go function to C

Export `Multiply(a, b int) int` and build as a `c-archive`.

**Acceptance criteria**
- [ ] `go build -buildmode=c-archive` produces a `.a` and a `.h`.
- [ ] A small C program links against them and calls `Multiply(3, 4)`.

---

## Task 8: `LockOSThread`

Write a goroutine that calls a C function using `pthread_self()` 10 times and prints the thread ID. Run once without `LockOSThread`, once with.

**Acceptance criteria**
- [ ] Without lock: thread IDs may differ.
- [ ] With lock: thread IDs are identical.
- [ ] You explain when this matters in practice.

---

## Task 9: Worker pool for non-thread-safe C

Pretend a C function `do_thing(int)` is not thread-safe. Build a worker pattern that serializes calls through one goroutine.

**Acceptance criteria**
- [ ] Multiple callers can call concurrently.
- [ ] Underlying C function is called serially.
- [ ] Caller sees results in the order requested.

---

## Task 10: Static binary

Build a cgo program statically.

**Acceptance criteria**
- [ ] On Linux: `go build -ldflags='-linkmode=external -extldflags="-static"' .`
- [ ] `file ./binary` reports "statically linked" (or close).
- [ ] You document any extra dependencies (e.g., `musl-gcc` on Alpine).

---

## Task 11: Vendored C source

Add a tiny C library (`mylib.c`/`.h`) to your module and call it via cgo.

**Acceptance criteria**
- [ ] The C source is committed in `internal/cdep/`.
- [ ] Cgo flags use `${SRCDIR}` to find it.
- [ ] Reproducible build: clone, build, no extra setup.

---

## Task 12: Replace cgo with pure Go

Find a pure-Go equivalent for one of: SQLite, libcurl, libpng, openssl. Build a tiny demo of each.

**Acceptance criteria**
- [ ] Pure-Go version compiles without cgo (`CGO_ENABLED=0 go build .`).
- [ ] Functionality matches.
- [ ] Bench the two (within reason) and report.

---

## Stretch — Task 13: Cgo and `errno`

Write a Go wrapper around `open(2)` and `close(2)` via cgo. Translate `errno` to Go errors.

**Acceptance criteria**
- [ ] Opens an existing file, reads data, closes it.
- [ ] On error, the Go error contains the human-readable `errno` string.
- [ ] You use the two-return form of cgo to capture `errno`.

---

## Submission

Code + brief writeup per task. The goal: confident use of cgo with a clear understanding of when (and when not) to reach for it.
