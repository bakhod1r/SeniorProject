# IDE & Automated Refactorings — Senior

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

At senior level the questions change. Not "which button" but: *What is the tool actually doing when it renames a symbol? Why is the guarantee airtight in Kotlin and probabilistic in Python? And how do I design code so the analysis succeeds — so the tools can carry the maintenance load instead of giving up at every dynamic edge?*

---

## 1. How Rename actually resolves references

Rename feels like magic; it's just a pipeline you should be able to reconstruct.

1. **Lex + parse** every relevant file into an AST. The AST is purely syntactic — it knows `foo.bar()` is a method call on `foo`, but not *which* `bar`.
2. **Build the symbol table / binding.** A semantic pass walks the AST and resolves each *name occurrence* to a *declaration*. `total` on line 30 gets a pointer to the field declared on line 5. This binding is the heart of the matter — it turns "the characters t-o-t-a-l" into "this specific declared symbol."
3. **Build a reference index.** For the declaration you're renaming, collect every occurrence whose binding points at it. In a statically-typed language this set is *complete and exact*: the compiler had to resolve every reference to type-check, so the binding already exists.
4. **Check for conflicts.** Would the new name clash with another symbol visible in any reference's scope? Would it shadow a field, collide with an overload, or break an override? This is a *scope analysis* over each reference site.
5. **Rewrite the AST nodes** (the declaration + all references), then **pretty-print** back to text, preserving formatting where possible.
6. **Optionally** scan comments/strings *textually* and offer those as a separate, opt-in set — because those are *not* in the binding and cannot be proven to refer to the symbol.

Steps 2–4 are where the guarantee lives, and they're exactly the steps a dynamically-typed language can't fully perform.

```text
text  ──lex/parse──▶  AST  ──bind──▶  resolved symbols  ──index──▶  reference set
                                          │                              │
                                   (where dynamic                 (complete & exact
                                    languages get stuck)           iff binding is total)
```

## 2. Why dynamic languages are structurally weaker

The crux: **binding requires knowing the type of the receiver**, and in a dynamic language the receiver's type is often unknowable until runtime.

```python
def process(handler):
    handler.execute()   # which class's execute()? unknowable statically
```

When you Rename `Job.execute` to `run`, the engine must decide whether `handler.execute()` is a reference to `Job.execute`. It can't *prove* it. So PyCharm/Pylance fall back to **heuristics**:

- **Import-graph reachability:** is `Job` even imported in this module?
- **Local type inference:** was `handler` assigned `Job(...)` nearby?
- **Type hints:** `def process(handler: Job)` upgrades the guess to near-certainty.
- **Name uniqueness across the project:** if `execute` is declared on only one class, renaming all `execute` calls is *probably* right.

Each heuristic is a source of both **false negatives** (a real reference missed because the type couldn't be inferred) and **false positives** (an unrelated `execute` on a different class swept in). Either way the green checkmark is now a *probability*, not a *proof*. This is why the verification discipline (preview review + run the suite) is not optional in dynamic languages — it's doing the job the binding couldn't.

The same gradient explains TypeScript: every `any` is a hole in the binding. `const x: any = get(); x.foo()` makes `x.foo` unresolvable, degrading Rename of `foo` to a guess. **Typing your code is not just runtime safety — it's tooling capability.** A well-typed codebase is a *refactorable* codebase.

## 3. Designing code so the tools CAN help

Senior leverage: shape the code so the analyzer's binding stays *total* — so automated refactorings remain provably correct across the lifetime of the system.

**Prefer static dispatch over name-based dynamic dispatch.**

```java
// HOSTILE to tooling — reference invisible to the binding
Method m = obj.getClass().getMethod("process" + type);  // "processOrder", "processRefund"...
m.invoke(obj, args);

// FRIENDLY — every call is a resolved reference; Rename/Find-Usages just work
interface Processor { void process(Request r); }
Map<Type, Processor> processors;
processors.get(type).process(req);
```

The reflective version saves a few lines and *destroys* refactorability: rename `processOrder` and the string `"process" + type` is silently stale. The polymorphic version is longer and *fully analyzable*.

**Keep contracts in types, not strings.** A field name duplicated as a JSON key, a column name, an event name, or a DI bean id is a reference the IDE can't track. Where you can, derive the string *from* the symbol (so a rename forces the string to follow) or centralize the mapping in one annotated place the tooling does see:

```java
// The @Column makes the DB name explicit and independent — rename the field freely,
// the mapping is one reviewed line, not a guess scattered through query strings.
@Column(name = "customer_name")
private String customerName;
```

**Avoid `any` / untyped escape hatches in hot, frequently-refactored code.** They're acceptable at true system boundaries (deserialization edges); they're a tax everywhere else, paid every time someone wants to rename or move.

**Keep methods extractable.** Code with tangled control flow and locals written in multiple branches resists Extract Method (no single return). Code with clear single-purpose blocks extracts cleanly. Designing for extractability *is* designing for change.

> **When NOT to over-rotate:** you can't (and shouldn't) eliminate every dynamic feature — serialization, plugin loading, and frameworks legitimately use reflection. The senior move is to *fence* it: isolate the unanalyzable code behind a thin, well-tested boundary, and keep the bulk of the domain in fully-typed, fully-refactorable code.

## 4. Combining automated refactorings into larger moves

Big architectural changes are *plans expressed as sequences of guaranteed steps*. The senior skill is decomposing a goal into a chain where every intermediate state compiles and passes tests.

Example — **split a god class into two**, fully via automated refactorings:

1. **Extract Method** to give each tangled responsibility a named seam.
2. **Move Method/Field** the cluster belonging to responsibility B onto a temporary delegate (Extract Delegate / Extract Class).
3. **Change Signature** to thread any newly-needed dependencies as parameters rather than reaching back into the original class.
4. **Extract Interface** on the new class if callers should depend on a role, not the concrete type.
5. **Inline** the leftover delegating shims on the original class once nothing needs them.

Each step is independently revertible. The *plan* is risky; each *step* is not. This is the same philosophy as a **parallel-change (expand/contract)** migration: never a flag day, always a sequence of safe states. When the sequence has to span files the IDE can't atomically touch (config, SQL), you splice in a codemod step ([`../02-codemods-and-ast-transforms/senior.md`](../02-codemods-and-ast-transforms/senior.md)) and guard it with the safety net ([`../03-automated-safety-nets/senior.md`](../03-automated-safety-nets/senior.md)).

## 5. The semantics-changing traps a senior must know

Automated ≠ behavior-preserving in *every* case. The tool preserves behavior *modulo its model*; where the model is incomplete, edge cases leak:

- **Overload resolution shift.** Change Signature that adds a parameter can make a call site bind to a *different* overload that now matches better. The code compiles; the call dispatches elsewhere. (See [find-bug.md](find-bug.md).)
- **Shadowing on Rename.** Renaming a parameter to match a field name turns `field = param` into `field = field` semantics in subtle spots, or makes a local shadow an outer variable. Good engines warn; verify anyway.
- **Inline of an overridden method.** Inlining a method body into a class with subclasses can erase a polymorphic hook — the subclass override no longer participates.
- **Side-effect duplication on Inline Variable.** Inlining `x = expensive()` used twice turns one call into two. If `expensive()` has side effects or cost, behavior/performance changes.
- **Extract Method capturing mutable state by value vs reference.** Across languages with different closure-capture semantics, an extracted block may capture differently than the inlined original.

The senior habit: treat the preview's *conflict* and *warning* panes as the most important part of the dialog, and keep tests that exercise the *branches*, not just the happy path — because that's where these traps hide.

## 6. Next

- **[professional.md](professional.md)** — tooling reality across IntelliJ/ReSharper/LSP, refactoring safety in CI, and team conventions for trusting automation.
- **[interview.md](interview.md)** — the conceptual questions (why Rename is safe, when Extract Method changes semantics, IDE vs codemod).
- Deeper: [`../02-codemods-and-ast-transforms/senior.md`](../02-codemods-and-ast-transforms/senior.md) · [`../../02-refactoring-techniques/06-dealing-with-generalization/senior.md`](../../02-refactoring-techniques/06-dealing-with-generalization/senior.md)
