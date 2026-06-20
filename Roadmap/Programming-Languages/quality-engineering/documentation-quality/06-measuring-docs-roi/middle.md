# Measuring Docs ROI — Middle Level

> **Roadmap:** [Documentation Quality](../README.md) → Measuring Docs ROI
> *The junior page argued that docs have value and that page views lie. This page makes the value measurable: the four metric families that matter, exactly how to instrument each one, and how to run a before/after that survives the question "how do you know the doc did that?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Four Metric Families](#the-four-metric-families)
4. [Engagement — the Tempting, Weakest Family](#engagement--the-tempting-weakest-family)
5. [Task Success — Did the Reader Actually Win?](#task-success--did-the-reader-actually-win)
6. [Deflection — the Money Metric](#deflection--the-money-metric)
7. [Onboarding — Time-to-Productive](#onboarding--time-to-productive)
8. [Leading vs Lagging Indicators](#leading-vs-lagging-indicators)
9. [The Attribution Caveat](#the-attribution-caveat)
10. [Worked Example — Doc the #1 Support Topic, Measure Deflection](#worked-example--doc-the-1-support-topic-measure-deflection)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Which metrics actually measure doc value, how do I instrument them, and how do I prove a doc caused a change?**

At the junior level you can argue that documentation pays off and that page views are a vanity metric. That's the right instinct, but it's not yet a measurement program. It can't tell you *which* of your thousand pages earns its keep, *how much* support load a new tutorial removed, or whether the drop you're celebrating was your doc or a product fix that shipped the same week.

This page turns the instinct into instrumentation. There are four families of doc metrics — **engagement, task success, deflection, onboarding** — and they form a ladder from *cheap and weak* to *expensive and meaningful*. The job is to know what each family measures, what it *can't* measure, how to collect it without a six-month analytics project, and how to wire up a before/after that an engineering director will believe. The hardest part isn't collection — it's **attribution**: a metric moving is correlation; claiming your doc moved it requires ruling out the confounders that move it too.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say why page views are a weak proxy for value.
- **Required:** You have *some* analytics on your docs site (even raw access logs count) and access to your support tooling.
- **Helpful:** You've read [05 — Readability & Information Architecture](../05-readability-and-information-architecture/middle.md); findability problems masquerade as content problems in every metric here.
- **Helpful:** You've done a [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/middle.md) pass, so you know where the holes are *before* you measure who falls into them.

---

## The Four Metric Families

Every doc metric worth tracking falls into one of four families, and they are not interchangeable. They differ in two ways that determine how much you should trust them: how *close to the reader's actual goal* they sit, and how *hard they are to game*.

| Family | What it claims to measure | Closeness to real value | Gameability | Cost to instrument |
|---|---|---|---|---|
| **Engagement** | "People reach and look at the doc" | Far (proxy) | High | Low |
| **Task success** | "The doc answered the reader's question" | Medium | Medium | Medium |
| **Deflection** | "The doc replaced a costly human interaction" | Close | Low | Medium–High |
| **Onboarding** | "Docs made new people productive faster" | Close (for one audience) | Low | High |

> **Key insight:** The families form a ladder, and the cheap rungs are the weak ones. Engagement is trivial to collect and tells you almost nothing about value; deflection and onboarding are expensive and tell you almost everything. A docs program that only reports the bottom rung is reporting the metric that's easiest to move *and* easiest to misread. Always climb at least to task success, and tie your headline number to deflection or onboarding.

---

## Engagement — the Tempting, Weakest Family

Engagement metrics are whatever your analytics tool hands you for free: **pageviews, unique readers, time-on-page, bounce rate, scroll depth**. They are seductive because they're already there and they go up and to the right. They are weak because *none of them distinguishes a satisfied reader from a frustrated one.*

The ambiguity is the whole problem. Read these two interpretations of the same numbers:

- **High time-on-page** — engaged, careful reading? Or the reader is *stuck*, re-scanning a wall of text because they can't find the one line they need?
- **Low bounce rate** — the page hooked them into the rest of the docs? Or it failed to answer their question, so they kept clicking around looking?
- **Rising pageviews** — your content is more valuable? Or your *product got more confusing* and more people now need the manual?

Every engagement metric has a "good" story and a "bad" story that produce the *identical* number. You cannot tell them apart from the metric alone.

```js
// Minimal engagement instrumentation — the easy 80%.
// (GA4, Plausible, PostHog all give this with a snippet.)
analytics.page({
  path: location.pathname,
  referrer: document.referrer,   // how did they arrive? search? a ticket link?
});
// Time-on-page and scroll depth are auto-captured by most tools.
```

Engagement is not useless — it's a *triage* layer. It tells you **where to look**, not whether anything is good. The page with 50k views and a 90% bounce is worth investigating; the page with 4 views a year is a [freshness](../README.md) liability nobody will catch when it rots. Use engagement to *prioritize*, then climb to a real metric to *judge*.

> **Key insight:** Treat engagement as a *smoke detector*, not a *thermometer*. It tells you which room to walk into. It never tells you the temperature — whether the reader left better off. Reporting engagement as your ROI number is reporting that people *arrived*, not that they were *helped*.

---

## Task Success — Did the Reader Actually Win?

Task-success metrics try to answer the question engagement can't: *did this page do its job?* You get there by asking the reader, and by watching what they search for.

**The feedback widget.** The "Was this page helpful? 👍 👎" control at the foot of a doc. It is the cheapest direct signal of value you can collect, and the single most important upgrade is the **free-text follow-up on 👎** — the raw rate is noisy, but the comments are gold.

```js
// Feedback widget: capture the verdict AND the reason.
function sendFeedback(helpful, comment) {
  analytics.track('doc_feedback', {
    path: location.pathname,
    helpful,                       // true / false
    comment: comment || null,      // shown only after a 👎
    docVersion: window.DOCS_SHA,   // tie the verdict to a specific revision
  });
}
// On 👎, reveal: "What were you looking for?" → free text.
// That sentence is worth more than a thousand anonymous thumbs.
```

Two cautions on the widget. First, **response rate is tiny** (often <1%) and **self-selected** toward the annoyed, so read it as a *qualitative stream* and a *relative* signal across pages, not an absolute satisfaction score. Second, **always tie the vote to the doc version** (`docVersion` above) so a fix resets the ledger and you can see whether the rewrite actually moved the rate.

**Search analytics.** Your docs search bar is a continuous, unsolicited record of *what readers came looking for in their own words*. Two reports matter most:

- **No-results searches** — queries that returned nothing. This is a *direct, ranked list of content gaps and vocabulary mismatches*. If "reset password" returns nothing because your doc says "credential rotation," that's not a missing doc — it's a [findability](../05-readability-and-information-architecture/middle.md) failure, and it's invisible to coverage tools.
- **Search success rate** — the fraction of searches followed by a click on a result (vs. a refinement or an abandon). A query that's searched often but rarely clicked through means *results exist but look wrong*.

```text
# Weekly "no results" report — the cheapest gap-finder you have.
QUERY                       SEARCHES   RESULTS   ACTION
"reset password"               412        0      → vocab gap: we say "credential rotation"; add alias + redirect
"webhook retry"                338        0      → real content gap: write the page
"rate limit 429"               201        0      → exists but untitled for this term; retitle/anchor
"sso okta"                      150        2      → results exist; check if they actually answer it
```

That table is produced by a one-line group-by over your search logs, and it routinely surfaces more actionable work than a quarter of guessing. The no-results list is, in effect, your readers writing your docs backlog for you.

> **Key insight:** Task success is the first family that measures the *reader's outcome* rather than their *behavior*. A 👎 with the sentence "I needed the rate-limit header name" tells you more than a million pageviews, because it names the gap. Your richest, cheapest source of *what to write next* isn't a survey — it's your no-results search log.

---

## Deflection — the Money Metric

Deflection is the family executives care about, because it converts directly to cost: **every question a doc answers is a support ticket, a Slack interrupt, or a sales-engineering call that didn't happen.** This is where "docs ROI" stops being a slogan and starts being a number with a dollar sign.

The core signals:

- **Support-ticket volume on a documented topic.** Did writing the doc for topic *X* reduce tickets *about X*? This requires that tickets be **tagged by topic** — without tagging you can measure total volume but never attribute a change to a specific doc.
- **Self-service ratio.** Self-service resolutions ÷ (self-service + assisted). A help-center "did this solve your problem? ✓" plus assisted-ticket counts gives you the denominator and numerator. A rising ratio is the cleanest aggregate deflection signal.
- **Internal deflection.** Sales engineering and solutions teams field the same product questions repeatedly. "How many times did SE get asked about SSO setup this month?" is a deflection metric for *internal* audiences, and it's often easier to move (a small audience, a known question) than public support.

The instrumentation that makes deflection possible is **topic tagging on tickets**. This is unglamorous and it is the whole game:

```text
# Ticket taxonomy — the prerequisite for all deflection measurement.
# Tag every ticket with a topic; reuse the SAME topic keys as your doc URLs.
ticket #4471  topic=auth/password-reset    channel=support  resolution=assisted
ticket #4472  topic=webhooks/retries       channel=support  resolution=assisted
ticket #4473  topic=auth/password-reset    channel=help-center resolution=self-service
```

With that taxonomy you can ask the only question that matters: *tickets tagged `auth/password-reset` per week, before and after we shipped the doc.* Without it, every deflection claim is a vibe.

> **Key insight:** Deflection is the highest-value, lowest-gameability family — you can't fake "the ticket didn't come in." But it is *entirely gated on ticket tagging*. The unglamorous work of a clean topic taxonomy, reused between your support tool and your doc URLs, is what unlocks every dollar-denominated docs metric. Most teams that "can't measure docs ROI" simply never tagged their tickets.

---

## Onboarding — Time-to-Productive

The fourth family measures docs' effect on the audience nobody files tickets for: **new hires and new integrators.** Good internal docs compress the time from day-one to contributing; good external docs compress the time from sign-up to first successful API call.

The headline metrics:

- **Time-to-first-PR** — calendar days from a new engineer's start to their first merged change. A blunt instrument, but a real one, and easy to pull from your VCS: it's the gap between the org-join date and the first merge.
- **Time-to-productive / time-to-first-success** — for external developers, time from account creation to their first successful API call (the "aha" event). Your product analytics already has both timestamps.
- **Onboarding survey** — a short structured survey at day 30 and day 90: "Which docs did you use? Where did you get stuck? What was missing?" The free-text answers point straight at the docs that failed silently.

```sql
-- Time-to-first-PR, straight from your VCS data.
SELECT u.name,
       u.joined_at,
       MIN(pr.merged_at)                              AS first_pr,
       MIN(pr.merged_at)::date - u.joined_at::date    AS days_to_first_pr
FROM users u
JOIN pull_requests pr ON pr.author_id = u.id AND pr.merged_at IS NOT NULL
WHERE u.joined_at > now() - interval '12 months'
GROUP BY u.name, u.joined_at
ORDER BY days_to_first_pr;
```

Onboarding metrics are the costliest family (they need surveys and a long baseline) and the most confounded (a strong mentor, a simpler first task, and a team reorg all move time-to-first-PR independently of docs). Treat them as a *trend over many hires*, never as a verdict on a single person — and pair the number with the survey's free text so you know *which doc* helped or hurt.

> **Key insight:** Onboarding metrics measure value for the one audience that never shows up in support data — yet is where docs pay off most. They're noisy per-person and meaningful in aggregate: don't judge a doc by one new hire's time-to-first-PR, judge it by the cohort trend plus what the day-30 survey says they got stuck on.

---

## Leading vs Lagging Indicators

A measurement program needs both fast signals and slow ones, and confusing the two leads to either premature celebration or paralysis.

- **Leading indicators** move *quickly* and *predict* value: 👍/👎 rate on a rewritten page, no-results search count, search success rate. You can read them days after a change. They're noisier and a step removed from the outcome, but they let you *steer*.
- **Lagging indicators** move *slowly* and *confirm* value: ticket volume on a topic, self-service ratio, time-to-first-PR. They take weeks to a quarter to register, they're closer to the real outcome, and they're what you *report*.

| | Leading | Lagging |
|---|---|---|
| **Examples** | 👍/👎 rate, no-results searches, search success | ticket volume, self-service ratio, time-to-first-PR |
| **Speed** | days | weeks–quarters |
| **Use for** | steering, fast iteration | reporting, proving impact |
| **Risk** | noisy, indirect | slow, heavily confounded |

> **Key insight:** Steer with leading indicators, report with lagging ones. If you only watch lagging metrics you'll wait a quarter to learn a rewrite flopped; if you only watch leading metrics you'll declare victory on a 👍 bump that never showed up in the ticket queue. A credible program shows the leading signal moving *first* and the lagging signal following — that sequence is itself part of the causal argument.

---

## The Attribution Caveat

This is the section that separates an honest docs metric from a misleading one. **A metric moving is correlation. Claiming your doc caused it is a causal claim, and causal claims have to survive the confounders.**

When `auth/password-reset` tickets drop 40% the week after you publish a doc, at least four other explanations compete with "the doc worked":

1. **The product changed.** Engineering shipped a self-serve password-reset flow the same sprint. The tickets dropped because the *problem* went away, not because you documented it.
2. **Seasonality and volume shifts.** Tickets fall during a holiday week or after a marketing push ends; *fewer total users* means fewer tickets on everything.
3. **Channel shift, not deflection.** Users stopped filing tickets and started asking in your community Discord. The work moved; it didn't vanish.
4. **Regression to the mean.** You wrote the doc *because* that topic spiked. Spikes subside on their own; you may be taking credit for gravity.

You will rarely get a clean randomized experiment on docs, so you reduce uncertainty instead of eliminating it:

- **Use a control topic.** Compare your documented topic against a *similar, undocumented* topic over the same window. If `password-reset` dropped but the comparable `account-deletion` held flat, the product/seasonality explanations weaken.
- **Check the changelog.** Before claiming deflection, ask the obvious question: *did the product change in this area?* One Slack message to the team kills the most common false positive.
- **Watch the causal chain.** Real doc-driven deflection usually shows a *sequence*: the doc's pageviews rise → the no-results searches for that term fall → *then* tickets drop. If tickets dropped but nobody read the doc, the doc didn't do it.

> **Key insight:** Always state the metric *with* its confounders, not as a bare win. "Tickets dropped 40%; a control topic held flat and no product change shipped in this area, so the doc is the most likely cause" is a claim a skeptic respects. "Our doc cut tickets 40%" is the claim that gets torn apart in the room — and deserves to be. Honesty about attribution is what makes the *believable* wins land.

---

## Worked Example — Doc the #1 Support Topic, Measure Deflection

A complete, runnable before/after for a single doc. This is the smallest end-to-end measurement that yields a defensible number.

**1. Find the top topic.** Group last quarter's tickets by tag and rank by volume and cost.

```text
TOPIC                       TICKETS/QTR   AVG HANDLE   HAS DOC?
auth/password-reset             520        18 min        no   ← target
webhooks/retries                310        25 min        partial
billing/invoices                240        12 min        yes
```

`auth/password-reset` is the move: highest volume, no doc, and a question with a *stable, documentable answer* (the test for whether a doc can even deflect it).

**2. Baseline before you write.** Pull the weekly series so you have a real "before," not a single number.

```text
auth/password-reset tickets/week (8-week baseline)
  48  51  47  53  49  50  46  52     mean ≈ 49.5/wk
```

**3. Write the doc — and aim it at the reader's words.** Title and structure it around the *search terms*, not your internal vocabulary. Check the no-results log: readers type "reset password," so that phrase goes in the title, the H1, and a search alias. (This is the [05 — findability](../05-readability-and-information-architecture/middle.md) lesson cashing out directly as deflection.)

**4. Watch leading indicators first.** In the first two weeks, before tickets can possibly move:

```text
"reset password" no-results searches:  412/wk → 30/wk   (page now ranks)
doc 👍/👎:                              86% helpful (n=140)
doc pageviews:                          0 → 1,900/wk     (people are finding it)
```

The leading signals fired: people find it, they search-and-succeed, they rate it useful. That's *necessary* for deflection but not yet proof of it.

**5. Measure the lagging indicator with a control.**

```text
                       baseline    weeks 5–8 after    change
auth/password-reset    49.5/wk        31/wk           −37%
account-deletion       22/wk          21/wk            −5%   (control, undocumented)
```

**6. Write the honest claim.** The documented topic fell 37%; a comparable control topic was flat; the changelog shows no product change in auth; and the causal chain held (views up → no-results down → tickets down). Quantify it: ≈ 18 fewer tickets/week × 18 min × loaded support cost ≈ a defensible weekly saving against a one-day writing cost. **State the residual uncertainty** — a Discord channel-shift wasn't ruled out — and you have a number a director will fund more docs on.

The point of the control, the changelog check, and the causal chain isn't ceremony. It's the difference between a metric that *convinces* and one that gets dismissed the moment someone asks "couldn't that just be the holiday?"

---

## Mental Models

- **The metric ladder.** Engagement → task success → deflection → onboarding climbs from *cheap and weak* to *expensive and meaningful*. The free rungs are free *because* they measure the least. Never let your headline number sit on the bottom rung.

- **Engagement is a smoke detector, not a thermometer.** It tells you which room to enter (which page to investigate), never the temperature (whether readers left better off). Useful for triage, worthless as a verdict.

- **The no-results log is your readers writing your backlog.** Every query that returns nothing is a reader telling you, in their own words, what you're missing. It's the highest-signal, lowest-effort input to "what do we document next."

- **Deflection is gated on tagging.** "We can't measure docs ROI" almost always decodes to "we never tagged our tickets by topic." The taxonomy is boring and it is the entire unlock.

- **Correlation is the metric; causation is the argument.** The number moving is data. Claiming your doc moved it is a *claim* you have to defend with a control, a changelog check, and a causal chain. State the confounders or expect to be dismissed.

---

## Common Mistakes

1. **Reporting pageviews as ROI.** Pageviews measure *arrival*, not *help*. A page can have a great view count and a terrible bounce because it fails everyone who lands on it. Climb at least to 👍/👎 and search success before claiming value.

2. **Reading the raw 👍/👎 *rate* as satisfaction.** Response rate is <1% and self-selected toward the annoyed. The *comments* are the signal; the *rate* is only useful as a relative, version-pinned trend across pages.

3. **Trying to measure deflection without tagging tickets.** Total ticket volume can't attribute a change to a specific doc. If tickets aren't tagged by topic, no deflection claim is possible — fix the taxonomy first.

4. **Claiming deflection without checking the changelog.** The single most common false positive: a product fix shipped the same week and *it* killed the tickets. One question to the team prevents the embarrassing retraction.

5. **Skipping the control topic.** A bare before/after can't distinguish "the doc worked" from "everything dropped that week." A comparable undocumented topic held flat is what turns correlation into a credible claim.

6. **Judging a doc by one new hire's time-to-first-PR.** Onboarding metrics are noisy per person (mentor quality, first-task difficulty, reorgs). They're meaningful only as a cohort trend, paired with the survey's free text.

7. **Watching only lagging indicators.** If you wait for the quarterly ticket trend, you learn a flop a quarter too late. Steer with leading signals (👍/👎, no-results) and confirm with lagging ones.

---

## Test Yourself

1. Name the four metric families in order from weakest-but-cheapest to strongest-but-costliest, and say what distinguishes the strong end from the weak end.
2. A page's time-on-page doubled after a rewrite. Why can't you tell from that number alone whether the rewrite helped?
3. What is the single most valuable report you can pull from your docs *search* logs, and why?
4. What prerequisite must be in place before *any* ticket-deflection measurement is possible?
5. Tickets on a topic dropped 40% the week after you published its doc. List three explanations other than "the doc worked," and one technique for each that reduces that uncertainty.
6. What's the difference between a leading and a lagging doc indicator, and what should you use each one for?

<details>
<summary>Answers</summary>

1. **Engagement → task success → deflection → onboarding.** The weak end (engagement) measures reader *behavior* (they arrived/looked) and is highly gameable; the strong end (deflection, onboarding) measures reader *outcomes* (a costly interaction didn't happen / a new person got productive) and is hard to fake.
2. Every engagement metric has a "good" story and a "bad" story producing the *same* number: doubled time-on-page could mean careful, engaged reading **or** a reader stuck re-scanning because they can't find the answer. The metric can't separate satisfied from frustrated.
3. The **no-results search report** — a ranked list of queries that returned nothing. It's a direct, reader-worded list of content gaps and vocabulary mismatches, and it surfaces problems (like findability) that coverage tools never see.
4. **Topic tagging on tickets** — a taxonomy that tags each ticket by topic (ideally reusing your doc URL keys). Without it you can see total volume but never attribute a change to a specific doc.
5. (a) **Product changed** — a fix shipped same sprint → *check the changelog / ask the team*. (b) **Seasonality / volume shift** — fewer total users → *use a control topic that held flat*. (c) **Channel shift** — users moved to Discord → *check whether the question reappeared elsewhere*. (Regression to the mean is a valid fourth → *control topic + longer baseline*.)
6. **Leading** indicators move fast and *predict* value (👍/👎, no-results searches, search success) — use them to *steer* and iterate. **Lagging** indicators move slowly and *confirm* value (ticket volume, self-service ratio, time-to-first-PR) — use them to *report* and prove impact.

</details>

---

## Cheat Sheet

```
THE FOUR FAMILIES (weak/cheap → strong/costly)
  engagement     pageviews, time-on-page, bounce   → TRIAGE only (smoke detector)
  task success   👍/👎 + comment, search success    → reader outcome; comments > rate
  deflection     ticket volume, self-service ratio  → $ value; needs ticket tagging
  onboarding     time-to-first-PR, day-30 survey    → cohort trend, never per-person

INSTRUMENT EACH
  engagement     GA4 / Plausible / PostHog snippet
  task success   feedback widget (vote + free-text on 👎, pin doc version)
                 search logs → weekly "no results" report (your docs backlog)
  deflection     tag every ticket: topic = <same keys as doc URLs>
  onboarding     VCS: joined_at → first merged PR; product: signup → first success

LEADING vs LAGGING
  leading  (days)        👍/👎, no-results, search success   → STEER
  lagging  (wks–qtr)     tickets, self-service, TTFP         → REPORT

BEFORE/AFTER (deflection)
  1 rank topics by volume×cost, pick top undocumented
  2 pull 8-week ticket baseline (a series, not one number)
  3 write doc titled in the READER'S search words
  4 confirm leading signals move first (views↑, no-results↓, 👍)
  5 measure tickets vs a CONTROL undocumented topic
  6 claim it WITH confounders: control flat + no product change + causal chain

ATTRIBUTION KILLERS (rule out before claiming)
  product fix shipped   → check changelog / ask team
  seasonality/volume    → control topic
  channel shift         → did the question reappear in Discord/forum?
  regression to mean    → longer baseline + control
```

---

## Summary

- Doc metrics fall into four families that form a ladder from **cheap-and-weak to expensive-and-meaningful**: engagement → task success → deflection → onboarding. The free rungs measure the least; tie your headline number to deflection or onboarding.
- **Engagement** (pageviews, time-on-page, bounce) is a smoke detector for *triage* — it tells you which page to investigate, never whether readers left better off, because every value has a "good" and a "bad" story.
- **Task success** is the first family to measure the reader's *outcome*: a feedback widget (with a free-text follow-up on 👎, pinned to the doc version) and search analytics. The **no-results search log** is your readers writing your backlog for you.
- **Deflection** is the dollar-denominated family — tickets that didn't get filed, a rising self-service ratio, fewer repeat SE questions. It is entirely gated on the unglamorous prerequisite of **tagging tickets by topic**.
- **Onboarding** (time-to-first-PR, time-to-first-success, day-30 surveys) measures the audience that never files a ticket. It's noisy per person and meaningful as a **cohort trend** paired with survey free text.
- **Steer with leading indicators, report with lagging ones**, and never confuse the two.
- Above all: a metric moving is **correlation**; claiming your doc caused it is a **causal argument** you must defend with a control topic, a changelog check, and the causal chain. State the confounders — that honesty is what makes the believable wins fundable.

---

## Further Reading

- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — Chapter on measuring documentation quality; the source for the engagement/task-success/deflection framing.
- **Google's "Measuring documentation quality"** (Google for Developers / Season of Docs writeups) — leading vs lagging signals and the attribution problem from a team that runs them at scale.
- **Write the Docs** — talks and the community Slack on docs analytics, feedback widgets, and deflection in practice.
- *Trustworthy Online Controlled Experiments* (Kohavi, Tang & Xu) — for the attribution half: why before/after without a control is weak, and how to reason about confounders.

---

## Related Topics

- [junior.md](junior.md) — why docs have value and why page views lie; the intuition this page instruments.
- [senior.md](senior.md) — building a docs measurement program: dashboards, North-Star metrics, and defending docs ROI to leadership.
- [05 — Readability & Information Architecture](../05-readability-and-information-architecture/middle.md) — findability failures that show up as content failures in every metric here (the no-results log is the bridge).
- [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/middle.md) — find the holes before you measure who falls into them; coverage is the supply side, these metrics are the demand side.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the broader discipline of measuring engineering outcomes, leading/lagging indicators, and the same attribution traps applied to delivery.
