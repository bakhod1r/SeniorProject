# Evaluation Order & Sequencing — Tasks & Exercises

> **Topic:** [Evaluation Order & Sequencing](README.md)

---

## How to Use This Page

Each task states a goal, gives a self-check you can run mentally or on a compiler, and hides hints and a sparse solution behind collapsible sections. Resist opening the solution until you've committed to an answer. For the "is this defined?" tasks, *always state the language and standard era* before answering — that discipline is the whole point.

Tasks are grouped by tier:

- **Warm-up (Junior):** precedence vs. order, short-circuit, the basic traps.
- **Core (Middle):** sequence points, the sequenced-before trichotomy, era-dependent verdicts.
- **Advanced (Senior):** init order, the bridge to concurrency, `volatile`.
- **Mastery (Professional):** optimizer behavior, hoisting, FFI, floating-point.

---

## Warm-up (Junior)

### Task 1 — Predict the print order

Given (Python):

```python
def t(name, v):
    print(name)
    return v

r = t("A", 1) + t("B", 2) * t("C", 3)
print(r)
```

**Self-check:** Write down (a) the value of `r` and (b) the exact sequence of printed lines. Explain which fact comes from precedence and which from evaluation order.

<details><summary>Hint</summary>

Precedence decides that `B*C` is computed before adding `A`. Evaluation order decides which of `A`, `B`, `C` *prints* first. Python is left-to-right.
</details>

<details><summary>Solution (sparse)</summary>

`r = 1 + (2*3) = 7` (precedence). Print order: `A`, `B`, `C` (left-to-right evaluation order). The value comes from precedence; the print order from order. They are independent.
</details>

---

### Task 2 — Classify each as safe / unspecified / undefined (C)

```c
1)  if (p != NULL && p->x > 0) {...}
2)  printf("%d %d", i++, i++);
3)  a[i] = i++;
4)  x = (a, b);
5)  y = f() + g();   // f and g both print
```

**Self-check:** For each, in C, label it *safe*, *unspecified order (but defined value)*, or *undefined behavior*, and justify in one sentence.

<details><summary>Hint</summary>

Short-circuit guarantees order. The comma *operator* guarantees order. Unsequenced modification of the same scalar is UB. Function-argument order is unspecified.
</details>

<details><summary>Solution (sparse)</summary>

1) Safe — `&&` sequences the null check before the dereference.
2) UB — two unsequenced modifications of `i` (and the arg order is also unspecified).
3) UB in C — read of `i` (index) conflicts with write of `i` (`i++`).
4) Safe — comma *operator* sequences `a` before `b`; `x = b`.
5) Defined value (`f()+g()`), but the *print order* is unspecified.
</details>

---

### Task 3 — Fix the dereference-before-check bug

```c
if (node->next != NULL && node != NULL)
    use(node->next);
```

**Self-check:** Why can this crash, and how do you fix it without adding a statement?

<details><summary>Solution (sparse)</summary>

The left operand `node->next` dereferences `node` *before* the `node != NULL` check (left-to-right `&&`). Swap the operands: `if (node != NULL && node->next != NULL)`. The ordering of `&&` is the fix.
</details>

---

### Task 4 — `i = i++` across languages

**Self-check:** State the value of `i` after `i = i++;` (starting from `i = 0`) in (a) C, (b) Java. Explain the difference.

<details><summary>Solution (sparse)</summary>

(a) C: **undefined behavior** — no answer. (b) Java: `i == 0`. Java evaluates `i++` (result 0, side effect sets `i=1`), then assigns the saved 0 back over the 1. Java's *specified* order makes the expression defined; C's unsequenced double-modification makes it UB.
</details>

---

## Core (Middle)

### Task 5 — Locate the sequence points

```c
x = (a++, b++) + (c && d++);
```

**Self-check:** List every sequence point in this full expression and state whether any scalar is modified more than once between sequence points.

<details><summary>Hint</summary>

Sequence points sit after the left of the comma operator, after the left of `&&`, and at the end of the full expression.
</details>

<details><summary>Solution (sparse)</summary>

Sequence points: after `a++` (comma operator), after `c` (`&&`), and at the `;`. `a`, `b`, `c`, `d` are each modified at most once between sequence points (and `d++` only runs if `c` is true). No single scalar is modified twice between two sequence points, so — assuming `a,b,c,d` are distinct objects — this is *defined*. (The order of the two top-level parenthesized groups relative to each other is unspecified, but they touch different objects, so no UB.)
</details>

---

### Task 6 — Era-dependent verdict

```c
a[i] = i++;
```

**Self-check:** Give the verdict in (a) C, (b) C++14, (c) C++17. Explain the C++17 change.

<details><summary>Solution (sparse)</summary>

(a) C: UB. (b) C++14: UB. (c) C++17: **defined** — C++17 sequences the assignment's RHS (`i++`) before its LHS value computation (`a[i]`'s index), so the index uses the *old* `i`. Always state the era before answering.
</details>

---

### Task 7 — Unsequenced vs. indeterminately-sequenced

**Self-check:** Classify each pair of evaluations as sequenced-before, indeterminately-sequenced, or unsequenced, and say which (if any) are UB given a conflict:

1. The left and right operands of `&&`.
2. The two arguments `a` and `b` in `f(a, b)`.
3. The two `i++` sub-expressions in `f(i++, i++)`.

<details><summary>Solution (sparse)</summary>

1) Sequenced-before (left before right). 2) Indeterminately-sequenced — ordered but unknown which, no overlap → merely unspecified. 3) Unsequenced relative to each other → with the conflicting writes to `i`, undefined behavior.
</details>

---

### Task 8 — Comma operator vs. separator

**Self-check:** What does each print, and which uses the comma *operator*?

```c
int x = (printf("L\n"), 5);          // (A)
printf("%d\n", (one(), two()));      // (B), one() and two() each print their name
```

<details><summary>Solution (sparse)</summary>

(A) prints `L`, then `x = 5` — comma *operator*, guaranteed left-then-right. (B): the inner `(one(), two())` is *also* the comma operator (single expression in parens), so it prints `one` then `two`, and passes `two()`'s result. Both use the operator. (If it were `f(a, b)` with a top-level separator, no order would be guaranteed.)
</details>

---

## Advanced (Senior)

### Task 9 — Member initialization order

```cpp
struct Rect {
    int area;
    int w;
    int h;
    Rect(int W, int H) : w(W), h(H), area(w * h) {}
};
```

**Self-check:** What is `area` after `Rect(3, 4)`? Why? How do you fix it?

<details><summary>Hint</summary>

Members initialize in *declaration* order, not initializer-list order.
</details>

<details><summary>Solution (sparse)</summary>

`area` is declared *first*, so it initializes before `w` and `h` — reading uninitialized `w` and `h`. Result: garbage (UB). Fix: declare `w` and `h` before `area`, or compute `W*H` directly: `area(W * H)`. Enable `-Wreorder -Werror`.
</details>

---

### Task 10 — Reproduce and cure the static init order fiasco

**Goal:** In two `.cpp` files, define a global `Registry` and a global `Plugin` whose constructor uses the registry. Show it can be UB, then cure it.

**Self-check:** Why is the eager version unsafe, and how does construct-on-first-use guarantee correctness?

<details><summary>Solution (sparse)</summary>

Eager: `Plugin g_plugin(g_registry);` in one TU and `Registry g_registry;` in another — cross-TU init order is *unspecified*, so `g_plugin` may construct before `g_registry` exists. Cure: `Registry& registry() { static Registry r; return r; }` and construct `Plugin g_plugin(registry());`. The function-local static is constructed on first call (thread-safe since C++11), so the *dependency*, not link order, drives the sequence.
</details>

---

### Task 11 — Why program order ≠ visible order across threads

```cpp
// Thread 1:  data = 42; ready = true;
// Thread 2:  if (ready) use(data);
```

**Self-check:** Why might Thread 2 read `data == 0` even though `data = 42` is sequenced-before `ready = true`? Make it correct.

<details><summary>Solution (sparse)</summary>

`sequenced-before` only orders operations *within* Thread 1; it creates no happens-before edge to Thread 2. The compiler or CPU may publish `ready` before `data`, or Thread 2 may observe them reordered. Fix: make `ready` a `std::atomic<bool>`, store with `memory_order_release`, load with `memory_order_acquire`. That synchronizes-with edge splices the two threads' program orders into happens-before.
</details>

---

### Task 12 — `volatile` does not fix publication

**Self-check:** Why is `volatile bool ready;` insufficient to publish `data` to another thread in C/C++? What do you use instead?

<details><summary>Solution (sparse)</summary>

`volatile` orders only `volatile`-vs-`volatile` accesses, gives no atomicity, establishes no inter-thread happens-before, and emits no fence — so the non-`volatile` write to `data` is not published. Use `std::atomic` with release/acquire (or a mutex). `volatile` is for hardware registers and signal flags only. (Note: Java's `volatile` is different — it *does* have acquire/release semantics.)
</details>

---

## Mastery (Professional)

### Task 13 — Hoist side effects to make order irrelevant

```c
render(config(), config());
foreign_call(pop(), pop());
```

**Self-check:** Rewrite both so the number of calls and their order are explicit and reorder-proof, and explain why this matters at an FFI boundary.

<details><summary>Solution (sparse)</summary>

```c
Config c1 = config();
Config c2 = config();
render(c1, c2);

Item a = pop();
Item b = pop();
foreign_call(a, b);
```

Argument evaluation happens in the *host* language's (in C: unspecified) order before crossing the ABI; binding to named temporaries fixes the order via statement sequencing and removes the dependence on argument-evaluation order entirely.
</details>

---

### Task 14 — UB is not "a random value"

**Self-check:** Explain why `int x = i++ + i++;` is dangerous beyond producing an unexpected number. Give a concrete way the optimizer can make it worse.

<details><summary>Solution (sparse)</summary>

It is undefined behavior, which licenses the optimizer to assume the code is unreachable. Beyond an unexpected `x`, the optimizer may delete a downstream check (e.g. a null or bounds check) that "guards" a path it proves leads to UB, turning a benign bug into a miscompilation or security hole. Reasoning about "the value" is meaningless; the only fix is removing the UB.
</details>

---

### Task 15 — Floating-point order is observable

```c
double s = 0;
for (int i = 0; i < n; i++) s += x[i];
```

**Self-check:** Can the compiler reorder/reassociate these additions for speed? Under what flag? What's the risk?

<details><summary>Solution (sparse)</summary>

Not by default — floating-point addition is not associative, so the order/association is *observable* and the as-if rule forbids reordering. Only `-ffast-math` / `-funsafe-math-optimizations` permit it, at the cost of reproducibility, altered NaN/inf handling, and breaking algorithms like Kahan summation that depend on the exact order. Treat fast-math as an explicit, documented, per-target decision.
</details>

---

### Task 16 — Multiple-expansion macro trap

```c
#define MAX(a, b) ((a) > (b) ? (a) : (b))
int m = MAX(i++, j);
```

**Self-check:** What's the bug, and how do you make the macro safe?

<details><summary>Solution (sparse)</summary>

`i++` is expanded twice on the chosen branch (`(i++) > (b) ? (i++) : ...`), so `i` may be incremented twice — a side-effect-multiplication bug, and combined with sequencing it can be UB. Fix: use an inline function, or a statement-expression macro that evaluates each argument into a temporary exactly once: `({ typeof(a) _a=(a); typeof(b) _b=(b); _a>_b?_a:_b; })`.
</details>

---

### Task 17 — Design a team-wide guardrail (open-ended)

**Goal:** Draft a 5-point policy that makes evaluation-order/sequencing UB structurally rare across a large polyglot codebase.

**Self-check:** Does each point either *detect* or *prevent* the bug class? Does it cover the FFI boundary and floating-point reproducibility?

<details><summary>Sample answer (sparse)</summary>

1. `-Werror=sequence-point` / `-Werror=unsequenced` on every C/C++ target; clang-tidy ruleset.
2. House style: one observable side effect per statement; never read+write a scalar in one expression.
3. FFI/vararg/macro arguments must be bound to named temporaries before the call.
4. UBSan/ASan/TSan in CI; audit for dormant UB before every toolchain upgrade.
5. Floating-point reproducibility is an explicit per-module decision; `-ffast-math` is opt-in and documented.
</details>

---

## Self-Assessment Checklist

- [ ] I can explain why precedence ≠ evaluation order with a concrete example.
- [ ] I can label any C expression as safe / unspecified / undefined and justify it via the sequence-point rule.
- [ ] I can state the verdict on `a[i] = i++` in C, C++14, and C++17 and explain the difference.
- [ ] I can distinguish sequenced-before, indeterminately-sequenced, and unsequenced.
- [ ] I know which languages pin left-to-right order and where Python/Go have subtleties.
- [ ] I can explain member-init order and the static-init-order fiasco, and cure both.
- [ ] I can explain why single-thread program order doesn't order operations across threads.
- [ ] I know exactly what `volatile` does and does not guarantee in C/C++.
- [ ] I understand that UB licenses the optimizer to delete code, not just produce a random value.
- [ ] I know floating-point order is observable and the `-ffast-math` trade-off.
