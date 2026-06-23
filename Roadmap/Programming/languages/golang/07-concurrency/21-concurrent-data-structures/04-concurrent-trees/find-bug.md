---
layout: default
title: Find Bug
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/find-bug/
---

# Concurrent Trees — Find the Bug

For each snippet, identify the bug, describe its effect, and propose a fix. Answers at the bottom.

## Bug 1: Forgotten Unlock

```go
type Store struct {
    mu sync.Mutex
    bt *btree.BTreeG[Item]
}

func (s *Store) Set(it Item) {
    s.mu.Lock()
    s.bt.ReplaceOrInsert(it)
    return
}
```

---

## Bug 2: RLock for write

```go
func (s *Store) Set(it Item) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    s.bt.ReplaceOrInsert(it)
}
```

---

## Bug 3: Lock upgrade

```go
func (s *Store) Update(k int, fn func(int) int) {
    s.mu.RLock()
    cur, _ := s.bt.Get(Item{Key: k})
    new := fn(cur.Value)
    s.mu.RUnlock()
    s.mu.Lock()
    s.bt.ReplaceOrInsert(Item{Key: k, Value: new})
    s.mu.Unlock()
}
```

---

## Bug 4: Callback re-entry

```go
func (s *Store) PrintAll(fn func(Item)) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    s.bt.Ascend(func(it Item) bool {
        fn(it)
        return true
    })
}

// Caller:
s.PrintAll(func(it Item) {
    s.Set(Item{Key: it.Key, Value: it.Value + 1})
})
```

---

## Bug 5: Snapshot race

```go
type Store struct {
    mu       sync.Mutex
    live     *btree.BTreeG[Item]
    snapshot atomic.Pointer[btree.BTreeG[Item]]
}

func (s *Store) Set(it Item) {
    s.live.ReplaceOrInsert(it)
    s.snapshot.Store(s.live.Copy())
}
```

---

## Bug 6: Mutex-in-goroutine

```go
func (s *Store) BulkSet(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            s.mu.Lock()
            s.bt.ReplaceOrInsert(it)
            s.mu.Unlock()
        }(it)
    }
    wg.Wait()
}
```

(Hint: think about throughput, not correctness.)

---

## Bug 7: Iteration during mutation

```go
func (s *Store) CleanUp() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.Ascend(func(it Item) bool {
        if it.Value < 0 {
            s.bt.Delete(it)
        }
        return true
    })
}
```

---

## Bug 8: Captured loop variable

```go
func (s *Store) SetAll(keys []int) {
    for _, k := range keys {
        go func() {
            s.mu.Lock()
            s.bt.ReplaceOrInsert(Item{Key: k})
            s.mu.Unlock()
        }()
    }
}
```

(Hint: pre-Go-1.22 issue. Verify with `go vet`.)

---

## Bug 9: Get without bool check

```go
func (s *Store) Multiply(k int, factor int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    it, _ := s.bt.Get(Item{Key: k})
    s.bt.ReplaceOrInsert(Item{Key: k, Value: it.Value * factor})
}
```

---

## Bug 10: Hand-over-hand release order

```go
func (t *Tree) Get(k int) (string, bool) {
    n := t.root
    n.mu.RLock()
    for n != nil {
        if k == n.key {
            v := n.value
            n.mu.RUnlock()
            return v, true
        }
        next := n.left
        if k > n.key {
            next = n.right
        }
        n.mu.RUnlock()
        if next == nil {
            return "", false
        }
        next.mu.RLock()
        n = next
    }
    return "", false
}
```

---

## Bug 11: Less function panic

```go
func less(a, b Item) bool {
    return a.Value < b.Value
}

// Items with Value = nil cause panic.
```

---

## Bug 12: Mutation of item in tree

```go
func (s *Store) IncrementAll() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.Ascend(func(it Item) bool {
        it.Value++ // mutates a copy, not the tree
        return true
    })
}
```

---

## Bug 13: Publish/subscribe double-Copy

```go
func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.snapshot.Store(s.live.Copy())
    s.live.ReplaceOrInsert(it)
}
```

(Order matters.)

---

## Bug 14: Lock order deadlock

```go
type Store struct {
    aMu sync.Mutex
    bMu sync.Mutex
}

func (s *Store) Transfer(from, to int) {
    s.aMu.Lock()
    s.bMu.Lock()
    // ... do work
    s.bMu.Unlock()
    s.aMu.Unlock()
}

// Concurrent calls to s.Transfer in opposite directions deadlock.
```

---

## Bug 15: OCC version not bumped

```go
func (n *Node) Write(key, val int) {
    n.mu.Lock()
    n.items[key] = val
    // Forgot to increment version!
    n.mu.Unlock()
}
```

---

## Bug 16: Range query with mutating callback

```go
func (s *Store) DeleteOlderThan(cutoff int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.Ascend(func(it Item) bool {
        if it.Timestamp < cutoff {
            s.bt.Delete(it) // mutating during iteration
        }
        return true
    })
}
```

---

## Bug 17: Snapshot leak

```go
type Store struct {
    snapshot atomic.Pointer[btree.BTreeG[Item]]
    lastSnap *btree.BTreeG[Item] // remember the last one
}

func (s *Store) Set(it Item) {
    // ... mutate live, publish snapshot
    s.lastSnap = s.snapshot.Load() // pin the old one
}
```

---

## Bug 18: Channel-based serialization deadlock

```go
type Store struct {
    cmds chan func()
}

func (s *Store) Run() {
    for cmd := range s.cmds {
        cmd()
    }
}

func (s *Store) Set(it Item) {
    done := make(chan struct{})
    s.cmds <- func() {
        s.bt.ReplaceOrInsert(it)
        close(done)
    }
    <-done
}

// What if Set is called from inside a cmd?
```

---

## Bug 19: Atomic pointer with non-power-of-2 alignment

```go
type Store struct {
    counter  int32
    snapshot atomic.Pointer[btree.BTreeG[Item]] // may not be 8-byte aligned on 32-bit ARM
}
```

(Issue on 32-bit ARM.)

---

## Bug 20: GC of in-flight snapshot

```go
func (s *Store) snapshot() *btree.BTreeG[Item] {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.live.Copy()
}

func useSnapshot() {
    s := snapshot()
    runtime.KeepAlive(nil) // explicit GC trigger somehow
    // ... use s
}
```

(More of a misunderstanding than a real bug.)

---

# Answers

## Bug 1 answer

Missing `Unlock`. The lock is held forever after first call. Fix:

```go
defer s.mu.Unlock()
```

## Bug 2 answer

`RLock` allows concurrent readers; calling a mutating method while only holding `RLock` races with other readers and writers. Use `Lock`:

```go
s.mu.Lock()
defer s.mu.Unlock()
s.bt.ReplaceOrInsert(it)
```

## Bug 3 answer

Between `RUnlock` and `Lock`, another goroutine can update the same key, and our `fn(cur.Value)` is now stale. Fix: take `Lock` for the whole operation.

## Bug 4 answer

The callback `fn` calls `s.Set`, which tries to take the write lock. We hold the read lock. Deadlock. Fix: materialize into a slice under the read lock, then call `fn` outside:

```go
func (s *Store) PrintAll(fn func(Item)) {
    s.mu.RLock()
    var snap []Item
    s.bt.Ascend(func(it Item) bool { snap = append(snap, it); return true })
    s.mu.RUnlock()
    for _, it := range snap {
        fn(it)
    }
}
```

## Bug 5 answer

`Set` does not take `mu`, so `live` is accessed concurrently. Fix:

```go
func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.live.ReplaceOrInsert(it)
    s.snapshot.Store(s.live.Copy())
}
```

## Bug 6 answer

Correct but slow: every item spawns a goroutine that immediately contends for the same lock. Better:

```go
func (s *Store) BulkSet(items []Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, it := range items {
        s.bt.ReplaceOrInsert(it)
    }
}
```

## Bug 7 answer

Mutating the tree during iteration. The B-tree library's behavior is undefined; may skip items, double-visit, or panic. Fix: collect keys to delete, then delete after iteration:

```go
func (s *Store) CleanUp() {
    s.mu.Lock()
    defer s.mu.Unlock()
    var toDelete []Item
    s.bt.Ascend(func(it Item) bool {
        if it.Value < 0 {
            toDelete = append(toDelete, it)
        }
        return true
    })
    for _, it := range toDelete {
        s.bt.Delete(it)
    }
}
```

## Bug 8 answer

In Go before 1.22, `k` is shared by all goroutines, so they all see the *last* value of `k`. Fix (pre-1.22):

```go
for _, k := range keys {
    k := k
    go func() { ... }()
}
```

Or, on Go 1.22+, the loop variable is per-iteration; bug is fixed automatically.

## Bug 9 answer

If `k` is not in the tree, `it` is zero-valued (`Item{Key: 0, Value: 0}`). We then insert `Item{Key: k, Value: 0}` — losing whatever was there (none) and inserting a zero. Probably wrong. Fix:

```go
if it, ok := s.bt.Get(Item{Key: k}); ok {
    s.bt.ReplaceOrInsert(Item{Key: k, Value: it.Value * factor})
}
```

## Bug 10 answer

Releases parent before locking child. Another goroutine can mutate or delete the child between. Fix: lock child *before* unlocking parent.

```go
next.mu.RLock()
n.mu.RUnlock()
n = next
```

## Bug 11 answer

`Value` may be of type that compares with `<` validly only if non-nil. Make `less` total:

```go
func less(a, b Item) bool {
    if a.Value == nil { return true }
    if b.Value == nil { return false }
    return a.Value < b.Value
}
```

Or reject nil at insertion.

## Bug 12 answer

`it` is a copy; mutating it does not change the tree. Fix: re-insert the modified item.

```go
s.bt.Ascend(func(it Item) bool {
    it.Value++
    s.bt.ReplaceOrInsert(it)
    return true
})
```

But wait — that's mutation during iteration (Bug 7). Better: collect into a slice, then re-insert.

## Bug 13 answer

The snapshot is published *before* the mutation, so it does not contain the new item. Fix: mutate first, then publish.

```go
s.live.ReplaceOrInsert(it)
s.snapshot.Store(s.live.Copy())
```

## Bug 14 answer

Two goroutines calling `Transfer(1, 2)` and `Transfer(2, 1)` simultaneously may each hold one of the locks waiting for the other. Fix: always acquire locks in a fixed order (e.g., by ID).

```go
if from < to {
    s.aMu.Lock()
    s.bMu.Lock()
} else {
    s.bMu.Lock()
    s.aMu.Lock()
}
```

## Bug 15 answer

OCC readers will never detect the change. Fix: bracket the write with version increments.

```go
n.version.Add(1) // odd
n.items[key] = val
n.version.Add(1) // even
```

## Bug 16 answer

Same as Bug 7. Fix the same way.

## Bug 17 answer

`s.lastSnap` keeps the old snapshot alive forever; memory grows. Fix: don't pin the snapshot in a global. If you need historical snapshots, document the lifecycle.

## Bug 18 answer

If `Set` is called from inside a cmd handler, the goroutine sends a new cmd into the channel, then blocks waiting on `done`. The cmds processor is also blocked (it's running the cmd). Deadlock. Fix: detect re-entry and handle directly, or use a goroutine pool.

## Bug 19 answer

On 32-bit ARM, 64-bit atomic operations require 8-byte alignment. `atomic.Pointer` may not be aligned if preceded by a non-8-byte field. Fix: put 8-byte aligned fields first, or use `//go:align 8`.

## Bug 20 answer

`runtime.KeepAlive` does the opposite: it ensures `nil` is kept alive (nil is always alive). Useless here. The snapshot returned from `s.live.Copy()` is captured by `s`, so it persists as long as `s` references it. No actual GC bug.

---

## Closing

Twenty bugs spanning common concurrent tree mistakes. Practice spotting them:

- Forgotten Unlock.
- RLock for writes.
- Lock upgrades (release-then-acquire races).
- Callback re-entry deadlocks.
- Snapshot publication order.
- Mutation during iteration.
- Captured loop variables (pre-1.22).
- Get without bool check.
- Hand-over-hand release order.
- OCC version not bumped.
- Snapshot leaks.
- Deadlocks from inconsistent lock order.

Run `go vet` and `go test -race` on every concurrent tree. They catch many of these automatically.
