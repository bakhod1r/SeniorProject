# Python Tuples — Practical Tasks

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Tuple Statistics Calculator

**Type:** Code

**Goal:** Practice basic tuple operations: indexing, slicing, methods, and built-in functions.

**Starter code:**

```python
def tuple_stats(data: tuple[int, ...]) -> dict:
    """
    Calculate statistics for a tuple of integers.

    Return a dictionary with keys:
    - "count": number of elements
    - "sum": sum of all elements
    - "min": minimum value
    - "max": maximum value
    - "average": arithmetic mean (float)
    - "sorted": sorted tuple (ascending)
    - "unique_count": number of unique values
    - "most_common": the value that appears most often

    Do NOT use external libraries.
    """
    # TODO: Implement this
    pass


if __name__ == "__main__":
    data = (5, 3, 8, 1, 9, 2, 7, 4, 6, 3, 5, 8)
    result = tuple_stats(data)
    for key, value in result.items():
        print(f"{key}: {value}")
```

**Expected output:**
```
count: 12
sum: 61
min: 1
max: 9
average: 5.083333333333333
sorted: (1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, 9)
unique_count: 9
most_common: 3
```

**Evaluation criteria:**
- [ ] Code runs without errors
- [ ] All 8 statistics are correct
- [ ] Original tuple is not modified
- [ ] Handles empty tuple gracefully

<details>
<summary>Solution</summary>

```python
def tuple_stats(data: tuple[int, ...]) -> dict:
    if not data:
        return {
            "count": 0, "sum": 0, "min": None, "max": None,
            "average": 0.0, "sorted": (), "unique_count": 0,
            "most_common": None,
        }

    # Find most common element
    counts = {}
    for item in data:
        counts[item] = counts.get(item, 0) + 1
    most_common = max(counts, key=counts.get)

    return {
        "count": len(data),
        "sum": sum(data),
        "min": min(data),
        "max": max(data),
        "average": sum(data) / len(data),
        "sorted": tuple(sorted(data)),
        "unique_count": len(set(data)),
        "most_common": most_common,
    }


if __name__ == "__main__":
    data = (5, 3, 8, 1, 9, 2, 7, 4, 6, 3, 5, 8)
    result = tuple_stats(data)
    for key, value in result.items():
        print(f"{key}: {value}")
```

</details>

---

### Task 2: Tuple Unpacking Practice

**Type:** Code

**Goal:** Practice various unpacking patterns.

**Starter code:**

```python
def swap_first_last(t: tuple) -> tuple:
    """Swap the first and last elements of a tuple."""
    # TODO: Use unpacking to swap first and last elements
    pass


def split_at(t: tuple, index: int) -> tuple[tuple, tuple]:
    """Split a tuple at the given index into two tuples."""
    # TODO: Return (left_part, right_part)
    pass


def interleave(t1: tuple, t2: tuple) -> tuple:
    """Interleave two tuples of equal length."""
    # Example: (1, 2, 3) + ('a', 'b', 'c') -> (1, 'a', 2, 'b', 3, 'c')
    # TODO: Implement
    pass


def flatten_pairs(pairs: tuple[tuple, ...]) -> tuple:
    """Flatten a tuple of pairs into a single tuple."""
    # Example: ((1, 2), (3, 4), (5, 6)) -> (1, 2, 3, 4, 5, 6)
    # TODO: Implement
    pass


if __name__ == "__main__":
    print(swap_first_last((1, 2, 3, 4, 5)))       # (5, 2, 3, 4, 1)
    print(split_at((1, 2, 3, 4, 5), 2))           # ((1, 2), (3, 4, 5))
    print(interleave((1, 2, 3), ('a', 'b', 'c'))) # (1, 'a', 2, 'b', 3, 'c')
    print(flatten_pairs(((1, 2), (3, 4), (5, 6)))) # (1, 2, 3, 4, 5, 6)
```

**Evaluation criteria:**
- [ ] All four functions work correctly
- [ ] `swap_first_last` handles tuples of length 0 and 1
- [ ] `interleave` handles unequal lengths gracefully
- [ ] Uses tuple unpacking where appropriate

<details>
<summary>Solution</summary>

```python
def swap_first_last(t: tuple) -> tuple:
    if len(t) <= 1:
        return t
    first, *middle, last = t
    return (last, *middle, first)


def split_at(t: tuple, index: int) -> tuple[tuple, tuple]:
    return (t[:index], t[index:])


def interleave(t1: tuple, t2: tuple) -> tuple:
    result = ()
    min_len = min(len(t1), len(t2))
    for a, b in zip(t1[:min_len], t2[:min_len]):
        result += (a, b)
    # Append remaining elements
    result += t1[min_len:] + t2[min_len:]
    return result


def flatten_pairs(pairs: tuple[tuple, ...]) -> tuple:
    result = ()
    for pair in pairs:
        result += pair
    return result


if __name__ == "__main__":
    print(swap_first_last((1, 2, 3, 4, 5)))
    print(split_at((1, 2, 3, 4, 5), 2))
    print(interleave((1, 2, 3), ('a', 'b', 'c')))
    print(flatten_pairs(((1, 2), (3, 4), (5, 6))))
```

</details>

---

### Task 3: Coordinate System

**Type:** Code

**Goal:** Use tuples to represent 2D coordinates and perform geometric operations.

**Starter code:**

```python
import math


def distance(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """Calculate Euclidean distance between two points."""
    # TODO
    pass


def midpoint(p1: tuple[float, float], p2: tuple[float, float]) -> tuple[float, float]:
    """Calculate the midpoint between two points."""
    # TODO
    pass


def triangle_area(p1: tuple[float, float], p2: tuple[float, float],
                  p3: tuple[float, float]) -> float:
    """Calculate area of a triangle given three vertices using Shoelace formula."""
    # TODO
    pass


def is_inside_rectangle(point: tuple[float, float],
                        top_left: tuple[float, float],
                        bottom_right: tuple[float, float]) -> bool:
    """Check if a point is inside a rectangle."""
    # TODO
    pass


if __name__ == "__main__":
    a = (0.0, 0.0)
    b = (3.0, 4.0)
    c = (6.0, 0.0)

    print(f"Distance A-B: {distance(a, b):.2f}")          # 5.00
    print(f"Midpoint A-B: {midpoint(a, b)}")               # (1.5, 2.0)
    print(f"Triangle area: {triangle_area(a, b, c):.2f}")  # 12.00
    print(f"(2,2) in rect (0,0)-(5,5): {is_inside_rectangle((2, 2), (0, 0), (5, 5))}")  # True
    print(f"(6,6) in rect (0,0)-(5,5): {is_inside_rectangle((6, 6), (0, 0), (5, 5))}")  # False
```

<details>
<summary>Solution</summary>

```python
import math


def distance(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    x1, y1 = p1
    x2, y2 = p2
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def midpoint(p1: tuple[float, float], p2: tuple[float, float]) -> tuple[float, float]:
    x1, y1 = p1
    x2, y2 = p2
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def triangle_area(p1: tuple[float, float], p2: tuple[float, float],
                  p3: tuple[float, float]) -> float:
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    return abs((x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)) / 2)


def is_inside_rectangle(point: tuple[float, float],
                        top_left: tuple[float, float],
                        bottom_right: tuple[float, float]) -> bool:
    px, py = point
    tlx, tly = top_left
    brx, bry = bottom_right
    return tlx <= px <= brx and tly <= py <= bry


if __name__ == "__main__":
    a = (0.0, 0.0)
    b = (3.0, 4.0)
    c = (6.0, 0.0)

    print(f"Distance A-B: {distance(a, b):.2f}")
    print(f"Midpoint A-B: {midpoint(a, b)}")
    print(f"Triangle area: {triangle_area(a, b, c):.2f}")
    print(f"(2,2) in rect (0,0)-(5,5): {is_inside_rectangle((2, 2), (0, 0), (5, 5))}")
    print(f"(6,6) in rect (0,0)-(5,5): {is_inside_rectangle((6, 6), (0, 0), (5, 5))}")
```

</details>

---

## Middle Tasks

### Task 4: Named Tuple Database

**Type:** Code

**Goal:** Build a simple in-memory database using named tuples for records and tuples as composite keys.

**Starter code:**

```python
from typing import NamedTuple, Optional


class Employee(NamedTuple):
    id: int
    name: str
    department: str
    salary: float
    is_active: bool = True


class EmployeeDB:
    """Simple in-memory employee database using tuples."""

    def __init__(self) -> None:
        self._records: tuple[Employee, ...] = ()
        self._index: dict[int, int] = {}  # id -> position in _records

    def add(self, employee: Employee) -> None:
        """Add an employee to the database."""
        # TODO: Add employee and update index
        pass

    def get(self, employee_id: int) -> Optional[Employee]:
        """Get employee by ID."""
        # TODO
        pass

    def filter_by(self, department: Optional[str] = None,
                  min_salary: Optional[float] = None,
                  is_active: Optional[bool] = None) -> tuple[Employee, ...]:
        """Filter employees by criteria."""
        # TODO
        pass

    def salary_report(self) -> dict[str, tuple[float, float, float]]:
        """Return {department: (min_salary, max_salary, avg_salary)}."""
        # TODO
        pass

    def update_salary(self, employee_id: int, new_salary: float) -> Employee:
        """Update salary (create new record since tuples are immutable)."""
        # TODO
        pass


if __name__ == "__main__":
    db = EmployeeDB()
    db.add(Employee(1, "Alice", "Engineering", 95000))
    db.add(Employee(2, "Bob", "Engineering", 88000))
    db.add(Employee(3, "Charlie", "Marketing", 72000))
    db.add(Employee(4, "Diana", "Marketing", 78000))
    db.add(Employee(5, "Eve", "Engineering", 105000, is_active=False))

    print("Engineering team:")
    for emp in db.filter_by(department="Engineering"):
        print(f"  {emp.name}: ${emp.salary:,.0f}")

    print("\nSalary report:")
    for dept, (lo, hi, avg) in db.salary_report().items():
        print(f"  {dept}: min=${lo:,.0f}, max=${hi:,.0f}, avg=${avg:,.0f}")

    updated = db.update_salary(1, 100000)
    print(f"\nUpdated: {updated}")
```

<details>
<summary>Solution</summary>

```python
from typing import NamedTuple, Optional
from collections import defaultdict


class Employee(NamedTuple):
    id: int
    name: str
    department: str
    salary: float
    is_active: bool = True


class EmployeeDB:
    def __init__(self) -> None:
        self._records: tuple[Employee, ...] = ()
        self._index: dict[int, int] = {}

    def add(self, employee: Employee) -> None:
        self._index[employee.id] = len(self._records)
        self._records += (employee,)

    def get(self, employee_id: int) -> Optional[Employee]:
        pos = self._index.get(employee_id)
        return self._records[pos] if pos is not None else None

    def filter_by(self, department: Optional[str] = None,
                  min_salary: Optional[float] = None,
                  is_active: Optional[bool] = None) -> tuple[Employee, ...]:
        result = self._records
        if department is not None:
            result = tuple(e for e in result if e.department == department)
        if min_salary is not None:
            result = tuple(e for e in result if e.salary >= min_salary)
        if is_active is not None:
            result = tuple(e for e in result if e.is_active == is_active)
        return result

    def salary_report(self) -> dict[str, tuple[float, float, float]]:
        by_dept: dict[str, list[float]] = defaultdict(list)
        for emp in self._records:
            if emp.is_active:
                by_dept[emp.department].append(emp.salary)

        return {
            dept: (min(salaries), max(salaries), sum(salaries) / len(salaries))
            for dept, salaries in by_dept.items()
        }

    def update_salary(self, employee_id: int, new_salary: float) -> Employee:
        pos = self._index[employee_id]
        old = self._records[pos]
        updated = old._replace(salary=new_salary)
        records_list = list(self._records)
        records_list[pos] = updated
        self._records = tuple(records_list)
        return updated


if __name__ == "__main__":
    db = EmployeeDB()
    db.add(Employee(1, "Alice", "Engineering", 95000))
    db.add(Employee(2, "Bob", "Engineering", 88000))
    db.add(Employee(3, "Charlie", "Marketing", 72000))
    db.add(Employee(4, "Diana", "Marketing", 78000))
    db.add(Employee(5, "Eve", "Engineering", 105000, is_active=False))

    print("Engineering team:")
    for emp in db.filter_by(department="Engineering"):
        print(f"  {emp.name}: ${emp.salary:,.0f}")

    print("\nSalary report:")
    for dept, (lo, hi, avg) in db.salary_report().items():
        print(f"  {dept}: min=${lo:,.0f}, max=${hi:,.0f}, avg=${avg:,.0f}")

    updated = db.update_salary(1, 100000)
    print(f"\nUpdated: {updated}")
```

</details>

---

### Task 5: Matrix Operations with Tuples

**Type:** Code

**Goal:** Implement matrix operations using tuples of tuples (immutable matrices).

**Starter code:**

```python
Matrix = tuple[tuple[float, ...], ...]


def create_matrix(rows: int, cols: int, fill: float = 0.0) -> Matrix:
    """Create a matrix filled with a given value."""
    # TODO
    pass


def transpose(m: Matrix) -> Matrix:
    """Transpose a matrix."""
    # TODO
    pass


def add_matrices(a: Matrix, b: Matrix) -> Matrix:
    """Add two matrices element-wise."""
    # TODO
    pass


def multiply_matrices(a: Matrix, b: Matrix) -> Matrix:
    """Multiply two matrices."""
    # TODO
    pass


def print_matrix(m: Matrix, name: str = "Matrix") -> None:
    """Pretty-print a matrix."""
    print(f"{name}:")
    for row in m:
        print("  [" + ", ".join(f"{v:6.1f}" for v in row) + "]")


if __name__ == "__main__":
    a = ((1, 2, 3), (4, 5, 6))
    b = ((7, 8), (9, 10), (11, 12))

    print_matrix(a, "A")
    print_matrix(b, "B")
    print_matrix(transpose(a), "A^T")
    print_matrix(multiply_matrices(a, b), "A x B")

    c = ((1, 2), (3, 4))
    d = ((5, 6), (7, 8))
    print_matrix(add_matrices(c, d), "C + D")
```

<details>
<summary>Solution</summary>

```python
Matrix = tuple[tuple[float, ...], ...]


def create_matrix(rows: int, cols: int, fill: float = 0.0) -> Matrix:
    return tuple(tuple(fill for _ in range(cols)) for _ in range(rows))


def transpose(m: Matrix) -> Matrix:
    if not m:
        return ()
    return tuple(tuple(m[r][c] for r in range(len(m))) for c in range(len(m[0])))


def add_matrices(a: Matrix, b: Matrix) -> Matrix:
    return tuple(
        tuple(a[i][j] + b[i][j] for j in range(len(a[0])))
        for i in range(len(a))
    )


def multiply_matrices(a: Matrix, b: Matrix) -> Matrix:
    rows_a, cols_a = len(a), len(a[0])
    rows_b, cols_b = len(b), len(b[0])
    assert cols_a == rows_b, "Incompatible matrix dimensions"

    return tuple(
        tuple(
            sum(a[i][k] * b[k][j] for k in range(cols_a))
            for j in range(cols_b)
        )
        for i in range(rows_a)
    )


def print_matrix(m: Matrix, name: str = "Matrix") -> None:
    print(f"{name}:")
    for row in m:
        print("  [" + ", ".join(f"{v:6.1f}" for v in row) + "]")


if __name__ == "__main__":
    a = ((1, 2, 3), (4, 5, 6))
    b = ((7, 8), (9, 10), (11, 12))

    print_matrix(a, "A")
    print_matrix(b, "B")
    print_matrix(transpose(a), "A^T")
    print_matrix(multiply_matrices(a, b), "A x B")

    c = ((1, 2), (3, 4))
    d = ((5, 6), (7, 8))
    print_matrix(add_matrices(c, d), "C + D")
```

</details>

---

## Senior Tasks

### Task 6: Immutable Graph with Tuple Edges

**Type:** Code

**Goal:** Build an immutable graph data structure using tuples for edges and implement BFS/DFS.

**Starter code:**

```python
from typing import NamedTuple
from collections import deque


class Edge(NamedTuple):
    source: str
    target: str
    weight: float = 1.0


class Graph(NamedTuple):
    """Immutable graph represented as tuple of edges."""
    nodes: tuple[str, ...]
    edges: tuple[Edge, ...]

    @classmethod
    def from_edge_list(cls, edges: list[tuple[str, str, float]]) -> "Graph":
        """Create a graph from a list of (source, target, weight) tuples."""
        # TODO
        pass

    def neighbors(self, node: str) -> tuple[tuple[str, float], ...]:
        """Get neighbors of a node as ((neighbor, weight), ...)."""
        # TODO
        pass

    def bfs(self, start: str) -> tuple[str, ...]:
        """Breadth-first traversal from start node."""
        # TODO
        pass

    def shortest_path(self, start: str, end: str) -> tuple[tuple[str, ...], float]:
        """Find shortest path and total weight using BFS (unweighted)."""
        # TODO: Return (path_tuple, total_weight)
        pass

    def add_edge(self, edge: Edge) -> "Graph":
        """Return a new graph with the edge added."""
        # TODO
        pass


if __name__ == "__main__":
    g = Graph.from_edge_list([
        ("A", "B", 1.0), ("A", "C", 2.0), ("B", "D", 1.0),
        ("C", "D", 1.0), ("D", "E", 3.0), ("B", "E", 5.0),
    ])

    print(f"Nodes: {g.nodes}")
    print(f"Edges: {len(g.edges)}")
    print(f"Neighbors of A: {g.neighbors('A')}")
    print(f"BFS from A: {g.bfs('A')}")

    path, weight = g.shortest_path("A", "E")
    print(f"Shortest path A->E: {' -> '.join(path)} (weight: {weight})")
```

<details>
<summary>Solution</summary>

```python
from typing import NamedTuple, Optional
from collections import deque


class Edge(NamedTuple):
    source: str
    target: str
    weight: float = 1.0


class Graph(NamedTuple):
    nodes: tuple[str, ...]
    edges: tuple[Edge, ...]

    @classmethod
    def from_edge_list(cls, edges: list[tuple[str, str, float]]) -> "Graph":
        edge_tuples = tuple(Edge(s, t, w) for s, t, w in edges)
        nodes = tuple(sorted(set(
            n for e in edge_tuples for n in (e.source, e.target)
        )))
        return cls(nodes=nodes, edges=edge_tuples)

    def neighbors(self, node: str) -> tuple[tuple[str, float], ...]:
        return tuple(
            (e.target, e.weight) for e in self.edges if e.source == node
        )

    def bfs(self, start: str) -> tuple[str, ...]:
        visited: list[str] = []
        queue = deque([start])
        seen = {start}
        while queue:
            node = queue.popleft()
            visited.append(node)
            for neighbor, _ in self.neighbors(node):
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append(neighbor)
        return tuple(visited)

    def shortest_path(self, start: str, end: str) -> tuple[tuple[str, ...], float]:
        queue: deque[tuple[str, tuple[str, ...], float]] = deque()
        queue.append((start, (start,), 0.0))
        visited = {start}
        while queue:
            node, path, weight = queue.popleft()
            if node == end:
                return (path, weight)
            for neighbor, edge_weight in self.neighbors(node):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, path + (neighbor,), weight + edge_weight))
        return ((), float('inf'))

    def add_edge(self, edge: Edge) -> "Graph":
        new_edges = self.edges + (edge,)
        new_nodes = set(self.nodes)
        new_nodes.add(edge.source)
        new_nodes.add(edge.target)
        return Graph(nodes=tuple(sorted(new_nodes)), edges=new_edges)


if __name__ == "__main__":
    g = Graph.from_edge_list([
        ("A", "B", 1.0), ("A", "C", 2.0), ("B", "D", 1.0),
        ("C", "D", 1.0), ("D", "E", 3.0), ("B", "E", 5.0),
    ])

    print(f"Nodes: {g.nodes}")
    print(f"Edges: {len(g.edges)}")
    print(f"Neighbors of A: {g.neighbors('A')}")
    print(f"BFS from A: {g.bfs('A')}")

    path, weight = g.shortest_path("A", "E")
    print(f"Shortest path A->E: {' -> '.join(path)} (weight: {weight})")
```

</details>

---

### Task 7: Event Sourcing System

**Type:** Code

**Goal:** Implement a simple event sourcing system where all events are immutable named tuples.

**Starter code:**

```python
from typing import NamedTuple, Any
from datetime import datetime


class Event(NamedTuple):
    event_type: str
    aggregate_id: str
    data: tuple[tuple[str, Any], ...]
    timestamp: datetime
    version: int


class BankAccount:
    """Bank account built from event history (event sourcing)."""

    def __init__(self, account_id: str) -> None:
        self.account_id = account_id
        self._events: tuple[Event, ...] = ()
        self._balance: float = 0.0
        self._is_open: bool = False

    @property
    def events(self) -> tuple[Event, ...]:
        return self._events

    @property
    def balance(self) -> float:
        return self._balance

    def open_account(self, initial_deposit: float) -> Event:
        """Open the account with an initial deposit."""
        # TODO: Create event and apply it
        pass

    def deposit(self, amount: float) -> Event:
        """Deposit money."""
        # TODO
        pass

    def withdraw(self, amount: float) -> Event:
        """Withdraw money (raise ValueError if insufficient funds)."""
        # TODO
        pass

    def _apply(self, event: Event) -> None:
        """Apply an event to update state."""
        # TODO
        pass

    @classmethod
    def rebuild_from_events(cls, account_id: str,
                            events: tuple[Event, ...]) -> "BankAccount":
        """Rebuild account state from event history."""
        # TODO
        pass


if __name__ == "__main__":
    account = BankAccount("ACC-001")
    e1 = account.open_account(1000.0)
    e2 = account.deposit(500.0)
    e3 = account.withdraw(200.0)

    print(f"Balance: ${account.balance:.2f}")
    print(f"Events: {len(account.events)}")

    for event in account.events:
        print(f"  v{event.version}: {event.event_type} - {dict(event.data)}")

    # Rebuild from history
    rebuilt = BankAccount.rebuild_from_events("ACC-001", account.events)
    print(f"\nRebuilt balance: ${rebuilt.balance:.2f}")
    assert rebuilt.balance == account.balance
```

<details>
<summary>Solution</summary>

```python
from typing import NamedTuple, Any
from datetime import datetime


class Event(NamedTuple):
    event_type: str
    aggregate_id: str
    data: tuple[tuple[str, Any], ...]
    timestamp: datetime
    version: int


class BankAccount:
    def __init__(self, account_id: str) -> None:
        self.account_id = account_id
        self._events: tuple[Event, ...] = ()
        self._balance: float = 0.0
        self._is_open: bool = False

    @property
    def events(self) -> tuple[Event, ...]:
        return self._events

    @property
    def balance(self) -> float:
        return self._balance

    def _next_version(self) -> int:
        return len(self._events) + 1

    def open_account(self, initial_deposit: float) -> Event:
        if self._is_open:
            raise ValueError("Account already open")
        event = Event(
            event_type="AccountOpened",
            aggregate_id=self.account_id,
            data=(("initial_deposit", initial_deposit),),
            timestamp=datetime.now(),
            version=self._next_version(),
        )
        self._apply(event)
        return event

    def deposit(self, amount: float) -> Event:
        if not self._is_open:
            raise ValueError("Account not open")
        if amount <= 0:
            raise ValueError("Deposit amount must be positive")
        event = Event(
            event_type="MoneyDeposited",
            aggregate_id=self.account_id,
            data=(("amount", amount),),
            timestamp=datetime.now(),
            version=self._next_version(),
        )
        self._apply(event)
        return event

    def withdraw(self, amount: float) -> Event:
        if not self._is_open:
            raise ValueError("Account not open")
        if amount > self._balance:
            raise ValueError(f"Insufficient funds: ${self._balance:.2f} < ${amount:.2f}")
        event = Event(
            event_type="MoneyWithdrawn",
            aggregate_id=self.account_id,
            data=(("amount", amount),),
            timestamp=datetime.now(),
            version=self._next_version(),
        )
        self._apply(event)
        return event

    def _apply(self, event: Event) -> None:
        data = dict(event.data)
        if event.event_type == "AccountOpened":
            self._is_open = True
            self._balance = data["initial_deposit"]
        elif event.event_type == "MoneyDeposited":
            self._balance += data["amount"]
        elif event.event_type == "MoneyWithdrawn":
            self._balance -= data["amount"]
        self._events += (event,)

    @classmethod
    def rebuild_from_events(cls, account_id: str,
                            events: tuple[Event, ...]) -> "BankAccount":
        account = cls(account_id)
        for event in events:
            account._apply(event)
        return account


if __name__ == "__main__":
    account = BankAccount("ACC-001")
    e1 = account.open_account(1000.0)
    e2 = account.deposit(500.0)
    e3 = account.withdraw(200.0)

    print(f"Balance: ${account.balance:.2f}")
    print(f"Events: {len(account.events)}")

    for event in account.events:
        print(f"  v{event.version}: {event.event_type} - {dict(event.data)}")

    rebuilt = BankAccount.rebuild_from_events("ACC-001", account.events)
    print(f"\nRebuilt balance: ${rebuilt.balance:.2f}")
    assert rebuilt.balance == account.balance
```

</details>

---

## Questions

### Q1: What is the difference between `(1, 2, 3)` and `[1, 2, 3]` in terms of memory?

<details>
<summary>Answer</summary>

Tuples use less memory because they don't over-allocate. A list maintains extra capacity for potential growth:

```python
import sys
print(f"Tuple: {sys.getsizeof((1, 2, 3))} bytes")  # ~64 bytes
print(f"List:  {sys.getsizeof([1, 2, 3])} bytes")   # ~88 bytes
```

The difference grows with size. Lists also have an additional pointer indirection (the `ob_item` pointer to a separate array).

</details>

### Q2: Why can't you use a list as a dictionary key but you can use a tuple?

<details>
<summary>Answer</summary>

Dictionary keys must be **hashable** — they must have a stable hash value that never changes. Lists are mutable, so their content (and thus their hash) could change after being used as a key, breaking the dictionary. Tuples are immutable, so their hash is stable.

```python
hash((1, 2, 3))   # Works
# hash([1, 2, 3]) # TypeError: unhashable type: 'list'
```

</details>

### Q3: When should you use `typing.NamedTuple` vs `@dataclass(frozen=True)`?

<details>
<summary>Answer</summary>

- **`typing.NamedTuple`:** Lighter weight, IS a tuple (works with tuple operations), better for simple data records
- **`@dataclass(frozen=True)`:** Supports `__post_init__`, custom `__hash__`, `__slots__`, inheritance, and more complex logic

Use NamedTuple for simple, lightweight records. Use frozen dataclass when you need validation, methods, or inheritance.

</details>

---

## Mini Projects

### Mini Project 1: CSV to Named Tuple Report Generator

Build a tool that reads CSV data, converts each row to a named tuple, and generates summary reports with grouping and aggregation using tuple keys.

**Requirements:**
- Parse CSV into named tuples
- Group by any column using tuple keys
- Calculate min, max, average, count per group
- Output a formatted report

### Mini Project 2: Immutable Undo/Redo System

Build a text editor undo/redo system where each state is stored as a tuple of strings (lines). Operations create new state tuples rather than modifying existing ones.

**Requirements:**
- Store document state as `tuple[str, ...]` (one string per line)
- Support: insert_line, delete_line, replace_line
- Each operation returns a new state (immutable)
- Maintain undo/redo history as `tuple[State, ...]`

---

## Challenge

### Challenge: Build an Immutable JSON-like Data Structure

Create a library that converts JSON data into a fully immutable Python structure using only tuples, frozensets, strings, numbers, booleans, and None. Lists become tuples, dicts become tuples of key-value pairs.

**Requirements:**
- `freeze(data)` — convert any JSON-compatible Python structure to fully immutable form
- `thaw(data)` — convert back to normal Python dicts and lists
- `deep_get(data, *path)` — access nested values by path
- `deep_set(data, value, *path)` — return new structure with value changed at path
- All intermediate structures must be hashable

```python
# Example usage:
data = {"users": [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]}
frozen = freeze(data)
# frozen is fully hashable — can be used as dict key or set element
print(hash(frozen))

name = deep_get(frozen, "users", 0, "name")
print(name)  # "Alice"

updated = deep_set(frozen, "Charlie", "users", 0, "name")
thawed = thaw(updated)
print(thawed)  # {"users": [{"name": "Charlie", "age": 30}, ...]}
```

<details>
<summary>Solution</summary>

```python
from typing import Any


def freeze(data: Any) -> Any:
    """Convert JSON-compatible structure to fully immutable form."""
    if isinstance(data, dict):
        return tuple(sorted((k, freeze(v)) for k, v in data.items()))
    elif isinstance(data, (list, tuple)):
        return tuple(freeze(item) for item in data)
    elif isinstance(data, set):
        return frozenset(freeze(item) for item in data)
    else:
        return data  # str, int, float, bool, None are already immutable


def thaw(data: Any) -> Any:
    """Convert frozen structure back to dicts and lists."""
    if isinstance(data, tuple):
        # Check if it's a dict-like tuple of pairs
        if data and all(isinstance(item, tuple) and len(item) == 2
                        and isinstance(item[0], str) for item in data):
            return {k: thaw(v) for k, v in data}
        else:
            return [thaw(item) for item in data]
    elif isinstance(data, frozenset):
        return {thaw(item) for item in data}
    else:
        return data


def deep_get(data: Any, *path: Any) -> Any:
    """Access nested value by path."""
    current = data
    for key in path:
        if isinstance(current, tuple):
            if isinstance(key, int):
                # It's a list-like tuple
                current = current[key]
            elif isinstance(key, str):
                # It's a dict-like tuple of pairs
                for k, v in current:
                    if k == key:
                        current = v
                        break
                else:
                    raise KeyError(key)
        else:
            raise TypeError(f"Cannot traverse {type(current)}")
    return current


def deep_set(data: Any, value: Any, *path: Any) -> Any:
    """Return new structure with value changed at path."""
    if not path:
        return freeze(value)

    key = path[0]
    rest = path[1:]

    if isinstance(data, tuple):
        if isinstance(key, int):
            # List-like tuple
            items = list(data)
            items[key] = deep_set(items[key], value, *rest)
            return tuple(items)
        elif isinstance(key, str):
            # Dict-like tuple of pairs
            items = []
            found = False
            for k, v in data:
                if k == key:
                    items.append((k, deep_set(v, value, *rest)))
                    found = True
                else:
                    items.append((k, v))
            if not found:
                items.append((key, freeze(value)))
            return tuple(sorted(items))

    raise TypeError(f"Cannot set on {type(data)}")


if __name__ == "__main__":
    data = {"users": [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]}
    frozen = freeze(data)
    print(f"Frozen: {frozen}")
    print(f"Hashable: {hash(frozen)}")

    name = deep_get(frozen, "users", 0, "name")
    print(f"Alice: {name}")

    updated = deep_set(frozen, "Charlie", "users", 0, "name")
    thawed = thaw(updated)
    print(f"Updated: {thawed}")
```

</details>
