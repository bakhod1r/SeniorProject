# GRASP — Specification Reading Guide

> GRASP is a *literature* topic, not a language-spec topic. There is no JLS section for "Information Expert." The canonical source is Craig Larman's **Applying UML and Patterns: An Introduction to Object-Oriented Analysis and Design and Iterative Development**, 3rd edition (Prentice Hall, 2004) — specifically **Chapter 17, "GRASP: Designing Objects with Responsibilities"** and **Chapter 25, "GRASP: More Objects with Responsibilities"** (later patterns). This file maps every claim in the other eight files to its authoritative source, and relates GRASP to the GoF, SOLID, and connascence literature it sits among.

---

## 1. The primary source — Larman, *Applying UML and Patterns* (3e)

GRASP was introduced by Craig Larman across the editions of this book (1st ed. 1997, 2nd ed. 2001, 3rd ed. 2004). The 3rd edition is the definitive reference. The patterns are split across two chapters:

| Chapter / Section | Patterns covered |
| --- | --- |
| **Ch. 17 — GRASP: Designing Objects with Responsibilities** | Information Expert, Creator, Controller, Low Coupling, High Cohesion |
| **Ch. 25 — GRASP: More Objects with Responsibilities** | Polymorphism, Pure Fabrication, Indirection, Protected Variations |

Larman frames each pattern in a uniform template — **Name / Problem / Solution / Discussion / Contraindications / Benefits / Related Patterns** — the same problem/solution form GoF uses. That uniformity is deliberate: Larman's thesis (Ch. 17, §17.1) is that *responsibility assignment* is a design activity governed by patterns, just as object structure is.

The two umbrella chapters are bracketed by Larman's broader method: **Responsibility-Driven Design (RDD)** (Ch. 17, §17.7), which he credits to **Rebecca Wirfs-Brock**. GRASP is Larman's distillation of RDD into nine named, teachable patterns. The "doing/knowing" responsibility distinction in the junior file comes from §17.6.

---

## 2. Pattern-by-pattern source map

| Pattern | Larman 3e location | Core statement (paraphrased from Larman) |
| --- | --- | --- |
| **Information Expert** | Ch. 17, §17.11 | Assign a responsibility to the class with the information necessary to fulfil it. |
| **Creator** | Ch. 17, §17.12 | B creates A if B aggregates/contains/records/closely-uses A, or has A's initializing data. |
| **Controller** | Ch. 17, §17.13 | Assign system-event handling to a facade (system/root/device) or use-case controller. |
| **Low Coupling** | Ch. 17, §17.14 | Assign responsibilities so coupling remains low; an *evaluative* pattern. |
| **High Cohesion** | Ch. 17, §17.15 | Assign responsibilities so cohesion remains high; an *evaluative* pattern. |
| **Polymorphism** | Ch. 25, §25.1 | When behaviour varies by type, assign via polymorphic operations to the varying types. |
| **Pure Fabrication** | Ch. 25, §25.2 | Assign a cohesive responsibility set to an artificial class to support cohesion/coupling. |
| **Indirection** | Ch. 25, §25.3 | Assign responsibility to an intermediate object to mediate and avoid direct coupling. |
| **Protected Variations** | Ch. 25, §25.4 | Wrap predicted points of variation/instability behind a stable interface. |

Note the deliberate ordering in Ch. 17: the three *placement* patterns (Expert, Creator, Controller) come first, then the two *evaluators* (Low Coupling, High Cohesion) that judge them. Larman teaches you to place, then evaluate — exactly the loop in `middle.md`.

---

## 3. Protected Variations — Larman's superpattern and its ancestry

Larman (Ch. 25, §25.4) is explicit that **Protected Variations (PV) generalises several older ideas**, and he names the lineage:

- **Information hiding** — **David Parnas**, *On the Criteria To Be Used in Decomposing Systems into Modules*, CACM 15(12), 1972. PV is Parnas's information hiding applied to *predicted* change.
- **Open–Closed Principle** — **Bertrand Meyer**, *Object-Oriented Software Construction* (Prentice Hall, 1988/1997). Meyer's original OCP (open for extension via inheritance, closed because the existing interface is fixed). PV subsumes it.
- **"Program to an interface, not an implementation"** — **GoF**, *Design Patterns* (1994), §1.6.
- **Law of Demeter** — Larman links PV's stable interfaces to LoD's "don't talk to strangers."

Larman attributes the *term* "Protected Variations" to **James Coplien**. The practical upshot (and `senior.md`'s claim): OCP, DIP, polymorphism, and information hiding are all *special cases* of PV. Larman states this directly in §25.4's discussion.

---

## 4. GRASP ↔ GoF — the patterns-as-precipitates relationship

The claim in `middle.md`/`senior.md` that "GoF patterns are GRASP forces made concrete" is Larman's own framing. He weaves GoF into the GRASP chapters and beyond:

- **GoF source:** Gamma, Helm, Johnson, Vlissides, *Design Patterns: Elements of Reusable Object-Oriented Software* (Addison-Wesley, 1994).
- Larman applies **Factory** (Ch. 25/26) as Creator + Pure Fabrication + PV; **Adapter** as Indirection + PV; **Strategy** as Polymorphism + PV; **Facade** as Controller + Indirection; **Observer/Publish-Subscribe** as Indirection + Low Coupling. These mappings appear in Larman's "applying patterns" chapters (Ch. 26 in 3e, *Applying GoF Design Patterns*).

The pedagogical point Larman makes (and `senior.md` echoes): teaching GRASP *before* GoF means students learn the *forces* before the *catalogue*, so the 23 GoF patterns become recognisable as recurring solutions to GRASP-force pressure rather than 23 things to memorise.

---

## 5. GRASP ↔ SOLID — the cross-walk and its sources

| GRASP | SOLID counterpart | SOLID source |
| --- | --- | --- |
| High Cohesion | Single Responsibility (SRP) | Robert C. Martin, *Agile Software Development: Principles, Patterns, and Practices* (Prentice Hall, 2002), Ch. 8 |
| Polymorphism + Protected Variations | Open/Closed (OCP) | Martin, *ASD:PPP* Ch. 9; Meyer, *OOSC* (original OCP) |
| Indirection / Protected Variations | Dependency Inversion (DIP) | Martin, *ASD:PPP* Ch. 11 |
| Low Coupling | (the goal of all SOLID) | implicit |
| — | Liskov Substitution (LSP) | Liskov & Wing, *A Behavioral Notion of Subtyping*, TOPLAS 16(6), 1994 |
| — | Interface Segregation (ISP) | Martin, *ASD:PPP* Ch. 12 |
| Information Expert / Creator / Controller | (no SOLID equivalent) | GRASP-only placement patterns |

The acronym **SOLID** was coined by **Michael Feathers** (~2004) from Martin's principles; the principles themselves predate it. Cross-reference the local treatment at [../../03-design-principles/01-solid-principles/](../../03-design-principles/01-solid-principles/). The key spec-level point: SOLID and GRASP overlap on *dependency shaping* (OCP/DIP ↔ PV/Indirection) but GRASP *uniquely* covers *placement* (Expert/Creator/Controller), which SOLID does not address.

---

## 6. The connascence metric system

`senior.md` grounds Low Coupling in connascence. The source:

- **Meilir Page-Jones**, *What Every Programmer Should Know About Object-Oriented Design* (Dorset House, 1995), and the more accessible *Fundamentals of Object-Oriented Design in UML* (Addison-Wesley, 2000). Page-Jones defines the connascence taxonomy (Name, Type, Meaning, Position, Algorithm, Execution, Timing, Value, Identity) and the two rules: *minimise overall connascence* and *maximise locality of strong connascence*.

Connascence is the *measurable* refinement of GRASP's Low Coupling: where Larman says "keep coupling low," Page-Jones says *which kind* of coupling and *how strong*. The measured CK-suite cousins (CBO, RFC, LCOM) are in [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/).

---

## 7. Responsibility-Driven Design — the method GRASP distils

- **Rebecca Wirfs-Brock & Brian Wilkerson**, *Object-Oriented Design: A Responsibility-Driven Approach*, OOPSLA 1989 — the origin of RDD and CRC cards.
- **Rebecca Wirfs-Brock & Alan McKean**, *Object Design: Roles, Responsibilities, and Collaborations* (Addison-Wesley, 2003) — the book-length treatment; introduces the "role stereotypes" (Controller, Coordinator, Information Holder, Service Provider, Structurer, Interfacer) that map closely onto GRASP's placement patterns.

Larman (Ch. 17, §17.7) positions GRASP as the *learnable* core of RDD. If you want the philosophy beneath GRASP, Wirfs-Brock is the source.

---

## 8. The anemic-domain caution

`junior.md`/`senior.md` warn that Pure Fabrication, over-applied, produces an anemic domain. Source:

- **Martin Fowler**, *AnemicDomainModel* (martinfowler.com, 2003) — names the anti-pattern: a domain model of pure data holders with all behaviour in services, "an anti-pattern... contrary to the basic idea of object-oriented design."
- **Eric Evans**, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (Addison-Wesley, 2003) — Ch. 5 (Entities, Value Objects, Services) gives the *positive* rule: a **Domain Service** (Larman's Pure Fabrication for cross-aggregate logic) is appropriate *only* when an operation genuinely doesn't belong to any entity or value object. See [../../08-tactical-ddd/](../../08-tactical-ddd/) for the DDD building blocks.

The GRASP framing of the anemic-domain line: keep responsibilities that operate on an object's *own data and invariants* on the object (Information Expert); fabricate only for responsibilities that are *cross-aggregate or infrastructural*.

---

## 9. Reading list

1. **Craig Larman**, *Applying UML and Patterns*, 3rd ed. (Prentice Hall, 2004) — **Ch. 17** (Expert, Creator, Controller, Low Coupling, High Cohesion) and **Ch. 25** (Polymorphism, Pure Fabrication, Indirection, Protected Variations). The canonical GRASP text — read these two chapters in full.
2. **Larman**, same book, **Ch. 26** — *Applying GoF Design Patterns*: the GRASP→GoF bridge.
3. **GoF (Gamma et al.)**, *Design Patterns* (Addison-Wesley, 1994) — the solution catalogue GRASP forces precipitate into. Read §1 (intro) first.
4. **Robert C. Martin**, *Agile Software Development: Principles, Patterns, and Practices* (Prentice Hall, 2002) — Ch. 8–12 for the SOLID counterparts.
5. **Bertrand Meyer**, *Object-Oriented Software Construction*, 2nd ed. (Prentice Hall, 1997) — Ch. 3 (modularity), the original Open/Closed and design-by-contract.
6. **David Parnas**, *On the Criteria To Be Used in Decomposing Systems into Modules*, CACM 15(12), 1972 — information hiding, the root of Protected Variations.
7. **Meilir Page-Jones**, *Fundamentals of Object-Oriented Design in UML* (Addison-Wesley, 2000) — the connascence taxonomy behind Low Coupling.
8. **Rebecca Wirfs-Brock & Alan McKean**, *Object Design: Roles, Responsibilities, and Collaborations* (Addison-Wesley, 2003) — RDD and role stereotypes, the philosophy beneath GRASP.
9. **Martin Fowler**, *AnemicDomainModel* (martinfowler.com, 2003) — the Pure-Fabrication-gone-wrong anti-pattern.
10. **Eric Evans**, *Domain-Driven Design* (Addison-Wesley, 2003) — Ch. 5 for when a Pure Fabrication (Domain Service) is legitimate.

GRASP has no spec section to cite — when you defend a placement in review, you cite **Larman Ch. 17/25** for the pattern, **Page-Jones** for the coupling argument, and **Fowler/Evans** for the anemic-domain boundary. The authority is the literature, not the compiler.
