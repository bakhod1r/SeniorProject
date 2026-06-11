# Balking — Interview Questions

> Graded Q&A for the **Balking** concurrency pattern. Work top-down — junior questions establish the vocabulary the senior/professional answers assume. See [junior.md](junior.md) for the foundations.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral--architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

**Q1. What is the Balking pattern in one sentence?**
If an object is not in an appropriate state to perform a requested action, it *balks* — returns immediately without doing the work, instead of blocking or queuing the request.

**Q2. How does Balking differ from Guarded Suspension?**
Same guard condition, opposite reaction. On a wrong state, **Balking gives up now** (returns); **Guarded Suspension waits** until the state becomes appropriate. Balk when the work is redundant/not needed; wait when the caller needs it and the state will soon be right.

**Q3. Give three canonical examples of balking.**
`save()` that does nothing when nothing changed (dirty flag); `start()`/`open()` that returns immediately if already started; one-shot `close()`/`shutdown()` where only the first caller runs cleanup. Go's `sync.Once` is balking in the standard library.

**Q4. Why is `if (!started) { started = true; ... }` dangerous in a multithreaded program?**
It's a check-then-act race: two threads can both read `started == false` before either writes `true`, so both run the body. The check and the act must be one atomic step.

## Middle Questions

**Q5. When should you NOT use balking?**
When the caller genuinely needs the work and the state will soon become valid (wait instead), or when the wrong state signals a programmer error (throw `IllegalStateException` — fail fast). Silently balking in those cases hides bugs or breaks functionality.

**Q6. How does balking relate to idempotency?**
Balking is the mechanism that makes lifecycle/persistence operations idempotent: the 2nd…Nth calls balk, so N calls have the same effect as one. This is why `close()` is safe to call defensively and why retry-safe message handlers balk on already-seen IDs.

**Q7. Is `volatile boolean` enough for a once-only `close()`? Why or why not?**
No. `volatile` guarantees visibility/ordering but **not** atomic check-then-act — two threads can both read `false`. You need an atomic read-modify-write: `AtomicBoolean.compareAndSet(false, true)` (or `sync.Once`).

**Q8. What's the danger of a silent balk, and how do you mitigate it?**
A balk that was supposed to be impossible can occur due to an upstream bug, and because it's silent, the missing work goes unnoticed. Mitigate by returning a `boolean` (did/balked) and logging/metering balks that violate an invariant (e.g. a double payment-capture).

## Senior Questions

**Q9. Model balking as a state machine. What is a balk?**
A balk is a **rejected event** — an event arriving in a state with no legal transition, so it self-loops with no side effect. Drawing the full (state, event) table forces you to decide do/balk/wait/throw per cell, which catches bugs like balking `stop()` during `Starting` (which wedges the machine — you wanted to *wait*).

**Q10. Where does the "flag" live when balking at architectural scale?**
Wherever the authoritative state is and where the check-and-act can be made atomic *at that scope*: an `AtomicBoolean` in one JVM, a unique-constraint row (`INSERT ... ON CONFLICT DO NOTHING`) for an idempotent endpoint across a DB, or a distributed lease for cluster-wide leader-only work. The pattern is identical; only the storage and atomicity mechanism change.

## Professional Questions

**Q11. What CPU instruction implements `compareAndSet`, and what memory ordering does it give?**
On x86-64, `LOCK CMPXCHG` — an atomic read-compare-write that's also a full barrier. In JMM terms, a successful `compareAndSet` publishes with release semantics; a later acquiring read of the flag sees everything the winner did before publishing. So it provides both atomicity *and* a happens-before edge.

**Q12. Does ABA affect a once-only boolean balk?**
No. A latch flag only goes `false→true` and never back, so there's no A→B→A sequence for a stale CAS to mistakenly succeed on. ABA only matters for *reusable/poolable* flags that can be reset, where you'd use a stamped/versioned reference.

**Q13. Why does CAS-based balking scale better than `synchronized` under contention?**
CAS losers just re-read the flag (no parking); `synchronized` losers park on the monitor, incurring context-switch syscalls (~µs each). For a hot, single-flag lifecycle method hammered by many threads, the CAS version avoids scheduler involvement entirely.

## Coding Tasks

**T1.** Implement a thread-safe `boolean start()` that balks if already running, using `synchronized`. Then rewrite it lock-free with `AtomicBoolean.compareAndSet`. Prove with an `AtomicInteger` that across 1000 concurrent calls the body runs exactly once.

**T2.** Implement `DebouncedFlusher.flush()` that runs at most once per 100 ms (balks otherwise) and is thread-safe.

**T3.** Implement Go single-flight: concurrent `get(key)` calls trigger one `loader` invocation; the rest balk on loading but await and return the same result.

## Trick Questions

**Q14. Two threads call the `compareAndSet` version of `close()` at the same instant. How many run cleanup?**
Exactly one — the thread whose `compareAndSet(false, true)` returns `true`. The other gets `false` and balks.

**Q15. `start()` returns `false`. Is that an error?**
No. `false` means "already running — I balked." It is the normal idempotent outcome, not a failure; don't log it as an error or retry it.

**Q16. A caller balks on `start()` then immediately uses the started resource. Safe?**
Not necessarily. Balking guarantees *someone owns* startup, not that startup is *finished*. If the caller needs completion, pair the balk with a latch/future the loser awaits.

**Q17. Can a balking `save()` lose data?**
Not from balking (it only balks when `changed == false`). Data loss comes from resetting the dirty flag *before* a write that then throws — reset only after a successful write, or restore the flag on failure.

## Behavioral / Architectural Questions

**Q18. Describe a time you chose balking over waiting (or vice versa) and why.**
Strong answer: name the wrong-state condition, state whether "later" was meaningful, and justify the reaction. e.g. "Shutdown cleanup must run exactly once, and a second shutdown request has nothing to do, so I balked via `AtomicBoolean`; but the health endpoint that needed to report *completed* shutdown used a latch to wait."

**Q19. How would you make an at-least-once message consumer effectively-once?**
Balk on already-processed message IDs using a dedupe store whose check-and-act is atomic (a unique constraint or `SETNX`). The first delivery processes; redeliveries balk. Discuss the dedupe-store TTL and the idempotency of the side effect itself.

## Tips for Answering

- Lead with the one-line intent: *wrong state → give up now, no block, no queue.*
- Always contrast with Guarded Suspension — interviewers probe the balk-vs-wait boundary.
- When you say "check a flag," immediately add "made atomic with `synchronized`/`compareAndSet`" — naming the race unprompted signals seniority.
- Distinguish *visibility* (`volatile`) from *atomicity* (`compareAndSet`); conflating them is the most common wrong answer.
- Raise observability unasked: silent no-ops hide bugs, so balks that shouldn't happen get logged/metered.
