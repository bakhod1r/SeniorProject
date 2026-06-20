# Metrics Anti-Patterns & Goodhart — Junior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Metrics Anti-Patterns & Goodhart
> *A metric is a number that's supposed to tell you the truth about your work. The moment someone starts grading you on it, it quietly stops telling the truth — and starts telling you what the grader wants to hear.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Goodhart's Law: The Target Corrupts the Measure](#core-concept-1--goodharts-law-the-target-corrupts-the-measure)
5. [Core Concept 2 — The Classic Bad Metrics: LOC, Commits, Velocity](#core-concept-2--the-classic-bad-metrics-loc-commits-velocity)
6. [Core Concept 3 — The Cardinal Sin: Measuring Individuals](#core-concept-3--the-cardinal-sin-measuring-individuals)
7. [Core Concept 4 — Metrics Are for Improvement, Not Judgment](#core-concept-4--metrics-are-for-improvement-not-judgment)
8. [Core Concept 5 — Spotting Gaming Before It Spots You](#core-concept-5--spotting-gaming-before-it-spots-you)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How metrics go wrong — so you don't get fooled by them or hurt by them.**

Sooner or later, someone with a dashboard is going to measure your work. A manager wants to know "how productive is the team?" An executive wants a number for the board. A well-meaning lead installs a tool that counts your commits. The instinct is reasonable — software is expensive and invisible, and people want to see it. The problem is that almost every *obvious* way to measure programmers is not just useless but **actively harmful**, and the harm is predictable enough that you can see it coming.

This is the page nobody teaches juniors, and it's the one that protects you. Not because you'll be designing the company's metrics next week — you won't — but because you'll be *measured by* them, and you need to recognize a broken metric on sight. When your manager says "we're tracking lines of code now," you should feel the same alarm a pilot feels when a warning light comes on. Something is about to go wrong, and you want to understand *why* before it does.

The deepest idea here has a name: **Goodhart's law**. In plain terms — *when a measure becomes a target, it stops being a good measure.* It sounds like a clever aphorism. It's actually an iron law of human behavior, and once you see it, you cannot unsee it. Every bad engineering metric in this page is just Goodhart's law wearing a different costume.

> **The mindset shift:** the moment a metric becomes a *target* — something you're rewarded, ranked, or punished by — people stop optimizing the *goal the metric was supposed to represent* and start optimizing *the metric itself*. The two come apart instantly, and the metric becomes a lie that everyone is incentivized to keep telling.

---

## Prerequisites

- **Required:** You've worked on a team that uses *some* process — pull requests, tickets, story points, a board with columns. You don't need to love it; you just need to have seen it.
- **Required:** You can name a few things a programmer does in a day (write code, review a PR, fix a bug, sit in a meeting). That's enough.
- **Helpful:** You've felt the pull of a metric yourself — padded an estimate, split a task to look busier, or written a longer solution than needed. (Normal. We'll use it.)
- **Helpful:** You've skimmed [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md) and seen what a *good*, team-level metric looks like. Not required, but it's a useful contrast.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Goodhart's law** | "When a measure becomes a target, it stops being a good measure." Grade people on a number and they'll optimize the number, not the thing it stood for. |
| **Proxy metric** | A number you measure because it's *easy to count*, hoping it stands in for the *real thing* you care about (which is hard to count). "Lines of code" is a proxy for "value delivered." |
| **Vanity metric** | A number that looks impressive and goes up and to the right, but doesn't connect to any decision or real outcome. Makes you feel good; tells you nothing. |
| **Gaming** | Hitting the number *without* doing the underlying good work — or even by doing *worse* work that happens to score higher. |
| **Individual metric** | A number attached to *one person* rather than the team or the system. The most dangerous category there is. |
| **Scoreboard** | Using metrics to *judge, rank, or reward* people. The wrong use. |
| **Conversation starter** | Using metrics for the *team* to ask "why is this number what it is, and do we want to change it?" The right use. |

---

## Core Concept 1 — Goodhart's Law: The Target Corrupts the Measure

Start with the law itself, because everything else is a special case of it.

**Goodhart's law:** *When a measure becomes a target, it stops being a good measure.*

Here's the mechanism, step by step, because the mechanism is the whole lesson:

1. You care about some **goal** that's hard to see directly — say, "the team delivers valuable, working software."
2. That goal is hard to count, so you pick a **proxy** that *is* easy to count and seems related — say, "lines of code written."
3. As long as nobody's *graded* on it, the proxy roughly tracks the goal. More working software does, loosely, involve more code.
4. Then someone makes it a **target**: "write more lines of code." Now everyone has a reason to make *that number* go up — and the *cheapest* way to make a number go up is almost never the same as achieving the goal.
5. People optimize the number. The number rises. The goal does not. The link between them snaps.

A non-software example makes it vivid. A nail factory is told to maximize *number of nails*. They produce millions of tiny, useless tacks. Switched to maximize *weight of nails*? They produce a few giant, useless spikes. Each time, the workers did *exactly* what they were measured on, and *exactly* not what the factory needed. They weren't lazy or dishonest. They were *responding rationally to the target*. That's Goodhart's law — and notice it doesn't require bad people. Good people produce the same result.

> **Key insight:** Goodhart's law is not about dishonesty. It's about *incentives*. When you turn a measure into a target, you are *teaching* everyone — honest and dishonest alike — that the number matters more than the goal. They will believe you, because you're the one signing their reviews. The corruption is the system working as designed, not people cheating.

This is why senior engineers flinch at "let's measure productivity and reward the top performers." They're not being difficult. They've watched the proxy snap away from the goal, every time, in every org, for the same reason.

---

## Core Concept 2 — The Classic Bad Metrics: LOC, Commits, Velocity

There are three metrics that get reinvented in every company, and all three are broken in the same Goodhart way. Learn to recognize them on sight.

### Lines of code (LOC)

The idea: more code = more work done = more productive. Every part of this is wrong.

The deep problem is that **code is a cost, not an asset.** Every line must be read, tested, debugged, and maintained *forever*. The best engineers routinely *delete* code — replacing fifty lines with five, or removing a feature nobody uses. Under a "lines of code" target, **deleting code makes you look lazy**, and the most valuable thing a senior can do — simplification — registers as *negative productivity*. The metric rewards exactly the opposite of skill.

And it's trivially gamed. Watch:

```python
# The honest, good solution — 1 line:
total = sum(prices)

# The "productive" solution under a LOC target — 6 lines:
total = 0
for i in range(len(prices)):
    price = prices[i]
    total = total + price
# ... and look how busy I've been!
return total
```

Same result. Six times the "productivity." Worse code. A junior under a LOC target *learns to write the second version* — and that's the tragedy: the metric trains people to be worse engineers.

### Commit count / PR count

The idea: more commits or more pull requests = more activity = more output. Same trap, different number.

The gaming is even easier and more natural — you barely have to *try* to cheat:

- Split one logical change into five tiny PRs to show "five PRs this week."
- Commit `fix typo`, `fix typo again`, `actually fix typo` instead of one clean commit.
- Make trivial whitespace or comment commits to keep the streak alive.

Meanwhile the engineer who lands *one* carefully designed PR that quietly prevents three future outages scores a "1" and looks unproductive next to the person spraying twenty trivial commits. The metric **rewards busyness and punishes thoughtfulness** — the precise opposite of what you want.

### Story points / velocity

This one is subtler because story points have a *legitimate* use, so people assume the metric is sound. It isn't, the moment you turn it into a target.

Story points are a **made-up, relative unit** a team invents to *plan its own upcoming work* — "this task feels about twice as big as that one." That's their only honest job. Two facts kill them as a productivity or comparison metric:

1. **They're arbitrary and team-local.** Team A's "5-point story" and Team B's "5-point story" have *no common unit*. Comparing velocity across teams is like comparing two people's "7 out of 10" pain — the scales were never calibrated to each other. It is **meaningless**, full stop.
2. **They're trivially inflated.** Ask a team to "increase velocity" and they will — not by working faster, but by *estimating the same work as more points*. Last quarter's 5-point story is this quarter's 8-pointer. Velocity climbs 60%. Zero extra software ships. This is Goodhart's law in its purest form: the unit of measurement itself is something the measured party controls.

> **Key insight:** LOC, commits, and velocity all fail for the *same* reason. Each is a **proxy** that's *easy to count* and *easy to inflate*, and none of them measures the thing you actually care about (working software that's valuable to users). The instant any of them becomes a target, people inflate the proxy and the real goal goes untouched. If a metric can be gamed without doing better work, it *will* be — not because your colleagues are dishonest, but because you've told them the number is what counts.

---

## Core Concept 3 — The Cardinal Sin: Measuring Individuals

Everything above gets *worse* — much worse — when you attach the number to a *person* and then **rank** people by it. This is the single most destructive thing you can do with engineering metrics, and it deserves its own concept.

Here's why it's a category of its own, not just "a bad metric."

**Software is a team sport.** A feature ships because someone designed it, someone reviewed the PR, someone wrote the tests, someone fixed the flaky CI that was blocking everyone, someone answered the "how does this module work?" question in five minutes instead of letting a teammate burn an afternoon. *None* of that shows up as that person's individual output — and some of the most valuable work (mentoring, reviewing, unblocking) makes *someone else's* number go up while leaving your own flat.

Now make it a leaderboard. Rank engineers by commits, or LOC, or story points closed. Watch what you've just incentivized:

- **Stop helping each other.** Every minute spent reviewing your PR or mentoring a junior is a minute that doesn't raise *my* rank. The rational move is to *stop helping*. You have just used a dashboard to dismantle teamwork.
- **Hoard the easy work.** Grab the quick, point-heavy tickets; avoid the gnarly, important, low-scoring ones. The hard problems — the ones that actually matter — become *nobody's* job because they're bad for everyone's number.
- **Game in earnest.** When your rank affects your raise, the gentle padding from Concept 2 turns into a survival strategy. People aren't optimizing the metric for fun anymore; they're protecting their livelihood.
- **Punish honesty.** The engineer who says "this estimate is too optimistic" or "we should delete this instead of building more" is now scoring *against* themselves. You've made candor expensive.

> **Key insight:** Individual productivity metrics don't just fail to measure productivity — they *actively destroy the collaboration that produces it*. The very act of ranking people by output teaches them to compete instead of cooperate, in a discipline where almost all real value comes from cooperation. There is broad agreement among people who've studied this — see Martin Fowler's *CannotMeasureProductivity* — that **individual developer productivity cannot be meaningfully measured at all**, and that trying does measurable harm. When someone proposes an engineer leaderboard, the correct response isn't "let's pick a better metric." It's "we should not be measuring individuals."

A blunt rule for your career: **a metric for a person is a weapon; a metric for a system is a tool.** Be very suspicious of the first.

---

## Core Concept 4 — Metrics Are for Improvement, Not Judgment

If individual scoreboards are the wrong use, what's the *right* one? The answer reframes what a metric is *for*, and it's the most important idea on this page.

**A good metric is a question the team asks itself, not a verdict handed down from above.**

Compare the two postures:

| | **Scoreboard** (wrong) | **Conversation starter** (right) |
|---|---|---|
| Who owns the number? | A manager, to grade people | The **team**, to understand itself |
| What's it attached to? | **Individuals** | The **system / process** |
| What does a bad number mean? | "You're underperforming" | "Our *system* has a problem worth investigating" |
| The reaction it produces | Fear, gaming, defensiveness | Curiosity, investigation, change |
| The question it answers | "Who do I reward or blame?" | "What in our process should we fix?" |

Make it concrete. Suppose the team's **lead time** — how long a change takes from "started" to "in production" — is creeping up. (That's a real, system-level DORA metric; see [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md).)

- **Scoreboard use:** "Lead time is up. Who's slow? Let's find the bottleneck *person*." → People hide problems, rush reviews, and stop flagging risk. The number might dip; the system rots.
- **Conversation-starter use:** "Lead time is up. *Why?* Are PRs waiting too long for review? Is CI flaky? Are we starting too many things at once?" → The team finds the *system* problem (say, code review is a bottleneck) and fixes *the system* (add reviewers, smaller PRs). The number improves *because the underlying reality improved.*

Notice the crucial difference: in the right version, **nobody is gaming the metric, because nobody is being graded on it.** The team *wants* the number to be honest, because they're using it to find real problems in their own work. The metric stays a good measure precisely *because* it was never made a personal target. That's how you sidestep Goodhart's law — you refuse to take the step that triggers it.

> **Key insight:** The same metric is helpful or poisonous depending entirely on *how you use it*. Owned by the team, pointed at the system, used to start "why?" conversations — it's one of the best tools you have. Owned by a manager, pointed at individuals, used to judge and reward — the *identical number* becomes a generator of fear and gaming. The metric isn't good or bad. The *use* is.

---

## Core Concept 5 — Spotting Gaming Before It Spots You

You don't need to wait for harm to arrive. Broken metrics announce themselves, and gaming is *predictable*. Here's how to see both coming.

**Ask the gaming question.** For any proposed metric, ask: *"What's the laziest way to make this number look good without doing better work?"* If a quick, dumb answer exists, the metric is gameable, and someone *will* find that answer the moment it's a target.

- "More lines of code" → write padded, verbose code. Easy.
- "More commits" → split work, commit trivia. Easy.
- "Higher velocity" → estimate the same work as more points. Easy.
- "Fewer bugs reported" → *stop reporting bugs*, or reclassify them as "tasks." Easy and dangerous.

That last one shows gaming's most sinister form: **the metric improves while reality gets worse.** Tell a team "drive down the bug count" and one reliable outcome is that bugs stop getting *filed* — they still exist, they're just invisible now. You've made the dashboard greener and the product worse, simultaneously.

**Watch for these red flags that a metric has gone bad:**

- The number is improving but **nothing actually feels better** (faster, more stable, less painful). That gap is gaming.
- People talk about **"hitting the number"** instead of "delivering the thing." The language gives it away.
- The metric is attached to a **person**, especially in a **ranking**.
- The metric is a **single number** claiming to capture something rich. (Productivity, quality, and developer experience are *multidimensional* — one number always hides more than it shows. This is exactly why frameworks like [03 — The SPACE Framework](../03-space-framework/junior.md) use *several* signals at once instead of one score.)
- Someone is being **rewarded or punished** directly by the number, so honesty about it has become expensive.

> **Key insight:** Gaming isn't a moral failure to scold people out of. It's a *signal* that you built the metric wrong. If a number can be gamed, the fix is **never** "tell people to stop gaming" — they're behaving rationally. The fix is to change *how the metric is used*: stop tying it to rewards, stop pointing it at individuals, and start using it as a team's question about its own system. Remove the incentive to game and the gaming evaporates on its own.

---

## Real-World Examples

**1. The lines-of-code bonus that filled the codebase with junk.** A company decided to reward developers by lines of code shipped per month. Within two months the codebase had ballooned with copy-pasted blocks, needless wrapper functions, and verbose reimplementations of things the standard library already did. The best engineer on the team — who'd spent the quarter *deleting* a tangle of dead code and cutting the build time in half — scored *negative* and got a talking-to. The metric had perfectly inverted reality: it punished the most valuable work and rewarded the creation of future maintenance pain. They quietly killed the metric; the damage to the codebase took a year to undo.

**2. The velocity arms race between two teams.** Leadership put up a dashboard comparing the *velocity* of two teams, expecting it to motivate the "slower" one. Instead, both teams figured out within a sprint that velocity is just *their own estimates added up*. Each began inflating point values — the same work that was a "3" last quarter became a "5," then an "8." Both velocities shot up; both managers reported "improved productivity" to leadership; the actual amount of software shipped didn't change at all. The dashboard measured nothing but the teams' willingness to inflate numbers — a pure Goodhart outcome with no villains, just rational people responding to a target.

**3. The bug count that hid a quality crisis.** A team was told its goal for the quarter was to *reduce the open bug count*. The count dropped beautifully. But the bugs hadn't been fixed — engineers had simply stopped *filing* them (why file a bug that counts against you?) and started reclassifying defects as "improvement tasks" to move them off the bug board. Real quality got *worse*; customers hit more problems; the dashboard glowed green the whole time. The metric had achieved the dangerous trifecta: it improved on paper, degraded in reality, and *suppressed the very information* the team needed to see the degradation.

---

## Mental Models

- **Goodhart's law as gravity.** It's not an occasional risk you might trip over — it's an always-on force. The instant a measure becomes a target, the pull to optimize the number instead of the goal switches on, and it acts on *everyone*. Don't ask "will this metric get gamed?" Assume it will, and design so the gaming doesn't matter (use it for learning, not judging).

- **Code as a liability, not an asset.** Lines of code are like *debt on a balance sheet*, not *cash in the bank*. More of it is a bigger burden to carry, not a bigger win. Once you see code this way, "reward people for writing more code" sounds as absurd as "reward people for taking on more debt."

- **The thermometer you're graded on.** A thermometer is useful because it reports the temperature honestly. Now imagine your bonus depends on the reading being low — you'd hold ice to it. It still shows a number; the number is now a lie. *That's* what happens to any engineering metric you reward people on. The instrument is fine; grading on it breaks it.

- **Map vs territory.** A metric is a *map* of the work; the work itself is the *territory*. Maps are useful for navigating. But the moment you start rewarding people for *making the map look nice*, they'll redraw the map instead of improving the territory. Never confuse a prettier dashboard with better software.

- **Scoreboard vs steering wheel.** A scoreboard tells you who won and who lost — it's for *judging*. A steering wheel tells you "drift left, correct right" — it's for *adjusting*. Use metrics as a steering wheel the team holds, never as a scoreboard a manager reads.

---

## Common Mistakes

1. **Treating a proxy as the real thing.** LOC, commits, and points are *proxies* — stand-ins for value, easy to count precisely because they're not the thing you care about. Forgetting this and optimizing the proxy is the root error behind every item on this page.

2. **Believing gaming requires dishonesty.** It doesn't. Good, honest people game broken metrics *automatically*, because the metric is *telling them to*. If you catch yourself thinking "my team just needs more integrity," you've misdiagnosed it — the metric is the problem, not the people.

3. **Measuring and ranking individuals.** The cardinal sin. Software is a team sport; individual leaderboards destroy collaboration, punish helping and mentoring, and make honesty expensive. There is no "better individual metric" — the fix is to *not measure individuals*.

4. **Comparing velocity (or any team-local unit) across teams.** Story points are an arbitrary unit each team invents for *its own planning*. Cross-team comparison is comparing uncalibrated scales — meaningless. Don't do it, and be wary of any dashboard that does.

5. **Using one number for a rich thing.** Productivity, quality, and developer experience are multidimensional. Any single-number "productivity score" hides far more than it reveals and invites gaming of that one dimension. Prefer a *small set* of signals you read together (the whole point of SPACE).

6. **Confusing "the number improved" with "reality improved."** A greener dashboard can mean the work got better — or that someone learned to game the metric, or stopped reporting the bad news. Always ask whether things *actually feel* faster, safer, less painful. If the number's up but nothing feels better, you're looking at gaming.

7. **Punishing the gaming instead of fixing the metric.** Scolding people for responding rationally to incentives never works for long. The durable fix is to change the *use*: detach the metric from rewards, point it at the system, hand it to the team as a question.

---

## Test Yourself

1. State Goodhart's law in one sentence, and explain *why* a measure stops being good once it becomes a target.
2. Your manager announces the team will be ranked by lines of code written. Give two specific, predictable ways this gets gamed, and name the *valuable* activity it punishes.
3. Why is comparing two teams' **velocity** meaningless? Why can a team "double its velocity" without shipping any more software?
4. What makes measuring and *ranking individuals* worse than a bad team-level metric? Name two collaboration behaviors it destroys.
5. The same lead-time number can be poison or a useful tool. What single thing determines which? Describe the "good" use in one sentence.
6. A team is told to drive down its open bug count, and the count drops sharply. Give one way this could be *gaming* rather than real improvement, and explain why it's especially dangerous.

<details>
<summary>Answers</summary>

1. *"When a measure becomes a target, it stops being a good measure."* Because once people are graded on the number, they optimize *the number* rather than the goal it stood for — and the cheapest way to move the number is almost never the same as achieving the goal, so the two come apart.
2. Gaming: write padded/verbose code where one line would do; copy-paste blocks; add needless wrapper functions. It punishes **deleting code and simplification** — the most valuable senior work — which registers as *negative* productivity under a LOC target.
3. Velocity is built from each team's *own, arbitrary, relative* story-point estimates; the two teams' "points" share no common unit, so comparing them compares uncalibrated scales. A team doubles velocity by *estimating the same work as more points* (a "3" becomes a "6"), with no change in software shipped.
4. Software is a team sport — most value (design, review, mentoring, unblocking) doesn't show up as one person's output, and some of it *raises a teammate's* number while leaving yours flat. Ranking individuals destroys, e.g., **helping/reviewing teammates** (it doesn't raise *my* rank) and **taking on hard, low-scoring but important work** (it tanks my number).
5. *How it's used* — owned by the team and pointed at the system vs. owned by a manager and pointed at individuals. Good use: the **team** uses the number as a starting question ("*why* is our lead time rising?") to find and fix a problem in its own **system/process**, with nobody being graded on it.
6. The bugs may simply stop being *filed* (or get reclassified as "tasks") rather than fixed — the count drops while real quality is unchanged or worse. It's especially dangerous because it *suppresses the very information* the team needs to see the problem: the dashboard goes green exactly as the product gets worse.

</details>

---

## Cheat Sheet

```
GOODHART'S LAW
  "When a measure becomes a target, it stops being a good measure."
  Grade people on a number → they optimize the NUMBER, not the goal.
  Not about dishonesty — about INCENTIVES. Good people game broken metrics too.

THE CLASSIC BAD METRICS (all fail the same way)
  Lines of code   → code is a COST not an asset; punishes deleting/simplifying; pad it trivially
  Commit/PR count → split work, commit trivia; rewards busyness, punishes thoughtfulness
  Velocity/points → arbitrary team-local unit; cross-team compare = MEANINGLESS; inflate estimates to "rise"

THE CARDINAL SIN
  Measuring + ranking INDIVIDUALS.
  Software is a team sport → leaderboards kill helping, mentoring, and hard-but-important work.
  Rule: a metric for a PERSON is a weapon; a metric for a SYSTEM is a tool.
  Individual dev productivity ≈ cannot be measured. Don't try.

RIGHT USE vs WRONG USE (same number, opposite effect)
  WRONG: manager → judges/ranks/rewards INDIVIDUALS → fear + gaming
  RIGHT: team    → asks "why?" about its own SYSTEM → curiosity + real fixes
  Sidestep Goodhart by NEVER taking the step that triggers it (don't make it a personal target).

SPOTTING GAMING (it's predictable)
  Ask: "laziest way to move this number WITHOUT doing better work?"
  Red flags:
    - number up but nothing actually feels better
    - people say "hit the number" not "ship the thing"
    - attached to a person / a ranking
    - one number for a rich, multidimensional thing
    - reward or punishment is tied to it
  Fix gaming by changing the USE, never by scolding people.
```

---

## Summary

- **Goodhart's law** is the master key: *when a measure becomes a target, it stops being a good measure.* It works through incentives, not dishonesty — grade people on a number and even honest people optimize the number instead of the goal, and the two snap apart.
- The **classic bad metrics — LOC, commit/PR count, velocity** — all fail the *same* way: each is an easy-to-count, easy-to-inflate **proxy** that doesn't measure the real goal (valuable, working software). LOC punishes the deletion and simplification that mark good engineering; commit counts reward busyness over thought; velocity is an arbitrary, team-local unit that's meaningless across teams and trivially inflated.
- The **cardinal sin** is measuring and *ranking individuals*. Software is a team sport, so individual leaderboards destroy collaboration — they punish helping, mentoring, and hard-but-low-scoring work, and make honesty expensive. Individual developer productivity essentially cannot be measured; don't try.
- The **right mindset:** a metric is a **conversation starter for the team about its own system**, never a **scoreboard a manager uses to judge or reward people**. Owned by the team, pointed at the system, used to ask "why?" — the *same number* that would be poison becomes one of your best tools. You avoid Goodhart's law by refusing to make the metric a personal target in the first place.
- **Gaming is predictable and is a signal, not a sin.** Ask "what's the laziest way to move this number without doing better work?" — if an easy answer exists, the metric is gameable and *will* be gamed. The fix is always to change *how the metric is used*, never to scold people for responding to the incentives you gave them.

You now have the most important defensive skill in this whole roadmap: the ability to look at a proposed metric and tell whether it will *help a team improve* or *quietly teach it to lie to you*. Everything else — DORA, flow, SPACE — is about building metrics that fall on the right side of that line.

---

## Further Reading

- Martin Fowler — [*CannotMeasureProductivity*](https://martinfowler.com/bliki/CannotMeasureProductivity.html). The definitive short essay on why individual developer productivity can't be measured. Read it twice.
- *Accelerate* (Forsgren, Humble & Kim) — the contrast case: what *good*, system-level, team-owned metrics look like (the four keys). Read it after this page to see the right way done right.
- **Goodhart's law** and its cousin **Campbell's law** — look up both; Campbell's is the social-science twin ("the more a quantitative indicator is used for decision-making, the more it will distort the process it's meant to monitor").
- The **McNamara fallacy** — the trap of deciding that what can't be measured easily doesn't matter. The senior tiers of this topic go deep on it; worth knowing the name now.
- The [middle.md](middle.md) of this topic — formalizes these failure modes, adds vanity vs. weaponized metrics and the McNamara fallacy, and shows how to design metrics that resist gaming.

---

## Related Topics

- [middle.md](middle.md) — the same failure modes made rigorous: proxy/vanity/weaponized metrics, McNamara, and gaming-resistant design.
- [senior.md](senior.md) — designing and defending a metrics program in a real org: choosing what to measure, who owns it, and how to keep leadership from turning it into a scoreboard.
- [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md) — the contrast: *good*, research-backed, system-level metrics that avoid these traps.
- [03 — The SPACE Framework](../03-space-framework/junior.md) — *why* you use several signals at once instead of one number, precisely to resist gaming.
- [Code Quality Metrics](../../code-quality-metrics/) — the same "good vs. weaponized metric" lesson applied to *code*-level numbers (complexity, coupling, coverage).
