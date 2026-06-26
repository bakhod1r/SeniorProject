# Dependent & Refinement Types — Interview Questions

> **Topic:** [Dependent & Refinement Types](README.md)
> **Focus:** A graded question bank — conceptual foundations, language-specific (Idris/Agda/Coq/Lean dependent; Liquid Haskell/F\*/Dafny refinement; TypeScript/Rust tastes), tricky traps, and design judgment.

---

## How to use this file

Questions are grouped: **Conceptual**, **Language-Specific**, **Tricky-Trap**, and **Design**. Each has a model answer. Read the question, answer it aloud or in writing, *then* check. The trap questions are where senior candidates separate from juniors — they probe whether you understand the *boundaries* of these systems, not just the slogans.

---

## Conceptual

## Question 1

**What is the difference between a refinement type and a dependent type?**

A **refinement type** is a base type plus a predicate: `{ v: Int | v > 0 }` is the integers restricted to the positive ones. The predicate is typically discharged automatically by an SMT solver. A **dependent type** is a type that *mentions a value* — `Vec n a`, a vector whose length `n` is part of the type — so the type can vary with a runtime value. Refinement types are a (less expressive, more automatable) point; full dependent types are maximally expressive but often require manual proofs. The slogan: refinement = "type + condition, SMT checks it"; dependent = "type that depends on a value, you may have to prove it."

## Question 2

**Give the canonical example showing why dependent types eliminate a bug class.**

The length-indexed vector `Vec n a`. Define `head : Vec (S n) a -> a` — its argument type is "a vector of length at least one." The empty vector has type `Vec 0 a`, which does *not* match `Vec (S n) a`, so calling `head` on it is a **compile error**, not a runtime crash. Similarly `append : Vec n a -> Vec m a -> Vec (n+m) a` forces the implementation to produce a vector of exactly the summed length. The empty-list crash and off-by-one bugs become unrepresentable.

## Question 3

**What does "a type that depends on a value" mean, and why is it unusual?**

In most languages there's a strict separation: *values* exist at runtime, *types* are checked at compile time, and types never contain values. Dependent typing breaks that wall — a type like `Vec 3 Int` literally contains the value `3`. This collapses the term/type distinction: types become first-class things that can be *computed from values*. It's unusual because it requires the type checker to *evaluate* expressions (to compare `n+m` with `m+n`, say) and because it makes type checking entangled with program execution.

## Question 4

**What are Pi types and Sigma types?**

A **Pi type** (`Π`, dependent function) generalizes `A -> B`: the return type may depend on the argument *value*, written `(x : A) -> B x`. Example: `replicate : (n : Nat) -> a -> Vec n a` — the result type mentions the argument `n`. A **Sigma type** (`Σ`, dependent pair) generalizes `(A, B)`: the second component's *type* depends on the first component's *value*, written `(x : A ** B x)`. Example: returning a runtime-determined length paired with a vector of that length, `(k ** Vec k a)`. Ordinary `->` and `(,)` are the special cases where the dependency is absent.

## Question 5

**State the Curry–Howard correspondence and why it makes dependent-type languages double as proof assistants.**

Curry–Howard says **propositions are types and proofs are programs**: `P -> Q` is "P implies Q," a Pi type is `∀`, a Sigma type is `∃`, the empty type is `False`, the unit type is `True`. To *prove* a proposition is to *construct* a term of the corresponding type. So in a dependently typed language you can write a type that states a theorem and a program (proof term) that inhabits it; the type checker then *verifies the theorem*. That's exactly what Coq and Lean are — programming environments where the artifacts you build are machine-checked proofs.

## Question 6

**Why must a proof-assistant language enforce totality?**

Because a non-terminating term can inhabit *any* type. `loop : a; loop = loop` typechecks if totality is off and "produces" a value of every type — including `False`. Once you can inhabit `False`, you can prove anything, and the logic is inconsistent (useless). So proof assistants require every function to be **total**: defined on all inputs, provably terminating (usually structural recursion), with exhaustive pattern matching. Totality checking is what keeps `False` uninhabited and the logic sound. It's not a convenience feature; it's load-bearing.

## Question 7

**What is the trade-off between refinement types and full dependent types, in one breath?**

Refinement types are **more automatable but less expressive**: the SMT solver discharges obligations for you, but only within decidable theories (linear arithmetic, equality, arrays). Full dependent types are **maximally expressive but more laborious**: you can state any property, but when the checker can't reduce two type expressions automatically, you must write a proof by hand. Automation vs. expressiveness — pick your point on the line.

## Question 8

**What is the "trusted computing base" of a verified program, and why should a senior engineer care?**

The TCB is everything you must *trust* for the proof to be meaningful: the proof checker's kernel, any **axioms** assumed, the **specification** proved against, and any escape hatches (`admit`/`sorry`/`assume`). A proof connects code to spec *relative to* the TCB. You care because "verified" is meaningless without knowing the TCB: verified against *which* spec? Trusting *which* axioms? With any open `sorry`s? And if extracted to a binary, you also trust the extractor and downstream compiler. Interrogating the TCB separates real assurance from marketing.

## Question 9

**What is totality made of, concretely?**

Two things: **termination** (recursion is well-founded — typically each recursive call is on a structurally smaller argument; otherwise you supply a decreasing measure / well-founded recursion) and **coverage/exhaustiveness** (every constructor case is handled). A function that loops or has a missing case is partial, and a partial function is a hole in the logic.

---

## Language-Specific

## Question 10

**In Idris, what do `Vect`, `Fin n`, and `S k` express?**

`Vect n a` is a vector of exactly `n` elements of type `a` (length in the type). `Fin n` is a bounded natural number *strictly less than n* — used as a provably in-range index, so `index : Fin n -> Vect n a -> a` can never go out of bounds. `S k` is the successor of `k` in the `Nat` encoding (`Z` is zero, `S k` is `k+1`); a type like `Vect (S k) a` therefore means "length is at least one," which is how `head` forbids the empty vector.

## Question 11

**In Liquid Haskell, walk through how `{-@ divide :: Int -> {v:Int | v /= 0} -> Int @-}` gets checked.**

The annotation says the second argument's type excludes zero. When Liquid Haskell encounters a call `divide a b`, it generates a **verification condition**: given what's known about `b` at that point, is `b /= 0` valid? That VC is shipped to an SMT solver (Z3). If valid, the call compiles; if not, Z3 returns a counterexample (e.g. `b = 0`) and the call is rejected. Subtyping is implication checked by the solver: a `{v | v > 5}` flows into a `{v | v /= 0}` slot because `v > 5 => v /= 0`. You write no runtime check and no manual proof.

## Question 12

**In Coq or Lean, what is a tactic, and how does it relate to the proof term?**

A **tactic** is a command that builds a proof *incrementally* by transforming the current goal (e.g. `intro`, `induction`, `apply`, `simp`). Under the hood, tactics construct a **proof term** — a program whose type is the proposition — which the kernel then checks. Tactic mode is a convenient interactive way to *assemble* the term; you could write the term directly (term mode), but for deep proofs tactics are far more ergonomic. The kernel only trusts the final term, not the tactic script.

## Question 13

**What does F\* give you that Liquid Haskell or pure Coq doesn't, in one sentence each?**

F\* combines **dependent types + refinement types + SMT automation with an interactive proof fallback**: routine obligations go to Z3 automatically (like Liquid Haskell), and when Z3 gives up you drop into manual proof (like Coq). It's the hybrid point on the spectrum — which is why HACL\* and miTLS are built in it: most of the crypto proofs are SMT-discharged, the hard residue is hand-proved, and the result extracts to C.

## Question 14

**Show how TypeScript literal and template-literal types give a *weak* refinement flavor.**

A literal type restricts a value to specific constants: `type Method = "GET" | "POST"` — the compiler rejects `"GET "` (typo) at compile time. Template-literal types restrict *shape*: `type Path = \`/users/${string}\`` accepts `"/users/42"` but not `"/orders/42"`. This is refinement-flavored because the type encodes a *condition* on the value and the compiler enforces it — but it's far weaker than a real refinement type: no arithmetic predicates, no SMT solver, no relating output to input. It's a taste, not the real thing.

## Question 15

**How are Rust const generics a sliver of dependent typing?**

In Rust, `[T; N]` is an array whose **length `N` is a value living in the type**. `[i32; 3]` and `[i32; 5]` are *different types*. A function `fn f<const N: usize>(a: [i32; N])` is parameterized over a length value — a type depending on a value, which is the defining feature of dependent typing. The limitation: Rust doesn't let you *state and prove* arithmetic relations on `N` (you can't write `head` that requires `N >= 1` the way Idris does), so it's a fragment, not the full system.

## Question 16

**What is `Refl`, and when can you (not) use it?**

`Refl` is the single constructor of propositional equality `x = x` (reflexivity). You can write `Refl : a = b` only when `a` and `b` are **definitionally equal** — they reduce to the same normal form by computation (e.g. `2 + 3 = 5`, since both reduce to `5`). You *cannot* use `Refl` directly for equalities that don't auto-reduce, like `n + 0 = n` for a variable `n` (the checker can't reduce `n + 0` without knowing `n`). Those require a proof by induction.

## Question 17

**In Dafny, what roles do `requires`, `ensures`, and loop `invariant` play?**

`requires` states a **precondition** (what the caller must guarantee); `ensures` states a **postcondition** (what the method guarantees on return); a loop `invariant` states a property that holds before and after every iteration. Dafny generates verification conditions from these and hands them to an SMT solver: it checks that the body, assuming the preconditions and invariants, establishes the postcondition and preserves the invariants. Get the invariant wrong and Dafny refuses to verify the loop — that's the tool earning its keep.

---

## Tricky-Trap

## Question 18

**"Refinement types make my program slower because of all the extra checks." True or false?**

**False — and it's the reverse.** Refinement checks happen at *compile time* via the SMT solver, not at runtime. The runtime artifact has *no* refinement checks. In fact, because the compiler now *proves* an index is in range, it can sometimes **elide** the runtime bounds check the CPU would otherwise perform — making verified code potentially *faster*. The cost is compile-time (solver time), not run-time.

## Question 19

**If `head : Vec (S n) a` can't be called on an empty vector, what happens when I read a vector's length from a file at runtime and it might be zero?**

The dependent type doesn't vanish — you handle the unknown length by *pattern matching* (or a dependent `case`) that *recovers the length information at runtime*. You typically read into a Sigma type `(k ** Vec k a)`, then match on whether `k` is `Z` or `S k'`. In the `S k'` branch the checker *learns* the vector is non-empty and lets you call `head`; in the `Z` branch you must handle emptiness explicitly. The safety is preserved precisely because the type forces you to consider the empty case before reaching `head`.

## Question 20

**Liquid Haskell rejected a function whose property is actually true. Is that a bug in Liquid Haskell?**

Not necessarily — it's likely **SMT incompleteness**. The solver only decides *decidable theories* (linear arithmetic, equality, arrays). If your true fact requires *nonlinear* arithmetic (multiplying two variables) or *unbounded quantifiers*, Z3 may time out or fail even though the fact holds. The fix is usually to reformulate into the decidable fragment, add an intermediate assertion to guide the solver, or supply a manual proof term. The tool is *sound* (it never accepts a false fact) but not *complete* (it may reject a true one).

## Question 21

**A colleague says "we proved our code correct in Coq, so it has no bugs." What's wrong with that statement?**

Several things. (1) **Verified against a spec** — if the spec is wrong, the proof guarantees the wrong behavior; the spec itself can have bugs. (2) **TCB** — you trust the Coq kernel, any axioms, and (if extracted) the extractor and C compiler; a bug there voids the guarantee. (3) **Scope** — *which* property was proved? Functional correctness ≠ memory safety ≠ side-channel resistance ≠ termination ≠ liveness. (4) **Escape hatches** — any open `admit`/`Admitted` leaves a hole. "No bugs" is an overclaim; "verified property X against spec Y trusting Z" is the honest statement.

## Question 22

**`2 + 3 = 5` typechecks with `Refl` but `n + 0 = n` doesn't. Why, given both look obviously true?**

Because the checker proves equalities by *computation*. `2 + 3` *reduces* to `5` (the arguments are concrete), so `Refl` works. But `n + 0` with `n` a *variable* cannot reduce — the definition of `+` recurses on its *first* argument, so `n + 0` is stuck until `n` is known. Hence `n + 0 = n` is only *propositionally* (not definitionally) equal and needs an inductive proof. Note the asymmetry: `0 + n = n` *does* reduce (the recursion is on the first arg), so *that* one works with `Refl`. The "obviousness" to a human is irrelevant; what matters is whether the term reduces.

## Question 23

**Does adding more axioms to a proof assistant make it more powerful for free?**

No — it makes it more powerful *and more dangerous*. Each axiom is an unproven assumption added to the TCB. Some axioms (functional extensionality, classical excluded middle) are widely trusted, but *combinations* of axioms (e.g. certain impredicativity + choice + classical principles) can be **inconsistent**, letting you prove `False`. So axioms are not free expressiveness; they trade soundness risk for convenience and must be audited.

## Question 24

**"Dependent types carry values, so `Vec 1000000 Int` wastes memory storing the length a million times." True?**

**False.** The index `n` in `Vec n a` is used only by the *type checker*. After checking, it's **erased** — a `Vec 1000000 Int` runs as a plain array with no per-element length baggage and usually no separate length value at all (unless the program genuinely needs it at runtime, like `replicate n`). The cost of dependent types is paid at compile time; the runtime representation is ordinary data.

## Question 25

**Why can't I just write all my everyday code in Idris/Agda to get these guarantees?**

The cost. Full dependent types require **manual proofs** where the checker can't auto-reduce, have **steep learning curves** and small ecosystems, **slow compile/check times**, and **ergonomic friction** (proving "obvious" facts to the checker). For most software, that effort buys *less* reliability than the same effort spent on tests, fuzzing, and ordinary-type discipline — because the blast radius doesn't justify it. These tools earn their cost only where a bug is catastrophic (compilers, kernels, crypto, avionics). For everyday CRUD, the trade is wrong — *today*.

---

## Design

## Question 26

**You're building a high-throughput crypto library. Argue for or against using F\*/HACL\*-style verification.**

**For**, in this case. Crypto has extreme blast radius (a bug leaks keys across every endpoint shipping the library), the spec is *mathematically precise* (so the spec-risk is lower than usual), and the property set (memory safety, functional correctness, constant-time) maps well onto what verification proves. F\*'s SMT-plus-interactive model handles most obligations automatically and extracts to fast C. The person-years cost is justified by the consequence of failure and amortized across every consumer (HACL\* ships in Firefox and the Linux kernel). This is the textbook "yes."

## Question 27

**Your team wants to "formally verify the whole microservice." How do you respond?**

Push back and re-scope. Full verification of a whole service is rarely justified: most of it is I/O, glue, and business logic with modest blast radius, where tests + ordinary types + fuzzing dominate the cost-benefit. Instead: (1) adopt the **cheap rungs everywhere** (make illegal states unrepresentable, branded/newtype invariants, type-state) at near-zero cost; (2) identify the *one or two* genuinely high-risk components (a parser, an allocator, an authz check) and apply **surgical refinement** (Liquid Haskell/Dafny) there; (3) reserve full proof for nothing, unless a specific component has catastrophic blast radius. Verifying everything misallocates the budget and incurs a permanent maintenance tax.

## Question 28

**Design a type that makes "use a database connection after closing it" a compile error, in a mainstream language.**

Use the **type-state pattern**. Parameterize the connection by a phantom state type: `Conn<Open>` and `Conn<Closed>`. Put `send`/`query` methods only on `impl Conn<Open>`; make `close(self) -> Conn<Closed>` *consume* the open connection (in Rust, by value) and return a closed one. Now any call to `send` after `close` references a `Conn<Closed>`, which has no `send` method — a compile error. This encodes the protocol state in the type (a sliver of dependent thinking) without any verifier or SMT solver.

## Question 29

**Where would you place a refinement at a system boundary, and why there?**

At the **input/parse boundary**, via a smart constructor. Establish the invariant once — e.g. parse a raw `Int` into `{v | 0 < v}` or a raw `String` into `ValidatedEmail` — at the single point where untrusted data enters. Downstream code then receives the *refined* type and runs guard-free; the property propagates through the type system instead of being re-checked everywhere. Refining at the boundary maximizes the amount of code that gets the guarantee for free and minimizes scattered runtime checks.

## Question 30

**A spec says "the function returns a sorted list." You've verified the implementation against it. What might still be wrong, and how do you reduce that risk?**

The **spec might be incomplete**: "sorted" alone permits returning a *different* sorted list (e.g. always `[]`, which is trivially sorted, or a list that drops elements). The proof would pass while the function is useless. You reduce spec risk by **strengthening the spec** — require sorted *and* a permutation of the input (same multiset) — and by **validating the spec independently**: model-based tests, redundant statements of intent, adversarial review. The proof guarantees code-meets-spec; only spec validation guarantees spec-meets-intent.

## Question 31

**When does refinement typing beat full dependent typing for a given verification task, and vice versa?**

**Refinement wins** when the properties are arithmetic/bounds/array facts in a decidable theory and you want automation and scale with minimal manual proof — index safety, non-zero divisors, offset arithmetic, large codebases (Liquid Haskell, Dafny, F\*'s SMT path). **Full dependent typing wins** when you need to express and prove *deep* invariants the solver can't decide — structural correctness, rich algebraic properties, theorems about your own recursive functions, formalized math — accepting the manual-proof cost (Idris, Agda, Coq, Lean). The deciding question: *can an SMT solver decide the obligation?* If yes, refine; if no, you're proving by hand.

## Question 32

**You must convince a skeptical VP to fund verification for exactly one component. How do you choose it and frame the cost?**

Choose by **blast radius × defect probability**: the component whose failure is most catastrophic *and* most error-prone — typically a crypto routine, an authorization check, or a parser handling untrusted input. Frame the cost as *insurance proportional to exposure*: bounded, surgical effort (one verified module, not the system), with a concrete avoided-cost story (e.g. "a bounds bug here is a remote-code-execution vector across every customer"). Commit to the *whole* cost honestly — initial proof plus standing maintenance (proof CI, spec review, expertise) — and scope it to a single, defensible artifact so the ROI is legible.

---

## Closing note

The strongest answers in this bank share a pattern: they name the *boundary* of the technique — what the solver can't decide, what the spec might miss, what the TCB still trusts, what the blast radius justifies. Knowing the slogans ("make illegal states unrepresentable," "proofs are programs") is table stakes; knowing *where they stop* is what signals depth.
