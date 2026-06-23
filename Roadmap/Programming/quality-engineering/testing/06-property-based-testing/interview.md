# Property-Based Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Property-Based Testing

*A question bank for PBT interviews: the example→property shift, finding properties, generators, shrinking, stateful testing, seeds, and the judgment calls — with model answers and the trap behind each question.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Finding Properties](#finding-properties)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering PBT interview questions with the depth that separates "I've used `@given` once" from "I understand when and why PBT changes outcomes."**

Interviewers probe PBT to test two things: do you understand the *conceptual shift* (specify behavior vs. enumerate examples), and do you have the *judgment* to apply it well (find real properties, manage flakiness, know where it doesn't fit). The differentiator is almost never syntax — it's whether you can find a non-trivial property for an unfamiliar function on the spot, and whether you can talk about shrinking, seeds, and stateful testing without hand-waving.

---

## Prerequisites

- The junior through senior tiers of this topic.
- Working knowledge of at least one framework (Hypothesis, jqwik, or fast-check).
- Comfort discussing unit testing (`../02-unit-testing/`) and flakiness (`../12-flaky-tests-and-reliability/`).

---

## Fundamentals

**Q1. What is property-based testing, and how does it differ from example-based testing?**
*What's really being tested: do you understand the core conceptual shift, not just the API.*
**A.** Example-based testing asserts specific input→output pairs you chose by hand. PBT instead states a **property** — a rule that must hold for *all* valid inputs — and lets a framework generate many inputs (often hundreds), checking the rule against each. You describe what a *correct answer looks like* rather than computing the expected answer for each case. The framework explores inputs you'd never write (empty, unicode, huge, boundary), and on failure it **shrinks** the input to a minimal counterexample. PBT complements example tests; it doesn't replace them.

**Q2. What is shrinking and why does it matter?**
*What's really being tested: do you know the feature that makes PBT practical, not just generation.*
**A.** When a property fails, the framework reduces the failing input to the *smallest* input that still fails — a 200-element list becomes `[0, 0]`, a long string becomes `"\x00"`. It does this by repeatedly trying simpler candidates (shorter, smaller, closer to zero) and keeping any that still fail. This matters because raw random failures are noise; the shrunk counterexample is an unambiguous, minimal reproduction handed to you for free. Without shrinking, PBT failures would be nearly undebuggable. Modern frameworks use *integrated* shrinking, so custom generators shrink correctly automatically.

**Q3. What is a generator (strategy / arbitrary)?**
*What's really being tested: do you understand the input engine and that you can shape it.*
**A.** A generator is a recipe for producing random structured values of a given type. Frameworks ship generators for primitives (`integers`, `text`, `floats`, `booleans`) and combinators (`lists`, `dictionaries`, records). You compose them, `map` to transform, and build custom generators for domain types. The generator is *why* PBT finds weird inputs — `st.text()` produces emoji, control chars, and empty strings that humans skip. You should prefer constructing constrained values (`min_value=1`) over filtering (`.filter(> 0)`), which wastes generation budget.

---

## Technique

**Q4. Walk me through a complete failing-property-shrinks-to-counterexample example.**
*What's really being tested: can you make the abstract concrete end-to-end.*
**A.** Suppose `dedupe` mishandles elements appearing 3+ times.

```python
@given(st.lists(st.integers()))
def test_dedupe_removes_all_duplicates(xs):
    out = dedupe(xs)
    assert len(out) == len(set(out))
```

Hypothesis first fails on something noisy like `[9, 9, 2, -55, 9, 17, 0, 9, 9]`. It then shrinks: drops unrelated elements → `[9,9,9,9]` still fails; shortens the run → `[9,9,9]` still fails; → `[9,9]` *passes* (rejected); shrinks the value → `[0,0,0]` still fails. Final report: `Falsifying example: dedupe(xs=[0, 0, 0])`. The minimal counterexample instantly says "three identical elements break it." I'd then pin it with `@example([0,0,0])` so it's a permanent, seed-independent regression.

**Q5. Show the round-trip and oracle patterns in code.**
*What's really being tested: do you know the two highest-value patterns concretely.*
**A.** **Round-trip** — inverse functions compose to identity:

```python
@given(json_values)
def test_json_round_trips(v):
    assert json.loads(json.dumps(v)) == v
```

**Oracle / model-based** — compare against a simple trusted reference:

```python
@given(st.lists(st.text()))
def test_counter_matches_dict(words):
    fast, oracle = MyCounter(), {}
    for w in words:
        fast.add(w); oracle[w] = oracle.get(w, 0) + 1
    for w in set(words):
        assert fast.count(w) == oracle[w]
```

Round-trip is the cheapest high-value property (serializers, codecs); the oracle pattern handles cases where the "right answer" is hard to state directly by letting a dumb-but-correct implementation define it.

**Q6. How do you keep PBT from making CI flaky?**
*What's really being tested: the single biggest real-world objection to PBT.*
**A.** First, ensure the *property itself* is deterministic — never read the clock, RNG, network, or filesystem ordering inside it; inject them. A non-reproducible failure is almost always a non-deterministic property, not framework randomness. Then choose a seed strategy per suite: **fixed seed on the blocking PR gate** (reproducible, never noise, but no new inputs) plus **random seed nightly** with the seed reported on failure (explores new inputs, still reproducible). New bugs surface in the nightly with a seed you can replay; the gate stays stable. Also cap per-example time with deadlines, and always pin discovered counterexamples with `@example`.

---

## Finding Properties

**Q7. I give you a function `merge(a, b)` that merges two sorted lists into one sorted list. What properties would you test?**
*What's really being tested: can you find non-trivial properties on the spot — the core PBT skill.*
**A.** Several patterns apply:
- **Invariant:** the output is sorted.
- **Invariant (multiset):** output is a permutation of `a + b` (same elements with multiplicity) — `Counter(out) == Counter(a) + Counter(b)`.
- **Length:** `len(out) == len(a) + len(b)`.
- **Oracle:** `merge(a, b) == sorted(a + b)` (using `sorted` as a trusted reference).
- **Commutativity (multiset):** `Counter(merge(a,b)) == Counter(merge(b,a))`.
- **Identity:** `merge(a, []) == a` for already-sorted `a`.

I'd note generators must produce *sorted* inputs (`st.lists(st.integers()).map(sorted)`), since `merge` assumes sorted inputs.

**Q8. There's no oracle and no obvious invariant — say, an image-resize function or an ML ranking model. Can PBT still help?**
*What's really being tested: do you know metamorphic testing, the advanced property pattern.*
**A.** Yes — **metamorphic relations**. You don't assert the exact output; you assert how the output *changes* when you transform the input predictably. For resize: resizing then resizing back to original dimensions should be *close* to the original (within tolerance); resizing to 2x then 0.5x relates to the original. For a ranking model: adding a non-matching document shouldn't drop existing top results; case-only changes to a query shouldn't change results if it's case-insensitive; shuffling input order shouldn't change the *set* of matches. Metamorphic testing unlocks PBT for compilers, ML, and image processing where stating the exact right answer is impractical.

**Q9. What makes a property *bad*?**
*What's really being tested: can you spot vacuous and tautological properties.*
**A.** Two failure modes. **Vacuous** — passes for everything, including broken code (`assert len(out) >= 0`); it tests nothing. **Tautological** — re-implements the production logic inside the property (`assert my_sort(xs) == [own buggy sort logic]`), so both share the same bug. Good properties reason *independently* of the implementation: structural invariants, an independent oracle, or metamorphic relations. The way to *prove* a property is non-vacuous is mutation testing — inject faults and confirm the property fails.

---

## Scenarios

**Q10. Your team wants to validate that the property tests are actually strong. How?**
*What's really being tested: do you connect PBT to mutation testing.*
**A.** Run **mutation testing** on the PBT-covered modules. It injects faults (flip `<` to `<=`, invert conditions, replace returns) and reruns the tests; a *surviving* mutant is a fault your properties can't detect. Survivors mean the property is vacuous, too weak, or the generator never reaches that input region. PBT generates inputs; mutation testing generates faults; together they confirm strong checks meet thorough inputs. A high mutation score on PBT-covered code is the best evidence the properties truly constrain behavior. (See `../07-mutation-testing/`.)

**Q11. When would you NOT use PBT?**
*What's really being tested: judgment — over-eager candidates apply PBT everywhere.*
**A.** When there's no statable invariant. Thin glue/CRUD code whose only "property" is "it called the dependency" is clearer as a mock-based unit test. Heavily side-effecting code with no clean model costs more to model than it returns. UI look-and-feel fits snapshot/approval testing better. PBT pays off most on parsers, serializers, codecs, data structures, financial/date/encoding logic, and protocols/state machines — anything with clear invariants and expensive bugs. Forcing PBT onto invariant-free code produces vacuous properties and discredits the practice.

**Q12. What is stateful / model-based testing, and what bugs does it find?**
*What's really being tested: do you know the most powerful PBT technique.*
**A.** Instead of testing one call, the framework generates a random *sequence* of operations and runs it against both the real system and a simple **model** (a dict for a KV store, a list for a stack), asserting they agree after each step via invariants and postconditions. It generates *programs*, then shrinks a failing program to the shortest sequence that still diverges — e.g., `put(x); delete(x); get(x)` returns the stale value. It finds ordering, lifecycle, and concurrency bugs that no single-call property can: double-release in a connection pool, leak-on-exception, "merge leaves a gap." It's the highest-leverage PBT for stateful code. Tools: Hypothesis `RuleBasedStateMachine`, jqwik state machines, fast-check `fc.commands`.

**Q13. How does PBT relate to fuzzing?**
*What's really being tested: do you know the boundary and avoid conflating them.*
**A.** Both generate many inputs, but the engine and goal differ. PBT is **property-driven**: you state logical invariants, it generates structured inputs, and shrinking yields a clean counterexample. **Coverage-guided fuzzing** (libFuzzer, AFL, Go's native fuzzer) uses *mutation + coverage feedback*, typically on byte/string inputs, hunting crashes, hangs, and sanitizer trips. They overlap and a parser deserves *both* — but fuzzing belongs in dynamic analysis, not the PBT toolkit. Rule of thumb: rich logical invariant → PBT; "does any byte sequence crash it?" → fuzzing.

---

**Q13b. How do you choose a good generator distribution?**
*What's really being tested: do you know that generation quality determines bug-finding quality.*
**A.** The generator must reach the *interesting* regions, not just the easy middle. Frameworks bias toward small inputs early (faster, better shrinking) and grow over the run, and they deliberately oversample edges — `0`, empty, `NaN`/`inf` for floats, boundary integers. The failure mode is a blind spot: dates always in 2024, IDs always positive, strings always ASCII — whole input regions never tested, giving false confidence. I'd tune ranges to match the real domain, weight `one_of` choices realistically, and use mutation testing to *detect* distribution gaps (surviving mutants on covered code often mean the generator never reaches that branch). For domain types I centralize the generators so distributions stay realistic and consistent across the suite.

---

## Rapid-Fire

**Q14. What's a round-trip property?** `decode(encode(x)) == x` for all `x`.

**Q15. What's idempotence as a property?** `f(f(x)) == f(x)` — normalizers, dedupers, upserts.

**Q16. How do you make a discovered counterexample a permanent regression?** Pin it with `@example(...)` (Hypothesis) so it runs every time, seed-independently.

**Q17. Why prefer `st.integers(min_value=1)` over `.filter(lambda n: n > 0)`?** Filtering throws away generated values and can abort the run if too aggressive; constructing the constrained value wastes nothing.

**Q18. What's an oracle in PBT?** A simple, obviously-correct reference implementation you compare the real system against.

**Q19. Name three frameworks by ecosystem.** Hypothesis (Python), jqwik (Java), fast-check (JS/TS); also proptest/quickcheck (Rust), gopter (Go).

**Q20. What does a seed do?** Drives the random generator; same seed reproduces the same inputs and thus the same pass/fail.

**Q21. What's a metamorphic relation?** A predictable relationship between `f(x)` and `f(transform(x))` used when no oracle or simple invariant exists.

**Q22. Is PBT a proof of correctness?** No — it samples the input space; it can pass a million inputs and still miss the one you didn't generate. It's lightweight formal methods.

**Q23. What does integrated shrinking buy you?** Custom generators shrink correctly for free, without writing a separate shrink function.

**Q24. Hypothesis, jqwik, fast-check — match to language.** Python, Java/JVM, JS/TS respectively.

**Q25. Where does PBT sit relative to formal methods?** Lightweight formal methods — a spec checked against a large *sample* of inputs, between example tests and model checking/proof.

**Q26. What's the cheapest high-value first PBT to add to a codebase?** A round-trip on an existing serializer — near-zero effort, guaranteed value, converts skeptics.

**Q27. Why pin a counterexample instead of trusting the example database?** The database can be cleared or excluded from CI; `@example` is explicit, reviewable, and lives in source control regardless of seed.

---

## Red Flags / Green Flags

**Red flags**
- Thinks PBT replaces all example tests.
- Can't find a single non-trivial property for `merge` or `sort` when prompted.
- Writes vacuous (`>= 0`) or tautological (re-implements the SUT) properties without noticing.
- Dismisses PBT as "flaky" with no awareness of seeds/determinism.
- Conflates PBT with fuzzing, or thinks PBT proves correctness.
- Never validates property strength.

**Green flags**
- Reaches for the pattern catalogue (round-trip, invariant, idempotence, commutativity, oracle, metamorphic).
- Explains shrinking and why it makes failures actionable.
- Knows fixed-seed-gate + random-nightly and "find with PBT, pin with `@example`."
- Knows stateful/model-based testing and what bugs it finds.
- Pairs PBT with mutation testing to validate strength.
- Has clear judgment on where PBT does and doesn't fit.

---

## Cheat Sheet

```text
Shift:        example (specific in→out) → property (rule for ALL inputs) → framework generates → shrinks on fail
Patterns:     round-trip | invariant | idempotence | commutativity | oracle | metamorphic | equivalence
Generators:   compose/map/filter; construct constraints (min_value) over filtering; custom = integrated shrinking
Shrinking:    repeatedly try simpler inputs that still fail → minimal counterexample (e.g. [0,0])
Determinism:  inject clock/RNG; failure must replay from the reported seed
CI:           fixed-seed PR gate (stable) + random-seed nightly (deep, seed reported)
Regression:   find with PBT, pin with @example, commit it
Stateful:     system + model + commands + invariants → finds ordering/lifecycle bugs; shrinks the program
Validate:     mutation testing kills the "is my property vacuous?" question
Not PBT:      invariant-free glue/CRUD/UI; coverage-guided fuzzing lives in dynamic-analysis
```

---

## Summary

PBT interviews reward the conceptual shift (specify a rule for all inputs, don't enumerate examples) and the judgment to apply it: finding real properties from a pattern catalogue, explaining shrinking and seeds without hand-waving, knowing stateful/model-based testing and the bugs it catches, validating property strength with mutation testing, and knowing where PBT doesn't fit. The questions that separate candidates are the open-ended "what properties would you test for *this* function?" — answerable only by someone who has internalized the patterns — and the flakiness/seed discipline that proves you've run PBT in real CI rather than just read about it.

---

## Further Reading

- Scott Wlaschin, "Choosing properties for property-based testing."
- John Hughes, "Testing the Hard Stuff and Staying Sane."
- Hypothesis, jqwik, and fast-check official docs.
- The `property-based-testing` and `unit-testing-patterns` skills.

---

## Related Topics

- [Property-Based Testing — Senior](./senior.md) — stateful testing, seeds, determinism.
- [Property-Based Testing — Professional](./professional.md) — PBT as spec, adoption, ROI.
- [Unit Testing](../02-unit-testing/) — the foundation PBT extends.
- [Mutation Testing](../07-mutation-testing/) — validating property strength.
- [Flaky Tests and Reliability](../12-flaky-tests-and-reliability/) — keeping randomized tests deterministic.
- [Dynamic Analysis and Sanitizers](../../dynamic-analysis-and-sanitizers/) — coverage-guided fuzzing.
