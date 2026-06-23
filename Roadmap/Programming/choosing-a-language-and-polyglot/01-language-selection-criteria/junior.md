# Language Selection Criteria — Junior

> **What?** The set of factors you weigh when deciding what language to build something in. Not "which language is best" — there's no such thing — but "which language *fits this situation*," where the situation includes the problem, the people, the deadline, and the risk.
> **How?** Resist picking by taste or hype. Write down what actually matters for *this* project, weigh those factors honestly, and let the choice fall out. The language is the answer to a question — make sure you asked the question first.

---

## 1. The mistake everyone makes first

You learn a language, you like it, and now every problem looks like a job for that language. This is the single most common selection error, and it has a name borrowed from psychology — the **law of the instrument**: *"if all you have is a hammer, everything looks like a nail."*

```
"I know Python, so the new high-frequency trading engine should be Python."
"I love Rust, so the marketing team's landing-page CMS should be Rust."
"We use Node everywhere, so the ML training pipeline should be Node."
```

Each of these *might* be defensible — but notice that none of them started from the problem. They started from the language and worked backward. Selection done right runs the other direction: **problem first, language last.**

---

## 2. The factors that actually matter

When you strip away the religious wars, real selection comes down to a handful of questions. Here they are, roughly in the order they bite a junior engineer:

| Factor | The question it answers |
|---|---|
| **Problem fit** | Is this language *good at* the kind of thing I'm building? |
| **Team knowledge** | Do the people who will write and maintain this already know it? |
| **Ecosystem** | Do the libraries I need already exist and work? |
| **Performance needs** | Is the language fast enough for what this has to do? |
| **Time to ship** | How fast can we get a working version out the door? |
| **Hiring & maintenance** | Can we find people to keep this alive in two years? |
| **Risk** | If we're wrong, how badly are we stuck? |

You will not weigh these equally. A weekend prototype cares only about *time to ship*. A medical device cares about *correctness* and *risk* far above *time to ship*. The skill is knowing **which factors dominate for this specific project** — and that's a judgment, not a formula.

---

## 3. "Good at" is real — domains have natural fits

Languages aren't interchangeable. Decades of ecosystem growth mean some languages are genuinely, deeply *good* at certain domains, and fighting that costs you dearly.

| If you're building… | The languages with the strongest natural fit | Why |
|---|---|---|
| A data / ML pipeline | Python | The entire scientific stack (NumPy, PyTorch, pandas) lives here |
| A browser frontend | JavaScript / TypeScript | It's the only language the browser runs natively |
| A systems / OS / game engine component | Rust, C, C++, Zig | Manual memory control, no GC pauses, predictable performance |
| A high-concurrency network service | Go, Elixir, Java | Built-in concurrency models and mature server ecosystems |
| Enterprise business apps | Java, C# | Huge libraries, tooling, and hiring pools for exactly this |
| A quick script / glue code | Python, Bash, Ruby | Minimal ceremony, fast to write, throwaway-friendly |

This table is not a law — you *can* build a web backend in Rust or do data science in Java. But you'd be swimming upstream: fewer libraries, smaller community, more code you write yourself that the "natural fit" language gives you free. **Going against the grain has to earn its keep with a real reason.**

---

## 4. The factor juniors underweight: the team

Here is the lesson that takes most people years to learn: **the best language for a project is very often the one your team already knows well.**

Imagine the "perfect" language for your problem exists — slightly faster, slightly more elegant — but nobody on your team has used it. Choosing it means:

- Everything takes longer while people learn.
- Code reviews are shallow because nobody is an expert yet.
- Bugs slip through because the team doesn't know the language's traps.
- The first production incident is debugged by people reading docs in real time.

A language your team has *mastered* gives you fast reviews, deep instincts, and known failure modes. That is often worth more than any benchmark. A 10%-better language in the hands of beginners loses to a 10%-worse language in the hands of experts almost every time.

> This doesn't mean *never learn anything new*. It means the team's existing skill is a **real, heavy factor on the scale** — not a detail to wave away because you're excited.

---

## 5. A worked example — choosing a language for a new service

Your team needs to build an **image-resizing service**: it receives uploaded photos, generates thumbnails, and stores them. Let's walk the factors.

- **Problem fit:** Image processing is CPU-bound and benefits from mature imaging libraries. Go, Rust, and even Python (with native bindings) all qualify.
- **Team knowledge:** The team writes Go for every other service. Big point for Go.
- **Ecosystem:** Go has solid image libraries; Rust's are good too; Python's Pillow is excellent but slower for heavy loads.
- **Performance:** Resizing is moderately heavy but not extreme. Go is plenty fast. Rust would be faster but the margin may not matter.
- **Time to ship:** The team is fastest in Go. Rust would mean a learning curve.
- **Risk:** Choosing Go keeps this service consistent with the rest of the system — same deployment, same monitoring, same on-call knowledge.

**Decision: Go.** Not because Go is "the best language," but because for *this* problem, *this* team, *these* constraints, it wins on the factors that matter most: team fit, consistency, and good-enough performance. A different team — say, one that already writes everything in Rust — would correctly reach a different answer to the *same* problem. **That's the point: the answer is a function of the situation, not the language.**

---

## 6. The two-list trick

When you're overwhelmed, write two short lists:

**Must-haves (deal-breakers).** Things that, if a language lacks them, immediately disqualify it.
- "Must run in the browser." → only JS/TS/WASM survive.
- "Must integrate with our existing C++ codebase with no IPC overhead." → narrows hard.
- "Must have a mature, supported AWS SDK." → eliminates obscure languages.

**Nice-to-haves (tiebreakers).** Things you'd *prefer* but could live without.
- "Clean syntax," "fast compile times," "good editor support."

Run every candidate through the must-haves first — most options vanish instantly. Then use nice-to-haves to break ties among survivors. This stops you from agonizing over syntax preferences while ignoring a hard requirement that already settles the question.

---

## 7. Common newcomer mistakes

**Mistake 1: choosing by popularity.** "It's the most-used language on the survey" tells you about the *average* project, not yours. Popularity is a weak signal for hiring and libraries — and irrelevant to whether it fits *your* problem.

**Mistake 2: choosing by benchmark.** A language being 3× faster in a microbenchmark is meaningless if your service spends 95% of its time waiting on the database. Speed only matters where speed is the bottleneck (more in [`02-performance-vs-productivity-tradeoffs`](../02-performance-vs-productivity-tradeoffs/)).

**Mistake 3: choosing by résumé.** "I want to learn Rust, so I'll use it at work." Learning is good — but your employer's production system is not your personal training ground. Learn on side projects; choose for the company on company criteria.

**Mistake 4: ignoring what's already there.** Adding a *new* language to a codebase isn't free even if it's the perfect fit — it's a second toolchain, a second hiring pool, a second set of on-call knowledge. (This gets its own topic: [`05-when-to-introduce-a-new-language`](../05-when-to-introduce-a-new-language/).)

**Mistake 5: treating it as permanent.** Beginners think the choice is forever and panic. Seniors know choices can be migrated — at a cost — so they weigh *reversibility* as one factor among many rather than freezing up.

---

## 8. Quick rules

- [ ] Start from the **problem**, never from the language you happen to like.
- [ ] List your **must-haves** first — they eliminate most options instantly.
- [ ] Weigh **what your team already knows** heavily; it's worth more than a benchmark.
- [ ] Match the language to the **domain's natural fit** unless you have a concrete reason not to.
- [ ] Don't pick by **popularity, benchmarks, or résumé-building**.
- [ ] Remember the choice is **reversible at a cost** — so factor in how easy it would be to escape.

---

## 9. What's next

| Topic | File |
|---|---|
| A real weighted-scoring framework you can fill in | `middle.md` |
| Where the simple criteria break down and conflict | `senior.md` |
| Driving a selection decision across a whole org | `professional.md` |
| Practice scenarios and scoring exercises | `tasks.md` |
| Interview questions on selection | `interview.md` |

---

**Memorize this:** there is no best language, only the best fit for *this* problem, *this* team, *this* deadline, *this* risk. Ask the question before you reach for the answer — and the loudest factors in the debate (syntax, benchmarks) are usually the cheapest ones.
