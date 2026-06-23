# Total Cost of Ownership & Team Skills — Junior

> **What?** The *total* cost of choosing a language — not "how much fun is it to write," but everything you'll pay across the whole life of the code: writing it, reviewing it, debugging it, maintaining it for years, hiring people who know it, onboarding them, and running it in production. The syntax is the cheapest part of that bill.
> **How?** Before you fall in love with a language because it's pleasant to type, ask the boring question that actually decides the cost: *who is going to own this code for the next five years, and what will that cost in people and time?* The CPU is rarely the expensive component. The humans are.

---

## 1. The iceberg — writing code is the tip

When you choose a language, the part you can see is the part you'll spend the *least* time on. Writing the first version of a feature feels like the whole job because it's the part you're doing right now. It isn't.

```
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
              writing the first version    <- the tip you can see
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
              code review
              debugging the weird production bug
              maintaining it as requirements change
              onboarding the next three engineers
              hiring people who know the language at all
              operating it in production for years
              the on-call person reading it at 3am
                                              <- the cost that sinks ships
```

Studies of software cost have said the same thing for decades: **most of the money a piece of software costs is spent *after* it's first written** — often cited as 60–80% of total lifetime cost going to maintenance, not initial development. A language can make the visible tip cheap and the hidden bulk expensive. That trade is exactly the one beginners miss.

---

## 2. "Fun to write" is not "cheap to own"

These are two completely different properties, and conflating them is the classic junior mistake.

| Property | What it measures | When you feel it |
|---|---|---|
| **Fun / fast to write** | How quickly *you*, today, produce a working first draft | The first week |
| **Cheap to own** | What it costs the *team* to keep this alive for years | Every week after |

A language can be a joy to write and a nightmare to own. A clever dynamic language with no types lets you ship a prototype in an afternoon — and then, two years later, nobody can safely change a function because they can't tell what it returns without running it. The afternoon you saved is repaid, with interest, by every confused engineer who touches it afterward.

The reverse happens too: a verbose, "boring" language that's a chore to write can be cheap to own because the next person can read it, the tooling catches mistakes, and the failure modes are well-understood. **Cost is paid by the team over years, not by you in the first afternoon.**

---

## 3. The team is the most expensive component

Here is the single number that reorders everything: a working engineer in a high-cost market costs the company on the order of **$150,000–$300,000 per year** all-in (salary, benefits, equipment, overhead). A small server to run their code costs *hundreds of dollars per year*.

```
One backend engineer (loaded cost):   ~$200,000 / year
One mid-size cloud server:                 ~$1,000 / year
```

That's a 200× difference. So when someone argues "language X is 30% more CPU-efficient, let's switch," your first instinct should be: *30% of the cheap thing, or any percent of the expensive thing?* Saving a sliver of server cost while making the code slower for humans to work with is almost always a bad trade — because **the people are two orders of magnitude more expensive than the machines.**

This flips the usual debate. Junior engineers argue about runtime speed; the bigger money is in *human* speed — how fast the team can read, change, review, and debug the code.

---

## 4. Can you even hire for it?

A language is worthless to a company if it can't staff the code written in it. This is the most concrete part of ownership cost and the one beginners never think about.

Ask, plainly:
- If the one person who wrote this leaves, **can we replace them?**
- How long would it take to *find* someone — a week of applicants, or six months of silence?
- Will we have to pay a premium because almost nobody knows this language?

A "better" language that you cannot hire for is not better — it's a **liability with nice syntax.** A mainstream language (Python, JavaScript, Java, Go, C#) has millions of practitioners; you can fill a seat in weeks. A niche language might have a few thousand serious practitioners on Earth, and your job posting competes with everyone else who wants them. The language being technically elegant does not help you when the role sits empty for half a year.

> This doesn't mean "always pick the most popular language." It means **hireability is a real cost on the scale**, and a niche language has to be *worth* the hiring difficulty it buys you.

---

## 5. Onboarding — the cost you pay on every new hire

Even after you hire someone, they aren't productive on day one. The time from "starts" to "ships confidently" is **ramp time**, and the language drives a chunk of it.

- A new hire who already knows your language ramps on the *codebase* only — weeks.
- A new hire who has to learn the *language too* ramps on both — months.
- A new hire learning a language with sparse documentation and few Stack Overflow answers ramps slowly *and* frustratingly, and some quit.

Every new engineer pays this tax. If you have a niche or unusual language, you pay it *every single time you grow the team* — which, if the company is succeeding, is constantly. A common language means new hires often arrive already knowing it; the ramp is shorter and cheaper, repeated across everyone you'll ever hire.

---

## 6. A worked example — the "exciting" rewrite

A small team has a working Python web service. One engineer is excited about a newer, faster, more elegant language and proposes rewriting in it. The pitch: "it's faster and so much nicer to write."

Walk the ownership cost a junior should now see:

- **Writing:** Yes, maybe nicer. This is the tip of the iceberg — the smallest cost.
- **Hiring:** The team can hire Python engineers in weeks. The new language? They found *two* candidates in the city, both expensive.
- **Onboarding:** Every future hire now has to learn the new language. The existing four engineers all have to learn it *now*, slowing everything for months.
- **Bus factor:** Right now, one person is excited and fluent. If they leave, the rest are stranded with code in a language they barely know.
- **Operating cost saved:** The faster runtime saves maybe a few hundred dollars a month in servers.

**Verdict:** the rewrite trades a few hundred dollars of monthly server savings for months of lost team velocity, a brutal hiring problem, and a single-person dependency. The "fun to write" and "faster" arguments are real — and far too small to win against the ownership costs they ignore. (The discipline of *resisting* this is its own topic: [`05-when-to-introduce-a-new-language`](../05-when-to-introduce-a-new-language/).)

---

## 7. Common newcomer mistakes

**Mistake 1: judging a language by the writing experience alone.** The first afternoon is the cheapest afternoon you'll ever spend on that code. Judge by the years after.

**Mistake 2: optimizing CPU cost while ignoring people cost.** Servers are cheap; engineers are not. Saving machine time at the expense of human time is usually backwards.

**Mistake 3: forgetting hireability exists.** "It's the best language for the job" means nothing if you can't staff it. (See the deal-breaker thinking in [`01-language-selection-criteria`](../01-language-selection-criteria/).)

**Mistake 4: ignoring the bus factor.** One excited expert is not a team. If only one person can maintain it, you have a person-shaped single point of failure.

**Mistake 5: treating onboarding as a one-time cost.** You pay it on *every* hire, forever. A hard-to-learn language is a tax that compounds as you grow.

---

## 8. Quick rules

- [ ] Remember the **iceberg**: writing is the tip; maintenance, hiring, and operating are the bulk.
- [ ] Separate **"fun to write"** from **"cheap to own"** — they are not the same property.
- [ ] Treat **people as the expensive component**, not the CPU (roughly 200× the cost).
- [ ] Always ask: **can we hire for this, and how long would it take?**
- [ ] Count **onboarding** as a cost paid on *every* future hire, not once.
- [ ] Check the **bus factor** — one fluent person is a risk, not a team.

---

## 9. What's next

| Topic | File |
|---|---|
| Breaking TCO into concrete, estimable numbers | `middle.md` |
| The hard tradeoffs — talent markets, runtime cost flipping decisions | `senior.md` |
| Org-level economics, Conway's law, and the leadership business case | `professional.md` |
| Interview questions on cost of ownership | `interview.md` |
| Exercises: build a multi-year TCO model | `tasks.md` |

---

**Memorize this:** a language's real cost is the whole lifecycle — writing, reviewing, debugging, maintaining, hiring, onboarding, operating — and the team, not the CPU, is the most expensive component. "Fun to write" is real but tiny; "cheap to own" and "can we hire for it" are where the money actually is.
