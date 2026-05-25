# Unsafe Pointer — Hands-on Tasks

Work through these in order. Each task has explicit acceptance criteria. You will need Go 1.21 or later (some tasks require `runtime.Pinner` and `sync.OnceValue`). Run every test with `-race` and at least once with `-gcflags="all=-d=checkptr"` — both will surface bugs the bare test won't.

---

## Task 1: Build a vet-clean zero-copy `bytesToString` / `stringToBytes`

Implement the canonical zero-copy converters using only the modern (Go 1.20+) API.

**Acceptance criteria**
- [ ] `bytesToString(b []byte) string` uses `unsafe.String(unsafe.SliceData(b), len(b))`.
- [ ] `stringToBytes(s string) []byte` uses `unsafe.Slice(unsafe.StringData(s), len(s))`.
- [ ] Both handle the empty-input case without panic (return `""` / `nil`).
- [ ] A test demonstrates that mutating `b` after `bytesToString(b)` changes the returned string's bytes (proves the alias).
- [ ] `go vet ./...` passes with no `unsafeptr` warnings.
- [ ] A benchmark shows the unsafe version is at least 10× faster than `string(b)` for a 1 KiB input.

---

## Task 2: Walk a struct via byte offsets

Write a function that reads each field of a struct using `unsafe.Add` and `unsafe.Offsetof`, without naming the fields directly.

**Acceptance criteria**
- [ ] Given `type Point struct { X, Y int64 }`, your function returns `(int64, int64)` reading both fields via `unsafe.Add(unsafe.Pointer(&p), unsafe.Offsetof(Point{}.X))` and the equivalent for `Y`.
- [ ] An `init()` block asserts that `unsafe.Sizeof(Point{}) == 16` and `unsafe.Offsetof(Point{}.Y) == 8`; if a future Go version changes layout, the program fails loudly at startup.
- [ ] `go vet ./...` passes.
- [ ] A unit test compares the unsafe accessor's result to direct field access.
- [ ] You confirm with `go build -gcflags="-m"` that `p` does or does not escape to heap; explain in a comment.

---

## Task 3: Reproduce and fix a `uintptr`-held-across-GC bug

Write a snippet that violates Pattern 2 (storing `uintptr` across statements), demonstrate the bug under `-race -gcflags=all=-d=checkptr`, then fix it.

**Acceptance criteria**
- [ ] The buggy version: takes `&x`, casts to `uintptr`, calls `runtime.GC()`, casts back, reads.
- [ ] You document the `go vet` warning produced (paste the exact line).
- [ ] You replace the broken code with the equivalent using `unsafe.Add` (or by keeping the value as `unsafe.Pointer` across statements).
- [ ] After fixing, `go vet` is clean and the test passes with `-race -gcflags=all=-d=checkptr`.
- [ ] Write 2–3 sentences explaining why the buggy version is wrong, referencing the GC.

---

## Task 4: Implement an mmap-backed `[]uint64` reader

Use `syscall.Mmap` and `unsafe.Slice` to expose a memory-mapped file as a `[]uint64`.

**Acceptance criteria**
- [ ] Create a file containing 1024 little-endian `uint64` values (write with `encoding/binary`).
- [ ] Open it via `syscall.Mmap` with `PROT_READ`, `MAP_SHARED`.
- [ ] Build a `[]uint64` view via `unsafe.Slice((*uint64)(unsafe.Pointer(&data[0])), 1024)`.
- [ ] Verify the slice's values match what you wrote.
- [ ] Document that `syscall.Mmap` returns page-aligned (4 KiB) memory, so the cast to `*uint64` is correctly aligned.
- [ ] Call `syscall.Munmap` to release; verify that subsequent reads from the slice are a segmentation fault (use `recover` or just accept the crash in a separate process).

---

## Task 5: Build a layout-asserting binary header parser

Write a parser for a fixed-layout 16-byte packet header. Assert the layout at `init()`.

**Acceptance criteria**
- [ ] `type Header struct { Magic uint32; Version uint16; Flags uint16; Length uint64 }`.
- [ ] `init()` panics if `unsafe.Sizeof(Header{}) != 16`, `unsafe.Offsetof(Header{}.Length) != 8`, or `unsafe.Alignof(Header{}) != 8`.
- [ ] `ParseHeader(buf []byte) (*Header, error)` returns a `*Header` aliased into `buf` if `len(buf) >= 16` and `&buf[0]` is 8-byte aligned.
- [ ] Returns an error (not a `*Header`) if the buffer is too short or misaligned.
- [ ] A fuzz test (`FuzzParseHeader`) runs for 60 s and confirms no input causes a panic the parser didn't return as an error.
- [ ] Test passes with `-gcflags="all=-d=checkptr"`.

---

## Task 6: Pass Go memory to a (mock) C callback using `runtime.Pinner`

Without setting up cgo (which is heavyweight for an exercise), simulate the pattern: register a Go callback that receives an `unsafe.Pointer`, and ensure the Pin survives a `runtime.GC()`.

**Acceptance criteria**
- [ ] You pin a `[]byte` via `runtime.Pinner.Pin(&buf[0])`.
- [ ] You start a goroutine that calls `runtime.GC()` 100 times.
- [ ] The pinned `[]byte` remains readable throughout.
- [ ] After `Unpin`, the test exits cleanly.
- [ ] Compare with a version that uses `runtime.KeepAlive(buf)` instead and explain in a comment when each is appropriate.

---

## Task 7: Replace deprecated `reflect.SliceHeader` usage

Find a real project on GitHub using `reflect.SliceHeader` (e.g., older versions of `bytes`, `encoding/json`, or a third-party library). Replicate the pattern locally, then convert it to the modern API.

**Acceptance criteria**
- [ ] You write a function using the legacy `reflect.SliceHeader` pattern (manual `Data`/`Len`/`Cap` assignment).
- [ ] You enable `staticcheck` and confirm it warns `SA1019: reflect.SliceHeader is deprecated`.
- [ ] You rewrite the same function using `unsafe.Slice` / `unsafe.SliceData`.
- [ ] Both versions produce the same result on a unit test suite of 5+ inputs.
- [ ] The new version is shorter (count lines).
- [ ] `go vet` and `staticcheck` are both clean on the new version.

---

## Task 8: Build a vet-clean pointer-arithmetic loop

Sum the `X` field of a `[]Item` using only `unsafe.Pointer` arithmetic, without indexing through `items[i]`.

**Acceptance criteria**
- [ ] `type Item struct { X int32; Y int32 }`.
- [ ] Your `sum(items []Item) int32` uses `unsafe.Add(p, uintptr(i)*unsafe.Sizeof(Item{}))` to walk through the slice.
- [ ] `go vet ./...` passes.
- [ ] A benchmark compares your unsafe version to the safe `for _, it := range items { s += it.X }` version.
- [ ] You document the benchmark result; the safe version should be the same speed or faster (the compiler optimizes range loops well). Explain why the unsafe code is therefore not a win here.

---

## Task 9: Demonstrate the alignment requirement on a `*int64` cast

Show that casting a `*byte` at an odd offset to `*int64` is invalid.

**Acceptance criteria**
- [ ] You build a `[]byte` of length 32 and slice it from offset 1: `slc := buf[1:9]`.
- [ ] You cast `(*int64)(unsafe.Pointer(&slc[0]))` and attempt to load.
- [ ] On amd64 the load works but is slow. On arm64 (use `GOARCH=arm64` cross-compile and run via Docker, or an actual ARM machine) the load may fault.
- [ ] You add a runtime alignment check using `uintptr(unsafe.Pointer(&slc[0])) % unsafe.Alignof(int64(0)) != 0` and return an error.
- [ ] A test confirms the check rejects the misaligned input and accepts the same data starting at an aligned offset.

---

## Task 10: `KeepAlive`-vs-`Pinner` decision tree

For each of the following scenarios, write code and choose `runtime.KeepAlive`, `runtime.Pinner`, or "no special handling".

**Acceptance criteria**
- [ ] Scenario A: synchronous syscall expecting `uintptr` for a pointer arg → choose, justify, code.
- [ ] Scenario B: async C callback that retains the pointer for 1 second → choose, justify, code.
- [ ] Scenario C: pure Go function called from your Go function (no C, no syscall) → choose, justify, code.
- [ ] Scenario D: `runtime.SetFinalizer` on an object that holds a fd; you need the fd to live until after a Read → choose, justify, code.
- [ ] In each case, explain in 2–3 sentences why the alternative would be wrong.

---

## Task 11: Build a vet-clean union-style value

Implement a 16-byte type that can be interpreted as either a `struct{ a, b int64 }` or a `[2]int64`, sharing storage.

**Acceptance criteria**
- [ ] `type Union [16]byte` (or equivalent).
- [ ] Method `AsStruct() *(struct{ A, B int64 })` returns a `*` to the same memory.
- [ ] Method `AsArray() *[2]int64` returns a `*` to the same memory.
- [ ] An `init()` block asserts that `unsafe.Sizeof(Union{}) == 16` and `unsafe.Alignof(Union{}) >= 8`.
- [ ] A test demonstrates that writing through `AsStruct().A` is observable through `AsArray()[0]`.
- [ ] `go vet`, `-race`, and `-d=checkptr` all clean.

---

## Task 12: CI gate for an unsafe-touching package

Set up a GitHub Actions workflow that runs the full safety gate on every push.

**Acceptance criteria**
- [ ] `.github/workflows/unsafe-check.yml` includes the steps:
  - `go vet ./...`
  - `go test ./...`
  - `go test -race ./...`
  - `go test -gcflags="all=-d=checkptr" ./...`
  - `staticcheck -checks=SA1019 ./...`
- [ ] All steps pass on a clean PR.
- [ ] You commit a deliberately broken `unsafe`-using function (uses `reflect.SliceHeader` directly), open a PR, and confirm CI fails on the `staticcheck` step.
- [ ] You fix the function and confirm CI passes.
- [ ] Document in a README how each step contributes to safety.

---

## 13. Summary

These twelve tasks walk the full lifecycle of `unsafe.Pointer` work: writing the canonical zero-copy converters, exercising all six valid patterns, reproducing the most common bugs, and building the CI gate that prevents regressions. By the end you should be able to read other people's `unsafe` code with confidence, write your own with discipline, and recognize the line between "earned its budget" and "should be removed". The next file (`find-bug.md`) presents twelve realistic broken snippets to test that recognition.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `runtime.Pinner`: https://pkg.go.dev/runtime#Pinner
- `unsafeptr` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/unsafeptr
- `staticcheck SA1019`: https://staticcheck.dev/docs/checks/#SA1019
- Go fuzzing tutorial: https://go.dev/security/fuzz/
- Sibling: [pointers-basics](../01-pointers-basics/)
