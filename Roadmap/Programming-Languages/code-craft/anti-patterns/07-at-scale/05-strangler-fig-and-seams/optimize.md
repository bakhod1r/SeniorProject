# Strangler Fig & Seams — Optimize This

> **Category:** [Anti-Patterns at Scale](../README.md) → **Strangler Fig & Seams**
> **Covers (collectively):** Strangler Fig pattern · Seams · Branch by Abstraction · Characterization tests · Parallel-run / shadow & verification

---

This file is **cleanup practice**. Unlike [`find-bug.md`](find-bug.md) — where the migration is *unsafe* (a leaky abstraction, a shadow that charges twice) — here the migration is **correct but wasteful**: it verifies the new path properly, but it does so on the request's critical path, so it doubles latency and cost on every request. Your job is to keep the verification's *correctness* while removing its *cost from the hot path*.

> **How to use this file:** read the "Before," reason about *where the latency goes* and *what's actually load-bearing*, then write the "After" before expanding. The discipline is the same one that separates a good shadow from a bad one — **the verification must not be on the path the user waits on.**

---

## Table of Contents

1. [The synchronous parallel run](#the-synchronous-parallel-run)
2. [Why it doubles p99](#why-it-doubles-p99)
3. [The fix — async, sampled, off-path](#the-fix--async-sampled-off-path)
4. [Latency reasoning, before and after](#latency-reasoning-before-and-after)
5. [Correctness reasoning — what we keep](#correctness-reasoning--what-we-keep)
6. [Further refinements](#further-refinements)
7. [Summary](#summary)
8. [Related Topics](#related-topics)

---

## The synchronous parallel run

A team is strangling the pricing engine. They've done everything right *structurally*: old and new live behind a `Pricer` interface (branch by abstraction), and they want to verify the new path against the old on real traffic before cutting over. So they run both on every request and compare:

```go
// Before — a correct but expensive parallel run, ON the request's critical path.
type VerifyingPricer struct {
	old, new Pricer
	sink     MismatchSink
}

func (v *VerifyingPricer) Price(ctx context.Context, cart Cart) (Money, error) {
	// 1. Run the OLD path (the source of truth).
	oldVal, oldErr := v.old.Price(ctx, cart)
	if oldErr != nil {
		return 0, oldErr
	}

	// 2. Run the NEW path, inline, RIGHT HERE in the request.
	newVal, newErr := v.new.Price(ctx, cart)

	// 3. Compare, and report any divergence — also inline.
	if newErr != nil || newVal != oldVal {
		v.sink.Report(Mismatch{Cart: cart, Old: oldVal, New: newVal, NewErr: newErr})
	}

	// 4. Only now, after BOTH ran and compared, respond.
	return oldVal, nil
}
```

This is *correct*: the served value is always the old one, every request is compared, and mismatches are reported. It's also a performance and reliability problem in production.

> What's expensive here, and how would you keep the verification while removing its cost from the path the user waits on?

---

## Why it doubles p99

Trace what the caller waits on. Every request now pays for **both** engines plus the comparison, sequentially:

```text
request latency = old.Price()  +  new.Price()  +  compare()  +  report()
                  └─ served ─┘    └──── pure overhead, on the hot path ────┘
```

Concretely:

- **Latency roughly doubles** (worse at the tail). If `old` and `new` each take ~`T`, every response now takes ~`2T` *before* the user gets the answer they'd have gotten in `T`. The new path is often *slower* than the old during a migration (it's unoptimized, hits a cold cache, makes an extra DB call), so it frequently dominates — and the **p99 is where the new path's worst cases land on top of the old path's worst cases**, so the tail can be far worse than 2×.
- **Cost doubles.** Every request executes the new engine in addition to the old — double the CPU, double any downstream calls the new path makes, on 100% of traffic, forever during the bake.
- **Reliability is coupled.** If `new.Price` is slow or hangs, the *user's* request is slow or hangs, even though the new path's result is *thrown away*. A bug in code that isn't even serving traffic now degrades production. (If `v.new` panicked, it would take the request down too.)
- **It scales with traffic you didn't budget for.** You sized capacity for one engine; you're now running two on every request.

The verification is *valuable*, but none of it needs to happen **before the response**. The user is waiting on work whose only purpose is to compare two numbers for the team's benefit.

---

## The fix — async, sampled, off-path

Return the old result immediately; run and compare the new path *after* responding, on a sampled fraction, isolated so it can't affect the request.

```go
// After — same verification, moved off the critical path.
type VerifyingPricer struct {
	old, new Pricer
	sink     MismatchSink
	sampler  Sampler        // e.g. true ~1–5% of calls
	shadows  chan shadowJob  // bounded queue; drops under load (fail-open)
}

type shadowJob struct {
	cart   Cart
	oldVal Money
}

func NewVerifyingPricer(old, new Pricer, sink MismatchSink, s Sampler) *VerifyingPricer {
	v := &VerifyingPricer{
		old: old, new: new, sink: sink, sampler: s,
		shadows: make(chan shadowJob, 1024),
	}
	// A small pool of workers drains the queue OFF the request path.
	for i := 0; i < 4; i++ {
		go v.worker()
	}
	return v
}

func (v *VerifyingPricer) Price(ctx context.Context, cart Cart) (Money, error) {
	// 1. Serve the old path and return IMMEDIATELY. No added latency.
	oldVal, oldErr := v.old.Price(ctx, cart)
	if oldErr != nil {
		return 0, oldErr
	}

	// 2. Enqueue a sampled shadow job; never block the request on it.
	if v.sampler.ShouldSample() {
		select {
		case v.shadows <- shadowJob{cart: cart, oldVal: oldVal}:
		default:
			// Queue full → drop the sample. Verification is best-effort;
			// the served request must never wait or fail because of it.
		}
	}

	return oldVal, nil
}

func (v *VerifyingPricer) worker() {
	for job := range v.shadows {
		v.runShadow(job)
	}
}

func (v *VerifyingPricer) runShadow(job shadowJob) {
	// 3. Isolate: a panic or error in the new path stays here, fails open.
	defer func() {
		if r := recover(); r != nil {
			v.sink.Report(Mismatch{Cart: job.cart, Old: job.oldVal,
				NewErr: fmt.Errorf("shadow panic: %v", r)})
		}
	}()

	// 4. Bound the new path so a hang can't pile up workers.
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	newVal, newErr := v.new.Price(ctx, job.cart)
	if newErr != nil || newVal != job.oldVal {
		v.sink.Report(Mismatch{Cart: job.cart, Old: job.oldVal, New: newVal, NewErr: newErr})
	}
}
```

Four changes, each removing one cost:

1. **Respond before the new path runs** — the request's latency is the old path's latency, full stop.
2. **Sample** — only ~1–5% of requests pay the shadow's CPU/downstream cost, not 100%.
3. **Run on background workers via a bounded queue** — the shadow executes off the request goroutine, and the queue *drops* under load so a traffic spike can't back-pressure into requests (fail-open).
4. **Isolate and time-bound** — `recover` keeps a shadow panic out of the request; a timeout stops a hung new path from exhausting the worker pool.

---

## Latency reasoning, before and after

| | Before (sync) | After (async, sampled) |
|---|---|---|
| **Served-request latency** | `old + new + compare` (~2T, tail worse) | `old` (~T) — unchanged from no-verification |
| **Who waits on `new.Price`** | every user, every request | nobody — it runs after the response |
| **Fraction of traffic running `new`** | 100% | sample rate (e.g. 1–5%) |
| **Extra CPU / downstream cost** | 1× the new engine on every request | sample-rate × the new engine |
| **A slow/hung new path** | slows/hangs the user's request | bounded by a timeout, on a worker; request unaffected |
| **A panic in the new path** | can crash the request | recovered in the worker; reported as a mismatch |

The headline: **p99 of served requests returns to the old path's p99**, because the only thing on the critical path is the old path. The new path's latency — including its bad tail — is moved entirely off the request and throttled by sampling.

---

## Correctness reasoning — what we keep

Moving the work off the hot path must not weaken the *verification*. It doesn't, and here's why each property survives:

- **The served value is identical.** Both versions return `oldVal` — the old path remains the single source of truth. We changed *when* the new path runs, never *which* result we serve. Users see exactly what they saw before any verification existed.
- **We still compare new against old.** The async worker runs `new.Price` and diffs it against the captured `oldVal`. A real divergence is still detected and reported with full context.
- **Statistical confidence is preserved.** You don't need 100% of traffic to gain confidence that new == old — a representative *sample* over a bake window surfaces divergences just as well, because mismatches are a property of *input classes*, not individual requests. (Bump the sample rate, or stratify it, for rare code paths you specifically want to cover.)
- **The new path still sees real inputs.** The shadow runs on the same `cart` the user sent, so it's exercised against the production input distribution — the entire reason a parallel run beats an offline golden master.

What we *gained* in correctness, not just speed: the shadow can no longer **harm** production. In the sync version, a bug in code that serves no traffic could still slow or crash requests; now it's quarantined to a background worker that fails open. The verification became both cheaper *and* safer.

> One caveat carried over from [`find-bug.md`](find-bug.md): this assumes `new.Price` is a **pure computation**. If the new path has side effects, the async worker must still run it with no-op / recording collaborators so the shadow doesn't double-write — moving work off the hot path does not, by itself, make a side-effecting shadow safe.

---

## Further refinements

Once the shadow is off the hot path, a few refinements harden it further:

- **Stratified sampling.** A flat 1% under-samples rare-but-important code paths (e.g. international tax, the one tenant with negative line items). Sample those classes at a higher rate so the bake window actually exercises them.
- **Normalize before comparing.** Strip nondeterminism (timestamps, map/slice ordering, float jitter) in the comparator, or you'll drown in false-positive mismatches (the Snippet 7 failure in [`find-bug.md`](find-bug.md)). A noisy comparator is as useless off the hot path as on it.
- **Cap total shadow capacity.** Give the worker pool a CPU/concurrency budget so verification can never starve request-serving capacity — the shadow is a guest, not a tenant.
- **Make sampling flag-controlled.** Drive the sample rate from the flag store so you can dial it up during a focused verification push and to zero the instant you cut over — and so the whole apparatus is deletable when the migration finishes.
- **Prefer infra-level mirroring for whole-service shadows.** If you're shadowing an entire service (not a unit), traffic mirroring at the load balancer / service mesh keeps the duplicate work out of your application code entirely — at the cost of harder response comparison.

---

## Summary

- **The flaw was placement, not correctness.** The original parallel run verified the new path properly but ran both engines and the comparison *on the request's critical path*, so it ~doubled latency (worse at p99), doubled cost on 100% of traffic, and coupled production reliability to code that served nothing.
- **The fix moves verification off the hot path** without weakening it: serve the old result and return immediately, then run + compare the new path **asynchronously**, on a **sampled** fraction, via **bounded background workers** that **fail open**, with **isolation and a timeout** so a slow or panicking new path can't touch the request.
- **Latency returns to baseline.** With only the old path on the critical path, served-request p99 is the old path's p99; the new path's cost and bad tail are throttled by sampling and paid off-request.
- **Correctness is fully preserved** — same served value (old is source of truth), still comparing new vs. old on real inputs, with a representative sample giving the same statistical confidence — and the shadow can no longer harm production, so it's *safer* too.
- **The cardinal rule:** a parallel run / shadow must never be on the path the user waits on. Verify *off* the hot path, sample, suppress side effects, normalize the comparison — and keep the whole apparatus deletable so the migration can finish.

---

## Related Topics

- [`find-bug.md`](find-bug.md) — the *unsafe* parallel-run mistakes (double-charging shadows, noisy comparators) this builds on.
- [`tasks.md`](tasks.md) — Exercise 4 builds the correct async shadow harness from scratch.
- [`interview.md`](interview.md) — the parallel-run / shadow Q&A (latency rule, side-effect suppression, mismatch triage).
- [`senior.md`](senior.md) — where parallel-run fits in the full strangler sequence.
- [Hotspot Analysis](../03-hotspot-analysis/optimize.md) — spend verification effort where churn × pain is highest.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/optimize.md) — keeping checks fast so they don't slow the build, the CI analogue of this hot-path lesson.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings.
