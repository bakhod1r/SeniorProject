# God Class — Practice Tasks

Eight exercises, ordered from low-stakes to architectural. Solve them in a sandbox project; do not skip the acceptance criteria.

---

## Task 1 — Extract Responsibilities from a 1000-LOC class

**Objective.** Take the provided `UserService` (registration, authentication, mailing, billing, reporting, migration) and split it into focused services. The public API consumed by callers must keep working.

**Constraints.**
- No method may be moved without a passing test.
- Each new class must be ≤ 200 LOC and ≤ 7 public methods.
- Original `UserService` is allowed to remain temporarily as a `@Deprecated` facade.

**Acceptance criteria.**
- PMD `GodClass` rule passes on every new class.
- `mvn test` is green at each commit (use a sequence of small commits).
- LCOM4 for every new class equals 1.
- No new class imports both `javax.mail` and `java.sql`.

### Worked solution sketch (Task 1)

1. **Inventory.** List every method of `UserService` and mark the fields each touches.

   ```
   register, login, resetPassword           -> userRepo, passwordHasher
   sendWelcomeEmail, sendPasswordReset      -> mailer, templateEngine
   chargeMonthly, refund                    -> billingGateway, invoiceRepo
   exportToCsv, renderProfilePdf            -> userRepo, reportRenderer
   migrateLegacyAccount                     -> legacyDb, userRepo
   ```

2. **Cluster.** Four clusters emerge: Auth, Mailer, Billing, Reporting, Migration.

3. **Create the new classes.** Empty shells with constructor-injected collaborators.

4. **Move one cluster.** Cut+paste `register/login/resetPassword` into `AuthService`. Update tests. Commit.

5. **Redirect via facade.**

   ```java
   @Deprecated
   public class UserService {
       private final AuthService auth;
       public UserService(AuthService auth /*, ...*/) { this.auth = auth; }
       public void register(String email, String pw) { auth.register(email, pw); }
   }
   ```

6. **Repeat** for Mailer, Billing, Reporting, Migration.

7. **Migrate callers.** Find usages of `UserService.x()` and replace with the focused service.

8. **Delete the facade** when no references remain.

---

## Task 2 — Split a God Service into Facade + Delegates

**Objective.** Given `OrderManager` (45 public methods, 1400 LOC), introduce a `OrderFacade` that delegates to specialized services without changing the external interface.

**Constraints.**
- The Facade itself must be ≤ 7 public methods (group related operations).
- Each delegate must own a clearly named slice (Pricing, Shipping, Refunds, Notifications).
- No delegate may depend on another delegate; they share only domain types.

**Acceptance criteria.**
- All existing integration tests pass without modification.
- `ArchUnit` rule "delegates do not depend on each other" passes.
- Facade methods are pure delegation — zero business logic.

---

## Task 3 — Replace static `Utils` with Focused Services

**Objective.** A `Utils` class with 80 static methods is used in 600 places. Replace it with focused, injectable services or move methods to the types that own the data.

**Constraints.**
- Use `@Deprecated` on every old static method.
- Each replacement must be a real type (class or record), not another bag of statics.
- Migration may happen module by module.

**Acceptance criteria.**
- Final commit removes `Utils.java`.
- No new class has more than 10 methods.
- Validation methods (e.g., `isValidEmail`) move into the types they validate (`EmailAddress` value object).

---

## Task 4 — Add ArchUnit Guardrails

**Objective.** Add ArchUnit rules to a real project so that a future God Class fails the build.

**Constraints.**
- Rules live under `src/test/java/.../architecture/ArchitectureTest.java`.
- Rules run as part of `mvn verify`.
- Failures must report the offending class name and the metric that tripped.

**Acceptance criteria.**
- At least four rules: LOC, public method count, CBO, no-cycles.
- Introducing a deliberate violation in a throwaway branch fails CI.
- README documents how to add a new rule.

---

## Task 5 — Add a SonarQube Quality Gate

**Objective.** Define and apply a "God-Class-Gate" on a Sonar instance so the pipeline blocks PRs that introduce God Classes.

**Constraints.**
- Use Sonar metrics: `ncloc_per_class`, `class_complexity`, `complexity_per_function`, `public_api_method_count`.
- Apply to a feature branch first, then promote to `master`.
- Document thresholds in `docs/sonar-gate.md`.

**Acceptance criteria.**
- Gate fails on a PR that adds a class > 200 LOC.
- Gate passes on the existing baseline (one-time waiver if needed).
- Sonar webhook posts the gate status to the PR.

---

## Task 6 — Refactor a God Aggregate

**Objective.** Split `Order` (currently holding shipments, invoices, refunds, support tickets) into multiple aggregates referenced by ID, with eventual consistency via domain events.

**Constraints.**
- One transaction per aggregate save — never two aggregates in one tx.
- Cross-aggregate updates flow through `DomainEventPublisher`.
- The split must be backed by a migration plan (Flyway scripts).

**Acceptance criteria.**
- Aggregates ≤ 200 LOC each.
- No foreign key crossing aggregate boundaries except by ID.
- Integration tests demonstrate eventual consistency under concurrent updates.

---

## Task 7 — Split a God DAO

**Objective.** Replace `Dao` (one class, 40 methods, six different tables) with one repository per aggregate.

**Constraints.**
- One repository interface per aggregate root.
- Reporting queries go to a separate `QueryService` — not a repository.
- No repository returns rows from a different aggregate.

**Acceptance criteria.**
- Each repository has ≤ 8 methods.
- Repositories sit behind interfaces; tests use fakes, not Mockito-wrapped JDBC.
- Reports moved to `QueryService` use read-only DTOs, not aggregate types.

---

## Task 8 — Decompose a God Controller

**Objective.** A single `ApiController` exposes 60 endpoints. Split into one controller per resource.

**Constraints.**
- Group endpoints by URI segment (`/users`, `/orders`, `/products`, `/reports`).
- Each new controller has ≤ 5 endpoints.
- Cross-cutting concerns (auth, validation) move to `@ControllerAdvice` or filters — not into the controllers.

**Acceptance criteria.**
- `ApiController.java` is deleted at the end.
- OpenAPI spec is regenerated and matches the previous public contract.
- No 5xx regression in smoke tests.

---

## Validation Table

| Task | Tool / Check                | Passing condition                                          |
|------|-----------------------------|------------------------------------------------------------|
| 1    | PMD GodClass + tests        | All new classes pass; tests green at every commit          |
| 2    | ArchUnit "no delegate→delegate" | Build passes; facade contains only delegation calls    |
| 3    | grep `import.*Utils`        | Zero matches in final commit                               |
| 4    | mvn verify                  | All ArchUnit rules execute; deliberate violation fails CI  |
| 5    | Sonar API `qualitygates/get`| God-Class-Gate active on `master`                          |
| 6    | Integration test            | Concurrent updates converge within ≤ 2 s                   |
| 7    | Static analysis             | No repository imports another aggregate's types            |
| 8    | OpenAPI diff                | Public contract unchanged after split                      |

---

**Memorize this:** Decompose by responsibility one slice at a time behind a temporary facade; never refactor a God Class in a single commit, and never refactor one without metrics and tests guarding the seams.
