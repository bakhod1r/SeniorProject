# Mock Interview Scripts — Full Simulated Loops

Three complete, timed mock interviews tailored to a **Senior Golang Backend** role: event-driven Go services, Kafka, PostgreSQL, AWS, in an e-commerce / subscription product. Communication bar is **C1 English** with a mentorship/leadership expectation.

---

## How to Run These Mocks

- **Solo:** read each question aloud, start a timer, answer out loud (record yourself). Don't read the "strong answer" note until *after* you've attempted the question. Then self-grade against the rubric at the bottom.
- **With a peer:** the peer plays interviewer, reads only the questions and the "probe" follow-ups, and silently checks the "listen for" notes. Stop at the time budget even mid-answer — running out of time *is* signal.
- **Discipline:** speak in English the whole time, think aloud, and narrate trade-offs. At senior level, *how* you reason is graded as heavily as the final answer.
- **After each mock:** spend 5 minutes writing down what you'd improve. Re-run the weakest stage a day later.

---

## Mock 1 — Technical Phone Screen (45 min)

**Format:** 5 min intro · 12 min Go fundamentals + concurrency · 20 min live coding · 6 min scenarios · 2 min candidate questions.

### Stage 0 — Intro (5 min)
> "Tell me about a recent Go service you owned end to end — what it did, the scale, and one technical decision you'd defend."

**Listen for:** concrete ownership, real numbers (QPS, data size), a decision with a trade-off (not "we used X because it's popular"). Fluent, structured English.

### Stage 1 — Go Fundamentals & Concurrency (12 min)

Ask rapid-fire; probe depth on any weak answer.

1. **"What's the difference between a buffered and unbuffered channel, and when do you reach for each?"**
   - *Probe:* "What happens on send to a nil channel? On send to a closed channel?"
   - *Strong answer:* unbuffered = synchronous handoff (send blocks until receive); buffered = async up to capacity, decouples producer/consumer rate. Nil channel send/receive **blocks forever** (used to disable a `select` case). Send on closed channel **panics**; receive on closed returns zero value + `ok=false`.

2. **"How do you cancel a goroutine? How do you avoid goroutine leaks?"**
   - *Probe:* "Show me a leak you've actually caused."
   - *Strong answer:* you don't kill goroutines — you signal via `context.Context` cancellation or a done channel and the goroutine must cooperate (check `ctx.Done()` in loops/selects). Leaks come from blocked sends/receives on channels nobody reads, or goroutines waiting on a context that's never cancelled. Mentions detecting via `pprof goroutine` profile.

3. **"`sync.Mutex` vs channels for shared state — how do you decide?"**
   - *Strong answer:* "Share memory by communicating" for ownership transfer / pipelines; mutex for protecting a small piece of shared state with simple critical sections (counters, caches). Channels add overhead and complexity; don't cargo-cult them. Mentions `sync.RWMutex` for read-heavy, `atomic` for single-word counters.

4. **"What does `defer` cost, and when has it surprised you?"**
   - *Strong answer:* near-zero since Go 1.14 (open-coded defers), but loops accumulating defers can blow up; arguments are evaluated at the `defer` statement, not at execution; `defer` in a hot tight loop or releasing a lock late can matter.

5. **"What is a data race and how do you find one?"**
   - *Strong answer:* concurrent access to the same memory with at least one write and no synchronization → undefined behavior. Found with `go test -race` / `-race` builds in CI. Notes the race detector is runtime, so you need test coverage to trigger it.

### Stage 2 — Live Coding (20 min)

> **Problem:** "Implement a concurrent rate limiter: allow at most N requests per second across many goroutines. Then turn it into a bounded worker pool that processes a stream of jobs with at most W workers, propagating the first error and cancelling the rest."

**Run it as two parts (10 min each).** Watch the candidate think aloud and grow the design.

**Part A — token-bucket rate limiter.** Strong answer reaches for something like:

```go
type Limiter struct{ tokens chan struct{} }

func NewLimiter(rps int) *Limiter {
    l := &Limiter{tokens: make(chan struct{}, rps)}
    go func() {
        t := time.NewTicker(time.Second / time.Duration(rps))
        defer t.Stop()
        for range t.C {
            select { case l.tokens <- struct{}{}: default: } // refill, don't block
        }
    }()
    return l
}
func (l *Limiter) Allow(ctx context.Context) error {
    select {
    case <-l.tokens: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
```

- *Probe:* "What if `rps` is 10,000 — is a ticker per token wise?" (→ refill in batches). "How does this behave under burst?" (→ bucket allows a burst up to capacity). "Would you use `golang.org/x/time/rate` in prod?" (→ yes; this is the interview version).

**Part B — bounded worker pool with first-error-cancels.** Strong answer uses `errgroup`:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(W)
for _, job := range jobs {
    job := job
    g.Go(func() error {
        if err := lim.Allow(ctx); err != nil { return err }
        return process(ctx, job) // returns ctx.Err() if cancelled
    })
}
err := g.Wait() // first non-nil error, others cancelled via ctx
```

**Listen for:** correct channel/`select` usage, no goroutine leaks, context propagation, the `job := job` capture fix (or 1.22+ awareness that loop vars are now per-iteration), graceful handling of "what if a worker panics?" (recover or let it crash — defended either way). Mentions back-pressure and that `g.SetLimit` bounds concurrency.

**Red flags:** busy-wait loops, `time.Sleep`-based throttling, unbounded goroutine spawn, ignoring `ctx`, closing a channel from the receiver side, no error propagation.

### Stage 3 — Quick Scenarios (6 min, ~3 min each)

1. **"Your service's p99 latency spiked 10× but p50 is flat. Where do you look first?"**
   - *Strong answer:* tail-only → suspect GC pauses, lock contention, a slow downstream on some keys, connection-pool exhaustion, or noisy-neighbor / hot partition. Check `pprof`, GC trace (`GODEBUG=gctrace=1`), DB pool saturation, and per-route/per-key latency. Distinguishes tail from mean causes.

2. **"A consumer is lagging on a Kafka topic and lag keeps growing. What do you do?"**
   - *Strong answer:* check whether the consumer is CPU/IO bound or blocked on a downstream (DB) → scale consumers up to (but not beyond) partition count; if already maxed, add partitions or batch/parallelize processing within the consumer; check for poison messages and rebalance storms; verify commits aren't blocking. Mentions ordering constraints when parallelizing.

### Candidate Questions (2 min)
Strong candidates ask sharp questions about on-call, deploy cadence, or the team's biggest reliability pain — signals seniority and genuine engagement.

---

## Mock 2 — System Design (60 min)

**Prompt (pick this one):**
> **"Design the order/checkout + notification flow for our e-commerce platform. A user checks out a cart; we must reliably create an order, charge payment, decrement inventory, and notify the user (email/SMS/push). It must not double-charge or double-ship, and notifications must be reliable."**

Drive the candidate through the structure below. The point is to see them *lead* the design and surface trade-offs unprompted.

### Stage 1 — Requirements & Scope (5 min)
**Expect the candidate to ask, not assume:**
- Functional: checkout, payment, inventory reservation, order persistence, multi-channel notifications, idempotent retries.
- Non-functional: no double-charge (correctness > availability here), notification at-least-once, target scale, latency budget for checkout (user is waiting → keep synchronous path short).
- Out of scope: cart management, recommendations, fraud (acknowledge, defer).

**Probe:** "What's the consistency requirement on inventory — can we oversell briefly?" Strong answer reasons about reservation vs hard decrement and business tolerance.

### Stage 2 — Estimation (5 min)
- e.g. 10M DAU, 2% checkout/day = 200k orders/day ≈ **2.3 orders/sec avg, ~10–15/sec peak** — *low* write QPS, so correctness and reliability dominate over raw throughput.
- Notifications fan out ~3× per order → ~600k/day. Order row ~1 KB → ~200 MB/day → ~70 GB/year before replication.

**Listen for:** the candidate noticing checkout is **low-QPS / high-correctness** and steering the design accordingly (not over-engineering for scale that isn't there).

### Stage 3 — API (5 min)
- `POST /checkout` with **`Idempotency-Key` header** → 201 with order id, or 409 on conflicting retry, 422 on validation, 402/409 on payment decline.
- Async status via `GET /orders/{id}` (state machine: `PENDING → PAID → FULFILLED / FAILED`).

**Probe:** "Why an idempotency key on POST?" → retries from clients/load balancers must not create duplicate orders or charges.

### Stage 4 — High-Level Design (15 min)
Expect: API gateway/ALB → Order service (Go) → PostgreSQL (orders, idempotency table) → **Kafka** event backbone → downstream consumers (Payment, Inventory, Notification services). Notifications via SNS/SQS or a Notification service consuming a Kafka topic, with per-channel providers.

**Listen for:**
- Separating the **synchronous** path (persist order + return) from **asynchronous** work (charge, fulfill, notify) via events.
- Choosing choreography (services react to events) vs orchestration (a saga coordinator) and justifying it.
- Putting the order DB write and the "order created" event emission in **one atomic step** (→ leads into outbox).

### Stage 5 — Deep Dive: Outbox / Idempotency / Exactly-Once (15 min) — *the core*

This stage separates seniors from mid-levels. Drive hard here.

1. **Dual-write problem:** "You write the order to Postgres *and* publish to Kafka. The DB commit succeeds, then the broker publish fails. Now what?"
   - *Strong answer:* **Transactional Outbox** — write the order row and an `outbox` event row in the **same DB transaction**. A separate relay (CDC via Debezium, or a poller) reads the outbox and publishes to Kafka, marking rows sent. Guarantees the event is published iff the order committed.

2. **Idempotency on the consumer:** "Kafka is at-least-once. Payment consumer may see the same event twice. Don't double-charge."
   - *Strong answer:* idempotent consumer keyed by a stable id (order id / event id). Either a unique constraint / dedup table (`processed_events(event_id PK)`), or make the downstream operation naturally idempotent. For payment, pass an idempotency key to the payment provider so *they* dedup.

3. **"Exactly-once — is it real?"**
   - *Strong answer:* there's no true exactly-once *delivery*; you get **effectively-once processing** = at-least-once delivery + idempotent/deduplicated processing. Kafka transactions give exactly-once *within Kafka* (read-process-write), but the side effects (charging a card) still need idempotency keys. A senior says this crisply.

4. **Ordering & partitioning:** key Kafka messages by `order_id` so all events for one order stay ordered on one partition.

5. **Saga / compensation:** "Payment succeeds, inventory is out of stock — now what?" → compensating action (refund), order moves to `FAILED`, customer notified. Distinguishes forward recovery from rollback.

**Probe relentlessly:** "What if the outbox relay crashes mid-batch?" (→ at-least-once publish, hence consumer idempotency — the two halves reinforce each other). "Where's the dedup table cleaned up?" (→ TTL/retention).

### Stage 6 — Bottlenecks & Scaling (10 min)
**Listen for:**
- Outbox poller becomes a bottleneck → CDC (Debezium) instead of polling; partition the outbox.
- Notification fan-out → separate topics/consumers per channel so a slow SMS provider doesn't block email.
- Hot keys (a flash sale on one SKU) → inventory contention; reservation with row locks vs optimistic concurrency vs Redis counters with reconciliation.
- DB as the write bottleneck → it isn't at this QPS, but discuss read replicas for order history, partitioning by time, archival.
- Failure isolation: circuit breakers on payment/notification providers; DLQ for poison messages; `Retry-After`/429 under load.

### Stage 7 — Wrap (5 min)
> "If you had one more week, what would you harden first, and what did you knowingly leave out?"

**Strong answer:** names the riskiest part (usually outbox relay reliability + payment idempotency), proposes monitoring (consumer lag, outbox backlog age, payment retry rate), and is honest about deferred concerns (fraud, multi-region, GDPR deletion). Self-aware about trade-offs = senior signal.

**Trade-offs a strong candidate raises unprompted:** sync vs async boundary, choreography vs orchestration, outbox-polling vs CDC, at-least-once + idempotency vs Kafka transactions, strong vs eventual consistency on inventory, correctness-over-availability for payment.

---

## Mock 3 — Behavioral & Leadership (45 min)

**Format:** ~6 min per question, 6–7 questions. Communication is graded throughout: at **C1 English** the bar is fluent, structured, precise — minor grammar slips are fine, but the candidate must convey nuance, disagree diplomatically, and tell a clear narrative.

Use **STAR**: **S**ituation (brief context), **T**ask (your responsibility), **A**ction (what *you* specifically did), **R**esult (measurable outcome + what you learned). Coach the candidate to spend most time on **A** and **R**, with *I* not *we*.

### Q1 — Outage / Incident
> "Tell me about a production incident you led or significantly contributed to. Walk me through detection, response, and follow-up."

- *Probes:* "How did you find root cause?" "What did you change so it can't recur?" "How did you communicate during the incident?"
- *Strong answer:* clear timeline, calm under pressure, mitigation-before-root-cause, blameless post-mortem, concrete preventive action (alert, test, guardrail). Quantifies impact and MTTR.
- *Red flags:* blames others/the previous team, no follow-up, "we restarted it and it went away," can't explain the actual cause.

### Q2 — Conflict / Disagreement
> "Describe a time you strongly disagreed with a teammate or your lead on a technical decision."

- *Probes:* "How did you decide whose approach to use?" "What did you do once the decision went against you?"
- *Strong answer:* disagrees with data/prototypes not ego, seeks to understand the other view, **disagrees and commits** once decided. Shows it stayed professional.
- *Red flags:* "I was right and they were wrong," escalating to a manager as first move, passive resentment, no resolution.

### Q3 — Mentorship
> "Tell me about someone you mentored. What did they struggle with and how did you help them grow?"

- *Probes:* "How did you adapt to their learning style?" "How did you give critical feedback?" "How did you measure their growth?"
- *Strong answer:* (this role expects mentorship) specific person, structured support — pairing, code review as teaching, stretch tasks with a safety net, feedback that's kind and direct. Result: the mentee gained autonomy. Shows investment in others, not just self.
- *Red flags:* "I just told them what to do," takes credit for the mentee's work, no concrete example.

### Q4 — Ownership
> "Tell me about a time you took ownership of something outside your assigned responsibilities."

- *Probes:* "Why did you step in?" "What was the risk if you hadn't?"
- *Strong answer:* spotted a gap (flaky pipeline, missing runbook, tech debt, no on-call doc), drove it without being asked, brought others along. Long-term thinking over local optimization.
- *Red flags:* hero-coding in secret, ignoring process, "nobody else would do it so I did everything alone."

### Q5 — Deadline / Pressure
> "Describe a time you had to deliver under a tight deadline with incomplete information."

- *Probes:* "What did you cut and why?" "How did you manage stakeholder expectations?"
- *Strong answer:* scoped ruthlessly, communicated trade-offs early, protected quality on the critical path while deferring non-essentials, didn't silently accumulate debt. Negotiated scope rather than burning the team.
- *Red flags:* death-march heroics, hid risk until the deadline, shipped something broken without flagging it.

### Q6 — A Mistake You Made
> "Tell me about a significant mistake you made. What happened and what did you learn?"

- *Probes:* "What would you do differently?" "What did you change in your process?"
- *Strong answer:* owns a real, non-trivial mistake (not a humble-brag), explains impact honestly, shows the concrete systemic change it produced (a test, a guardrail, a habit). Self-aware and growth-oriented.
- *Red flags:* "my biggest weakness is I work too hard," deflects blame, picks a trivial mistake, no learning.

### Q7 — Customer-Facing Communication
> "Tell me about a time you had to explain a complex technical problem (an outage, a delay, a limitation) to a non-technical stakeholder or customer."

- *Probes:* "How did you adjust your language?" "How did you handle their frustration?"
- *Strong answer:* (subscription/e-commerce → customer impact is real) translates tech into business impact, sets honest expectations, no jargon dump, manages emotion with empathy. Demonstrates the **C1 English** clarity the role needs.
- *Red flags:* over-technical, defensive, over-promises, blames the customer.

### Q8 (optional) — Influence Without Authority
> "Tell me about a time you drove a technical change across teams you didn't manage."

- *Strong answer:* built consensus with a proposal/RFC, piloted to prove value, addressed objections, measured impact. Leadership through influence.

---

## Scoring Rubric

Grade each stage **Junior / Mid / Senior / Staff**. For a senior role, expect mostly **Senior** with flashes of **Staff**.

### Technical (Mocks 1 & 2)

| Signal              | Junior                          | Mid                                  | Senior                                            | Staff                                                  |
|---------------------|---------------------------------|--------------------------------------|---------------------------------------------------|--------------------------------------------------------|
| Go depth            | Syntax-level; copies patterns   | Uses concurrency correctly when prompted | Reasons about channels/ctx/leaks/GC unprompted; knows *why* | Teaches it; knows runtime/scheduler/escape-analysis trade-offs |
| Problem solving     | Needs the answer steered        | Solves with hints                    | Solves, handles edge cases & failure modes        | Reframes the problem; questions the requirements        |
| System design       | Lists components                | Connects components into a flow      | Drives requirements→trade-offs; nails outbox/idempotency | Designs for org/evolution; names what *not* to build    |
| Trade-offs          | "X is best"                     | States one trade-off                 | Weighs several, ties to business context          | Surfaces second-order effects & long-term cost          |
| Failure thinking    | Assumes happy path              | Handles obvious errors               | Designs for retries, partial failure, idempotency | Designs for the failures nobody else mentioned          |

### Behavioral & Communication (Mock 3)

| Signal              | Junior                          | Mid                                  | Senior                                            | Staff                                                  |
|---------------------|---------------------------------|--------------------------------------|---------------------------------------------------|--------------------------------------------------------|
| Ownership           | Does assigned tasks             | Owns a feature                        | Owns outcomes & reliability of a system            | Owns org-level problems and raises the bar for others   |
| Mentorship          | Learns from others              | Helps peers ad hoc                    | Deliberately grows others                          | Builds a culture/process that scales mentorship         |
| Conflict            | Avoids or escalates             | Resolves 1:1                          | Disagrees with data, then commits                  | Aligns teams; turns conflict into a better decision     |
| Communication (C1)  | Understandable, some struggle on nuance | Clear on familiar topics      | Fluent, structured, audience-aware, diplomatic     | Persuasive; tailors message to any audience effortlessly|
| Self-awareness      | Hard to name a real mistake     | Names a mistake                       | Names it + the systemic fix                        | Models vulnerability; uses failures to teach            |

**Communication bar (all mocks):** the candidate must think aloud in clear English, structure answers (STAR or requirements→design→trade-offs), and handle follow-ups without losing the thread. Hesitant-but-correct beats fluent-but-vague. At C1, expect comfort with nuance, hedging, and disagreement — not native-level idiom.
