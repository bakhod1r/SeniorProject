# Criticisms of Clean Code

Status: ⏳ PENDING

*Clean Code* is influential but not unchallenged. A senior reader benefits from understanding the counter-arguments before applying every rule reflexively. This page is an intentional **counterweight** to the rest of this roadmap.

## Major Critiques

### "Small functions" is not free
- **John Ousterhout** — *A Philosophy of Software Design* — argues for **deep modules** with simple interfaces and substantial implementations, rather than fragmenting logic into many shallow functions.
- The cost of small functions: indirection, harder debugging (more frames in the stack), logic scattered across files, reasoning about behaviour requires reading many pieces instead of one.
- **Rule of thumb to keep:** small functions when each step has a meaningful name. **Rule of thumb to drop:** "every function under 5 lines no matter what."

### Some examples in the book are dated or contradictory
- The `Args` parser example in Chapter 14 is widely considered over-engineered for what it does.
- Different chapter co-authors disagree on subtleties of testing and concurrency, so the book is not internally consistent.

### "Comments are failures" oversimplifies
- For complex algorithms, regulatory code, security-critical paths, or non-obvious tradeoffs, comments are **load-bearing** — not failures of naming.
- The honest rule is: prefer expressive code, then add comments for the *why* that code cannot express.

### Performance vs cleanliness
- **Casey Muratori** and others in the systems community argue that excessive abstraction and "clean" indirection imposes measurable performance costs that compound at scale.
- *Clean Code, Horrible Performance* (Muratori, YouTube) demonstrates 10–100× slowdowns from rule-driven design in hot paths.
- The counter-balance: most code is not hot. Profile first, then break the rule.

### Empirical evidence is thin
- *Clean Code*'s rules are presented as wisdom, not as conclusions from controlled studies.
- The empirical software engineering literature shows **mixed evidence** for many of them — short functions, for instance, do not consistently correlate with fewer defects in studies.

### Object-orientation bias
- The book assumes classical OOP. In Go, Rust, Haskell, or modern functional-leaning JS/TS, several rules don't translate cleanly:
  - "Tell, don't ask" makes less sense without methods on data
  - "One class, one responsibility" maps imperfectly to module/package boundaries
  - Exception-based error handling — central to many *Clean Code* rules — is absent in Go and unidiomatic in Rust

## When to Defer to Clean Code
- Application/business logic with stable interfaces
- Code that will be read many times more than rewritten
- Onboarding-heavy teams where shared conventions matter more than micro-optimisation
- Java/C# codebases where the book's examples land most directly

## When to Defer to Critics
- Performance-sensitive paths (games, kernels, databases, hot HTTP handlers, embedded)
- Small, single-author scripts where overhead of indirection exceeds value
- Code with one well-defined consumer where deep modules win
- Non-OOP languages where the OOP-shaped rules don't map

## Further Reading
- John Ousterhout — *A Philosophy of Software Design* (especially Chapter 4: "Modules Should Be Deep")
- Casey Muratori — *Clean Code, Horrible Performance* (YouTube)
- *The Pragmatic Programmer* — Hunt & Thomas — broader, less prescriptive companion to *Clean Code*
- Dan Luu — essays on shallow abstractions and "clean" code costs
- Hillel Wayne — empirical software engineering writeups questioning common dogma

## How to Use This Page
Treat *Clean Code* as a strong **default** and these critiques as **explicit licence to break the rules with reason**. The senior skill is knowing which rules apply where — not following every rule everywhere.
