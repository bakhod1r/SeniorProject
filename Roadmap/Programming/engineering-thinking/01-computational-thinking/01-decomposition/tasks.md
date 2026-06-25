> Practice tasks for **decomposition**. Global constraints: for every task, state your reasoning *before* drawing boxes. Justify each cut with a named criterion (cohesion, coupling, information hiding / Parnas's "what's likely to change," domain seam, invariant containment). For any boundary you draw, name **what crosses the interface** and **whether any invariant straddles it**. There is rarely one right answer — there are defensible answers and indefensible ones. A cut you can't justify is a cut you don't understand.

---

## Task 1 — Decompose: a URL shortener

Design the decomposition of a URL-shortening service (`POST /shorten` returns a short code; `GET /:code` redirects). List the pieces, give each a one-sentence responsibility, and name the interface between them.

**Deliverable:** a module list (4–7 modules) and a one-line description of what each *hides*. Then identify the single piece most likely to change first and explain why your cut confines that change.

---

## Task 2 — Find the natural seam: a "report" feature

A function does this, top to bottom: queries three tables, joins the rows in memory, applies business rules to compute totals, formats the result as an HTML table, and emails it on a schedule.

**Do:** identify the seams. Which concerns change for *different reasons*? Draw the boundaries and, for each, say what change it isolates (e.g. "new email provider," "new column," "new business rule," "switch HTML→PDF"). Which split is tempting but wrong?

---

## Task 3 — Spot the bad cut: shared `Product`

An e-commerce codebase has one `Product` class used by Catalog (name, images, SEO), Inventory (SKU, warehouse, quantity), and Pricing (base price, tax category, discounts). Every team edits the same file; deploys block each other.

**Do:** diagnose the decomposition error using the precise term. Propose the corrected boundaries. State what now crosses each boundary and what the word "product" means inside each piece. What DDD concept names this?

---

## Task 4 — Spot the bad cut: over-decomposition

You inherit code where `validateOrder()` calls `validateOrderHeader()` → `validateOrderHeaderId()` → `validateOrderHeaderIdNotNull()`, each a 2-line function used exactly once, spread across four files.

**Do:** apply the over-decomposition litmus test to each function. Decide which to inline and which (if any) to keep, and state the rule you used. Then describe the symptom that signals over-decomposition in general.

---

## Task 5 — Invariant containment

You're splitting checkout into a service. The business invariant is: *never charge a card without creating an order, and never create an order without reserving inventory.*

**Do:** the invariant touches Payments, Orders, and Inventory. Decide where the service boundary goes so the invariant stays inside one piece. Specify the operations the boundary exposes to the other two (hint: idempotent, compensable). What complexity have you *avoided* by keeping the invariant whole?

---

## Task 6 — Functional vs data vs domain

For each scenario, name which decomposition lens fits best and why:

1. Processing a 50 GB log file across 16 cores.
2. An order-management application with billing, shipping, and support.
3. An image pipeline: decode → resize → watermark → encode.
4. A nightly job that reconciles payments per region.

**Deliverable:** the lens for each, plus one sentence on the failure mode if you'd used a different lens.

---

## Task 7 — Debug by bisection

A nightly ETL has 6 stages: extract → clean → join → aggregate → format → load. The loaded table has wrong totals this morning. You may add at most **3** inspection points and must locate the faulty stage.

**Do:** specify exactly where you'd place each check and how each result narrows the search. Show that 3 probes suffice for 6 stages. Then state: what property must hold for `git bisect` to work this way over commits?

---

## Task 8 — Decompose to estimate

Your lead asks how long "add CSV export to the admin panel" will take. Don't guess the whole.

**Deliverable:** a work-breakdown of 5–9 tasks, each with a rough estimate that genuinely fits in your head (e.g. "wire the route — 1h", "stream rows to avoid OOM — 3h"). Sum them. Explain in one line why this sum is more trustworthy than a single gut estimate for the whole.

---

## Task 9 — Conway's law audit

A team of 12 owns one "platform" service. Three sub-groups have formed informally: one always works on the search code, one on billing, one on notifications. Cross-area changes cause constant merge pain.

**Do:** what is Conway's law predicting here, and what is the architecture *trying* to become? Propose a team + service decomposition. Then describe the **Inverse Conway Maneuver** you'd use to get there, and the one check that tells you the boundaries are right.

---

## Task 10 — Decompose an initiative (vertical vs horizontal)

A 9-month project: "replace the legacy billing engine." A peer proposes: Q1 new data model, Q2 new calculation engine, Q3 new UI, Q4 integrate and cut over.

**Do:** name the anti-pattern in that plan and the specific risk it concentrates. Re-decompose the project into 4–6 **vertical slices**, each independently shippable and each de-risking the next. State which slice proves the scariest unknown, and what value survives if the project is cancelled after slice 3.

---

## Task 11 — Recomposition cost check

You've decomposed a feature into `OrderService` and `PricingService`. Tracing one "place order" request, you find it makes 30 calls from Order to Pricing (one per line item, plus tax lookups).

**Do:** what does the round-trip count tell you about *where* you cut? Is the seam in the right place? Propose either a re-cut or an interface redesign that fixes it, and explain why the original interface was "fat."

---

## Task 12 — Divide-and-conquer as decomposition

Write (in pseudocode or any language) the decomposition structure of merge sort, and explicitly label the three phases — **divide**, **conquer**, **recompose**. Then answer: which phase is the "recomposition," why is it the part that does the real work here, and what general lesson does that teach about every decomposition?

---

### How to use these

Work them on paper or in a doc first; the value is in the *justification*, not the boxes. Cross-check your reasoning against [middle.md](middle.md) (coupling/cohesion, over-decomposition), [senior.md](senior.md) (seams, Parnas, invariants), and [professional.md](professional.md) (Conway, vertical slices). Related practice lives in [problem-solving](../../02-problem-solving/) and [algorithmic thinking](../04-algorithmic-thinking/).
