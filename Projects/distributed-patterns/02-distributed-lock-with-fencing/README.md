# Distributed Lock with Fencing Tokens

> Build a distributed lock that is actually *correct*. Discover the hard way that
> a lock alone cannot guarantee mutual exclusion across an unreliable network —
> a GC pause longer than the TTL is enough to put two holders on the same
> resource — and that the only real fix lives at the **resource**, not in the
> lock: a monotonic **fencing token** the resource refuses to go backwards on.

| | |
|---|---|
| **Tier** | Distributed-patterns (coordination) |
| **Primary domain** | Mutual exclusion across nodes |
| **Skills exercised** | Redis `SET NX PX` + Lua, etcd/ZooKeeper leases & sequence nodes, lock TTL vs work duration, fencing tokens, Redlock & its safety critique, liveness vs safety, reentrancy, safe release, fairness/queueing, Go (`go-redis`, `etcd/clientv3`) |
| **Interview sections** | 13 (distributed systems), 7 (caching & Redis), 2 (concurrency) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own a worker fleet that runs periodic jobs against shared resources — a
billing run per account, a cron that compacts one tenant's storage, an exporter
that writes one customer's report file to object storage. Each resource must be
touched by **exactly one worker at a time**, or you double-charge, corrupt a
file, or interleave two writers. The fleet is 200 workers across 12 hosts, and
job assignment is dynamic, so you can't statically partition the work — you need
runtime mutual exclusion.

The obvious answer — "grab a lock in Redis" — is the answer that fails in
production at 03:00, quietly, when one worker's process freezes on a 6-second GC
pause or its host gets paused by the hypervisor. The lock expires, a second
worker grabs it and starts writing, then the *first* worker wakes up still
believing it holds the lock and writes too. Two writers, one resource. No error
was logged anywhere.

Your job is to build a distributed lock, push it to the point where it breaks,
and then make the *resource* safe regardless of what the lock does. You will
finish this lab able to state — and prove with a reproduction — exactly why
Martin Kleppmann's critique of Redlock is correct, and exactly what a fencing
token buys you that no lock can. You will produce numbers and a corruption
reproduction, not opinions.

## 2. Goals / Non-goals

**Goals**
- Implement a correct single-instance Redis lock: `SET NX PX`, owner-scoped safe
  release via Lua compare-and-delete, and a re-acquire/renew path.
- Implement a lease + sequence lock on **etcd** (or ZooKeeper) using a lease TTL
  and the ordered-key / ephemeral-sequence-node queueing pattern.
- Make the **protected resource** enforce a **fencing token**: a monotonically
  increasing number issued at lock acquisition and checked at every write, so a
  stale holder's writes are rejected.
- **Prove the safety failure**: induce a process pause longer than the lock TTL
  and show that *without* fencing two holders corrupt the resource, and *with*
  fencing the stale write is rejected.
- Measure acquisition latency, throughput, and fairness under high contention on
  a single hot lock key.

**Non-goals**
- Building a consensus engine. Use etcd/ZooKeeper as given; don't reimplement
  Raft (that's `staff/03-raft-metadata-kv-store`).
- Leader election as such — one long-lived leader — lives in
  [`distributed-patterns/01-leader-election`](../01-leader-election/). This lab
  is short-lived mutual exclusion over *many* resources. They share fencing as a
  mechanism; keep the framing distinct.
- A general work scheduler / queue. The lock guards a resource; it does not
  assign work.

## 3. Functional requirements

1. A **lock library** (`pkg/dlock`) exposing `Acquire(ctx, key) (Handle, error)`,
   `handle.Release(ctx)`, and `handle.Fence() uint64`. `Handle` carries the lock
   key, an owner token (random UUID), and the **fencing token**.
2. **Two backends**, switchable by flag:
   - `redis` — `SET key <owner> NX PX <ttl>`; release is a Lua script that
     deletes **only if** the stored value equals this owner (compare-and-delete);
     renew is a Lua script that `PEXPIRE`s only if still owned.
   - `etcd` — a lease (`Grant` TTL), a key put under that lease, and the
     ordered-revision queueing pattern so waiters acquire in arrival order.
3. **Fencing token issuance.** Each successful acquire returns a fencing token
   that is **monotonically increasing** for that key across all acquirers. For
   etcd, derive it from the key's `ModRevision` (globally monotonic). For Redis,
   maintain it with an `INCR fence:{key}` in the same critical path (and confront
   that this counter is itself a single point you must reason about).
4. A **protected resource** (`cmd/resource`) — a tiny service holding one value
   per key plus the highest fencing token it has accepted. Every write carries a
   token; the resource **rejects any write whose token is ≤ the highest already
   seen** (`409 stale fencing token`). This is the component that actually
   enforces mutual exclusion.
5. A **worker** (`cmd/worker`) that acquires the lock for a key, does work
   (writes to the resource with its fencing token), then releases. Configurable
   work duration, TTL, and an injectable **pause** (simulated GC/STW) between
   acquire and write.
6. A **load harness** (`cmd/contend`) that spins N workers all contending for the
   same key (or a configurable key space) and records acquisition latency,
   throughput, and acquisition order.

## 4. Load & data profile

- **Key space:** test two regimes — a **single hot key** (extreme contention)
  and **≥ 10M distinct keys** (one lock per account/resource), so you exercise
  both contention and the lock store's memory/expiry behavior.
- **Contention:** on the hot key, run **50, 200, 1000** concurrent workers.
- **Work duration:** parametric — 50 ms, 500 ms, 5 s — so you can set TTL above
  and below it deliberately.
- **TTL:** test TTL both **comfortably above** and **deliberately below** work
  duration; the sub-work TTL run is the one that exposes the safety hole.
- **Pause injection:** a worker can be told to sleep `Dt` ms *while holding the
  lock, before writing* — your stand-in for a GC pause / STW / host freeze. The
  mandatory experiment sets `Dt > TTL`.
- **Generator:** `cmd/gen` populates 10M keys deterministically from a seed so
  expiry/memory runs are reproducible.
- **Traffic model:** open model — workers attempt acquisition at a fixed offered
  rate, so you can watch the wait queue build rather than masking it behind a
  closed loop.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Lock acquisition p99 (uncontended, Redis, same AZ) | < 3 ms; report it |
| Lock acquisition p99 (hot key, 200 contenders) | Find & report the ceiling; explain what bounds it (Redis single-thread? round-trips? fairness policy?) |
| **Safety violations (two concurrent accepted writers on one key)** | **0** — this is the invariant the whole lab exists to protect |
| Stale write after pause > TTL | Detected and **rejected** by the resource (fencing), never silently applied |
| Throughput on the hot key (locked critical sections/s) | Measured; bounded by `1 / (work + acquire + release)` — report and explain the ceiling |
| Fairness (acquisition order vs arrival order) | Report it: Redis spin-retry is unfair; etcd sequence nodes are FIFO. Quantify tail-wait |
| Safe release | A worker **never** deletes a lock it no longer owns (prove via the compare-and-delete Lua and a targeted test) |

> The point is not a magic latency number. It is to **prove safety = 0
> violations** under a pause longer than the TTL, and to **explain** the
> throughput ceiling of a hot lock.

## 6. Architecture constraints & guidance

- **Stand up the real thing:** Redis 7 single instance and a 3-node etcd cluster
  via `docker-compose`. Pin versions. (ZooKeeper 3.8 is an acceptable substitute
  for the lease/sequence backend.)
- **Redis client:** `redis/go-redis/v9`. Release and renew **must** be Lua
  scripts (`EVAL` / cached `EVALSHA`) — never `GET` then `DEL`, which has a
  classic TOCTOU window where the lock expires and is re-taken between your read
  and your delete, and you then delete *someone else's* lock.
- **etcd client:** `go.etcd.io/etcd/client/v3` and its `concurrency` package
  (`Mutex`) — but also implement the lease+revision queue yourself once so you
  understand the FIFO mechanic and where the fencing token comes from
  (`ModRevision`).
- **Keep the resource separate** from the lock backend and the worker. The whole
  argument of the lab is that mutual-exclusion correctness lives at the resource,
  so it must be its own process that can reject a token independently of any lock.
- **Instrument everything** with Prometheus: acquire attempts/successes/timeouts,
  acquire latency histogram, time-held, renew count, release-by-non-owner
  attempts (should be 0 applied), and — the headline metric —
  `resource_stale_token_rejections_total`.

## 7. Data model

```
Handle:      { key string, owner uuid, fence uint64, ttl, acquiredAt }

Redis state: key            -> owner-uuid      (SET NX PX ttl)
             fence:{key}     -> monotonic int   (INCR on acquire)

etcd state:  /locks/{key}/{lease-id} -> owner   (put under lease)
             fence = ModRevision of the winning key   (globally monotonic)

Resource:    value(key)       -> bytes
             max_fence(key)    -> uint64   -- highest token ever accepted
             write(key, token, bytes):
                 if token <= max_fence(key): reject 409 "stale fencing token"
                 else: max_fence(key) = token; value(key) = bytes; ok
```

The resource's `write` is the entire safety argument in five lines: it accepts a
write **only** if the token strictly exceeds every token it has accepted before.
A stale holder, by construction, carries a smaller token than the holder that
displaced it, so its write is rejected — even though it sincerely believes it
still holds the lock.

## 8. Interface contract

- **Lock library**
  - `Acquire(ctx, key) (Handle, error)` — blocks until acquired or `ctx` deadline;
    returns a `Handle` with a fencing token.
  - `handle.Release(ctx) error` — compare-and-delete; releasing a lock you no
    longer own is a no-op that increments `release_by_non_owner_total`.
  - `handle.Fence() uint64` — the token to attach to every protected write.
  - `handle.Renew(ctx) error` — extend TTL only if still owned.
- **Resource service**
  - `PUT /r/{key}` with header `X-Fence-Token: <n>` and body → `200` applied,
    or `409 {"error":"stale fencing token","seen":N,"got":M}`.
  - `GET /r/{key}` → current value + `max_fence`.
- **Flags / env:** `-backend redis|etcd`, `-ttl`, `-work`, `-pause`,
  `-contenders`, `-keys`, `-fence on|off` (off = run the unsafe baseline to
  reproduce corruption).
- `GET /metrics` → Prometheus exposition on every binary.

## 9. Key technical challenges

- **TTL vs work duration is a guess you will lose.** Any TTL is a bet that no
  holder will pause longer than it. That bet loses to a GC pause, a paged-out
  page, a `SIGSTOP`, a slow disk, a VM migration. You cannot set a TTL that is
  simultaneously short enough for good liveness and long enough to never expire
  under a real holder. This is the crux: the lock's expiry creates the exact
  window where two holders coexist.
- **Liveness vs safety are in direct tension.** A short TTL gives good liveness
  (a dead holder's lock frees fast) but worse safety (a slow live holder gets
  pre-empted). A long TTL is the reverse. Fencing **breaks** the tension: it lets
  you choose TTL purely for liveness, because safety no longer depends on it.
- **Redlock doesn't add safety.** Redlock acquires a majority of N independent
  Redis nodes to survive a node failure — an *availability* improvement. It does
  **not** address the pause-longer-than-TTL problem, and it leans on bounded
  clock drift and bounded message delay, which are not safe assumptions in an
  asynchronous network. You will reproduce Kleppmann's argument: with no fencing,
  Redlock under a partition or a GC pause still admits two holders. Engage this
  directly — don't hand-wave it.
- **Safe release is a TOCTOU trap.** `GET`-then-`DEL` lets your lock expire and
  be re-acquired between the two commands, so you delete the *new* owner's lock.
  Only an atomic compare-and-delete (Lua) is correct. Demonstrate the bug, then
  the fix.
- **The hot lock is both a bottleneck and a hazard.** Every contender funnels
  through one key. Throughput is capped at `1 / (work + acquire + release)` per
  key — the lock *serializes* by design — and the acquire round-trips pile onto
  one Redis shard or one etcd Raft group. Adding workers past the ceiling only
  adds wait latency and retry load, not throughput.
- **Fairness is not free.** Redis spin-retry (`SET NX`, sleep, retry) is
  unordered: a late arrival can barge ahead of a long waiter, and tail wait is
  unbounded. etcd/ZK ordered sequence nodes give FIFO at the cost of a watch per
  waiter. Measure both.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and a reproduction for each:

1. **The mandatory safety test — pause longer than the TTL.** TTL = 2 s, work
   that injects a `-pause 5s` between acquire and write. Run two workers on one
   key. **With `-fence off`:** worker A acquires, pauses; its lock expires;
   worker B acquires and writes; worker A wakes and writes — show **two accepted
   writers**, the resource value corrupted/interleaved. **With `-fence on`:**
   show worker A's write **rejected** with `409 stale fencing token` (token
   `N` ≤ `seen N+1`), resource uncorrupted, `resource_stale_token_rejections_total`
   incremented. This single experiment is the lab.
2. **Redlock under partition.** Stand up 5 Redis nodes; implement Redlock
   majority acquisition. Partition the cluster (or pause one node) and combine
   with experiment 1's pause. Show that majority acquisition **still** does not
   prevent the two-holder window — and that fencing at the resource is what saves
   you. Write up why this matches Kleppmann's critique.
3. **Safe-release TOCTOU.** Implement release as `GET`+`DEL` (buggy) and force
   the race: hold under a short TTL so the lock expires, let a second worker
   acquire, then have the first worker release — show it deletes the **second**
   worker's lock. Switch to the Lua compare-and-delete and show the race closes.
4. **Acquisition latency vs contention.** Single hot key, contenders =
   50 → 200 → 1000, Redis vs etcd. Plot acquire p50/p99/p999. Find where adding
   contenders stops buying throughput and only adds wait.
5. **Fairness.** On the hot key, log arrival order vs acquisition order. Quantify
   reordering and tail wait for Redis spin-retry vs etcd sequence-node FIFO.
6. **TTL sweep & liveness.** Kill a lock holder hard (`SIGKILL`) at TTL = 500 ms,
   2 s, 10 s. Measure how long the resource stays blocked (liveness cost) and
   confirm fencing lets you pick the short TTL without a safety penalty.
7. **Big-key-space expiry.** Load 10M keys, each a short-lived lock; measure
   Redis memory, expiry behavior (lazy vs active expiration), and whether
   expired-but-not-reclaimed keys distort `used_memory`. For etcd, measure lease
   count limits and revision/compaction growth.
8. **Renew vs re-acquire.** Add a renew loop (extend TTL while working). Measure
   how it changes the safety window and whether it merely *narrows* (never
   closes) the pause-longer-than-TTL hole.

## 11. Milestones

1. Compose up Redis + etcd; `pkg/dlock` Redis backend with `SET NX PX` and Lua
   compare-and-delete release; uncontended acquire/release working; Prometheus.
2. Resource service with fencing-token enforcement; worker attaches `Fence()` to
   every write; `-fence on|off` switch.
3. **The safety reproduction (experiment 1)** — corruption with fencing off,
   rejection with fencing on. This is the centerpiece artifact.
4. etcd lease+sequence backend; `ModRevision` fencing token; fairness measurement
   (experiment 5).
5. Redlock implementation + partition test (experiment 2); TOCTOU release demo
   (experiment 3); findings note engaging the Kleppmann critique.
6. Scale runs: contention curves (4), TTL/liveness (6), 10M-key expiry (7).

## 12. Acceptance criteria (definition of done)

- [ ] **Zero safety violations** with fencing on: under a pause > TTL, the stale
      write is rejected; show the `409`, the metric, and the uncorrupted resource.
- [ ] The **same scenario with fencing off reproduces corruption** — two accepted
      writers on one key — proving the lock alone is insufficient (this is the
      load-bearing demonstration).
- [ ] Safe release proven: a worker never deletes a lock it no longer owns;
      `GET`+`DEL` race demonstrated, Lua fix closes it.
- [ ] Acquisition latency vs contention plotted (Redis and etcd); the hot-key
      throughput ceiling reported **with the bound named** (serialization +
      round-trips).
- [ ] Fairness quantified: arrival-vs-acquisition reordering for Redis vs etcd.
- [ ] Redlock-under-partition write-up: why majority acquisition does **not**
      replace fencing, grounded in Kleppmann's argument.
- [ ] 10M-key run: lock-store memory and expiry behavior reported.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- **Reentrant lock:** same owner re-acquires with a hold count; release decrements
  and only frees at zero. Show where reentrancy interacts with TTL renewal.
- **Lock with a wait queue + cancellation:** bounded queue, fair FIFO, `ctx`
  cancellation removes a waiter cleanly (etcd watch-based).
- **Fence the writes to a real resource:** point the protected resource at a
  Postgres row with a `WHERE fence > stored_fence` conditional update, or an S3
  object with a conditional `PutObject` (`If-Match`/precondition) keyed on the
  token — fencing where it actually bites in production.
- **Sharded fence counters:** if `fence:{key}` `INCR` becomes hot, explore
  per-key fencing from etcd revisions instead of a Redis counter; compare.
- **Clock-drift sensitivity:** vary container clock skew and show Redlock's
  dependence on bounded drift; fencing's independence from it.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Lock correctness | Working `SET NX PX` lock with Lua safe release | Explains the TOCTOU window and *why* compare-and-delete is the only correct release |
| **The core insight** | Knows a lock needs a TTL and a safe release | **Knows a lock is not enough**: enforces fencing tokens at the resource and proves a pause > TTL is otherwise unsafe |
| Liveness vs safety | States the trade-off | Shows fencing *decouples* TTL from safety, so TTL is chosen purely for liveness |
| Redlock | Knows Redlock acquires a majority | Reproduces Kleppmann's critique: majority adds availability, not safety; doesn't survive pause/partition without fencing |
| Contention & throughput | Reports acquire p99 | Names the hot-key ceiling (serialization + round-trips); knows adding workers past it only adds wait |
| Fairness | Notices Redis retry is unfair | Quantifies reordering; chooses FIFO sequence nodes with evidence when fairness matters |
| Communication | Clear findings note | Could defend the corruption reproduction and the fencing argument to a staff panel |

> Staff bar in one line: **the lock is a hint, not a guarantee — the resource is
> what enforces mutual exclusion, via a fencing token it refuses to run
> backwards on.** A candidate who reaches only "Redis `SET NX` with a Lua
> release" is at the senior bar; the staff bar is the fencing proof.

## 15. References

- Martin Kleppmann — **"How to do distributed locking"** (the canonical fencing-
  token argument and the Redlock safety critique). Read it before experiment 2.
- Antirez — "Is Redlock safe?" (the rebuttal) and the Redis "Distributed Locks
  with Redis" docs. Read both sides and form your own position.
- *Designing Data-Intensive Applications* — Ch. 8 (unreliable clocks, process
  pauses, fencing tokens) and Ch. 9 (linearizability, leases).
- etcd `concurrency` package (`Mutex`, `Election`) and lease docs; ZooKeeper
  "Lock" recipe (ephemeral sequential nodes).
- See also: `Interview Question/13-distributed-systems/` (locks, leases, fencing,
  clocks, liveness vs safety) and `Interview Question/07-caching-and-redis/`
  (`SET NX PX`, Lua atomicity, expiry).
- Cross-reference: [`distributed-patterns/01-leader-election`](../01-leader-election/)
  — leader election is the long-lived sibling of this lab and uses the **same**
  fencing mechanism (the elected leader's writes carry a fencing/epoch token);
  contrast its single-leader framing with this lab's many-resources framing.
