# Buffer Mechanics — Professional Level

## Table of Contents
1. [Scope](#scope)
2. [`makechan` Line by Line](#makechan-line-by-line)
3. [`chanbuf` and the Slot Address](#chanbuf-and-the-slot-address)
4. [`chansend` Buffer Branch in Source](#chansend-buffer-branch-in-source)
5. [`chanrecv` Buffer Branch in Source](#chanrecv-buffer-branch-in-source)
6. [`typedmemmove` Internals](#typedmemmove-internals)
7. [`typedmemclr` Internals](#typedmemclr-internals)
8. [The `racenotify` Hooks](#the-racenotify-hooks)
9. [`closechan` and Buffer State](#closechan-and-buffer-state)
10. [Verifying It Yourself](#verifying-it-yourself)
11. [Why Each Choice Was Made](#why-each-choice-was-made)
12. [Production-Grade Takeaways](#production-grade-takeaways)

---

## Scope

This level walks the real source of `src/runtime/chan.go` (and adjacent files: `mbarrier.go`, `mbitmap.go`, `race.go`) for everything related to the channel's ring buffer. The goal is to make you able to open the file, find the relevant function, and read it without confusion. Line numbers shift between Go versions; we cite functions and code shapes, not absolute lines.

We assume you have already read the middle and senior files. Here we are not re-deriving concepts; we are confirming them against source.

---

## `makechan` Line by Line

From `src/runtime/chan.go` (simplified to focus on buffer allocation):

```go
func makechan(t *chantype, size int) *hchan {
    elem := t.Elem

    // 1. Sanity checks on element size and total memory.
    if elem.Size_ >= 1<<16 {
        throw("makechan: invalid channel element type")
    }
    if hchanSize%maxAlign != 0 || elem.Align_ > maxAlign {
        throw("makechan: bad alignment")
    }

    // 2. Compute total buffer bytes, checking for overflow.
    mem, overflow := math.MulUintptr(elem.Size_, uintptr(size))
    if overflow || mem > maxAlloc-hchanSize || size < 0 {
        panic(plainError("makechan: size out of range"))
    }

    // 3. Choose allocation strategy.
    var c *hchan
    switch {
    case mem == 0:
        // chan struct{}, or unbuffered: only hchan.
        c = (*hchan)(mallocgc(hchanSize, nil, true))
        c.buf = c.raceaddr()
    case elem.PtrBytes == 0:
        // No pointers in element: one block for header + buffer.
        c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
        c.buf = add(unsafe.Pointer(c), hchanSize)
    default:
        // Element contains pointers: buffer allocated with elem as type.
        c = new(hchan)
        c.buf = mallocgc(mem, elem, true)
    }

    // 4. Initialize fields.
    c.elemsize = uint16(elem.Size_)
    c.elemtype = elem
    c.dataqsiz = uint(size)
    lockInit(&c.lock, lockRankHchan)

    // 5. Tracing hook.
    if debugChan {
        print("makechan: chan=", c, "; elemsize=", elem.Size_, "; dataqsiz=", size, "\n")
    }
    return c
}
```

Key annotations:

- `elem.Size_ >= 1<<16` enforces that `elemsize` fits in a `uint16`. Element types up to 65535 bytes are allowed; in practice you would never approach this.
- `math.MulUintptr(elem.Size_, uintptr(size))` is overflow-safe multiplication. `make(chan T, 1<<60)` is rejected by this check before reaching the allocator.
- `c.raceaddr()` returns `unsafe.Pointer(&c.buf)` itself, used as a stable sentinel address. The race detector uses it to anchor synchronisation events on zero-buffer channels.
- `mallocgc(size, typ, needzero=true)` is the GC-aware allocator. The third argument `true` requests zero-fill, so all `hchan` and buffer bytes start as zero.
- `c.elemtype = elem` retains the element type descriptor, used later by `typedmemmove` and `typedmemclr`.
- `lockInit(&c.lock, lockRankHchan)` registers the mutex with the lock ranking system (Go 1.19+), so deadlocks involving `hchan.lock` are detectable.

---

## `chanbuf` and the Slot Address

```go
func chanbuf(c *hchan, i uint) unsafe.Pointer {
    return add(c.buf, uintptr(i)*uintptr(c.elemsize))
}
```

That is the entire helper. It does not bounds-check `i`; callers guarantee `i < c.dataqsiz`. For `elemsize == 0`, the multiplication is zero, so all slots resolve to `c.buf` itself (the sentinel). For non-zero element sizes, slot `i` is `i * elemsize` bytes past the buffer start.

The runtime uses `chanbuf` exactly twice per buffer-branch operation: once on send, once on recv.

---

## `chansend` Buffer Branch in Source

The full `chansend` is long; here is the buffer-relevant excerpt:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    // ... nil-check, fast unbuffered path, lock acquire, closed-check,
    // and direct hand-off to recvq omitted; see senior file.

    if c.qcount < c.dataqsiz {
        // Space available in the channel buffer. Enqueue the element.
        qp := chanbuf(c, c.sendx)
        if raceenabled {
            racenotify(c, c.sendx, nil)
        }
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz {
            c.sendx = 0
        }
        c.qcount++
        unlock(&c.lock)
        return true
    }

    // ... park-on-full path omitted.
}
```

Observations:

- The buffer branch comes *after* checking `c.recvq`. Direct hand-off has priority.
- The `racenotify(c, c.sendx, nil)` call publishes a "release" synchronisation event tied to slot `sendx`. The receive on the same slot will perform a matching "acquire."
- The wrap is the branch `if c.sendx == c.dataqsiz { c.sendx = 0 }`, not `c.sendx % c.dataqsiz`. We discussed why in the senior file.
- Everything is under the channel lock, acquired earlier and released here. There are no atomics or memory fences inside the branch; the lock provides them.

---

## `chanrecv` Buffer Branch in Source

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    // ... nil-check, fast empty path, lock acquire, closed-and-empty check,
    // and direct hand-off from sendq omitted.

    if c.qcount > 0 {
        // Receive directly from queue.
        qp := chanbuf(c, c.recvx)
        if raceenabled {
            racenotify(c, c.recvx, nil)
        }
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        typedmemclr(c.elemtype, qp)
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.qcount--
        unlock(&c.lock)
        return true, true
    }

    // ... park-on-empty path omitted.
}
```

Observations:

- `ep` can be nil when the receive discards the value (`<-ch` without assignment). The runtime skips the copy in that case, but it still clears the slot.
- `typedmemclr(c.elemtype, qp)` is unconditional. This is the GC hygiene step.
- The wrap and counter decrement mirror the send branch exactly.

There is also a third path in `chanrecv`: when the buffer is full and a sender is parked. The runtime takes the value from `recvx`, hands it to the receiver, then refills slot `recvx` with the parked sender's value and advances `recvx`. This keeps FIFO order. It is essentially the buffer branch plus a sender-wake step.

---

## `typedmemmove` Internals

From `src/runtime/mbarrier.go`:

```go
func typedmemmove(typ *_type, dst, src unsafe.Pointer) {
    if dst == src {
        return
    }
    if writeBarrier.needed && typ.PtrBytes != 0 {
        bulkBarrierPreWrite(uintptr(dst), uintptr(src), typ.PtrBytes, typ)
    }
    // GCBits is the pointer map; pass it for write-barrier-aware copy.
    memmove(dst, src, typ.Size_)
}
```

`bulkBarrierPreWrite` walks the pointer map and emits write barriers for each pointer slot in the source-to-destination range. After all barriers are emitted, the actual byte copy is done by `memmove` (a hand-tuned assembly routine in `runtime/memmove_*.s`).

The branch on `writeBarrier.needed` is false outside of the GC's mark phase, so during steady-state mutation `typedmemmove` is just `memmove`. During mark, the barriers fire, adding a few cycles per pointer.

For zero-size types (`elem.Size_ == 0`), `memmove(dst, src, 0)` is a no-op. For zero-pointer types (`elem.PtrBytes == 0`), the barrier branch is skipped entirely.

---

## `typedmemclr` Internals

```go
func typedmemclr(typ *_type, ptr unsafe.Pointer) {
    if writeBarrier.needed && typ.PtrBytes != 0 {
        bulkBarrierPreWrite(uintptr(ptr), 0, typ.PtrBytes, typ)
    }
    memclrNoHeapPointers(ptr, typ.Size_)
}
```

Almost identical to `typedmemmove`, but the source is "zero" (passing `0` to the barrier) and the bulk write uses `memclrNoHeapPointers`, which is a hand-tuned memset to zero.

For `elem.PtrBytes == 0`, no barriers are emitted — clearing non-pointer bytes is fine without GC cooperation. For pointer-containing types, the barrier ensures the GC sees the now-cleared pointers and stops tracking the previously-pointed-to objects.

---

## The `racenotify` Hooks

The race detector instrumentation lives in `src/runtime/race.go` and `runtime/race/`. The runtime-side helpers used by the channel code:

- `racenotify(c, idx, sg)` — records a synchronisation event on channel `c` at slot `idx`. If `sg` is non-nil, the event is associated with a parked goroutine's release/acquire instead of a buffer slot.
- `raceacquire`/`racerelease` — used for unbuffered hand-off.
- `racewriterange` / `racereadrange` — emitted by `typedmemmove` indirectly to track per-byte access.

For the buffer branch, the model is:

- Sender slot write = release on `slot[sendx]`.
- Receiver slot read = acquire on `slot[recvx]`.

The matching of release-to-acquire happens through the indices: `racenotify` tags the event with the slot's race address (computed from `c` and the index), and the race detector pairs them when they reference the same address.

This gives the race detector the same happens-before guarantee promised by the memory model: any write the sender did before `ch <- v` is observable to the receiver after `<-ch` for that value.

---

## `closechan` and Buffer State

```go
func closechan(c *hchan) {
    if c == nil {
        panic(plainError("close of nil channel"))
    }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("close of closed channel"))
    }
    if raceenabled {
        racerelease(c.raceaddr())
    }
    c.closed = 1
    // ... wake recvq and sendq, omitted for brevity.
    unlock(&c.lock)
}
```

The buffer is not touched. `c.closed = 1` is the only state change. The wake-up logic for parked goroutines is what makes close visible to them; the buffer itself is just "data in flight that still needs to be drained."

After close, the receive path checks:

```go
if c.closed != 0 && c.qcount == 0 {
    // drained: return zero value, ok=false
}
```

This check is *after* the buffer branch in the source: `chanrecv` first tries to take from the buffer, and only if empty checks closed-status. So FIFO drainage is automatic.

---

## Verifying It Yourself

To confirm any of the above, open a Go installation and search:

```bash
$ grep -n "func chansend" $(go env GOROOT)/src/runtime/chan.go
$ grep -n "func chanrecv" $(go env GOROOT)/src/runtime/chan.go
$ grep -n "func makechan" $(go env GOROOT)/src/runtime/chan.go
$ grep -n "func chanbuf" $(go env GOROOT)/src/runtime/chan.go
$ grep -n "func typedmemmove" $(go env GOROOT)/src/runtime/mbarrier.go
$ grep -n "func typedmemclr" $(go env GOROOT)/src/runtime/mbarrier.go
```

Read each function. The total is under 500 lines of Go for the entire channel implementation. The buffer-branch code is roughly 15 lines per direction. If something in this document does not match your installation, your version is the truth — and the differences will be tiny, almost always renamed fields or a moved race-detector hook.

A small benchmark to verify the fast-path cost:

```go
func BenchmarkBufferedSendRecv(b *testing.B) {
    ch := make(chan int, 1024)
    go func() {
        for v := range ch {
            _ = v
        }
    }()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        ch <- i
    }
    close(ch)
}
```

Run with `go test -bench=. -benchmem`. On modern hardware you should see ~30–50 ns/op with zero allocations per operation. The zero-alloc number confirms that the buffer write path does not allocate; only `make` allocates.

---

## Why Each Choice Was Made

A summary of the design rationale, traceable to the source:

1. **One mutex covers everything.** Simpler than a lock-free MPMC ring, and faster on the typical contention pattern (one producer, one consumer with light contention).
2. **Branch wrap, not modulo.** A division is much more expensive than a predictable branch.
3. **`typedmemmove`, not `memmove`.** The GC requires write barriers on pointer fields; a bare `memmove` would create races between the channel send and the GC marker.
4. **`typedmemclr` on receive.** Without it, the buffer would retain references to old values, preventing GC.
5. **Three allocation strategies in `makechan`.** Optimises the common case (one allocation) while keeping the pointer-buffer case GC-accurate.
6. **`elemsize` is a `uint16`.** Element types over 64 KB are pathological; capping the size lets `hchan` stay compact.
7. **`hchan.buf` is a sentinel for zero-mem channels.** Uniform race-address handling without a null-pointer special case.
8. **`raceaddr()` for the race detector.** Per-slot synchronisation events let the detector verify the memory model exactly.

Every choice in the buffer path is a trade-off the runtime authors documented in code comments or revealed through Git history. Reading the source is the final word on each.

---

## Production-Grade Takeaways

- **Profile before optimising channel paths.** The fast path is already ~30 ns; you cannot win much by tuning.
- **If you allocate channels frequently, pool them.** `sync.Pool` of channels is rare but valid for tight inner-loop work.
- **Choose element types without pointers when possible.** `chan int64` is much cheaper than `chan *Big` per operation, both in copy cost and in GC pressure.
- **Use `runtime/trace` to see when the buffer is full.** Park events on `chan send` indicate back-pressure.
- **Test with `-race` regularly.** The per-slot instrumentation catches races your channel pattern might miss otherwise.
- **Avoid making channels in hot paths.** One `mallocgc` per channel is fine occasionally; once per request adds up.
- **Trust the runtime.** The buffer's design is the result of careful measurement. Do not try to "improve" `hchan` from outside the runtime.

At the professional level the buffer is no longer a mystery. It is a small, well-understood data structure whose source you can read in an afternoon and whose performance you can predict from first principles. The next time someone asks "what happens when I `ch <- v`?", you can answer with a line-by-line walkthrough of `chansend` and `chanbuf`, including the type-aware copy and the GC interaction.
