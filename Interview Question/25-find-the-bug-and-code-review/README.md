# Find the Bug & Code Review

> Code-review-round exercises where a senior Go backend engineer must spot the bug in a realistic snippet, explain its production failure mode, and supply the correct fix.

**34 questions** across **11 topics** · Level: senior

## Topics

- [Data Races](#data-races) (3)
- [Goroutine Leaks](#goroutine-leaks) (3)
- [Deadlocks](#deadlocks) (3)
- [Resource Leaks](#resource-leaks) (4)
- [Database](#database) (3)
- [Error Handling](#error-handling) (4)
- [Slices & Maps](#slices-maps) (3)
- [Concurrency Control](#concurrency-control) (3)
- [HTTP & Server](#http-server) (3)
- [Channels & Select](#channels-select) (2)
- [Defer Pitfalls](#defer-pitfalls) (3)

---

## Data Races

#### 1. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `data-race`, `concurrent-map`

**Bug: concurrent writes to a built-in map.** Go maps are not safe for concurrent access. Multiple goroutines run `counts[w]++` simultaneously, which is a read-modify-write on shared memory with no synchronization.

**Failure mode:** The Go runtime has a built-in map-access race detector that is *always on* (not just under `-race`). When two goroutines touch the map concurrently it calls `throw("concurrent map writes")`, which is a fatal panic that cannot be recovered — the whole process crashes. In production this looks like sporadic, unrecoverable crashes under load that disappear when traffic is low.

**Fix — guard the map with a mutex** (or aggregate per-goroutine and merge):
```go
func countWords(docs []string) map[string]int {
	counts := make(map[string]int)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, doc := range docs {
		wg.Add(1)
		go func(d string) {
			defer wg.Done()
			local := make(map[string]int)
			for _, w := range strings.Fields(d) {
				local[w]++
			}
			mu.Lock()
			for w, n := range local {
				counts[w] += n
			}
			mu.Unlock()
		}(doc)
	}
	wg.Wait()
	return counts
}
```
The per-goroutine `local` map keeps the locked critical section short. For pure counters `sync.Map` is a poor fit; a mutex-guarded map is idiomatic here.

**Key points**
- Bug: concurrent map writes — unrecoverable fatal `throw`, not a recoverable panic
- Fix: mutex around the shared map, or per-goroutine maps merged under lock
- Catch it with `go test -race`; the map-write check fires even without `-race`


```go
func countWords(docs []string) map[string]int {
	counts := make(map[string]int)
	var wg sync.WaitGroup
	for _, doc := range docs {
		wg.Add(1)
		go func(d string) {
			defer wg.Done()
			for _, w := range strings.Fields(d) {
				counts[w]++
			}
		}(doc)
	}
	wg.Wait()
	return counts
}
```

**Follow-ups**
- How would you prevent this class of bug at scale (CI gating, sharded counters, atomics)?

---

#### 2. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `data-race`, `loop-variable`, `closure`

**Bug: the goroutine closure captures the loop variables `i` and `url` by reference.** In Go 1.21 and earlier there is a single `i`/`url` per loop, reused each iteration. By the time the goroutines run, the loop has usually finished and every goroutine reads the final value.

**Failure mode:** Two distinct races. (1) All goroutines see the last `url` and likely write to the same `results[i]` slot — you fetch one URL N times and most slots stay nil. (2) The loop body mutates `i`/`url` while goroutines read them concurrently — a real data race flagged by `-race`. Symptoms: nil-pointer panics downstream, wrong/duplicated data, nondeterministic output.

**Fix (pre-1.22): pass loop vars as arguments** (or shadow with `i, url := i, url`):
```go
for i, url := range urls {
	wg.Add(1)
	go func(i int, url string) {
		defer wg.Done()
		results[i] = fetch(url)
	}(i, url)
}
```
Writing to distinct `results[i]` indices from different goroutines is safe (no overlapping memory). **In Go 1.22+** each iteration gets a fresh `i`/`url`, so the per-iteration copy is automatic — but passing args or shadowing remains the portable, explicit habit.

**Key points**
- Bug: pre-1.22 loop-variable capture shares one variable across all goroutines
- Fix: pass `i, url` as func args (or `i, url := i, url`); Go 1.22+ fixes it at the language level
- Catch it with `-race` and the `loopclosure` vet/golangci-lint check


```go
// Go 1.21 and earlier
func fetchAll(urls []string) []*Result {
	results := make([]*Result, len(urls))
	var wg sync.WaitGroup
	for i, url := range urls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = fetch(url)
		}()
	}
	wg.Wait()
	return results
}
```

**Follow-ups**
- Why is writing to different indices of the same slice from many goroutines race-free?

---

#### 3. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `data-race`, `atomic`, `counter`

**Bug: an unsynchronized shared counter.** `m.requests++` is read-modify-write across goroutines with no atomicity. Concurrent increments lose updates, and a concurrent `Value()` read races with a write.

**Failure mode:** Lost increments (your counter undercounts under load) and an actual data race that `-race` flags. On some architectures a torn read is possible. Symptoms: metrics that are mysteriously low, flaky tests, and a CI race report.

**Fix — use `atomic`** (Go 1.19+ typed atomics are cleanest):
```go
type Metrics struct {
	requests atomic.Int64
}

func (m *Metrics) Incr()        { m.requests.Add(1) }
func (m *Metrics) Value() int64 { return m.requests.Load() }
```
Or with the older API: `atomic.AddInt64(&m.requests, 1)` and `atomic.LoadInt64(&m.requests)`. A mutex also works but is heavier for a single counter. Note `atomic.Int64` must not be copied after first use — keep `Metrics` passed by pointer.

**Key points**
- Bug: non-atomic increment/read of a shared counter loses updates and races
- Fix: `atomic.Int64` (or `atomic.AddInt64`/`LoadInt64`), or a mutex
- Catch it with `-race`; `go vet` copylocks warns if you copy the atomic


```go
type Metrics struct {
	requests int64
}

func (m *Metrics) Incr() {
	m.requests++
}

func (m *Metrics) Value() int64 {
	return m.requests
}

// Incr() is called from many request-handling goroutines.
```

**Follow-ups**
- When would you shard the counter (e.g. per-CPU) instead of a single atomic?

---

## Goroutine Leaks

#### 4. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `goroutine-leak`, `channel-buffer`

**Bug: goroutine leak via an unbuffered channel with only one receiver.** We launch N goroutines but read exactly one value. The other N-1 goroutines block forever on `ch <- query(r)` because nobody will ever receive their result.

**Failure mode:** Every call leaks `len(replicas)-1` goroutines. Under sustained traffic the goroutine count and memory grow without bound until OOM. This is a classic slow leak that passes all unit tests and only shows up as a creeping memory/goroutine graph in production.

**Fix — give the channel enough buffer so every send completes** (and respect ctx):
```go
func firstResponse(ctx context.Context, replicas []string) (string, error) {
	ch := make(chan string, len(replicas)) // buffered: every send succeeds
	for _, r := range replicas {
		go func(r string) { ch <- query(r) }(r)
	}
	select {
	case v := <-ch:
		return v, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
```
With a buffer of `len(replicas)`, the losing goroutines push into the buffer and exit; the buffer is GC'd with the channel. Adding the `ctx.Done()` case prevents blocking forever if all replicas hang.

**Key points**
- Bug: N senders, 1 receiver, unbuffered channel → N-1 goroutines block forever
- Fix: buffer the channel to len(senders) so every send completes and the goroutine exits
- Catch it with `goleak` in tests, runtime.NumGoroutine() monitoring, or pprof goroutine dumps


```go
func firstResponse(ctx context.Context, replicas []string) string {
	ch := make(chan string)
	for _, r := range replicas {
		go func(r string) {
			ch <- query(r) // send result
		}(r)
	}
	return <-ch // take the first one
}
```

**Follow-ups**
- How would you cancel the in-flight queries once you have the first answer?

---

#### 5. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `goroutine-leak`, `context`, `worker-pool`

**Bug: workers don't observe `ctx`, and they leak when `run` returns on cancel.** When `ctx` is cancelled, `run` returns immediately — but the 8 workers are still alive. If `jobs` is still open they keep ranging over it, and the moment one finishes a job it blocks forever on `results <- ...` because the consumer (`run`) has exited.

**Failure mode:** On every cancellation/timeout you leak up to 8 goroutines, each pinned holding a `Result`. Over many short-lived requests this accumulates into thousands of stuck goroutines and lost backpressure. The producer side may also block.

**Fix — make workers select on `ctx.Done()` for their send**, and have `run` propagate cancellation:
```go
func worker(ctx context.Context, jobs <-chan Job, results chan<- Result) {
	for {
		select {
		case j, ok := <-jobs:
			if !ok {
				return
			}
			select {
			case results <- process(j):
			case <-ctx.Done():
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
```
Pass the same `ctx` to every worker. Now both the receive and the send have a cancellation escape hatch, so all goroutines drain when `ctx` is cancelled. Using `errgroup` with a derived context makes the lifecycle explicit.

**Key points**
- Bug: workers block on `results <-` after the consumer exits; no ctx awareness
- Fix: wrap every channel send/receive in a `select` with `case <-ctx.Done()`
- Catch it with `goleak.VerifyNone` in tests and goroutine-count alerts


```go
func worker(jobs <-chan Job, results chan<- Result) {
	for j := range jobs {
		results <- process(j)
	}
}

func run(ctx context.Context, jobs <-chan Job) {
	results := make(chan Result)
	for i := 0; i < 8; i++ {
		go worker(jobs, results)
	}
	for {
		select {
		case r := <-results:
			save(r)
		case <-ctx.Done():
			return // stop on cancel
		}
	}
}
```

**Follow-ups**
- How does `golang.org/x/sync/errgroup` simplify shutting down a worker pool?

---

#### 6. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `goroutine-leak`, `ticker`, `resource-leak`

**Bug: the `time.Ticker` is never stopped.** When `ctx` is cancelled the function returns but never calls `ticker.Stop()`.

**Failure mode:** `time.NewTicker` registers an entry with the runtime timer heap and keeps firing on a background sender. Until Go 1.23, an un-stopped ticker leaks: the ticker (and anything its closure references) is never garbage-collected and the runtime keeps doing work for a ticker nobody reads. With many short-lived `poll` calls this is a steady resource and CPU leak. (Go 1.23 made unreferenced Tickers GC-eligible, but you still shouldn't rely on that and `Stop()` remains correct and portable.)

**Fix — `defer ticker.Stop()`:**
```go
func poll(ctx context.Context, fn func()) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			fn()
		case <-ctx.Done():
			return
		}
	}
}
```
The same rule applies to `time.NewTimer` (call `Stop()`), and avoid `time.Tick` for anything that should ever stop — it can never be reclaimed.

**Key points**
- Bug: ticker created but never `Stop()`-ed; leaks runtime timer + closure
- Fix: `defer ticker.Stop()` right after `NewTicker`
- Catch it with `golangci-lint` (e.g. the `staticcheck`/lostcancel-style checks) and pprof


```go
func poll(ctx context.Context, fn func()) {
	ticker := time.NewTicker(time.Second)
	for {
		select {
		case <-ticker.C:
			fn()
		case <-ctx.Done():
			return
		}
	}
}
```

**Follow-ups**
- Why is `time.Tick` dangerous in long-running services?

---

## Deadlocks

#### 7. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `deadlock`, `mutex`, `reentrancy`

**Bug: self-deadlock from re-locking a non-reentrant mutex.** `Withdraw` holds `a.mu`, then calls `a.Balance()`, which tries to `Lock()` the same mutex. `sync.Mutex` is **not reentrant**, so the second `Lock()` blocks forever — the goroutine deadlocks on itself.

**Failure mode:** The first time any caller has sufficient-funds logic reach `a.Balance()` while holding the lock, that goroutine hangs permanently holding `a.mu`. Every subsequent `Withdraw`/`Balance` on the account also blocks. In a server this is a stuck request handler and a leaked, lock-holding goroutine — eventually the whole account (or pool) is wedged.

**Fix — don't call a locking method while already holding the lock.** Read the field directly, or factor out an unlocked helper:
```go
func (a *Account) Withdraw(n int) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.balance < n { // read the field directly; we already hold the lock
		return errors.New("insufficient funds")
	}
	a.balance -= n
	return nil
}
```
The general rule: have a private `balanceLocked()` that assumes the lock is held, and a public `Balance()` that locks then calls it. Go intentionally has no recursive mutex.

**Key points**
- Bug: `sync.Mutex` is not reentrant; locking it twice in one goroutine deadlocks
- Fix: read fields directly under the lock, or split into locked/unlocked helpers
- Catch it with timeouts/`go test -timeout`, deadlock detection in tests, and code review


```go
type Account struct {
	mu      sync.Mutex
	balance int
}

func (a *Account) Withdraw(n int) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.Balance() < n {
		return errors.New("insufficient funds")
	}
	a.balance -= n
	return nil
}

func (a *Account) Balance() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.balance
}
```

**Follow-ups**
- How would you detect lock-order inversion between two different mutexes?

---

#### 8. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `deadlock`, `waitgroup`, `race`

**Bug: `wg.Wait()` can run before any `wg.Add(1)`.** The `Add` calls happen inside a separate goroutine that may not be scheduled before `wg.Wait()` executes. If `Wait()` sees the counter at 0, it returns immediately — `process` finishes while the work is still being launched.

**Failure mode:** This is the textbook `WaitGroup` misuse. Two outcomes: (1) `Wait()` returns early and you proceed before the items are handled — silent data loss / premature shutdown; or (2) if `Wait()` already returned and then an `Add` runs concurrently, you can get `panic: sync: WaitGroup is reused before previous Wait has returned` / `negative WaitGroup counter`. The rule is: **`Add` must happen-before `Wait`, in the same goroutine that owns the group.**

**Fix — call `Add` on the spawning goroutine, before launching workers:**
```go
func process(items []Item) {
	var wg sync.WaitGroup
	for _, it := range items {
		wg.Add(1)
		go handle(it, &wg)
	}
	wg.Wait()
}
```
If the spawning genuinely must be async, `Add(len(items))` once up front, before the goroutine starts.

**Key points**
- Bug: `Add` runs in a child goroutine, so `Wait` can observe a zero counter and return early
- Fix: `Add` before launching work, in the goroutine that calls `Wait`
- Catch it with `-race` and `goleak`; the WaitGroup contract is also flagged by review


```go
func process(items []Item) {
	var wg sync.WaitGroup
	go func() {
		for _, it := range items {
			wg.Add(1)
			go handle(it, &wg)
		}
	}()
	wg.Wait()
}

func handle(it Item, wg *sync.WaitGroup) {
	defer wg.Done()
	// ...
}
```

**Follow-ups**
- What runtime panics does `sync.WaitGroup` produce when its counter goes negative?

---

#### 9. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `deadlock`, `lock-ordering`, `mutex`

**Bug: lock-order inversion → deadlock.** `merge(x, y)` locks x then y; `merge(y, x)` locks y then x. If they run concurrently, goroutine 1 holds x and waits for y while goroutine 2 holds y and waits for x — a classic deadly embrace.

**Failure mode:** Intermittent, load-dependent hangs. It works fine in tests (which rarely interleave the two orders at the wrong instant) and then wedges two request handlers in production, holding both resources' locks indefinitely. Hard to reproduce, painful to diagnose.

**Fix — impose a global lock ordering** (e.g. by a stable unique id) so all callers acquire in the same order:
```go
func merge(a, b *Resource) {
	first, second := a, b
	if first.id > second.id {
		first, second = second, first
	}
	first.mu.Lock()
	defer first.mu.Unlock()
	second.mu.Lock()
	defer second.mu.Unlock()
	a.data = append(a.data, b.data...)
}
```
Always lock the lower-id resource first regardless of argument order, eliminating the cycle. (Guard against `a == b` if self-merge is possible.)

**Key points**
- Bug: two call sites acquire the same pair of locks in opposite order → deadlock
- Fix: establish a total order (e.g. by id/address) and acquire locks in that order everywhere
- Catch it with stress tests under `-race`, deadlock detectors, and lock-hierarchy review


```go
func merge(a, b *Resource) {
	a.mu.Lock()
	b.mu.Lock()
	a.data = append(a.data, b.data...)
	b.mu.Unlock()
	a.mu.Unlock()
}

// Called concurrently as merge(x, y) and merge(y, x).
```

**Follow-ups**
- Could you avoid two-lock acquisition entirely with a single coarser lock or a lock-free design?

---

## Resource Leaks

#### 10. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `resource-leak`, `http`, `body-close`

**Bug: `resp.Body` is never closed.** On the success path (and even on a non-2xx status, where `err` is nil but there is still a body) the body is left open.

**Failure mode:** Each unclosed body holds a TCP connection that cannot be returned to the transport's idle pool. Under load you exhaust file descriptors and ephemeral ports, connection reuse stops working (every request opens a new socket), and you eventually hit `dial: too many open files`. This is one of the most common Go production leaks.

**Fix — always `defer resp.Body.Close()` after the error check**, and ideally drain the body so the connection can be reused:
```go
func fetchJSON(url string, v any) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, resp.Body) // drain so the conn can be reused
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}
```
Note `Close` is correct even when `err != nil`? No — when `http.Get` returns an error, `resp` is nil, so you must close only after confirming `err == nil`, exactly as above.

**Key points**
- Bug: HTTP response body left open → connection/fd leak, no connection reuse
- Fix: `defer resp.Body.Close()` after the err check; drain the body before closing
- Catch it with `bodyclose` linter (golangci-lint), fd-count monitoring


```go
func fetchJSON(url string, v any) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	return json.NewDecoder(resp.Body).Decode(v)
}
```

**Follow-ups**
- Why does failing to fully read the body hurt connection reuse even if you close it?

---

#### 11. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `resource-leak`, `database`, `sql-rows`

**Three bugs.** (1) **`rows` is never closed** — a `*sql.Rows` holds a connection from the pool until `Close()` (or full iteration *plus* error). (2) **`rows.Scan` error is ignored** — a scan failure silently inserts a zero-value `User`. (3) **`rows.Err()` is never checked** — the `for rows.Next()` loop also terminates on an *error* mid-iteration (e.g. connection dropped), and without `rows.Err()` you return a truncated result set as if it were complete.

**Failure mode:** The missing `Close` leaks a pooled connection per call (the connection is only released when the rows are GC'd/finalized, which is nondeterministic); under load the pool drains and every query blocks waiting for a connection. The unchecked `rows.Err()` means a partial read during a network blip looks like a successful, smaller result — silent data corruption.

**Fix:**
```go
func loadUsers(ctx context.Context, db *sql.DB) ([]User, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, name FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil { // iteration error
		return nil, err
	}
	return users, nil
}
```
Also switched to `QueryContext` so the query honours cancellation/timeout.

**Key points**
- Bugs: no `rows.Close()`, ignored `Scan` error, missing `rows.Err()` after the loop
- Fix: `defer rows.Close()`, check `Scan` err, check `rows.Err()`, use `QueryContext`
- Catch it with `rowserrcheck` + `sqlclosecheck` linters and `errcheck`


```go
func loadUsers(db *sql.DB) ([]User, error) {
	rows, err := db.Query("SELECT id, name FROM users")
	if err != nil {
		return nil, err
	}
	var users []User
	for rows.Next() {
		var u User
		rows.Scan(&u.ID, &u.Name)
		users = append(users, u)
	}
	return users, nil
}
```

**Follow-ups**
- Why can ignoring `rows.Err()` cause silent data loss but never a panic?

---

#### 12. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `resource-leak`, `defer`, `file-descriptor`

**Bug: `defer f.Close()` inside a loop.** `defer` runs at *function* return, not at the end of each iteration. So all opened files stay open for the entire duration of the loop.

**Failure mode:** If `paths` is large (say, processing 50k files), you hold tens of thousands of file descriptors open simultaneously and hit the per-process fd limit (`EMFILE: too many open files`). The function may also pin a lot of OS resources far longer than needed. With one path it's fine; at scale it's an outage.

**Fix — scope each resource to its own function so `defer` fires per iteration:**
```go
func processFiles(paths []string) error {
	for _, p := range paths {
		if err := processOne(p); err != nil {
			return err
		}
	}
	return nil
}

func processOne(p string) error {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer f.Close() // runs when processOne returns — once per file
	return consume(f)
}
```
Extracting `processOne` gives each file its own deferred close. Alternatively close explicitly at the end of the loop body, but the helper-function pattern is cleaner and still handles early returns.

**Key points**
- Bug: `defer Close()` in a loop defers until the function returns, holding every fd open
- Fix: move the open+defer into a per-iteration helper function
- Catch it with review/`golangci-lint`; symptom is `too many open files` at scale


```go
func processFiles(paths []string) error {
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		if err := consume(f); err != nil {
			return err
		}
	}
	return nil
}
```

**Follow-ups**
- When is a loop-scoped `defer` actually acceptable?

---

#### 13. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `resource-leak`, `context`, `lostcancel`

**Bug: the `cancel` function from `context.WithTimeout` is discarded with `_`.** Every `WithCancel`/`WithTimeout`/`WithDeadline` returns a `cancel` that *must* be called.

**Failure mode:** Even though the timeout will eventually fire after 2s, the context registers itself on the parent's child list. If you never call `cancel`, that context (and its timer) lingers until the deadline elapses *and* isn't released early when the RPC returns sooner. With high request rates you accumulate pending timers and a growing chain of child contexts on a long-lived parent context — a memory and timer leak. `go vet`'s `lostcancel` analyzer flags this exact pattern.

**Fix — capture and `defer cancel()`:**
```go
func callWithDeadline(parent context.Context) (*Response, error) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	return rpc(ctx)
}
```
Calling `cancel()` on return immediately releases the timer and detaches from the parent, regardless of whether the RPC finished early, errored, or timed out. It is safe and idempotent to call even after the deadline fired.

**Key points**
- Bug: discarded `cancel` from `WithTimeout` leaks the context's timer and parent linkage
- Fix: `ctx, cancel := ...; defer cancel()`
- Catch it with `go vet` (lostcancel) and `golangci-lint`


```go
func callWithDeadline(parent context.Context) (*Response, error) {
	ctx, _ := context.WithTimeout(parent, 2*time.Second)
	return rpc(ctx)
}
```

**Follow-ups**
- Why is calling `cancel()` still required when the timeout will fire anyway?

---

## Database

#### 14. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `database`, `n-plus-one`, `performance`

**Bug: classic N+1 query.** One query fetches the orders, then the loop issues a separate `getItems` query for *every* order. For N orders you make N+1 round-trips to the database.

**Failure mode:** Latency scales linearly with result size and is dominated by per-query round-trip overhead, not data volume. A customer with 500 orders triggers 501 queries; under concurrency this saturates the connection pool and the DB's query parser/planner. It passes tests (small fixtures) and tanks p99 latency in production for power users — the most common DB performance bug in code review.

**Fix — fetch all items in a single query with `IN` (or a JOIN), then group in memory:**
```go
func ordersWithItems(ctx context.Context, db *sql.DB, customerID int) ([]Order, error) {
	orders, err := getOrders(ctx, db, customerID)
	if err != nil || len(orders) == 0 {
		return orders, err
	}
	ids := make([]int, len(orders))
	for i, o := range orders {
		ids[i] = o.ID
	}
	// SELECT order_id, ... FROM items WHERE order_id = ANY($1)
	itemsByOrder, err := getItemsForOrders(ctx, db, ids)
	if err != nil {
		return nil, err
	}
	for i := range orders {
		orders[i].Items = itemsByOrder[orders[i].ID]
	}
	return orders, nil
}
```
Two queries total regardless of N. Use `ANY($1)`/`pq.Array` (Postgres) or a join; batch in chunks if the id list can be huge.

**Key points**
- Bug: N+1 — a per-row query inside a loop, latency scales with row count
- Fix: batch with a single `WHERE id = ANY(...)` query (or JOIN) and group in memory
- Catch it with query-count assertions in integration tests and DB slow-query/APM dashboards


```go
func ordersWithItems(ctx context.Context, db *sql.DB, customerID int) ([]Order, error) {
	orders, err := getOrders(ctx, db, customerID)
	if err != nil {
		return nil, err
	}
	for i := range orders {
		items, err := getItems(ctx, db, orders[i].ID) // one query per order
		if err != nil {
			return nil, err
		}
		orders[i].Items = items
	}
	return orders, nil
}
```

**Follow-ups**
- When is N+1 acceptable, and how big can the `IN` list get before you chunk it?

---

#### 15. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `database`, `sql-injection`, `security`

**Bug: SQL injection via string concatenation.** `name` is interpolated directly into the query. An attacker passing `name = "' OR '1'='1"` or `"'; DROP TABLE users; --"` alters the query semantics.

**Failure mode:** Authentication bypass, full data exfiltration, or destructive statements — a critical, exploitable security vulnerability (OWASP A03). It will also break on legitimate input containing an apostrophe (`O'Brien`).

**Fix — use a parameterized/prepared query** so the value is sent separately from the SQL text:
```go
func findUser(ctx context.Context, db *sql.DB, name string) (*User, error) {
	const q = "SELECT id, email FROM users WHERE name = $1" // or ? for MySQL
	var u User
	if err := db.QueryRowContext(ctx, q, name).Scan(&u.ID, &u.Email); err != nil {
		return nil, err
	}
	return &u, nil
}
```
The driver binds `name` as a parameter; it can never be parsed as SQL. Never build queries with `fmt.Sprintf`/`+` from untrusted input. For dynamic identifiers (table/column names, which can't be parameters) use a strict allow-list, not interpolation.

**Key points**
- Bug: user input concatenated into SQL → injection (critical security flaw)
- Fix: parameterized query with placeholders ($1 / ?), never string concatenation
- Catch it with `gosec` (G201/G202), `sqlvet`, and security review


```go
func findUser(ctx context.Context, db *sql.DB, name string) (*User, error) {
	q := "SELECT id, email FROM users WHERE name = '" + name + "'"
	row := db.QueryRowContext(ctx, q)
	var u User
	if err := row.Scan(&u.ID, &u.Email); err != nil {
		return nil, err
	}
	return &u, nil
}
```

**Follow-ups**
- How do you safely build queries with dynamic column or table names?

---

#### 16. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `database`, `transaction`, `rollback`

**Bug: error paths return without rolling back the transaction.** If either `ExecContext` fails, the function returns the error but never calls `tx.Rollback()`. The transaction is left open.

**Failure mode:** Each failed transfer leaks a pooled connection that stays inside an open transaction. The connection isn't returned to the pool, and on the DB side it holds locks and bloats (in Postgres, an idle-in-transaction connection blocks vacuum and can pin row locks). Under load you exhaust the pool *and* the DB's connection slots; replication and lock contention degrade. Classic partially-applied-money risk too if any rollback is missed.

**Fix — a single deferred rollback that is a no-op after commit:**
```go
func transfer(ctx context.Context, db *sql.DB, from, to, amount int) (err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			tx.Rollback() // safe no-op if already committed
		}
	}()
	if _, err = tx.ExecContext(ctx, "UPDATE accounts SET bal = bal - $1 WHERE id = $2", amount, from); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE accounts SET bal = bal + $1 WHERE id = $2", amount, to); err != nil {
		return err
	}
	return tx.Commit()
}
```
The named return `err` lets the deferred func decide. `tx.Rollback()` after a successful `Commit` returns `sql.ErrTxDone` and is harmless. (A real transfer should also guard against negative balances with a `CHECK`/`WHERE bal >= amount`.)

**Key points**
- Bug: early returns on Exec failure leave the tx open — no `Rollback`
- Fix: `defer` a rollback gated on a named-return `err`; commit makes rollback a no-op
- Catch it with `sqlclosecheck`, integration tests that force mid-tx failure, idle-in-transaction monitoring


```go
func transfer(ctx context.Context, db *sql.DB, from, to, amount int) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE accounts SET bal = bal - $1 WHERE id = $2", amount, from); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE accounts SET bal = bal + $1 WHERE id = $2", amount, to); err != nil {
		return err
	}
	return tx.Commit()
}
```

**Follow-ups**
- Why is calling `Rollback` after a successful `Commit` safe, and what does it return?

---

## Error Handling

#### 17. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `error-handling`, `swallowed-error`, `errcheck`

**Bug: both errors are swallowed.** `json.Marshal`'s error is discarded with `_`, and `os.WriteFile`'s return value (its error) is ignored entirely.

**Failure mode:** If marshaling fails (e.g. a field with an unsupported type, or a `MarshalJSON` that errors) you write `nil`/empty data and never know. If `WriteFile` fails (disk full, permission denied, read-only filesystem) the caller believes the config was persisted. This is silent data loss — the failure surfaces much later as a corrupt or stale config that nobody can explain.

**Fix — propagate both errors:**
```go
func saveConfig(path string, c Config) error {
	data, err := json.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}
	return nil
}
```
Functions that can fail must return an `error`. For atomic durability, write to a temp file and `os.Rename` it into place, and consider `f.Sync()` before close.

**Key points**
- Bug: ignored errors from `Marshal` and `WriteFile` → silent data loss
- Fix: return errors wrapped with `%w` and context; never `_` an error you depend on
- Catch it with `errcheck` / `golangci-lint` (errcheck is on by default in many setups)


```go
func saveConfig(path string, c Config) {
	data, _ := json.Marshal(c)
	os.WriteFile(path, data, 0644)
}
```

**Follow-ups**
- How would you make the write atomic so a crash mid-write can't corrupt the file?

---

#### 18. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `error-handling`, `error-wrapping`, `errorlint`

**Bug: `%v` instead of `%w` breaks the error chain.** `fmt.Errorf("...: %v", err)` formats the underlying error into a *new* opaque string and discards the wrapped error. The caller's `errors.Is(err, repo.ErrNotFound)` can never match because there is no chain to unwrap.

**Failure mode:** The 404 branch never fires. A missing record gets handled as a generic 500, retries hammer the backend, and sentinel/`errors.As` type checks silently fail everywhere up the stack. This is subtle because the error *message* still looks correct in logs — only programmatic matching is broken.

**Fix — wrap with `%w`** so `errors.Is`/`errors.As` can traverse the chain:
```go
func getName(id int) (string, error) {
	u, err := repo.Find(id)
	if err != nil {
		return "", fmt.Errorf("get name: %w", err)
	}
	return u.Name, nil
}
```
Use `%w` when callers need to inspect the cause; use `%v` deliberately when you want to *seal* the error and hide the underlying type as an implementation detail. Don't double-wrap the same error with two `%w` verbs unless you intend a multi-error (Go 1.20+).

**Key points**
- Bug: `%v` flattens the wrapped error to a string, breaking `errors.Is`/`errors.As`
- Fix: use `%w` to preserve the unwrap chain for sentinel/type matching
- Catch it with `errorlint` (golangci-lint), which flags non-wrapping of errors


```go
var ErrNotFound = errors.New("not found")

func getName(id int) (string, error) {
	u, err := repo.Find(id)
	if err != nil {
		return "", fmt.Errorf("get name: %v", err)
	}
	return u.Name, nil
}

// Caller:
name, err := getName(id)
if errors.Is(err, repo.ErrNotFound) {
	// handle 404
}
```

**Follow-ups**
- When is using `%v` (deliberately not wrapping) the correct choice?

---

#### 19. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `error-handling`, `value-before-error`, `ordering`

**Bug: the value `n` is used before the error `err` is checked.** `strconv.Atoi` returns `(0, err)` on failure. The code reads `n` in the range check *before* validating `err`. The error check below is dead-ordered.

**Failure mode:** For invalid input like `"abc"`, `Atoi` returns `n=0, err!=nil`. The first `if n < 1` catches it and returns 8080 — by luck the result is fine here. But this pattern is a landmine: change the default boundary, or use a function whose zero value is in-range, and you'll silently accept a garbage parse. The general anti-pattern is **trusting a return value before checking the error that governs it** — partial/zero results get treated as valid data.

**Fix — check `err` first, always:**
```go
func parsePort(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 8080
	}
	if n < 1 || n > 65535 {
		return 8080
	}
	return n
}
```
The invariant: on a non-nil error, treat all other returns as undefined and do not read them. Even better, return `(int, error)` so the caller decides on the default rather than silently masking misconfiguration.

**Key points**
- Bug: uses the parsed value before checking the error governing it
- Fix: check `err` immediately and return/handle before touching other returns
- Catch it with code review and `nilness`/`staticcheck`; tests with invalid input expose it


```go
func parsePort(s string) int {
	n, err := strconv.Atoi(s)
	if n < 1 || n > 65535 {
		return 8080 // default
	}
	if err != nil {
		return 8080
	}
	return n
}
```

**Follow-ups**
- Why is silently defaulting on a config parse error often worse than failing loudly?

---

#### 20. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `error-handling`, `io-reader`, `eof`

**Bug: `io.EOF` is treated as a fatal error, discarding the data already read.** A correct reader returns `io.EOF` (often *with* the final non-zero `n`) to signal end of stream. Here, the moment EOF arrives we `return nil, err`, throwing away everything in `buf` — including the last chunk where `n > 0` is returned alongside EOF.

**Failure mode:** Every successful read of a finite stream returns `(nil, io.EOF)` — i.e. it *never* returns data, and the caller sees an error on every normal read. Also, by checking `err` before consuming `tmp[:n]`, the last partial chunk is silently dropped even if you handled EOF afterward. Classic `io.Reader` contract violation.

**Fix — consume `tmp[:n]` first, then handle EOF as the normal terminator:**
```go
func readAll(r io.Reader) ([]byte, error) {
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 256)
	for {
		n, err := r.Read(tmp)
		buf = append(buf, tmp[:n]...) // process bytes BEFORE inspecting err
		if err == io.EOF {
			return buf, nil
		}
		if err != nil {
			return nil, err
		}
	}
}
```
In practice just use `io.ReadAll`, which encapsulates this contract correctly.

**Key points**
- Bug: returns on `io.EOF` and checks err before consuming `n` bytes → drops data, errors on every read
- Fix: process `tmp[:n]` first; treat `io.EOF` as normal end-of-stream
- Catch it with tests over short readers; prefer `io.ReadAll`


```go
func readAll(r io.Reader) ([]byte, error) {
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 256)
	for {
		n, err := r.Read(tmp)
		if err != nil {
			return nil, err
		}
		buf = append(buf, tmp[:n]...)
	}
	return buf, nil
}
```

**Follow-ups**
- Why can a Reader return both `n > 0` and `io.EOF` in the same call?

---

## Slices & Maps

#### 21. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `map`, `nil-map`, `panic`

**Bug: writing to a nil map.** `NewCache` returns `&Cache{}`, so `data` is its zero value — a `nil` map. Reading a nil map is fine (returns zero values), but **writing to a nil map panics** with `assignment to entry in nil map`.

**Failure mode:** The very first `Set` call panics and crashes the goroutine/process. If this is a lazily-used cache, it may pass startup and blow up only when the first write happens under real traffic. A common variant: a struct gets a map field added later, but a constructor or a `json.Unmarshal` path leaves it nil.

**Fix — initialize the map in the constructor:**
```go
func NewCache() *Cache {
	return &Cache{data: make(map[string][]byte)}
}
```
If the struct can be created without the constructor, initialize lazily inside `Set` (`if c.data == nil { c.data = make(...) }`) under a lock, or document that the constructor is mandatory. Always initialize maps before writing.

**Key points**
- Bug: nil map write panics (`assignment to entry in nil map`); reads don't
- Fix: `make` the map in the constructor (or lazily before first write)
- Catch it with a unit test that calls `Set`; `nilness` analyzer can sometimes flag it


```go
type Cache struct {
	data map[string][]byte
}

func NewCache() *Cache {
	return &Cache{}
}

func (c *Cache) Set(k string, v []byte) {
	c.data[k] = v
}
```

**Follow-ups**
- Why does reading a nil map succeed but writing panics?

---

#### 22. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `slice`, `append-aliasing`, `backing-array`

**Bug: `append` aliasing — `row := append(base, id)` mutates a shared backing array.** If `base` has spare capacity (`cap(base) > len(base)`), each `append` writes `id` into the *same* underlying array slot and returns a slice pointing at it. Every `row` then shares that backing array.

**Failure mode:** Instead of `[[1,2,10],[1,2,20],[1,2,30]]` you get rows that all alias the same memory; the last write wins, so you might see `[[1,2,30],[1,2,30],[1,2,30]]`. It's nondeterministic on `cap(base)` — works when `base` was created exactly full, breaks when it has slack (e.g. it came from a larger pool or a prior `append`). One of the nastiest Go aliasing bugs because it's data-dependent and invisible in small tests.

**Fix — never append to a slice you don't own; copy first**, or use the 3-index slice to force a fresh array:
```go
func appendID(base []int, ids ...int) [][]int {
	out := make([][]int, 0, len(ids))
	for _, id := range ids {
		row := make([]int, len(base), len(base)+1)
		copy(row, base)
		row = append(row, id)
		out = append(out, row)
	}
	return out
}
```
Alternatively `base[:len(base):len(base)]` (full slice expression) caps capacity so the next `append` is forced to allocate. Go 1.21's `slices.Clone(base)` is the idiomatic copy.

**Key points**
- Bug: appending to a shared slice with spare cap makes all results alias one array
- Fix: clone the base (`slices.Clone`/`copy`) or use `base[:n:n]` to force reallocation
- Catch it with property tests across varying `cap`, careful review; no linter reliably finds it


```go
func appendID(base []int, ids ...int) [][]int {
	var out [][]int
	for _, id := range ids {
		row := append(base, id)
		out = append(out, row)
	}
	return out
}

// base := []int{1, 2}  // cap may be > len
// appendID(base, 10, 20, 30)
```

**Follow-ups**
- How does the three-index slice expression `s[low:high:max]` prevent this?

---

#### 23. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `slice`, `memory-leak`, `backing-array`

**Bug: returning a sub-slice that retains the entire backing array.** `all[:64]` shares the same backing array as `all`. As long as the returned slice is reachable, the whole 10 MB array cannot be garbage-collected — only 64 bytes are logically used, but 10 MB stays pinned.

**Failure mode:** A memory leak proportional to how many such headers you keep around. If you cache thousands of headers, you're holding gigabytes of file contents you'll never read. The leak is invisible in code (the slice *looks* tiny) and only shows as unexplained heap growth in pprof, where the retained bytes trace back to `os.ReadFile`.

**Fix — copy the bytes you need into a fresh, right-sized slice** so the large array can be collected:
```go
func readHeader(path string) ([]byte, error) {
	all, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(all) < 64 {
		return nil, fmt.Errorf("file too short: %d bytes", len(all))
	}
	hdr := make([]byte, 64)
	copy(hdr, all[:64]) // or: hdr := bytes.Clone(all[:64])
	return hdr, nil
}
```
Also note `all[:64]` panics if the file is shorter than 64 bytes — added a length guard. The same retention trap applies to slicing strings/large slices you store long-term.

**Key points**
- Bug: sub-slice keeps the full backing array alive → large hidden memory retention
- Fix: `copy`/`bytes.Clone` the needed bytes into a new slice; also guard the length
- Catch it with heap profiling (pprof inuse_space) tracing retention to the source slice


```go
// Reads a 10 MB file, returns just the small header bytes.
func readHeader(path string) ([]byte, error) {
	all, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return all[:64], nil // first 64 bytes
}
```

**Follow-ups**
- How would pprof reveal that 64 returned bytes are pinning 10 MB?

---

## Concurrency Control

#### 24. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `concurrency`, `goroutine-explosion`, `rate-limiting`

**Bug: unbounded goroutine spawn per request.** Each request launches `len(ids)` goroutines with no limit, no lifetime management, and no link to the request's context.

**Failure mode:** A single request with a large/attacker-controlled `ids` (say 1,000,000 entries) spawns a million goroutines instantly. Across concurrent requests this is a goroutine explosion: scheduler thrash, memory blowup (each goroutine ≈ 2KB+ stack), and downstream services hammered with unbounded concurrency. It's a built-in DoS amplifier. The goroutines also outlive the request and ignore cancellation, so even after the client disconnects the work continues.

**Fix — bound concurrency with a worker pool or a semaphore**, and propagate context:
```go
func handler(w http.ResponseWriter, r *http.Request) {
	ids := parseIDs(r)
	if len(ids) > maxBatch {
		http.Error(w, "too many ids", http.StatusBadRequest)
		return
	}
	sem := make(chan struct{}, 16) // at most 16 concurrent
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		sem <- struct{}{}
		go func(id int) {
			defer wg.Done()
			defer func() { <-sem }()
			enrich(r.Context(), id)
		}(id)
	}
	wg.Wait() // or hand off to a managed background queue
	w.WriteHeader(http.StatusAccepted)
}
```
Use `golang.org/x/sync/errgroup` with `SetLimit`, or a persistent worker pool / job queue for true fire-and-forget. Always cap fan-out derived from request input and validate the batch size.

**Key points**
- Bug: unbounded per-request goroutines driven by untrusted input → DoS/OOM, ignores cancellation
- Fix: bound with a semaphore/worker pool (e.g. errgroup `SetLimit`), validate batch size, pass ctx
- Catch it with load testing, goroutine-count alerts, and review of input-driven fan-out


```go
func handler(w http.ResponseWriter, r *http.Request) {
	ids := parseIDs(r)
	for _, id := range ids {
		go enrich(id) // fire off enrichment in the background
	}
	w.WriteHeader(http.StatusAccepted)
}
```

**Follow-ups**
- For true fire-and-forget, why is a persistent queue better than spawning goroutines?

---

#### 25. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `concurrency`, `copylocks`, `waitgroup`

**Bug: the `Pool` receiver is by value, so `sync.WaitGroup` (and `sync.Mutex`) are copied.** `func (p Pool) Run` copies the whole struct, including the `WaitGroup`. `Add`/`Done`/`Wait` then operate on a *copy*, not a shared instance.

**Failure mode:** `sync` types must not be copied after first use — copying duplicates internal state (counter, semaphore, waiter list). The behavior is undefined: you can get a spurious `panic: sync: WaitGroup is reused before previous Wait has returned`, a `Wait` that never observes the `Done`s (deadlock/hang), or silent wrong synchronization. `go vet`'s `copylocks` analyzer flags this at compile-of-tests time.

**Fix — use a pointer receiver** so all calls share one struct (and never copy a struct containing a lock):
```go
func (p *Pool) Run(tasks []func()) {
	for _, t := range tasks {
		p.wg.Add(1)
		go func(t func()) {
			defer p.wg.Done()
			t()
		}(t)
	}
	p.wg.Wait()
}
```
More generally, any type embedding a `sync.Mutex`/`WaitGroup` should always be passed by pointer; `go vet` will warn on every value copy.

**Key points**
- Bug: value receiver copies the embedded `WaitGroup`/`Mutex` — sync state is duplicated
- Fix: pointer receiver; never copy a struct containing a sync primitive
- Catch it with `go vet` (copylocks) — it flags this statically


```go
type Pool struct {
	wg  sync.WaitGroup
	mu  sync.Mutex
	n   int
}

func (p Pool) Run(tasks []func()) {
	for _, t := range tasks {
		p.wg.Add(1)
		go func(t func()) {
			defer p.wg.Done()
			t()
		}(t)
	}
	p.wg.Wait()
}
```

**Follow-ups**
- What other standard-library types must never be copied after first use?

---

#### 26. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `concurrency`, `double-close`, `loop-variable`

**Two bugs.** (1) **Loop-variable capture:** the closure captures `s` (pre-1.22), so every goroutine sends to whichever `s` the loop variable points at last — not each subscriber. (2) **Double-close of `done`:** each goroutine calls `close(done)`; the second `close` panics with `close of closed channel`. And `<-done` only waits for *one* goroutine, not all of them.

**Failure mode:** Guaranteed `panic: close of closed channel` as soon as there are ≥2 subscribers, crashing the process. Even ignoring that, messages go to the wrong subscriber and `broadcast` returns before the sends complete. `close` of an already-closed (or nil) channel is a runtime panic, never recoverable cleanly here.

**Fix — pass the channel as an argument and use a `WaitGroup` instead of closing a shared channel repeatedly:**
```go
func broadcast(subs []chan int, v int) {
	var wg sync.WaitGroup
	for _, s := range subs {
		wg.Add(1)
		go func(s chan int) {
			defer wg.Done()
			s <- v
		}(s)
	}
	wg.Wait()
}
```
Now each goroutine targets its own subscriber, and `Wait` blocks for all of them. A channel must be closed exactly once, by a single owner — typically the sender, never N goroutines.

**Key points**
- Bugs: pre-1.22 loop-var capture + double `close(done)` panic + waiting on only one goroutine
- Fix: pass `s` as an arg; use a `WaitGroup`; close a channel exactly once from one owner
- Catch it with `-race`, `loopclosure` vet check; the double-close panics deterministically


```go
func broadcast(subs []chan int, v int) {
	done := make(chan struct{})
	for _, s := range subs {
		go func() {
			s <- v
			close(done)
		}()
	}
	<-done
}
```

**Follow-ups**
- Who should own closing a channel, and how do you coordinate close with multiple senders?

---

## HTTP & Server

#### 27. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `http`, `timeout`, `client`

**Bug: an `http.Client` with no timeout.** The zero-value `http.Client` has `Timeout: 0`, meaning *no timeout at all*. A slow or hung upstream will block the calling goroutine indefinitely.

**Failure mode:** When the upstream stalls (network partition, overloaded dependency, half-open connection), every request to it hangs forever. Goroutines pile up, the connection pool and your own server's worker capacity get exhausted, and a single slow dependency cascades into a full outage of *your* service. This is the canonical cause of "the whole service fell over when dependency X got slow."

**Fix — always set a timeout** (and ideally use per-request context deadlines):
```go
var client = &http.Client{
	Timeout: 5 * time.Second, // covers dial + TLS + request + response body read
}

func callUpstream(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return client.Do(req)
}
```
`Client.Timeout` is an overall cap; for finer control set `Transport` dial/TLS/response-header timeouts and pass a `context` deadline per call. Note `Timeout` includes reading the body, so streaming endpoints need context-based deadlines instead.

**Key points**
- Bug: default `http.Client` has no timeout → unbounded blocking on a hung upstream
- Fix: set `Client.Timeout` and/or use `NewRequestWithContext` with a deadline
- Catch it with chaos/latency testing, review checklist for every outbound client


```go
var client = &http.Client{}

func callUpstream(url string) (*http.Response, error) {
	return client.Get(url)
}
```

**Follow-ups**
- Why might `Client.Timeout` be wrong for a streaming/long-poll endpoint?

---

#### 28. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `http`, `server-timeout`, `graceful-shutdown`

**Bug: using `http.ListenAndServe` with the default server settings — no timeouts and no graceful shutdown.** The implicit `http.Server` has `ReadTimeout`, `WriteTimeout`, and `IdleTimeout` all zero (unbounded), and `log.Fatal` calls `os.Exit`, so there is no graceful shutdown.

**Failure mode:** (1) **Slowloris-style resource exhaustion:** a client that sends headers one byte at a time, or never finishes the request, ties up a connection forever; with no `ReadHeaderTimeout`/`ReadTimeout` an attacker exhausts your connection capacity cheaply. (2) **No graceful shutdown:** on deploy/SIGTERM the process exits immediately, killing in-flight requests and returning 502s to users mid-request.

**Fix — construct an `http.Server` with explicit timeouts and a shutdown path:**
```go
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", handle)
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	srv.Shutdown(ctx) // drain in-flight requests
}
```
At minimum set `ReadHeaderTimeout` (the cheapest defense against Slowloris) and wire `srv.Shutdown` to SIGTERM so deploys drain cleanly.

**Key points**
- Bug: default server has no read/write/idle timeouts (Slowloris risk) and no graceful shutdown
- Fix: explicit `http.Server` timeouts + `signal.Notify` + `srv.Shutdown(ctx)`
- Catch it with `gosec` (G112 ReadHeaderTimeout), security review, deploy/drain testing


```go
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", handle)
	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

**Follow-ups**
- Which single timeout is the cheapest, highest-value defense against Slowloris?

---

#### 29. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `http`, `request-body`, `retry`

**Bug: the request `body` (an `io.Reader`) is consumed on the first attempt and cannot be re-read on retries.** After the first `http.Post`, the reader is at EOF, so retries send an *empty* body.

**Failure mode:** The first attempt sends the real payload; if it fails with a 5xx, the retry POSTs nothing (or a partial body), so you write empty/garbage records or get spurious 400s. Worse, retrying a non-idempotent POST can duplicate side effects. There's also a leak: each failed `resp` body is never closed, so failed attempts leak connections.

**Fix — buffer the body so it can be replayed**, close bodies between attempts, and add backoff:
```go
func postWithRetry(ctx context.Context, url string, body []byte) (*http.Response, error) {
	var lastErr error
	for i := 0; i < 3; i++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close() // drain + close failed attempt
		}
		lastErr = err
		time.Sleep(time.Duration(i+1) * 100 * time.Millisecond) // backoff
	}
	return nil, lastErr
}
```
Take `[]byte` (or a `func() io.Reader`) so each attempt gets a fresh `bytes.NewReader`. Only retry idempotent operations or use an idempotency key.

**Key points**
- Bug: a one-shot `io.Reader` body is exhausted after the first try; retries send empty bodies; failed resp bodies leak
- Fix: buffer the body (`[]byte` → fresh `bytes.NewReader` per attempt), close each failed response, add backoff
- Catch it with integration tests that force a 5xx then assert the retry payload; `bodyclose` linter for the leak


```go
func postWithRetry(url string, body io.Reader) (*http.Response, error) {
	var resp *http.Response
	var err error
	for i := 0; i < 3; i++ {
		resp, err = http.Post(url, "application/json", body)
		if err == nil && resp.StatusCode < 500 {
			return resp, nil
		}
	}
	return resp, err
}
```

**Follow-ups**
- Why must you also guard against retrying non-idempotent POSTs even after fixing the body?

---

## Channels & Select

#### 30. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `channel`, `time-after`, `timer-leak`

**Bug: `time.After` allocates a brand-new timer on every loop iteration.** Each pass through the `select` evaluates *all* case expressions, so `time.After(time.Second)` creates a fresh `*time.Timer` every time around the loop — even when an event arrives and the timer case isn't selected.

**Failure mode:** Under a high event rate this loop spins thousands of times per second, each allocating a 1-second timer that is never fired or stopped early. Until the timer expires, the runtime keeps it on the timer heap; you accumulate up to ~(events/sec) live timers, burning CPU on timer management and heap pressure. It also subtly resets the flush interval on every event, so `flush` may rarely run. A well-known Go performance footgun.

**Fix — create one reusable `time.Timer` (or `Ticker`) outside the loop and reset it:**
```go
func consume(ctx context.Context, in <-chan Event) {
	t := time.NewTimer(time.Second)
	defer t.Stop()
	for {
		select {
		case e := <-in:
			handle(e)
		case <-t.C:
			flush()
			t.Reset(time.Second)
		case <-ctx.Done():
			return
		}
	}
}
```
If the flush should happen at a fixed cadence regardless of events, a `time.NewTicker` is even simpler. (Mind the `Reset` drain caveat on pre-1.23 timers if the channel may already hold a value.)

**Key points**
- Bug: `time.After` in a loop allocates a new timer each iteration → CPU/alloc churn, leaked pending timers
- Fix: hoist a single `time.NewTimer`/`NewTicker` out of the loop and `Reset` it
- Catch it with CPU/alloc profiling (pprof), benchmarks under load; `staticcheck` may flag time.After-in-loop


```go
func consume(ctx context.Context, in <-chan Event) {
	for {
		select {
		case e := <-in:
			handle(e)
		case <-time.After(time.Second):
			flush()
		case <-ctx.Done():
			return
		}
	}
}
```

**Follow-ups**
- When is `time.After` perfectly fine, and when must you switch to a reusable timer?

---

#### 31. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `channel`, `busy-loop`, `select-default`

**Bug: a busy-loop caused by the `default` case.** With a `default`, the `select` never blocks: when `in` is empty and `ctx` isn't done, it falls through to `default` and immediately loops again. The goroutine spins as fast as the CPU allows.

**Failure mode:** One such goroutine pegs a full CPU core at 100% doing nothing useful. Several of them starve the scheduler, spike cloud CPU bills, and can cause latency for real work. It still *functions* correctly, so it passes tests — you only notice via a flat-out CPU graph in production.

**Fix — remove the `default` so the `select` blocks until a case is ready:**
```go
func loop(ctx context.Context, in <-chan Task) {
	for {
		select {
		case t := <-in:
			process(t)
		case <-ctx.Done():
			return
		}
	}
}
```
A blocking `select` parks the goroutine until a task arrives or the context is cancelled — zero CPU while idle. Only use `default` when you genuinely want a non-blocking poll *and* you throttle the loop (e.g. with a timer); a bare `default` in a tight loop is almost always a bug.

**Key points**
- Bug: `default` makes `select` non-blocking → 100% CPU busy-loop when idle
- Fix: drop `default`; a blocking `select` parks the goroutine until a case is ready
- Catch it with CPU profiling/`top` (one core pinned), review of any `select`+`default` in a loop


```go
func loop(ctx context.Context, in <-chan Task) {
	for {
		select {
		case t := <-in:
			process(t)
		case <-ctx.Done():
			return
		default:
			// nothing to do right now
		}
	}
}
```

**Follow-ups**
- When is a non-blocking `select` with `default` actually the right tool?

---

## Defer Pitfalls

#### 32. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `defer`, `nil-deref`, `database`

**Bug: `defer rows.Close()` is placed *before* the error check, so it dereferences `rows` when the query failed.** When `QueryContext` returns an error, `rows` is `nil`. The deferred `rows.Close()` then runs on a nil `*sql.Rows` and panics with a nil-pointer dereference.

**Failure mode:** Any time the query errors (bad SQL, dead connection, context deadline), instead of returning the error cleanly the function panics. If the panic isn't recovered it crashes the request/goroutine; even with a recover middleware you've turned a normal error path into a 500 with a stack trace. The bug hides because the happy path works perfectly in tests.

**Fix — check `err` *before* deferring `Close`:**
```go
func count(ctx context.Context, db *sql.DB, q string) (int, error) {
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var n int
	for rows.Next() {
		n++
	}
	return n, rows.Err()
}
```
The ordering rule for any `X, err := open()` pattern: handle the error first, and only `defer X.Close()` once you know `X` is non-nil/valid. The same applies to `os.Open`, `net.Dial`, etc.

**Key points**
- Bug: `defer rows.Close()` before the err check → nil-pointer panic on query failure
- Fix: check `err` and return first; defer `Close()` only after `rows` is known valid
- Catch it with a test that forces a query error; `nilness`/staticcheck can flag nil deref


```go
func count(ctx context.Context, db *sql.DB, q string) (int, error) {
	rows, err := db.QueryContext(ctx, q)
	defer rows.Close()
	if err != nil {
		return 0, err
	}
	var n int
	for rows.Next() {
		n++
	}
	return n, rows.Err()
}
```

**Follow-ups**
- Which other `(X, err)` constructors have this same defer-ordering trap?

---

#### 33. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `defer`, `mutex`, `loop`

**Bug: `defer mu.Unlock()` inside a long-lived `for range` loop.** `defer` runs at function return, not at end of iteration. So `mu.Lock()` is called on *every* batch, but the matching `Unlock`s only run when `processStream` finally returns.

**Failure mode:** On the second iteration the same goroutine calls `mu.Lock()` again while still holding the lock from the first iteration (the first `Unlock` is deferred, not yet run). Since `sync.Mutex` isn't reentrant, the goroutine **deadlocks on itself at the second batch** — and it holds the lock forever, wedging every other goroutine that needs `mu`. Even if it somehow didn't self-deadlock, you'd hold the lock across the entire stream (no concurrency) and stack up N deferred unlocks until return.

**Fix — scope the lock to each iteration**, e.g. via an inline function or explicit unlock:
```go
func processStream(ch <-chan Batch) error {
	for batch := range ch {
		err := func() error {
			mu.Lock()
			defer mu.Unlock() // runs at end of THIS closure, i.e. per batch
			return write(batch)
		}()
		if err != nil {
			return err
		}
	}
	return nil
}
```
The closure gives each iteration its own deferred unlock that fires immediately, and still releases the lock correctly if `write` panics. Alternatively, lock/unlock explicitly without `defer` inside the loop body.

**Key points**
- Bug: deferred `Unlock` in a loop never runs until return → second `Lock` self-deadlocks (non-reentrant mutex)
- Fix: wrap the locked section in a per-iteration closure (or lock/unlock explicitly each iteration)
- Catch it with `-timeout` tests that send ≥2 batches; the loop hangs deterministically


```go
func processStream(ch <-chan Batch) error {
	for batch := range ch {
		mu.Lock()
		defer mu.Unlock()
		if err := write(batch); err != nil {
			return err
		}
	}
	return nil
}
```

**Follow-ups**
- Why does the closure form still correctly unlock if `write` panics?

---

#### 34. Review this code. What's wrong, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `defer`, `close-error`, `buffered-write`

**Two related bugs around `defer f.Close()` and buffered writes.** (1) **The `Close` error is ignored.** For a written file, `Close` can fail (delayed write-back, ENOSPC, NFS errors) and is exactly where a failed flush-to-disk surfaces; swallowing it means you report success on a corrupt/truncated file. (2) **`w.Flush()`'s error is also ignored**, so a mid-write failure (disk full) is lost. Order matters too: the buffered writer must be flushed *before* `Close`, and you want the flush error if it occurs.

**Failure mode:** A disk-full or I/O error during write produces a truncated report, but `writeReport` returns `nil`. Downstream systems trust the file; the data is silently corrupt. This bites in production under disk pressure and is invisible in tests with small inputs on a healthy disk.

**Fix — check `Flush` and surface `Close`'s error via a named return:**
```go
func writeReport(path string, rows []Row) (err error) {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := f.Close(); cerr != nil && err == nil {
			err = cerr // don't clobber an earlier error
		}
	}()
	w := bufio.NewWriter(f)
	for _, r := range rows {
		if _, err = fmt.Fprintln(w, r.String()); err != nil {
			return err
		}
	}
	if err = w.Flush(); err != nil {
		return err
	}
	return nil // deferred Close still runs and may set err
}
```
Flush before the deferred `Close`, and capture `Close`'s error into the named return without overwriting an earlier failure. For stronger durability, `f.Sync()` before close and write-temp-then-rename.

**Key points**
- Bug: ignored `Close` and `Flush` errors on a written file → silent truncation/corruption reported as success
- Fix: check `Flush`; capture `Close` error via named return (without clobbering an earlier err); flush before close
- Catch it with `errcheck` (flags ignored `Close`/`Flush`), disk-full fault injection tests


```go
func writeReport(path string, rows []Row) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	for _, r := range rows {
		fmt.Fprintln(w, r.String())
	}
	w.Flush()
	return nil
}
```

**Follow-ups**
- Why is checking the error of `Close` specifically important for files opened for writing but not for reading?

---
