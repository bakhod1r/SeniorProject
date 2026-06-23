# Struct Memory Layout — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. You'll need Go 1.21+ and a 64-bit machine. A 32-bit cross-compile target (`GOARCH=386` or `GOARCH=arm`) helps for Task 6.

---

## Task 1: Print every field's offset

Write a program that introspects a struct and prints each field's offset and size.

**Acceptance criteria**

- [ ] Define a struct with at least 5 fields of varying types (`bool`, `int32`, `int64`, `string`, `[]byte`).
- [ ] Use `unsafe.Offsetof` and `unsafe.Sizeof` to print, for each field: name, type, offset, size.
- [ ] Print the total `unsafe.Sizeof` of the struct.
- [ ] Compute and print the total padding bytes (struct size minus sum of field sizes).
- [ ] Re-implement the same listing using `reflect.TypeOf` and verify both outputs agree.

---

## Task 2: Reorder the struct to shrink it

Use the listing from Task 1 to find a smaller order.

**Acceptance criteria**

- [ ] Start with a deliberately bad struct (`struct { a bool; b int64; c bool; d int64; e bool }`). Record its `Sizeof`.
- [ ] Reorder fields large→small and re-record `Sizeof`.
- [ ] Verify the reduction is at least 25 %.
- [ ] Run `fieldalignment` against the original and the reordered version; the original should report a finding, the reordered should not.
- [ ] Document why each padding byte appears in the original.

---

## Task 3: Run `fieldalignment` against a real codebase

Install the analyzer and run it.

**Acceptance criteria**

- [ ] Install: `go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest`.
- [ ] Run `fieldalignment ./...` against any Go project you maintain.
- [ ] Record the number of findings and the total potential byte savings.
- [ ] Pick one struct, apply the fix manually, and rerun the analyzer to confirm the finding is gone.
- [ ] Document one struct you would **not** fix (e.g. wire-format struct) and explain why.

---

## Task 4: Build a `structlayout` clone

Write a tiny CLI that prints a struct's layout as an ASCII diagram.

**Acceptance criteria**

- [ ] Accept a Go source file and a struct name on the command line.
- [ ] Parse the file with `go/parser` and inspect the named struct via `go/types`.
- [ ] Print one line per field: `[offset+size] FieldName fieldType` (with padding bytes shown as `[ofs] *PADDING*`).
- [ ] Show the total size at the bottom.
- [ ] Test against a struct with mixed types and verify your output matches the real `unsafe.Sizeof`.

(Tip: if `go/types` feels too heavy, use `reflect` on a binary-loaded sample value instead.)

---

## Task 5: Demonstrate the zero-sized last-field rule

Confirm experimentally that a non-zero struct ending with `struct{}` gets +1 byte of padding.

**Acceptance criteria**

- [ ] Define `type A struct { x int32 }` and `type B struct { x int32; _ struct{} }`.
- [ ] Print `unsafe.Sizeof` for both. Verify `Sizeof(B) > Sizeof(A)`.
- [ ] Define `type C struct { _ struct{}; x int32 }` and verify `Sizeof(C) == Sizeof(A)` — the rule only applies when the zero-sized field is **last**.
- [ ] Define `type D struct{}` and verify `Sizeof(D) == 0`.
- [ ] Write a one-paragraph explanation of why the +1 byte exists (past-end pointer / GC).

---

## Task 6: Reproduce the 32-bit `atomic.AddInt64` misalignment

This requires cross-compiling for `GOARCH=arm` or `GOARCH=386` and running under qemu, or having a real 32-bit ARM device.

**Acceptance criteria**

- [ ] Write a struct with a `bool` followed by a `uint64`: `struct { enabled bool; count uint64 }`.
- [ ] In `main`, call `atomic.AddUint64(&s.count, 1)`.
- [ ] On `GOARCH=amd64` it works. On `GOARCH=arm` (under qemu-arm), it panics with a misalignment error.
- [ ] Apply fix A: move `count` to the first field. Verify it now works on arm.
- [ ] Apply fix B: replace `uint64` with `atomic.Uint64`. Verify it works on arm without reordering.
- [ ] Document both fixes and which one you'd choose in production.

---

## Task 7: Build a padded atomic counter

Implement a counter type immune to false sharing.

**Acceptance criteria**

- [ ] Define `type PaddedCounter struct { v atomic.Uint64; _ [56]byte }`.
- [ ] Verify `unsafe.Sizeof(PaddedCounter{}) == 64`.
- [ ] Write a benchmark with 4 such counters in an array, each incremented by a separate goroutine in parallel.
- [ ] Run with `go test -bench=. -cpu=1,2,4,8`. Record ns/op.
- [ ] Repeat the benchmark with unpadded `atomic.Uint64`s in an array. Verify the unpadded version regresses at high CPU count; the padded version scales.
- [ ] Document the ratio of unpadded-vs-padded at `GOMAXPROCS=8`.

---

## Task 8: Measure GC scan cost of pointer-heavy structs

Show that pointer-bytes affect GC time.

**Acceptance criteria**

- [ ] Define `type Heavy struct { a, b, c, d, e string }` (5 pointers).
- [ ] Define `type Light struct { a, b, c, d, e [32]byte }` (no pointers).
- [ ] Allocate `make([]Heavy, 1_000_000)` and `make([]Light, 1_000_000)` (separately).
- [ ] Run with `GODEBUG=gctrace=1` and record the scan time of one mark cycle for each.
- [ ] The pointer-heavy version should show significantly larger scan times.
- [ ] Document the difference and explain via "pointer bitmap bytes per allocation".

---

## Task 9: Hot/cold field split

Split a struct into hot (frequently accessed) and cold (rarely accessed) parts.

**Acceptance criteria**

- [ ] Start with a struct of 10+ fields where only 3 are read on a hot path.
- [ ] Write a benchmark that reads only those 3 fields in a tight loop over a slice of 1M structs.
- [ ] Refactor: keep the hot fields in the main struct; move cold fields to `*coldData` referenced by a pointer.
- [ ] Re-run the benchmark.
- [ ] Verify the hot-path benchmark is at least 20 % faster (cache locality win).
- [ ] Verify the cold-path benchmark is at most slightly slower (one pointer dereference).

---

## Task 10: Wire-format struct with explicit padding

Build a struct meant to be `mmap`'d or written to disk, with documented layout.

**Acceptance criteria**

- [ ] Define a struct intended as a 64-byte file header: magic (uint32), version (uint32), seq (uint64), reserved (padding to 64).
- [ ] Use explicit `_ [N]byte` fields for the padding (not implicit).
- [ ] In `init()`, panic if `unsafe.Sizeof(Header{}) != 64`.
- [ ] In `init()`, panic if any field's `unsafe.Offsetof` doesn't match the documented spec.
- [ ] Add a `// nolint:fieldalignment` comment with a reason.
- [ ] Verify `fieldalignment ./...` does not report a finding on this struct (or that the lint-disable works).

---

## Task 11: Bool-to-bitfield packing

Convert a struct with many bools to a packed bitfield.

**Acceptance criteria**

- [ ] Start with a struct containing 16 `bool` fields.
- [ ] Record `unsafe.Sizeof` (expect 16 + trailing padding).
- [ ] Refactor to a struct with one `uint16` and helper methods (`Set(bit)`, `Has(bit)`, `Clear(bit)`).
- [ ] Verify the new `Sizeof` is 2 (or 8 within a larger struct).
- [ ] Write a benchmark comparing read latency. Verify the bitfield version is at most 2× slower per access (often equal).
- [ ] Document the trade-off in code comments.

---

## Task 12: Apply `fieldalignment` in CI

Add a CI gate that fails when struct alignment regresses.

**Acceptance criteria**

- [ ] Add `fieldalignment` to a `tools.go` build constraint to pin the version.
- [ ] Add a CI step (GitHub Actions / GitLab CI / etc.) that runs `fieldalignment ./...` and fails on non-zero exit.
- [ ] Verify the gate fires by intentionally regressing a struct in a PR and confirming CI fails.
- [ ] Verify the gate passes after the regression is fixed.
- [ ] Document the policy in `CONTRIBUTING.md`: "Run `fieldalignment -fix ./pkg/...` before submitting."

---

## Task 13: Shrink a real production struct (50+ %)

Take a struct from an open-source project (or your own) and measurably shrink it.

**Acceptance criteria**

- [ ] Pick a struct allocated > 10 000 times in normal program use.
- [ ] Profile with `pprof -inuse_objects` to confirm it's a hot allocator.
- [ ] Apply layout optimization: reorder, replace `time.Time` with `int64` if applicable, intern strings if applicable.
- [ ] Measure the new `unsafe.Sizeof` and the new `HeapAlloc` under realistic load.
- [ ] Open a PR (or write up a private design doc) explaining: original size, new size, total memory saved at observed allocation rate, any trade-offs in API or behaviour.
- [ ] Bonus: measure GC pause time before and after. Often there's a 5–15 % improvement.

---

## 14. Summary

These thirteen tasks walk the full surface of Go struct layout: introspect (`unsafe.Sizeof`, `reflect`), measure (`fieldalignment`, `structlayout`), optimize (reorder, hot/cold split, bitfield packing, padded atomics), and verify (CI gate, init-time assertions, benchmarks). The recurring theme: **measure before, measure after**. Layout changes are easy to write and easy to over-claim — always confirm the win in a profile or a benchmark, not just in `Sizeof`.

---

## Further reading

- `unsafe` package: https://pkg.go.dev/unsafe
- `fieldalignment` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- `structlayout`: https://pkg.go.dev/honnef.co/go/tools/cmd/structlayout
- Go compiler `size.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/types/size.go
- `sync/atomic` typed wrappers (Go 1.19+): https://pkg.go.dev/sync/atomic
