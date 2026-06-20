# Runtime Assertions & Contracts — Professional Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Runtime Assertions & Contracts
> *The senior page taught you to write a good invariant. This page is about deciding, for a fleet of ten thousand processes serving untrusted traffic, which of those invariants is allowed to halt a process in production — where `assert` stops being a debugging aid and becomes a question about your DoS surface, your blast radius, and how fast a single new check can crash-loop the whole fleet.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The House Policy: CHECK vs DCHECK vs Error-Return](#core-concept-1--the-house-policy-check-vs-dcheck-vs-error-return)
5. [Core Concept 2 — The Trust Boundary Rule: Validate Input, Assert Invariants](#core-concept-2--the-trust-boundary-rule-validate-input-assert-invariants)
6. [Core Concept 3 — Crash Granularity and Blast Radius](#core-concept-3--crash-granularity-and-blast-radius)
7. [Core Concept 4 — Rolling Out a New Always-On CHECK](#core-concept-4--rolling-out-a-new-always-on-check)
8. [Core Concept 5 — Assertion Failures as First-Class Telemetry](#core-concept-5--assertion-failures-as-first-class-telemetry)
9. [Core Concept 6 — Assertions as a Force Multiplier and the Verification Ladder](#core-concept-6--assertions-as-a-force-multiplier-and-the-verification-ladder)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Setting an org-wide assertion policy and operating it across a fleet, where every always-on check is a deliberate availability, security, and incident-response decision.**

The senior page framed assertions as an engineering craft: state the invariant, fail fast, keep the side effects out. At the professional level those same checks show up in different meetings. A new `CHECK` lands in the request path and a malformed packet from the open internet turns into a fleet-wide crash-loop. A `DCHECK` that would have caught a serializer writing corrupt records was compiled out of release builds, so the corruption shipped to disk for three weeks before anyone noticed. A security review asks "can untrusted input reach an abort?" and nobody can answer without grepping the tree. A SEV review ends with the line "the assert was correct — the problem was that it ran in production at process granularity."

None of these are new *concepts*. They are the same `assert` from the earlier tiers, now multiplied by a fleet, an attacker, and a deploy pipeline. The central question this page answers is not "how do I write an assertion?" but **"what is allowed to run in production, at what granularity, and how do I roll it out without turning a latent bug into an outage?"** Get the policy right and assertions become your highest-leverage corruption detector and your fuzzer's best friend. Get it wrong and they become a remote kill switch you handed to your worst user.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — how to write a correct invariant, side-effect-free checks, `assert` vs sanitizers, the fail-fast principle.
- **Required:** You've operated a service in production and been paged for a crash you had to triage from a stack trace, not a debugger.
- **Helpful:** You've owned a deploy pipeline, a canary stage, or an on-call rotation.
- **Helpful:** You've debugged data corruption that shipped to durable storage and had to reason about blast radius after the fact.

---

## Glossary

- **CHECK** — an always-on assertion compiled into release builds; fires in production and aborts (or invokes the configured failure handler). In abseil/Chromium, `CHECK(cond)`.
- **DCHECK** — a "debug check": compiled in only when `NDEBUG` is unset (debug and canary builds), stripped from optimized release builds. Cheaper to add liberally because it costs nothing in prod.
- **`assert` / `NDEBUG`** — the C/C++ standard-library macro; a no-op when `NDEBUG` is defined. This is the default build flag for release, which is why naked `assert` behaves like a DCHECK in most pipelines.
- **Trust boundary** — the line where data crosses from a domain you control (your own code, your own invariants) into one you don't (network input, user files, RPC payloads).
- **Crash granularity** — the unit that dies when a check fails: a request, a goroutine, an actor, a worker, or the whole OS process.
- **Blast radius** — the set of work or capacity lost by a single failure. For an assertion, the question is "one request, or one process, or — via a crash-loop — the fleet?"
- **Let-it-crash / crash-only** — an architecture where components are designed to fail fast and be restarted by a supervisor, rather than to recover in place. Erlang/OTP and Candea & Fox's "crash-only software."
- **Recovery boundary** — the single, deliberate place where a panic/exception is caught and converted to an error (e.g. Go `recover()` at the RPC handler) instead of being swallowed everywhere.

---

## Core Concept 1 — The House Policy: CHECK vs DCHECK vs Error-Return

The first artifact a serious org produces is not a clever assertion — it is a one-page **assertion policy** that every engineer can apply without a meeting. The policy answers a single question for every potential check: *does this run in production, and what happens when it fires?* There are three buckets, and the entire discipline is about putting each invariant in the right one.

```cpp
// Bucket 1 — CHECK: always-on, fires in production, aborts.
// Reserve for invariants whose violation means "continuing is worse than crashing":
// safety-critical, security-critical, or imminent-corruption conditions.
CHECK(index < buffer.size());            // about to write out of bounds → corrupt memory
CHECK(authenticated_user != nullptr);    // security: never proceed unauthenticated
CHECK_EQ(checksum, computed_checksum);   // about to persist data we know is corrupt

// Bucket 2 — DCHECK: debug + canary only, compiled out of release.
// For expensive internal sanity checks where the cost in prod isn't justified
// but you still want the signal in test/canary.
DCHECK(IsSorted(v));                      // O(n) scan — too costly on every prod call
DCHECK(invariant_that_should_hold_but_is_cheap_to_be_wrong_about);

// Bucket 3 — error-return: not an assertion at all. For anything that CAN
// legitimately happen at runtime, especially from outside your trust boundary.
if (!parse_ok) return absl::InvalidArgumentError("malformed request");
```

The cost/benefit of an always-on `CHECK` is concrete and small on one side and unbounded on the other. The cost is *one predictable branch* per check — on modern CPUs, a correctly-predicted not-taken branch is effectively free, and even a few thousand of them on a hot path rarely move a profile. The benefit is catching corruption *at the moment it becomes detectable, before it propagates*. A `CHECK` that aborts on a bad index turns "silently corrupt a neighbor's memory, serve wrong results for a week, debug from a heap dump" into "stack trace pointing at the exact line." That asymmetry — a branch versus a multi-day corruption incident — is why the default for genuinely safety- or correctness-critical invariants leans toward `CHECK`, not `DCHECK`.

The trap that the policy exists to prevent is the **DCHECK-by-default reflex**: "asserts are for debugging, so compile them out of release." That instinct is exactly backwards for the highest-value checks. The invariants most worth verifying — "we are not about to persist corrupt data," "we are not about to dereference past the buffer" — are precisely the ones you want firing *in production, where the real, weird inputs live*, not only on your test machine where everything is well-behaved.

> **The principle:** the question is never "assert or not" — it's "which bucket." `CHECK` for invariants where *continuing is worse than crashing*; `DCHECK` for expensive internal checks you only need in canary; error-return for anything that can legitimately occur, especially across a trust boundary. A house policy that names the buckets and gives three-line examples removes the per-engineer guessing that produces both unguarded corruption and reckless production aborts.

---

## Core Concept 2 — The Trust Boundary Rule: Validate Input, Assert Invariants

There is exactly one rule that, applied consistently, eliminates the most dangerous class of assertion bug: **validate untrusted input with error handling; assert internal invariants.** An always-on `CHECK` that is reachable from attacker-controlled input is not a safety net — it is a **remote denial-of-service primitive**. Any input that violates the check crashes the process, and an attacker who finds it can crash your process on demand, repeatedly, for free.

The asymmetry is total. An internal invariant ("after this rebalance, the tree is balanced") is something *your own code* is responsible for; if it's false, you have a bug, and crashing is the correct, contained response. An external precondition ("this 4-byte length field is ≤ the remaining buffer") is something *the sender* controls; if it's false, that is a normal, expected event — a malformed or malicious request — and the correct response is to reject it with an error, not to abort.

```cpp
// WRONG — CHECK on a value the network controls. A crafted packet = remote crash.
void Handle(const Packet& p) {
  CHECK_LE(p.length, p.payload.size());   // attacker sets length > payload → abort()
  ...
}

// RIGHT — validate at the boundary, return an error; assert only what YOU guarantee.
absl::Status Handle(const Packet& p) {
  if (p.length > p.payload.size())
    return absl::InvalidArgumentError("length exceeds payload");   // untrusted → error
  Frame f = Decode(p);
  DCHECK_EQ(f.size(), p.length);   // internal: Decode must honor length. Our bug if not.
  ...
  return absl::OkStatus();
}
```

The problem at scale is that the boundary is rarely one function deep. A value validated at the edge is passed through ten layers, and somewhere in the middle a `CHECK` re-asserts a property of it — except a different code path reaches that `CHECK` *without* having gone through validation. This is why "assert vs validate" must be **audited**, not just taught:

```bash
# First-pass audit: every CHECK/abort reachable from a request handler is suspect.
# Find the asserts, then ask of each: can untrusted input reach this?
grep -rnE '\bCHECK(_[A-Z]+)?\b|abort\(\)|LOG\(FATAL\)' src/ \
  | grep -vE '_test\.|/testing/'

# In Go: panics that escape to no recover boundary are the equivalent.
grep -rnE '\bpanic\(' --include='*.go' . | grep -vE '_test\.go'
```

The serious version of this audit is not a grep — it is **a fuzzer plus a sanitizer reachability check**: feed untrusted entry points with a coverage-guided fuzzer (see Core Concept 6 and [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md)) and treat any `CHECK`/abort it reaches *from a network input* as a DoS finding, the same severity as a crash from ASan ([01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md)).

> **The security reality:** an always-on assertion on untrusted input is a CVE waiting to be filed — "remote unauthenticated denial of service." The rule "validate input, assert invariants" is not style; it is the boundary between a robust server and one your worst user can turn off. Enforce it with a fuzzer aimed at every untrusted entry point, and treat a reachable abort as a security finding, not a robustness nicety.

---

## Core Concept 3 — Crash Granularity and Blast Radius

"Fail fast" is correct advice with a missing parameter: *fail fast at what granularity?* When a `CHECK` fires, something dies. The professional decision is **what** dies — and the answer is dictated by your architecture, because the same assertion has wildly different blast radii depending on the unit it takes down.

The blast-radius math is the whole game:

- **One request fails** (recoverable at the handler): you serve one 500, the user retries, capacity is untouched. Cheap.
- **One process aborts:** you lose that process's in-flight requests and its share of capacity until a supervisor restarts it. Survivable if it's rare and the fleet is large.
- **Every process aborts, repeatedly** (a **crash-loop**): the assertion fires on a condition that's present fleet-wide — a poison message in a shared queue, a bad config, a corrupt record everyone reads. Now your "fail fast" has converted a latent bug into a **full outage**, and the restart machinery makes it *worse* by feeding the poison back in.

This is why granularity must match architecture:

```go
// Go: a panic kills the WHOLE process by default — wrong granularity for a server.
// The recovery boundary belongs at the per-request edge, NOT swallowed everywhere.
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if v := recover(); v != nil {
            // Convert a panic into a 500 for THIS request; the process lives on
            // to serve every other request. Log it as a first-class signal (CC5).
            metrics.PanicTotal.Inc()
            log.Printf("panic recovered in handler: %v\n%s", v, debug.Stack())
            http.Error(w, "internal error", 500)
        }
    }()
    s.dispatch(w, r)   // a bug here crashes one request, not the fleet
}
```

> The recover boundary is a **single, deliberate seam** — the RPC/HTTP handler, or the goroutine/worker boundary — not a `defer recover()` sprinkled in every function. Swallowing panics everywhere is worse than crashing: it hides the bug *and* keeps running on corrupt state. Catch once, at the granularity you chose, log it loudly, and re-raise the design question if it fires often.

The architectural lever is **crash-only / let-it-crash**. Erlang/OTP's entire model is millions of cheap processes, each of which is *supposed* to die on a bad invariant, with a supervisor restarting it from known-good state. Candea & Fox's "crash-only software" generalizes this: if the only way to stop is to crash, and the only way to start is to recover, then crashing is a *normal* operation, not an emergency. In that world, a `CHECK` at actor granularity is the correct, contained response — the blast radius is one actor, and the supervisor heals it. The same `CHECK` inside a single shared monolith process is a catastrophe, because the granularity is the whole world.

The defense against the crash-loop — when you *do* run at process granularity — is to **rate-limit the abort**: don't let an assertion that's true fleet-wide take down the fleet faster than you can react.

```cpp
// Don't crash-loop on a fleet-wide condition. Sample/rate-limit the fatal path
// so a poison input degrades, then alerts, instead of vaporizing all capacity at once.
if (ABSL_PREDICT_FALSE(!invariant)) {
  LOG_EVERY_N_SEC(ERROR, 1) << "invariant violated, sampling before fatal";
  if (fatal_budget.Acquire())   // token bucket: e.g. allow N aborts/min/host
    LOG(FATAL) << "invariant violated";
  else
    return DegradeGracefully();  // drop the request, keep the process alive
}
```

> **The blast-radius principle:** the right granularity for fail-fast is the *smallest unit that contains the corruption*. Per-request or per-actor recovery turns a bug into a blip; whole-process abort at fleet scale, with no rate limit and an eager restarter, turns the same bug into an outage. Choose the granularity from your architecture, put the recovery boundary at exactly one seam, and rate-limit the fatal path so a fleet-wide condition can't crash-loop you faster than you can roll back.

---

## Core Concept 4 — Rolling Out a New Always-On CHECK

Adding a new `CHECK` to running production code is a **deploy of a new way for the process to die**. If the invariant you're asserting is *already being violated in production* — which is exactly the latent-bug case you're trying to surface — then turning it into an always-on abort and shipping it fleet-wide means every host that hits the latent violation now crashes *on the same deploy*. You have converted a silent, tolerated bug into a synchronized, fleet-wide outage, triggered by your own rollout.

The discipline is to **ramp a new invariant the way you ramp a feature flag**: observe before you enforce, and canary before you go wide.

```cpp
// Stage 1 — LOG ONLY. Ship the check as a non-fatal counter+log. Learn whether
// the invariant actually holds in prod, on real traffic, with zero availability risk.
if (ABSL_PREDICT_FALSE(!invariant)) {
  LOG_EVERY_N_SEC(WARNING, 10) << "would-fail invariant (log-only): " << context;
  metrics::InvariantViolation("foo_le_bar").Increment();   // dashboard this
}

// Stage 2 — SAMPLE / CANARY. Once the dashboard reads zero on stable traffic,
// make it fatal in the canary build only (DCHECK-style) or behind a flag at 1%.
DCHECK(invariant);                       // fatal in canary, still log-only in prod
// or: if (FLAGS_enforce_foo && !invariant) LOG(FATAL) << ...;   // 1% of fleet

// Stage 3 — ENFORCE. After canary is clean for long enough to cover the rare
// paths (peak traffic, the monthly batch job, the leap-second), promote to CHECK.
CHECK(invariant);
```

The reason this ladder is non-negotiable at scale is that **production traffic contains paths your tests and your canary never exercised on day one**: the once-a-month reconciliation job, the one customer with a 200 MB request, the retry storm during a partial outage. A `CHECK` promoted straight to enforce can be clean for a week and then abort the whole fleet when the monthly job runs. Log-only first means the *worst* outcome of a wrong invariant is a noisy dashboard, not a SEV. Sampling/canary next means even a fatal mistake is contained to a fraction of capacity behind a flag you can flip back in seconds.

> **The rollout principle:** never let a deploy be the first time an invariant is enforced in production. Ship it **log-only → sample/canary → enforce**, gated behind a flag you can disable without a rebuild, and only promote to always-on `CHECK` once the would-fail counter has read zero across the rare, high-traffic, and batch paths. A new `CHECK` is a new abort; treat introducing one with the same caution as any change that can crash the fleet.

---

## Core Concept 5 — Assertion Failures as First-Class Telemetry

An assertion that fires and is never seen is a debugging tool wasted. At fleet scale, an assertion failure is a **signal** — arguably your highest-quality bug signal, because it pinpoints the exact invariant and the exact line — and it deserves the same pipeline as any other production telemetry: capture, symbolize, dedup, alert, dashboard.

The pipeline has distinct stages, and each one is a place teams leave value on the floor:

- **Capture** — a `CHECK`/abort must emit a *structured crash report*, not just a line in a log that scrolls away. Stack trace, the failed condition, the values (`CHECK_EQ` prints both sides), build ID, host, and a few breadcrumbs of context. Wire `abort()`/`LOG(FATAL)` to a crash-reporting handler (Crashpad/Breakpad, Sentry, your in-house equivalent).
- **Symbolize** — a release stack trace is raw addresses until you resolve it against the build's debug symbols. Keep symbol files keyed by build ID so any crash from any version resolves to file:line automatically.
- **Dedup** — ten thousand hosts hitting the same `CHECK` is *one* bug, not ten thousand pages. Cluster by the failing assertion's location + normalized stack so the signal is "this invariant fired N times across M hosts," not a pager flood.
- **Alert and dashboard** — assertion-failure rate is a SLI. A spike in `CHECK` failures after a deploy is a rollback trigger. A nonzero would-fail counter from a Stage-1 rollout (Core Concept 4) is a "do not promote" gate.

```text
ASSERTION TELEMETRY DASHBOARD (per build, per assertion site)
  ────────────────────────────────────────────────────────────
  CHECK failures (prod, fatal)        rate, by site, by build → page on spike
  DCHECK fired (canary, fatal)        any nonzero = latent bug found in canary
  would-fail counters (log-only)      Stage-1 rollouts; must read 0 before enforce
  panic recovered (per-request)       Go recover-boundary hits; trend = code health
```

The "DCHECK fired in canary" dashboard is one of the highest-leverage artifacts you can build. Because `DCHECK`s are compiled into canary but not prod, a `DCHECK` firing in canary is a **latent bug caught before it reached the fleet** — a real invariant violation that production would have silently tolerated (or eventually corrupted on). Teams that watch this dashboard turn their canary fleet into a continuous invariant-violation detector running against real traffic shapes, and they find bugs weeks before those bugs would have surfaced as mysterious corruption in prod.

> **The observability principle:** treat an assertion failure as a first-class production event, not a log line. Symbolized, deduped crash reports with the failed condition and operands turn "something crashed" into "this exact invariant broke here, N times, starting at this build." Dashboard the would-fail and DCHECK-in-canary counters and they become your latent-bug radar — assertion telemetry is how you find the bugs *before* they find your data.

---

## Core Concept 6 — Assertions as a Force Multiplier and the Verification Ladder

The highest-leverage reason to invest in rich assertions has nothing to do with production aborts at all: **assertions are oracles for fuzzing and property testing.** A fuzzer's only signals are crash, hang, and sanitizer-trip. An invariant-rich program *manufactures crashes on logic bugs* — every `CHECK`/`assert` is an additional way for the fuzzer to detect that something went wrong, even when the bug would never have crashed on its own. You are turning silent logic errors into loud, fuzzer-visible failures.

The mechanism is direct. A parser that merely returns wrong-but-not-crashing output gives a fuzzer nothing to latch onto. The same parser with `CHECK`s on its internal invariants — "after decode, offset ≤ length," "the reconstructed structure round-trips" — fails *loudly* the instant the fuzzer drives it into an inconsistent state. The richer the invariants, the denser the oracle, the more bugs per CPU-hour the fuzzer finds. This is why "invest in invariants → fuzzers find more" is one of the highest-ROI moves available, and why it cross-links directly to [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md): the same assertions you write for correctness become the oracle that makes coverage-guided fuzzing effective.

There is one critical interaction with Core Concept 2. *In the fuzzer*, you want assertions to fire on bad input — that's the bug being found. *In production*, you must not let untrusted input reach an abort. The resolution is the trust-boundary rule applied with discipline: assert internal invariants (the fuzzer drives those via valid-then-mutated paths), validate external preconditions with errors (so prod is safe), and let the fuzzer hammer the validator's error paths *and* the internal asserts behind it.

The same invariant work places a component on the **runtime-contract ↔ formal-verification ladder**. For most code, a runtime `CHECK` is the right rung — cheap, dynamic, catches violations on real executions. For genuinely critical components — a consensus protocol, a crypto primitive, an allocator, a bytecode verifier — you climb:

| Rung | Mechanism | What it buys | Cost |
|---|---|---|---|
| Runtime contract | `CHECK`/`DCHECK` on invariants | Catches violations *on paths actually executed* | Cheap; reactive |
| Property-based testing | Invariants checked over generated inputs | Violations over a *sampled* input space | Moderate |
| Fuzzing with assertions | Coverage-guided inputs + assertion oracle | Violations over a *coverage-maximizing* space | Moderate; needs corpus |
| Formal verification | Machine-checked proof of the invariant | Violation is *impossible*, all inputs | Expensive; specialist |

The rungs share a vocabulary: **the invariant you write as a `CHECK` is the same property you'd state as a `@requires`/`@ensures` contract, the same property a fuzzer treats as an oracle, and the same property a prover discharges.** Writing it down once as an executable assertion is the entry fee for every rung above. See [Formal Methods & Verification](../../formal-methods-and-verification/) for when a component earns the climb.

> **The force-multiplier principle:** assertions are not only safety nets — they are oracles. Every internal invariant you encode makes your fuzzer find more bugs per CPU-hour and stands as the first, cheapest rung of a verification ladder that tops out at machine-checked proof. The same sentence — "after decode, offset ≤ length" — is a `CHECK`, a property test, a fuzz oracle, and a proof obligation. Write it down once and it pays off four ways.

---

## War Stories

**The DCHECK that shipped as a no-op.** A storage team had a sanity check on their serializer: after encoding a record, decode it and assert the round-trip matched. They wrote it as `DCHECK` — "expensive, only need it in debug." A refactor introduced a path that wrote a length field in the wrong byte order for one rare record type. The `DCHECK` was correct and *would have caught it on the very first such record* — but it was compiled out of the release build, so for three weeks the service quietly persisted corrupt records that read back as garbage. The post-mortem's one-line fix was changing `DCHECK` to `CHECK` for the round-trip check (the cost was a few microseconds per write, dwarfed by the disk I/O). The *lesson* was that the most valuable invariant — "we are not persisting corrupt data" — is exactly the one that must run in production, not the one to compile away for being "expensive."

**The CHECK that became a remote DoS.** A service parsing a binary wire format had `CHECK_GE(remaining, field_len)` deep in its decoder — an invariant the author assumed held because "the caller validates length." A different RPC path reached the decoder without that validation, with `field_len` straight from the wire. A single crafted packet, sendable by any unauthenticated client, drove `remaining < field_len` and aborted the process. An attacker could crash any host on demand. It was filed as a remote-DoS CVE. The fix was to convert the boundary check to an error-return and demote the deep check to a `DCHECK` of the *internal* contract. The standing change was a fuzzer aimed at every RPC entry point in CI, with any reachable abort treated as a release-blocking security finding.

**The new CHECK that crash-looped prod.** An engineer added `CHECK(account.balance >= 0)` — a sensible-looking invariant — and shipped it straight to enforce, fleet-wide. It turned out a long-standing accounting bug left a small population of accounts with transiently negative balances during a specific settlement window. The deploy was fine for six days. Then the nightly settlement job ran, every host that touched an affected account aborted, the scheduler restarted them, they re-read the same accounts and aborted again — a fleet-wide crash-loop, self-inflicted by an otherwise-correct assertion. Rollback took twenty minutes because the check was baked into the binary, not behind a flag. The new house rule came directly out of this: every new always-on `CHECK` ships **log-only → canary → enforce**, behind a flag you can flip without a rebuild, and you don't promote until the would-fail counter has read zero across a full settlement/batch cycle.

**The let-it-crash service that shrugged off a corruptor.** Two services hit the same data-corrupting bug in a shared library on the same day. The monolith — one big process, panics swallowed by a top-level `recover` that logged and continued — kept running on corrupt in-memory state and served wrong answers until someone noticed hours later; recovery meant a careful restart and data repair. The Erlang/OTP-style service ran the same logic in per-request actors with a supervisor; the bad invariant crashed *the one actor handling the bad input*, the supervisor restarted it from clean state, the next request succeeded, and the only visible symptom was a blip on the per-actor-crash dashboard. Same bug, same day; one was a SEV and a data-repair project, the other was a graph that ticked up by one. The difference was crash *granularity* and a supervisor that treated crashing as normal.

**The assertion-rich module the fuzzer tore through.** A team rewrote a format parser and, on the new house policy, instrumented it densely with internal `CHECK`s — offset bounds, structural consistency, round-trip equality — while keeping all *external* validation as error-returns. They pointed a coverage-guided fuzzer at the (safe, error-returning) entry point. Within a weekend the fuzzer found roughly twenty distinct bugs, almost none of which crashed on their own — they were silent logic errors that the *internal asserts* turned into loud, attributable failures the fuzzer could see. The old parser, with the same code paths but no internal invariants, had been fuzzed before and surfaced almost nothing, because there was no oracle to make the bugs visible. The invariants didn't just protect production; they were what made the fuzzer effective.

---

## Decision Frameworks

**CHECK vs DCHECK vs error-return — pick by who is responsible and what continuing costs:**

| Condition | Who controls it | Continuing on violation | Use |
|---|---|---|---|
| Untrusted input is malformed | The sender (attacker) | Normal, expected | **error-return** (never abort) |
| Internal invariant, cheap, corruption-imminent | Your code | Corrupts data / serves wrong results | **CHECK** (always-on) |
| Internal invariant, safety/security-critical | Your code | Unsafe to proceed | **CHECK** (always-on) |
| Internal invariant, expensive to verify | Your code | Bad but tolerable briefly | **DCHECK** (canary only) |
| "Should never happen" but cheap and harmless if it does | Your code | Survivable | **CHECK** if cheap; else DCHECK |

**Crash granularity by architecture — match the dying unit to the blast radius you can absorb:**

| Architecture | Right granularity | Recovery boundary | Notes |
|---|---|---|---|
| Erlang/OTP, actor model | Per-actor crash | Supervisor restarts actor | Crash is normal; assert freely at actor scope |
| Go service, goroutine-per-request | Per-request | `recover()` at the handler seam | One recover boundary, not everywhere |
| Stateless replicated service | Per-process abort | Orchestrator restarts pod | OK *if* rate-limited so it can't crash-loop |
| Shared monolith, in-memory state | Avoid process abort | Convert to error + alert | A process abort = the whole world; corruption survives a sloppy recover |
| Batch/data pipeline | Per-record (quarantine) | Dead-letter the poison record | A poison record must not abort the whole job |

**Rolling out a new always-on assertion safely — the mandatory ladder:**

| Stage | Behavior | Promote when |
|---|---|---|
| 1. Log-only | Count + log, never fatal | Would-fail counter reads 0 on stable prod traffic |
| 2. Sample / canary | Fatal in canary or 1% behind a flag | Canary clean across rare + peak + batch paths |
| 3. Enforce | Always-on `CHECK`, flag still present | Clean for a full business cycle; keep the kill-switch flag |

**Assert vs validate by input trust boundary — the one rule, spelled out:**

| Data origin | Treat as | On violation |
|---|---|---|
| Network / RPC payload from clients | Untrusted | Validate → return error |
| User-supplied file / config | Untrusted | Validate → return error |
| Cross-service RPC (your own fleet) | Semi-trusted | Validate at the edge, `DCHECK` internally |
| Values your own code just computed | Trusted (your invariant) | `CHECK`/`DCHECK` — a violation is your bug |
| Compile-time constants / enums | Trusted | `static_assert` where possible |

---

## Mental Models

- **An always-on assertion is a deploy of a new way to die.** A `CHECK` is not free insurance — it's a production abort condition. Decide deliberately whether *this* invariant earns the right to halt a process, and roll it out like any other change that can crash the fleet.

- **`CHECK` for your bugs, error-return for their inputs.** The trust boundary is the whole rule. An invariant *you* guarantee may abort on violation; a precondition the *sender* controls must be an error. A `CHECK` reachable from untrusted input is a remote off-switch.

- **Fail fast at the smallest unit that contains the corruption.** Per-request or per-actor recovery turns a bug into a blip. Whole-process abort at fleet scale, with an eager restarter and no rate limit, turns the same bug into an outage. Granularity is the decision.

- **Crashing is a normal operation, if you designed for it.** In a crash-only / let-it-crash architecture, a `CHECK` at actor granularity with a supervisor is *correct* — the blast radius is one actor. The same `CHECK` in a shared monolith is a catastrophe. The assertion didn't change; the granularity did.

- **An invariant is a `CHECK`, a fuzz oracle, and a proof obligation — written once.** The same sentence pays off as a runtime check, as the thing that makes your fuzzer find bugs, and as the property a prover discharges for critical code. Investing in invariants is investing in every rung of the verification ladder at once.

---

## Common Mistakes

1. **Compiling out the highest-value checks.** Writing the round-trip / no-corruption invariant as `DCHECK` "because it's expensive" strips it from production — exactly where the weird inputs live. The checks most worth running are the ones you want firing in prod, not only in test. Default safety/correctness invariants to `CHECK`.

2. **`CHECK`-ing untrusted input.** An always-on assertion reachable from network/user input is a remote DoS. Validate at the boundary with error-returns; reserve aborts for internal invariants. Audit it with a fuzzer, and treat a reachable abort as a security finding.

3. **Shipping a new `CHECK` straight to enforce, fleet-wide.** If the invariant is already being violated in prod, the deploy that enforces it crash-loops the fleet. Ramp log-only → canary → enforce, behind a kill-switch flag, and don't promote until the would-fail counter reads zero across batch and peak paths.

4. **`recover()` / catch-everywhere that swallows panics.** A panic absorbed in every function hides the bug *and* keeps running on corrupt state — worse than crashing. Put exactly one recovery boundary at the request/worker seam, log loudly, and re-raise the design question if it fires often.

5. **Process-granularity abort in a shared monolith.** When one process holds the whole world's state, a `CHECK` that aborts it is maximum blast radius, and a sloppy top-level recover lets corruption survive. Either move to recoverable per-request granularity or convert the check to an error-plus-alert.

6. **Treating assertion failures as log lines.** An abort that emits an unsymbolized line nobody dashboards is a wasted signal. Wire `LOG(FATAL)`/`abort()` to structured, symbolized, deduped crash reports; dashboard the would-fail and DCHECK-in-canary counters as your latent-bug radar.

7. **Not rate-limiting the fatal path on fleet-wide conditions.** A poison message in a shared queue plus an eager restarter equals a crash-loop. When you do abort at process granularity, gate the fatal path behind a token bucket so a fleet-wide condition degrades and alerts instead of vaporizing all capacity at once.

---

## Test Yourself

1. State the one-line rule that decides whether a given condition should be a `CHECK`, a `DCHECK`, or an error-return. Give an example that belongs in each bucket.
2. Why is an always-on `CHECK` on a length field taken from a network packet a security bug, and what's the correct construction instead?
3. A team writes their serializer's round-trip sanity check as `DCHECK`. Explain the failure mode this invites in production and the one-character (conceptually) fix.
4. You're adding `CHECK(balance >= 0)` to a payments service. Describe the rollout that avoids crash-looping the fleet, and the specific signal that gates each promotion.
5. The same bug hits a shared monolith and an Erlang/OTP-style service on the same day. Explain why one becomes a SEV and the other a dashboard blip, in terms of crash granularity and supervision.
6. In Go, where does the `recover()` boundary belong for an HTTP server, and why is `defer recover()` in every function an anti-pattern?
7. Explain why a parser densely instrumented with internal `CHECK`s lets a fuzzer find more bugs than the identical parser without them — and how you keep that instrumentation from being a production DoS.

<details>
<summary>Answers</summary>

1. **Rule:** assert what *your own code* guarantees; return an error for anything *outside your trust boundary* or that can legitimately happen; use `DCHECK` for internal invariants too expensive to verify on every prod call. **CHECK:** `CHECK(index < buffer.size())` before a write (your invariant, corruption-imminent). **DCHECK:** `DCHECK(IsSorted(v))` (your invariant, O(n) — too costly for prod). **error-return:** rejecting a malformed request field (the sender controls it).
2. The sender controls the length field, so a crafted value that violates the `CHECK` aborts the process — a remote, unauthenticated denial of service any client can trigger at will. Correct construction: **validate the length at the boundary and return an error** (`if (len > remaining) return InvalidArgumentError(...)`), and demote any deep check to a `DCHECK` of the *internal* contract that decode honored the validated length.
3. `DCHECK` is compiled out of release builds, so the round-trip check — the one invariant that proves "we are not persisting corrupt data" — never runs in production. A serializer bug then ships corrupt records silently until they're read back as garbage, possibly weeks later. Fix: make it a **`CHECK`** (a few microseconds per write is dwarfed by the I/O, and catching corruption before it's durable is worth it).
4. **Stage 1 log-only:** ship it as a non-fatal counter+log; gate promotion on the would-fail counter reading **zero on stable prod traffic**. **Stage 2 canary/sample:** make it fatal in canary or at 1% behind a flag; gate on the canary being clean across **rare, peak, and batch** paths (notably a full settlement cycle). **Stage 3 enforce:** promote to always-on `CHECK`, keeping the kill-switch flag so you can disable it without a rebuild. The signal gating each step is the would-fail/DCHECK-failure rate dropping to zero on the relevant traffic.
5. The monolith is one process holding all state; a panic either aborts the whole world or (with a swallow-everything recover) keeps serving on corrupt state — both are SEVs, and recovery means a careful restart plus data repair. The OTP-style service runs per-request actors under a supervisor: the bad invariant crashes **one actor**, the supervisor restarts it from clean state, the next request succeeds, and the symptom is a per-actor-crash counter ticking up by one. Same bug; the difference is **crash granularity** (one actor vs the whole process) and **supervision** (crash treated as normal and healed automatically).
6. The `recover()` boundary belongs at the **per-request handler seam** (and at any goroutine you spawn, since a panic in a goroutine with no recover crashes the whole process). That converts a panic into a 500 for one request while the process keeps serving everyone else. `defer recover()` in every function is an anti-pattern because it **swallows the bug everywhere** — hiding the signal *and* continuing to run on corrupt state, which is worse than a clean crash. Catch once, log loudly, re-raise the design question if it's frequent.
7. A fuzzer's signals are crash/hang/sanitizer-trip; a silent logic bug produces wrong-but-not-crashing output it can't detect. Internal `CHECK`s **turn logic errors into crashes the fuzzer can see** — every invariant is an extra oracle, so more bugs surface per CPU-hour. You keep it safe in production by obeying the trust boundary: assert *internal* invariants (the fuzzer reaches them via valid-then-mutated inputs) but **validate external input with error-returns**, so the same code that's a rich oracle under fuzzing is not a remote abort in prod.

</details>

---

## Cheat Sheet

```text
THE THREE BUCKETS
  CHECK   always-on, aborts in prod   → invariant where continuing is worse than crashing
  DCHECK  canary/debug only           → expensive internal check; free in prod (compiled out)
  error   not an assertion            → anything that CAN happen, esp. across a trust boundary
  RULE: assert YOUR invariants; return errors for THEIR inputs

TRUST BOUNDARY (the security rule)
  untrusted input (network/user/file)  → VALIDATE → return error   (never CHECK)
  internal invariant (you computed it)  → CHECK / DCHECK            (a violation is your bug)
  CHECK reachable from untrusted input  = remote DoS / CVE
  audit:  grep -rnE 'CHECK|abort\(\)|LOG\(FATAL\)' src/   +   fuzz every entry point

CRASH GRANULARITY (blast radius)
  per-request / per-actor recovery  → bug = blip      (recover at ONE seam)
  whole-process abort, fleet-wide   → bug = outage    (rate-limit the fatal path)
  Go:  defer recover() at the HANDLER, not in every function
  let-it-crash + supervisor → crash is NORMAL, blast radius = one actor

ROLL OUT A NEW CHECK (never enforce on first deploy)
  Stage 1  log-only   → would-fail counter must read 0
  Stage 2  canary/1%  → clean across rare + peak + BATCH paths
  Stage 3  enforce    → keep a kill-switch flag (disable without rebuild)

ASSERTIONS AS TELEMETRY
  abort → structured crash report (cond + operands + stack + build id)
  symbolize by build id · dedup by site · alert on rate spike post-deploy
  watch:  DCHECK-in-canary (latent bug found) · would-fail counters (don't promote)

FORCE MULTIPLIER + LADDER
  rich internal invariants → fuzzer finds MORE bugs (asserts = oracle) → see 05
  runtime CHECK → property test → fuzz-with-asserts → formal proof (critical only)
```

---

## Summary

- The first artifact is a **house assertion policy**, not a clever check: every condition goes in one of three buckets — `CHECK` (always-on, for invariants where continuing is worse than crashing), `DCHECK` (canary-only, for expensive internal checks), or error-return (for anything that can legitimately happen). The cost of an always-on `CHECK` is one predictable branch; the benefit is catching corruption before it propagates. Default your safety- and correctness-critical invariants to `CHECK`, not `DCHECK`.
- **Validate untrusted input, assert internal invariants.** A `CHECK` reachable from network or user input is a remote denial-of-service primitive — a CVE in waiting. Reserve aborts for properties *your* code guarantees; reject external violations with errors; audit the boundary with a fuzzer aimed at every entry point and treat any reachable abort as a security finding ([01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md), [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/professional.md)).
- **Fail fast at the smallest unit that contains the corruption.** Per-request or per-actor recovery turns a bug into a blip; whole-process abort at fleet scale with an eager restarter turns it into a crash-loop outage. Put the recovery boundary at exactly one seam (Go `recover()` at the handler), embrace let-it-crash with a supervisor where you can, and rate-limit the fatal path so a fleet-wide condition can't crash-loop you.
- **Never let a deploy be the first time an invariant is enforced.** Roll out a new always-on `CHECK` **log-only → sample/canary → enforce**, behind a kill-switch flag, and promote only once the would-fail counter reads zero across rare, peak, and batch paths.
- **Treat assertion failures as first-class telemetry** — structured, symbolized, deduped crash reports with the failed condition and operands; dashboard the would-fail and DCHECK-in-canary counters and they become your latent-bug radar.
- **Assertions are a force multiplier and a verification ladder.** Rich internal invariants make fuzzers find far more bugs per CPU-hour ([05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md)), and the same invariant you write as a `CHECK` is the property a prover discharges for your most critical components ([Formal Methods & Verification](../../formal-methods-and-verification/)).

You can now operate runtime assertions as an org-level availability, security, and incident-response policy — not a per-developer habit. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands all of this.

---

## Further Reading

- [abseil — `CHECK`, `DCHECK`, and logging documentation](https://abseil.io/docs/cpp/guides/logging) — the canonical always-on vs debug-only assertion split and the rationale behind it.
- [Chromium — `CHECK`, `DCHECK`, and `NOTREACHED`](https://chromium.googlesource.com/chromium/src/+/main/docs/security/check_failures.md) — a real codebase's policy, including treating `CHECK` failures as crashes to triage and the security framing of asserts on untrusted input.
- George Candea & Armando Fox, *Crash-Only Software* (HotOS 2003) — the foundational argument that crashing and recovery should be the only ways to stop and start.
- [Erlang/OTP — "Let it crash" and supervision principles](https://www.erlang.org/doc/design_principles/sup_princ.html) — the actor + supervisor model that makes per-process crashing a normal operation.
- *Site Reliability Engineering* (Google, O'Reilly) — chapters on canarying releases, error budgets, and graceful degradation that frame the rollout and blast-radius discipline here.
- John Regehr, "Assertions Are Pessimistic, Assumptions Are Optimistic" — on the semantics of assertions, `__builtin_unreachable`, and the line between checking and assuming.
- [`interview.md`](interview.md) — the consolidated question bank for this topic.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md) — the memory-safety oracle that pairs with assertions; a sanitizer trip and a reachable abort are the same class of fuzzer signal.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/professional.md) — runtime checks for UB that complement hand-written contracts.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md) — where assertions pay off as fuzzing oracles; invest in invariants, find more bugs.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — the top of the runtime-contract-to-proof ladder for genuinely critical components.
- [Testing](../../testing/) — property-based testing and the broader correctness-signal toolkit that assertions feed into.
