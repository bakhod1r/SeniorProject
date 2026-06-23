# Duplication & Similarity — Senior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Duplication & Similarity
> *The middle page taught you the clone taxonomy and how to read a `jscpd` report. This page is about the two things a senior actually owns: the **algorithms** that make clone detection tractable at all — suffix arrays, AST subtree hashing, PDG isomorphism — and the **design judgment** about when duplication is a defect, when it is the correct decoupling, and why a premature DRY can be strictly worse than the repetition it removed.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Detection Problem, Stated Precisely](#the-detection-problem-stated-precisely)
4. [Token-Based Detection — Suffix Trees, Suffix Arrays, and Karp-Rabin](#token-based-detection--suffix-trees-suffix-arrays-and-karp-rabin)
5. [AST-Based Detection — Subtree Hashing and Deckard's Vector Embeddings](#ast-based-detection--subtree-hashing-and-deckards-vector-embeddings)
6. [Semantic Detection — PDG Isomorphism and the Type-4 Wall](#semantic-detection--pdg-isomorphism-and-the-type-4-wall)
7. [The Precision/Recall Trade — Tuning the Knobs](#the-precisionrecall-trade--tuning-the-knobs)
8. [The Wrong Abstraction — When DRY Is the Mistake](#the-wrong-abstraction--when-dry-is-the-mistake)
9. [Connascence — The Lens That Says Which Duplication Hurts](#connascence--the-lens-that-says-which-duplication-hurts)
10. [Deliberate Duplication Across Boundaries](#deliberate-duplication-across-boundaries)
11. [Cross-Repo and Cross-Language Duplication at Scale](#cross-repo-and-cross-language-duplication-at-scale)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The algorithms that make clone detection scale, and the design theory that decides whether a found clone is even a problem.**

By the middle level you can name the four clone types, run a detector, and read its duplication percentage without being fooled into thinking 5% is a grade. That makes you useful in a code review. The senior jump is in two directions at once.

First, **down into the algorithms.** A clone detector that compares every code fragment to every other is O(n²) in fragments and dies on a real repository. The tools that survive — CPD, Simian, jscpd, Deckard, NiCad, SourcererCC — survive because they reduce clone detection to a problem with a known sub-quadratic solution: longest-common-substring over a token stream (suffix arrays), near-duplicate subtree clustering (locality-sensitive hashing over tree-derived vectors), or approximate set similarity (MinHash / LSH over bags of tokens). You cannot tune a detector you do not understand, and every false positive and missed clone traces back to a specific algorithmic choice — the normalization level, the minimum match length, the gap tolerance.

Second, **up into design judgment.** The naive reading of a duplication report is "duplication is debt; remove it." That reading is wrong often enough to be dangerous. Sandi Metz's argument — *"duplication is far cheaper than the wrong abstraction"* — is not a contrarian quip; it is a precise claim about which kind of mistake is reversible. This page treats both halves as one discipline, because the algorithm tells you *where the textual similarity is* and only the design theory tells you *whether it matters*.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — clone types 1–4, parameterized vs gapped clones, what `jscpd`/CPD/Simian report, the duplication-% metric and its failure modes.
- **Required:** Comfort with basic algorithmic analysis — big-O, hashing, and what a suffix of a string is.
- **Helpful:** You've owned a shared utility module that everyone imported and nobody could change without breaking three teams. That pain is the design half of this page.
- **Helpful:** A working memory of [coupling and cohesion](../03-coupling-and-cohesion-metrics/senior.md) — afferent coupling especially, because that's the cost a bad de-duplication imposes.

---

## The Detection Problem, Stated Precisely

Strip away the marketing and every clone detector answers one question: *given a corpus of code, find pairs (or groups) of fragments that are "similar enough" under some equivalence.* The whole design space is determined by two decisions:

1. **What representation do we compare?** Raw characters, a token stream, an abstract syntax tree, or a program dependence graph. Each representation is more expensive to build and more semantically faithful than the last.
2. **What does "similar enough" mean on that representation?** Exact equality, equality after normalization, longest common subsequence within a gap budget, or vector distance below a threshold.

That pairing maps cleanly onto the clone taxonomy you already know:

| Type | Definition | Representation that catches it |
|---|---|---|
| **Type-1** | Identical except whitespace/comments | Token stream (strip trivia) |
| **Type-2** | Type-1 + renamed identifiers/literals | Token stream with identifiers *normalized* to a placeholder |
| **Type-3** | Type-2 + added/removed/changed statements ("gapped") | Token stream with gap tolerance, **or** AST/tree edit distance |
| **Type-4** | Semantically equivalent, syntactically unrelated | PDG isomorphism / semantic analysis only |

The cost gradient is the entire story of the field. Type-1 and Type-2 are *cheap and solved* — a token stream plus a linear-time longest-common-substring algorithm finds them exactly. Type-3 is *the practical frontier* — every production tool makes a precision/recall compromise here, because "how many changed lines still counts as a clone" has no objectively correct answer. Type-4 is *research-grade and rarely deployed*, because deciding semantic equivalence is, in the limit, undecidable, and the tractable approximations (graph isomorphism on dependence graphs) are exponential in the worst case.

> **Key insight:** A clone detector is a *representation choice plus a similarity function*. Every behavior you dislike — boilerplate flagged as a clone, a renamed method missed — is not a bug; it is the direct consequence of a representation that is too shallow or a similarity function tuned too loose or too tight. Tuning is choosing where on that gradient to stand.

---

## Token-Based Detection — Suffix Trees, Suffix Arrays, and Karp-Rabin

Token-based detection is what almost every shipped tool uses (CPD, Simian, jscpd, SourcererCC) because it hits the sweet spot: it catches Type-1/2/3 well, it's language-aware enough to ignore comments and whitespace, and it scales.

**Step one is lexing, not parsing.** The source is run through the language's lexer to produce a stream of tokens. Crucially, the lexer lets you *normalize*: comments and whitespace are dropped (killing Type-1 noise), and — depending on the configured normalization level — every identifier and literal can be collapsed to a single placeholder token. With identifiers normalized, `int total = a + b;` and `int sum = x + y;` become the *same* token sequence (`TYPE ID = ID + ID ;`), so a Type-2 renamed clone reduces to an *exact substring match* on the normalized stream. This is the central trick: **normalization converts approximate matching into exact matching.**

Now the problem is: *find all maximal repeated substrings in a token sequence.* Two classic data structures solve this in (near) linear time.

### Suffix trees

A **suffix tree** for a string of length *n* is a compressed trie containing every suffix of the string. Built with Ukkonen's algorithm in **O(n)** time and space, it lets you find the *longest repeated substring* by locating the deepest internal node that has two or more leaf descendants — an internal node represents a substring that occurs as a prefix of multiple suffixes, i.e., a *repeat*. Every maximal repeated substring (every Type-1/2 clone, after normalization) corresponds to such an internal node, so a single traversal enumerates all clones above a minimum length.

The catch is the constant factor: a suffix tree carries large per-node overhead (children pointers, suffix links), often 20× the input size in memory. For a multi-million-token corpus that is fatal, which is why most production tools reach for the suffix tree's leaner cousin.

### Suffix arrays

A **suffix array** is the sorted array of all suffix start positions. It stores the same repeat information as a suffix tree in a fraction of the memory (one integer per position) and is buildable in O(n) with DC3/skew or O(n log n) with simpler sorts. The key companion structure is the **LCP array** (Longest Common Prefix), where `LCP[i]` is the length of the longest common prefix between the suffixes ranked *i* and *i−1* in sorted order.

The clone-detection insight: **adjacent suffixes in the sorted array share the longest prefixes.** So a repeated substring of length ≥ *L* shows up as a *run* of entries in the LCP array all ≥ *L*. To find every clone of minimum length *L*, you sort the suffixes, compute the LCP array (Kasai's algorithm, O(n)), and scan for maximal runs where `LCP[i] ≥ L`. Each such run is a clone group; the suffix positions in the run are the clone instances mapped back to source locations.

```
token stream (normalized):  ID = ID + ID ; ID = ID + ID ; ...
                            └─────────────┘ └─────────────┘
suffixes sorted → adjacent suffixes that share a long prefix
LCP run with all values ≥ L  ⇒  a clone group of length ≥ L
```

This is why the suffix-array approach is **near-linear and memory-frugal**: O(n) to build, O(n) to compute LCP, O(n) to scan. It is the algorithmic backbone of fast token-based detectors.

### Karp-Rabin rolling hashes

The other workhorse — and what makes CPD's family of approaches fast in practice — is the **Karp-Rabin rolling hash**. Instead of comparing token windows directly, you hash every window of *w* tokens to an integer using a polynomial rolling hash, where sliding the window one token forward updates the hash in **O(1)** (subtract the leaving token's contribution, multiply by the base, add the entering token). You then bucket windows by hash value; any bucket with two or more windows is a *candidate* clone, verified by a direct token comparison to rule out hash collisions.

```
hash(window) = (t0·b^(w-1) + t1·b^(w-2) + ... + t_{w-1}) mod p
slide:        hash' = ((hash - t0·b^(w-1))·b + t_w) mod p     # O(1) update
```

Karp-Rabin reduces the all-pairs comparison to a hash-table grouping — **O(n)** expected — and naturally extends to *fingerprinting* schemes like **winnowing** (used in Moss, the plagiarism detector), where you keep only a deterministic subset of window hashes (the minimum in each sliding window of hashes) to bound the index size while still guaranteeing that any sufficiently long match is detected. Fingerprinting is what makes cross-repo, corpus-scale detection feasible: you index every project by a sparse set of robust hashes and look up matches, rather than comparing projects pairwise.

> **Key insight:** Token-based detection wins because two reductions stack. **Normalization** turns Type-2 approximate matching into exact substring matching, and **suffix arrays / rolling hashes** turn exact-substring-finding into a near-linear scan. Everything fast in clone detection rides on one of these two structures.

Type-3 (gapped) clones are handled on top of this by *stitching*: find exact matches, then merge two nearby matches separated by a small gap (a few unmatched tokens) into one Type-3 clone, governed by a gap-size threshold. That stitching is exactly where token-based precision starts to wobble — too generous a gap and unrelated code gets glued together.

---

## AST-Based Detection — Subtree Hashing and Deckard's Vector Embeddings

Token streams are *syntax-blind*: they don't know that a token run crosses a statement boundary in a meaningless way, so a token clone can be a fragment that's a clone of *half an `if` and the start of a loop* — syntactically incoherent and useless to refactor. AST-based detectors fix this by comparing **subtrees**, which are always syntactically complete units (a whole expression, statement, method).

### Subtree hashing

The foundational technique (Baxter et al., the *CloneDR* approach) is to **hash every subtree** of the parse tree and bucket subtrees by hash. Subtrees in the same bucket are *candidate* clones; a tree-comparison within the bucket confirms them. The cleverness is in the hash function:

- A **structural hash** ignores identifier names and literal values, hashing only the node *types* and *shape*. Two subtrees with the same structural hash are Type-2 clones (renamed). This is the tree analog of token normalization.
- The hash is **bottom-up and compositional**: a node's hash is a function of its node type and its children's hashes, so it's computed in one post-order traversal, O(n) over the tree.

To catch *near*-miss (Type-3) subtrees — where a statement was inserted — exact subtree-hash bucketing isn't enough, because one extra child changes the parent's hash. The fix is to also detect *sequences* of sibling statements (so an inserted statement breaks the sequence into two detectable runs) and to allow approximate tree matching within a bucket.

### Deckard — vector embeddings of subtrees

The scalability breakthrough is **Deckard** (Jiang, Su, et al., 2007), and its idea is worth understanding because it reappears everywhere from code search to ML-based detectors. Deckard maps each subtree to a **characteristic vector** in a fixed-dimensional space, where each dimension counts the occurrences of a particular node type (or small tree pattern) in that subtree. A subtree becomes a point; similar code becomes nearby points.

```
subtree  →  characteristic vector  =  [ #IfStmt, #ForStmt, #Assign, #Call, #BinOp, ... ]
similar subtrees  ⇒  vectors close in Euclidean distance
```

The genius is the next step: **clone detection becomes a near-neighbor clustering problem in vector space**, and near-neighbor search at scale is solved by **Locality-Sensitive Hashing (LSH)**. LSH hashes vectors so that nearby vectors collide with high probability, so you find clones by hashing all vectors and inspecting collision buckets — sub-quadratic, no all-pairs distance computation. Deckard catches Type-3 clones naturally because an inserted statement perturbs the vector only slightly, leaving it inside the same LSH bucket. By moving from "compare trees" to "compare vectors that summarize trees," Deckard turned the expensive tree-matching problem into the well-studied approximate-near-neighbor problem.

This vector-embedding lineage is the bridge to **modern token/embedding similarity**: replace Deckard's hand-built count vector with a *learned* embedding (from a code model) and the same LSH/ANN machinery now finds semantically related code that shares no tokens — the direction Type-4 detection has actually moved, pragmatically, since exact PDG isomorphism never scaled.

> **Key insight:** Deckard's move — *summarize a structure as a vector, then use approximate-near-neighbor search* — is the single most reusable idea in similarity detection. AST counts, MinHash sketches, and neural code embeddings are all instances of it; only the embedding function changes. Understand the pattern once and every "similarity at scale" tool becomes legible.

AST detection's cost is the parser: you need a real, per-language grammar (or a multi-language framework like Tree-sitter), and parsing is heavier than lexing. The payoff is *refactorable* clones — every reported clone is a coherent syntactic unit you can actually extract.

---

## Semantic Detection — PDG Isomorphism and the Type-4 Wall

Type-4 clones — two functions that compute the same thing with no syntactic resemblance — are invisible to token and AST detectors. Catching them requires reasoning about *what the code does*, not how it's written, and the research-grade approach is the **Program Dependence Graph (PDG)**.

A PDG represents a procedure as a graph whose nodes are statements/operations and whose edges are **data dependencies** (this value flows into that computation) and **control dependencies** (this statement executes only if that condition holds). The PDG is, deliberately, *order-insensitive* and *name-insensitive*: reordering two independent statements, or renaming a variable, leaves the dependence structure unchanged. So two code fragments that are semantically equivalent — even with statements reordered, intermediate variables renamed, or loops written differently — can produce **isomorphic** PDGs.

Clone detection then reduces to finding **isomorphic subgraphs** across the program's PDGs (the approach of Komondoor & Horwitz, and *GPLAG* for plagiarism). And here is the wall:

- **Subgraph isomorphism is NP-complete.** Finding whether one graph contains another as a subgraph has no known polynomial algorithm; on real PDGs with hundreds of nodes the exact search is intractable.
- Practical PDG tools therefore use **heuristics**: they don't search for exact isomorphism but grow matching subgraphs greedily from matched "seed" nodes, or restrict to *approximate* matching with bounded size. This trades completeness for tractability and still costs far more than token or AST detection.
- Even building an accurate PDG requires **precise interprocedural data-flow and alias analysis**, which is itself expensive and language-specific, and degrades on dynamic languages where you can't statically resolve what a name refers to.

The honest senior position: **PDG-based Type-4 detection is real, it works in research settings, and it is almost never worth deploying on a production codebase.** The cost is enormous, the false-positive rate on a large system is high (many fragments share a small common dependence pattern), and the actionable yield is low — Type-4 clones, by definition, weren't created by copy-paste, so they're rarer and less mechanically refactorable. The pragmatic industry answer to "find semantically similar code" has shifted to **learned embeddings** (Deckard's pattern with a neural embedding function), which approximate semantic similarity at LSH speed without the NP-complete core — at the cost of being a fuzzy, statistical match rather than a proof of equivalence.

> **Key insight:** The clone-type ladder is also a *complexity* ladder. Type-1/2 are linear (suffix arrays). Type-3 is near-linear with a tuning knob (stitching / vector distance). Type-4 sits behind an NP-complete subgraph-isomorphism wall, which is exactly why no mainstream tool ships true Type-4 detection and why the field routed around it with approximate vector embeddings.

---

## The Precision/Recall Trade — Tuning the Knobs

Every detector exposes a handful of parameters, and each one slides you along the precision/recall curve. A senior tunes these *to the codebase and the decision the report drives*, not to the tool's defaults. Three knobs dominate.

**1. Minimum clone length** (min tokens / min lines). The single most consequential setting. Set it low (say, 25 tokens) and you flood the report with trivial, meaningless "clones" — a `for` loop header, a logger boilerplate line, a struct literal — destroying precision and burying the real findings. Set it high (150 tokens) and you only catch large copy-pasted blocks, missing the medium-sized clones that are often the most damaging. The right floor is *language- and style-dependent*: idiomatic Go with explicit `if err != nil` blocks, or Java with verbose getters, needs a higher floor than terse Python, because the boilerplate baseline is higher.

**2. Normalization / abstraction level.** How aggressively you erase detail before matching:

| Level | What's normalized | Effect |
|---|---|---|
| **None** | nothing (raw tokens) | Only Type-1; misses every rename |
| **Identifiers** | variable/method names → placeholder | Catches Type-2; the common default |
| **Identifiers + literals** | also numbers/strings → placeholder | Catches more renames; risks false positives |
| **+ types** | type names also abstracted | Aggressive; flags structurally-identical-but-unrelated code |

Too aggressive and you get **false positives on boilerplate**: every DTO, every builder, every `equals`/`hashCode`, every table-driven test looks identical once you abstract names *and* types, even though they're unrelated by design. Too strict and you **miss renamed clones**: a method copied and adapted with new variable names slips through because the raw tokens differ. The art is normalizing enough to catch real copy-paste-and-rename while preserving enough signal that genuinely different code stays different.

**3. Gap tolerance (Type-3).** How many edited/inserted tokens you'll bridge when stitching two exact matches into one gapped clone. Generous gaps catch more evolved clones (recall up) but glue together fragments that merely *abut* a common idiom (precision down). This is the knob most likely to produce confidently-wrong large clones.

> **Key insight:** There is no setting that maximizes both precision and recall — they trade against each other along these three axes, and the *right* point depends on what the number drives. A pre-merge gate that blocks a PR must favor **precision** (a false positive blocks honest work and trains people to ignore the tool). A periodic refactoring-candidate report can favor **recall** (a human triages, so misses cost more than noise). Tune the detector to the decision, not the other way around.

A practical anti-noise discipline: maintain an **ignore list / suppression** for the irreducible boilerplate the language forces on you (generated code, `equals`/`hashCode`, migration files, table-driven test cases), so the report surfaces only *avoidable* duplication. A duplication metric is only useful once it's been de-noised; the raw percentage straight out of the tool is almost always dominated by boilerplate and is the number you should trust least.

---

## The Wrong Abstraction — When DRY Is the Mistake

Now the design half, and the most important idea on this page. The reflexive response to a duplication report is "extract a shared abstraction." Sandi Metz's essay *The Wrong Abstraction* (2016) argues — correctly — that this reflex is frequently a net loss, and her formulation is worth quoting because the precision matters:

> *"Duplication is far cheaper than the wrong abstraction."* — Sandi Metz

The failure mode she describes is a lifecycle, and you have lived it:

1. A developer sees two pieces of code that look the same and extracts a shared method/class. Reasonable.
2. A new requirement arrives that's *almost* the same but differs in one case. Rather than back out the abstraction, the next developer adds a parameter — `if (flag) { ... } else { ... }` — to the shared code.
3. More requirements arrive; more parameters and conditionals accrete. The shared abstraction is now a tangle of flags, each existing to make one caller behave differently.
4. Eventually the abstraction serves *every* caller poorly. Each change risks breaking an unrelated caller, because they're all coupled through this one over-general procedure. Nobody dares delete it.

The root error is mistaking **incidental similarity** for **essential sameness**. Two pieces of code that *look* alike today may be alike by coincidence — they're solving genuinely different problems that happen, at this moment, to have the same shape. The moment you couple them through a shared abstraction, their futures are chained: a change driven by one caller's requirement is forced onto all the others. That is *hidden coupling*, manufactured by a well-intentioned DRY.

The cure Metz prescribes is counterintuitive and correct: **when an abstraction starts accreting conditionals to serve diverging callers, re-introduce the duplication.** Inline the shared code back into each caller, then let each copy evolve independently — and only re-abstract later *if* a genuinely common pattern re-emerges, now visible from three or more concrete examples (the **Rule of Three**). Duplication is cheap to fix later (you can always extract); the wrong abstraction is expensive to fix later (every caller is entangled, the tests are coupled, the parameters encode history). The asymmetry in *reversibility* is the whole argument.

This connects directly to **AHA — "Avoid Hasty Abstractions"** (Kent C. Dodds, crediting the same idea): prefer duplication over the wrong abstraction, and wait for the pattern to prove itself before committing. AHA, the Rule of Three, and Metz's essay are three statements of one principle: *abstraction is a bet on the future, and a wrong bet is more expensive than the duplication it replaced.*

> **Key insight:** A high duplication number is a *prompt to investigate*, never a directive to de-duplicate. The senior question is not "is this duplicated?" but "is this duplication *incidental* (different things that look alike) or *essential* (one concept expressed in two places)?" DRY applies only to the second. Deduplicating incidental similarity creates the wrong abstraction — and that is strictly worse than the duplication, because it adds coupling on top of the cost you were trying to remove.

The DRY principle, read precisely, was never about textual repetition. Andy Hunt and Dave Thomas defined it as: *"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."* The unit is **knowledge**, not **text**. Two functions with identical bodies that encode *different* business rules are not a DRY violation — they're two pieces of knowledge that happen to look alike, and merging them is the violation. A detector finds *textual* similarity; only a human who understands the domain can tell whether that maps to *knowledge* duplication.

---

## Connascence — The Lens That Says Which Duplication Hurts

If "incidental vs essential" is the judgment, **connascence** (Meilir Page-Jones, popularized by Jim Weirich) is the vocabulary that makes it rigorous. Connascence names the kinds of coupling: two components are *connascent* if a change in one requires a coordinated change in the other to preserve correctness. It comes in degrees, from weak/visible to strong/hidden, and it reframes the duplication question precisely.

When you de-duplicate, you are *changing the connascence* of the callers. Before extraction, two copies of a rule have **no connascence between the call sites** — they're independent; changing one never forces a change to the other. That independence is sometimes exactly what you want. After extraction, the call sites share **connascence of algorithm** (they depend on the shared procedure behaving a certain way) routed through one place. If they encode the *same* knowledge, centralizing that connascence is good — now a change happens in one place. If they encode *different* knowledge, you have manufactured connascence between things that should have none, and every future change to one caller's needs now ripples through the shared code to the other.

The connascence reframing of Metz's argument: **the wrong abstraction converts zero connascence into strong, hidden connascence.** Duplicated code has low coupling between the copies; the wrong abstraction has high, invisible coupling routed through a shared procedure. Connascence gives you the explicit cost ledger — you can ask, concretely, "if requirement X changes for caller A, how many other callers must change with it?" If the answer is "none, because they're genuinely separate," the duplication is correct and you should leave it; if the answer is "all of them, because it's one rule," the duplication is a defect and you should centralize it. The metric can't answer that question. Connascence is the lens that can.

> **Key insight:** De-duplication is a *connascence transformation*: it trades the independence of duplicated copies for the centralization of a shared abstraction. That trade is a win when the copies encode one piece of knowledge (centralizing strengthens the right coupling) and a loss when they encode different knowledge (you create hidden coupling where there was none). "Should I DRY this?" is really "do these call sites *want* to be connascent?"

---

## Deliberate Duplication Across Boundaries

The most senior application of all this: there are places where you should duplicate **on purpose**, at the architectural level, because the alternative — a shared abstraction — would create coupling that violates a boundary you are deliberately maintaining.

The canonical case is **across bounded contexts or services**. In a microservice or modular-monolith architecture, two services may each need a notion of, say, "Customer." The tempting move is a **shared kernel** — a shared library or shared schema defining `Customer` that both services import. The cost is a coupling that defeats the entire point of the boundary: now the two services cannot evolve their model independently, a change to the shared `Customer` forces coordinated deployment, and the "independent services" are joined at the hip through the library. Domain-Driven Design names this explicitly: a shared kernel is a *high-coupling* integration pattern, to be used only between teams in tight collaboration, and avoided otherwise.

The correct alternative is **deliberate duplication**: each service defines its *own* `Customer` model, shaped for its own needs (the billing service's `Customer` has payment fields; the shipping service's has addresses). The models look similar — a clone detector would flag them — but they are *different knowledge* (the same real-world entity seen through two different contexts), and keeping them separate is what lets each service change independently. The duplication is the *price of decoupling*, and it's a price worth paying. This is the architectural version of "incidental similarity": two models that look alike because they describe the same entity, but encode different concerns.

The same logic appears at smaller scales:
- **Test code vs production code.** Tests deliberately re-state expected values rather than importing the production constant, so a wrong change to the constant is *caught* by the test rather than silently mirrored. DRY-ing a test against the code under test defeats the test.
- **Public API contracts.** A service's external DTO is often a near-duplicate of its internal domain model. Coupling them (returning the domain model directly) means an internal refactor breaks the public contract. The duplication (a separate DTO) is what decouples your internals from your API — see [API versioning](../../code-coverage/) concerns generally.
- **Generated code and configuration.** Some duplication is generated from a single source (protobuf definitions → per-language stubs); the "duplication" a detector sees is fine because there *is* a single authoritative source — the generator. DRY is satisfied at the source level even though the output looks duplicated.

> **Key insight:** Duplication is a tool for **decoupling**, not only a symptom of debt. Across a bounded context, a service boundary, or a test/production split, deliberate duplication is what *preserves* the independence that a shared abstraction would destroy. The senior move is to recognize when a clone the detector flags is actually the boundary doing its job — and to leave it, or even introduce it on purpose.

---

## Cross-Repo and Cross-Language Duplication at Scale

Single-repo detection is solved. The hard problems live at organization scale, and they change the algorithmic requirements.

**Cross-repository duplication.** When the same utility, the same auth-token-parsing logic, or the same vulnerable snippet is copy-pasted across hundreds of repos, single-repo tools can't see it — each repo looks clean in isolation. This is where **fingerprinting** (winnowing, MinHash/LSH over token bags) earns its keep: you index every repo by a sparse, robust set of hashes and query for matches across the corpus, turning O(repos²) pairwise comparison into index lookups. SourcererCC scaled exactly this way — it builds an inverted index over token bags and uses filtering heuristics (a candidate must share a minimum number of tokens to even be compared) to make hundred-million-line corpus detection tractable. The high-value application is *not* refactoring but **security and compliance**: when a CVE is found in a snippet, fingerprinting locates every copy across the org so you can patch all of them, not just the one that got reported.

**Cross-language duplication.** Token and AST detectors are inherently single-language — different lexers, different grammars. Detecting that a Python implementation and a Go implementation of the same algorithm are "the same" requires a *language-agnostic* representation. The approaches: a **common intermediate representation** (lift both languages to a shared IR, then compare — heavy, brittle), or **learned cross-language embeddings** (train a model to map code in any language to a shared semantic vector space, then compare vectors — the modern direction). This is genuinely hard and mostly research-grade; the practical 80% answer in a polyglot org is to detect duplication *within* each language and accept that cross-language clones are usually intentional ports kept in sync by hand.

The scaling lesson mirrors the single-repo one: **the move from pairwise comparison to an indexed-fingerprint lookup is what makes corpus-scale detection possible**, and it's the same Deckard/LSH idea — summarize each unit (file, repo) as a sparse signature, then use the signature for fast approximate lookup. At a billion lines you never compare two things directly; you compare their signatures.

> **Key insight:** Org-scale duplication detection is an *indexing* problem, not a comparison problem. Fingerprint every unit into a sparse signature (winnowing/MinHash) and query an inverted index; pairwise comparison is dead at this scale. And the highest-value org-scale use of duplication detection is rarely refactoring — it's *security*: finding every copy of a vulnerable snippet across every repo.

---

## Mental Models

- **A clone detector is a representation plus a similarity function.** Pick the representation (tokens → AST → PDG) and you've picked your maximum clone type and your cost. Pick the similarity function (exact → normalized → vector-distance → isomorphism) and you've picked your precision/recall regime. Every behavior follows from those two choices.

- **Normalization turns approximate matching into exact matching.** Collapsing identifiers to a placeholder is the trick that makes Type-2 clones findable with a *substring* algorithm. The more you normalize, the more renames you catch — and the more unrelated boilerplate you falsely merge. That dial *is* the precision/recall trade.

- **Summarize-then-near-neighbor is the universal scaling pattern.** Deckard's "subtree → count vector → LSH" is the same shape as MinHash fingerprinting and neural code embeddings. Whenever you need similarity at scale, you reduce each unit to a sparse signature and do approximate-near-neighbor lookup, never all-pairs distance.

- **The clone-type ladder is a complexity ladder.** Type-1/2 is linear (suffix arrays). Type-3 is near-linear with a tuning knob. Type-4 is behind an NP-complete subgraph-isomorphism wall — which is *why* no mainstream tool does true Type-4 and the field routed around it with embeddings.

- **DRY is about knowledge, not text.** A detector finds textual similarity; only domain understanding tells you whether that text encodes the *same knowledge* (a real DRY violation) or *different knowledge that looks alike* (incidental). Deduplicating the latter creates the wrong abstraction.

- **De-duplication is a connascence transformation.** It trades the independence of two copies for centralized coupling through a shared procedure. Worth it when the copies are one concept; harmful when they're two — because then you've created strong hidden coupling where there was none.

---

## Common Mistakes

1. **Treating the duplication percentage as a target.** Driving "duplication %" to zero forces de-duplication of incidental similarity, which manufactures wrong abstractions. The number is a *diagnostic that points at files to investigate*, never a goal — Goodhart's law applies the moment it's a target.

2. **DRY-ing incidental similarity.** Extracting a shared abstraction from two code blocks that merely *look* alike (but encode different knowledge) couples them forever. When the requirements diverge, you'll be adding flags to the shared code. Wait for the Rule of Three and confirm it's the *same* knowledge.

3. **Never backing out a wrong abstraction.** When a shared method has sprouted conditionals to serve diverging callers, the fix is to *re-introduce duplication* — inline it back into each caller and let them evolve separately. Adding one more flag is the mistake; most engineers keep doing it because inlining feels like going backward.

4. **Setting minimum clone length too low.** A 25-token floor floods the report with `for`-loop headers and logging boilerplate, destroying precision and burying real findings. Calibrate the floor to the language's boilerplate baseline; verbose languages need a higher floor.

5. **Over-normalizing and trusting the result.** Abstracting identifiers *and* types makes every DTO, builder, and `equals`/`hashCode` look identical. The resulting false positives on unrelated boilerplate train the team to ignore the tool. Maintain a suppression list for irreducible/generated boilerplate.

6. **Sharing a kernel across a service boundary to avoid duplication.** A shared `Customer` library coupling two services defeats the boundary — independent deployment dies. Deliberate per-context duplication is the *correct* decoupling; the clone the detector flags is the boundary working as designed.

7. **Expecting any mainstream tool to find Type-4 clones.** Semantic-clone detection needs PDG isomorphism (NP-complete) or learned embeddings (statistical, fuzzy). If a vendor claims "semantic" detection, it's almost certainly approximate embedding similarity, not a proof of equivalence — calibrate your expectations accordingly.

---

## Test Yourself

1. A detector normalizes identifiers and uses a suffix array on the token stream. Which clone types does this catch exactly, which does it catch with a tuning knob, and which can it never catch? Why?
2. Explain *how* a suffix array plus an LCP array finds all clones of minimum length *L* in near-linear time. What is the LCP array and what does a "run" of high LCP values mean?
3. What is Deckard's core idea, and why does mapping subtrees to vectors turn clone detection into a problem that scales? Name the data structure that does the near-neighbor lookup.
4. Why does no mainstream tool ship true Type-4 detection? Name the specific computational barrier and the pragmatic approach the field uses instead.
5. State Sandi Metz's argument about the wrong abstraction in terms of *reversibility*. Why is duplication "cheaper" than the wrong abstraction?
6. You have two services that both need a `Customer` model and a clone detector flags them as 90% duplicated. Under what condition should you leave the duplication, and what coupling are you avoiding by doing so?
7. Reframe "should I DRY these two code blocks?" in terms of connascence. What does de-duplication do to the connascence between the call sites, and when is that a win vs a loss?

<details>
<summary>Answers</summary>

1. **Exactly:** Type-1 (whitespace/comments stripped by the lexer) and Type-2 (identifier normalization makes renamed code an *exact* substring match). **With a knob:** Type-3, via stitching nearby exact matches across a gap whose size is a tunable threshold. **Never:** Type-4 — semantically equivalent but syntactically unrelated code produces *different token sequences*, so no token-stream method can find it; it needs semantic (PDG/embedding) analysis.

2. A **suffix array** is the sorted array of all suffix start positions; the **LCP array** stores, for each adjacent pair of sorted suffixes, the length of their longest common prefix. Because sorting groups suffixes that share long prefixes, a repeated substring of length ≥ *L* appears as a contiguous **run** of LCP entries all ≥ *L*. You build the suffix array (O(n)), compute LCP with Kasai's algorithm (O(n)), and scan for maximal runs where `LCP[i] ≥ L` (O(n)) — each run is a clone group, its suffix positions mapped back to source locations.

3. Deckard maps each AST **subtree to a characteristic vector** whose dimensions count node-type occurrences, so similar code becomes nearby points in vector space. This turns clone detection into **approximate-near-neighbor search**, which is sub-quadratic via **Locality-Sensitive Hashing (LSH)** — hash vectors so nearby ones collide, then inspect collision buckets instead of computing all-pairs distances. It catches Type-3 because an inserted statement perturbs the vector only slightly.

4. True Type-4 detection requires finding **isomorphic subgraphs** across Program Dependence Graphs, and **subgraph isomorphism is NP-complete** — intractable on real PDGs (plus PDG construction needs expensive interprocedural data-flow/alias analysis). The pragmatic replacement is **learned embeddings**: map code to a semantic vector with a model and use LSH/ANN — fast and approximate, a statistical match rather than a proof of equivalence.

5. Duplication is **reversible cheaply** — you can always extract a shared abstraction later, once a genuine common pattern is visible. The wrong abstraction is **expensive to reverse** — every caller is entangled through the over-general procedure, the parameters encode history, and the tests are coupled, so backing it out is hard and risky. Because a wrong bet on abstraction costs more to undo than the duplication it replaced, duplication is the cheaper mistake.

6. Leave the duplication when the two `Customer` models encode **different knowledge** — the same real-world entity seen through two different bounded contexts (billing vs shipping), each shaped for its own concerns. You're avoiding the coupling of a **shared kernel**: a shared `Customer` library would chain the two services' models together, forcing coordinated change and deployment and destroying their independent evolution. The duplication is the price of decoupling.

7. De-duplication trades the **independence** of the two copies (zero connascence between the call sites) for **centralized connascence of algorithm** routed through one shared procedure. It's a **win** when the call sites encode the same knowledge — you've strengthened the right coupling so a change happens in one place. It's a **loss** when they encode different knowledge — you've manufactured strong, hidden connascence where there was none, so a change for one caller now ripples to the others.

</details>

---

## Cheat Sheet

```
DETECTION = REPRESENTATION + SIMILARITY FUNCTION
  tokens   → Type-1/2/3   cheap, scales (CPD, jscpd, Simian, SourcererCC)
  AST      → Type-1/2/3   coherent, refactorable clones (Deckard, NiCad, CloneDR)
  PDG      → Type-4       NP-complete (subgraph iso); research-grade only
  embeddings → ~Type-4    learned vector + LSH; fast, approximate, modern

TOKEN-BASED CORE
  lex → normalize (drop comments/ws; identifiers → placeholder)   # Type-2 → exact match
  suffix array + LCP array (Kasai)   runs of LCP ≥ L = clone groups   # O(n)
  Karp-Rabin rolling hash            O(1) window slide; bucket → candidates
  winnowing / MinHash + LSH          sparse fingerprints → corpus-scale lookup

AST-BASED CORE
  bottom-up STRUCTURAL hash per subtree (ignore names) → bucket → confirm
  Deckard: subtree → count vector → LSH near-neighbor   # summarize-then-ANN

THE PRECISION/RECALL KNOBS
  min clone length   low → boilerplate noise (↓precision); high → miss medium clones (↓recall)
  normalization      identifiers (default) < +literals < +types (aggressive → false positives)
  gap tolerance      generous → catch evolved Type-3 (↑recall) but glue unrelated code (↓precision)
  → pre-merge gate: favor PRECISION   |   triage report: favor RECALL
  → always suppress generated code / equals-hashCode / migrations / table tests

THE DESIGN JUDGMENT
  DRY is about KNOWLEDGE, not text (Hunt & Thomas)
  "Duplication is cheaper than the wrong abstraction" (Metz) — reversibility asymmetry
  incidental similarity (looks alike) ≠ essential sameness (one concept) — DRY only the latter
  Rule of Three / AHA — wait for 3 concrete examples before abstracting
  wrong abstraction: back it OUT (inline → let evolve), don't add another flag
  connascence: de-dup = trade copy independence for centralized coupling
  deliberate duplication across bounded contexts/services = the correct decoupling (avoid shared kernel)
```

---

## Summary

- A clone detector is a **representation** (tokens → AST → PDG → embeddings) plus a **similarity function** (exact → normalized → vector-distance → isomorphism). Those two choices fix the maximum clone type, the cost, and the precision/recall regime — every behavior you see follows from them.
- **Token-based** detection scales because two reductions stack: **normalization** turns Type-2 approximate matching into exact substring matching, and **suffix arrays + LCP** (or **Karp-Rabin rolling hashes**) turn substring-finding into a near-linear scan. This is the backbone of every fast shipped tool.
- **AST-based** detection compares coherent, refactorable subtrees via **structural hashing**, and **Deckard** made it scale with the field's most reusable idea: *summarize a subtree as a count vector, then use LSH near-neighbor search* — the same pattern as MinHash and neural code embeddings.
- **Type-4** semantic detection needs **PDG subgraph isomorphism**, which is **NP-complete**; that wall is why no mainstream tool ships it and why the practical world routed around it with approximate **learned embeddings**.
- The **precision/recall trade** lives in three knobs — **minimum clone length**, **normalization level**, and **gap tolerance**. Tune them to the *decision* the report drives: precision for a pre-merge gate, recall for a triage report, and always de-noise the irreducible boilerplate.
- The design half is the harder half. **DRY is about knowledge, not text.** Per Metz, **duplication is cheaper than the wrong abstraction** because it's reversible and the wrong abstraction isn't. **Connascence** is the lens: de-duplication trades copy independence for centralized coupling — a win for one concept, a loss for two. And **deliberate duplication across boundaries** (bounded contexts, services, test/prod) is the *correct decoupling*, not debt.

You now own both halves: the algorithms that decide *where* the similarity is, and the design theory that decides *whether it matters*. The next layer — [professional.md](professional.md) — is about operating duplication policy across an organization: gates, budgets, and the dashboards that make the metric actionable without making it a target.

---

## Further Reading

- **Sandi Metz — "The Wrong Abstraction" (2016).** The essay. Short, precise, and the single most important read on this page; "duplication is cheaper than the wrong abstraction" in full argument.
- **Andy Hunt & Dave Thomas — *The Pragmatic Programmer*.** The original, careful definition of DRY as *one authoritative representation of knowledge* — not "don't repeat text."
- **Jiang, Misherghi, Su, Glondu — "DECKARD: Scalable and Accurate Tree-Based Detection of Code Clones" (ICSE 2007).** The characteristic-vector + LSH approach, in the original.
- **Baxter et al. — "Clone Detection Using Abstract Syntax Trees" (ICSM 1998).** The foundational AST subtree-hashing technique (CloneDR).
- **Komondoor & Horwitz — "Using Slicing to Identify Duplication in Source Code" (SAS 2001).** PDG-based semantic clone detection and the isomorphism approach.
- **Sajnani et al. — "SourcererCC: Scaling Code Clone Detection to Big-Code" (ICSE 2016).** Inverted-index fingerprinting for hundred-million-line corpora.
- **Schleimer, Wilkerson, Aiken — "Winnowing: Local Algorithms for Document Fingerprinting" (SIGMOD 2003).** The fingerprinting algorithm behind Moss; the math of robust local fingerprints.
- **Meilir Page-Jones — *What Every Programmer Should Know About Object-Oriented Design*** (and Jim Weirich's talks on connascence) — the connascence taxonomy as a coupling lens.
- **Roy, Cordy, Koschke — "Comparison and Evaluation of Code Clone Detection Techniques and Tools: A Qualitative Approach" (2009).** The survey that maps the whole field across representations and clone types.

---

## Related Topics

- [03 — Coupling & Cohesion Metrics](../03-coupling-and-cohesion-metrics/senior.md) — the coupling that a wrong de-duplication manufactures, and the afferent-coupling cost a shared abstraction imposes.
- [06 — Code Health Dashboards](../06-code-health-dashboards/senior.md) — how the duplication number is aggregated, trended, and (mis)used alongside complexity and churn.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set.
- [Code Craft → Refactoring](../../../code-craft/refactoring/) — the mechanics of *acting* on a clone: Extract Method/Class when the knowledge is genuinely shared, and inlining when you're backing out a wrong abstraction.
