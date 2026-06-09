# Coordination Anti-Patterns — Exercises

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Coordination** — *hands-on practice making two or more lock holders make progress together.*
> **Covers (collectively):** Lock Ordering Inconsistency → Deadlock · Holding a Lock During I/O · Wrong Lock Granularity

---

These are **fix-it** exercises, not recognition quizzes. Each gives you a problem statement, a starting snippet (in **Go** or **Java** — the language varies on purpose, with a Python/GIL note where it matters), acceptance criteria with hints, and a **collapsible solution** containing correct, idiomatic code and a note on *why* it is deadlock-free or higher-throughput.

> **How to use this file.** Read the problem, write the fix in your editor *before* opening the solution, then compare. For the lock-ordering and deadlock exercises, run with the race/deadlock detector on — `go test -race`, `go run` with `GODEBUG`, or a JVM thread dump — so you *see* the hang, not just reason about it. The "why it's correct" note under each solution matters more than the diff: in concurrency, code that looks right and passes once is the entire problem.

> **A note on judgment.** Not every coarse lock is wrong, and not every fine-grained lock is right. Two of these exercises (8 and 12) deliberately ask you to *coarsen* over-split locks or *keep* a simple global lock — because "split the lock" is a reflex that, applied blindly, manufactures the very bugs the other exercises fix. Profile before you shard.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Impose a global lock order](#exercise-1--impose-a-global-lock-order) | Lock Ordering | Go | ★ easy |
| 2 | [The classic bank-transfer deadlock](#exercise-2--the-classic-bank-transfer-deadlock) | Lock Ordering | Java | ★ easy |
| 3 | [Stop holding the lock during the HTTP call](#exercise-3--stop-holding-the-lock-during-the-http-call) | Lock During I/O | Go | ★ easy |
| 4 | [Copy-release-then-write to the DB](#exercise-4--copy-release-then-write-to-the-db) | Lock During I/O | Java | ★★ medium |
| 5 | [Shard the giant cache lock](#exercise-5--shard-the-giant-cache-lock) | Wrong Granularity (too coarse) | Go | ★★ medium |
| 6 | [Right-size with an RWMutex](#exercise-6--right-size-with-an-rwmutex) | Wrong Granularity (read-heavy) | Go | ★★ medium |
| 7 | [Order-by-identity when you can't fix acquisition order](#exercise-7--order-by-identity-when-you-cant-fix-acquisition-order) | Lock Ordering | Java | ★★ medium |
| 8 | [Coarsen the over-fine locks](#exercise-8--coarsen-the-over-fine-locks) | Wrong Granularity (too fine) | Go | ★★ medium |
| 9 | [Deadlock from a callback under lock](#exercise-9--deadlock-from-a-callback-under-lock) | Lock Ordering + Lock During I/O | Java | ★★★ hard |
| 10 | [Granularity *and* I/O in one cache loader](#exercise-10--granularity-and-io-in-one-cache-loader) | Granularity + Lock During I/O | Go | ★★★ hard |
| 11 | [`tryLock` with backoff — when you truly can't order](#exercise-11--trylock-with-backoff--when-you-truly-cant-order) | Lock Ordering | Java | ★★★ hard |
| 12 | [JUDGMENT: keep the single coarse lock](#exercise-12--judgment-keep-the-single-coarse-lock) | Granularity (judgment) | Go | ★★ medium |
| 13 | [Mini-project: fix the account ledger service](#exercise-13--mini-project-fix-the-account-ledger-service) | All three | Go | ★★★★ project |
| 14 | [Write a lock-discipline review checklist](#exercise-14--write-a-lock-discipline-review-checklist) | meta | — | ★★ medium |

---

## Exercise 1 — Impose a global lock order

**Anti-pattern:** Lock Ordering Inconsistency → Deadlock · **Language:** Go · **Difficulty:** ★ easy

Two functions each take both mutexes, but in opposite orders. Under load the program hangs.

```go
type Pair struct {
	muA sync.Mutex
	muB sync.Mutex
	a, b int
}

func (p *Pair) addToA(n int) {
	p.muA.Lock()
	p.muB.Lock()
	p.a += n
	p.b -= n
	p.muB.Unlock()
	p.muA.Unlock()
}

func (p *Pair) addToB(n int) {
	p.muB.Lock()        // opposite order — the deadlock seed
	p.muA.Lock()
	p.b += n
	p.a -= n
	p.muA.Unlock()
	p.muB.Unlock()
}
```

If goroutine 1 runs `addToA` and grabs `muA`, while goroutine 2 runs `addToB` and grabs `muB`, each now waits forever for the lock the other holds.

**Acceptance criteria**
- Both methods acquire the two mutexes in the **same** order, every time.
- Behavior is otherwise unchanged: `a + b` is conserved.
- No method holds only one lock when it needs both.

**Hint:** pick a canonical order — say, *always `muA` before `muB`* — and make every code path obey it. Document the order in a comment so the next author keeps it.

<details>
<summary>Solution</summary>

```go
type Pair struct {
	muA sync.Mutex
	muB sync.Mutex // LOCK ORDER: always acquire muA before muB.
	a, b int
}

func (p *Pair) addToA(n int) {
	p.muA.Lock()
	defer p.muA.Unlock()
	p.muB.Lock()
	defer p.muB.Unlock()
	p.a += n
	p.b -= n
}

func (p *Pair) addToB(n int) {
	p.muA.Lock() // same order as addToA — the cycle is gone
	defer p.muA.Unlock()
	p.muB.Lock()
	defer p.muB.Unlock()
	p.b += n
	p.a -= n
}
```

**Why it's deadlock-free.** Deadlock needs a *cycle* in the "waits-for" graph. By forcing every thread to acquire `muA` before `muB`, no thread can ever hold `muB` while waiting for `muA` — so the cycle `A→B→A` cannot form. A total order on lock acquisition provably eliminates the [circular-wait](../../../../../Backend/distributed-systems/README.md) condition, one of the four Coffman conditions for deadlock. The `defer` unlocks also guarantee release even if the body panics. (For this specific struct, the deeper fix is a *single* mutex protecting both fields — see Exercise 8 on over-fine locking — but ordering is the general cure when two locks are genuinely independent.)

</details>

---

## Exercise 2 — The classic bank-transfer deadlock

**Anti-pattern:** Lock Ordering Inconsistency → Deadlock · **Language:** Java · **Difficulty:** ★ easy

The textbook deadlock. `transfer(a, b)` locks `a` then `b`; a concurrent `transfer(b, a)` locks `b` then `a`. They wait on each other forever.

```java
class Account {
    private final ReentrantLock lock = new ReentrantLock();
    private long balance;

    Account(long opening) { this.balance = opening; }

    void deposit(long n) { balance += n; }
    void withdraw(long n) { balance -= n; }
    long balance() { return balance; }
    ReentrantLock lock() { return lock; }
}

void transfer(Account from, Account to, long amount) {
    from.lock().lock();             // thread 1: locks A, wants B
    to.lock().lock();               // thread 2 (transfer(B,A)): locks B, wants A  → deadlock
    try {
        from.withdraw(amount);
        to.deposit(amount);
    } finally {
        to.lock().unlock();
        from.lock().unlock();
    }
}
```

**Acceptance criteria**
- Two concurrent transfers between the same two accounts in opposite directions cannot deadlock.
- The transfer is still atomic: an observer never sees money withdrawn from `from` but not yet deposited into `to`.
- No global lock that serializes *all* transfers in the bank.

**Hint:** give every account a stable, unique id, and always lock the lower id first. The accounts then have a *total order* independent of the transfer direction.

<details>
<summary>Solution</summary>

```java
class Account {
    private static final AtomicLong SEQ = new AtomicLong();
    final long id = SEQ.getAndIncrement();   // stable, unique ordering key
    private final ReentrantLock lock = new ReentrantLock();
    private long balance;

    Account(long opening) { this.balance = opening; }
    void deposit(long n) { balance += n; }
    void withdraw(long n) { balance -= n; }
    ReentrantLock lock() { return lock; }
}

void transfer(Account from, Account to, long amount) {
    // Always acquire locks in ascending id order, regardless of direction.
    Account first  = from.id < to.id ? from : to;
    Account second = from.id < to.id ? to   : from;

    first.lock().lock();
    try {
        second.lock().lock();
        try {
            from.withdraw(amount);
            to.deposit(amount);
        } finally {
            second.lock().unlock();
        }
    } finally {
        first.lock().unlock();
    }
}
```

**Why it's deadlock-free.** Both `transfer(A, B)` and `transfer(B, A)` now lock `min(A,B)` first and `max(A,B)` second — an identical acquisition order. With a single global order over all accounts, no circular wait can form, so the pair can never deadlock. Atomicity holds because both locks are held across the withdraw+deposit. Crucially we did *not* introduce a single bank-wide lock: transfers between disjoint account pairs still run fully in parallel, so throughput is preserved.

> **Edge case:** if `from.id == to.id` (a self-transfer), this locks the same `ReentrantLock` twice. `ReentrantLock` is re-entrant so it won't self-deadlock — but the cleaner guard is to reject self-transfers up front (`if (from == to) return;`), since transferring to yourself is a no-op.

</details>

---

## Exercise 3 — Stop holding the lock during the HTTP call

**Anti-pattern:** Holding a Lock During I/O · **Language:** Go · **Difficulty:** ★ easy

This method holds the mutex across a network call. Every other caller now blocks for the *entire* round-trip latency, not just the in-memory update.

```go
type RateStore struct {
	mu    sync.Mutex
	rates map[string]float64
	http  *http.Client
}

// refresh fetches the latest rate and stores it.
func (s *RateStore) refresh(symbol string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// BAD: the network call happens while the lock is held.
	resp, err := s.http.Get("https://api.example.com/rate/" + symbol)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var r struct{ Rate float64 }
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return err
	}
	s.rates[symbol] = r.Rate
	return nil
}
```

While one goroutine waits 200 ms for the API, every other goroutine calling `refresh` (even for a *different* symbol) is blocked the whole time.

**Acceptance criteria**
- The HTTP call happens **outside** any held lock.
- The lock is held only long enough to write the result into the map.
- Two refreshes for different symbols can do their network I/O concurrently.

**Hint:** the lock protects the *map*, not the *network*. Do the I/O lock-free, then take the lock just to store the result.

<details>
<summary>Solution</summary>

```go
func (s *RateStore) refresh(symbol string) error {
	// I/O first, with no lock held.
	resp, err := s.http.Get("https://api.example.com/rate/" + symbol)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var r struct{ Rate float64 }
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return err
	}

	// Lock only to publish the result — microseconds, not milliseconds.
	s.mu.Lock()
	s.rates[symbol] = r.Rate
	s.mu.Unlock()
	return nil
}
```

**Why it's higher-throughput.** The lock now guards only the single map write — a sub-microsecond critical section — instead of a multi-hundred-millisecond network round-trip. N goroutines refreshing N different symbols now issue their HTTP requests in parallel and only briefly serialize on the final store. The lock's job was always to protect the `map` from concurrent writes (Go maps are not safe for concurrent write); it was never the network's job to be serialized. As a rule: **a lock should protect shared memory, never an I/O syscall.**

> If `refresh` must be idempotent under concurrency (two goroutines fetching the same symbol), the last write wins here, which is fine for a rate cache. If you need single-flight (only one in-flight fetch per key), wrap with `golang.org/x/sync/singleflight` — still outside the data lock.

</details>

---

## Exercise 4 — Copy-release-then-write to the DB

**Anti-pattern:** Holding a Lock During I/O · **Language:** Java · **Difficulty:** ★★ medium

This method computes a snapshot under lock, then persists it to the database *while still holding the lock*. The DB write can take tens of milliseconds; meanwhile every reader and writer of `metrics` is frozen.

```java
class MetricsAggregator {
    private final Object lock = new Object();
    private final Map<String, Long> metrics = new HashMap<>();
    private final JdbcTemplate db;

    MetricsAggregator(JdbcTemplate db) { this.db = db; }

    void record(String key, long delta) {
        synchronized (lock) {
            metrics.merge(key, delta, Long::sum);
        }
    }

    void flush() {
        synchronized (lock) {
            // BAD: DB round-trips happen with the lock held; record() is blocked the whole time.
            for (var e : metrics.entrySet()) {
                db.update("INSERT INTO metrics(key, value) VALUES (?, ?) " +
                          "ON CONFLICT (key) DO UPDATE SET value = ?",
                          e.getKey(), e.getValue(), e.getValue());
            }
            metrics.clear();
        }
    }
}
```

**Acceptance criteria**
- The database writes happen with **no lock held**.
- `flush()` takes a consistent snapshot atomically, then persists it outside the lock.
- A concurrent `record()` is never blocked for the duration of the DB I/O.
- No metric increment is silently lost during the flush.

**Hint:** under the lock, *swap out* the map for a fresh empty one and keep the old reference. Release the lock, then write the snapshot to the DB. New `record()` calls accumulate into the new map immediately.

<details>
<summary>Solution</summary>

```java
void flush() {
    Map<String, Long> snapshot;
    synchronized (lock) {
        if (metrics.isEmpty()) return;
        snapshot = metrics;             // take the current map...
        metrics = new HashMap<>();      // ...and immediately install a fresh one
    }
    // Lock released. record() now accumulates into the new map with no contention.
    for (var e : snapshot.entrySet()) {
        db.update("INSERT INTO metrics(key, value) VALUES (?, ?) " +
                  "ON CONFLICT (key) DO UPDATE SET value = ?",
                  e.getKey(), e.getValue(), e.getValue());
    }
}
```

For this to compile, `metrics` must be a non-final field:

```java
private Map<String, Long> metrics = new HashMap<>();
```

**Why it's correct and higher-throughput.** The critical section is now two reference assignments — nanoseconds — instead of a loop of DB round-trips. The *swap* is the key idea: by replacing the map under the lock, we get an exclusive, immutable-by-convention `snapshot` that no other thread can touch, so we can iterate it lock-free. No increment is lost: any `record()` that ran before the swap landed in `snapshot`; any that runs after lands in the new map and will be persisted by the *next* flush. This "copy/swap the data, release the lock, then do I/O" pattern is the canonical cure for holding a lock during I/O.

> **Batching bonus:** with the snapshot in hand outside the lock, you can also collapse the per-row loop into a single `batchUpdate`, cutting the DB round-trips from N to 1 — a second, independent win the original structure made impossible.

</details>

---

## Exercise 5 — Shard the giant cache lock

**Anti-pattern:** Wrong Lock Granularity (too coarse) · **Language:** Go · **Difficulty:** ★★ medium

A single mutex guards one big map. Under high write concurrency across many distinct keys, every operation serializes on that one lock even though the keys never collide.

```go
type Cache struct {
	mu sync.Mutex
	m  map[string]string
}

func NewCache() *Cache {
	return &Cache{m: make(map[string]string)}
}

func (c *Cache) Get(k string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[k]
	return v, ok
}

func (c *Cache) Set(k, v string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[k] = v
}
```

Profiling shows this lock is the top contention point: thousands of goroutines writing thousands of *distinct* keys, all queued behind one mutex.

**Acceptance criteria**
- Operations on keys that hash to different shards proceed in parallel.
- Each shard still protects its own sub-map correctly (no data race — verify with `-race`).
- The public API (`Get`/`Set`) is unchanged.
- The number of shards is fixed and a power of two (cheap masking) or otherwise constant.

**Hint:** split the map into N independent shards, each with its own mutex. Route a key to its shard by hashing the key. Contention drops by roughly a factor of N for uniformly distributed keys.

<details>
<summary>Solution</summary>

```go
import (
	"hash/fnv"
	"sync"
)

const shardCount = 32 // power of two

type shard struct {
	mu sync.RWMutex
	m  map[string]string
}

type Cache struct {
	shards [shardCount]*shard
}

func NewCache() *Cache {
	c := &Cache{}
	for i := range c.shards {
		c.shards[i] = &shard{m: make(map[string]string)}
	}
	return c
}

func (c *Cache) shardFor(k string) *shard {
	h := fnv.New32a()
	h.Write([]byte(k))
	return c.shards[h.Sum32()&(shardCount-1)] // mask, since shardCount is a power of two
}

func (c *Cache) Get(k string) (string, bool) {
	s := c.shardFor(k)
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[k]
	return v, ok
}

func (c *Cache) Set(k, v string) {
	s := c.shardFor(k)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[k] = v
}
```

**Why it's higher-throughput.** A single lock serializes *all* operations; lock striping replaces it with 32 independent locks, so two writes to keys in different shards never contend. For uniformly distributed keys, expected contention drops ~32×, and reads use `RLock` so concurrent reads of the same shard also run in parallel. The fix is still *correct*: each key always maps to exactly one shard, so that shard's mutex fully protects its sub-map — `go test -race` stays clean.

> **Don't overshoot.** More shards is not always better: each shard is overhead (memory + a mutex), and beyond the number of CPU cores the marginal contention win vanishes. 16–64 shards is the usual sweet spot. And for a pure key/value cache with no cross-key invariants, Go's `sync.Map` (optimized for disjoint-key, read-mostly workloads) may beat hand-rolled striping — measure both.

</details>

---

## Exercise 6 — Right-size with an RWMutex

**Anti-pattern:** Wrong Lock Granularity (exclusive lock on a read-heavy structure) · **Language:** Go · **Difficulty:** ★★ medium

A configuration store is read on every request and written maybe once a minute. It uses a plain `Mutex`, so concurrent readers — which don't conflict with each other — needlessly serialize.

```go
type Config struct {
	mu     sync.Mutex
	values map[string]string
}

func (c *Config) Get(k string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.values[k]      // read-only, yet fully exclusive
}

func (c *Config) Reload(fresh map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.values = fresh
}
```

Reads outnumber writes ~100,000 : 1, but a plain `Mutex` lets only one reader proceed at a time.

**Acceptance criteria**
- Many readers can hold the read side simultaneously.
- A reload still takes exclusive access (no reader sees a half-swapped map).
- No data race under `-race`.

**Hint:** when reads vastly dominate and readers don't mutate, a read/write lock lets readers share. Use `sync.RWMutex`: `RLock` for `Get`, `Lock` for `Reload`.

<details>
<summary>Solution</summary>

```go
type Config struct {
	mu     sync.RWMutex
	values map[string]string
}

func (c *Config) Get(k string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.values[k]      // concurrent readers share the read lock
}

func (c *Config) Reload(fresh map[string]string) {
	c.mu.Lock()             // exclusive — blocks until all readers drain
	defer c.mu.Unlock()
	c.values = fresh
}
```

**Why it's higher-throughput.** An `RWMutex` allows any number of concurrent `RLock` holders as long as no writer holds the lock. For a 100,000:1 read:write ratio, reads now run truly in parallel instead of single-file, and the rare `Reload` still gets exclusive access so no reader observes a torn swap. This is "size the lock to the access pattern," not to the data: the data is the same map; the *contention shape* (read-mostly) is what dictates `RWMutex` over `Mutex`.

> **When NOT to reach for `RWMutex`:** if the critical section is tiny and writes are frequent, a plain `Mutex` is often *faster* — `RWMutex` carries more bookkeeping and its reader/writer coordination can cost more than it saves under write contention. The read/write split pays off only when reads genuinely dominate *and* the critical section is non-trivial. For a single swapped pointer like this, an `atomic.Pointer[map[...]]` (copy-on-write) is even leaner. Measure.

</details>

---

## Exercise 7 — Order-by-identity when you can't fix acquisition order

**Anti-pattern:** Lock Ordering Inconsistency → Deadlock · **Language:** Java · **Difficulty:** ★★ medium

A graph engine merges two nodes; each node has its own lock. The merge direction is caller-supplied, so you cannot simply "always lock the argument named `a` first" — `merge(x, y)` and `merge(y, x)` would still cross. There is no natural numeric id.

```java
class Node {
    final ReentrantLock lock = new ReentrantLock();
    final Set<Node> edges = new HashSet<>();
}

void merge(Node a, Node b) {
    a.lock.lock();
    b.lock.lock();          // merge(x,y) vs merge(y,x) → opposite orders → deadlock
    try {
        a.edges.addAll(b.edges);
        b.edges.clear();
    } finally {
        b.lock.unlock();
        a.lock.unlock();
    }
}
```

**Acceptance criteria**
- `merge(x, y)` and `merge(y, x)` running concurrently cannot deadlock.
- The merge stays atomic across both locks.
- No global lock serializing unrelated merges.
- The ordering key is stable for the lifetime of the objects.

**Hint:** when there's no domain id, use `System.identityHashCode` as a stable ordering key, and handle the rare hash *collision* (two distinct objects, same hash) with a tie-breaker lock so the order is still total.

<details>
<summary>Solution</summary>

```java
class Node {
    final ReentrantLock lock = new ReentrantLock();
    final Set<Node> edges = new HashSet<>();
}

// A single tie-break lock makes the order total even when identity hashes collide.
private static final ReentrantLock TIE_BREAK = new ReentrantLock();

void merge(Node a, Node b) {
    if (a == b) return;                      // self-merge is a no-op
    int ha = System.identityHashCode(a);
    int hb = System.identityHashCode(b);

    if (ha < hb) {
        lockBoth(a, b);
    } else if (ha > hb) {
        lockBoth(b, a);
    } else {
        // Rare: distinct objects, equal identity hash. Serialize via the tie-break lock.
        TIE_BREAK.lock();
        try {
            lockBoth(a, b);
        } finally {
            TIE_BREAK.unlock();
        }
    }
}

private void lockBoth(Node first, Node second) {
    first.lock.lock();
    try {
        second.lock.lock();
        try {
            // Note: edges merge in fixed (first,second) lock order, but the *data* op
            // is still a→b semantically; capture direction before reordering if it matters.
            first.edges.addAll(second.edges);
            second.edges.clear();
        } finally {
            second.lock.unlock();
        }
    } finally {
        first.lock.unlock();
    }
}
```

**Why it's deadlock-free.** `System.identityHashCode` gives each object a value that is stable for its lifetime, yielding a total order independent of which argument the caller passed first — so concurrent `merge(x,y)` and `merge(y,x)` acquire locks in the *same* order and no cycle can form. The one hole in that argument is a hash *collision* (two different objects sharing a hash), which would make the order ambiguous; the `TIE_BREAK` lock closes it by serializing only those (extremely rare) collision cases, restoring a total order. Unrelated merges (disjoint node pairs) still run in parallel.

> If the merge *direction* carries meaning (here `a` absorbs `b`), capture that intent in plain variables before you reorder the locks — the lock order is purely a deadlock-avoidance device and must not change which node ends up holding the edges.

</details>

---

## Exercise 8 — Coarsen the over-fine locks

**Anti-pattern:** Wrong Lock Granularity (too fine — locks cost more than the work *and* break an invariant) · **Language:** Go · **Difficulty:** ★★ medium

Someone "optimized" a position tracker by giving every field its own mutex. The result is *slower* (more lock operations per call) and — worse — **incorrect**: `x` and `y` must update together to stay consistent, but separate locks let a reader observe a half-updated position.

```go
type Position struct {
	muX sync.Mutex
	muY sync.Mutex
	x   int
	y   int
}

func (p *Position) MoveBy(dx, dy int) {
	p.muX.Lock()
	p.x += dx
	p.muX.Unlock()
	// a reader can run HERE and see new x but old y — a torn read
	p.muY.Lock()
	p.y += dy
	p.muY.Unlock()
}

func (p *Position) Read() (int, int) {
	p.muX.Lock()
	x := p.x
	p.muX.Unlock()
	p.muY.Lock()
	y := p.y
	p.muY.Unlock()
	return x, y
}
```

**Acceptance criteria**
- `x` and `y` are always read and written as a *consistent pair* — no torn reads.
- The number of lock/unlock operations per call drops.
- The fix is simpler than the original, not more complex.

**Hint:** these two fields form one *consistent unit of state*. Two locks for one invariant is too fine: collapse them into a single mutex that protects the whole position.

<details>
<summary>Solution</summary>

```go
type Position struct {
	mu sync.Mutex // protects x and y together — they share one invariant
	x  int
	y  int
}

func (p *Position) MoveBy(dx, dy int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.x += dx
	p.y += dy
}

func (p *Position) Read() (int, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.x, p.y
}
```

**Why it's correct and faster.** The right granularity is *one lock per consistent unit of state* — and `x`/`y` are a single unit (a coordinate is meaningless half-updated). The original's two locks did not just add overhead (two lock/unlock pairs per call instead of one); they actively created a **torn-read** bug, because no lock spanned both updates. Collapsing to one mutex makes the pair atomic *and* halves the locking work. This is the mirror image of Exercise 5: fine-grained locking is right when the units are *independent* (distinct cache keys) and wrong when it splits an *invariant* (a coordinate). Granularity is a judgment, not a direction — "more locks" is not "better."

</details>

---

## Exercise 9 — Deadlock from a callback under lock

**Anti-pattern:** Lock Ordering Inconsistency + Holding a Lock During an Unknown Operation · **Language:** Java · **Difficulty:** ★★★ hard

An event bus holds its lock while invoking subscriber callbacks. A subscriber that (re)subscribes — or that touches another lock — can deadlock, because the bus is calling *foreign code* while holding its own lock.

```java
class EventBus {
    private final Object lock = new Object();
    private final List<Consumer<String>> subscribers = new ArrayList<>();

    void subscribe(Consumer<String> s) {
        synchronized (lock) { subscribers.add(s); }
    }

    void publish(String event) {
        synchronized (lock) {                       // lock held across callback invocation
            for (Consumer<String> s : subscribers) {
                s.accept(event);                    // foreign code runs under our lock
            }
        }
    }
}
```

Failure modes: (1) a subscriber calls `subscribe()` from within its callback → tries to re-enter `lock` (here it's the *same* monitor so re-entrant, but it also mutates `subscribers` mid-iteration → `ConcurrentModificationException`); (2) a subscriber acquires lock `L`, while another thread holds `L` and calls `publish` → classic two-lock deadlock with `EventBus.lock` and `L` acquired in opposite orders.

**Acceptance criteria**
- Callbacks are invoked with **no bus lock held**.
- A subscriber may safely subscribe/unsubscribe from within its own callback.
- Iteration is over a stable snapshot (no `ConcurrentModificationException`).
- The subscriber list itself is still protected from concurrent mutation.

**Hint:** the lock protects the *subscriber list*, not the *act of dispatching*. Copy the subscriber list under the lock, release it, then iterate the copy and call the callbacks lock-free.

<details>
<summary>Solution</summary>

```java
class EventBus {
    private final Object lock = new Object();
    private final List<Consumer<String>> subscribers = new ArrayList<>();

    void subscribe(Consumer<String> s) {
        synchronized (lock) { subscribers.add(s); }
    }

    void publish(String event) {
        List<Consumer<String>> snapshot;
        synchronized (lock) {
            snapshot = new ArrayList<>(subscribers);   // copy under lock
        }
        // Lock released. Foreign callbacks run with NO bus lock held.
        for (Consumer<String> s : snapshot) {
            s.accept(event);
        }
    }
}
```

A common production-grade variant uses `CopyOnWriteArrayList`, which makes the snapshot implicit:

```java
private final List<Consumer<String>> subscribers = new CopyOnWriteArrayList<>();

void subscribe(Consumer<String> s) { subscribers.add(s); }      // no explicit lock
void publish(String event) {
    for (Consumer<String> s : subscribers) {                    // iterates a stable snapshot
        s.accept(event);
    }
}
```

**Why it's deadlock-free and correct.** The cardinal rule — **never call code you don't control while holding a lock** — is restored: callbacks run lock-free, so a subscriber that grabs lock `L` can never form a cycle with `EventBus.lock` (the bus lock is already released before any callback runs). Copying the list under the lock gives a stable iteration target, so a callback that subscribes/unsubscribes mutates the *live* list without disturbing the in-flight dispatch, eliminating the `ConcurrentModificationException`. The lock still protects the list's structure; it simply no longer wraps the foreign call. `CopyOnWriteArrayList` packages this exact pattern for read-mostly listener lists.

</details>

---

## Exercise 10 — Granularity *and* I/O in one cache loader

**Anti-pattern:** Wrong Granularity + Holding a Lock During I/O (combination) · **Language:** Go · **Difficulty:** ★★★ hard

A read-through cache holds a single global lock across the *cache miss*, which performs a slow DB load. So one slow load for key `"a"` blocks reads of the already-cached key `"b"`. Both anti-patterns at once: the lock is too coarse *and* it spans I/O.

```go
type Loader struct {
	mu    sync.Mutex
	cache map[string]string
	db    *sql.DB
}

func (l *Loader) Get(key string) (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()                 // held across the entire DB load below

	if v, ok := l.cache[key]; ok {
		return v, nil
	}
	// BAD: slow DB query runs with the global lock held; every other key blocks.
	var v string
	err := l.db.QueryRow("SELECT val FROM kv WHERE k = $1", key).Scan(&v)
	if err != nil {
		return "", err
	}
	l.cache[key] = v
	return v, nil
}
```

**Acceptance criteria**
- A cache *hit* never blocks on a concurrent *miss* for a different key.
- The DB query runs with **no lock held**.
- A successful load is stored back into the cache.
- No data race under `-race`.
- Bonus: two concurrent misses for the *same* key do not both hit the DB (single-flight).

**Hint:** two moves. (1) Don't hold the lock across the DB call — check the cache under lock, release, query, then store under lock. (2) For the single-flight bonus, use `golang.org/x/sync/singleflight` so concurrent misses for one key collapse to one DB call.

<details>
<summary>Solution</summary>

```go
import "golang.org/x/sync/singleflight"

type Loader struct {
	mu    sync.RWMutex
	cache map[string]string
	db    *sql.DB
	group singleflight.Group
}

func (l *Loader) Get(key string) (string, error) {
	// Fast path: read lock only, released immediately. A miss does not block this.
	l.mu.RLock()
	v, ok := l.cache[key]
	l.mu.RUnlock()
	if ok {
		return v, nil
	}

	// Miss: load with NO lock held. singleflight collapses concurrent misses for one key.
	val, err, _ := l.group.Do(key, func() (interface{}, error) {
		// Re-check inside the flight in case another goroutine just filled it.
		l.mu.RLock()
		if v, ok := l.cache[key]; ok {
			l.mu.RUnlock()
			return v, nil
		}
		l.mu.RUnlock()

		var loaded string
		if err := l.db.QueryRow("SELECT val FROM kv WHERE k = $1", key).Scan(&loaded); err != nil {
			return "", err
		}

		l.mu.Lock()
		l.cache[key] = loaded
		l.mu.Unlock()
		return loaded, nil
	})
	if err != nil {
		return "", err
	}
	return val.(string), nil
}
```

**Why it's correct, deadlock-free, and faster.** Two independent fixes compound. *Granularity:* the fast-path read takes only an `RLock` and releases it before any I/O, so a hit on `"b"` is never blocked by a miss on `"a"`. *Lock-during-I/O:* the `db.QueryRow` runs with no lock held, then a brief write lock publishes the result — the lock again guards only the map, never the syscall. *Single-flight bonus:* `singleflight.Group.Do` ensures that if 50 goroutines miss on the same key simultaneously, exactly one runs the DB query and the other 49 wait for and share its result — turning a thundering-herd of 50 queries into 1. The inner re-check avoids a redundant load if another flight filled the cache between the fast-path miss and entering `Do`.

</details>

---

## Exercise 11 — `tryLock` with backoff — when you truly can't order

**Anti-pattern:** Lock Ordering Inconsistency → Deadlock · **Language:** Java · **Difficulty:** ★★★ hard

Sometimes you genuinely cannot impose a global order — e.g. locks are handed to you by a framework with no stable identity, or the acquisition set isn't known until runtime. The fallback is *deadlock avoidance* via `tryLock`: grab the first, attempt the second with a timeout, and if it fails, release everything and retry.

```java
// Starting point: the unfixable-by-ordering case. Assume no usable ordering key exists.
boolean transfer(Account from, Account to, long amount) {
    from.lock().lock();
    to.lock().lock();           // can deadlock with the reverse transfer
    try {
        from.withdraw(amount);
        to.deposit(amount);
        return true;
    } finally {
        to.lock().unlock();
        from.lock().unlock();
    }
}
```

**Acceptance criteria**
- No execution can deadlock, even with opposite-direction concurrent transfers.
- If both locks can't be acquired, the method backs off and retries rather than blocking forever.
- Locks already acquired are always released before retrying (no leak).
- A small randomized backoff prevents two threads from livelocking in lockstep.

**Hint:** use `ReentrantLock.tryLock(timeout)`. Acquire the first lock, then `tryLock` the second; on failure release the first and sleep a small random interval before retrying. The randomization breaks the symmetry that causes livelock.

<details>
<summary>Solution</summary>

```java
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

boolean transfer(Account from, Account to, long amount) throws InterruptedException {
    while (true) {
        if (from.lock().tryLock(50, TimeUnit.MILLISECONDS)) {
            try {
                if (to.lock().tryLock(50, TimeUnit.MILLISECONDS)) {
                    try {
                        from.withdraw(amount);
                        to.deposit(amount);
                        return true;
                    } finally {
                        to.lock().unlock();
                    }
                }
                // Couldn't get the second lock: fall through to release the first and retry.
            } finally {
                from.lock().unlock();   // always release the first lock before retrying
            }
        }
        // Randomized backoff breaks lockstep livelock between symmetric threads.
        Thread.sleep(ThreadLocalRandom.current().nextLong(1, 10));
    }
}
```

**Why it's deadlock-free.** `tryLock` with a timeout converts the *unbounded* wait (the thing that lets a cycle hang forever) into a *bounded* one: a thread that can't get the second lock gives up, releases the first, and retries — so no thread holds a lock while waiting indefinitely, and the circular-wait condition cannot persist. The `finally` guarantees the first lock is released on every path, including when the second `tryLock` fails. The **randomized** backoff is essential: without it, two perfectly symmetric threads could repeatedly grab-fail-release in lockstep forever (livelock — busy but no progress); jitter desynchronizes them so one wins.

> **Prefer ordering when you can.** `tryLock`-with-retry is the *fallback*, not the default — it wastes work on contention and complicates reasoning. Reach for it only when a total lock order (Exercises 2, 7) is genuinely unavailable. If you find yourself here often, that's a signal to redesign toward a single owner per resource (e.g. an actor/goroutine that owns the account and serializes via a channel).

</details>

---

## Exercise 12 — JUDGMENT: keep the single coarse lock

**Anti-pattern:** Wrong Lock Granularity — *the judgment call where coarse is correct* · **Language:** Go · **Difficulty:** ★★ medium

A reviewer demands you "shard this lock like the cache in Exercise 5." Here is the code. Decide whether to shard — and defend keeping the single lock if that's the right answer.

```go
// FeatureFlags is read at process start and on rare admin pushes (a few times a day).
// It is read perhaps once per request (~500 req/s) but the critical section is a single
// map read of a tiny map (<50 keys). Writes are a handful per day.
type FeatureFlags struct {
	mu    sync.RWMutex
	flags map[string]bool
}

func (f *FeatureFlags) Enabled(name string) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.flags[name]
}

func (f *FeatureFlags) Set(name string, on bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.flags[name] = on
}
```

**Acceptance criteria**
- A reasoned decision: shard / `RWMutex` as-is / atomic copy-on-write — with the contention math, not vibes.
- If you keep the single lock, justify it against the contention profile.
- Identify what evidence would *change* your decision.

**Hint:** sharding pays off only under *measured* contention. Estimate the time actually spent inside the lock per second and compare it to one second of wall-clock. If the lock is held for microseconds a few hundred times a second, contention is negligible and sharding is complexity for no gain.

<details>
<summary>Solution</summary>

**Decision: keep the single `RWMutex`. Do not shard. (Optionally upgrade to copy-on-write `atomic.Pointer` if profiling later shows even the `RWMutex` matters — it won't here.)**

**The contention math.** A map read of a <50-key map is on the order of ~50 ns. At 500 req/s with one read each, the lock is held for roughly `500 × 50 ns = 25 µs` of *every second* — about **0.0025%** of wall-clock time. With `RWMutex`, those reads don't even exclude each other; they share the read lock. Writes are a few per day and take microseconds. There is no measurable contention to remove. Sharding would add 32 mutexes, a hash on every `Enabled` call, and a more complex `Set` — pure cost, zero benefit, and a new surface for bugs.

**Why coarse is correct here.** Lock granularity is sized to *contention*, not to taste. Exercise 5's cache had thousands of goroutines writing thousands of distinct keys — real, profiled contention on one lock. This structure has the opposite profile: rare writes, cheap reads, modest QPS. The simplest correct lock is the *right* lock when contention is low; "always shard" is cargo-culting Exercise 5 onto a problem that doesn't have its symptoms.

**What would change the decision.** Profile evidence, specifically: a flame graph or `go tool pprof` mutex profile showing `FeatureFlags.mu` as a contention hotspot; or QPS rising by 1000× into the millions; or the critical section growing (e.g. someone adds an expensive computation inside `Enabled`). Absent that evidence, adding shards is premature optimization — and the [optimize.md](optimize.md) drills make the same point: measure first, then size the lock to the measurement.

**Why this is the better answer.** Resisting an unjustified "optimization" is itself the skill. The single lock is correct, the simplest thing that works, and trivially auditable. Engineering judgment means knowing when the textbook fix (shard the lock) is the *wrong* fix because the problem it solves isn't present.

</details>

---

## Exercise 13 — Mini-project: fix the account ledger service

**Anti-pattern:** all three, in one small realistic service · **Language:** Go · **Difficulty:** ★★★★ project

Below is a compact ledger service that manages to combine **every** coordination anti-pattern: a giant lock protecting everything (too coarse), a transfer that locks two accounts in caller order (lock-ordering deadlock), and an audit write that performs network I/O while holding the lock. Fix all three. Work in steps; do not rewrite it in one edit.

```go
type Ledger struct {
	mu       sync.Mutex                 // ONE lock for every account in the bank (too coarse)
	balances map[int64]int64            // accountID -> balance
	audit    *http.Client
}

func (l *Ledger) Transfer(from, to int64, amount int64) error {
	l.mu.Lock()                          // global lock: serializes ALL transfers bank-wide
	defer l.mu.Unlock()

	if l.balances[from] < amount {
		return errors.New("insufficient funds")
	}
	l.balances[from] -= amount
	l.balances[to] += amount

	// I/O under the global lock: every transfer in the bank waits on this network call.
	body := fmt.Sprintf(`{"from":%d,"to":%d,"amount":%d}`, from, to, amount)
	_, err := l.audit.Post("https://audit.example.com/log", "application/json",
		strings.NewReader(body))
	return err
}

func (l *Ledger) Balance(id int64) int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.balances[id]
}
```

**Acceptance criteria**
- **Granularity:** transfers between disjoint account pairs run in parallel — no single bank-wide lock. Use a per-account lock (a map of locks or sharded locks).
- **Lock ordering:** acquire the two account locks in a fixed global order (by account id), so opposite-direction transfers can't deadlock.
- **Lock during I/O:** the audit HTTP POST happens **after** both account locks are released.
- The transfer's balance update remains atomic across both accounts.
- No data race under `-race`; no torn balances.

**Hint:** steps — (1) replace the global lock with a per-account lock you can fetch by id; (2) in `Transfer`, lock `min(from,to)` then `max(from,to)`; (3) update balances under those locks, *then* release, *then* POST the audit log with the data you captured before releasing.

<details>
<summary>Solution</summary>

```go
import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

type Ledger struct {
	// A registry of per-account locks, guarded by a tiny lock used only to fetch/create entries.
	registryMu sync.Mutex
	locks      map[int64]*sync.Mutex

	balancesMu sync.RWMutex          // protects the balances map structure
	balances   map[int64]int64

	audit *http.Client
}

func NewLedger(audit *http.Client) *Ledger {
	return &Ledger{
		locks:    make(map[int64]*sync.Mutex),
		balances: make(map[int64]int64),
		audit:    audit,
	}
}

// lockFor returns the (lazily created) per-account mutex.
func (l *Ledger) lockFor(id int64) *sync.Mutex {
	l.registryMu.Lock()
	defer l.registryMu.Unlock()
	m, ok := l.locks[id]
	if !ok {
		m = &sync.Mutex{}
		l.locks[id] = m
	}
	return m
}

func (l *Ledger) Transfer(from, to int64, amount int64) error {
	if from == to {
		return nil // self-transfer is a no-op
	}

	// 1. Fix the lock order: always lock the lower account id first → no circular wait.
	first, second := from, to
	if second < first {
		first, second = second, first
	}
	lf, ls := l.lockFor(first), l.lockFor(second)

	lf.Lock()
	ls.Lock()
	// 2. Atomic balance update under both per-account locks (NOT a bank-wide lock).
	l.balancesMu.Lock()
	if l.balances[from] < amount {
		l.balancesMu.Unlock()
		ls.Unlock()
		lf.Unlock()
		return errors.New("insufficient funds")
	}
	l.balances[from] -= amount
	l.balances[to] += amount
	l.balancesMu.Unlock()
	ls.Unlock()
	lf.Unlock()

	// 3. I/O AFTER all locks are released, using data captured above.
	body := fmt.Sprintf(`{"from":%d,"to":%d,"amount":%d}`, from, to, amount)
	if _, err := l.audit.Post("https://audit.example.com/log",
		"application/json", strings.NewReader(body)); err != nil {
		return fmt.Errorf("audit log transfer %d->%d: %w", from, to, err)
	}
	return nil
}

func (l *Ledger) Balance(id int64) int64 {
	l.balancesMu.RLock()
	defer l.balancesMu.RUnlock()
	return l.balances[id]
}
```

**What happened to each anti-pattern:**

- **Wrong granularity (too coarse) →** the single bank-wide `mu` is gone. Per-account locks (`lockFor`) let transfers between disjoint account pairs run fully in parallel. A short-lived `balancesMu` protects only the shared `balances` map structure for the brief moment of the two-field update; reads use `RLock`.
- **Lock-ordering deadlock →** `Transfer` always locks `min(from,to)` before `max(from,to)`, so `Transfer(A,B)` and `Transfer(B,A)` acquire in the same order — no cycle, no deadlock.
- **Lock during I/O →** the audit `Post` now runs *after* every lock is released, with the request body captured beforehand. A slow or failing audit endpoint no longer freezes other transfers.

**Why it's better.** Each fix is independent and verifiable: `go test -race` with concurrent opposite-direction transfers stays clean and never hangs; a 200 ms audit endpoint no longer multiplies across all callers; and disjoint transfers scale with cores instead of single-filing through one mutex. The discipline mirrors the bad-structure mini-project — fix one anti-pattern per step, keep `-race` green after each, never big-bang.

> **Production note:** the lazily growing `locks` map never shrinks, which is a slow memory leak for a system that creates many short-lived account ids. In a real service, prefer a fixed array of striped locks keyed by `id % N` (as in Exercise 5) — bounded memory, same deadlock-ordering guarantee (order by the *stripe index*, then by id within a stripe). It's omitted here to keep the per-account-lock idea clear.

</details>

---

## Exercise 14 — Write a lock-discipline review checklist

**Anti-pattern:** meta (prevention) · **Difficulty:** ★★ medium

Coordination bugs are cheapest to stop in review, before they ship and start failing once-in-10,000-times in production. Write a concise, *actionable* reviewer checklist — phrased as questions a reviewer asks of a diff that touches locks — that would catch all three anti-patterns. Aim for questions with a clear "if yes, push back" trigger, not vague advice like "is this thread-safe?"

**Acceptance criteria**
- One or more concrete, answerable questions per anti-pattern.
- Each question has a clear failure trigger and a suggested action.
- Short enough that a reviewer would actually run it on every concurrency PR.

<details>
<summary>Solution</summary>

**Coordination / lock-discipline PR review checklist**

| # | Question | If the answer is… | Then |
|---|---|---|---|
| 1 | Does any function acquire **two or more** locks? | "Yes" | Check they're taken in a documented global order (by id/address) on *every* path. If not → **Lock Ordering** deadlock risk; require a fixed order or a single lock. |
| 2 | Is there any **I/O** (network, DB, disk, `time.Sleep`) inside a critical section? | "Yes" | Push back: copy/swap the data, release the lock, then do the I/O. **Lock During I/O**. |
| 3 | Is a **callback / interface method / user function** invoked while a lock is held? | "Yes" | Push back: snapshot under the lock, release, then call foreign code. (Deadlock + reentrancy risk.) |
| 4 | Is one lock protecting a large, hot, multi-key structure under measured contention? | "Yes, and pprof shows it hot" | Suggest striping / `RWMutex` / sharding sized to the contention. **Too-coarse Granularity**. |
| 5 | Are multiple locks protecting fields that share a single invariant? | "Yes" | Push back: collapse to one lock per consistent unit — torn-read risk. **Too-fine Granularity**. |
| 6 | Is a lock being sharded/split **without a profile** showing contention? | "Yes, just to be safe" | Ask for the mutex profile. No evidence → keep it simple (see Exercise 12). |
| 7 | Is every `Lock()` paired with an unconditional `Unlock()` (via `defer`/`finally`) on all paths, including early returns and panics? | "No" | Push back: lock leak → eventual deadlock. |
| 8 | Did the author run `go test -race` (or the JVM equivalent) on the new concurrent paths? | "No" | Block: concurrency changes ship with race-detector evidence, not "looks right." |

**Author's pre-flight (same list, mirrored):** before requesting review, run questions 1–8 on your own diff and attach the `-race` output. Document any multi-lock order in a comment next to the lock declarations.

**Why this is better than "review for thread-safety."** Each row has a *trigger* and an *action*, so the checklist is mechanical enough to apply under time pressure and specific enough that two reviewers reach the same conclusion. It catches all three coordination anti-patterns at their cheapest moment — a small diff — instead of after an intermittent production hang that takes a week to reproduce. Question 8 is load-bearing: the race detector turns "I reasoned about it" into evidence.

</details>

---

## Summary

- These exercises move you from *recognizing* coordination bugs to *fixing* them: impose a global lock order to kill deadlocks, copy/swap data and release the lock before any I/O, and size the lock to the *contention* — striping or `RWMutex` when units are independent, a single lock when they share an invariant or contention is low.
- **A lock protects shared memory, never an I/O syscall or a foreign callback.** Exercises 3, 4, 9, and 10 all reduce to: snapshot under the lock, release, then do the slow thing.
- **Order, don't pray.** A total order on lock acquisition (by id in 2 and 13, by identity hash in 7) provably removes circular wait. Only when no order exists do you fall back to `tryLock`-with-randomized-backoff (11) — and that's a code smell pointing toward single-ownership designs.
- **Granularity is a judgment, not a direction.** "More locks" is not "better": over-fine locking both wastes work and breaks invariants (8), while a single coarse lock is the *correct* choice under low contention (12). Profile before you shard.
- The three anti-patterns travel together — a single realistic service (Exercise 13) shows all three at once. Fix them one at a time, keep `-race` green after each step, and never big-bang a concurrency rewrite.

---

## Related Topics

- [`junior.md`](junior.md) — what the deadlock/contention bugs look like and why they're hard to reproduce.
- [`middle.md`](middle.md) — detection and the safer patterns used here (lock ordering, copy-release-I/O, striping).
- [`find-bug.md`](find-bug.md) — spot-the-deadlock / spot-the-contention snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more contended implementations to make safe *and* fast.
- [`interview.md`](interview.md) — Q&A on coordination anti-patterns for job prep.
- [Concurrency Anti-Patterns](../README.md) — the chapter overview, with the sibling Synchronization Misuse and Shared State categories.
- [Clean Code → Concurrency](../../../clean-code/11-concurrency/README.md) — the positive patterns these exercises restore.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — extract/swap moves applied to critical sections.
- [Distributed Systems](../../../../../Backend/distributed-systems/README.md) — coordination at the network scale (distributed locks, the same deadlock logic across nodes).
