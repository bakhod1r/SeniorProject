# Slice Header Internals — Middle

## 1. The header is the slice

Every slice you ever touch is a value of type `struct { Data unsafe.Pointer; Len, Cap int }`. Every operation that produces a slice — `[i:j]`, `[i:j:k]`, `make`, `append`, conversion from an array — is, at the machine level, a recipe for filling in those three fields. Once you internalise that, slice arithmetic stops being mysterious.

This file dissects the operations that produce new headers, the aliasing that results, and the small-but-vital `nil` vs empty distinction.

For the visual introduction read [junior.md](junior.md). For the runtime side read [senior.md](senior.md).

---

## 2. What `s[i:j]` does, mechanically

Given `s` with header `{Data: D, Len: L, Cap: C}`, the expression `s[i:j]` produces a new header:

```
Data:  D + i * sizeof(T)
Len:   j - i
Cap:   C - i
```

Bounds the compiler enforces (panicking otherwise):

- `0 <= i <= j <= cap(s)` — note `cap`, not `len`, for `j`.

That last detail surprises people. Indexing `s[k]` requires `k < len(s)`, but **slicing** `s[i:j]` is bounded by `cap`. You may produce a slice whose `Len` extends past the original `Len`, as long as the backing array has room:

```go
s := make([]int, 3, 10)
t := s[:5]              // OK: 5 <= cap(s)=10. Now Len(t)=5.
fmt.Println(t)          // [0 0 0 0 0]  -- those extra zeros existed in the backing array
```

This is sometimes useful for "reading ahead" into pre-allocated capacity, e.g. in IO buffers.

---

## 3. The full-slice expression `s[i:j:k]`

Added in Go 1.2 to fix a long-standing footgun. The third index sets `Cap`:

```
Data:  D + i * sizeof(T)
Len:   j - i
Cap:   k - i
```

Bounds: `0 <= i <= j <= k <= cap(s)`.

When and why to use it:

```go
func slowCopy(s []int) []int {
    return s // bad: caller can append into s's backing array
}

func safeView(s []int) []int {
    return s[:len(s):len(s)] // good: cap == len, so any append by caller allocates fresh
}
```

The line `s[:len(s):len(s)]` is the canonical "defensive view". Its header has `Cap == Len`, so the receiver's first `append` is **forced** to allocate, decoupling them from your backing array.

Without the third index, this happens:

```go
a := make([]int, 4, 16)
b := a[:3]            // Len=3, Cap=16. Dangerous!
c := append(b, 99)    // c[0..3] still points into a's array. c[3]=99 OVERWROTE a[3].
fmt.Println(a)        // [0 0 0 99]
```

With the third index:

```go
a := make([]int, 4, 16)
b := a[:3:3]          // Len=3, Cap=3
c := append(b, 99)    // append must allocate; c is a brand-new array, a is untouched
fmt.Println(a)        // [0 0 0 0]
```

We've turned a sharing footgun into an explicit copy boundary. Three-index slicing is **the** tool when you're returning a sub-slice of something you don't want the caller to mutate through.

---

## 4. Aliasing: the same address through two headers

Aliasing is when two slice headers have overlapping address ranges in the backing array. Mutation through one is visible through the other.

```go
src := []byte("Hello, World")
hi := src[7:12]   // hi shares src's bytes
hi[0] = 'P'
fmt.Println(string(src))  // "Hello, Porld"
```

This is the design of standard-library functions like `bytes.Split`, `bytes.Fields`, `strings.Split` (in `[]byte` form), `bytes.Buffer.Bytes()`. They are **O(n) free** of allocations because they return sub-slices, but their result aliases the input. If you intend to mutate the result, copy first:

```go
hi := append([]byte(nil), src[7:12]...) // independent buffer
hi[0] = 'P'
fmt.Println(string(src))  // "Hello, World" — unchanged
```

The idiom `append([]T(nil), s...)` produces an independent copy with `Cap == Len`. Newer style uses `slices.Clone(s)` (Go 1.21).

### When `bytes.Buffer.Bytes()` will betray you

```go
var buf bytes.Buffer
buf.WriteString("hello")
out := buf.Bytes()       // out aliases buf's internal array
buf.Reset()
buf.WriteString("world")
fmt.Println(string(out)) // "world" — the bytes you thought you owned were overwritten
```

Documentation says exactly this: *the slice is valid only until the next modification of the buffer.* Copy if you keep it.

---

## 5. Aliasing across goroutines

A slice and any sub-slice of it share memory. That is racy as soon as one goroutine writes while another reads, regardless of where in the slice they touch:

```go
s := make([]int, 1024)
a := s[:512]
b := s[512:] // disjoint logically, but...

go func() { a[0] = 1 }()  // race? Strictly no overlap with b...
go func() { _ = b[0] }()  // but the Go memory model still requires synchronisation.
```

Even though `a` and `b` don't overlap, the Go memory model doesn't grant you data-race immunity based on slice partitioning. The race detector will not complain in this exact case (no overlapping address), but if `a` and `b` come from `s[:512]` and `s[500:]` you absolutely do have a race.

Rule: a write to any element of a shared backing array, concurrent with any other access to the same address, requires synchronisation.

---

## 6. `nil` vs `[]T{}` — when it matters

Both have `Len == 0, Cap == 0`. They differ in `Data` (nil vs allocated-but-empty).

### Where they behave identically

```go
var a []int
b := []int{}

len(a) == len(b)              // both 0
cap(a) == cap(b)              // both 0
for range a { /*never*/ }     // safe
for range b { /*never*/ }     // safe
a = append(a, 1)              // works
b = append(b, 1)              // works
```

You can `append`, `range`, take `len`/`cap` of either without ceremony.

### Where they differ

1. **Comparison with `nil`:**

   ```go
   var a []int
   b := []int{}
   fmt.Println(a == nil) // true
   fmt.Println(b == nil) // false
   ```

2. **JSON marshalling:**

   ```go
   json.Marshal(struct{ S []int }{nil})       // {"S":null}
   json.Marshal(struct{ S []int }{[]int{}})   // {"S":[]}
   ```

3. **`reflect.DeepEqual`:**

   ```go
   reflect.DeepEqual([]int(nil), []int{})  // false!
   ```

4. **`encoding/gob` and other binary encoders:** typically encode them as one form, but check the package.

5. **Typed nil into interface:**

   ```go
   var s []int  // nil
   var i any = s
   fmt.Println(i == nil) // false — i holds the type info plus nil data
   ```

   This last one is the source of many "but I returned nil!" bugs. See the interface-internals topic for the full story.

### Practical rule

- API design: return `nil` for absent, `[]T{}` for present-but-empty, if the distinction matters.
- JSON DTOs: initialise with `[]T{}` when you serialise to clients that don't understand `null`.
- Internal code: `nil` is fine; it's cheaper (no allocation) and behaves identically for the operations you usually want.

---

## 7. Reslicing inside loops — the addressability myth

```go
for _, v := range s {
    v.Field = 1 // does nothing to s!
}
```

`v` is a copy of `s[i]`, not an alias. Slice elements are **addressable** via `s[i]`, but the loop variable in `range` is not the element — it's a copy.

To mutate in place, index:

```go
for i := range s {
    s[i].Field = 1 // writes to backing array through s.Data
}
```

Or in Go 1.22+, with the new loop-variable scoping, you can take the address of the loop variable, but it still points to the *copy*, not the backing slot. To mutate the slice you still must index.

---

## 8. Mutating during range

```go
s := []int{1, 2, 3}
for i, v := range s {
    if i == 0 {
        s = append(s, 99)
    }
    fmt.Println(i, v)
}
```

Output:

```
0 1
1 2
2 3
```

The loop sees the slice **as it was at loop start**. `range` evaluates `s` once, captures the header, and iterates over that captured length. Appending to `s` after iteration begins doesn't change the captured length — even if the `append` returns a new backing array, the iteration uses the original.

This makes range loops over slices safe to mutate the *elements* (you're writing through the captured header's `Data`) but not safe to assume you'll see appended entries.

---

## 9. Header passed by value: subtle consequences

A function receives its own copy of the header. Modifying `Len` locally never propagates back:

```go
func zero(s []int) {
    s = s[:0]      // local s now has Len=0, but caller's s is unchanged
    s = append(s, 1, 2)
    // any work here is invisible to caller unless it shares an address
}
```

If you need to *modify the header* a caller holds, you must accept a `*[]T`:

```go
func reset(s *[]int) {
    *s = (*s)[:0]
}
```

This is rare in idiomatic Go. Usually `append` is used as `s = append(s, x)`, returning a new header that the caller assigns. Pointers to slices are a smell unless you really need to modify the caller's variable.

---

## 10. Conversion from arrays (Go 1.17 / Go 1.20)

Go 1.17 introduced array-pointer-to-slice conversion:

```go
var arr [4]int = [4]int{1, 2, 3, 4}
s := (*[4]int)(unsafe.Pointer(&arr))[:] // pre-1.17 style
s2 := arr[:]                            // always worked

p := &arr
s3 := p[:] // pointer-to-array dereferencing
```

Go 1.20 extended this with `unsafe.Slice` and array-value-to-slice in safe code:

```go
var arr [4]int
s := arr[:] // unchanged; still an alias

// New 1.20: convert []T to *[N]T (panics if len(s) < N)
s := make([]int, 8)
p := (*[4]int)(s)  // p is a pointer to the first 4 ints of s
p[0] = 99
fmt.Println(s[0])  // 99
```

The conversion `(*[N]T)(s)` is a runtime length check, then a pointer reinterpretation. The resulting array pointer aliases the slice's backing memory. See [`03-slice-to-array-conversion`](../03-slice-to-array-conversion/) for the depth.

---

## 11. Why slices aren't comparable

```go
a := []int{1, 2, 3}
b := []int{1, 2, 3}
_ = a == b // compile error: slice can only be compared to nil
```

The spec forbids `==` on slices. Why? Because the design committee wanted `==` to be O(1). With three fields, "are these the same slice header?" is a reasonable thing to define — but it would mean equal-looking slices test unequal often, and unequal-looking slices test equal if they share a backing array.

So slices compare only to `nil`. For value-equality, use `slices.Equal(a, b)` (Go 1.21) or `bytes.Equal` for `[]byte`.

---

## 12. Worked example: drift inside a buffer

```go
type Buffer struct {
    buf []byte
}

func (b *Buffer) Write(p []byte) {
    b.buf = append(b.buf, p...)
}

func (b *Buffer) Read(n int) []byte {
    out := b.buf[:n]
    b.buf = b.buf[n:]
    return out
}

func main() {
    buf := &Buffer{}
    buf.Write([]byte("hello world"))
    a := buf.Read(5)            // "hello"
    buf.Write([]byte("!!!!!"))  // may or may not allocate
    fmt.Println(string(a))      // ?
}
```

What does `a` print?

It depends on whether the second `Write` overruns capacity. If `b.buf` was allocated with `Cap > Len + 5`, then `append` writes in place and the bytes at `&b.buf[-5:0]` (which is `a`) are unchanged. If `append` allocates a new array, `b.buf` points to fresh memory and `a` still references the original — which is also unchanged.

But:

```go
func (b *Buffer) Read(n int) []byte {
    out := b.buf[:n]            // header view into b.buf's backing array
    b.buf = b.buf[n:]
    return out
}

// caller:
a := buf.Read(5)
copy(a, []byte("XXXXX"))        // writes through buf's backing array
fmt.Println(buf.b)              // bytes 0..4 corrupted in the next Write window
```

The fix is the same as Section 3: return `b.buf[:n:n]` so callers can't mutate cells that belong to the buffer's remaining content. Or `slices.Clone(b.buf[:n])`.

---

## 13. The "tiny slice retains huge array" GC pitfall

```go
func smallHeader(big []byte) []byte {
    return big[:8] // returns a slice of 8 bytes
}

func leakingCaller() {
    huge := loadGigabyteFile()
    head := smallHeader(huge)
    huge = nil               // we hope the GC frees the gigabyte
    process(head)            // but head.Data points into the gigabyte array, keeping it alive
}
```

Even though `huge` is set to `nil`, `head`'s `Data` field still points into the original 1 GB allocation. The GC cannot collect it because `head` keeps it reachable.

Fix:

```go
head := append([]byte(nil), big[:8]...) // independent allocation
// or
head := slices.Clone(big[:8])
```

Now `head` has its own 8-byte array; the gigabyte can be collected.

This is the **GC retention** trap. The header is small but its pointer keeps everything it transitively touches alive. We will revisit this in [professional.md](professional.md) and [optimize.md](optimize.md).

---

## 14. Append's effect on the header

`s = append(s, x)` returns a header. The returned header may be:

- **Same `Data`, increased `Len`:** if `cap > len`, append writes in place. The returned `Data` equals the input `Data`.
- **New `Data`, increased `Len` and `Cap`:** if `cap == len`, the runtime allocates a new backing array, copies, writes the new element, and returns a header pointing to the new array.

You cannot tell which happened without inspecting `&s[0]` before and after. Code that relies on `Data` staying stable across `append` is buggy.

```go
s := make([]int, 3, 4)
before := &s[0]
s = append(s, 1) // still cap, same array
fmt.Println(&s[0] == before) // true

s = append(s, 2) // exceeds cap, new array
fmt.Println(&s[0] == before) // false
```

For the algorithmic details of *how much* `Cap` grows, see [capacity-and-growth](../01-capacity-and-growth/).

---

## 15. Putting it together

Everything in this file follows from three facts:

1. A slice is a header pointing into a backing array.
2. Slicing produces a new header that points into the *same* array unless `append` re-allocates.
3. The header is passed by value; the array it points to is shared.

If a piece of slice behaviour confuses you, draw the headers before and after, mark which `Data` pointers coincide, and the answer becomes mechanical.

---

## 16. Checklist for code review

- [ ] Are sub-slices returned to callers capped to their length (`s[:n:n]`)?
- [ ] Are functions that mutate their input slices documented as doing so?
- [ ] Are slices stored across the buffer's `Reset` either copied first or documented as ephemeral?
- [ ] Are `nil` and `[]T{}` distinguished only where JSON or `reflect.DeepEqual` requires it?
- [ ] Are small slices retained from large buffers copied to free the big backing array?
- [ ] Is `range` used to mutate elements via index (`s[i]`), not via the value copy `v`?

---

## Further reading
- Go blog: "Go Slices: usage and internals" — https://go.dev/blog/slices-intro
- Go blog: "Arrays, slices (and strings): The mechanics of 'append'" — https://go.dev/blog/slices
- `slices` package (Go 1.21+) — https://pkg.go.dev/slices
- Aliasing in `bytes.Buffer` — https://pkg.go.dev/bytes#Buffer.Bytes
