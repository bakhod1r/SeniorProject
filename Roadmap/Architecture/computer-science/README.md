# Computer Science Roadmap

- Roadmap: https://roadmap.sh/computer-science

This roadmap is the **senior / staff deep-dive layer** of computer science: how each
layer works **internally and why** — the bar that separates senior/staff engineers
from "knows how to use it." The roadmap.sh intro topics that overlap with other
roadmaps in this repo are **not re-authored here** (see *Foundations* below); they
live at their authoritative home. Each subtopic here is a skeleton folder, content TBD.

## Deep-Dive Sections (bottom-up)

Ordered foundations → applied, each layer building on the one before it.

1. [Discrete Mathematics](01-discrete-mathematics/) — logic & proofs, set theory, combinatorics, probability, graph theory, number theory, recurrences, boolean algebra (the math under algorithm analysis & complexity)
2. [Theory of Computation](02-theory-of-computation/) — automata, context-free grammars, Turing machines/computability, halting problem, P vs NP/NP-completeness, reductions
3. [Information Theory](03-information-theory/) — entropy/Shannon, compression (Huffman/LZ77), error-correcting codes
4. [Computer Architecture](04-computer-architecture/) — pipelining/OOO, branch prediction, cache coherence (MESI), TLB, NUMA, memory ordering, SIMD, mechanical sympathy
5. [Operating Systems](05-operating-systems/) — scheduler internals, virtual memory, page replacement, IPC, I/O models (epoll/io_uring), context switching, interrupts, real-time
6. [Concurrency & Parallelism](06-concurrency-and-parallelism/) — memory models, happens-before, atomics/CAS, lock-free/wait-free, Amdahl/USL, race conditions/ABA, actor/CSP
7. [Networking Internals](07-networking-internals/) — TCP congestion/flow control, HOL blocking, TLS 1.3 handshake, QUIC/HTTP3, L4 vs L7 LB, latency numbers, DNS/anycast, network namespaces
8. [Compilers & Language Theory](08-compilers-and-language-theory/) — lexing/parsing, AST/semantic analysis, IR/SSA, optimization passes, codegen, JIT vs AOT, garbage collection
9. [Database Internals](09-database-internals/) — LSM vs B-tree storage, MVCC, WAL/recovery, query planner, consensus (Raft/Paxos), CRDTs/vector clocks, distributed transactions
10. [Distributed Systems Theory](10-distributed-systems-theory/) — CAP/PACELC, FLP impossibility, consistency models, logical/vector clocks, quorums/gossip, consensus foundations
11. [Cryptography & Security](11-cryptography-and-security/) — symmetric (AES), asymmetric (RSA/ECC), hash/KDFs, TLS/PKI internals, zero-knowledge proofs, side-channel attacks
12. [Programming Language Theory](12-programming-language-theory/) — lambda calculus, operational/denotational semantics, type systems & inference (Hindley-Milner), polymorphism/subtyping, effects/monads, dependent & refinement types
13. [GPU & Parallel Computing](13-gpu-and-parallel-computing/) — GPU architecture & execution model, CUDA/GPGPU, memory coalescing, parallel primitives (scan/reduce), parallel algorithm design, graphics rendering pipeline
14. [Numerical Methods & Scientific Computing](14-numerical-methods-and-scientific-computing/) — floating-point error analysis, numerical stability/conditioning, linear solvers & decompositions, iterative methods, FFT/spectral methods, numerical integration & ODEs

**Companion roadmaps:**
- [Data Structures & Algorithms](../../Data/datastructures-and-algorithms/) — algorithmic foundations
- [System Design](../system-design/) — applying CS at the architecture level
- [Databases](../../Backend/databases/) — vendor-agnostic database concepts

---

## Foundations — covered in their canonical roadmaps

The roadmap.sh "computer science" intro repeats material that already lives —
more thoroughly — in other roadmaps in this repo. To avoid duplication, those
topics are **not** re-authored here; learn them at their authoritative home:

| roadmap.sh topic | Learn it here |
|-------|---------------|
| Pick a Language | [choosing-a-language-and-polyglot](../../Programming/choosing-a-language-and-polyglot/) · [languages/](../../Programming/languages/) |
| Data Structures | [DSA · basic-data-structures](../../Data/datastructures-and-algorithms/05-basic-data-structures/) · [trees](../../Data/datastructures-and-algorithms/09-trees/) · [graphs](../../Data/datastructures-and-algorithms/11-graphs/) |
| Asymptotic Notation | [DSA · asymptotic-notation](../../Data/datastructures-and-algorithms/06-algorithmic-complexity/04-asymptotic-notation/) |
| Common Algorithms | [DSA · sorting](../../Data/datastructures-and-algorithms/07-sorting-algorithms/) · [search](../../Data/datastructures-and-algorithms/08-search-algorithms/) · [greedy](../../Data/datastructures-and-algorithms/14-greedy-algorithms/) · [strings](../../Data/datastructures-and-algorithms/17-string-algorithms/) |
| Data Representation | [language-internals/data-representation-and-numerics](../../Programming/language-internals/data-representation-and-numerics/) (endianness, IEEE-754, Unicode) |
| Common UML Diagrams | [documentation/12-uml-diagrams](../../Programming/code-craft/documentation/12-uml-diagrams/) · [diagrams-as-code](../../Programming/code-craft/documentation/08-diagrams-as-code/) |
| Design Patterns | [code-craft/design-patterns](../../Programming/code-craft/design-patterns/) *(authoritative catalog)* |
| Complexity Classes (P/NP) | [DSA · complexity-classes-p-np](../../Data/datastructures-and-algorithms/06-algorithmic-complexity/06-complexity-classes-p-np/) — deeper in [02. Theory of Computation](02-theory-of-computation/) |
| Tries | [DSA · trie](../../Data/datastructures-and-algorithms/09-trees/05-trie/) · [advanced-structures](../../Data/datastructures-and-algorithms/21-advanced-structures/) |
| Balanced Search Trees | [DSA · trees](../../Data/datastructures-and-algorithms/09-trees/) (BST · AVL · Red-Black · 2-3 · 2-3-4 · B-Tree) |
| Databases | [Backend/databases](../../Backend/databases/) *(concepts)* · engine internals in [09. Database Internals](09-database-internals/) |
| Networking | [07. Networking Internals](07-networking-internals/) |
| Security | [11. Cryptography & Security](11-cryptography-and-security/) · [Security roadmap](../../Security/) |
| How Computers Work | [04. Computer Architecture](04-computer-architecture/) |
| Processes & Threads | [05. Operating Systems](05-operating-systems/) · [06. Concurrency & Parallelism](06-concurrency-and-parallelism/) |
| System Design | [Architecture/system-design](../system-design/) (34-section roadmap) |
