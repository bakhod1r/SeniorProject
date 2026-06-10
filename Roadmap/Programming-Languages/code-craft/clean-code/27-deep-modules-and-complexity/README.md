# Deep Modules & Complexity

Status: ✅ 8-file suite complete (junior · middle · senior · professional · interview · tasks · find-bug · optimize)

The **nature of complexity itself** and the strategic mindset for fighting it, drawn from Ousterhout's *A Philosophy of Software Design*. Where [Abstraction & Information Hiding](../22-abstraction-and-information-hiding/README.md) focuses on *building good abstractions* (deep modules, hiding decisions), this chapter is about **diagnosing complexity** — its symptoms (change amplification, cognitive load, unknown-unknowns), its causes (dependencies + obscurity), and the *tactical-vs-strategic* programming choice that lets it accrete or keeps it down. It complements [Cognitive Load](../20-cognitive-load/README.md) (the reader's working-memory cost) by zooming out to the whole-system economics of complexity.

The positive rules will cover: recognizing the three symptoms of complexity, attacking its two root causes, strategic (investment) vs tactical (just-make-it-work) programming, complexity as something that accumulates incrementally, and "design it twice."

## Anti-Patterns to Cover

- **Tactical tornado** — always taking the fastest shortcut, leaving a wake of complexity
- **Change amplification** — one conceptual change requiring edits in many places
- **High cognitive load** — needing to know too much to make a small change
- **Unknown-unknowns** — no obvious way to tell what a change might break
- **Obscurity** — important information that isn't obvious (undocumented, non-local, misnamed)
- **Dependency creep** — modules that can't be understood or changed independently
- **"It's just one special case"** — incremental complexity justified one harmless addition at a time

See the [chapter README](../README.md) for the positive rules.
