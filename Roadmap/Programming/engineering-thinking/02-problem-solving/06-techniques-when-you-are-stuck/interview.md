> Interview questions on getting unstuck probe judgment and self-awareness, not trivia. Interviewers want to hear a *process*: that you recognize thrashing, that you know pushing harder is often wrong, that you can ask for help well, and that you tell productive struggle from spinning. Answer with concrete tactics and honesty — "here's exactly what I do, and here's how I know it's time to switch." Vague grit ("I just keep at it until I solve it") is a red flag, not a strength.

---

## Q1. You've been stuck on a bug for two hours. Walk me through what you do.

First, I notice I'm stuck — two hours with no new information is the signal, not a badge. I stop pushing, because grinding a tired, frustrated brain produces guesses, not fixes. Concretely: I step away for a couple of minutes to break tunnel vision; I rubber-duck it — explain the failure line by line out loud, which usually exposes the gap; I list the assumptions I'm *sure* are true and actually verify them, because the bug is almost always there; and I build a minimal reproduction. If I'm still stuck after a clean attempt, I write up a precise question and ask a teammate. The key tell I'd give: I measure progress by information gained, not hours spent.

**Trap:** answering "I just keep going until it's solved." That describes thrashing and signals you'll silently burn days.

---

## Q2. What's the difference between productive struggle and unproductive thrashing?

Productive struggle generates information — each attempt rules something out, narrows the search, or teaches a fact; that's where real learning lives, so I want it. Thrashing generates nothing: same failed approach repeated, changes made without a hypothesis, rising frustration. My real-time test is to ask every ~15 minutes, "do I know something now I didn't know when I started this attempt?" If yes, keep going. If no twice in a row, I switch technique or escalate. The danger is they *feel* identical from the inside — both feel like hard work — so I rely on the information test, not the feeling.

---

## Q3. When should you ask for help?

I use a rough 15–30 minute rule: struggle alone first, because that's the learning window, but don't let it become a silent multi-day grind. After a focused, prepared attempt with no progress, the cost of staying stuck — my time, the deadline, blocking others — outweighs the learning, so I ask. I also flex it by stakes: for a low-pressure learning task I'll struggle longer; for a production incident burning revenue I pull in the expert immediately, because hero-grinding an outage is a mistake, not grit.

**Follow-up — "Isn't asking a sign of weakness?"** The opposite. Asking a sharp question after a real attempt is the senior move; silently wasting a day to protect your ego is the weak one.

---

## Q4. How do you ask a good question?

I give three things: what I'm trying to do (the goal), what I already tried (so they don't repeat my dead ends), and what I expected versus what actually happened — with the exact error pasted, not paraphrased. I lead with the real goal, not just my attempted fix, to avoid the XY problem. The reference is Eric Raymond's *How To Ask Questions The Smart Way*: do your homework, then ask precisely, respecting the helper's time. And here's the thing I'd flag — writing the good question often answers it. The articulation forces me to confront the gap, and I regularly delete the message half-written because I've just spotted the bug.

---

## Q5. What is rubber-duck debugging and why does it work?

You explain your code or problem, line by line, out loud, to an inanimate object — a rubber duck — as if it knows nothing. The name's from Hunt & Thomas's *The Pragmatic Programmer*. It works because speaking forces articulation, and articulation exposes the gap between what you *believe* the code does and what it actually does. The classic moment is "and this returns the user, which is definitely set, because—" and you stop, because it *isn't* definitely set. The duck contributed nothing; being forced to make your reasoning explicit did all the work. It's the same mechanism that makes writing a good help question solve the problem.

---

## Q6. Why is taking a break a legitimate technique and not just procrastination?

Because of how cognition works — there's a focused mode (deliberate, narrow) and a diffuse mode (relaxed, broad, background), described by Barbara Oakley in *A Mind for Numbers*. When you're stuck, focused mode has exhausted the obvious paths; diffuse mode finds the non-obvious connection, but it only runs when you step away — on a walk, in the shower, asleep. Poincaré famously cracked a hard problem the instant he stepped onto a bus after days of focused failure. The condition is you have to *load* the problem with focused effort first; then stepping away lets the background process work. "Sleep on it" is real memory consolidation, not folklore.

**Trap:** claiming you take a break *instead* of engaging hard. The break only pays off after focused effort loads the problem.

---

## Q7. Give an example of "the assumption you didn't know you were making."

The *Pragmatic Programmer* line "select isn't broken" captures it: it's extremely rare that the OS, standard library, compiler, or database is actually broken. So when I catch myself thinking "this must be a framework bug," that's the flashing sign the bug is in *my* code — in the thing I was certain was fine. Concretely: I once spent an hour sure my SQL was correct and the ORM was misbehaving; the ORM was fine, I'd assumed a field name that didn't match the column. The fix is to make implicit assumptions explicit — write them down ("input is valid," "this is non-null," "config is loaded") — and verify each with an actual print or debugger, especially the ones I didn't bother to check because they were "obviously" fine.

---

## Q8. "Change the representation" — what does that mean concretely?

Get the problem out of your head into a different form, because the form you're using may be hiding the answer. Draw it — a 30-second box-and-arrow sketch of request flow beats simulating five objects in working memory. Trace a tiny concrete example by hand — run `[3, 1, 2]` through the code on paper instead of reasoning abstractly. Put cases in a table to reveal the combination you never handled. And sometimes change the *data structure* itself: a lot of "I'm stuck on this algorithm" is really "I picked a structure that makes this hard" — switching an O(n) scan inside a loop to a hash-set lookup makes the problem evaporate rather than solving it.

---

## Q9. What is "working backward," and when is it the right move?

You start from the goal you want and ask what must be true immediately before it, then before that, chaining backward until you hit something you can establish. It's Pólya's heuristic from *How to Solve It*. It's strongest when there are many possible forward paths but only one valid ending — you prune aggressively from the end. For a bug: "the response should contain sorted orders → so I need sorted orders in hand → so I need the user's orders → so I need the user id → so I need an authenticated request," and the break is wherever a "before" step isn't actually satisfied.

---

## Q10. How does inversion help when you're stuck?

When "how do I make this work?" is a blank wall, I flip it: "how would I deliberately *cause* this exact failure?" That converts an open-ended "why" into a concrete, checkable list of mechanisms. For an intermittent 401, instead of staring at "why does this sometimes fail," I ask "how would I engineer an intermittent 401?" — expired token, clock skew, a load-balanced node with a stale secret, a race between refresh and use — and now I have suspects to test off, not a void. It's also great for design: "how would I make this system slow / insecure / unmaintainable?" surfaces the risks you can't otherwise articulate.

---

## Q11. You're leading a team that's been stuck on a technical decision for three weeks. What do you do?

First diagnose *why*: analysis paralysis, a shared unverified assumption, hidden disagreement, or genuinely missing expertise — each needs a different intervention. Usually it's paralysis driven by an inflated fear of being wrong, so I right-size that fear with the reversible-decision frame: most choices are two-way doors, and for those, deciding slowly costs more than deciding wrong. I force motion — timebox a spike on the top two options, set a default with a deadline ("if we don't decide by Thursday we go with X"), and convert competing opinions into a measured experiment so data ends the argument. If the real block is missing expertise, I stop the guessing and pull in the specialist. A stuck team usually doesn't need more analysis; it needs a decision-forcing structure.

---

## Q12. How do you know when to abandon an approach instead of pushing through?

The signal is that I'm fighting the design, not a bug: every fix spawns two new problems, the "clever" part keeps needing more cleverness to hold together, and I can't explain the approach simply anymore. When a teammate's "why not just…?" makes me defensive, I listen — that's usually right. The trap is sunk cost: the hours already spent are gone whether I continue or restart, so the only question is which path is cheaper *from here*. Often the failed attempt taught me the exact constraint that makes the right approach obvious, so restarting clean is faster than it looks.

---

## Q13. How do you make it safe for your team to ask for help early?

Mostly by modeling it from seniority — safety flows down from the most senior people. I ask for help publicly myself: "stuck on this for 40 minutes, here's what I've ruled out, anyone seen it?" — which relicenses asking as something strong engineers do. I say "I don't know" out loud, often. I reward the early well-formed ask over the silent multi-day grind, and I never punish a good question — not with a sigh, not with "you should know this," because one public put-down teaches everyone watching to go silent. The economics justify it: a fear culture turns five-minute questions into two-day silent grinds, repeatedly, across everyone.

---

## Q14. What's your personal "I'm thrashing" signal?

Honest self-knowledge is what they're testing. Mine is editing without a hypothesis — when I catch myself thinking "let me just try this" with no theory of *why* it would work, that's pure guessing and I stop. Other tells: my tab count climbing past fifteen (collecting, not deciding), re-reading the same paragraph three times (saturated, not absorbing), and reflexively blaming the framework. The discipline is naming the transition the moment I spot it — "I'm thrashing, three edits, no hypothesis, stopping" — because naming it breaks the spell, and an unnamed thrash just continues by inertia.

---

## Q15. Someone asks you a question they could have answered themselves with five minutes of effort. How do you respond?

I help, and I never make them feel bad for asking — visible impatience teaches the whole team to stop asking, which is far more expensive than this one question. But I help in a way that builds their independence: I show them *how* I'd have found it (the search, the doc, the print statement) rather than just handing over the answer, so next time they reach for the technique themselves. If it's a recurring pattern with one person, I'd coach them privately on the 15-minute rule and the toolkit — but the default reaction in the moment is warmth plus a teach-to-fish, never a put-down.
