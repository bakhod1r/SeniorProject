# Line, Branch & Path Coverage — Interview Questions

> **Roadmap:** [Code Coverage](../README.md) → Line, Branch & Path Coverage
> *A coverage interview rarely asks "what is code coverage." It asks "your dashboard says 95% and a null-check bug still shipped — explain how," and then watches whether you can separate line from branch from condition, name the subsumption hierarchy, and say out loud that the number is a *floor on the untested*, not a measure of the tested. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Metrics](#theme-1--the-metrics)
3. [Theme 2 — Line ≠ Branch](#theme-2--line--branch)
4. [Theme 3 — Subsumption and MC/DC](#theme-3--subsumption-and-mcdc)
5. [Theme 4 — Path Explosion](#theme-4--path-explosion)
6. [Theme 5 — Instrumentation](#theme-5--instrumentation)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Criteria in Practice](#theme-7--criteria-in-practice)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **executed vs tested** (a line ran vs an assertion checked its result)
- **line vs branch vs condition** (a statement ran vs every edge of a decision taken vs every boolean operand exercised)
- **subsumption** (a stronger criterion implies a weaker one, never the reverse)
- **coverage vs adequacy** (high coverage can't *prove* correctness; low coverage *disproves* it)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before quoting a percentage, and who treat the coverage number as evidence of *what wasn't run*, not proof that what ran was correct.

---

## Theme 1 — The Metrics

### Q1.1 — Define statement, branch, condition, and path coverage precisely.

> **Testing:** Whether you can state the four metrics without blurring them — most candidates collapse all four into "lines hit."

**A.** They measure four different things, ordered roughly by strength:

- **Statement / line coverage** — every *statement* (or source line) was executed at least once. The weakest useful metric: it asks "did this code run," nothing about outcomes.
- **Branch / decision coverage** — every *decision* took both outcomes: each `if` evaluated both `true` and `false`, each loop both entered and skipped, each `switch` case and the `default` reached. The unit is the *edge out of a decision point* in the control-flow graph, not the line.
- **Condition coverage** — every *boolean sub-expression* (operand of `&&`/`||`) independently took both `true` and `false`. So in `a && b`, you need `a` true and false, *and* `b` true and false.
- **Path coverage** — every *end-to-end route* through the function's control-flow graph was executed. The strongest and almost always intractable (see Theme 4).

The line that catches people: **line coverage counts statements; branch coverage counts edges of decisions.** A single line can hold an entire decision (`x = a ? b : c;`), and "the line ran" says nothing about which edge was taken.

### Q1.2 — Statement vs line coverage — are they the same thing?

> **Testing:** Whether you notice the granularity mismatch most tools quietly paper over.

**A.** Conceptually close, but not identical, and the gap is a real source of misleading numbers. *Statement* coverage is per-statement; *line* coverage is per-source-line. When you write several statements on one line (`if (x) return; cleanup();`), a line-granular tool may mark the whole line covered once `x` was true, even though `cleanup()` never ran. Conversely, one statement spanning several lines (a multi-line call) can inflate or deflate the line count depending on which physical line the tool attributes execution to. Tools like JaCoCo work at *bytecode instruction* and *branch* granularity and then map back to lines, which is why JaCoCo can show a line as *partially* covered (yellow) — a precision most line-only tools lack. Senior tell: knowing that "line coverage" is an *approximation* of statement coverage filtered through the source formatter.

### Q1.3 — What does condition/decision coverage (C/DC) add over plain decision coverage?

> **Testing:** Whether you understand that decision coverage alone can leave individual operands untested.

**A.** **Decision coverage** only requires the *whole* decision to go both ways; it doesn't care how. With `if (a || b)`, two tests — `a=true,b=false` and `a=false,b=false` — give full decision coverage (the decision was both true and false), yet `b` was never `true`: a bug guarded by `b` alone slips through. **Condition coverage** requires each operand to take both values, but on its own can ironically *miss* the decision outcomes (with the wrong test pairing). **Condition/Decision coverage (C/DC)** is the conjunction: every operand both ways *and* every decision both ways. It closes the obvious holes in each, and it's the natural stepping stone to MC/DC (Theme 3), which adds the *independence* requirement on top.

---

## Theme 2 — Line ≠ Branch

### Q2.1 — Show me code with 100% line coverage but less than 100% branch coverage, and explain it.

> **Testing:** The single most important idea in the topic — that "every line ran" does not mean "every outcome was tested."

**A.** The canonical example is an `if` with no `else`:

```go
func deposit(balance, amount int) int {
    if amount > 0 {        // decision point
        balance += amount  // line A
    }
    return balance         // line B
}
```

One test, `deposit(100, 50)`, executes **every line**: the `if` line, line A, and line B all run. That's **100% line coverage**. But the decision `amount > 0` only ever went **true** — the `false` edge (the implicit "skip the body" path) was never taken. So **branch coverage is 50%**. If there were a bug in how a non-positive amount is handled — say a missing validation that should reject it — line coverage would report green and the bug would ship. This is the gap: line coverage cannot see the *absent* `else`, because there's no line there to mark unexecuted. Branch coverage models the missing edge explicitly and reports it. This single example is why most teams enforce **branch**, not line, as the gate.

### Q2.2 — Same trap with a ternary or a short-circuit. Why is it sneakier there?

> **Testing:** Whether you see that the decision can hide *inside* a line, defeating line coverage by construction.

**A.** Because the entire decision lives on one physical line, line coverage is structurally blind to it:

```go
status := http.StatusOK
if err != nil || payload == nil {   // two conditions, one line
    status = http.StatusBadRequest
}
```

A single test with `err != nil` (and `payload` non-nil) executes both lines and flips the decision once — **100% line, and even 50%+ branch on the whole decision**. But `payload == nil` as an *independent* cause was never the deciding factor; short-circuit evaluation means once `err != nil` is true, `payload == nil` isn't even evaluated. Line coverage says 100%; the second condition is effectively dead in your test suite. You only catch this with **condition** or **MC/DC** coverage, which track each operand of the `||` separately. The lesson: the more logic you pack into one line (ternaries, chained `&&`/`||`), the more line coverage *overstates* how well-tested it is.

### Q2.3 — A teammate says "we're at 100% coverage, we're done." What's wrong with that sentence alone?

> **Testing:** Whether you reflexively ask "*which* coverage?" and "*coverage of what*?"

**A.** Three things are unstated and each can be fatal. **First, which metric** — 100% *line* is a much weaker claim than 100% *branch*, which is weaker than MC/DC; "100%" without the criterion is nearly meaningless. **Second, coverage measures execution, not verification** — a test can run every line with zero assertions and still report 100% (the classic "no-assertion test"), so the suite proves the code *runs*, not that it's *correct*. **Third, coverage is structural, not behavioral** — it can't measure the path you never wrote a line for (the missing `else`, the unhandled error, the boundary you forgot). 100% coverage of the code you wrote says nothing about the code you *should have* written. So the honest reading of "100%" is "no statement is provably untested," which is a floor, not a finish line.

---

## Theme 3 — Subsumption and MC/DC

### Q3.1 — State the subsumption hierarchy of coverage criteria.

> **Testing:** Whether you know the criteria form a partial order, and in which direction.

**A.** "A **subsumes** B" means satisfying A guarantees B is also satisfied (but not vice versa). The chain, strongest to weakest:

```
Path  ⊃  MC/DC  ⊃  Condition/Decision  ⊃  Decision (Branch)  ⊃  Statement (Line)
```

So **full path coverage subsumes MC/DC**, MC/DC subsumes condition/decision, decision coverage subsumes statement coverage (if every branch is taken, every statement ran — barring unreachable code), and so on. The direction is the whole point: **achieving a stronger criterion automatically gives you the weaker ones**, never the reverse. 100% branch implies 100% statement; 100% statement implies *nothing* about branch. Note one subtlety: **condition coverage does not subsume decision coverage** on its own — that's exactly why C/DC and MC/DC bolt the decision requirement on explicitly. Drawing this hierarchy correctly is a strong senior signal.

### Q3.2 — What exactly is MC/DC, and why is it stronger than condition/decision coverage?

> **Testing:** Whether you understand the *independence* requirement, not just "test every condition."

**A.** **MC/DC — Modified Condition/Decision Coverage** — requires, for each boolean condition in a decision, a pair of test cases showing that *condition independently flips the decision's outcome while all other conditions are held fixed*. That word **independently** is the crux. C/DC asks each condition to take both values and the decision to take both values; MC/DC additionally demands you *demonstrate each condition actually matters* by finding two tests differing only in that one condition and producing different decision results. This rules out a condition that's present in the source but has no real effect on the outcome (dead logic), and it does so without the combinatorial blowup of testing all 2ⁿ operand combinations. It's the sweet spot between "cheap but weak" (decision) and "complete but exponential" (multiple-condition / path).

### Q3.3 — For an expression with n independent conditions, how many test cases does MC/DC need?

> **Testing:** Real math, not a hand-wave — this number comes up constantly in safety-critical work.

**A.** MC/DC needs a *minimum* of **n + 1** test cases for `n` independent conditions, versus **2ⁿ** for exhaustive multiple-condition coverage. That's the entire economic argument for MC/DC: it scales **linearly**, not exponentially. Concretely, for `a && b && c` (n = 3): exhaustive is 2³ = 8 combinations, but MC/DC needs only 4. A minimal MC/DC set:

```
Test 1: a=T, b=T, c=T  → decision T   (baseline, all true)
Test 2: a=F, b=T, c=T  → decision F   (flips a; isolates a's effect)
Test 3: a=T, b=F, c=T  → decision F   (flips b; isolates b's effect)
Test 4: a=T, b=T, c=F  → decision F   (flips c; isolates c's effect)
```

Each of tests 2–4 differs from the all-true baseline in exactly one condition and changes the outcome, proving that condition's independence. Four tests, n + 1 = 4. ✓ (The exact set depends on the operators; with mixed `&&`/`||` you pick pairs that demonstrate independence, but the lower bound stays n + 1 and the upper practical bound is 2n.)

### Q3.4 — Why does DO-178C mandate MC/DC, and only for the highest assurance level?

> **Testing:** Whether you connect a coverage criterion to risk tiering and cost.

**A.** **DO-178C** is the avionics software certification standard, and it scales the required coverage to the **failure severity** of the software, classified Level A through E:

- **Level A** (failure is *catastrophic* — e.g. flight control): **MC/DC** required.
- **Level B** (*hazardous*): decision + statement coverage.
- **Level C** (*major*): statement coverage.
- **Levels D/E** (*minor* / *no effect*): progressively less.

MC/DC is mandated only at Level A because it's the strongest criterion that's still **tractable** (n + 1, not 2ⁿ) — it gives near-exhaustive confidence in boolean logic without the exponential cost that full multiple-condition or path coverage would impose. The tiering is a deliberate **cost-vs-risk** trade: you pay for MC/DC's rigor only where a software fault can kill people. A candidate who says "DO-178C requires 100% coverage" has missed the point — it requires *the criterion appropriate to the failure class*, and MC/DC sits at the top precisely because it's the rigor ceiling you can actually afford.

---

## Theme 4 — Path Explosion

### Q4.1 — Why is 100% path coverage almost never achievable?

> **Testing:** Whether you understand combinatorial path growth and loops.

**A.** Because the number of paths through a control-flow graph grows **multiplicatively** with sequential decisions and becomes **unbounded** with loops. Put `k` independent `if`s in sequence and you have up to **2ᵏ** distinct paths — 20 such branches is over a million paths. Add a loop and it's worse: a loop that can run 0..n times multiplies the paths by every distinct iteration count, and a loop with no fixed bound has *infinitely many* paths. Most real functions therefore have an astronomical or infinite path count, so enumerating tests for all of them is impossible in principle, not just impractical. Path coverage is the theoretical top of the hierarchy and a practical non-starter for anything beyond trivial code — which is exactly why we need a *tractable proxy*.

### Q4.2 — What's the tractable proxy, and how does cyclomatic complexity define it?

> **Testing:** Whether you know basis-path testing and the McCabe number.

**A.** The proxy is **basis path coverage**, and the count comes from **cyclomatic complexity (CC)**. CC = `E − N + 2P` (edges − nodes + 2× connected components) for a control-flow graph, or pragmatically **1 + the number of decision points** (each `if`, `case`, `&&`, `||`, loop adds one). CC equals the number of **linearly independent paths** through the function — the size of a *basis* set from which every other path can be constructed as a combination. So instead of all 2ᵏ or infinite paths, basis-path testing requires **CC test cases** covering the independent paths, a linear, achievable target that still exercises the structural skeleton. CC doubles as a design signal: a function with CC = 30 is both expensive to cover *and* a refactoring candidate — the coverage cost is telling you the function does too much.

### Q4.3 — What does data-flow / def-use coverage capture that control-flow coverage misses?

> **Testing:** Whether you know coverage families beyond control flow.

**A.** Control-flow criteria (line/branch/path) care about *which code ran*; **data-flow coverage** cares about *how values move* — specifically the **def-use pairs**: a *definition* (where a variable is assigned) and a *use* (where it's read). **All-defs** requires each definition reach at least one use; **all-uses** requires every definition-to-use pair be exercised by some path. This catches a class of bug control flow is blind to: a variable defined on one branch and used on another, an uninitialized read, a stale value used after a conditional reassignment. You can have 100% branch coverage and still never exercise the *specific* def-on-path-A → use-on-path-B pairing that triggers the bug. Data-flow coverage sits between branch and path in practical strength and is the right tool when correctness hinges on value propagation rather than control structure.

---

## Theme 5 — Instrumentation

### Q5.1 — How is coverage actually collected? Contrast the main techniques.

> **Testing:** Whether you know coverage is *measured by adding code/counters*, and the trade-offs of where that happens.

**A.** Every technique works by recording which code locations executed; they differ in *where* the recording is injected:

- **Source instrumentation** — a preprocessor rewrites the source to insert counters (e.g. Go's `go test -cover` rewrites the AST to add a `count[i]++` at the start of each basic block before compiling). Accurate line/branch mapping, but it changes the code you compile.
- **Bytecode / IR instrumentation** — inject probes into compiled bytecode (JaCoCo modifies JVM class files, on-the-fly via a Java agent or offline). No source change, language-runtime-level precision, but mapping back to source lines depends on debug info.
- **Compiler-emitted counters** — the compiler natively emits instrumentation (`gcc/clang --coverage` → gcov; LLVM source-based coverage via `-fprofile-instr-generate -fcoverage-mapping`). Tightest integration with optimization and the most accurate region mapping.

In all cases the run produces a **coverage data file** (`.gcda`, `coverage.out`, JaCoCo `.exec`) that a reporter turns into line/branch percentages. The common pitfall: instrumentation perturbs timing and can mask or create concurrency bugs, so a coverage run is not a substitute for a clean test run.

### Q5.2 — How do short-circuit operators and exceptions complicate branch instrumentation?

> **Testing:** The subtle cases that separate "I read the docs" from "I've debugged a coverage report."

**A.** Both create *implicit* branches that a naive line-based instrumenter misses. **Short-circuiting**: `a && b` is really a hidden `if (a) { evaluate b }` — `b` is only evaluated when `a` is true. So a faithful tool treats each `&&`/`||` operand as its own branch point; otherwise `a && b` looks like one expression and you never learn that `b` was never evaluated when `a` was false. That's why condition coverage requires per-operand probes, not per-line. **Exceptions**: any statement that can throw creates an implicit edge to the handler / function exit that no `if` marks. A `try` body has a branch at *every* potentially-throwing call (the "normal completion" vs "threw" edges), so exception-aware coverage tools insert probes on those edges — and this is why a `catch` block showing as uncovered is common: the happy path never threw. A senior answer names both as *control-flow edges the source syntax doesn't visibly spell out*.

### Q5.3 — Explain Go's `-covermode` values: `set`, `count`, `atomic`. When does each apply?

> **Testing:** Concrete, current tooling knowledge — and the concurrency gotcha.

**A.** `-covermode` controls *what the per-block counter records* in Go's coverage instrumentation:

- **`set`** (the default for non-`-race` runs) — boolean: *was this block executed at all* (counter is 0 or 1). Cheapest; answers "covered / not covered."
- **`count`** — integer: *how many times* each block executed. Lets you see hot vs cold covered blocks, useful for finding barely-exercised paths, but the increment is a plain non-atomic `++`.
- **`atomic`** — like `count` but uses `sync/atomic` increments, so the counts are **correct under concurrent execution**. It's *required* with `-race` and is the right choice whenever instrumented code runs across multiple goroutines, because non-atomic `count` increments would race and produce both data-race reports and wrong totals.

The rule of thumb: `set` for a quick pass/fail gate, `count` for single-threaded hotspot analysis, **`atomic` for any concurrent or `-race` build** (you trade a little speed for correct counts). Choosing `count` on a heavily concurrent test suite is the classic mistake — undercounted blocks and a polluted race report.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — Your report says 95% line coverage, but a null-pointer bug shipped on a checked path. Explain how that's possible.

> **Testing:** Whether you can enumerate the *concrete* ways high line coverage coexists with shipped bugs — the heart of "what coverage doesn't tell you."

**A.** Several mechanisms, and a strong answer lists more than one:

1. **The bug is in the missing 5% — or in code that has no line at all.** The unhandled-null branch may be the `else` you never wrote; there's no line to show red. Line coverage can't flag *absent* code.
2. **The line ran but nothing asserted on it.** A test executed the null-handling line during setup with no assertion checking the result — execution without verification. 95% *executed*, not 95% *verified*.
3. **Line ran, wrong branch.** The null-check line is covered because the *non-null* path ran; the `== nil` edge was never taken. This is exactly the line≠branch gap — branch coverage would expose it, line coverage hides it.
4. **The input combination was never exercised.** With `a && b`, the specific `a=true, b=nil` pairing that triggers the deref might never occur even at 100% line, because short-circuiting and partial condition coverage left it out.
5. **Coverage is structural, behavior is not.** Even 100% MC/DC can't catch a wrong *value*, an off-by-one, or a missing requirement — coverage measures code reached, never correctness of what it computed.

The framing to deliver: coverage is a **floor on the untested** (it proves what *didn't* run), never a ceiling on quality. 95% line just means ~5% is *provably* untouched; it says nothing reassuring about the 95%.

### Q6.2 — Given all that, which single criterion would you enforce as a CI gate, and why?

> **Testing:** Whether you can commit to a defensible default and justify the trade-off.

**A.** For general application code I'd gate on **branch (decision) coverage**, not line. The reasoning: branch is the **cheapest criterion that closes the line≠branch gap** — it forces every decision to go both ways, catching the missing-`else` and untested-error-path bugs that line coverage structurally cannot see, while still being achievable without the test explosion of condition/MC/DC. I'd set the threshold on **new/changed code (diff coverage)** rather than the whole repo, so legacy code doesn't either block delivery or get grandfathered into permanent neglect. I would *not* chase 100% — the last few percent is usually defensive code, generated code, or unreachable error branches where the test cost exceeds the bug-finding value, and a 100% mandate breeds assertion-free tests gaming the number. The one place I'd escalate beyond branch is **safety-critical or security-critical modules**, where MC/DC (or at least condition/decision) is warranted. Summary: branch coverage on the diff as the default gate; MC/DC reserved for code where a fault is catastrophic.

### Q6.3 — A team hits 100% by writing tests with no assertions just to clear the gate. How do you detect and fix this?

> **Testing:** Whether you know coverage is *gameable* and what counters it.

**A.** This is **coverage gaming**, and the tell is high coverage with low defect-detection. To **detect** it: run **mutation testing** — deliberately inject faults (flip a `>` to `>=`, negate a condition, swap `+`/`-`) and check whether the suite *catches* them. Assertion-free tests execute the mutated line but don't fail, so the mutation *survives*; a low **mutation score** despite high line coverage is the signature of vacuous tests. Secondary signals: lint for tests with zero assertions, review test/assertion-count ratios, watch for suspiciously fast green builds on critical code. To **fix** the incentive: stop treating the coverage number as the goal (Goodhart's law — "when a measure becomes a target, it ceases to be a good measure"), gate on **mutation score** for critical modules instead of or alongside line coverage, and make coverage a *diagnostic in review* ("what's the uncovered branch and is it risky?") rather than a vanity metric on a dashboard. Coverage tells you what *wasn't* tested; mutation testing tells you whether what *was* tested is actually checked.

### Q6.4 — Coverage on a module is stuck at 70% and the team says the rest is "untestable." How do you respond?

> **Testing:** Whether you treat low coverage as a *design* signal, not just a testing gap.

**A.** "Untestable" is almost always a **design** statement in disguise, and I'd read the uncovered 30% as a map of the problem. Typical causes and responses: code with **hidden dependencies** (direct calls to the clock, network, filesystem, globals) that can't be driven from a test — fix by injecting those dependencies so the branches become reachable; **high cyclomatic complexity** where the path count makes coverage genuinely expensive — fix by decomposing the function (the CC was already telling you it does too much); **dead or defensive code** (the `default:` that can't occur, the re-checked invariant) — either prove it unreachable and exclude it deliberately with an annotated ignore, or delete it. The point is that uncovered code is *evidence*: a branch you can't reach from a test is usually a branch coupled to something it shouldn't be. So the answer isn't "lower the threshold," it's "let the coverage gap drive a refactor toward testable seams," and only *then* exclude the genuinely-unreachable remainder with a documented annotation so the number reflects reality.

---

## Theme 7 — Criteria in Practice

### Q7.1 — When is branch coverage "enough," and when must you go further?

> **Testing:** Whether you can tier the criterion to the risk, rather than applying one rule everywhere.

**A.** **Branch is enough** for the large majority of business/application code: it catches the dominant bug class (untested decision outcomes, missing error handling) at a cost teams can sustain, and beyond it the marginal bug-detection per extra test drops sharply. **Go further when the cost of a fault rises** or the logic is dense:

- **Complex boolean logic** (authorization rules, pricing/eligibility engines, protocol state checks) — use **condition or MC/DC** because the bugs hide *between* operands of `&&`/`||`, exactly where branch coverage is blind.
- **Safety-critical / regulated** code (avionics DO-178C Level A, medical IEC 62304 Class C, automotive ISO 26262 ASIL D) — **MC/DC** is mandated, not optional.
- **Security-sensitive** decision points (access checks, input validation) — push toward condition/MC/DC plus mutation testing, since a single un-exercised operand can be the vulnerability.
- **Value-propagation-heavy** code — add **data-flow (def-use)** coverage where correctness is about *which value reaches which use*, not control structure.

The senior framing: coverage criterion is a **dial set per risk class**, defaulting to branch and turned up to MC/DC exactly where a fault is catastrophic, dense in boolean logic, or legally required.

### Q7.2 — Walk me through choosing a coverage strategy for a new service with a critical payments core and a routine CRUD admin panel.

> **Testing:** Whether you apply differentiated gates within one codebase instead of one blanket number.

**A.** I'd set **different gates for different blast radii**, because a uniform threshold either over-tests the trivial or under-tests the dangerous:

- **Payments core** (money movement, idempotency, ledger invariants): gate on **branch coverage with a high bar plus MC/DC on the boolean-dense decisions** (eligibility, fraud checks), and add **mutation testing** as the real adequacy measure — coverage proves the branches ran, mutation proves the assertions catch faults. The cost is justified by the failure cost.
- **CRUD admin panel**: **branch coverage on the diff** at a moderate threshold is plenty; chasing MC/DC here is wasted effort on low-risk code, and a 100% mandate would just produce vacuous tests.
- **Cross-cutting**: enforce on **changed code (diff coverage)** in PRs so the gate guides new work without holding delivery hostage to legacy debt, and treat the coverage report as a *review input* (which uncovered branch, how risky) rather than a pass/fail idol.

The principle I'd articulate: **match the criterion to the consequence of failure.** One repo, two (or more) gates — strict and mutation-backed where faults are expensive, lightweight where they aren't. That's the difference between using coverage as a risk tool and using it as a vanity metric.

### Q7.3 — How do coverage requirements differ across DO-178C, ISO 26262, and IEC 62304?

> **Testing:** Breadth across the safety standards that actually drive MC/DC adoption.

**A.** All three **scale the required structural coverage to a risk level**, which is the unifying idea, but they live in different domains:

- **DO-178C** (avionics): five **Design Assurance Levels** A–E by failure severity; **MC/DC at Level A**, decision + statement at B, statement at C.
- **ISO 26262** (automotive functional safety): four **ASIL** levels A–D; recommends branch coverage at lower ASILs and **MC/DC at ASIL D** (the most hazardous, e.g. steering/braking control).
- **IEC 62304** (medical device software): three safety **Classes** A–C by potential for injury; the higher classes drive rigorous structural coverage including MC/DC-level expectations for Class C.

The pattern to state: each standard ties coverage rigor to *how badly a fault can hurt someone*, and **MC/DC consistently sits at the top tier** of each because it's the strongest criterion that remains tractable (n + 1 tests). A candidate who knows even two of these and the common "rigor scales with risk, MC/DC at the ceiling" principle is signalling genuine safety-critical exposure.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Line vs branch coverage in one line?** A: Line = every statement ran; branch = every decision took both true and false. A line can run while a branch is half-covered.
- **Q: Does 100% statement coverage imply 100% branch?** A: No — statement is *weaker*; branch implies statement, never the reverse.
- **Q: What's the subsumption order?** A: Path ⊃ MC/DC ⊃ Condition/Decision ⊃ Branch ⊃ Statement.
- **Q: Minimum MC/DC tests for n conditions?** A: n + 1 (vs 2ⁿ for exhaustive multiple-condition).
- **Q: MC/DC tests for `a && b && c`?** A: 4 (n + 1 with n = 3).
- **Q: Why is path coverage impractical?** A: Paths grow as 2ᵏ with sequential branches and become infinite with unbounded loops.
- **Q: Cyclomatic complexity formula?** A: `E − N + 2P`, or pragmatically 1 + number of decision points; equals the count of basis paths.
- **Q: What does branch coverage catch that line coverage misses?** A: The untaken edge — the missing `else`, the loop that never skipped, the case never hit.
- **Q: What does MC/DC add over C/DC?** A: The *independence* requirement — each condition must be shown to flip the decision on its own.
- **Q: Why does DO-178C Level A require MC/DC?** A: Catastrophic-failure software needs near-exhaustive boolean rigor that's still tractable (n + 1, not 2ⁿ).
- **Q: What is def-use (data-flow) coverage?** A: Exercising definition→use pairs of a variable; catches value-propagation bugs control flow misses.
- **Q: Go's three covermodes?** A: `set` (executed yes/no), `count` (how many times), `atomic` (count, concurrency-safe, required with `-race`).
- **Q: How is coverage instrumented?** A: Counters injected at source, bytecode/IR, or by the compiler; the run emits a data file a reporter turns into percentages.
- **Q: Why might a `catch` block show as uncovered?** A: The happy path never threw, so the exception edge to the handler was never taken.
- **Q: One way to detect assertion-free tests gaming coverage?** A: Mutation testing — vacuous tests let injected faults survive, so the mutation score stays low despite high coverage.
- **Q: Coverage measures execution or correctness?** A: Execution. It's a floor on the untested, never proof the executed code is correct.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Using "coverage" to mean only line coverage, never asking "which criterion?"
- Claiming 100% coverage means the code is correct or bug-free.
- Getting the subsumption direction backwards ("statement coverage implies branch").
- Saying MC/DC needs 2ⁿ tests, or not knowing the n + 1 figure.
- Treating "we'll just do path coverage" as a real plan.
- Equating "executed" with "tested" — forgetting tests can have no assertions.
- Reacting to low coverage with "lower the threshold" instead of "why is this untestable?"

**Green flags:**
- Naming the *distinction* (line vs branch, executed vs verified, coverage vs adequacy) before quoting a number.
- Reaching for the line≠branch example (`if` with no `else`) unprompted.
- Drawing the subsumption hierarchy correctly and noting condition coverage doesn't subsume decision.
- Citing n + 1 for MC/DC and walking the `a && b && c` test table.
- Framing coverage as a *floor on the untested*, and reaching for mutation testing to measure adequacy.
- Tiering the criterion to risk (branch by default, MC/DC for safety/security/dense-boolean).
- Reading uncovered code as a *design* signal (testable seams, dependency injection) rather than a testing chore.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **executed vs tested**, **line vs branch vs condition**, **subsumption** (stronger implies weaker, never the reverse), and **coverage vs adequacy** (coverage disproves testing, it can't prove correctness). Name the distinction first; the percentage follows.
- **The metrics:** statement (a line ran) < branch (every decision edge taken) < condition (every operand both ways) < path (every route). Line coverage counts statements; branch counts decision edges — a decision can hide inside one line.
- **Line ≠ branch:** the `if`-with-no-`else` gives 100% line and 50% branch; branch coverage models the *absent* edge that line coverage is structurally blind to. This is why teams gate on branch.
- **Subsumption and MC/DC:** Path ⊃ MC/DC ⊃ C/DC ⊃ Branch ⊃ Statement. MC/DC adds *independence* (each condition flips the decision alone) and needs **n + 1** tests, not 2ⁿ — which is why DO-178C Level A mandates it.
- **Path explosion:** paths grow 2ᵏ with sequential branches and go infinite with loops, so 100% path is intractable; **cyclomatic complexity** gives the tractable **basis-path** proxy, and **def-use** coverage catches value-flow bugs control flow misses.
- **Instrumentation:** counters injected at source, bytecode/IR, or by the compiler; short-circuit `&&`/`||` and exception edges are *implicit* branches a faithful tool probes per-operand; Go's `-covermode` is `set`/`count`/**`atomic`** (the last required under `-race`/concurrency).
- **Judgment:** 95% line coexists with shipped bugs (missing branch, no assertion, untested input, structural-not-behavioral); gate on **branch coverage of the diff** by default, escalate to **MC/DC + mutation testing** for safety/security/payments code, and read low coverage as a *refactor* signal.

---

## Further Reading

- *Introduction to Software Testing* (Ammann & Offutt) — the authoritative treatment of coverage criteria, subsumption, and the logic-coverage (MC/DC) and data-flow chapters.
- **DO-178C** and its supplement on structural coverage, plus Hayhurst et al., *A Practical Tutorial on Modified Condition/Decision Coverage* (NASA/TM-2001-210876) — the readable primary source on MC/DC and the n + 1 result.
- *The Art of Software Testing* (Myers) — the classic origin of the decision/condition coverage definitions.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- `go help testflag` (the `-cover`, `-covermode`, `-coverprofile` flags), the JaCoCo documentation on counters and branch coverage, and `man gcov` — primary sources for the tooling the answers reference.

---

## Related Topics

- [02 — Mutation Coverage](../02-mutation-coverage/interview.md) — the criterion that measures *test adequacy* where line/branch coverage measures only execution; the answer to coverage gaming.
- [05 — What Coverage Does Not Tell You](../05-what-coverage-does-not-tell-you/interview.md) — the limits, the gaming, and the "floor not ceiling" framing made explicit.
- [Code Coverage README](../README.md) — where line/branch/path coverage sits among the coverage criteria.
- [Quality Engineering README](../../README.md) — where coverage fits in the broader testing and quality landscape.
