# Map Internals — Junior

> Author: Bakhodir Yashin Mansur

## 1. Why look inside a map?

You already know how to *use* a map (`m[k] = v`, `v, ok := m[k]`, `delete(m, k)`, `for k, v := range m`). This file is about what the Go runtime actually does when you write those expressions. Knowing the layout explains three otherwise mysterious rules:

1. Iteration order is random — even on the same map, on the same machine.
2. `m[k].field = v` does not compile when the value type is a struct.
3. Two goroutines writing to the same map can crash the whole program with a fatal runtime error, not a recoverable panic.

Sibling [01-comma-ok-idiom](../01-comma-ok-idiom/) covers the everyday API. Here we look one layer down.

---

## 2. A map is a header, not the data

In your code:

```go
m := make(map[string]int)
```

`m` is a single word — a pointer to a `runtime.hmap` struct on the heap. The hmap holds book-keeping; the actual key/value bytes live in **buckets** hanging off of it.

```
m  ──►  hmap { count, B, buckets, oldbuckets, hash0, ... }
                                  │
                                  ▼
                              [bucket 0][bucket 1] ... [bucket 2^B - 1]
```

Because `m` is just a pointer, passing a map to a function is cheap (one word) and the function sees the same underlying buckets as the caller. This is what people mean when they say "maps are reference types" — you are sharing one `*hmap`.

You can confirm the size:

```go
package main

import (
	"fmt"
	"unsafe"
)

func main() {
	var m map[string]int
	fmt.Println(unsafe.Sizeof(m)) // 8 on a 64-bit platform
}
```

8 bytes is the pointer. The hmap itself is around 48 bytes and the buckets are far larger; you never see those numbers because they live behind the pointer.

---

## 3. The 8-slot bucket

A bucket (`runtime.bmap`) holds up to **8 key/value pairs**. Why 8? It is a tuning constant — small enough that scanning all eight tophashes fits in a couple of CPU instructions, large enough that most lookups touch one bucket.

Schematically:

```
bucket {
    tophash[8]   // 1 byte each — top byte of each key's hash
    keys[8]      // packed
    values[8]    // packed
    overflow *bucket
}
```

Two things worth noting:

- Keys and values are packed **separately** (`k0,k1,...,k7` then `v0,v1,...,v7`), not interleaved (`k0,v0,k1,v1,...`). This avoids padding when key and value have different alignments.
- The bucket has one extra pointer to an **overflow bucket**. When eight slots fill up, a ninth pair is stored in an overflow bucket linked off the first.

Picture it as a tiny array with a forwarding pointer:

```
[t][t][t][t][t][t][t][t]   tophashes
[k][k][k][k][k][k][k][k]   keys
[v][v][v][v][v][v][v][v]   values
[ overflow pointer       ] → next bmap or nil
```

---

## 4. tophash — the eight-byte fingerprint table

`tophash[i]` stores the **high byte** of the hash of `keys[i]`. It serves two jobs:

1. **Fast filter**: comparing one byte is far cheaper than comparing a full key. On lookup, the runtime hashes the key once, takes the top byte, then scans `tophash` for matches. Only matching slots have their full key compared.
2. **Slot state**: a few reserved tophash values encode `empty`, `evacuated`, etc. — see [senior.md](senior.md) for the constants.

The point at this level: a lookup's hot loop is "compare 8 bytes, branch on the rare match" — not "compare 8 strings".

---

## 5. How a lookup works (informally)

`v := m[k]` runs roughly:

```
1. Hash the key with hmap.hash0 as the seed.
2. Pick a bucket: bucket_index = hash & (2^B - 1).
3. For each slot in that bucket (and its overflow chain):
       if tophash[i] == top_byte_of_hash:
           if keys[i] == k:
               return values[i]
4. Not found → return the zero value.
```

`v, ok := m[k]` is the same but reports whether step 3 found a match.

Two consequences of this algorithm:

- Lookup is O(1) **average**, because the bucket count grows as the map grows so each bucket stays near 8 entries (load factor 6.5; see [middle.md](middle.md)).
- It is O(n) **worst case**, if all keys hash to the same bucket. With Go's randomized hash seed (`hash0`), an adversary cannot construct collisions ahead of time — but they still happen by accident with bad custom key types.

---

## 6. Why iteration order is random

When you write:

```go
for k, v := range m {
    fmt.Println(k, v)
}
```

The runtime starts the iteration at a random bucket and a random offset within that bucket. The starting point is chosen with `fastrand` at iterator construction time. So even iterating the same map twice within the same program yields different orders.

Why bother? Two reasons:

1. **Discouraging accidental order dependence.** If iteration were deterministic, code would silently start to rely on it. Then a future map growth (which reshuffles slots) would change the order and break everything. Randomization surfaces this bug at development time, not in production.
2. **Defending against algorithmic attacks.** The randomization also helps prevent attackers from targeting predictable iteration sequences in handlers that, for example, return the first N entries.

The hash seed `hmap.hash0` (set at `makemap` time) further randomizes which bucket each key lands in. So two programs running side-by-side, given the same inputs, produce different bucket layouts.

Demonstration:

```go
package main

import "fmt"

func main() {
	m := map[string]int{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5}
	for i := 0; i < 3; i++ {
		fmt.Print("run ", i, ": ")
		for k := range m {
			fmt.Print(k, " ")
		}
		fmt.Println()
	}
}
```

Sample output:

```
run 0: d a c e b
run 1: b e a c d
run 2: c b d a e
```

If you need sorted output, copy the keys into a slice and sort that slice. The map itself is never going to give you order.

---

## 7. Why `m[k].field = v` is illegal

The compiler error is famous:

```
cannot assign to struct field m[k].x in map
```

Reason: the value returned by `m[k]` is a **copy**, and the compiler refuses to let you write to a field of a copy by accident. The deeper reason is that map values are **not addressable**: you cannot take the address of `m[k]`.

Why aren't they addressable? Because the underlying bucket might be moved by the runtime — during a grow, the slot you point at could be relocated to a different bucket. Allowing pointers into the bucket array would mean either disabling grow (bad) or invalidating pointers behind your back (worse).

Workarounds:

```go
// Option A: assign the whole struct back.
v := m[k]
v.Field = 42
m[k] = v

// Option B: use a pointer-valued map.
m2 := map[string]*Item{"a": {Field: 0}}
m2["a"].Field = 42 // legal — m2["a"] is a *Item value (a pointer copy is fine)
```

Both work. Option B is more ergonomic for hot writes; Option A is allocation-free if the struct is small.

The full rule is in the Go spec: [Index expressions](https://go.dev/ref/spec#Index_expressions) ("The expression `a[x]` is addressable if ... `a` is not a map index expression").

---

## 8. Why concurrent writes crash

Two goroutines writing to the same map can produce:

```
fatal error: concurrent map writes
```

This is a **fatal error**, not a panic. You cannot recover from it; the process dies.

Cause: the runtime maintains a `flags` field on `hmap`. The `hashWriting` bit is set at the start of a write and cleared at the end. Before any write or read-with-write, the runtime checks the bit: if it is already set by another goroutine, the runtime calls `throw` (which is unrecoverable).

The check is not bullet-proof — it is a debug aid, not a lock. Two writes that race the bit-check still corrupt the map silently. The visible crash is the *good* outcome; the silent corruption is the *bad* outcome.

Conclusion: a map being read concurrently is safe **only** if no goroutine writes during that time. As soon as one writer exists, *all* access must be synchronized — typically with `sync.RWMutex` or by switching to `sync.Map` for specific access patterns. See [professional.md](professional.md) §3.

---

## 9. What `delete` actually does

`delete(m, k)` does **not** shrink the bucket array. It only clears the tophash slot to `emptyOne` (or `emptyRest`), zeros the key and value, and decrements `count`. The bucket capacity stays the same.

Implication: a map that once held 10 million entries and now holds 10 still occupies the memory for 10 million entries until you garbage-collect it by replacing the variable:

```go
big := make(map[int]int, 10_000_000)
// ... fill it, then drain ...
for k := range big {
    delete(big, k)
}
// big still has 2^B buckets allocated.

big = nil
// or: big = make(map[int]int)  // start fresh
```

For long-running services this is a real source of memory bloat. [professional.md](professional.md) §5 has the production-grade pattern.

---

## 10. A picture of growth

When too many entries land in too few buckets, the runtime **doubles the bucket count** and migrates entries incrementally. This is called **incremental rehashing**:

```
before grow:  B=3 → 8 buckets,  6.5×8 = 52 entries fits comfortably.
trigger:      count exceeds 52  →  decide to grow.
during grow:  oldbuckets = old array (8),  buckets = new array (16).
              Each insert/delete migrates one old bucket pair into the new array.
after grow:   oldbuckets = nil. All entries live in `buckets`.
```

Migration spreads the cost across many operations. You never pay a long stall on the operation that triggered the grow.

Detail-by-detail walkthrough is in [middle.md](middle.md) §4.

---

## 11. Tiny demonstrations you can run today

### 11.1 Iteration order randomness

```go
m := map[int]struct{}{1: {}, 2: {}, 3: {}, 4: {}, 5: {}}
for i := 0; i < 5; i++ {
    for k := range m {
        fmt.Print(k, " ")
    }
    fmt.Println()
}
```

Run it three times. The orders differ.

### 11.2 Value non-addressability

```go
type P struct{ X int }
m := map[string]P{"a": {X: 1}}
// m["a"].X = 2 // does not compile
v := m["a"]
v.X = 2
m["a"] = v
```

Replace the struct value with a pointer (`map[string]*P`) and the inline write compiles.

### 11.3 Concurrent write crash (run with `-race` to also see the warning)

```go
m := map[int]int{}
go func() { for { m[1] = 1 } }()
go func() { for { m[2] = 2 } }()
select {}
```

This crashes within milliseconds with `fatal error: concurrent map writes`.

---

## 12. What you should remember from this file

- A map variable is a single pointer to an `hmap` struct.
- Storage lives in **buckets**, each holding up to 8 key/value pairs plus an overflow pointer.
- The 8-byte `tophash` array is a per-slot fingerprint that filters comparisons.
- Iteration begins at a random bucket and offset; order is deliberately unstable.
- `m[k]` is not addressable, so `m[k].Field = v` is illegal — assign the whole value or use a pointer-valued map.
- Concurrent writes are detected by the runtime and turned into a fatal error.
- `delete` does not shrink the bucket array; for long-lived maps that empty out, allocate a fresh map.

[middle.md](middle.md) covers the load factor, grow trigger, and overflow chains in depth.

---

## 13. Further reading

- Go spec on map types and index expressions: https://go.dev/ref/spec#Map_types, https://go.dev/ref/spec#Index_expressions
- `runtime/map.go` source: https://github.com/golang/go/blob/master/src/runtime/map.go
- Keith Randall's talk "Inside the Map Implementation" (GopherCon 2016) — the canonical primer; YouTube
- Swiss-table redesign proposal (Go 1.24+): https://github.com/golang/go/issues/54766
