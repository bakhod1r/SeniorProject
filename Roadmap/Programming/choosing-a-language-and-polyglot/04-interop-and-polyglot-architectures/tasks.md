# Interop & Polyglot Architectures — Practice Tasks

Six design-and-decision exercises. There is almost no code to write — the work is *reasoning*: choosing interop boundaries and defending them, designing a contract, pricing a language, and dismantling a bad polyglot architecture. For each task, the deliverable is a short written argument (a paragraph or a filled-in table), not an implementation. The discipline being trained is treating every boundary as a priced liability and matching the mechanism to the coupling.

---

## Task 1 — Choose the interop boundary for three relationships

You're designing a food-delivery platform. Three component pairs need to talk:

1. **Order API → Payment processor.** The order can't be confirmed until payment succeeds. Called once per checkout, ~50/sec at peak. The payment processor is an external third party with a public REST API.
2. **Order API → Notification service.** When an order is placed, the customer gets a push notification and an email. The order doesn't need to wait for this; if notifications are delayed a few seconds, nobody cares. ~50/sec.
3. **Pricing engine → Geo-distance library.** The pricing engine computes delivery fees and calls a CPU-bound great-circle-distance function ~5,000 times per pricing request, ~200 pricing requests/sec. The distance code is a small, stable, well-tested C library.

**Objective.** For each pair, choose an interop mechanism (message queue / REST / gRPC / FFI / in-process call) and justify it in two sentences, naming the dominant factor.

**What to weigh.** Synchronous vs async need, call frequency, coupling, who owns each side, fault isolation, serialization cost.

**Acceptance.**
- [ ] Each choice names the *dominant deciding factor*, not just the mechanism.
- [ ] At least one pair is async and at least one is in-process — if all three are "REST," reconsider.
- [ ] You've stated, for the FFI candidate, what you'd lose (fault isolation) and why it's acceptable here.

**Discussion (read after attempting).** (1) is external + synchronous + must-not-lose-money → REST (you don't control the third party's protocol; synchronous because the order blocks on it). (2) is async by nature → message queue (the order shouldn't wait; notifications can buffer and retry). (3) is hot (5,000 calls × 200 req/sec = 1M calls/sec) + stable native code → FFI/in-process is the *only* viable option; a network hop per call would be absurd, and the C library being small and stable is exactly what makes forfeiting fault isolation acceptable. If you put (3) behind a network call, you've placed a boundary in the middle of a tight loop — the chatty-boundary anti-pattern.

---

## Task 2 — Design a shared contract for two services in different languages

A **Go order service** needs fraud scores from a **Python ML service** on every transaction. Design the protobuf contract.

**Objective.** Write a `.proto` (or equivalent schema sketch) for the request and response, and a one-paragraph note on error handling and evolution.

**Constraints.**
- The request carries a transaction amount (money — be careful), a list of feature values, a model name, and a request ID for tracing.
- The response carries a fraud score (0–1), a categorical label, the model *version* that scored it, and a way to express *why a scoring attempt failed* distinctly from "scored, low risk."
- You must state which fields are safe to add later and which changes would break clients.

**Acceptance.**
- [ ] Money is *not* a bare `double` (justify your representation — float-for-money is a classic seam bug).
- [ ] The error case is modeled explicitly, not smuggled into the score (e.g., a `0.0` score that secretly means "model down").
- [ ] You name at least one safe evolution (add an optional field) and one breaking one (reuse/retype a field number).
- [ ] The request ID for trace correlation is present.

**Reference shape (one valid answer):**

```protobuf
syntax = "proto3";
package fraud.v1;

message ScoreRequest {
  string request_id   = 1;   // for cross-language trace correlation
  string amount_minor = 2;   // money as string of minor units ("1299" = $12.99); NOT a double
  string currency     = 3;   // ISO 4217, e.g. "USD"
  repeated double features = 4;
  string model        = 5;
}

message ScoreResponse {
  oneof outcome {
    Scored scored = 1;        // explicit success
    ScoreError error = 2;     // explicit failure — not a magic score
  }
}
message Scored {
  double score        = 1;    // 0..1
  string label        = 2;
  string model_version = 3;
}
message ScoreError {
  enum Kind { UNKNOWN = 0; MODEL_UNAVAILABLE = 1; BAD_INPUT = 2; TIMEOUT = 3; }
  Kind kind   = 1;
  bool retryable = 2;
  string detail = 3;
}

service FraudScorer {
  rpc Score(ScoreRequest) returns (ScoreResponse);
}
```

Why these choices: money as a string of minor units dodges float rounding across the Go/Python seam; the `oneof` forces callers to distinguish "scored" from "failed" at the type level (no magic-number score); `retryable` puts the retry semantics *in the contract* so the Go side doesn't have to guess. **Safe to add:** a new optional field in `Scored` (old clients ignore unknown fields). **Breaking:** changing `score` from `double` to `float`, or reusing field number `1` — corrupts every deployed client.

---

## Task 3 — Cost-analyze a proposed 4th language

Your system is currently **Go (API + most services), Python (ML), TypeScript (frontend)** — three languages, all on the supported list. A senior engineer proposes adding **Rust** for one new component: a real-time bidding engine with a hard p99 latency budget of 2 ms, where Go's GC pauses are blowing the budget.

**Objective.** Write a one-page cost/benefit analysis that a tech-lead group could approve or reject. Don't just say yes or no — *price it.*

**What your analysis must include.**
- The **capability** Rust provides that the existing three languages can't (be specific — it's not "Rust is fast").
- The **forever-tax** of adding Rust: hiring pool, on-call coverage, shared-library porting (auth/retry/metrics now need a 4th implementation), CI template, vuln-scanning toolchain.
- Whether this is **principled or sprawl** by the §7 test from [`senior.md`](senior.md).
- An **alternative that avoids the 4th language** (and why it does/doesn't work here).
- A **recommendation** with a condition — under what terms you'd approve.

**Acceptance.**
- [ ] The benefit is stated as a *specific irreplaceable capability* (no-GC, predictable sub-ms latency), not a vague "performance."
- [ ] The tax is enumerated concretely, including on-call and the porting of shared libs.
- [ ] You consider at least one no-new-language alternative (tune Go's GC / `GOGC`, off-heap allocation, a C++ component if C++ is already in the estate, etc.).
- [ ] Your recommendation has a *governance condition* attached (e.g., "approve as 'allowed-with-justification' tier; the team owns the gaps; revisit in 12 months").

**Discussion.** This is a genuinely strong case *if* the latency requirement is real and measured — predictable no-GC sub-2ms latency is something Go cannot reliably give, and that capability is close to irreplaceable. The principled-vs-sprawl test passes: rewriting the bidder in Go would cost you the latency budget, which is the whole point of the component. But the *forever-tax* is real: Rust hiring is a smaller pool, on-call now needs Rust competence, and the platform team must port auth/retry/metrics to Rust or the team maintains its own. The honest recommendation is usually: *approve, but as a governed exception* — "allowed-with-justification" tier, single bounded component, the team owns the shared-lib gaps until/unless it graduates, with a revisit date. The wrong answers are both reflexive: "no, three languages is enough" (ignores a real capability gap) and "sure, Rust is great" (ignores the tax). The right answer *prices both sides and attaches a condition.*

---

## Task 4 — Critique an over-polyglot architecture

A startup's 25-engineer team has this estate:

| Service | Language | Origin |
|---|---|---|
| Web API | Go | original founder's choice |
| Frontend | TypeScript | (browser, forced) |
| ML / recommendations | Python | (ecosystem, forced) |
| Billing | Scala | from a 2021 hackathon; one author, now departed |
| Notifications | Ruby | an early contractor's preference |
| Admin dashboard backend | Node.js | "we already had Node for the frontend tooling" |
| Search indexer | Elixir | a senior engineer wanted to learn it |

Seven languages, 25 engineers. Incidents in Billing and Search routinely wait for the one or two people who know Scala/Elixir. A recent CVE in their JSON library required fixes in five languages, and the Ruby fix lagged three weeks.

**Objective.** Diagnose which languages are *principled* and which are *sprawl*, and propose a consolidation plan.

**What to produce.**
- A per-language verdict (forced / justified / sprawl) using the §7 test.
- The **two clearest consolidation targets** and what you'd migrate them *to*.
- The **operational symptom** that proves this estate has tipped from capability to liability.
- One sentence on *why you would not consolidate everything at once.*

**Acceptance.**
- [ ] TypeScript and Python are correctly identified as *forced/principled* (don't touch them).
- [ ] Scala, Ruby, and Elixir are flagged as sprawl (each has a "someone liked it / hackathon" origin and a bus-factor problem).
- [ ] Node-for-admin is correctly called a weak justification ("we already had it" for *tooling* doesn't justify a backend runtime).
- [ ] You cite the **CVE-fix lag** and **on-call bus factor** as the tip-over symptoms.
- [ ] The plan is *targeted and incremental* (strangler-fig per service, per [`../06-migrating-between-languages/`](../06-migrating-between-languages/)), not a big-bang rewrite.

**Discussion.** Forced/principled: TypeScript (browser), Python (ML). Justified-ish: Go (the original core — make it the consolidation *target*). Sprawl: Scala (hackathon, departed author, bus factor 1), Ruby (contractor preference, lagging CVE fixes), Elixir (résumé-driven). Weak: Node-for-admin ("had it for tooling" conflates a frontend toolchain with a backend runtime). The tip-over symptoms are textbook: the five-language CVE fan-out with a three-week lag is the shared-library tax made visible, and the wait-for-the-one-Scala-person is the on-call bus factor. Consolidation plan: pick **Billing (Scala)** and **Notifications (Ruby)** first — highest tax (bus factor + CVE lag), lowest justification — and strangler-fig them into Go. Leave Elixir-search for later (search may have genuine concurrency benefits worth re-evaluating before assuming sprawl). Why not all at once: a big-bang seven-to-three rewrite would freeze feature work and risk the whole business; consolidation is a targeted retirement of the worst offenders, not a crusade.

---

## Task 5 — Place the boundaries to avoid a distributed monolith

A team is splitting a monolith into services. They propose this split for the checkout flow:

```
CartService  ──► PricingService  ──► TaxService  ──► DiscountService  ──► TotalService
(each a separate process, each in a different language, each over REST/JSON)
```

Completing one "calculate cart total" requires the browser → Cart → Pricing → Tax → Discount → Total: five synchronous network hops, five JSON serializations, five languages, all on the critical path of every "view cart" page load.

**Objective.** Critique this boundary placement and propose a better one. Decide where boundaries belong and where they're harming the system.

**What to weigh.** Coupling (do pricing/tax/discount/total change for different reasons, or always together?), latency (five hops on a page load), the chatty-boundary anti-pattern, and the difference between a *service* and a *distributed monolith*.

**Acceptance.**
- [ ] You identify that pricing + tax + discount + total are *tightly coupled* — they always change together and always run together — so the boundaries between them are misplaced.
- [ ] You note this pays *all* the costs of network boundaries (latency, serialization, five debuggers) and gets *none* of the benefit (they can't deploy or scale independently — they're a distributed monolith).
- [ ] Your proposal collapses the tightly-coupled calculation into *one* service (likely one language, with internal in-process calls) and keeps a boundary only where coupling is genuinely low (e.g., Cart vs the calculation engine).
- [ ] You name the chatty-boundary symptom: five serializations on the critical path of a page load.

**Discussion.** Pricing, tax, discount, and total are one cohesive calculation — they share inputs, change for the same business reasons, and have no independent scaling or deployment story. Splitting them across five languages and five network hops is the distributed-monolith trap: maximum cost, zero benefit. The fix is to collapse the four calculation steps into a *single* "PricingEngine" service (one language, in-process function calls between the steps — nanoseconds, no serialization), and keep a network boundary only between Cart (which has its own lifecycle, persistence, and team) and the engine. Boundaries belong on seams of *low coupling* (different teams, different change-reasons, different ecosystems), not in the middle of one tightly-coupled algorithm. The "five languages" here isn't principled polyglot — it's accidental sprawl wearing a microservices costume.

---

## Task 6 — Decide the observability prerequisites before going polyglot

A monoglot Go team is about to add their first non-Go service (a Python ML service), making the system polyglot for the first time. Before the Python service ships, what observability and contract investments are *prerequisites*, not nice-to-haves?

**Objective.** Produce a "definition of done" checklist for the *boundary itself* — the things that must exist before the cross-language seam goes to production, so that a 3 a.m. incident is debuggable.

**What to include.** Think about what *breaks* when a stack trace can no longer span the whole request.

**Acceptance — your checklist should require:**
- [ ] **Distributed tracing** with `traceparent` (OpenTelemetry) propagated across the Go → Python hop, so a single request is one trace, not two fragments.
- [ ] A **request/correlation ID** generated at the edge and carried through both services and into both services' logs.
- [ ] A **mandated structured-log schema** (same field names for `request_id`, `severity`, `service`) so Go's `slog` output and Python's `logging` output can be correlated in one query.
- [ ] An **explicit error contract** in the schema — error categories and retryability — so a Python failure arrives in Go as a meaningful status, not "500, something went wrong."
- [ ] A **shared schema** (protobuf/JSON Schema) so the boundary is type-checked at build time, not discovered broken at runtime.
- [ ] A note that **profiling is now two tools** (pprof + py-spy) and on-call must know both, or escalation paths are defined.

**Discussion.** The point of this task is that polyglot's real cost is paid in *incident time*, and that cost is only bounded if you pay the observability tax *up front*. A team that ships the Python service first and "adds tracing later" discovers, during their first cross-language incident, that the trace splits at the boundary, the logs don't correlate, and the error is an opaque 500 — and they debug by guesswork. Every item above is a thing that was *free* in the monoglot world (one stack trace, one log format, one profiler) and must now be *engineered*. The senior framing: observability across the boundary is a *precondition* for responsible polyglot, in the same way a seatbelt is a precondition for driving fast — you install it before the trip, not after the crash.

---

## A meta-check before you submit any of these

For every interop decision you made, ask:

- Did I name the **dominant factor** (sync/async, hot/cold, coupled/decoupled, fault-isolation need), or did I default to a mechanism out of habit?
- Did I **price the boundary** — serialization, latency, two debuggers, error impedance, on-call — or treat it as free?
- For every language, can I answer the **principled-or-sprawl test**: what's lost if it's rewritten in the primary language, and is that worth the forever-tax?
- Did I start at the **loosely-coupled end** and tighten only on evidence, or jump straight to FFI "for speed"?

If you can answer all four cleanly for each task, you've internalized the mindset.

---

**Memorize this:** the work of interop design is not picking a protocol — it's matching each boundary to its coupling, pricing every boundary as a recurring liability, and refusing to add a language unless its irreplaceable capability outweighs its forever-tax. Boundaries belong on seams of low coupling; put a schema on every one; start loose and tighten only when measurement forces you. Get those reflexes right and the protocol choice falls out on its own.
