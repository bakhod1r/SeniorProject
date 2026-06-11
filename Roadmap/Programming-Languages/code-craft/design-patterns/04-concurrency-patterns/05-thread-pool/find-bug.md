# Thread Pool — Find the Bug

> Buggy thread-pool snippets. Read the code, spot the defect, then check the diagnosis and fix. These are the bugs that actually take down production. Concepts: [junior.md](junior.md) → [professional.md](professional.md).

## Table of Contents

1. [Bug 1 — The unbounded-queue OOM](#bug-1--the-unbounded-queue-oom)
2. [Bug 2 — Swallowed task exceptions](#bug-2--swallowed-task-exceptions)
3. [Bug 3 — Pool created per call](#bug-3--pool-created-per-call)
4. [Bug 4 — Never shut down](#bug-4--never-shut-down)
5. [Bug 5 — Pool-induced deadlock](#bug-5--pool-induced-deadlock)
6. [Bug 6 — `maximumPoolSize` that never takes effect](#bug-6--maximumpoolsize-that-never-takes-effect)
7. [Bug 7 — `shutdownNow` assumed to wait](#bug-7--shutdownnow-assumed-to-wait)
8. [Bug 8 — `Future` results never read](#bug-8--future-results-never-read)
9. [Bug 9 — Shared mutable state across tasks](#bug-9--shared-mutable-state-across-tasks)
10. [Bug 10 — `newCachedThreadPool` under flood](#bug-10--newcachedthreadpool-under-flood)
11. [Bug 11 — Blocking inside a `ForkJoinPool` task](#bug-11--blocking-inside-a-forkjoinpool-task)
12. [Bug 12 — Go worker pool that deadlocks on close](#bug-12--go-worker-pool-that-deadlocks-on-close)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — The unbounded-queue OOM

```java
ExecutorService pool = Executors.newFixedThreadPool(8);
while (true) {
    Request r = intake.poll();        // arrives faster than tasks complete
    pool.submit(() -> handle(r));
}
```

**What's wrong:** `newFixedThreadPool` uses an **unbounded `LinkedBlockingQueue`**. Under sustained overload the queue grows without limit until `OutOfMemoryError`.

**Root cause:** No bound on pending work; the queue absorbs overload invisibly until the heap dies.

**Fix:**
```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    8, 8, 0, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),               // bounded
    new ThreadPoolExecutor.CallerRunsPolicy());   // backpressure when full
```

---

## Bug 2 — Swallowed task exceptions

```java
pool.execute(() -> {
    int[] a = loadData();
    process(a[index]);     // throws ArrayIndexOutOfBounds — silently
});
```

**What's wrong:** With `execute`, an exception goes to the thread's uncaught-exception handler (default: a stderr print easily lost) and the task fails invisibly. No alert, no retry, no trace in app logs.

**Root cause:** `execute` doesn't capture exceptions, and no uncaught-exception handler/try-catch is installed.

**Fix:** Wrap the body in try/catch and log, or use `submit` and inspect the `Future`, and install a `ThreadFactory` with an uncaught-exception handler:
```java
t.setUncaughtExceptionHandler((th, ex) -> log.error("uncaught in {}", th.getName(), ex));
```

---

## Bug 3 — Pool created per call

```java
public List<Result> processAll(List<Item> items) {
    ExecutorService pool = Executors.newFixedThreadPool(8);   // new pool every call!
    List<Future<Result>> fs = items.stream().map(i -> pool.submit(() -> work(i))).toList();
    // ... collect ...
    return results;   // pool never shut down either → leak
}
```

**What's wrong:** A fresh pool (8 threads) is created on **every** call and never shut down. This defeats reuse entirely *and* leaks threads — under load you spawn unbounded threads, the exact failure the pattern prevents.

**Root cause:** Pool lifecycle scoped to a method instead of the object/application.

**Fix:** Create one pool as a field, reuse it, shut it down in the lifecycle hook. If you truly need a per-call scope, use try-with-resources on Java 19+ (`ExecutorService` is `AutoCloseable`).

---

## Bug 4 — Never shut down

```java
public static void main(String[] args) {
    ExecutorService pool = Executors.newFixedThreadPool(4);
    pool.submit(() -> doWork());
    System.out.println("done");
    // main returns, but the JVM hangs
}
```

**What's wrong:** Pool worker threads are **non-daemon** by default, so the JVM won't exit after `main` returns. The program "hangs."

**Root cause:** Missing `shutdown()` + `awaitTermination()`.

**Fix:**
```java
pool.shutdown();
if (!pool.awaitTermination(30, TimeUnit.SECONDS)) pool.shutdownNow();
```

---

## Bug 5 — Pool-induced deadlock

```java
ExecutorService pool = Executors.newFixedThreadPool(2);
Future<Integer> outer = pool.submit(() -> {
    Future<Integer> inner = pool.submit(() -> compute());  // SAME pool
    return inner.get();                                    // blocks a worker
});
```

**What's wrong:** Submit two such outer tasks and both workers block on `inner.get()` while the inner tasks sit in the queue with no free worker to run them — **deadlock** at 100% busy, 0% progress.

**Root cause:** A pool task blocks on another task in the *same* bounded pool.

**Fix:** Use a separate pool for inner work, or compose non-blocking:
```java
CompletableFuture.supplyAsync(this::step1, pool).thenApplyAsync(this::step2, pool);
```

---

## Bug 6 — `maximumPoolSize` that never takes effect

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
    4, 50, 60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>());      // unbounded
```

**What's wrong:** The author expects the pool to scale to 50 threads under load. It never exceeds 4. The unbounded queue is never full, so the growth rule's "queue full → grow to max" step never fires.

**Root cause:** Unbounded queue + reliance on `maximumPoolSize`; the growth rule fills the queue *before* growing past core.

**Fix:** Use a bounded queue so the pool can actually reach max:
```java
new ArrayBlockingQueue<>(200)   // now it grows from 4 → 50 once the queue fills
```

---

## Bug 7 — `shutdownNow` assumed to wait

```java
pool.shutdownNow();
processResults();   // assumes all tasks finished — they have NOT
```

**What's wrong:** `shutdownNow()` *interrupts* running tasks and *returns* the queued-but-unstarted ones; it does **not** wait for in-flight tasks to finish. `processResults()` runs before tasks complete.

**Root cause:** Confusing "stop" with "wait for completion."

**Fix:**
```java
pool.shutdown();
if (!pool.awaitTermination(30, TimeUnit.SECONDS)) {
    List<Runnable> dropped = pool.shutdownNow();   // and still awaitTermination after
    pool.awaitTermination(10, TimeUnit.SECONDS);
}
processResults();
```

---

## Bug 8 — `Future` results never read

```java
for (Item i : items) pool.submit(() -> riskyWork(i));   // returns Future, discarded
// no get() anywhere
```

**What's wrong:** `submit` *captures* exceptions inside the `Future`. Since no one calls `get()`, every failure is **silently swallowed** — `riskyWork` can throw on every item and you'd never know.

**Root cause:** Using `submit` (which hides exceptions in the `Future`) without ever reading the `Future`.

**Fix:** Collect the `Future`s and `get()` them (handling `ExecutionException`), or log inside the task, or use `execute` with a proper uncaught-exception handler so failures surface.

---

## Bug 9 — Shared mutable state across tasks

```java
List<Result> results = new ArrayList<>();         // not thread-safe
for (Item i : items) pool.submit(() -> results.add(work(i)));  // concurrent add
```

**What's wrong:** Multiple workers call `ArrayList.add` concurrently. `ArrayList` is not thread-safe — you get lost updates, `ArrayIndexOutOfBoundsException`, or silent corruption. (Note: the submit/`get()` *boundary* is safe, but here tasks mutate shared state *while running concurrently*, bypassing any boundary.)

**Root cause:** Concurrent mutation of a non-thread-safe collection from multiple pool threads.

**Fix:** Return results via `Future`s and collect single-threaded, or use a concurrent collection:
```java
List<Future<Result>> fs = items.stream().map(i -> pool.submit(() -> work(i))).toList();
List<Result> results = new ArrayList<>();
for (Future<Result> f : fs) results.add(f.get());   // single-threaded collection
```

---

## Bug 10 — `newCachedThreadPool` under flood

```java
ExecutorService pool = Executors.newCachedThreadPool();
for (Request r : firehose) pool.submit(() -> handleSlow(r));   // tasks are slow
```

**What's wrong:** `newCachedThreadPool` has `core=0`, `max=Integer.MAX_VALUE`, and a `SynchronousQueue`. When tasks are slow and arrive fast, no idle thread is ever available, so it creates a **new thread per task** — unbounded threads → `OutOfMemoryError: unable to create new native thread`.

**Root cause:** Unbounded `maximumPoolSize` with a zero-capacity queue; the pool grows threads without limit.

**Fix:** Use a bounded `ThreadPoolExecutor` with a fixed max and a bounded queue. `newCachedThreadPool` is only safe for short, bursty, low-volume tasks.

---

## Bug 11 — Blocking inside a `ForkJoinPool` task

```java
list.parallelStream()                       // uses the common ForkJoinPool
    .map(url -> blockingHttpGet(url))       // blocking I/O in a FJ worker
    .collect(toList());
```

**What's wrong:** `parallelStream` runs on the shared `ForkJoinPool.commonPool()` (sized ≈ cores). Each blocking HTTP call parks a common-pool worker. With few workers, throughput collapses, and worse — you've degraded **every** parallel stream in the JVM, including unrelated code.

**Root cause:** Blocking work on the bounded, *shared* common pool; FJ assumes non-blocking CPU work.

**Fix:** Don't do blocking I/O on the common pool. Use a dedicated executor (`CompletableFuture.supplyAsync(..., ioPool)`), a custom `ForkJoinPool`, or — best for blocking I/O — virtual threads. Wrap unavoidable blocking in `ForkJoinPool.ManagedBlocker`.

---

## Bug 12 — Go worker pool that deadlocks on close

```go
jobs := make(chan int)
results := make(chan int)
for i := 0; i < 4; i++ {
    go func() { for j := range jobs { results <- j * j } }()
}
for i := 0; i < 100; i++ { jobs <- i }
close(jobs)
for r := range results { fmt.Println(r) }   // never terminates
```

**What's wrong:** Two bugs. (1) The `results` channel is never closed, so `for r := range results` blocks forever after the last value. (2) Even before that, workers can block sending to `results` (unbuffered, no concurrent reader during the submit loop) → potential deadlock.

**Root cause:** No `WaitGroup` to know when workers finish, and `results` is never closed.

**Fix:**
```go
var wg sync.WaitGroup
for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); for j := range jobs { results <- j * j } }()
}
go func() { for i := 0; i < 100; i++ { jobs <- i }; close(jobs) }()
go func() { wg.Wait(); close(results) }()   // close results when workers done
for r := range results { fmt.Println(r) }   // now terminates cleanly
```

---

## Practice Tips

- **Scan for the dangerous factories first.** `newFixedThreadPool`, `newSingleThreadExecutor` (unbounded queue) and `newCachedThreadPool` (unbounded threads) are the highest-yield red flags in any code review.
- **Trace every submitted exception.** For each `submit`/`execute`, ask "where does a thrown exception go?" If the answer is "nowhere," you've found a silent-failure bug.
- **Check the lifecycle.** Every pool needs an owner and a `shutdown()`. A pool with no `shutdown` is a leak; a `shutdownNow()` followed by "use the results" is a correctness bug.
- **Look for same-pool `get()`.** Any task that submits to its own pool and blocks is a latent deadlock — flag it even if it "works in tests."
- **Question every unbounded queue.** It silently converts a `maximumPoolSize` into a lie and an overload into an OOM. Demand a justified capacity.
- **Reproduce, then fix.** Write the failing case (OOM, deadlock, swallowed exception) before the fix so you can prove the fix works.
