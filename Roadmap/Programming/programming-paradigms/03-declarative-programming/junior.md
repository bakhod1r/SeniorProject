# Declarative Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Declarative Programming
> *You stop writing the steps and start writing the answer — something else figures out the steps.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What vs How](#core-concept-1--what-vs-how)
5. [Core Concept 2 — SQL: The Clearest Example](#core-concept-2--sql-the-clearest-example)
6. [Core Concept 3 — CSS: Layout Without Pixels](#core-concept-3--css-layout-without-pixels)
7. [Core Concept 4 — Config & Markup: Data That Describes a Setup](#core-concept-4--config--markup-data-that-describes-a-setup)
8. [Core Concept 5 — The Two Hallmarks: Order-Independence & Idempotence](#core-concept-5--the-two-hallmarks-order-independence--idempotence)
9. [The Same Task, Imperative vs Declarative](#the-same-task-imperative-vs-declarative)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Here is the whole idea on one line:

> **Declarative programming means you describe the *result you want*, and a system figures out the *steps* to produce it.**

That's the opposite of what you usually do. When you write a `for` loop, you spell out every step: start at zero, look at each element, check a condition, update a running total, move on. You are the one in charge of *how*. Declarative code throws that away. You write *what* you want — "the sum of completed orders," "this box centered on the page," "a server with these ports open" — and you let an engine, a browser, or a build tool work out the steps.

You already use this every day without naming it. When you type:

```sql
SELECT name FROM users WHERE age > 18 ORDER BY name;   -- SQL: you stated WHAT, not HOW
```

…you did not write a loop. You did not say "open the table, scan each row, compare the age field, copy matching rows into a buffer, sort the buffer." You said *what set of rows you want*, and the database decided how to get them — maybe scanning the table, maybe using an index you've never heard of. That is declarative programming, and it is one of the most powerful ideas in software.

> **The mindset shift:** stop describing the *procedure*. Start describing the *destination*. The "how" still happens — but somebody else wrote it once, inside the engine, so you don't have to write it every time.

---

## Prerequisites

- **Required:** You can write a `for` loop that builds up a result (a sum, a filtered list). Examples use **Python**, **SQL**, **HTML/CSS**, and a couple of config files.
- **Required:** You've seen a web page's HTML, or run a SQL query, or written a `map`/`filter`. Any one of these is the hook.
- **Helpful:** You've read [01 — Overview & Taxonomy](../01-overview-and-taxonomy/junior.md), which introduces the imperative ↔ declarative spectrum this topic lives on.
- **Not required:** Any theory. This is the entry point for the declarative paradigm.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Imperative** | You write the **steps**: do this, then that, change this variable. You control *how*. |
| **Declarative** | You write the **goal**: describe the result; a system works out the *how*. |
| **Engine / runtime** | The thing that turns your "what" into actual steps — a query planner, browser layout engine, build tool, solver. |
| **Query language** | A declarative language for asking for data (SQL is the famous one). |
| **Markup** | A declarative language for describing structure or appearance (HTML, CSS). |
| **Configuration (config)** | Declarative data that describes a *desired setup* (YAML, JSON, a `Dockerfile`). |
| **Idempotent** | Running it once gives the same result as running it many times — re-applying changes nothing. |
| **Order-independent** | The order you write the parts doesn't change the result. |
| **Desired state** | The end result you declare; the engine's job is to make reality match it. |

> Two words to lock in: **what** (declarative) and **how** (imperative). Everything in this topic is a variation on that one distinction.

---

## Core Concept 1 — What vs How

Take one concrete task — *get the total revenue of completed orders* — and look at it written both ways in the **same language**.

```python
# IMPERATIVE — you write every step. You own the "how".
total = 0
for order in orders:
    if order.status == "completed":
        total += order.amount
# You opened the loop, tested the condition, mutated `total`, moved on.
```

```python
# DECLARATIVE-leaning — you describe WHAT the result is.
total = sum(o.amount for o in orders if o.status == "completed")
# No visible loop, no running total. You stated the result; Python does the stepping.
```

Both produce the same number. The difference isn't the syntax — it's *who does the bookkeeping*. In the first version, **you** track the counter, the iteration, the order of operations. In the second, you describe the result and hand the mechanics to the language.

Now push it all the way to the declarative end:

```sql
-- FULLY DECLARATIVE (SQL) — you don't even know how the rows are scanned.
SELECT SUM(amount) FROM orders WHERE status = 'completed';
```

Here you didn't write a loop *at all*. You didn't decide whether to scan every row or jump straight to matching ones via an index. The database's **query planner** — a piece of imperative code someone wrote once — decides all of that for you, and may even change its mind based on how much data there is.

> **Key insight:** declarative is not magic. The steps still run. The trick is that *the steps were written once, inside an engine*, so you describe the goal and reuse those steps for free, forever. Declarative code is imperative code hidden behind a good abstraction.

---

## Core Concept 2 — SQL: The Clearest Example

SQL is the textbook example of declarative programming, so it's worth seeing why. Suppose you want the three highest-paid employees in each department. Imperatively, that's real work: group the rows, sort each group, take the top of each. In SQL you just *describe it*:

```sql
SELECT department, name, salary
FROM employees
WHERE salary > 50000
ORDER BY department, salary DESC;
```

Read that out loud and notice what's missing: **there is no "how."** You never said:

- whether to read the table top-to-bottom or use an index on `salary`,
- whether to filter first and then sort, or sort first and then filter,
- how to sort (quicksort? merge sort? an already-sorted index?),
- whether to do it on one CPU core or several.

Every one of those is a *decision the engine makes for you*. It even writes an execution plan — its chosen sequence of steps — and you can ask to see it (`EXPLAIN`, which you'll meet at the senior level). The same query runs unchanged whether the table has 10 rows or 10 billion; the engine just picks a different plan.

That is the payoff of declarative code: **you wrote the intent once, and it stays correct as conditions change**, because you never hard-coded the steps that would need to change.

---

## Core Concept 3 — CSS: Layout Without Pixels

SQL is declarative for *data*. CSS is declarative for *appearance* — and it makes the "what, not how" idea vivid in a totally different domain.

Imagine centering a box on a page **imperatively**: you'd measure the window width, measure the box width, subtract, divide by two, set the left position, and then *do it all again* every time the window resizes. That's a lot of step-by-step bookkeeping.

In CSS, you declare the goal and the browser's layout engine works out the pixels:

```css
.container {
  display: flex;
  justify-content: center;   /* "I want children centered horizontally" */
  align-items: center;       /* "...and vertically too" */
  height: 100vh;
}
```

```html
<div class="container">
  <div class="box">Centered, at any window size.</div>
</div>
```

You never computed a single pixel coordinate. You said *what you want the arrangement to be*, and the **layout engine** — a large, sophisticated piece of imperative code in the browser — figures out the exact positions, *and recomputes them automatically* every time the window resizes, the font loads, or the text changes length. You declared the outcome once; the engine maintains it for you forever.

This is the same pattern as SQL, in a different costume: **describe the desired result, let an engine produce and maintain it.**

---

## Core Concept 4 — Config & Markup: Data That Describes a Setup

The third big family of declarative code is **configuration and markup** — files that aren't really "programs" at all. They're *data that describes a desired setup*, and some engine reads that data and makes it real. You write these constantly.

**HTML** describes the *structure* of a page — what's a heading, what's a list, what's a link — without saying how to draw any of it:

```html
<article>
  <h1>Declarative Programming</h1>
  <ul>
    <li>You describe the result.</li>
    <li>An engine supplies the steps.</li>
  </ul>
</article>
```

You never told the browser *how* to render a bullet, choose a font size for `<h1>`, or wrap the text. You described *what each thing is*; the browser decides how to paint it.

**YAML / JSON config** describes a *desired setup* for some tool:

```yaml
# docker-compose.yml — "I want these two services running, wired together."
services:
  web:
    image: nginx:latest
    ports: ["80:80"]
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
```

There's not a single "step" in that file. It's pure description: *what services exist, what images they use, which depends on which*. Docker Compose's engine reads it and works out the steps — pull images, create a network, start `db` before `web` (because you *declared* the dependency, not the start order).

The tell is the same every time: **the file contains nouns and relationships, not verbs in sequence.** "This service has this image" — not "first do X, then do Y." That's what makes it declarative.

---

## Core Concept 5 — The Two Hallmarks: Order-Independence & Idempotence

How can you *tell* code is declarative? Two properties show up again and again.

### Order-independence

In declarative code, the order you write things usually doesn't change the result, because you're describing *relationships*, not *a sequence*. Look at CSS:

```css
.btn {
  color: white;
  background: blue;
  padding: 8px;
}
```

Swap those three lines into any order and the button looks identical — they're *facts about the button*, not steps. Compare that to imperative code, where order is everything: swap two lines in a loop and you can get a completely different (or broken) result.

SQL is the same: the database is free to evaluate a `WHERE` and an `ORDER BY` in whatever internal order is fastest, because you described a *result set*, not a procedure.

### Idempotence

**Idempotent** means: doing it once is the same as doing it many times. Declarative configuration is usually idempotent.

```yaml
# A declarative config: "this service should have 3 replicas."
service:
  name: web
  replicas: 3
```

Apply this once, you get 3 replicas. Apply it again, you *still* get 3 replicas — nothing changes, because you declared a *desired state*, not an action like "add a replica." Contrast an imperative command:

```bash
# Imperative — NOT idempotent. Run it 3 times, get 3 extra replicas.
add_replica web
```

Idempotence is why you can re-apply a declarative config a thousand times safely, and it's a big reason declarative systems are easier to operate. (You'll see this idea become "desired-state reconciliation" — the heart of Terraform and Kubernetes — at the professional level.)

> **Rule of thumb:** if reordering the lines or re-running the whole thing changes the outcome, you're probably looking at imperative code. Declarative code tends to be order-independent and idempotent.

---

## The Same Task, Imperative vs Declarative

One task — *"make sure a web server exists, listening on port 80"* — at four levels of declarativeness. Watch the "how" disappear.

```bash
# 1. IMPERATIVE shell — every step, in order. You own all the bookkeeping.
apt-get install -y nginx
systemctl enable nginx
sed -i 's/listen 8080/listen 80/' /etc/nginx/nginx.conf
systemctl restart nginx
# If you run this twice, some steps re-do work; you must check state yourself.
```

```dockerfile
# 2. DECLARATIVE-ish (Dockerfile) — describe the image you want.
FROM nginx:latest
EXPOSE 80
COPY ./site /usr/share/nginx/html
# You declared the contents; Docker's build engine works out the layers.
```

```hcl
# 3. DECLARATIVE infra (Terraform) — describe the resource that should exist.
resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t3.micro"
  tags = { Name = "web-server" }
}
# You declared "this server should exist." Terraform decides whether to
# create it, change it, or leave it alone — and re-running is safe (idempotent).
```

```makefile
# 4. DECLARATIVE build (Makefile) — describe outputs and what they depend on.
site.html: content.md template.html
	pandoc content.md --template template.html -o site.html
# You declared "site.html depends on these files." Make decides WHETHER to
# rebuild (only if inputs changed) and figures out the order on its own.
```

Notice the trend down the list: each version says **less about the steps** and **more about the desired result**. The shell script is pure "how." The `Makefile` is almost pure "what" — you describe the dependency between files and Make's engine decides whether and in what order to run anything.

---

## Real-World Examples

You are surrounded by declarative systems. Each pairs a *thing you describe* with an *engine that does the work*.

| You write (the "what") | The engine that supplies the "how" |
|---|---|
| A SQL `SELECT` | The database **query planner** |
| HTML & CSS | The browser **layout & rendering engine** |
| A `Dockerfile` | The Docker **build engine** |
| A `Makefile` | **Make's** dependency graph (DAG) scheduler |
| Terraform / Kubernetes YAML | The **reconciler** that makes reality match your config |
| A React component (JSX) | React's **reconciler**, which updates the DOM for you |
| A spreadsheet formula `=SUM(A1:A10)` | The spreadsheet's **recalculation engine** |
| A regex `\d{3}-\d{4}` | The **regex engine** that matches it |

```jsx
// React (JSX) — you DECLARE what the UI should look like for this state.
function Greeting({ name, loggedIn }) {
  return (
    <div className="greeting">
      {loggedIn ? <h1>Welcome back, {name}!</h1> : <h1>Please log in</h1>}
    </div>
  );
}
// You never wrote "find the h1, delete the old text, insert new text."
// You described the UI as a function of state; React's reconciler does the DOM edits.
```

Notice the pattern: **in every row, you describe a result and an engine handles the steps** — scanning rows, placing pixels, building layers, ordering compilation, editing the DOM. Learning to *see* that pattern is the whole skill at this level.

---

## Mental Models

- **The restaurant order vs the recipe.** Imperative is the *recipe* — every step to cook the dish yourself. Declarative is the *order* — "I'll have the salmon." The kitchen (the engine) knows the steps. You get fed either way; one makes you do the cooking.
- **The GPS, not the turn list.** Imperative is memorizing "left, left, right, straight for two miles." Declarative is typing the *destination* into the GPS — and if a road is closed, the GPS reroutes. You declared *where*, not *how*; the engine adapts the *how* when conditions change.
- **The thermostat.** You set the *desired temperature* (declarative: 21°C), not "turn the heater on for 12 minutes" (imperative). The thermostat keeps reality matching your declared goal, idempotently — setting it to 21 again does nothing.
- **Hidden imperative inside.** Every declarative system has imperative code at its core — the query planner, the layout engine, the reconciler. Declarative is not the *absence* of steps; it's the steps being written *once, somewhere else*, so you never have to.

---

## Common Mistakes

- **Thinking declarative means "no steps happen."** The steps absolutely happen — inside the engine. Declarative just means *you* didn't write them. (This is the single most common misunderstanding.)
- **Sneaking imperative habits into declarative code.** Writing CSS as if line order controls layout, or expecting a config file to run "top to bottom" like a script. Declarative parts are usually order-independent; treating them as a sequence leads to confusion.
- **Expecting full control over performance.** Because the engine chooses the steps, you give up some control over *how fast* it runs. A SQL query that's slow can't be fixed by "reordering your loop" — there is no loop. (Tuning the engine's choices is a senior-level skill.)
- **Confusing "declarative" with "a specific language."** SQL, HTML, YAML, and Make are all declarative, but declarativeness is a *style*, not a language badge. You can write declarative-leaning code (`sum(... for ...)`) in an imperative language like Python.
- **Forgetting it's still code that can be wrong.** Declarative code is often *shorter* and has fewer bookkeeping bugs — but a wrong `WHERE` clause or a wrong CSS selector is still a bug. Less code, not no bugs.

---

## Test Yourself

1. In your own words: what's the core difference between imperative and declarative code?
2. Why is SQL considered declarative? Name two "how" decisions the engine makes that you don't.
3. What does **idempotent** mean, and why is declarative configuration usually idempotent?
4. Is `total = sum(x for x in xs if x > 0)` more imperative or more declarative than the equivalent `for` loop? Why?
5. Name the engine that supplies the "how" for each: (a) a CSS rule, (b) a `Makefile`, (c) a React component.
6. Give one cost you pay for going declarative — something you give up compared to writing the steps yourself.

> Try each before reading on. If #2 or #3 is fuzzy, re-read [SQL: The Clearest Example](#core-concept-2--sql-the-clearest-example) and [The Two Hallmarks](#core-concept-5--the-two-hallmarks-order-independence--idempotence).

<details>
<summary>Answers</summary>

1. **Imperative** = you write the *steps* (the "how"), controlling iteration and state yourself. **Declarative** = you describe the *result* (the "what"), and an engine works out the steps.
2. SQL is declarative because you describe the *result set* you want, not the procedure to compute it. Two engine decisions: (a) whether to scan the whole table or use an index; (b) whether to filter before or after sorting (and which sort algorithm) — plus parallelism, join order, and more.
3. **Idempotent** = running it once equals running it many times; re-applying changes nothing. Declarative config is idempotent because you declare a *desired state* ("3 replicas"), not an action ("add a replica") — so re-applying just confirms reality already matches.
4. **More declarative.** It describes *what the result is* (the sum of the positive elements) with no visible loop or mutable accumulator; Python handles the iteration. The `for` loop spells out every step.
5. (a) the browser's **layout/rendering engine**; (b) **Make's** dependency-graph scheduler; (c) React's **reconciler** (which edits the DOM).
6. You give up *control over the steps* — and thus over performance and observability. You can't "step through" the engine's choices the way you can step through your own loop, and a slow engine plan can be hard to fix.

</details>

---

## Cheat Sheet

```
DECLARATIVE = describe the RESULT (what); an engine supplies the STEPS (how).
IMPERATIVE  = write the STEPS yourself (how); you own iteration and state.

THE PAIRING THAT DEFINES IT:
  YOUR "WHAT"              THE ENGINE'S "HOW"
  SQL SELECT          →   query planner
  HTML / CSS          →   browser layout engine
  Makefile            →   dependency-graph scheduler
  Terraform / K8s     →   desired-state reconciler
  React (JSX)         →   reconciler (DOM updates)
  spreadsheet formula →   recalculation engine

TWO HALLMARKS:
  order-independent   reordering the lines doesn't change the result
  idempotent          running it again changes nothing (desired state)

REMEMBER:
  declarative ≠ no steps  — the steps run inside the engine, written once
  you trade CONTROL (over the how, and performance) for BREVITY + correctness
  it's a STYLE, not a language badge (you can lean declarative in Python too)
```

---

## Summary

**Declarative programming** means you describe the *result you want* and let a system — a query planner, a browser layout engine, a build tool, a reconciler — work out the *steps*. SQL (`SELECT ... WHERE`), CSS (`justify-content: center`), build files (`Makefile`), and infrastructure config (Terraform, Kubernetes) are all declarative: in each, you state the **what** and an **engine** supplies the **how**. Two hallmarks give it away — declarative code is usually **order-independent** (the order of lines doesn't change the result) and **idempotent** (re-running it changes nothing, because you declared a desired state, not an action). The big payoff is that declarative code is often shorter, has fewer bookkeeping bugs, and stays correct as conditions change — because you never hard-coded the steps that would need to change. The big catch: it is *not* magic. The steps still run; they're just written once, inside the engine, so you give up some control over *how* (and over performance) in exchange for describing only the *what*.

---

## Further Reading

- Tim Berners-Lee, *The Rule of Least Power* (W3C, 2006) — why describing *what* (declarative) over *how* (imperative) makes data reusable; you'll meet this principle in depth at the senior level.
- *SQL in 10 Minutes* — Ben Forta — the fastest path to fluency in the canonical declarative language.
- MDN Web Docs, *CSS Flexbox & Grid guides* — declarative layout, hands-on, with the engine doing the pixel math.
- Peter Van Roy, *Programming Paradigms for Dummies* — situates declarative programming among the wider paradigm map.

---

## Related Topics

- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/junior.md) — the imperative ↔ declarative spectrum this topic sits on.
- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the "how, step by step" end, and the substrate engines are built from.
- [04 — Logic Programming](../04-logic-programming/) — the most declarative paradigm of all: state facts and rules, let a solver search.
- [05 — Reactive Programming](../05-reactive-programming/) — declarative UIs that react to changing values over time.
- [13 — Constraint Programming](../13-constraint-programming/) — declare constraints, let a solver find solutions.
- [Functional Programming](../../code-craft/functional-programming/) — `map`/`filter`/`reduce`: the declarative style available inside almost any language.
