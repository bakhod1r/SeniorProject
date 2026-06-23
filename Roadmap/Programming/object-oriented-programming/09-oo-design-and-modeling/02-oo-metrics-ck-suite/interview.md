# OO Metrics — the CK Suite — Interview Q&A

> ~20 questions, grouped by difficulty. Answers are concise, correct, and reflect how a strong engineer actually reasons about metrics — including their limits.

---

## Conceptual — warm-up

**Q1. Name the six CK metrics and the one concept each measures.**
WMC (class complexity/size), DIT (inheritance depth), NOC (number of direct subclasses), CBO (coupling to other classes), RFC (response-set size — methods reachable in response to a message), LCOM (lack of cohesion among methods). From Chidamber & Kemerer, IEEE TSE 1994.

**Q2. What does WMC actually weight, and what's the most common weight?**
Σ of method complexities. The weight is unspecified in the paper; with weight 1 it's just the method count, but most tools weight by **cyclomatic complexity**, so WMC ≈ total branching in the class.

**Q3. How is cyclomatic complexity computed in practice?**
`1 + number of decision points`, where decision points are `if`, `for`, `while`, `case`, `catch`, `&&`, `||`, and `?:`. Formally v(G) = E − N + 2P on the control-flow graph. McCabe, 1976.

**Q4. In Java, what is `Object`'s DIT and what is a class that directly extends `Object`?**
`Object` is DIT 0; a direct subclass is DIT 1. Every Java class roots at `Object`.

**Q5. What's the difference between NOC and "number of descendants"?**
NOC counts **direct** subclasses only — immediate children. Descendants would count the whole subtree. NOC is one level.

**Q6. Define afferent and efferent coupling.**
Afferent (Ca, fan-in) = things that depend on *you*. Efferent (Ce, fan-out) = things *you* depend on. You want low fan-out (cheap to change); high fan-in is only safe on stable, well-tested code.

---

## Mechanics — "compute this"

**Q7. Compute WMC (unweighted and CC-weighted) for this class.**
```java
class C {
  void a() {}                                  // CC 1
  void b(int x){ if(x>0) f(); else g(); }      // CC 2
  void c(int x){ for(int i=0;i<x;i++){} }      // CC 2
}
```
Unweighted WMC = 3. CC-weighted = 1 + 2 + 2 = **5**.

**Q8. What's the RFC of this class?**
```java
class Checkout {
  void run(Cart c){ price(c); gateway.charge(); }
  int price(Cart c){ return c.subtotal(); }
}
```
Local methods: {`run`, `price`}. Called methods: {`Cart.subtotal`, `Gateway.charge`}. (`price` is local, already counted.) Response set = 4 → **RFC 4**.

**Q9. Compute LCOM4 for this class.**
```java
class X {
  int a, b; String s;
  void p(){ a++; }
  void q(){ b += a; }
  void r(){ s = "x"; }
}
```
`p` and `q` share `a` → one component {p,q}. `r` touches only `s`, shares nothing → a second component {r}. **LCOM4 = 2** — the class is two classes glued together; split it.

**Q10. A package has Ca = 30, Ce = 5, and 2 of 10 types are abstract. Compute I, A, and D.**
I = Ce/(Ca+Ce) = 5/35 ≈ **0.14** (stable). A = 2/10 = **0.20**. D = |A + I − 1| = |0.20 + 0.14 − 1| = **0.66** — far from the main sequence, leaning toward the zone of pain (stable but mostly concrete).

**Q11. What does I = 0 mean, and is it good or bad?**
Maximally stable: nothing inside depends outward, much depends on it. Neither good nor bad by itself — it's good *if the package is also abstract* (A ≈ 1, on the main sequence) and dangerous if it's concrete (zone of pain), because everyone depends on it but you can't extend it without modifying it.

---

## Trade-offs and judgement

**Q12. A class scores high on WMC, CBO, RFC, *and* LCOM. What does that combination signal?**
The classic **god-class** signature: large, highly coupled, huge response set, and incohesive. It's almost always the first class to refactor. But confirm by reading — the metrics locate it; they don't diagnose it.

**Q13. Why is high LCOM1 a weaker signal than high LCOM4?**
LCOM1 (P − Q, floored at 0) can't distinguish a 2-group class from a 5-group class once it hits its floor, and a single field touched by every method drives it to 0 regardless of real cohesion. LCOM4 (connected components) directly tells you *how many independent classes* are hiding inside — it's actionable.

**Q14. Your CI fails any build with LCOM > 0. An engineer adds a field every method touches and the build passes. What happened, and what's the lesson?**
Goodhart's law: the metric became a target, so it was gamed — cohesion number dropped, design unchanged (arguably worse, with a junk field added). Lesson: never *gate* on a single syntactic metric. Use metrics to discover and discuss, ratchet on direction at most, never as acceptance criteria.

**Q15. Two classes both have CBO 1. Why might one be far more dangerous than the other?**
CBO counts coupling *number*, not *strength*. One pair might be coupled by connascence of *name* (trivial — rename both), the other by connascence of *identity* (must share the exact same instance — lethal). Use connascence (Page-Jones) to weight what CBO flags.

**Q16. Why is class *size* a problem when interpreting CK metrics?**
WMC, CBO, and RFC are all strongly correlated with size — a big class scores high on all three. El Emam (2001) showed size confounds most of CK's predictive power. So "high on four metrics" is often *one* fact (it's large) measured four ways. The useful question is "high *for its size*?".

**Q17. Why report percentiles and the worst-N instead of the mean for a metric across a codebase?**
Metric distributions are heavily right-skewed: most classes are fine, a long tail is extreme. The mean is dragged around by the tail and tells you nothing actionable. The tail (worst-N) is where the defects and the refactoring ROI live.

**Q18. Where should you set a CBO threshold, and where do the common numbers come from?**
On *your own codebase's distribution* — e.g. the 90th–95th percentile as the "investigate" line, re-derived periodically. The blog-post numbers ("CBO < 10") are largely folklore / corpus percentiles from other people's code; they aren't absolute truths.

---

## Design

**Q19. A package is in the "zone of pain". What does that mean and how do you move it out?**
Zone of pain = low instability + low abstractness (I≈0, A≈0): stable *and* concrete — many depend on it, but you can't extend it without modifying it. Fixes: extract interfaces from the concrete classes (raise A) so dependents bind to abstractions, or invert some dependencies so it depends outward (raise I). Either moves it toward the main sequence A + I = 1. See `optimize.md`.

**Q20. How would you use metrics in a code review without them becoming a weapon?**
Phrase the metric as an *observation plus an open question*: "CBO went 6 → 19 on this PR — can we inject these via interfaces?" — never "CBO 19, change it." The metric objectifies a hunch and starts a conversation; the author, who knows the context, decides. A number is never a verdict.

**Q21. Which metrics are worth *hard-gating* in CI, and which only worth watching?**
Hard-gate *structural/directional* properties — dependency direction and no-cycles (via ArchUnit) — because they're binary and can't be gamed by cosmetic edits and they protect the instability math. Keep *numeric* metrics (CBO, WMC, LCOM) advisory, at most ratcheted on new-code regressions. Gate what's binary; watch what's judgemental.

**Q22. When are OO metrics not worth computing at all?**
On small, stable, won't-touch-again code; on throwaway prototypes you'll delete; and when the team already knows the worst class — you don't need a tool to find the legendary `OrderManager`, you need time to fix it. Spend the budget on large, evolving, multi-team codebases where no one holds the whole graph in their head.

---

**Closing one-liner for any metrics interview:** the CK suite turns six OO intuitions into numbers a tool can rank across a whole codebase — but every metric is syntactic, size-confounded, and Goodhart-fragile. They *locate* problems; they never *diagnose* them. Read the number, then read the code, and when the two disagree, the code wins.
