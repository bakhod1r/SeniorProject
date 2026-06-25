> **What?** Modeling a problem in code means choosing how to *represent* a real-world thing — a calendar, a chess board, a user's permissions — as data your program can store and operate on. The model is the set of types, fields, and relationships you pick to stand in for reality.
> **How?** Before writing logic, you ask: "What *is* this, in data terms?" You name the entities, decide what fields they have, pick the data structure that holds them (a list? a map? a tree?), and check that the operations you need are easy to express against that shape.

---

## 1. The model comes before the code

When you sit down to solve a problem, it is tempting to start typing functions. But the functions operate on *something* — and that something is your data model. The shape of the data decides how hard or easy every function will be.

A famous line from Rob Pike's *Notes on Programming in C* captures it:

> "Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident. Data structures, not algorithms, are central to programming."

This is the junior-level lesson: **spend real thought on the data before the logic.** A good representation makes the code obvious. A bad one makes you fight every line.

### A tiny example: representing a deck of cards

Say you need to model a card. Two beginners might write:

```python
# Model A: a card is a string
card = "Q♥"

# Model B: a card is a small record
card = {"rank": "Q", "suit": "hearts"}
```

Now answer: "Is this card higher than that one?" With Model A you must *parse the string* every time — slice off the rank, look it up in an order. With Model B the rank is already a clean field you can compare. Same problem, different representation, very different code.

That is the whole idea of modeling in one example: **the representation you pick changes which questions are easy to ask.**

---

## 2. Entities, fields, and relationships

Most models are built from three things:

| Piece | Question it answers | Example (a library) |
|---|---|---|
| **Entity** | What are the "nouns"? | `Book`, `Member`, `Loan` |
| **Field** | What does each noun know about itself? | `Book.title`, `Member.name` |
| **Relationship** | How do the nouns connect? | A `Loan` links one `Member` to one `Book` |

A good first move on any problem is to **list the nouns**. They usually become your entities. Then ask what each entity needs to remember (its fields), and how they refer to each other (relationships).

```python
class Book:
    def __init__(self, isbn, title, author):
        self.isbn = isbn        # field that uniquely identifies it
        self.title = title
        self.author = author

class Member:
    def __init__(self, member_id, name):
        self.member_id = member_id
        self.name = name

class Loan:                      # the relationship, made into its own entity
    def __init__(self, book, member, due_date):
        self.book = book
        self.member = member
        self.due_date = due_date
```

Notice that the *relationship* "this member borrowed this book" became its own entity, `Loan`. That is a common and powerful move: when a connection has its own facts (a due date, a borrowed-on date), give it a name.

---

## 3. Pick the data structure that fits the question

Once you know your entities, you choose *how to store them*. The structure you pick should make your most common operation cheap.

| You mostly need to… | Good structure | Why |
|---|---|---|
| Look something up by an id | dictionary / hash map | direct lookup by key |
| Keep things in order | list / array | preserves position |
| Find "who is next" by priority | heap / priority queue | best item is always on top |
| Ask "is X in the group?" | set | fast membership test |
| Follow connections between things | graph (nodes + edges) | models links directly |

### Example: storing members so you can find one fast

```python
# Model A: a list — finding a member means scanning all of them
members = [Member(1, "Ada"), Member(2, "Linus"), Member(3, "Grace")]
def find(member_id):
    for m in members:
        if m.member_id == member_id:
            return m            # O(n): slow when there are many

# Model B: a dict keyed by id — finding a member is instant
members = {1: Member(1, "Ada"), 2: Member(2, "Linus"), 3: Member(3, "Grace")}
ada = members[1]                # O(1): direct
```

If your program constantly looks members up by id, Model B is plainly better — not because the *data* is different, but because the *shape* matches the question.

---

## 4. A model is a deliberate simplification

You will never capture *everything* about a real thing, and you should not try. A `Book` in a library app probably does not need the page count, the font, or the smell of the paper. You keep what the program needs and drop the rest.

The statistician George Box put it memorably:

> "All models are wrong, but some are useful."

For a junior, the practical version is: **decide what to capture and what to ignore, on purpose.** Don't add a field "just in case." Don't model details the program never uses. A small, focused model is easier to get right and easier to change later.

Ask two questions for every field:
1. Does any feature *read* this?
2. Does any feature *write* this?

If the answer to both is "no," the field probably should not exist yet.

---

## 5. A worked mini-model: a to-do item

Let's model a single to-do item. First the *requirements* in plain words:

- A task has a title.
- It can be **not started**, **in progress**, or **done**.
- It may have a due date (or none).

A weak model uses loose strings and booleans:

```python
# Weak: status is a free-form string, and two booleans can contradict
task = {
    "title": "Write report",
    "status": "in progres",     # typo — nothing stops it
    "is_done": False,
    "due": "tomorrow",          # not a real date
}
```

Problems: the status can be misspelled, `status` and `is_done` can disagree (what if `status == "done"` but `is_done == False`?), and `due` is not a usable date.

A stronger model uses an *enum* for the fixed set of states and a real date type:

```python
from enum import Enum
from datetime import date

class Status(Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    DONE = "done"

class Task:
    def __init__(self, title, status=Status.NOT_STARTED, due=None):
        self.title = title
        self.status = status     # can only be one of three values
        self.due = due           # a real date, or None
```

Now "done" is a single source of truth, the status can't be misspelled, and `due` is either a real `date` or clearly absent. We removed whole classes of bugs *by choosing a better representation* — not by writing more checks in the logic.

This is the seed of an idea you'll meet again at higher levels: **make bad states impossible to even write down.**

---

## 6. The structure changes which questions are even possible

It's worth seeing how the *same* facts, stored two ways, allow completely different questions. Suppose you track which students are enrolled in which courses.

```python
# Model A: each student carries a list of course names
students = {
    "ada":   ["math", "cs"],
    "linus": ["cs", "os"],
}

# Model B: enrollments as a flat list of (student, course) pairs
enrollments = [
    ("ada", "math"), ("ada", "cs"),
    ("linus", "cs"), ("linus", "os"),
]
```

Now compare the questions each shape answers easily:

| Question | Model A (student → courses) | Model B (pair list) |
|---|---|---|
| "What is Ada taking?" | instant — `students["ada"]` | scan all pairs |
| "Who is in cs?" | scan every student's list | filter pairs by course |
| "Add an enrollment" | append to a list | append one pair |
| "Is the same pair stored twice?" | hard to notice | easy to check / dedupe |

Neither is "right" — it depends on which question you ask most. The lesson is that **the representation decides the cost of every question**, so you choose it by looking at what your program needs to ask. (A relational database, by the way, stores enrollments as pairs — Model B — precisely because it can then answer *both* directions efficiently with indexes.)

---

## 7. How to tell your model is wrong (early signs)

You don't need experience to spot a struggling model. Watch for these:

- **Every feature needs a special case.** If "but for *this* kind of thing, do something different" keeps appearing, your model probably doesn't capture that kind of thing properly.
- **You keep re-parsing the same value.** Splitting a string into pieces over and over means the pieces should have been separate fields.
- **Two fields must agree but nothing enforces it.** Like `status` and `is_done` above — a sign you stored the same fact twice.
- **You can write down a value that makes no sense.** A negative age, a loan with no book, a "done" task with no completion — if the model allows nonsense, the nonsense will eventually appear.

Catching these early is cheap. Fixing a model after a thousand records and twenty features depend on it is expensive.

---

## 8. Practice the habit

For any small problem, run this checklist *before* coding the logic:

1. **List the nouns.** These are candidate entities.
2. **List the questions** the program must answer ("who borrowed book X?", "what's overdue?").
3. **Give each entity its fields** — only the ones a feature reads or writes.
4. **Name the relationships;** promote a relationship to an entity if it has its own facts.
5. **Choose structures** so the most common question is cheap.
6. **Try to write down a nonsense value.** If you can, tighten the types.

Modeling is the synthesis step where [decomposition](../01-decomposition/), [pattern recognition](../02-pattern-recognition/), and [abstraction](../03-abstraction-and-generalization/) all land in concrete data. Get the data right and, as Pike said, the algorithms tend to write themselves.

---

**See also:** [Computational thinking overview](../) · [Abstraction and generalization](../03-abstraction-and-generalization/) · [Algorithmic thinking](../04-algorithmic-thinking/) · [Roadmap home](../../README.md)
