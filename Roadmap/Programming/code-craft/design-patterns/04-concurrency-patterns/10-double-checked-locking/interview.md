# Double-Checked Locking — Interview Questions

> Graded questions on Double-Checked Locking: lazy initialization, the memory-model bug, the `volatile` fix, and the idioms that replace it. Back-reference: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md).

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

**Q1. What problem does Double-Checked Locking solve?**
It makes lazy initialization cheap under concurrency: instead of locking on *every* access, it does an unlocked check first and only locks when the object appears to be missing — so after the one-time build, reads are lock-free.

**Q2. Why are there two `null` checks?**
The first (unlocked) check skips the lock on the common path once the object exists. The second (locked) check handles the race where two threads both pass the first check and enter the lock — only the first should build the object.

**Q3. Why is the naive version (no `volatile`) broken?**
`instance = new X()` is three steps: allocate, construct, publish the reference. The publish can be reordered before the construct, so another thread doing the unlocked first check can see a non-null reference to a **partially constructed** object.

**Q4. What's the fix in Java?**
Mark the field `volatile` (Java 5+). It prevents the reorder and guarantees a reader who sees the reference also sees the fully-constructed object.

## Middle Questions

**Q5. Name a simpler alternative to DCL for a static singleton.**
The **Initialization-on-Demand Holder** idiom: a private static nested class holding the instance. Class initialization is lazy and thread-safe by the JLS — lock-free, no `volatile`, hard to break. Or an **enum** singleton.

**Q6. Three guarantees needed to share data across threads — name them and which one the unlocked read lacks.**
**Atomicity, visibility, ordering.** The unlocked first read lacks **visibility** and **ordering** guarantees (no happens-before edge), letting it observe a reordered, partially-visible write.

**Q7. Does the inner check fix the partial-construction bug?**
No. The inner check prevents **double creation**; `volatile` prevents **premature publication**. They fix different bugs — you need both.

**Q8. When is DCL actually the right choice over the holder idiom?**
When the lazy value is an **instance field** (not static), is expensive to build, and is read on a hot path — the holder idiom only works for statics.

## Senior Questions

**Q9. Why can the broken version pass every test on your laptop?**
x86's strong TSO memory model preserves store-store ordering, hiding the construct-vs-publish reorder. The bug surfaces on weakly-ordered ISAs (ARM/POWER) or under aggressive JIT inlining. Example-based tests can't reliably trigger it.

**Q10. What does `volatile` mean in happens-before terms?**
A volatile store is a **release** and a volatile load is an **acquire**; the load pairs with the store to create a happens-before edge, so all writes before the store (the constructor's writes) are visible after the load — i.e., safe publication.

**Q11. How would you actually validate a DCL implementation?**
With **jcstress** (the OpenJDK concurrency stress harness) and by running concurrency tests on **ARM** CI runners, plus static analysis (SpotBugs) that flags a racily-read field that isn't `volatile`. Passing functional tests proves nothing.

## Professional Questions

**Q12. Why was DCL unfixable in pure Java before Java 5?**
The old JMM didn't guarantee a volatile write couldn't be reordered with preceding non-volatile writes, so even `volatile` allowed early publication, and there was no clean happens-before framework. **JSR-133** (Java 5) redefined `volatile` with release/acquire semantics, which finally made it work.

**Q13. Show the C++11 way and explain the primitive.**
`std::call_once`/`std::once_flag`, or a function-local `static` ("magic static", thread-safe init since C++11), or explicit atomics with `memory_order_release` on the store and `memory_order_acquire` on the load. C++ `volatile` is for memory-mapped I/O and does **not** provide thread ordering. Pre-C++11 DCL was undefined behavior.

**Q14. Is DCL worth it on modern JVMs?**
Usually not. The holder idiom's fast path is a *plain* read (no acquire fence), so it's at least as fast as volatile DCL and trivially correct; uncontended locks are also cheap now. Keep DCL for lazy instance fields on hot paths and for teaching the memory model.

## Coding Tasks

1. Write a correct `volatile` DCL singleton, then rewrite it with the holder idiom and an enum.
2. Given a non-volatile DCL, write the exact thread interleaving that exposes the bug.
3. Implement the C++11 versions: `call_once`, function-local static, and atomic acquire/release DCL.
4. Convert a `synchronized` accessor to DCL and justify the local-variable optimization.

## Trick Questions

**Can you remove the `volatile` if all the singleton's fields are `final`?**
No. `final`-field publication helps only when the object is published through that final field or a synchronized path — not through a racy non-volatile read. The DCL field itself must be `volatile`.

**Can you drop the lock entirely and just use `volatile`?**
No — then two threads can both build the object (the lock + inner check serialize construction). `volatile` handles publication, not mutual exclusion.

**Does declaring the field `volatile` make the whole singleton thread-safe?**
No. `volatile` governs the one reference field's publication. Mutating the object's state later still needs its own synchronization.

## Behavioral / Architectural Questions

- *A teammate's PR uses non-volatile DCL and all tests pass. How do you respond?* Explain that the bug is untestable by example on x86, point to the JMM/JSR-133 reasoning, and propose the holder idiom (simpler, correct) or adding `volatile` plus a SpotBugs rule.
- *When would you choose eager init over any lazy idiom?* When construction is cheap or warm-up cost is acceptable — eager `static final` is trivially correct and lock-free, with a plain-read fast path.
- *How do you stop this bug from regressing?* Lint/SpotBugs rule for racily-read non-volatile fields, a jcstress publication test, and a code-review note explaining why `volatile` must stay.

## Tips for Answering

- Always separate the **three concerns**: atomicity, visibility, ordering — most candidates conflate them.
- Stress that **the inner check and `volatile` fix different bugs**.
- Volunteer that **tests can't catch this** and name jcstress/ARM CI — that signals senior depth.
- Recommend the **holder idiom first**; reach for DCL only for lazy instance fields. Knowing *not* to use a pattern scores points.
- For C++, flag that `volatile` ≠ thread ordering and that pre-C++11 DCL was UB.
