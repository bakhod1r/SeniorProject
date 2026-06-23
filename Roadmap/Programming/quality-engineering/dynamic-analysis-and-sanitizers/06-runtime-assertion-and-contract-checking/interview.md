# Runtime Assertions & Contracts — Interview Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Runtime Assertions & Contracts
> *An assertions interview rarely asks "what is `assert`." It asks "code review finds `assert(buf = malloc(n))` — what's wrong," and then watches whether you separate programmer error from runtime error, know that `NDEBUG` deletes the line entirely, and can give a non-dogmatic answer to "should we run assertions in production." This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Theme 1 — Fundamentals](#theme-1--fundamentals)
4. [Theme 2 — Language & Mechanics](#theme-2--language--mechanics)
5. [Theme 3 — Production & Policy](#theme-3--production--policy)
6. [Theme 4 — Integration with Tooling](#theme-4--integration-with-tooling)
7. [Theme 5 — Scenario & Debugging](#theme-5--scenario--debugging)
8. [Rapid-Fire Round](#rapid-fire-round)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **programmer error vs runtime condition** (a bug in *your* code vs something the world legitimately does)
- **assert vs error-return/exception** ("can't happen" vs "expected to happen sometimes")
- **debug-only vs always-on** (stripped in release vs ships and runs in prod — `assert`/`DCHECK` vs `CHECK`)
- **detecting bad state vs handling bad input** (an invariant you broke vs untrusted data you must validate)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a flag or a code snippet.

---

## Prerequisites

You should be comfortable with:

- Writing and running code in at least one systems language (C/C++/Rust) and one managed language (Java/Python/Go).
- The difference between **compile time** and **run time**, and what a *release build* changes about your binary.
- Basic exception/error-handling models — exceptions, error codes, Go's `error`, Rust's `Result`.
- Why a service crash is sometimes recoverable (supervised restart) and sometimes a customer-facing outage.

If "what does `NDEBUG` do" or "why does Go have no `assert`" is new, read [junior.md](junior.md) first; this page assumes the mechanics and pushes on judgment.

---

## Theme 1 — Fundamentals

### Q1.1 — What is an assertion, and what is it *for*?

> **Testing:** Whether you see an assertion as a checked claim about your own program's state, not as input validation or error handling.

**A.** An assertion is an executable statement of a condition you believe is *always* true at that point — a checked claim about your program's internal state. `assert(index < len)` says "by construction, `index` can never reach `len` here; if it did, my reasoning is wrong." Its purpose is to **catch programmer errors as close to their cause as possible** and convert a silent, corrupting bug into a loud, immediate failure with a precise location. It is *not* for handling things the world is allowed to do — bad user input, a network timeout, a missing file. Those are expected runtime conditions, and the right tool is an error return or exception. The one-line test: *if a correct program with correct inputs could ever trip it, it's not an assertion.*

### Q1.2 — Define design by contract. Who owns the precondition, the postcondition, and the invariant?

> **Testing:** Whether you know contracts assign *blame*, not just check conditions.

**A.** Design by contract (Meyer) frames a function as an agreement between **caller** and **callee**:

- **Precondition** — what must hold when the function is called (`amount > 0`, `list != null`). **The caller owns it.** A violated precondition means the *caller* has a bug.
- **Postcondition** — what the function guarantees on return (`result is sorted`, `balance == old(balance) - amount`). **The callee owns it.** A violated postcondition means the *callee* has a bug.
- **Invariant** — what is always true of an object/data structure between operations (a balanced tree stays balanced; `size <= capacity`). **The type/class owns it**, and every method must preserve it.

The value of the framing is that a violation immediately tells you *whose code to look at*. A precondition trip points at callers; a postcondition trip points at the function itself. That triage is what raw `if`-checks scattered through code don't give you.

### Q1.3 — Explain fail-fast and why it beats letting bad state propagate.

> **Testing:** Whether you understand that the cost of a bug grows with distance from its cause.

**A.** Fail-fast means: the instant you detect that an invariant is broken, stop — crash or throw — rather than continue with corrupt state. The argument is about *distance*. A bug that's caught at its origin gives you a stack trace pointing at the exact line. The same bug allowed to propagate gets laundered through ten more functions, written to a cache, serialized to a database, and surfaces hours later as a nonsensical value with no trace back to the cause. You've traded a five-minute fix for a forensic investigation — and possibly persistent data corruption. Fail-fast is the deliberate choice to pay a small, located cost now instead of a large, dislocated cost later. The corollary: a program that "keeps running" after detecting impossible state isn't robust, it's *lying* about its own correctness.

### Q1.4 — The classic question: when do you use an assertion versus an exception or error return?

> **Testing:** The single most important distinction in the topic. Many candidates blur it.

**A.** The dividing line is *who is at fault and whether the condition is expected*:

| Situation | Tool | Why |
|---|---|---|
| Programmer error — "this can't happen if my code is correct" | **Assertion** | It's a bug to be fixed in code, not handled at runtime. |
| Expected runtime condition — bad input, file missing, network down, parse failure | **Error return / exception** | The world is allowed to do this; the program must handle it gracefully. |
| Data crossing a trust boundary (user, network, file, IPC) | **Validation → error**, *never* an assert | Asserts get stripped in release *and* are the wrong response to hostile input. |

The trap is using an assertion on untrusted input. Two things go wrong: in a release build the assert is *compiled out*, so the check vanishes and the bad data flows straight through; and even if it ran, crashing on every malformed request is a denial-of-service the attacker controls. **Validate input, assert invariants.** A useful heuristic: an assertion documents an assumption you could, in principle, *prove*; an error handles a possibility you must *expect*.

### Q1.5 — Is an assertion just a fancy `if`? What does it add?

> **Testing:** Whether you see the documentation/intent and tooling value, not just the runtime check.

**A.** Mechanically an `assert(cond)` is close to `if (!cond) abort_with_message()`. What it adds is **intent and tooling**. To a reader, `assert(x)` declares "I claim this is always true" — that's documentation a plain `if` doesn't carry, because an `if` usually means "this might be false, here's the handling." To the build system, assertions are a *category* that can be uniformly enabled or disabled (`NDEBUG`, `-ea`, `debug_assert!`), so you can run them densely in dev and test and strip them from a hot release path. To fuzzers and property tests, a tripped assertion is a machine-detectable signal that a bug was found. So the difference is semantic and operational: same branch, different *meaning* and different *lifecycle*.

---

## Theme 2 — Language & Mechanics

### Q2.1 — In C, what does `NDEBUG` do to `assert`, and what's the footgun?

> **Testing:** Whether you know assertions can vanish entirely, and the side-effect trap that follows.

**A.** The C standard library defines `assert` so that when the macro `NDEBUG` is defined (the conventional release setting, often injected by `-DNDEBUG`), `assert(expr)` expands to *nothing* — `((void)0)`. The check disappears completely from the binary. The footgun is putting a **side effect inside the assert**: any work the expression does also disappears. The textbook example:

```c
assert(buf = malloc(n));   // BUG: '=' assignment, and stripped under NDEBUG
buf[0] = 1;                // release: buf is uninitialized/garbage → crash or corruption
```

Two bugs at once: `=` instead of `==` (an assignment, always truthy unless `malloc` returns NULL), and the *entire allocation* is deleted in release because it lived inside the assert. The rule: **assertions must be pure** — no allocation, no mutation, no I/O, no anything the program needs. The condition is read-only by contract.

### Q2.2 — `static_assert` versus runtime `assert` — what's the difference and when do you reach for each?

> **Testing:** Compile-time vs run-time checking, and the "cheapest place to fail" instinct.

**A.** `static_assert(cond, "msg")` is checked by the **compiler**, so the program literally won't build if `cond` is false; it costs nothing at runtime and can never be stripped. It only works on constant expressions — things known at compile time: `static_assert(sizeof(void*) == 8, "64-bit only")`, `static_assert(alignof(T) >= 16)`, layout/size guarantees, template constraints. A runtime `assert` checks values that only exist while running — `assert(node->parent->left == node)`. The instinct a strong candidate shows: **fail at the cheapest, earliest stage possible**. If a fact is knowable at compile time, assert it there — a build failure beats a test failure beats a production crash. Reach for runtime `assert` only when the value genuinely isn't known until execution.

### Q2.3 — Rust has `assert!` and `debug_assert!`. What's the difference, and why have both?

> **Testing:** Whether you grasp the always-on vs debug-only axis as a deliberate, per-call choice.

**A.** `assert!` is **always compiled in**, in debug *and* release builds — it's a real check that ships. `debug_assert!` is compiled in only for debug builds; in `--release` it's stripped, exactly like C's `assert` under `NDEBUG`. Having both makes the always-on/debug-only decision an explicit, *local* choice instead of a global build flag. You use `assert!` for cheap, critical invariants you want enforced in production (and Rust's own slice indexing does an always-on bounds check that panics). You use `debug_assert!` for expensive checks — verifying a data structure's full invariant, an O(n) consistency sweep — that you want during testing but can't afford on the hot path in release. The mental model: `debug_assert!` ≈ DCHECK, `assert!` ≈ CHECK (next theme).

### Q2.4 — Go has no `assert` keyword. Why, and what do Go programmers do instead?

> **Testing:** Whether you understand a deliberate language-design stance, not just a missing feature.

**A.** It's intentional — the Go FAQ says assertions tempt programmers to skip proper error handling and reporting, so the language omits them. Go's philosophy is that errors are *values* you handle explicitly with `if err != nil`, and that there's no separate "programmer-error" check that gets silently stripped. For genuine "can't happen" conditions, the idiom is an explicit check that calls **`panic`**:

```go
v, ok := m[key]
if !ok {
    panic(fmt.Sprintf("invariant violated: key %q missing after insert", key))
}
```

`panic` is always-on (there's no `NDEBUG` to strip it) and unwinds the stack, optionally recovered at a boundary. So Go *has* fail-fast — via `panic` — it just refuses the stripped-in-release, programmer-only `assert` construct and pushes you toward errors for anything the world can cause. A strong answer notes the trade-off: no free-in-release dense invariant checks, but no "it worked in dev because asserts were on" surprises either.

### Q2.5 — How are assertions enabled or disabled across Java and Python?

> **Testing:** Breadth — knowing assertions are off by default in surprising places.

**A.**

- **Java:** assertions (`assert cond : "msg";`) are **disabled by default** at runtime. You must opt in with the JVM flag **`-ea`** (`-enableassertions`); without it the bytecode check is skipped. This catches people out: code that "relies on" an assert does nothing in a normally-launched JVM. Production almost always runs without `-ea`.
- **Python:** `assert cond, "msg"` is on by default but stripped when you run with the **`-O`** (optimize) flag, which sets `__debug__` to `False` and removes assert statements (and `__debug__`-guarded blocks). So Python assertions share C's "gone in optimized mode" property — and, just like C, you must never put security checks or side effects in a Python `assert`.

The pattern across languages: assertions are a *development/test* mechanism by default, and whether they run in production is a flag you should know and control, not assume.

---

## Theme 3 — Production & Policy

### Q3.1 — Explain CHECK versus DCHECK (Chromium-style). Why have two macros?

> **Testing:** The always-on vs debug-only distinction as an operational policy, not just a language feature.

**A.** In Chromium's idiom:

- **`CHECK(cond)`** is **always on** — it runs in every build including the shipped release, and on failure it *crashes the process intentionally*. You use it for invariants whose violation means continuing is genuinely unsafe (a corrupt security-relevant state, a violated allocator invariant). It's a deliberate "crash is better than proceeding" statement that survives into production.
- **`DCHECK(cond)`** is **debug-only** — compiled out of release builds, like `assert`/`debug_assert!`. You use it for checks too expensive for the hot path, or for catching developer mistakes during testing where the cost of an unguarded prod crash isn't justified.

Two macros exist because "should this check survive into production?" is a *per-check* decision with real cost on both sides: a `CHECK` you can't afford on a hot loop, or a `DCHECK` guarding something that actually does corrupt user data in release. Naming them differently forces the author to choose consciously, and lets reviewers audit the choice. The same split appears everywhere: `assert!`/`debug_assert!`, `panic`/(stripped assert), always-on bounds checks vs debug-only invariant sweeps.

### Q3.2 — Should assertions run in production? Give me the nuanced answer.

> **Testing:** Staff-level judgment. There is no dogmatic right answer, and an absolutist answer fails.

**A.** "It depends, and the decision is per-check, not global." The core trade-off is **crash vs continue when you detect impossible state**:

- **For crashing in prod:** if state is genuinely corrupt, continuing can do *worse* damage — charge the wrong account, serve another user's data, corrupt persistent storage. A fast, located crash with a good log and a supervised restart is often the *safest* response, and it surfaces bugs you'd never see if they were silently swallowed. This is the "let it crash" lineage.
- **Against crashing in prod:** a `CHECK` on a code path an attacker or a single malformed input can reach becomes a **denial-of-service** — they crash you on demand. And a crash has a **blast radius**: if one bad request takes down a process serving thousands of healthy requests, the assertion *caused* a bigger outage than the bug would have. Stripping all checks in release is the opposite failure — you fly blind and let corruption spread.

The staff answer resolves it by *granularity and category*: keep **always-on checks (`CHECK`) for invariants whose violation is unrecoverable and not attacker-triggerable**; use **debug-only checks (`DCHECK`) for expensive or developer-facing ones**; **never assert on anything reachable from untrusted input** (validate and return an error instead); shrink the **blast radius** so a crash kills one request/worker, not the fleet; and **roll out new always-on checks carefully** (Q3.4). The instinct that signals seniority: *"crash" and "continue" are both dangerous; the skill is deciding per-invariant which danger is smaller, and bounding it.*

### Q3.3 — What does crash *granularity* mean, and how does it change the calculus?

> **Testing:** Whether you connect fail-fast to architecture — the unit that dies matters as much as the decision to die.

**A.** Granularity is *what dies* when a check fails — a single request handler, one worker process, one actor, the whole server, the whole node. Fail-fast is far more palatable when the unit is small and supervised:

- **Per-request isolation** (catch at the request boundary, abort just that request) means a tripped invariant returns a 500 for one user, not an outage.
- **Per-process with a supervisor** (Erlang/OTP "let it crash," systemd/Kubernetes restart) means a crash is a recovery event — the supervisor restarts a clean process, and a transient corruption self-heals. The supervisor, not the buggy code, owns recovery.
- **Whole-node crash** is the worst granularity: maximum blast radius, and if a poison input crashes every replica it hits, you've built a fleet-wide outage trigger (a crash loop).

So the *same* assertion can be excellent or catastrophic depending on the granularity around it. The senior move is to pair always-on checks with **small, supervised failure units**, so "fail fast" means "fail *small* and restart," not "take everything down." This is why "let it crash" works in Erlang — the language and runtime make the failure unit tiny and the restart automatic.

### Q3.4 — How do you safely roll out a new *always-on* CHECK to a large fleet?

> **Testing:** Whether you treat enabling a crash-on-violation check as a risky production change, because it is.

**A.** Treat it like shipping code that can crash, because that's exactly what it is — if your assumption is wrong, or there's an edge case you didn't know about, the `CHECK` turns a latent quirk into a hard crash across the fleet, potentially a crash loop. The safe rollout:

1. **Start in log-only mode.** Ship the check as "log/metric on violation, do *not* crash" first. If it never fires across real production traffic for a while, your invariant actually holds.
2. **Watch the violation metric.** A nonzero rate means your assumption is false in prod — fix the bug (or the assumption) *before* arming the crash. This is the step that prevents the self-inflicted outage.
3. **Arm it gradually.** Convert log-only → crashing behind a flag or on a small percentage / one cell first, then expand, watching crash and crash-loop rates.
4. **Keep a kill switch.** Be able to revert to log-only instantly without a full redeploy.
5. **Mind blast radius and idempotency of restarts** so an unexpected trip degrades gracefully rather than cascading.

The anti-pattern is flipping a brand-new `CHECK` straight to always-crash fleet-wide on a hunch — that's how an assertion becomes the incident. The principle generalizes: *observe before you enforce.*

### Q3.5 — When is crashing on a detected violation *safer* than continuing, and when is it the opposite?

> **Testing:** Whether you can argue both directions concretely instead of picking a side.

**A.** **Crashing is safer** when continuing would cause irreversible or cross-customer harm: corrupt state about to be written to a database, a security check that "impossibly" failed (so proceeding might leak data or grant access), or an allocator/data-structure invariant whose violation means *any* further operation is undefined. Here a crash *contains* the damage — it stops before the bad state escapes the process. **Crashing is the opposite of safe** when the trigger is reachable from untrusted input (attacker-controlled DoS), when the failure unit is large (one bad request kills a shared process serving many), or when the "impossible" condition is actually a recoverable, expected edge you mislabeled as an invariant. The discriminating questions a senior asks: *Can untrusted input reach this? What's the blast radius? Is the bad state about to escape or be persisted? Is there a clean recovery?* The answers, not a slogan, decide it.

---

## Theme 4 — Integration with Tooling

### Q4.1 — How do assertions act as *oracles* for fuzzing and property-based testing?

> **Testing:** Whether you see assertions as the bug-detection mechanism that makes automated testing find real defects.

**A.** A fuzzer or property test generates huge numbers of inputs; the hard part is *deciding whether the program misbehaved*. That decision is the **oracle**. Assertions and contracts are a ready-made oracle: any input that **trips an assertion or violates an invariant is, by definition, a bug the tool just found**. Without oracles, fuzzing only catches crashes and hangs — the program has to fall over on its own. Densely asserted code turns silent logic errors into detectable failures: the fuzzer drives a malformed-but-not-crashing input that breaks an internal invariant, the `assert` fires, the harness records a reproducer. Property-based testing makes this explicit — the "property" *is* a postcondition/invariant (`decode(encode(x)) == x`, "output stays sorted"), checked on generated inputs. So the more honest invariants you encode as assertions, the more bugs your fuzzers and property tests can catch for free. Assertions and fuzzing are *complementary*: the fuzzer explores, the assertions judge.

### Q4.2 — In what sense are sanitizers "compiler-inserted assertions"?

> **Testing:** Whether you connect runtime assertions to ASan/UBSan/TSan conceptually.

**A.** A sanitizer is the compiler automatically inserting checks you'd otherwise have to write — and couldn't write for most of them. ASan instruments every memory access with an implicit "is this address valid and not freed/out-of-bounds?" check (via shadow memory and redzones); UBSan inserts "did this add overflow / is this shift in range / is this pointer aligned?" checks at the relevant operations; TSan instruments memory accesses to assert "no unsynchronized concurrent access happened here." Each is conceptually an `assert(memory access is legal)` or `assert(no data race)` woven in at compile time, firing with a precise report when violated. The differences from hand-written asserts: they're **automatic and exhaustive** (you can't forget one), they check **properties you can't express in source** (a use-after-free), and they're **debug/test-time tools** (too slow for prod — ASan is ~2× and adds memory). The unifying idea is the same as Theme 1: *detect the violation at its origin and fail loudly with location.* Sanitizers just generate the assertions for you. See [01 — AddressSanitizer](../01-address-sanitizer-asan/interview.md) and [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/interview.md).

### Q4.3 — Contrast runtime contract checking with statically *verified* contracts (Dafny, SPARK).

> **Testing:** Whether you understand "same specification, different enforcement," and the cost/coverage trade-off.

**A.** They share a *language* — preconditions, postconditions, invariants — but differ in **when and how** the contract is enforced:

- **Runtime checking** (`assert`, `CHECK`, DBC libraries) verifies the contract *while the program runs*, on the inputs it actually sees. Cheap to adopt, works in any language, catches real violations on real executions — but only on the paths you exercise, and a check that never runs proves nothing. It tells you a contract held *this time*.
- **Static verification** (Dafny, SPARK/Ada, ESC-style tools) *proves at build time*, with a theorem prover, that the contract holds for **all** inputs and paths — or refuses to compile. The same postcondition becomes a proof obligation discharged before the code ever runs. The payoff is exhaustive guarantees with zero runtime cost; the price is restricted language subsets, annotation effort, and prover expertise, which is why it's reserved for high-assurance domains (avionics, crypto, kernels).

The clean framing: *one specification, two enforcement strategies* — runtime is "test that it held on this run," static is "prove it holds on every run." They're not exclusive; you can prototype contracts as runtime asserts and promote the critical ones to proofs. This sits next to [Formal Methods & Verification](../../formal-methods-and-verification/).

### Q4.4 — How do assertions relate to coverage and the rest of the dynamic-analysis toolbox?

> **Testing:** Whether you see assertions as one layer in a defense-in-depth stack, not a standalone trick.

**A.** Assertions are the *judgment* layer; coverage and fuzzing are the *exploration* layers, and they reinforce each other. Coverage-guided fuzzing ([05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md)) drives execution into new code paths; assertions and sanitizers decide whether what happened on those paths was *wrong*. Coverage data also tells you something sobering about assertions themselves: **an assertion on a line you never execute provides no protection** — it's only as good as the paths your tests and fuzzers reach. So a mature setup combines them: dense invariants as oracles, a coverage-guided fuzzer to maximize the paths those oracles see, sanitizers to catch the violations source asserts can't express, and the whole thing in CI. The single-layer answer ("we have asserts, we're covered") misses that asserts only fire on executed code.

---

## Theme 5 — Scenario & Debugging

### Q5.1 — Code review turns up `assert(buf = malloc(n))`. What's wrong, and how do you fix it?

> **Testing:** The flagship scenario — side effects in asserts and `NDEBUG` stripping, both at once.

**A.** Two distinct bugs:

1. **Assignment, not comparison.** `=` assigns `malloc`'s result to `buf` and tests *that pointer's* truthiness. It happens to catch a NULL return, but it reads like a typo for `==` and is fragile.
2. **The check — and the allocation — vanish in release.** Because the call is *inside* `assert`, when the binary is built with `-DNDEBUG` the entire expression is deleted. `malloc` is never called, `buf` is never assigned, and the next line dereferences an uninitialized pointer — crash or silent corruption in production, while debug builds work fine. This is the worst kind of bug: invisible in dev, only in release.

The fix is to **do the work outside the assert and check the result properly**:

```c
buf = malloc(n);
if (buf == NULL) {
    // out-of-memory is a runtime condition, not a programmer error → handle it
    return ENOMEM;        // or perror/exit, per the program's policy
}
assert(n > 0);            // assert documents an *assumption*, side-effect-free
```

The lesson stated as a rule: **assertions must be side-effect-free, and OOM is a runtime condition, not an assertion**. Anything the program needs to *happen* must live outside the assert.

### Q5.2 — A service crashes in production on a malformed request because of an `assert`. Diagnose and fix.

> **Testing:** Recognizing assert-on-untrusted-input, and giving the correct remediation (not "remove the assert").

**A.** **Diagnosis:** an assertion is guarding data that came across a **trust boundary** (the request). That's the canonical misuse: an assert should encode an invariant about *your* code, but here it's checking *external input*, so an attacker or even an honest-but-weird client can trip it at will. Two problems follow — it's a **denial-of-service** (crash on demand), and in any build where asserts are stripped it gives *no* protection, so the malformed data would otherwise flow straight in. The crash is actually the *less bad* of the two outcomes; the assert was wrong either way.

**Fix:** convert the check into **input validation that returns an error**, at the boundary:

```c
// Before: assert(req->len <= MAX_LEN);   // crashes on hostile input, stripped in release

// After: validate and reject gracefully
if (req->len > MAX_LEN) {
    return respond_error(req, 400, "payload too large");   // one request fails, not the process
}
```

Then sweep for siblings — anywhere user/network/file/IPC data reaches an `assert` is the same bug. Keep assertions for genuine internal invariants *downstream* of validation. The principle restated: **validate untrusted input, assert internal invariants** — and never the reverse. Removing the assert without adding the validation just trades a loud crash for a silent vulnerability.

### Q5.3 — "Should we enable assertions in production?" — your engineering director asks. Answer at staff level.

> **Testing:** Whether you can give a structured, non-dogmatic recommendation with a rollout and guardrails.

**A.** "Not as a single global switch — that question is too coarse. I'd frame it as a *policy* with three buckets and guardrails."

- **Always-on (`CHECK`-style):** invariants whose violation is **unrecoverable and not attacker-triggerable** — corrupt allocator/data-structure state, a security check that 'impossibly' failed. For these, crashing in prod is *safer* than continuing, because it stops bad state from escaping or being persisted, and a supervised restart recovers. Roll each one out **log-only first**, watch the violation metric, then arm the crash gradually behind a kill switch.
- **Debug/test-only (`DCHECK`-style):** expensive checks and developer-facing ones. Run them densely in dev, CI, fuzzing, and canaries — where a crash is free — and strip them from the prod hot path.
- **Never:** any check on **untrusted input**. That's validation-returning-an-error, not an assertion, regardless of environment.

The cross-cutting guardrails: **shrink the blast radius** (fail per-request/per-worker under a supervisor, not per-node) so 'fail fast' means 'fail small and restart'; **observe before you enforce** (log-only → metric → arm); and **keep a kill switch**. So my answer is: *yes for unrecoverable, non-attacker-reachable invariants — armed carefully and bounded; no as a blanket flag, and never on untrusted input.* The thing I'd push back on is treating it as on/off for the whole binary — the cost of being wrong is asymmetric per check, so the decision has to be per check.

### Q5.4 — A bug only reproduces in your release build; debug builds are clean. How do assertions factor in?

> **Testing:** Whether you connect "works in debug, breaks in release" to stripped asserts and their side effects.

**A.** A prime suspect is **a side effect hiding inside a stripped assert** (Q2.1/Q5.1): in debug the assert runs and does the work; under `NDEBUG`/`-O`/`--release` the whole expression vanishes, so behavior diverges. First thing I'd do is grep for assertions whose expression mutates, allocates, or calls something with effects — `assert(x = ...)`, `assert(do_thing())`, `assert(++n < cap)`. A related class: code that *relies* on a `debug_assert!`/`DCHECK`'s check to clamp or fix state, which then isn't there in release. The general moral — and a reason to be disciplined about purity — is that assertions are *removable by definition*, so anything load-bearing must not live in one. (Release-only bugs have other causes too — optimizer-exposed UB, uninitialized memory, different timing — which is exactly where sanitizers and a release-with-asserts build help; but stripped-assert side effects are the assertion-specific culprit and the cheapest to rule out first.)

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Assertion in one line?** A: A checked claim that a condition is *always* true here; if false, your code has a bug.
- **Q: Assert or error for bad user input?** A: Error/validation — never assert; asserts get stripped and crashing on input is a DoS.
- **Q: Who owns a precondition?** A: The **caller** — a tripped precondition means the caller has a bug.
- **Q: Who owns a postcondition?** A: The **callee** — a tripped postcondition means the function has a bug.
- **Q: What does `NDEBUG` do?** A: Compiles C `assert` out entirely — the check and anything inside it disappears in release.
- **Q: Why must asserts be side-effect-free?** A: Because they can be stripped; any needed work inside one vanishes in release.
- **Q: `static_assert` vs `assert`?** A: Compile-time (constant expressions, build fails) vs run-time (runtime values).
- **Q: `assert!` vs `debug_assert!` in Rust?** A: Always-on (ships in release) vs debug-only (stripped in `--release`).
- **Q: Why no `assert` in Go?** A: Deliberate — Go pushes explicit error handling; use `panic` for true "can't happen."
- **Q: How do you enable Java assertions?** A: The `-ea` JVM flag; they're off by default.
- **Q: How are Python asserts stripped?** A: Running with `-O` removes them (`__debug__` becomes `False`).
- **Q: CHECK vs DCHECK?** A: CHECK is always-on and crashes in prod; DCHECK is debug-only (compiled out of release).
- **Q: When is crashing safer than continuing?** A: When corrupt state would otherwise escape, be persisted, or breach security.
- **Q: Biggest risk of an always-on CHECK?** A: Crash-on-demand DoS if untrusted input can reach it, or fleet-wide crash loop.
- **Q: How do you roll out a new CHECK?** A: Log-only first, watch the violation metric, then arm the crash gradually with a kill switch.
- **Q: What is an oracle in fuzzing?** A: The mechanism that decides "this is a bug" — assertions/invariants are a ready-made one.
- **Q: Sanitizers vs hand-written asserts?** A: Compiler-inserted, automatic, exhaustive checks for properties you can't write in source.
- **Q: Runtime vs static contracts?** A: Same spec; runtime checks this run, static *proves* all runs at build time.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Using an assertion to validate user/network input — or "fixing" the prod crash by just deleting the assert.
- Not knowing that `assert` (C/Python) is *stripped* in release/`-O`, or that Java asserts are off without `-ea`.
- Putting side effects inside an assert (`assert(buf = malloc(n))`) and not flagging it on review.
- Answering "should we run asserts in prod?" with a flat yes or no, no nuance, no per-check thinking.
- Treating "crash on bad state" as obviously correct with no mention of blast radius or DoS.
- Calling assertions and exceptions interchangeable.

**Green flags:**
- Naming the *distinction* (programmer error vs runtime condition; can't-happen vs expected) before reaching for a tool.
- "Validate input, assert invariants" as a reflex.
- Framing prod assertions as a per-check policy with **CHECK/DCHECK/never** buckets and a **log-only → arm** rollout.
- Connecting fail-fast to **crash granularity** — fail small and restart under a supervisor, bound the blast radius.
- Citing assertions as **oracles** for fuzzing/property testing unprompted.
- Knowing "works in debug, breaks in release" can be a stripped-assert side effect, and grepping for it first.
- Distinguishing runtime checking from static *proof* (Dafny/SPARK) as same-spec, different-enforcement.

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **Assertion** | Checked claim that a condition is *always* true; failure = a bug in your code. |
| **Assert vs error** | Assert = programmer error / "can't happen"; error = expected runtime condition. |
| **Trust-boundary rule** | Validate untrusted input (→ error); assert internal invariants only. |
| **Precondition / postcondition / invariant** | Caller's duty / callee's guarantee / type's always-true state. |
| **Fail-fast** | Stop at the violation's origin so the bug doesn't propagate and corrupt more. |
| **`NDEBUG` / `-O` / `-ea`** | Strip C asserts / strip Python asserts / *enable* Java asserts. |
| **Side-effect rule** | Asserts must be pure — they can be compiled out, taking their effects with them. |
| **`static_assert`** | Compile-time check on constant expressions; build fails, zero runtime cost. |
| **`assert!` / `debug_assert!`** | Rust: always-on vs debug-only. |
| **Go idiom** | No `assert`; explicit error handling, `panic` for true invariant violations. |
| **CHECK / DCHECK** | Always-on crash in prod / debug-only (stripped in release). |
| **Prod policy** | Per-check buckets: always-on (unrecoverable, not attacker-reachable), debug-only, never (untrusted input). |
| **Safe CHECK rollout** | Log-only → watch violation metric → arm crash gradually → keep a kill switch. |
| **Crash granularity** | Fail per-request/worker under a supervisor; bound the blast radius. |
| **Oracle** | A violated assertion is a bug a fuzzer/property test just found. |
| **Sanitizers** | Compiler-inserted assertions for properties you can't express in source. |
| **Runtime vs static contracts** | Same spec; checked this run vs *proven* for all runs (Dafny/SPARK). |

---

## Summary

- The bank reduces to a few distinctions, repeated in costumes: **programmer error vs runtime condition**, **assert vs error/exception**, **always-on vs debug-only**, **detecting bad state vs handling bad input**. Name the distinction first; the flag or snippet follows.
- **Fundamentals:** an assertion is a checked "always-true" claim that catches *programmer* errors fail-fast, close to their cause. Contracts assign blame — caller owns preconditions, callee owns postconditions, the type owns invariants. **Validate untrusted input, assert invariants** — never the reverse.
- **Language & mechanics:** C `assert` (and Python `assert`) are *stripped* in release/`-O`, so they must be side-effect-free; `static_assert` checks constants at compile time; Rust splits `assert!` (always-on) from `debug_assert!` (debug-only); Go omits `assert` on purpose and uses errors + `panic`; Java asserts need `-ea`.
- **Production & policy:** **CHECK** (always-on, crashes) vs **DCHECK** (debug-only). "Run asserts in prod?" is a *per-check* decision balancing crash-vs-continue, bounded by **blast radius** and **crash granularity** (fail small, supervised restart). Roll out new always-on checks **log-only first, then arm gradually with a kill switch**.
- **Integration:** assertions are **oracles** that let fuzzing/property testing find real bugs; sanitizers are compiler-inserted assertions for properties you can't write by hand; runtime checking and static *proof* (Dafny/SPARK) share a spec but differ in enforcement.
- **Debugging:** the flagship smell is a side effect inside a stripped assert (`assert(buf = malloc(n))`); a prod crash on malformed input is assert-on-untrusted-input — fix with validation, not deletion; and "works in debug, breaks in release" points at a stripped-assert side effect first.

---

## Further Reading

- *Object-Oriented Software Construction* (Bertrand Meyer) — the canonical treatment of **Design by Contract**: preconditions, postconditions, invariants, and the caller/callee blame model.
- *The Pragmatic Programmer* (Hunt & Thomas) — "Dead Programs Tell No Lies," "Design by Contract," and "Assertive Programming": the fail-fast and assert-vs-handle philosophy in plain terms.
- **Chromium docs on `CHECK`, `DCHECK`, and `NOTREACHED`** — the production reference for always-on vs debug-only checks and crash-as-policy at scale.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — mechanics underneath these answers, and the deeper production/contract-design treatment above them.
- `man assert`, the C standard on `<assert.h>`/`NDEBUG`, the Rust `std` docs for `assert!`/`debug_assert!`, and the Go FAQ entry "Why does Go not have assertions?" — primary sources for the language mechanics.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/interview.md) — sanitizers as compiler-inserted memory-safety assertions.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/interview.md) — the same idea for "no data race" invariants.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md) — the exploration layer that drives execution into the paths your assertions judge.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — statically *proving* the same contracts instead of checking them at runtime (Dafny, SPARK).
- [Testing](../../testing/) — where assertions live as oracles for property-based and fuzz testing.
