# Runbooks & Operational Docs — Interview Questions

> **Category:** [Documentation](../README.md) — the operational knowledge that keeps a running system healthy and recoverable, written for the on-call engineer at 3 a.m.

Conceptual and practical questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Practical Tasks](#practical-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is a runbook, and who is it written for?

**Answer:** A step-by-step procedure for handling a specific operational situation — an alert or a routine task — that takes the reader from symptom to diagnosis to fix to verification. It's written for the *operator/on-call engineer*, often someone who didn't build the system, reading it under stress.

### J2. State the "3 a.m. test."

**Answer:** Could a tired on-call engineer who didn't build this system follow this doc, at 3 a.m., and resolve the page — without calling anyone? If no, the doc isn't done. It rejects vague steps and assumed context.

### J3. What's the difference between a runbook and an incident playbook?

**Answer:** A runbook is for one task or one alert — one person, diagnose → fix → verify (a recipe). An incident playbook coordinates a *group's response to an outage* — severity, roles (IC/Comms/Scribe), comms cadence — and links out to runbooks for the actual fixes.

### J4. List the core sections of a runbook in order.

**Answer:** Title/alert name → symptom/trigger → severity & impact → diagnosis → remediation → verification → rollback → escalation → links (dashboards/logs/related runbooks).

### J5. Why must diagnosis come before remediation?

**Answer:** So the operator understands the cause before acting. Blind fixes (like reflexive restarts) can hide the real problem or make it worse, and they train people to apply remediation without understanding.

### J6. What does "every alert links to its runbook" mean, and how is it done?

**Answer:** When a page fires, the notification carries the URL of the runbook so the on-call engineer reaches the procedure instantly instead of searching a wiki. It's configured in the alerting tool — e.g., a `runbook_url` annotation on a Prometheus alert.

### J7. Name three benefits of operational docs.

**Answer:** They reduce MTTR (incidents end faster), spread knowledge beyond the original author, and lower the bus factor / prevent heroics (the system no longer depends on one person's memory).

### J8. What's the difference between impact and severity?

**Answer:** Impact is what's broken and who's affected; severity is the agreed urgency label (SEV-1/2/3) that the impact drives. They answer different questions — what's wrong vs. how hard to react.

### J9. Name three operational docs besides runbooks.

**Answer:** On-call handbook, escalation/contact docs, capacity/scaling docs, disaster-recovery/backup-restore procedures, architecture maps for operators, postmortems (any three).

### J10. Why must every command in a runbook be copy-pasteable?

**Answer:** Because the reader is stressed and may not know the system. A complete, runnable command removes a chance to think wrong, mistype, or stall — "restart the worker" fails; the exact command with the host filled in (or a placeholder plus how to resolve it) passes.

---

## Middle Questions

### M1. Why must a postmortem be blameless — give the mechanical reason.

**Answer:** Because blame destroys information. If honest mistakes are punished, people hide details, omit them from the timeline, and stop reporting near-misses — so you lose exactly the data needed to prevent recurrence. Also, systems (not people) are the real cause: if one command can take down prod, the missing guardrail is the defect.

### M2. List the standard sections of a postmortem.

**Answer:** Summary, Impact, Timeline, Root cause(s), What went well, What went poorly, Action items. The action items (owned, dated, tracked) are the only part that prevents recurrence.

### M3. What are the three canonical incident roles?

**Answer:** Incident Commander (owns and coordinates the response; doesn't fix the bug themselves), Communications Lead (keeps stakeholders/customers informed, shields responders), and Scribe (records the timeline live, in UTC).

### M4. Define RTO and RPO with an example.

**Answer:** RTO (Recovery Time Objective) = max acceptable time to restore service — e.g., "back up within 1 hour." RPO (Recovery Point Objective) = max acceptable data loss as a time window — e.g., "lose at most 5 minutes of data." RTO is about downtime; RPO is about data loss.

### M5. Why is an untested backup not a backup?

**Answer:** You don't know a backup can be restored until you've restored it; backups are frequently corrupt, partial, or misconfigured, and a disaster is the worst time to find out. The restore procedure must be rehearsed, or the DR doc is fiction.

### M6. Describe the postmortem → runbook feedback loop.

**Answer:** An incident produces a blameless postmortem; its action items create/fix runbooks, tune alerts, and automate manual steps — so the next occurrence is detected sooner and recovered faster. A postmortem that doesn't change the system or its docs is theater.

### M7. Why must the incident timeline be written live?

**Answer:** Memory of stressful events is unreliable and self-serving. A live, timestamped (UTC) record is the objective basis the postmortem analyzes and the source of MTTD/MTTR metrics. The Scribe role exists precisely to capture it as it happens.

### M8. When should you write a runbook, and when not?

**Answer:** Write one for any alert that pages a human (and link it) and for recurring manual tasks. Don't write one for a true one-off (note it in the ticket), and prefer *automation* over a runbook for anything fully mechanical — the script becomes the runbook.

---

## Senior Questions

### S1. Why do prose runbooks rot faster than other documentation?

**Answer:** They're write-once/read-rarely (read only when their specific failure occurs), so they drift out of sync with constantly-changing infra unnoticed; they're untested until the incident (first real "test run" is at 3 a.m.); their failures are silent (look like "on-call was confused," not "the doc lied"); and they depend on flawless human execution. A prose runbook is a latent liability — an unverified promise that comes due under pressure.

### S2. Describe the automation continuum for runbooks.

**Answer:** Prose (human reads + does) → semi-automated (human reads, runs provided/tested scripts) → ChatOps/one-button (human triggers, system executes) → fully automated (system detects *and* remediates, human notified). Moving rightward removes human error, speeds and determinism, and turns silent doc-rot into detectable code failure — at higher build/maintenance cost. Match the form to the procedure.

### S3. Why can a script enforce something a prose runbook cannot?

**Answer:** A document can only *warn* ("only do this if the slot is dead"); code can *refuse* to do the wrong thing — it checks the precondition and exits if it's unsafe, and it auto-logs an audit trail. Encoding guardrails as enforced checks rather than pleas to a tired human is a core argument for the continuum.

### S4. Why is a stale runbook worse than no runbook?

**Answer:** With no runbook, the engineer knows they're improvising — careful, verifying, escalating early. With a wrong runbook they have *false confidence*: they trust it, run the stale command, hit confusing errors or cause damage. The doc actively misleads at the moment of maximum stress. So freshness is a correctness property: date/own runbooks, prefer executable steps, exercise via game days, review after incidents.

### S5. What is a game day / DiRT, and why run one?

**Answer:** A planned exercise injecting a realistic failure so the team responds *using the actual runbooks and on-call process* — discovering where they're wrong before a customer does. It's the only way to keep prose runbooks honest, since they're otherwise untested until an incident. A game day that finds three wrong steps is a success. Output is owned, dated action items, like a postmortem.

### S6. When is a runbook the wrong artifact?

**Answer:** When the underlying problem should be *fixed* or *automated* instead. Three escalating responses to a recurring page: write a runbook (lowest value — page still fires, human still toils, doc still rots), automate the remediation (better), or fix the system so the page never fires (best). A pile of remediation runbooks for frequent mechanical pages is often a symptom of an unfixed system — operational debt.

### S7. How do operational docs form a connected system?

**Answer:** Alerts link to runbooks; runbooks link to dashboards, log queries, and architecture maps (for blast-radius reasoning); playbooks link to runbooks; postmortems link back to the runbooks/alerts they amend and forward to ADRs recording *why* a change was made; the on-call handbook indexes it all. The senior job is making this web navigable under stress — one click from page to procedure to context. An accurate but unlinked doc is nearly as useless as a missing one.

---

## Professional Questions

### P1. How do you enforce operational-doc quality at scale?

**Answer:** Codify standards as gates: `runbook_url` required on every paging alert (lint it in CI); runbooks in version control with an owner and last-verified date; a production-readiness gate (SLOs + alerts-with-runbooks + on-call + rehearsed DR) before a service goes on-call; mandatory blameless postmortems for SEV-1/2 with tracked action items; standard templates. Turn "we should keep runbooks current" into checks, owners, and gates.

### P2. What metrics actually track operational-doc health?

**Answer:** % of paging alerts with a valid runbook link (aim 100%), runbook freshness (% verified recently), MTTR/MTTD trend (the outcome), % of incidents that hit a missing/wrong runbook, postmortem action-item closure rate, game-day/DR-drill cadence, and toil/repeat-page count. **Not** "number of runbooks" — that's vanity and can signal operational debt. Tie it to DORA (change-failure rate, time-to-restore).

### P3. How is alert fatigue an operational-doc problem?

**Answer:** Every page must be *actionable* (has a runbook) and *necessary* (a human must act now). Non-actionable or noisy pages train people to ignore the pager, so the next real SEV-1 gets a slow response. Auditing alerts — do they page? have a runbook? need a human at 3 a.m.? — is operational-doc work, and a key on-call-health lever.

### P4. How do you build operational docs for a poorly understood legacy system?

**Answer:** Mine incidents for runbooks (write them right after each incident, while proven-correct and fresh); capture tribal knowledge by pair-writing with the expert and having *someone else* execute the runbook in a drill; Pareto the worst pages first; write "escalate to @owner" rather than a *guessed* dangerous command; and rehearse DR explicitly (legacy backups are the most likely to be un-restorable). Don't ship guessed runbooks, and don't document instead of fixing a page that fires nightly.

### P5. Why is blamelessness a leadership behavior, not a template field?

**Answer:** Engineers watch how the first blamed mistake is handled; one public blame event makes everyone less candid, postmortems go vague, near-misses stop being reported, and similar incidents recur. Leadership must visibly never punish honest mistakes named in postmortems — that's what preserves the candor (and thus the information) the whole process depends on.

### P6. What makes a postmortem program effective vs. theater?

**Answer:** The loop must visibly close: every postmortem produces at least one improvement to a runbook, alert, guardrail, or the system. Action items are owned, dated, tracked to closure (open-item count is a metric), and postmortems are shared, read, and archived so the next engineer with a similar symptom finds the prior analysis. If postmortems stop changing things, it's theater.

---

## Practical Tasks

### C1. Rewrite this runbook step to pass the 3 a.m. test.

**Before:**

```text
If the workers are backed up, scale them up. Check the usual dashboard.
```

**After:**

```text
## Diagnose
Check worker queue depth:
    kubectl -n prod exec deploy/queue-tool -- queuectl depth orders
Dashboard: https://grafana.internal/d/worker-queue  (alert fires when depth > 5000 for 10m)

## Remediate (if depth > 5000 and rising)
Scale the worker deployment to 12 replicas:
    kubectl -n prod scale deploy/order-worker --replicas=12

## Verify
Queue depth should drop within ~5 min:
    kubectl -n prod exec deploy/queue-tool -- queuectl depth orders
Confirm the alert clears in Grafana.
```

State the fixes: exact commands replace "scale them up"; a concrete threshold replaces "backed up"; the named dashboard replaces "the usual"; verification was added.

### C2. Write a Prometheus alert that links to its runbook.

```yaml
- alert: APILatencyHigh
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="api"}[5m])) > 1
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "API p99 latency {{ $value | humanizeDuration }} (>1s) on {{ $labels.instance }}"
    runbook_url: "https://runbooks.internal/api/latency-high"   # the page carries this
```

The `runbook_url` annotation is the alert→runbook link — the on-call engineer clicks straight from the page.

### C3. Convert a dangerous prose step into an enforced guardrail.

**Before (prose can only warn):**

```text
Drop the replication slot — but ONLY if the replica is dead. Be careful!
    psql -c "SELECT pg_drop_replication_slot('<slot>')"
```

**After (code refuses to do the wrong thing):**

```python
def drop_dead_slot(slot, confirm):
    if not confirm:                 raise SystemExit("need --confirm")
    if slot_is_active(slot):        raise SystemExit(f"{slot} is ACTIVE — escalate, do NOT drop")
    if not slot_exists(slot):       raise SystemExit(f"{slot} not found — re-check diagnosis")
    log_action("drop_slot", slot)   # auto audit trail
    execute_sql(f"SELECT pg_drop_replication_slot('{slot}')")
```

State the point: a document can only beg the human to be careful; a script enforces the "only if dead" precondition and logs the action.

### C4. Fill the action-items table for a postmortem.

Given: a deploy with no canary shipped an unbounded query to 100% of traffic, latency spiked, detected after 12 minutes.

```text
| # | Action                                              | Owner | Due   | Ticket  | Type     |
|---|-----------------------------------------------------|-------|-------|---------|----------|
| 1 | Add canary stage (1% → 100%) to deploy pipeline     | @sam  | 06-20 | OPS-812 | mitigate |
| 2 | CI lint: flag queries without LIMIT/pagination      | @maya | 06-23 | OPS-813 | prevent  |
| 3 | Add "check recent deploys" step to latency runbook  | @alex | 06-13 | OPS-814 | detect   |
```

Every item is owned, dated, ticketed, and classified (prevent/detect/mitigate) — and #3 closes the postmortem→runbook loop.

---

## Trick Questions

### T1. "We have runbooks for everything, so we're operationally mature." Right?

**No.** Coverage count is a vanity metric and can signal *operational debt* (you're documenting problems you should automate or fix). Maturity is: every *paging* alert has a *fresh, exercised* runbook, MTTR is dropping, and few incidents hit a missing/wrong runbook. A pile of stale runbooks is a liability, not maturity.

### T2. "A wrong runbook is still better than nothing." Agree?

**No — a stale, wrong runbook is worse than none.** With no runbook the engineer knows they're improvising and acts carefully; a wrong runbook gives false confidence, so they run a stale/dangerous command at the moment of maximum stress. Treat freshness as a correctness property.

### T3. "The postmortem found human error, so we're done — the engineer will be more careful." Correct?

**No, on two counts.** "Human error" is the *start* of the investigation, not the conclusion — if one mistake could cause this, the systemic defect is the missing guardrail/canary/confirmation. And naming/blaming the engineer destroys candor, making future incidents *more* likely. Fix the system; keep it blameless.

### T4. "Just write "restart the service" — the on-call will figure out the rest." Fine?

**No.** It fails the 3 a.m. test: which service, which command, which host, how do you know it's needed, how do you verify? The reader is tired and may not know the system. Every step must be concrete and copy-pasteable.

### T5. "Automating a runbook is always better than keeping it as prose." True?

**Not always.** Automation wins for *frequent, mechanical, well-understood* remediations. Rare, judgement-heavy procedures are better as (well-exercised) prose — automating them is brittle and must anticipate every case. Match the form to the procedure; for judgement-heavy ones, keep them honest with game days instead.

### T6. "We're agile and ship fast, so we don't have time for postmortems." Sound?

**Dangerously wrong.** Without the postmortem feedback loop, the same incidents recur and MTTR never improves — you pay the cost repeatedly. The loop (incident → blameless postmortem → action items → better runbooks/alerts/system) is what makes shipping fast *survivable*. Use a lightweight tier for SEV-3 to keep it cheap.

---

## Behavioral Questions

### B1. Tell me about a time a runbook saved (or failed) an incident.

**Sample:** "A primary DB disk filled at 2 a.m. I wasn't on the owning team, but the alert linked a runbook that diagnosed it as a stuck replication slot, with the exact `psql` checks and a guarded drop script. I resolved it in twelve minutes without waking anyone. That experience made me a runbook evangelist — the alert→runbook link and the enforced guardrail were what made it possible for an outsider to fix it safely."

### B2. Describe a postmortem you ran or contributed to.

**Sample:** "After a latency SEV-2 from an unbounded query shipped at 100%, I wrote the postmortem: quantified impact (38k failed requests, ~30% error-budget burn), a live timeline, and *systemic* root causes — no canary, no CI check for missing LIMIT, a runbook with no "check recent deploys" step. I kept it blameless and turned each cause into an owned, dated, ticketed action item. The canary item prevented a near-identical incident two months later."

### B3. How do you keep runbooks from going stale?

**Sample:** "Three forcing functions. First, prefer executable/semi-automated steps so staleness fails in CI, not at 3 a.m. Second, game days and DR drills that *use only what's written* — a drill that finds wrong steps is a win. Third, review-after-every-incident: the incident just tested the runbook for free, so I fix what it exposed while it's fresh. And every runbook has an owner and last-verified date so unverified ones are visible."

### B4. A teammate wants to add a runbook for a page that fires nightly. What do you do?

**Sample:** "I'd ask whether we should *fix* it instead. A page that fires nightly and is 'handled by a runbook' is operational debt — a human toils every night and the doc rots. I'd push to automate the remediation, or better, fix the system (an autoscaler, a guardrail) so the page stops firing. A runbook is the lowest-value of the three responses; I reserve runbooks for rare, judgement-heavy cases."

### B5. How do you protect blamelessness as a lead?

**Sample:** "By how I handle the *first* blamed mistake — everyone is watching it. I never name an individual for punishment in a postmortem; I redirect to 'what about the system made this easy to do and hard to catch?' If a manager blames someone publicly, I address it directly, because one blame event makes people hide details for a year. Blamelessness is a behavior I model, not a checkbox on a template."

---

## Tips for Answering

1. **Lead with the 3 a.m. test** — it frames everything about why operational docs look the way they do.
2. **Keep the runbook-vs-playbook distinction crisp:** one person/one task vs. a group/an outage; the playbook links to runbooks.
3. **For postmortems, give the *mechanical* reason for blamelessness** (blame destroys information), not just the moral one — and stress owned, dated action items.
4. **Name the automation continuum** (prose → semi-auto → ChatOps → fully automated) and that staleness becomes *detectable* as you move rightward.
5. **Say "a stale runbook is worse than none"** — the false-confidence point is a strong senior signal.
6. **Know RTO vs. RPO** cold, and "an untested backup is not a backup."
7. **For metrics, name alert→runbook coverage, freshness, and MTTR** — and reject "number of runbooks" as vanity.
8. **Show the loop:** incident → postmortem → action items → better runbooks/alerts/system; and game days as the way to keep prose honest.

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)
