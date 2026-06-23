# for range — Interview Questions

## Junior Level

### Q1: What does `for range` do in Go?

**A:** `for range` iterates over collections such as slices, arrays, maps, strings, and channels. It returns an index (or key) and a value copy for each element.

```go
for i, v := range []int{10, 20, 30} {
    fmt.Println(i, v)
}
// 0 10
// 1 20
// 2 30
```

---

### Q2: What is the value variable in a for range loop?

**A:** The value variable `v` is a **copy** of the element. Modifying `v` does NOT modify the original collection.

```go
s := []int{1, 2, 3}
for _, v := range s {
    v = 99 // s is unchanged!
}
fmt.Println(s) // [1 2 3]
```

---

### Q3: How do you ignore the index or value?

**A:** Use the blank identifier `_`:

```go
for _, v := range s { }  // ignore index
for i := range s { }     // ignore value (omit second var)
```

---

### Q4: What happens when you range over a nil slice?

**A:** The loop executes 0 times. It is completely safe — no panic.

```go
var s []int
for _, v := range s {
    fmt.Println(v) // never runs
}
```

---

### Q5: What happens when you range over a nil map?

**A:** Same as nil slice — 0 iterations, no panic.

```go
var m map[string]int
for k, v := range m {
    _ = k; _ = v // never runs
}
```

---

### Q6: In what order does for range iterate a map?

**A:** Map iteration order is **random and non-deterministic**. It changes every time the program runs. Never rely on map iteration order.

---

### Q7: What does ranging over a string yield?

**A:** It yields `(byteIndex int, r rune)` pairs. The string is decoded as UTF-8 runes. The byte index can skip values for multi-byte characters.

```go
for i, r := range "Hi世" {
    fmt.Printf("%d: %c\n", i, r)
}
// 0: H
// 1: i
// 2: 世  (byte index 2, but 世 takes 3 bytes)
```

---

### Q8: How do you modify a slice element during range?

**A:** Use the index to access the original element:

```go
s := []int{1, 2, 3}
for i := range s {
    s[i] *= 2
}
fmt.Println(s) // [2 4 6]
```

---

## Middle Level

### Q9: What is the closure capture bug with for range?

**A:** Before Go 1.22, all iterations shared the same variable. Closures capturing the variable would all see the final value.

```go
// Pre-Go 1.22 BUG
funcs := make([]func(), 3)
for _, v := range []int{1, 2, 3} {
    funcs = append(funcs, func() { fmt.Println(v) })
}
funcs[0]() // prints 3, not 1

// Fix: v := v (shadow) or pass as argument
```

Go 1.22 fixed this: loop variables have per-iteration scope.

---

### Q10: Can you delete from a map while ranging over it?

**A:** Yes, deleting is safe during range in Go. The deleted key will not appear in subsequent iterations if not yet visited.

```go
m := map[string]int{"a": 1, "b": 0, "c": 3}
for k, v := range m {
    if v == 0 {
        delete(m, k) // safe
    }
}
```

---

### Q11: Can you add to a map during range?

**A:** Technically yes, but the new keys may or may not be visited — the behavior is undefined per the Go spec. Never rely on it.

---

### Q12: Why is a range expression evaluated only once?

**A:** This is a compiler optimization and correctness guarantee. The expression is captured before the loop starts, so modifications to the variable holding the slice during iteration do not change how many iterations occur.

```go
s := []int{1, 2, 3}
for _, v := range s {
    s = append(s, 99) // s modified, but loop still runs 3 times
    fmt.Println(v)
}
```

---

### Q13: How does for range work on a channel?

**A:** It receives values from the channel in a loop, blocking until a value is available. The loop exits when the channel is closed and empty.

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)
for v := range ch { fmt.Println(v) } // 1, 2, 3
```

If the channel is never closed, the loop blocks forever.

---

### Q14: What is the difference between `len(s)` and `len([]rune(s))` for a string?

**A:** `len(s)` returns the **byte count**. `len([]rune(s))` returns the **character count** (number of Unicode code points).

```go
s := "Hello,世界"
fmt.Println(len(s))          // 12 (bytes)
fmt.Println(len([]rune(s)))  // 8  (characters)
```

---

### Q15: How do you iterate a map in sorted order?

**A:** Collect keys into a slice, sort it, then iterate the map using the sorted keys.

```go
import "sort"
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }
sort.Strings(keys)
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

---

### Q16: What is a common mistake when using defer inside a for range loop?

**A:** Placing `defer` directly in a range loop causes all defers to execute when the enclosing function returns, not at the end of each iteration. This can exhaust file descriptors or other resources.

```go
// WRONG
for _, file := range files {
    f, _ := os.Open(file)
    defer f.Close() // runs at end of function, not each iteration!
}

// CORRECT: wrap in a closure or named function
for _, file := range files {
    func() {
        f, _ := os.Open(file)
        defer f.Close() // runs at end of closure
        process(f)
    }()
}
```

---

## Senior Level

### Q17: How does the Go runtime randomize map iteration?

**A:** `mapiterinit()` seeds the starting bucket using `fastrand()`, a cheap PRNG built into the runtime. The starting offset within a bucket is also randomized. This prevents accidental reliance on map order and mitigates hash-flooding attacks.

---

### Q18: What compiler optimization is applied to slice range loops?

**A:** Bounds Check Elimination (BCE). Since the compiler knows `i` is always in `[0, len(s))` during a range over `s`, it eliminates the bounds check on `s[i]`. This makes range loops faster than manual index loops with arbitrary access patterns.

---

### Q19: How does Go 1.22 fix the loop variable capture bug?

**A:** Go 1.22 changed the semantics of loop variables so that each iteration creates a new variable. The compiler inserts an implicit `v := v` at the start of each iteration body. This means closures capturing loop variables capture per-iteration copies, not the shared loop variable.

---

### Q20: What is `iter.Seq` and how does it relate to for range?

**A:** Introduced in Go 1.23, `iter.Seq[V]` is a function type `func(yield func(V) bool)`. The compiler allows `for range` over such functions. The `yield` function is called for each element; returning `false` from `yield` stops iteration. This enables lazy, composable iterators without allocating intermediate slices.

```go
type Seq[V any] func(yield func(V) bool)
```

---

### Q21: What happens when you range over an array value (not pointer)?

**A:** The entire array is copied when used as the range expression, because arrays are value types in Go. This can be expensive for large arrays.

```go
var big [1000000]int
for _, v := range big { // copies 8MB!
    _ = v
}
// Fix: range over a slice of the array
for _, v := range big[:] {
    _ = v
}
// Or use a pointer
for _, v := range (*[1000000]int)(&big) {
    _ = v
}
```

---

### Q22: How does string range handle invalid UTF-8?

**A:** For invalid UTF-8 sequences, range yields `utf8.RuneError` (U+FFFD, the replacement character) and advances by 1 byte. It never panics.

```go
for i, r := range "\xff\xfe" {
    fmt.Printf("%d: %v\n", i, r)
}
// 0: 65533  (RuneError)
// 1: 65533  (RuneError)
```

---

## Scenario-Based Questions

### Q23: Scenario — Debug this code

```go
results := make([]int, 3)
for i, v := range []int{10, 20, 30} {
    go func() {
        results[i] = v
    }()
}
time.Sleep(time.Second)
fmt.Println(results)
```

**Q:** What are two bugs here?

**A:**
1. **Closure capture bug** (pre-Go 1.22): all goroutines see the same `i` and `v` — likely print `[0, 0, 30]` or similar.
2. **Data race**: `results[i]` is written from goroutines without synchronization.

**Fix:**
```go
var wg sync.WaitGroup
for i, v := range []int{10, 20, 30} {
    i, v := i, v // per-iteration copies
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = v // still a race without mutex if goroutines overlap
    }()
}
wg.Wait()
```

---

### Q24: Scenario — Performance issue

A function takes 500ms to process a 10M element slice. How would you investigate if `for range` is the bottleneck?

**A:**
1. Add a `pprof` CPU profile and run `go tool pprof`.
2. Check if time is in the range loop body or the loop overhead itself.
3. Look for: large struct copies (use index instead of value), interface dispatch inside loop, unnecessary allocations.
4. Run `go test -bench -benchmem` to measure allocations.
5. Consider: parallelizing with goroutines, SIMD-friendly data layout (SoA), or chunking.

---

### Q25: Scenario — Map concurrent access

Your service crashes with `concurrent map iteration and map write`. How do you fix it?

**A:**
- Option 1: `sync.RWMutex` — `RLock` for range (read), `Lock` for write.
- Option 2: `sync.Map` — built-in concurrent map (best for read-heavy, many goroutines).
- Option 3: Sharded map — divide the map into N shards each with its own mutex.
- Option 4: Redesign — use channels to serialize map access through a single goroutine.

---

## FAQ

### Q26: Is `for range` slower than a classic for loop?

**A:** No, for typical usage they compile to identical machine code. The compiler optimizes both. Range can even be faster for slice access because BCE is applied more aggressively.

---

### Q27: Can I use `for range` with a custom type?

**A:** Yes, if the custom type's underlying type is a rangeable type (slice, array, map, string, channel, or integer), you can range directly over it. In Go 1.23+, you can also implement `iter.Seq` or `iter.Seq2` to make custom types rangeable.

---

### Q28: What is `for range` over an integer?

**A:** Go 1.22+ allows `for i := range n` where `n` is an integer. This iterates `i` from 0 to n-1. It is equivalent to `for i := 0; i < n; i++`.

---

### Q29: Does for range over a slice allocate memory?

**A:** No, ranging over a slice does not allocate. The loop variables are stack-allocated. However, ranging over a map allocates an `hiter` struct (usually on the stack via escape analysis).

---

### Q30: What is the difference between ranging over a string and a `[]byte`?

**A:**
- Ranging over a `string` yields `(byteIndex int, r rune)` — UTF-8 decoded Unicode code points.
- Ranging over `[]byte` yields `(index int, b byte)` — raw bytes, one per iteration.
- For ASCII-only strings, the results are identical. For multi-byte characters, they differ significantly.
