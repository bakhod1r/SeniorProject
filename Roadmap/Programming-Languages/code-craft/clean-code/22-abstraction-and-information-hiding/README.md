# Abstraction & Information Hiding

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

Based on the ideas in Ousterhout's *A Philosophy of Software Design* — **deep modules** (a simple interface over substantial functionality), information hiding, and "complexity = dependencies + obscurity." Distinct from [Modules & Packages](../19-modules-and-packages/README.md) (which is about *physical structure and layering*): this chapter is about the **quality of an abstraction** — how much a module hides and how little it makes its callers know.

The positive rules will cover: making interfaces deeper than their implementations, hiding design decisions behind one module, "design it twice," and pulling complexity downward.

## Anti-Patterns to Cover

- **Shallow modules** — an interface nearly as complex as the implementation it hides, so it earns no leverage
- **Information leakage** — the same design decision exposed in two or more modules that must change together
- **Temporal decomposition** — splitting code by *order of execution* instead of by *what knowledge each unit hides*
- **Pass-through methods** — a method that does nothing but forward to another layer, adding indirection without abstraction
- **Configuration parameters that leak a decision** the module is best placed to make, onto every caller
- **Over-exposure** — public fields/methods or leaked internal types that should be private
- **"Classitis"** — a swarm of tiny classes that each hide almost nothing
- **Generic names** (`Manager`, `Util`, `Helper`, `Data`) that signal an abstraction hiding nothing coherent
- **Conjoined methods** — units you cannot understand or change in isolation from one another

See the [chapter README](../README.md) for the positive rules.
