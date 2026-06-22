# Taint & Data-Flow Analysis — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Taint & Data-Flow Analysis

*A question bank with model answers and what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Precision & Soundness](#precision--soundness)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **defending what you know about taint and data-flow analysis under questioning — the source/sink/sanitizer model, the CFG/lattice/fixpoint machinery, the precision/soundness trade-offs, and how real tools (CodeQL, Semgrep) operationalize all of it.**

Interviewers use this topic to separate people who *run* SAST from people who *understand* it. The tells are precise: can you explain why a tool has false positives without hand-waving? Do you know the difference between sound and complete? Can you reason about what a tool cannot prove? Answers below are in **Q** / *what's really being tested* / **A** format. Speak in trade-offs, not absolutes.

## Prerequisites

- All four tier pages: [junior](junior.md), [middle](middle.md), [senior](senior.md), [professional](professional.md).
- Ability to read a small CodeQL or Semgrep taint rule.
- Familiarity with the [SAST & Security Scanners](../04-sast-security-scanners/) topic and the SQLi/XSS/command-injection bug shapes.

## Fundamentals

**Q1. Explain taint analysis in one minute to someone who's never heard of it.**
*Probes: can you teach the core model crisply.*
**A.** Taint analysis tracks untrusted data through a program. Data enters at a **source** (a request parameter, a header), spreads as it's copied and passed around (**propagation**), and the bug is when it reaches a **sink** — a dangerous operation like a SQL query or shell call — without passing through a **sanitizer** that makes it safe. So a tainted value reaching a sink with no sanitizer in between is a finding. SQL injection, XSS, and command injection are all this same shape with different sinks and different correct sanitizers.

**Q2. What is data-flow analysis, and how does taint fit into it?**
*Probes: do you know taint is one instance of a general framework.*
**A.** Data-flow analysis computes facts about values at each point in a program by modelling it as a **control-flow graph** and pushing facts along the edges with **transfer functions** until they stabilize (a fixpoint). Classic instances are reaching definitions, live variables, and available expressions. Taint is just another instance where the fact is "which variables carry untrusted data." It's a **forward, may** analysis — forward because taint moves with execution, may because a value is treated as tainted if it's tainted on *any* incoming path.

**Q3. Why can't I just `grep` for `db.execute` to find SQL injection?**
*Probes: understanding of why flow matters.*
**A.** `grep` matches text; it can't tell a safe parameterized call from a dangerous string-concatenated one — same function name, opposite verdict. And it can't follow the value: the source might be five function calls away from the sink. Taint analysis tracks the *journey* of a value, so it connects a distant source to a sink and recognizes a sanitizer in between. Pattern matching finds where text appears; data-flow finds where data *travels*.

**Q4. Walk me through a concrete taint trace.**
*Probes: can you do it by hand, not just recite definitions.*
**A.** `uid = request.args["id"]` is the source — `uid` is tainted. It's passed to `lookup(uid)`, so the parameter `user_id` is tainted. `lookup` calls `build_query(user_id)`, tainting `uid` there. `build_query` returns `"SELECT * FROM users WHERE id = " + uid` — concatenation propagates taint, so the returned string is tainted. That string flows into `db.execute(...)`, the sink. No sanitizer ran, so it's a finding. The fix is a parameterized query — `("...WHERE id = ?", [uid])` — which the tool recognizes as a sanitizer because the value is bound as data, not woven into SQL text.

## Technique

**Q5. What's the difference between intraprocedural and interprocedural analysis, and why does it matter?**
*Probes: the central cost/power axis of the topic.*
**A.** Intraprocedural analysis stays within one function; interprocedural follows calls. It matters because most real injection bugs have their source and sink in *different* functions — a purely intraprocedural analysis is blind to those and produces false negatives. Interprocedural analysis is where the power is, but it's expensive: you need a **call graph** and usually **function summaries** ("taint in arg ⇒ taint in return") computed once per function and reused at every call site. Semgrep taint mode is mostly intraprocedural with shallow interprocedural reach; CodeQL is deeply interprocedural.

**Q6. What is a function summary and why does it help with scale?**
*Probes: understanding of how interprocedural analysis stays tractable.*
**A.** A summary is a compact description of a function's taint behavior — which inputs' taint reaches which outputs (return value, mutated params, globals) — computed by analyzing the function *once*. At each call site you apply the summary instead of re-analyzing the body. This is essentially dynamic programming for whole-program analysis; it's the IFDS/IDE idea (interprocedural data flow as graph reachability) and the reason CodeQL and Infer scale to millions of lines.

**Q7. Write a small taint rule. Use whichever tool you know.**
*Probes: have you actually used these tools.*
**A.** Semgrep taint mode:
```yaml
rules:
  - id: tainted-sql
    mode: taint
    languages: [python]
    pattern-sources: [ { pattern: request.args[...] } ]
    pattern-sanitizers: [ { pattern: int($X) } ]
    pattern-sinks: [ { pattern: db.execute($SQL, ...) } ]
```
Or CodeQL: a `DataFlow::ConfigSig` module with `isSource`, `isSink`, and `isBarrier` predicates, instantiated via `TaintTracking::Global<Config>`, queried with `flowPath` and `@kind path-problem` to emit the full source-to-sink witness path.

**Q8. What's the difference between a transfer function and the join operator?**
*Probes: do you actually understand the fixpoint machinery.*
**A.** The **transfer function** is per-statement: it takes the facts coming into a block and produces the facts going out (e.g. `y = x` copies `x`'s taint to `y`; `y = escape(x)` clears it). The **join** (`⊔`) happens at merge points where multiple paths meet — it combines the facts from all predecessors. For taint, join is **union**: tainted on any incoming path means tainted. That union is exactly why sanitizing on one branch of an `if/else` doesn't clear a finding — the unsanitized branch contributes taint to the join.

**Q9. What is a monotone data-flow framework and why does monotonicity matter?**
*Probes: the theoretical core; whether you know why iteration terminates.*
**A.** It's a lattice of facts (with a partial order and a join), a monotone transfer function per statement, a direction, and fixpoint iteration. **Monotone** means more information in never yields less information out (`x ⊑ y ⇒ f(x) ⊑ f(y)`). That property, combined with a **finite-height lattice**, guarantees iteration terminates: the fact set can only grow and it's bounded, so it must stabilize. The result is the least fixpoint — the most precise sound over-approximation the abstraction allows. This is an instance of abstract interpretation.

**Q10. How does CodeQL differ architecturally from a linter?**
*Probes: whether you understand the database-and-query model.*
**A.** A linter walks the AST and pattern-matches. CodeQL first *extracts* the codebase into a **relational database** of program facts — AST nodes, the CFG, the call graph, a precomputed data-flow graph — then runs **declarative queries** (a Datalog-like language) over it. That separation is what lets it answer global, interprocedural reachability questions like "does any source reach any sink anywhere" efficiently and emit the full witness path, which a per-file AST walk can't do.

## Precision & Soundness

**Q11. Define sound and complete. Can a tool be both?**
*Probes: the single most important conceptual distinction in the topic.*
**A.** **Sound** = no false negatives: every real bug of the class is reported (achieved by over-approximating — when unsure, assume tainted). **Complete** = no false positives: every reported finding is real (achieved by under-approximating). No tool can be both decidably, because **Rice's theorem** says any non-trivial semantic property of programs is undecidable — and "does untrusted data reach this sink on a real execution?" is such a property. So every tool approximates and trades false positives against false negatives. Most security SAST leans toward soundness (catch the bug) and pays in false positives.

**Q12. What does "soundy" mean?**
*Probes: awareness that real tools aren't actually sound.*
**A.** "Soundy" describes tools that are sound *except* for a documented, well-understood set of features they deliberately handle unsoundly — typically reflection, dynamic dispatch, `eval`, deserialization, native calls, and implicit (control-flow) information leaks. True soundness over those would make the tool unusably noisy or impossible, so tools sweep them under with an explicit list. That list is exactly the tool's **false-negative surface** — the bugs it will silently miss — which is why you must know it.

**Q13. Name the precision dimensions and their cost.**
*Probes: depth on the precision/scalability frontier.*
**A.** Four axes, each trading scalability for fewer false positives: **flow-sensitivity** (respect statement order — cheap, high value), **field-sensitivity** (per-field rather than whole-object taint — cheap, high value), **context-sensitivity** (distinguish call sites, e.g. k-CFA — moderate cost, fixes shared-helper false positives), and **path-sensitivity** (track branch conditions, often via SMT — most expensive, fixes infeasible-path false positives). Whole-program, fully precise, sound analysis is intractable, so every tool bounds something. The craft is buying flow- and field-sensitivity broadly and context-sensitivity selectively, while usually skipping general path-sensitivity in favor of barrier models.

**Q14. Why does a shared helper function cause a flood of false positives?**
*Probes: understanding of context-(in)sensitivity in practice.*
**A.** A context-*insensitive* analysis uses one summary for a function across all callers. If a shared utility — say a logger or formatter — is called once with tainted input anywhere, its output is treated as tainted *everywhere*, and every call site lights up. The fix is **context-sensitivity** (a per-call-site summary) or a more precise summary that doesn't route taint to the sink — not suppressing the helper, which would also hide the one real flow.

## Scenarios

**Q15. Your CodeQL scan returns zero findings on a service you suspect is vulnerable. What do you check?**
*Probes: knows recall depends on modeling, not just "it's clean."*
**A.** Zero findings measures the *models*, not the code. First check whether the framework is modeled: if the service uses an in-house request accessor or `db` wrapper that CodeQL doesn't know, taint dies at that boundary and nothing flows. I'd add models — declare the accessor a source, the wrapper a sink, any builder a taint step — and re-run. I'd also check the call graph for dynamic-dispatch holes and whether the suspected path goes through a soundy gap like deserialization. Only after modeling can "zero" mean anything, and even then it never means "secure."

**Q16. The team is drowning in false positives and starting to ignore the tool. What do you do?**
*Probes: tuning-for-signal judgment.*
**A.** Optimize for actioned true positives per analyst-hour, not raw findings. Cheapest levers first: (1) model missing **sanitizers as barriers** — most FPs are real flows through a cleaner the tool didn't know; one barrier kills a whole cluster. (2) Tighten over-broad sources/sinks. (3) Add context-sensitivity for shared-helper fan-out. (4) Only as a last resort buy path-sensitivity. Then **baseline** the legacy findings and gate only on *new* flows in changed code, and severity-tier the rules so only high-precision high-severity findings block.

**Q17. Should we use Semgrep or CodeQL?**
*Probes: engine-selection judgment; ideally "both, for different jobs."*
**A.** They're different points on a cost/depth curve, not competitors. Semgrep is fast, readable, mostly intraprocedural — great for dense, local, high-frequency checks in the inner loop (org conventions, "never call `os.system`", framework misuse). CodeQL is deep, interprocedural, slow — reserve it for the sparse, high-severity, *flow-shaped* vulnerabilities where source and sink are far apart (injection, SSRF, deserialization) and a pattern would miss the long flow. A mature program runs both in a two-speed pipeline: Semgrep diff-scan on every PR, CodeQL deep scan nightly or on merge.

**Q18. A static taint tool flagged a flow. Can you tell leadership it's exploitable?**
*Probes: distinguishing a finding from a proof of exploitability.*
**A.** No — a finding is a *lead*, not a verdict. A CodeQL path is evidence that data can flow source-to-sink, but exploitability also depends on reachability, authentication, real attacker control, and whether a sanitizer the tool didn't model exists. Conversely, absence of findings never proves safety (Rice's theorem plus soundy gaps). I'd triage the finding for feasibility before calling it a vulnerability, and I'd never sell "0 findings" as "secure."

## Rapid-Fire

**Q19.** Is taint forward or backward? — *Forward (it moves with execution).*

**Q20.** Is taint may or must? — *May; join is union; tainted on any path = tainted.*

**Q21.** Does `name.upper()` sanitize? — *No; it transforms text but doesn't remove the danger.*

**Q22.** Why does assigning a constant clear taint? — *The old value is gone; flow-sensitivity tracks facts per program point, so the assignment kills the prior taint.*

**Q23.** What's an implicit flow? — *Taint leaking through a branch decision rather than a direct assignment; most security tools ignore it by design.*

**Q24.** What's a sink for SSRF? — *A URL-fetching call (HTTP client) reachable with an attacker-controlled URL.*

**Q25.** What guarantees data-flow iteration terminates? — *Monotone transfer functions over a finite-height lattice.*

**Q26.** What does CodeQL build before querying? — *A relational database of program facts (AST, CFG, call graph, data-flow graph).*

**Q27.** What's the IFDS framework in one line? — *Precise interprocedural data flow reduced to graph reachability via function summaries.*

**Q28.** What's the cheapest fix for a false positive cluster? — *Model the missing sanitizer as a barrier.*

**Q29.** Why doesn't sanitizing on one `if` branch clear a finding? — *The join unions both paths; the unsanitized branch still carries taint to the sink.*

**Q30.** What kind of analysis is the Checker Framework? — *Pluggable types — taint as a type qualifier (`@Tainted`/`@Untainted`), checked at compile time.*

## Red Flags / Green Flags

**Green flags** (what strong answers sound like):
- Frames everything as source → propagation → sanitizer → sink, then connects it to the CFG/transfer/join machinery.
- Distinguishes **sound** from **complete** crisply and invokes **Rice's theorem** for why both is impossible.
- Knows tools are **"soundy"** and can name the unsound features (reflection, eval, deserialization, native, implicit flows).
- Talks in **trade-offs**: precision vs scalability, the four sensitivity axes and their cost.
- Knows recall depends on **modeling your frameworks**, and that "0 findings ≠ secure."
- Picks engines by job (Semgrep fast/local, CodeQL deep/flow-shaped) rather than dogmatically.

**Red flags**:
- Thinks the sink is the bug, or that banning a function fixes injection.
- Calls any tool "sound" without qualification, or claims a tool has "no false positives."
- Believes `grep`/pattern matching finds interprocedural flows.
- Says "0 findings means the code is secure."
- Can't explain why false positives exist (it's over-approximation) or why false negatives exist (soundy gaps / approximation).
- Confuses transformation (`.upper()`, `.trim()`) with sanitization.

## Cheat Sheet

```
ONE-LINER     tainted value reaches a sink with no sanitizer in between = finding
FRAMEWORK     CFG + transfer functions + join (⊔) + fixpoint; taint = forward + may (⊔=∪)
GREP vs DF    grep matches text; data-flow follows the value's JOURNEY across functions

INTRA vs INTER   intra = one function (FNs across functions); inter = call graph + summaries
SOUND   no false negatives (over-approx → FPs)
COMPLETE no false positives (under-approx → FNs)
RICE'S THEOREM ⇒ can't have both ⇒ all tools approximate; most lean sound
SOUNDY  sound EXCEPT documented gaps (reflection/eval/deser/native/implicit) = FN surface

PRECISION AXES  flow · field (cheap, high value) · context (FP fix for shared helpers) · path (costly)
MODELING        recall = completeness of YOUR source/sink/step/barrier models; 0 findings ≠ secure
ENGINES         Semgrep (fast/local/intra) · CodeQL (deep/interproc) · Infer (sep-logic) · Pysa · Checker Framework (types)
TUNE            barriers → tighten src/sink → context → path(last); baseline legacy, gate on NEW
A FINDING IS A LEAD, not a proof of exploitability
```

## Summary

Interviews on this topic reward conceptual precision over tool trivia. Anchor on the **source → propagation → sanitizer → sink** model, then show you understand it's one instance of the **data-flow framework** (CFG, transfer functions, union join, fixpoint) and that taint is **forward + may**. The two distinctions that separate strong candidates are **intraprocedural vs interprocedural** (where the power and cost live, via call graphs and summaries) and **sound vs complete** (Rice's theorem forbids both, so every tool approximates and is at best **"soundy"** with a documented false-negative surface). Reason fluently about the **precision axes** and their costs, insist that recall depends on **modeling your frameworks**, refuse to equate "0 findings" with "secure," treat a finding as a **lead not a verdict**, and pick **Semgrep vs CodeQL** by the job. Speak in trade-offs and you'll signal real understanding.

## Further Reading

- Aho, Lam, Sethi & Ullman — *Compilers* (Dragon Book), Ch. 9 — data-flow analysis fundamentals.
- Nielson, Nielson & Hankin — *Principles of Program Analysis* — lattices, monotone frameworks, interprocedural analysis.
- Livshits et al. — *In Defense of Soundiness: A Manifesto* (CACM) — the definitive "soundy" reference.
- CodeQL and Semgrep documentation — taint tracking / taint mode, the rule and query syntax referenced above.
- OWASP — SQL Injection, XSS, and Command Injection cheat sheets for the bug-shape vocabulary.

## Related Topics

- [SAST & Security Scanners](../04-sast-security-scanners/) — the product category and program these engines power.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — pattern matching and AST, the layer beneath data-flow.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the runtime taint counterpart that escapes the static blind spots.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — the proof-oriented neighbor of over-approximating analysis.
