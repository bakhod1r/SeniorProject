# Strangler at the Code Level — Optimize

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

Each scenario presents a "before" situation. Your job is to design the strangler slicing plan — or argue that a direct cutover is the better engineering call. The skill being exercised is *judgment*: where to cut, in what order, and when not to bother.

---

## Scenario 1 — The 900-line god-class

**Before:** `OrderManager` has 900 lines and eight responsibilities: validation, pricing, inventory reservation, payment, fulfillment, notification, audit logging, and analytics. Callers reach it from 30 places. You need to replace pricing and payment with a new design; the rest is fine.

**Design the plan.**

<details><summary>Model answer</summary>

Don't strangle the whole class — strangle the two responsibilities you're replacing, by behavior.

1. **Seam.** Route all 30 callers through an `OrderService` facade with `OrderManager`'s API. One mechanical pass; behavior unchanged.
2. **Isolate the targets.** Extract `pricing` and `payment` into their own methods/objects behind the facade (a Move-Method refactor) so each is independently routable. The other six responsibilities stay put — they're not being replaced, so don't touch them.
3. **Slice 1: pricing (read-ish, lower risk).** Build the new pricer, diff-test on production orders, shadow read-only, canary ramp behind `order.new-pricing`.
4. **Slice 2: payment (writes, high risk, last).** After pricing is at 100% and the machinery is proven, migrate payment. Payment has side effects, so do *not* shadow the real charge — shadow only the pure amount calculation; canary the actual charge with deploy-free rollback and single-writer ownership of any shared balance/state.
5. **Delete** the old pricing and payment code after tombstone-and-wait; leave the other six responsibilities alone.

The optimization is *scope*: strangle only what's being replaced, slice by behavior, riskiest (payment) last.

</details>

---

## Scenario 2 — The trivial utility

**Before:** A 40-line `PhoneNumberNormalizer` with 100% test coverage, no shared state, called from 8 places. Product wants a new normalization algorithm.

**Strangle or cut over?**

<details><summary>Model answer</summary>

**Cut over.** The strangler's machinery (seam, flag, shadow, diff metrics, ramp, tombstone) dwarfs the 40 lines and buys nothing here:

- Full test coverage means CI catches regressions on a straight swap — no need for production shadowing.
- No shared mutable state, so the multi-writer hazard doesn't exist.
- 8 callers, 40 lines — one reviewed commit keeps the build green and `git revert` is the rollback.

Write the new normalizer behind the existing tests, swap, delete the old one. One PR. Using a strangler here is over-engineering: it adds carrying cost and routing complexity to replace a tiny, well-protected, side-effect-free unit.

</details>

---

## Scenario 3 — The shared-state calculation engine

**Before:** `LedgerEngine` computes balances and posts journal entries. Old and new versions both read and write the same in-memory `Account.balance` and the same `Journal`. You must replace the posting logic.

**Design the plan, focusing on shared state.**

<details><summary>Model answer</summary>

The risk is state corruption, not just wrong outputs. Make purity the precondition.

1. **Seam at the posting boundary**, taking explicit inputs (account snapshot, entries) rather than reading ambient `Account`/`Journal`.
2. **Refactor both old and new to be pure**: each *computes* the resulting balance and the entries to post, returning them; neither writes `Account.balance` or `Journal` directly.
3. **Single-writer commit.** The seam takes the chosen result and performs the one write. Now there's exactly one writer of `balance` and one appender to `Journal`, regardless of which path computed.
4. **Shadow on a copy** if any computation still mutates internally: give the new path a deep copy of the account/journal state, compare the resulting state to the real one, discard the copy.
5. **Canary the write** with deploy-free rollback; ensure rollback is state-safe (because the old path can read everything the new path wrote — guaranteed by the single-writer commit).
6. **Delete** after tombstone-and-wait spanning a month-end close (the rare, heavy path).

**Escalation clause:** if old and new genuinely cannot both avoid writing `balance` simultaneously and neither can be made pure, the strangler is unsafe at any instant — cut over behind a single hard switch instead.

</details>

---

## Scenario 4 — No stable seam

**Before:** A legacy reporting module's logic is sprayed across 15 files with no entry point — callers reach into its internals directly, in different ways, all over the codebase. You want to replace it.

**Strangle or cut over, and how?**

<details><summary>Model answer</summary>

You can't strangle without a choke point, and right now there isn't one. Two honest options:

**Option A — build the seam first (then strangle).** The first project is *creating* a single entry point: introduce a facade and migrate the 15 files of direct-internal access to go through it. Use the Mikado Method (sibling 03) to map the "I can't move this until I move that" dependencies, since the access is tangled. Only once the seam exists and all callers pass through it can you divert slices. Choose this if the module is high-risk or hard to test — the seam work pays off.

**Option B — characterize and cut over.** If the module is small enough, pin its current behavior with characterization tests (capturing real input/output), then replace it wholesale and rely on those tests. Choose this if building the seam is most of the work anyway and the module isn't enormous.

The trap to avoid: faking a partial seam that only some callers use — that gives untrustworthy parity (see find-bug Scenario 6). Either the seam is a true choke point or you cut over.

</details>

---

## Scenario 5 — The long-tail migration

**Before:** You've been strangling a `RatingEngine` for five months. The five easy slices are at 100%, but three gnarly slices (cross-product discounts, grandfathered legacy plans, regulatory edge cases) remain on the old path. The area gets frequent feature changes, each now done twice.

**What's the optimization?**

<details><summary>Model answer</summary>

This is heading for the 80% trap: indefinite double-maintenance with no end date, and a high change rate means the carrying cost is large and growing. Optimize by *forcing a decision*, not drifting.

1. **Re-evaluate the remaining three slices' economics.** For each, estimate the remaining migration effort vs the ongoing double-maintenance cost. If finishing is cheaper than carrying, finish — put a hard deadline on it.
2. **For any slice that's genuinely too costly to migrate** (e.g., grandfathered legacy plans that are being sunset anyway), consider *keeping it on the old path permanently* and explicitly scoping it out — but only if you can cleanly isolate that slice so the old code it needs is small and frozen, not the whole engine.
3. **Stop the bleeding meanwhile.** Freeze the old path to fixes-only; route all new features through the new engine even for unmigrated slices where feasible.
4. **If none of the remaining slices can be finished or cleanly isolated**, the strangle was the wrong tool for this engine — plan a coordinated cutover of the remaining three behind one switch, with a heavy characterization-test net, and end the dual maintenance.

The point: an unfinished strangle is a liability. Either fund the finish, deliberately and minimally scope-out an isolated remainder, or cut over the rest — but don't let it drift.

</details>

---

## Scenario 6 — Hot-path performance

**Before:** A pricing seam is in the request hot path. Shadowing the new pricer (run synchronously, inline) added 40ms p99 latency, and the team turned shadowing off in frustration — losing their parity signal.

**Optimize the strangler so you keep the parity signal without the latency.**

<details><summary>Model answer</summary>

The mistake is running the shadow *synchronously on the request thread*. Move it off the hot path.

1. **Async shadow.** Submit the new computation to a separate bounded executor; return the authoritative result immediately. The user's request never waits for the shadow.

   ```java
   Result real = legacy.price(req);
   if (flags.isOn("pricing.shadow")) {
       shadowPool.submit(() -> diffLog.compare(req, real, newPricer.price(req)));
   }
   return real;   // no added latency on the hot path
   ```

2. **Bound and shed.** Cap the shadow pool and drop shadow work if the queue is full — the parity signal is sampled, not exhaustive, and must never degrade real traffic. Even shadowing 5% of requests off-thread gives a strong signal.
3. **Keep effects out.** Ensure the shadow path is pure (find-bug Scenario 4) so async double-execution is safe.

Now you keep the diff signal that tells you when to ramp, with zero hot-path cost. Don't trade away your correctness evidence to fix a latency problem caused by *how* you ran the shadow, not by shadowing itself.

</details>

---

## Scenario 7 — Cutover masquerading as a strangle

**Before:** A team set up a full strangler (seam, flag, shadow harness, metrics) for a `CurrencyConverter` change, then flipped the flag from 0% to 100% on day one because "the new code is obviously right." The scaffolding is now dead weight.

**Optimize.**

<details><summary>Model answer</summary>

They built strangler machinery but performed a *cutover* — never ramped, never used the shadow signal. The optimization is to recognize what actually happened and remove the unused scaffolding.

- If the swap was in fact safe (good tests, pure function, instant revert), they should have cut over plainly — and now should **delete the seam, flag, shadow harness, and metrics**, keeping only tests that pin the new behavior. Carrying strangler scaffolding for a change you didn't strangle is pure cost.
- If the swap was *not* obviously safe (it touched a money path with weak tests), the fix is the opposite: roll back to 0%, actually *use* the machinery — diff-test, shadow, canary 1%→100% — and only then tear it down.

Either way, the anti-pattern is *strangler theater*: paying for routing infrastructure you don't exercise. Match the tool to the risk — strangle when you'll use the ramp and the signal; cut over (and skip the scaffolding) when you won't.

</details>
