# `unsafe` Package — Hands-on Tasks

Work through these in order. Go 1.20+ recommended.

---

## Task 1: Reinterpret a float

Write a function `floatBits(f float64) uint64` that uses `unsafe` to reinterpret the bytes.

**Acceptance criteria**
- [ ] Returns the same value as `math.Float64bits(f)`.
- [ ] You inspect the disassembly with `go tool objdump` and observe whether the compiler optimizes both forms identically.

---

## Task 2: `Sizeof` exploration

Print `unsafe.Sizeof` for: `int`, `int32`, `string`, `[]int`, `map[string]int`, `*int`, `bool`, `struct{}{}` (empty).

**Acceptance criteria**
- [ ] You note the result for each.
- [ ] You explain why the empty struct is zero.
- [ ] You explain why the map's "size" is just one pointer.

---

## Task 3: Field offsets

Define `type T struct { a bool; b int64; c byte }` and print the offset of each field plus the total size.

**Acceptance criteria**
- [ ] You compute the padding by hand and confirm with the output.
- [ ] You reorder the fields to minimize size, confirm the new size.
- [ ] You add `const _ = uint(unsafe.Sizeof(T{}) - 16)` to your test file to lock the layout.

---

## Task 4: Safe `b2s` / `s2b`

Write two functions using `unsafe.String` and `unsafe.Slice`:

```go
func b2s(b []byte) string
func s2b(s string) []byte
```

**Acceptance criteria**
- [ ] Both return correct results for non-empty input.
- [ ] Both handle empty input without panic.
- [ ] You write a test that demonstrates the "string mutation bug" by modifying the bytes after conversion.

---

## Task 5: A type-pun binary parser

Define `type Header struct { Magic [4]byte; Length uint32 }`. Write `parse(b []byte) Header` two ways:

1. Using `encoding/binary`.
2. Using `unsafe.Pointer` and `*Header` cast.

**Acceptance criteria**
- [ ] Both return the same struct for the same input.
- [ ] You bench both and report the ns/op and allocs/op.
- [ ] You note one platform where the `unsafe` version would silently break (big-endian).

---

## Task 6: `KeepAlive` in action

Construct a scenario where omitting `runtime.KeepAlive` would let the GC collect a buffer mid-use. Use a small C helper via cgo or simulate with a finalizer.

**Acceptance criteria**
- [ ] You demonstrate the failure (finalizer fires before the buffer is "done").
- [ ] You fix with `runtime.KeepAlive`.
- [ ] You write a comment explaining what `KeepAlive` does and doesn't guarantee.

---

## Task 7: Cache-line padding

Define a `Counter` struct of `uint64` and a `PaddedCounter` padded to 64 bytes.

**Acceptance criteria**
- [ ] You confirm sizes with `unsafe.Sizeof`.
- [ ] You write a benchmark with 8 goroutines each incrementing a separate `Counter` vs `PaddedCounter` (an array of 8).
- [ ] You observe better throughput with padding on a multi-core machine.

---

## Task 8: Lock-free linked list

Implement a single-producer-single-consumer queue using `atomic.Pointer[Node]`.

**Acceptance criteria**
- [ ] Push and Pop work concurrently from different goroutines.
- [ ] No data races under `go test -race`.
- [ ] You consider (and test) the ABA problem with a simple scenario.

---

## Task 9: Compile-time layout assertion

For a struct that maps to an on-wire binary format:

```go
type Wire struct {
    Magic [4]byte
    Len   uint32
    Crc   uint32
}
```

**Acceptance criteria**
- [ ] You add `const _ = uint(unsafe.Sizeof(Wire{}) - 12)` to enforce size.
- [ ] You add `const _ = uint(unsafe.Offsetof(Wire{}.Crc) - 8)` to enforce offset.
- [ ] You confirm both fail to compile if you reorder the struct.

---

## Task 10: Replace `reflect.SliceHeader`

Find an example of `reflect.SliceHeader` in old code (or write a snippet). Rewrite using `unsafe.Slice`/`SliceData`.

**Acceptance criteria**
- [ ] The new code uses no `uintptr`.
- [ ] The new code passes `go vet`.
- [ ] You explain in one paragraph why the old idiom was problematic.

---

## Task 11: Cgo buffer ownership

Write a function that calls a C function expecting a buffer, where the C function reads it asynchronously (use a 100 ms sleep in the C side via cgo).

**Acceptance criteria**
- [ ] First version (without `KeepAlive`) sometimes fails under GC pressure.
- [ ] Add `runtime.KeepAlive` after the C call; verify stability.
- [ ] Write a comment: "The C function holds buf for 100 ms; KeepAlive ensures the Go GC does not reclaim it during this window."

---

## Task 12: `unsafe.Pointer` as struct field

Define a struct with an `unsafe.Pointer` field that holds a `*int`. Demonstrate that the GC keeps the `*int` alive through many GC cycles.

**Acceptance criteria**
- [ ] Replace `unsafe.Pointer` with `uintptr` and demonstrate the `*int` can be collected.
- [ ] You note the difference and write down when to use which.

---

## Stretch — Task 13: Toy serializer using offsets

For a fixed struct type:

```go
type User struct {
    ID    uint64
    Name  string
    Email string
}
```

Build a serializer that uses cached offsets (via `unsafe.Offsetof`) and `unsafe.Pointer` arithmetic to write each field into a `[]byte` without reflection.

**Acceptance criteria**
- [ ] Output matches an equivalent `encoding/json` serialization (after parsing).
- [ ] Bench vs `encoding/json`; expect significant speedup.
- [ ] You include a layout assertion test.

---

## Submission

For each task: code, bench output (where applicable), 2–3 lines of analysis. The collected artifacts demonstrate disciplined use of `unsafe` — measured, isolated, and tested.
