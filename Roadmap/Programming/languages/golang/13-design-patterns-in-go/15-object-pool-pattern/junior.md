# Object Pool — Junior

## 1. What is the Object Pool pattern?

Some objects are expensive to create — they allocate memory, dial network connections, or hold OS resources. If you create one every time you need it and throw it away, the garbage collector runs more often and your program slows down.

The **Object Pool** pattern keeps a stash of pre-built objects. When you need one, you **borrow** it from the pool; when you're done, you **return** it. The pool decides whether to keep the returned object, recycle it for the next caller, or discard it.

The classic motivation in Go is reducing garbage-collection pressure. Less work for the GC means smaller pauses and better throughput in hot paths.

In Go, the standard tool is `sync.Pool`. It's a built-in object pool with a few peculiarities (we'll meet them in middle.md). For richer use cases — DB connections, HTTP clients, worker goroutines — there are typed pool libraries.

---

## 2. Prerequisites
- Basic understanding that allocation has a cost.
- Knowledge that Go has a garbage collector that runs more often when more garbage exists.
- Familiarity with `sync` package basics.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Pool** | The collection of available pre-built objects |
| **Borrow** / **Get** | Take an object from the pool |
| **Return** / **Put** | Hand an object back to the pool |
| **Hot path** | Code that runs frequently (per request, per loop iteration) |
| **Allocation** | Reserving memory; in Go, may put the object on the heap |
| **GC pressure** | How hard the garbage collector has to work |

---

## 4. The naive version (no pool)

A function that builds a buffer, fills it, and discards it:

```go
func handle(r *http.Request) string {
    var buf bytes.Buffer
    buf.WriteString("hello ")
    buf.WriteString(r.URL.Path)
    return buf.String()
}
```

Every call allocates a new `bytes.Buffer`. Under load (10k QPS), that's 10k buffers per second — work for the GC.

---

## 5. Using `sync.Pool`

Pre-allocate buffers and reuse them:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle(r *http.Request) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)

    buf.Reset()                       // !! always reset
    buf.WriteString("hello ")
    buf.WriteString(r.URL.Path)
    return buf.String()
}
```

The pool starts empty. The first `Get()` calls `New` to create a buffer. Subsequent `Get()` calls return previously `Put`-ed buffers, when available. `Reset()` is critical: a borrowed buffer still has the data from its previous user.

---

## 6. The borrow/return protocol

There are only three rules:

1. **Reset before use.** Stale state from a previous borrower is the #1 pool bug.
2. **Return what you borrowed.** Forgetting `Put` doesn't crash anything — the pool just loses an object. But the optimization is gone.
3. **Don't keep a reference after returning.** If you `Put` and then use the object, another goroutine may also be using it.

```go
buf := bufPool.Get().(*bytes.Buffer)
defer bufPool.Put(buf)  // guarantees return even on panic
buf.Reset()             // guarantees clean state
// ... use buf
```

The `defer` + `Reset()` idiom is what you'll see in standard library and most libraries.

---

## 7. Where this lives in Go's standard library

- `fmt.Sprintf` and friends — pool of `*pp` printers internally.
- `encoding/json` — pool of encoders/decoders.
- `bufio.Reader` / `bufio.Writer` — pool of buffered I/O wrappers.
- `net/http` — pool of `*http.Request` internals.

So you're using object pools whether you write `sync.Pool` or not.

---

## 8. Real-world analogy
A library of books. You borrow a book, use it, return it. The library doesn't print a new copy each time. If everyone returned what they borrowed quickly, the library can serve more readers with fewer books.

---

## 9. When you'll see it
- HTTP servers reusing byte buffers per request.
- JSON encoders/decoders for high-QPS APIs.
- Database connection pools (`database/sql.DB` is one).
- Worker-goroutine pools.
- Compression libraries reusing internal buffers.
- Codec libraries (protobuf, msgpack).

---

## 10. Common mistakes
- **Forgetting `Reset()`** before use — leaks data from the previous borrower.
- **Keeping a reference after `Put`** — race condition: another goroutine may have it.
- **Pooling objects that hold OS handles incorrectly** — you can't pool a `net.Conn` with `sync.Pool` because `sync.Pool` may evict at any time; use a typed connection pool instead.
- **Premature pooling** — for cheap objects (a 16-byte struct), the pool overhead exceeds the allocation cost.
- **Pooling objects that vary wildly in size** — keeps the largest size resident; wastes memory.

---

## 11. Summary

Object Pool keeps a stash of reusable objects so you don't pay allocation/init costs every time. Go's `sync.Pool` is the standard tool: borrow with `Get`, return with `Put`, always `Reset` before use, always `defer Put`. Used in hot paths to reduce GC pressure. The pattern only pays off when allocation is actually costly — profile first.

---

## Further reading
- `sync.Pool` documentation: https://pkg.go.dev/sync#Pool
- Refactoring.Guru — Object Pool: https://refactoring.guru/design-patterns/object-pool
- "Go: Understand the Design of `sync.Pool`" — Vincent Blanchon
- `bytes.Buffer` and `bufio` source code for real-world usage
