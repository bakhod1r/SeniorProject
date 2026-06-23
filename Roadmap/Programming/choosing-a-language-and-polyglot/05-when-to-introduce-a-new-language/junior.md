# When to Introduce a New Language — Junior

> **What?** The decision to add a *second* (or third, or fourth) programming language to a codebase that already has one. This is the mirror image of selection: [`01-language-selection-criteria`](../01-language-selection-criteria/) asks "which language for a greenfield problem?"; this topic asks "should we add a new language *at all*, given we already have one that works?"
> **How?** Start with a strong bias *against* adding. A new language has to clear a much higher bar than "it's better" — it has to be better *enough to justify a second of everything*. Default to what you already use unless there's a concrete, specific reason the current stack genuinely can't do the job.

---

## 1. The default answer is "no"

When you pick a language for a brand-new project with no existing code, the field is open — you weigh the criteria and choose the best fit. But that is almost never the situation you're actually in. The situation you're actually in is: **there's already a codebase, it's already in some language, and someone wants to write the next piece in a different one.**

In that situation the starting position is not neutral. It is "no, use what we have," and the burden of proof is on the person who wants the new language. This feels unfair to the excited engineer — they've found a genuinely better tool and you're telling them to use the worse one. But the asymmetry is real, and learning to feel it is most of this topic.

> The selection roadmap teaches you to choose well from scratch. This one teaches you the discipline of *not* choosing again every time you're tempted — because every new language is a permanent tax, and the codebase you already have is a sunk investment you'd be diluting.

---

## 2. A new language is not free, even when it's great

Here is the trap, stated plainly: **a language being better is not the same as it being worth adding.**

Rust is genuinely safer than C++. Go genuinely has simpler concurrency than Java. Kotlin is genuinely more pleasant than Java. None of those facts, on their own, justify adding the language to a codebase that already ships fine without it. Because the moment you add a second language, you don't just get the language — you get everything that *comes with* the language, and you get it forever:

- A second **build toolchain** to install, configure, and keep updated.
- A second **CI pipeline** that has to compile, test, and lint the new code.
- A second set of **libraries and dependencies** to track for security patches.
- A second body of **debugging knowledge** the on-call person needs at 3 a.m.
- A second **hiring filter** — now candidates need *both* languages, or you maintain two separate skill pools.
- A second set of **idioms, style guides, and review expertise** before reviews can even be meaningful.

The language itself — the syntax, the standard library — is the *cheapest* part of all this. Everything around it is the expensive part, and it's all recurring. You pay it every sprint, not just once.

---

## 3. "Better" vs "better enough to justify a second toolchain"

Make this distinction a habit. Whenever someone proposes a new language, there are two completely different claims hiding inside their pitch, and they almost always only argue the first one:

| The claim they make | The claim that actually matters |
|---|---|
| "Rust is faster than our Python." | "This specific service is so performance-bound that no amount of Python tuning gets us there." |
| "Go has nicer concurrency than Java." | "Our concurrency problem is so painful in Java that a whole second toolchain is cheaper than fixing it in Java." |
| "Kotlin is more modern than Java." | "Modernity here is worth two hiring pools and a second build for the next five years." |

The left column is about the language in the abstract. The right column is about *this codebase, this team, this problem, and the recurring cost of a second of everything.* A good answer to "should we add this language?" lives entirely in the right column. If the pitch only ever touches the left column, it hasn't earned anything yet.

---

## 4. The shiny-thing trap and résumé-driven development

Two specific human forces push engineers toward adding languages they don't need. Name them so you can catch yourself.

**The shiny new thing.** A new language gets a wave of conference talks and HN threads, and it feels behind-the-times to keep writing the old one. The excitement is real — and almost entirely irrelevant to whether the language fits *your* problem. The industry has a graveyard of services rewritten in the hot language of 2014, 2017, 2021 that are now the legacy nobody wants to touch.

**Résumé-driven development.** The quiet one. An engineer wants the new language *on their CV* — more hireable, more current. That's a rational personal incentive in direct conflict with the company's interest. Your production system is not a training ground for skills you'll take to your next job. Learn the language on a side project; don't make the team carry it for a decade so one person's résumé looks better.

> Neither of these is malicious. The shiny-thing pull and the résumé pull are normal, and even good engineers feel them. The skill is noticing *which* argument you're actually making — "this helps the system" or "this is exciting / good for me" — and being honest about it.

---

## 5. A worked example — the "we should use Rust" Slack message

A teammate posts: *"Our image-thumbnailing service in Python is kind of slow. We should rewrite it in Rust — Rust is way faster and memory-safe."*

Walk it with the bias-against lens:

- **Is the claim abstract, or about this problem?** "Rust is faster" is abstract. The real question: *how* slow is the service, what's the actual SLO, and is Python the bottleneck or is it the image library / disk / network?
- **Is this a new-language problem or a new-library problem?** Maybe the code uses pure-Python resizing instead of Pillow-SIMD or a native binding. Swapping the *library* might close the whole gap with zero new toolchain.
- **What does the new language cost here?** A Rust service means Rust in CI, a Cargo build, Rust on-call knowledge, and every backend dev now reading both Python and Rust. The team is four people.
- **Is the benefit worth that?** If the service handles 50 requests a minute and meets its SLO, plainly no. If it's the core product path melting under load and Python genuinely can't keep up after real optimization, *now* the conversation is legitimate.

The point isn't that Rust is wrong. It's that the Slack message argued the cheap, abstract claim and skipped every expensive, specific one. **You don't say no to Rust — you ask the questions that the pitch skipped.**

---

## 6. The simplest rule you can carry today

You don't need the full senior framework yet. Carry this:

> **Default to the language you already use. Only reach for a new one when the current stack genuinely *can't* do the job well — not when a different language would merely be nicer.**

"Can't do the job well" is a high bar on purpose. It means things like:

- The work *must* run in the browser → it has to be JavaScript/TypeScript/WASM. Your backend language literally cannot run there.
- The work needs the **machine-learning ecosystem** → that lives in Python; reimplementing PyTorch in your backend language is not happening.
- The work needs **native, predictable performance with no GC pauses** and you've measured that your current language can't deliver it.

Those are *can't*-shaped reasons. "Would be nicer," "is more modern," "I'd enjoy it more," "it's what everyone's using now" are *want*-shaped reasons. Want-shaped reasons don't add languages.

---

## 7. Common newcomer mistakes

**Mistake 1: confusing "the best tool for the job" with "a new tool for the job."** "Right tool for the right job" is true *and* dangerous — it gets quoted to justify five languages in a four-person team. The hidden cost of *having* the tool often dwarfs the benefit of it being slightly more right. (More on this in [`04-interop-and-polyglot-architectures`](../04-interop-and-polyglot-architectures/).)

**Mistake 2: counting only the writing, not the owning.** "It'll be faster to write in X" ignores that you'll *own* it in X for years — debug it, hire for it, patch it. The writing is a few weeks; the owning is forever. (See [`07-total-cost-of-ownership-and-team-skills`](../07-total-cost-of-ownership-and-team-skills/).)

**Mistake 3: treating one service as isolated.** "It's just one little service in Go" — but now your team is a two-language team, with two CIs and two on-call skill sets, forever, because of one service. There's no such thing as adding *just a little* language.

**Mistake 4: not asking whether it's a library problem.** Most "we need a new language" moments are actually "we need a different library" moments. Always check the cheaper fix first.

**Mistake 5: thinking the decision is yours alone.** Adding a language commits your *teammates* and your *future hires* to learning it. It's a team and org decision, not a personal preference, even when you're the one who'll write the first line.

---

## 8. Quick rules

- [ ] Start every "new language?" question from **"no, use what we have"** — make the proposer earn the yes.
- [ ] Separate **"this language is better"** from **"better enough to justify a second of everything."** Only the second one counts.
- [ ] Catch the **shiny-thing** and **résumé-driven** pulls — in others *and* in yourself.
- [ ] Always ask: **is this a new-language problem or a new-library problem?** Check the cheaper fix first.
- [ ] Reach for a new language only when the current stack **genuinely can't** do the job — browser, ML ecosystem, measured native-perf needs — not when it would merely be nicer.
- [ ] Remember a new language is a **recurring, permanent** cost paid by the whole team, not a one-time choice you make alone.

---

## 9. What's next

| Topic | File |
|---|---|
| The N+1 language tax made concrete, and the legitimate triggers that justify a new language | `middle.md` |
| The full cost/benefit framework, slippery slopes, and exit criteria | `senior.md` |
| Governance: supported-language lists, RFCs, and saying no | `professional.md` |
| Practice scenarios — new-language vs new-library, RFC templates | `tasks.md` |
| Interview questions on language restraint | `interview.md` |

---

**Memorize this:** a language being better is not the same as it being worth adding. The default answer is "use what we have," and a new language must clear a much higher bar — it has to be better *enough to justify a second toolchain, CI, hiring pool, and on-call burden, forever.* Before you add a language, ask whether you actually just need a different library.
