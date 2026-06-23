# Slice to Array Conversion — Interview Questions

## Junior Level

### Q1: What is slice-to-array conversion in Go and when was it introduced?

**Answer:** Slice-to-array conversion allows you to convert a slice (`[]T`) into a fixed-size array or pointer to array. There are two forms:
- **Go 1.17+**: `(*[N]T)(slice)` — converts to a pointer to array (shares memory)
- **Go 1.20+**: `[N]T(slice)` — converts to an array value (copies elements)

```go
s := []int{1, 2, 3, 4, 5}
ptr := (*[3]int)(s) // Go 1.17+ — shares memory
arr := [3]int(s)    // Go 1.20+ — independent copy
```

---

### Q2: What happens when you try to convert a slice shorter than the array to that array?

**Answer:** It panics at runtime with a slice bounds out of range error. The conversion is validated at runtime, not compile time.

```go
s := []int{1, 2} // only 2 elements
arr := [5]int(s) // PANIC: slice length (2) < array size (5)
```

Always validate `len(s) >= N` before converting.

---

### Q3: What is the key difference between `(*[N]T)(s)` and `[N]T(s)`?

**Answer:**
- `(*[N]T)(s)` → pointer conversion. The resulting pointer **shares** the same backing array as the slice. Modifying through the pointer modifies the slice.
- `[N]T(s)` → value conversion. Creates an **independent copy** of the first N elements. Modifying the array does NOT affect the slice.

```go
s := []int{1, 2, 3}
ptr := (*[3]int)(s)
ptr[0] = 99          // s[0] is now 99!

arr := [3]int(s)
arr[0] = 77          // s[0] stays 99
```

---

### Q4: Can you convert a nil slice to an array?

**Answer:** Only to a zero-length array `[0]T`. Converting a nil slice to any `[N]T` where N > 0 panics because `len(nil) = 0 < N`.

```go
var s []int         // nil
arr0 := [0]int(s)   // OK — len(nil)=0 >= 0
// arr1 := [1]int(s) // PANIC
_ = arr0
```

---

### Q5: What did Go developers do before `(*[N]T)(slice)` was added in 1.17?

**Answer:** They used `unsafe.Pointer`:

```go
// Pre-1.17 (unsafe and error-prone):
arr := *(*[4]byte)(unsafe.Pointer(&s[0]))

// Post-1.17 (safe, idiomatic):
arr := (*[4]byte)(s)
```

The modern form is type-safe and has proper bounds checking.

---

### Q6: Why can arrays be used as map keys but slices cannot?

**Answer:** Arrays are **comparable** (all elements must be comparable); slices are not comparable in Go. The `[N]T(s)` conversion enables using slice data as map keys:

```go
m := make(map[[4]byte]string)
key := [4]byte([]byte{1, 2, 3, 4})
m[key] = "value"  // works! arrays are comparable
```

---

### Q7: How do you safely convert a slice to an array?

**Answer:** Check the length first:

```go
func toFixed4(s []int) ([4]int, bool) {
    if len(s) < 4 {
        return [4]int{}, false
    }
    return [4]int(s), true
}
```

---

## Middle Level

### Q8: What does this code print and why?

```go
s := []int{10, 20, 30, 40}
ptr := (*[3]int)(s)
ptr[0] = 99
arr := [3]int(s)
arr[1] = 77
fmt.Println(s, *ptr, arr)
```

**Answer:** `[99 20 30 40] [99 20 30] [99 77 30]`

- `ptr[0] = 99` modifies `s[0]` (shared memory) → s becomes `[99, 20, 30, 40]`
- `arr` is a value copy of s AFTER the mutation (s[0]=99), so `arr = [99, 20, 30]`
- `arr[1] = 77` only affects arr, not s
- `*ptr` still points to s's first 3 elements: `[99, 20, 30]`

---

### Q9: Describe a real-world use case for the pointer form `(*[N]T)(s)`.

**Answer:** CGo interoperability. C functions expecting `uint8_t arr[16]` parameters need a pointer to a fixed-size array. The pointer form provides exactly this without copying:

```go
// CGo call expecting fixed 16-byte array
arr := (*[16]C.uint8_t)(unsafe.Pointer(&slice[0]))
C.process_key(arr)
```

Other use cases: network protocol parsing where frames have fixed headers, and you want zero-copy access to the raw bytes.

---

### Q10: When would you choose `[32]byte(hashSlice)` over `copy(arr[:], hashSlice)`?

**Answer:** The `[32]byte(slice)` form is preferred in Go 1.20+ because:
1. More concise — fewer variables
2. Same performance (both compile to `memmove`)
3. Clearer intent — "convert this to a 32-byte array"

`copy` is preferred when:
- Supporting Go versions < 1.20
- Copying into an existing array (not creating new one)
- Partial copy is intended (`copy(arr[2:], s)`)

---

### Q11: What is bounds check elimination (BCE) and how do conversions help?

**Answer:** BCE is a compiler optimization that removes redundant array bounds checks. When you access `s[0], s[1], s[2]` separately, each access has its own check. After converting to `(*[3]int)(s)`, the compiler knows the array has exactly 3 elements and eliminates all subsequent bounds checks for indices 0, 1, 2.

```go
// 4 bounds checks:
sum := s[0] + s[1] + s[2] + s[3]

// 1 bounds check + 0 subsequent checks:
arr := (*[4]int)(s)
sum := arr[0] + arr[1] + arr[2] + arr[3]
```

---

### Q12: What's wrong with this code?

```go
func getHeader(data []byte) *[8]byte {
    return (*[8]byte)(data)
}

func main() {
    pool := sync.Pool{New: func() interface{} { return make([]byte, 1024) }}
    buf := pool.Get().([]byte)
    hdr := getHeader(buf)
    pool.Put(buf)  // buf returned to pool!
    // hdr still points into buf — use after reuse!
    fmt.Println(*hdr)
}
```

**Answer:** `hdr` holds a pointer into `buf`'s backing array. After `pool.Put(buf)`, another goroutine may get the same buffer and start writing to it. `hdr` now points to potentially modified or in-use memory. This is a use-after-reuse bug.

Fix: Use value conversion to make an independent copy before returning the buffer to the pool.

---

## Senior Level

### Q13: Explain the memory model implications of the pointer form for GC.

**Answer:** The pointer `*[N]T` is a live GC root that prevents the entire backing array (not just N elements) from being collected. If the slice was `make([]byte, 10_000_000)` and you hold only a `*[8]byte` pointer to its start, the entire 10MB is kept alive.

This is the "retained large slice" memory leak pattern. The value form `[N]T(s)` creates an independent array — after conversion, if no other references to `s` exist, the 10MB backing array can be GC'd.

---

### Q14: How does the conversion behave in terms of generated assembly for small vs large N?

**Answer:**
- **Small N (≤8 elements for 8-byte types)**: Compiler inlines the copy using N individual `MOVQ` instructions. No function call overhead.
- **Large N**: Compiler emits `CALL runtime.memmove` with the computed byte count.

The threshold depends on element size and architecture. For `[]byte` (1-byte elements), the threshold is typically 32 bytes; for `[]int64` (8-byte elements), it's ~8 elements.

---

### Q15: Describe the SSA pipeline for `[3]int(s)`.

**Answer:**
1. **Type check phase**: Validates slice type and array type compatibility
2. **SSA generation**: Emits `IsInBounds(s.len, 3)` check and `Move` operation
3. **Bounds check elimination**: May eliminate if `s.len >= 3` is proven elsewhere
4. **Lowering**: Converts `Move` to `memmove` call or inline `MOVQ` sequence
5. **Regalloc**: Assigns registers for slice pointer and moves
6. **Code generation**: Emits actual AMD64 instructions

The key SSA op is `OSLICE3ARR` which the compiler handles specially.

---

## Scenario Questions

### Q16: You're designing a binary protocol parser that processes 1M packets/second. Each packet has a 12-byte header. Which conversion would you use and why?

**Answer:** Use the pointer form `(*[12]byte)(packet[:12])` with a BCE hint:

```go
func parseHeader(packet []byte) Header {
    _ = packet[11] // BCE: ensure bounds check happens once
    raw := (*[12]byte)(packet[:12]) // zero-copy
    return Header{
        Type:    binary.BigEndian.Uint32(raw[0:4]),
        Seq:     binary.BigEndian.Uint32(raw[4:8]),
        Length:  binary.BigEndian.Uint32(raw[8:12]),
    }
}
```

At 1M packets/second, avoiding even one 12-byte `memmove` saves 12MB/s of memory bandwidth. The pointer form is zero-copy. The BCE hint ensures only one bounds check per header, not multiple.

---

### Q17: A colleague suggests storing `(*[32]byte)(hashBytes)` in a struct for long-term caching. What are the risks?

**Answer:**
1. **Memory retention**: If `hashBytes` is a slice into a large buffer (e.g., a network packet), the entire buffer stays alive as long as the struct is cached.
2. **Data races**: If the original slice is concurrently modified, reading the pointer is a data race.
3. **Pool reuse bugs**: If `hashBytes` came from a `sync.Pool`, returning the pool object while holding the pointer causes use-after-reuse.

Fix: Store `[32]byte(hashBytes)` — an independent copy. The source slice can then be GC'd or returned to pool.

---

### Q18: When is `[N]T(s)` semantically equivalent to `copy(arr[:], s)` and when does it differ?

**Answer:** They are equivalent when `len(s) >= N`. Differences:
- `[N]T(s)` panics if `len(s) < N`; `copy` silently copies `min(N, len(s))` elements, leaving remaining elements zero
- `[N]T(s)` can only target a new array; `copy` can target an existing array at any position
- `[N]T(s)` is a one-liner; `copy` requires pre-declared array
- For N ≤ 8, `[N]T(s)` may inline the copy; `copy` always calls `memmove` via the runtime

---

## FAQ

### Q19: Is there a way to convert a slice to an array where N is a variable (not a compile-time constant)?

**Answer:** No. In Go, array sizes are compile-time constants — they're part of the type. You cannot do `[n]int(s)` where n is a variable. For dynamic sizes, use:
- `reflect.MakeSlice` / `reflect.ArrayOf` (reflection)
- Just use the slice itself (dynamic sizes are what slices are designed for)
- `unsafe.Pointer` tricks (not recommended)

---

### Q20: Does `[0]T(s)` ever panic?

**Answer:** No. `[0]T(s)` converts to a zero-length array, requiring `len(s) >= 0`, which is always true (even for nil slices). It's the only array conversion that never panics.

```go
var s []int
_ = [0]int(s)      // OK — nil slice
_ = [0]int(s[:0])  // OK — empty slice
```

---

### Q21: What is the performance difference between `(*[N]T)(s)` (pointer) and `[N]T(s)` (value)?

**Answer:** The pointer form is faster when:
- You only need to read a few elements (no copy cost)
- N is large (copying N bytes has overhead)
- The access pattern is sequential (cache-friendly anyway)

The value form may be faster when:
- All N elements are accessed repeatedly (array may be in register)
- N is small (inline copy is fast, and array avoids pointer indirection)
- Cache behavior favors the local copy

Benchmark: for N=8, value form is typically 1-3 ns/op; pointer form is 0.5-1 ns/op (no copy). For N=1024, the difference is ~64 ns (memmove cost).

---

### Q22: Can you use `[N]T(s)` where T is a pointer type like `*int`?

**Answer:** Yes. The element type can be any type including pointer types. The conversion copies the pointer values (not the pointed-to data):

```go
x, y, z := 1, 2, 3
s := []*int{&x, &y, &z, &z}
arr := [3]*int(s)  // copies 3 pointer values
arr[0] = &z        // changes arr[0] but not s[0]
*arr[1] = 99       // modifies y through the pointer!
fmt.Println(y)     // 99
```

The pointer values are copied, but the pointed-to data is shared.
