# Leader/Followers — Find the Bug

> Buggy Leader/Followers snippets. Read the code, spot the defect, understand the root cause, apply the fix. Foundations in [junior.md](junior.md) and [middle.md](middle.md).

## Table of Contents

1. [Bug 1 — Process Before Promote](#bug-1--process-before-promote)
2. [Bug 2 — signalAll Reintroduces the Herd](#bug-2--signalall-reintroduces-the-herd)
3. [Bug 3 — `if` Instead of `while`](#bug-3--if-instead-of-while)
4. [Bug 4 — Concurrent `select()` on One Selector](#bug-4--concurrent-select-on-one-selector)
5. [Bug 5 — Forgetting to Remove the Selected Key](#bug-5--forgetting-to-remove-the-selected-key)
6. [Bug 6 — Holding the Promotion Lock During the Handler](#bug-6--holding-the-promotion-lock-during-the-handler)
7. [Bug 7 — Handler Exception Kills the Thread](#bug-7--handler-exception-kills-the-thread)
8. [Bug 8 — No `wakeup()` on Mid-Flight Registration](#bug-8--no-wakeup-on-mid-flight-registration)
9. [Bug 9 — Non-Volatile Shutdown Flag](#bug-9--non-volatile-shutdown-flag)
10. [Bug 10 — Double-Dispatch of One Connection](#bug-10--double-dispatch-of-one-connection)
11. [Bug 11 — Promotion Without Setting the Leader Flag](#bug-11--promotion-without-setting-the-leader-flag)
12. [Bug 12 — Shutdown Doesn't Wake the Blocked Leader](#bug-12--shutdown-doesnt-wake-the-blocked-leader)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — Process Before Promote

```java
private void eventLoop() {
    while (running) {
        becomeLeader();
        var keys = leaderSelect();
        for (var k : keys) dispatch(k);   // process FIRST
        promoteFollower();                // promote AFTER  ← BUG
    }
}
```

**What's wrong.** The leader processes the event *before* promoting. During the entire handler, no thread is in `select()` — the pool is blind.
**Root cause.** Violates the core invariant: the pool's eyes must never close. Detection latency now equals handler duration; with one slow handler the whole server stalls.
**Fix.** Promote first, then process.
```java
var keys = leaderSelect();
promoteFollower();                // promote FIRST
for (var k : keys) dispatch(k);   // then process concurrently
```

## Bug 2 — signalAll Reintroduces the Herd

```java
private void promoteFollower() {
    lock.lock();
    try { leaderPresent = false; mayLead.signalAll(); }  // ← BUG
    finally { lock.unlock(); }
}
```

**What's wrong.** `signalAll()` wakes every follower for a single promotion.
**Root cause.** All but one find `leaderPresent` already re-set by the winner and go back to sleep — N-1 wasted wakeups and context switches per event. This is the thundering herd Leader/Followers exists to avoid.
**Fix.** `mayLead.signal()` — wake exactly one. Reserve `signalAll()` for shutdown only.

## Bug 3 — `if` Instead of `while`

```java
private void becomeLeader() throws InterruptedException {
    lock.lock();
    try {
        if (leaderPresent) mayLead.await();   // ← BUG
        leaderPresent = true;
    } finally { lock.unlock(); }
}
```

**What's wrong.** A spurious wakeup (or a race after `signal()`) lets a thread fall through `await()` while `leaderPresent` is still true, producing two leaders.
**Root cause.** Condition variables permit spurious wakeups; the predicate must be re-checked in a loop.
**Fix.** `while (leaderPresent) mayLead.await();`.

## Bug 4 — Concurrent `select()` on One Selector

```java
private List<SelectionKey> leaderSelect() {
    selector.select();                 // called WITHOUT holding leadership ← BUG
    // ... thread never went through becomeLeader() first ...
}
```

**What's wrong.** More than one thread calls `select()` on the same `Selector` concurrently.
**Root cause.** `Selector.select()` is not designed for concurrent callers on the same selector; results are undefined and keys can be double-dispatched. The promotion protocol exists precisely to guarantee a single waiter.
**Fix.** Only call `leaderSelect()` after `becomeLeader()` has granted leadership. Never `select()` outside the leader role.

## Bug 5 — Forgetting to Remove the Selected Key

```java
private List<SelectionKey> leaderSelect() {
    selector.select();
    List<SelectionKey> claimed = new ArrayList<>(selector.selectedKeys());
    // never calls it.remove() / selectedKeys().clear()   ← BUG
    return claimed;
}
```

**What's wrong.** The selected-keys set is never cleared, so the next leader's `select()` re-reports the same keys.
**Root cause.** Java NIO does not auto-clear `selectedKeys()`; the application must remove processed keys. Result: the same event is dispatched repeatedly.
**Fix.** Iterate and `it.remove()` each claimed key (or `selectedKeys().clear()` after copying).

## Bug 6 — Holding the Promotion Lock During the Handler

```java
private void eventLoop() {
    while (running) {
        lock.lock();                        // ← BUG: lock held across everything
        try {
            becomeLeaderUnlocked();
            var keys = leaderSelect();      // select() under the lock!
            promoteUnlocked();
            for (var k : keys) dispatch(k); // handler under the lock!
        } finally { lock.unlock(); }
    }
}
```

**What's wrong.** The promotion lock is held across `select()` and the handler.
**Root cause.** No other thread can become leader while this thread blocks in `select()` or runs a handler — the pattern degenerates to single-threaded, and worse, followers can never make progress. Throughput collapses.
**Fix.** Hold the lock only to flip `leaderPresent` and `signal()`. Release it before `select()` and before dispatch.

## Bug 7 — Handler Exception Kills the Thread

```java
becomeLeader();
var keys = leaderSelect();
promoteFollower();
for (var k : keys) dispatch(k);   // throws → loop exits, thread dies ← BUG
```

**What's wrong.** An exception in a handler propagates out of the loop; the thread exits and the pool shrinks permanently.
**Root cause.** No isolation between handler failures and the pool's lifecycle. Over time, transient handler errors silently erode the pool until no threads remain to lead.
**Fix.** Wrap dispatch in try/catch (or try/finally) so the thread logs the error and loops back to follow.
```java
for (var k : keys) {
    try { dispatch(k); }
    catch (Exception e) { log.warn("handler failed", e); }
}
```

## Bug 8 — No `wakeup()` on Mid-Flight Registration

```java
public void register(SocketChannel ch, EventHandler h) throws IOException {
    ch.register(selector, OP_READ, h);   // but leader is blocked in select() ← BUG
    // no selector.wakeup()
}
```

**What's wrong.** A new connection is registered while the leader is blocked in `select()`, but the leader isn't woken.
**Root cause.** A blocked `select()` does not notice newly registered interest until it returns for some other reason; the new connection can sit unserviced indefinitely. (Worse: registering on a selector mid-`select()` from another thread can block.)
**Fix.** Enqueue the registration and call `selector.wakeup()`; have the leader drain pending registrations at the top of `leaderSelect()`.

## Bug 9 — Non-Volatile Shutdown Flag

```java
private boolean running = true;          // ← BUG: not volatile
// reader thread loops on `while (running)`; another thread sets running=false
```

**What's wrong.** `running` is read by the worker threads outside the lock but written by the shutdown thread; without `volatile` the write may never be visible.
**Root cause.** No happens-before edge for the plain field read in the loop condition; threads may loop forever on a stale `true`.
**Fix.** `private volatile boolean running = true;` (or read it inside the lock). In C++ use `std::atomic<bool>`.

## Bug 10 — Double-Dispatch of One Connection

```java
// promote first (good), but the SAME key stays interested and the new leader
// re-selects it before the handler finishes:
promoteFollower();
dispatch(key);   // long read handler still running...
// meanwhile new leader's select() returns the SAME readable key  ← BUG
```

**What's wrong.** After promoting, the new leader's `select()` re-reports the same still-readable connection, so two threads process one connection concurrently.
**Root cause.** The connection's interest wasn't suspended before promotion; readability persists, so it's re-detected. This corrupts per-connection state.
**Fix.** Suspend the handle before promoting and resume after the handler (ACE's suspend/resume). In NIO: clear the key's interest ops (`key.interestOps(0)`) before promote, restore after dispatch — or use `EPOLLONESHOT` semantics.

## Bug 11 — Promotion Without Setting the Leader Flag

```java
private void promoteFollower() {
    lock.lock();
    try { mayLead.signal(); }            // ← BUG: never sets leaderPresent = false
    finally { lock.unlock(); }
}
```

**What's wrong.** `promoteFollower` signals a follower but never clears `leaderPresent`.
**Root cause.** The woken follower re-checks `while (leaderPresent)` — still true — and goes back to sleep. No new leader is ever established; the pool deadlocks with everyone following.
**Fix.** Set `leaderPresent = false;` before `signal()`.

## Bug 12 — Shutdown Doesn't Wake the Blocked Leader

```java
public void shutdown() {
    running = false;
    lock.lock();
    try { mayLead.signalAll(); } finally { lock.unlock(); }
    // no selector.wakeup()   ← BUG
}
```

**What's wrong.** Followers wake and exit, but the leader is blocked in `selector.select()` and never sees `running == false`.
**Root cause.** `signalAll()` only wakes threads on the *condition variable*; the leader is parked in a *syscall*. It waits until some unrelated event (or forever).
**Fix.** Add `selector.wakeup();` after signalling, so the blocked `select()` returns and the leader observes the shutdown flag.

## Practice Tips

- **Audit the ordering first.** The two highest-impact bugs (1 and 11) are about *ordering and flags* around promotion. On any Leader/Followers code, check promote-before-process and that `leaderPresent` is correctly flipped — before anything else.
- **`signal` vs `signalAll` is a tell.** A `signalAll()` outside shutdown (Bug 2) is almost always a herd bug. Search for it.
- **`while` not `if`** on every condition-variable wait (Bug 3). This is a reflex; train it.
- **Two threads, one Selector** is the NIO trap (Bugs 4, 10). The promotion lock must guarantee single-waiter, and connections must be suspended across dispatch.
- **Wakeups are easy to forget** (Bugs 8, 12). Any time you change selector state from a non-leader thread, or want a blocked leader to react, you need `selector.wakeup()`.
- **Reproduce with poolSize = 2 and a slow handler.** Most of these bugs only manifest with concurrency; two threads plus an artificial handler delay surfaces ordering and double-dispatch defects deterministically.
