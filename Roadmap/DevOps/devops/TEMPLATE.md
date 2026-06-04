# DevOps Roadmap — Universal Template

> Replace `{{TOPIC_NAME}}` with the specific DevOps concept being documented.
> Each section below corresponds to one output file in the topic folder.

---

## Universal Requirements
- 9 output files per topic: junior.md, middle.md, senior.md, professional.md, interview.md, tasks.md, find-bug.md, optimize.md, specification.md
- Keep {{TOPIC_NAME}} placeholder throughout
- Include Mermaid diagrams in each template
- All content must be written in English
- Table of Contents: REQUIRED on the four level files (`junior.md`, `middle.md`, `senior.md`, `professional.md`) as a numbered TOC linking each section; OPTIONAL on practice files (`tasks.md`, `find-bug.md`, `optimize.md`)
- Depth / length: each level file (junior/middle/senior/professional) is substantial — target at least ~520 lines of genuine content (no filler), with multiple worked code examples, at least one Mermaid diagram, and at least one comparison table where the topic allows
- Level handoff: every level file ends with a "**Next step:**" line linking to the next level in the progression (junior → middle → senior → professional → …)

### Topic Structure

```
XX-topic-name/
├── junior.md          ← "What?" and "How?"
├── middle.md          ← "Why?" and "When?"
├── senior.md          ← "How to optimize?" and "How to architect?"
├── professional.md    ← "Under the Hood" — DevOps platform internals
├── interview.md       ← Interview prep across all levels
├── tasks.md           ← Hands-on practice tasks
├── find-bug.md        ← Find and fix bugs in code (10+ exercises)
├── optimize.md        ← Optimize slow/inefficient code (10+ exercises)
└── specification.md   ← Official spec / documentation deep-dive
```

---

# TEMPLATE 1 — `junior.md`

## {{TOPIC_NAME}} — Junior Level

### What Is It?
Explain `{{TOPIC_NAME}}` to a developer who writes application code but has not yet
been responsible for deploying or operating it. Focus on the "why" — what problems
exist when developers and operations are separate, and how DevOps practices solve them.

### Core Concept

```yaml
# Minimal CI pipeline demonstrating {{TOPIC_NAME}}
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Build
        run: npm run build
```

### Mental Model
- DevOps removes the wall between "I built it" and "I run it."
- Automation replaces manual, error-prone steps.
- Fast feedback loops: detect problems in minutes, not days.
- `{{TOPIC_NAME}}` fits the DevOps model because: _[fill in]_.

### Key Terms
| Term | Definition |
|------|-----------|
| CI | Continuous Integration — automatically build and test on every commit |
| CD | Continuous Delivery/Deployment — automatically deliver software to a target environment |
| Pipeline | A sequence of automated steps: build → test → scan → deploy |
| Artifact | A versioned, immutable output of a build (Docker image, JAR, npm package) |
| Infrastructure as Code (IaC) | Defining infrastructure in version-controlled files (Terraform, Pulumi) |
| Observability | The ability to understand system behavior from its outputs (logs, metrics, traces) |

### Comparison with Alternatives
| Approach | Feedback Speed | Reliability | Collaboration | Maturity |
|----------|--------------|------------|--------------|---------|
| Manual deploy (FTP, SSH) | Days | Low | None | Low |
| Jenkins (self-hosted) | Minutes | Medium | Medium | High |
| GitHub Actions | Minutes | High | High | High |
| GitLab CI | Minutes | High | High | High |
| ArgoCD (GitOps) | Seconds–Minutes | Very High | High | High |

### Common Mistakes at This Level
1. Committing environment-specific config (passwords, API keys) to the repository.
2. Not pinning dependency versions — "works on my machine" breaks the pipeline.
3. Running tests only locally and assuming CI will pass.
4. Treating the pipeline as someone else's problem.

### Hands-On Exercise
Set up a GitHub Actions workflow for a simple Node.js or Python application. The
pipeline should: install dependencies, run linting, run unit tests, and produce a
build artifact. Trigger it on every pull request to `main`.

---

# TEMPLATE 2 — `middle.md`

## {{TOPIC_NAME}} — Middle Level

### Prerequisites
- Has set up a basic CI pipeline and understands pull request workflows.
- Familiar with Docker containers and basic Linux commands.
- Has deployed an application to a cloud environment at least once.

### Deep Dive: {{TOPIC_NAME}}

```yaml
# Multi-stage CI/CD pipeline with Docker build and push
name: Build and Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run unit tests
        run: docker compose run --rm app npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4
      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=,format=short
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy to staging
        run: kubectl set image deployment/app app=${{ needs.build.outputs.image-tag }} --namespace=staging
```

### Docker Multi-Stage Builds

```bash
# Dockerfile — multi-stage build reduces final image size
# Stage 1: build (includes dev dependencies, build tools)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production (only runtime dependencies + built assets)
FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

```bash
# Build and inspect size difference
docker build --target builder -t app:builder .
docker build --target production -t app:prod .
docker image ls app  # compare sizes — production should be 2–10x smaller
```

### Secrets Management

```yaml
# NEVER hardcode secrets in pipeline files
# BAD:
- name: Deploy
  run: |
    export DB_PASSWORD=my-secret-password  # WRONG — visible in logs + git history

# GOOD: Use GitHub Actions secrets
- name: Deploy
  env:
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: |
    ./deploy.sh  # script reads DB_PASSWORD from environment
```

```bash
# Rotate secrets regularly with a secrets manager
# AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager
# Pipeline fetches secrets at runtime, not at build time
```

### Middle Checklist
- [ ] Multi-stage Docker build; final image has no dev dependencies.
- [ ] Secrets in secrets manager; none hardcoded in YAML or code.
- [ ] Pipeline stages independent; test failure blocks deploy.
- [ ] Image tags are immutable SHA-based, not `latest`.

---

# TEMPLATE 3 — `senior.md`

## {{TOPIC_NAME}} — Senior Level

### Responsibilities at This Level
- Design the end-to-end CI/CD platform for multiple teams.
- Define deployment strategies (blue-green, canary, feature flags).
- Own observability stack: metrics, logs, traces, alerting.
- Lead incident response; conduct blameless post-mortems.

### Deployment Strategies

```mermaid
graph LR
    subgraph Blue-Green
        LB1[Load Balancer] -->|100% traffic| Blue[Blue v1.2]
        LB1 -.->|0% traffic| Green[Green v1.3]
        Note1["Switch: LB routes 100% to Green"]
    end

    subgraph Canary
        LB2[Load Balancer] -->|95%| Stable[Stable v1.2]
        LB2 -->|5%| Canary[Canary v1.3]
        Note2["Increment: 5% → 25% → 50% → 100%"]
    end
```

```yaml
# Argo Rollouts canary strategy
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: app-rollout
spec:
  replicas: 10
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 5m }   # observe error rate
        - setWeight: 30
        - pause: { duration: 5m }
        - setWeight: 60
        - pause: { duration: 5m }
        - setWeight: 100
      analysis:
        templates:
          - templateName: error-rate-check
        startingStep: 1
        args:
          - name: service-name
            value: app-canary
```

### GitOps with ArgoCD

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Git
    participant ArgoCD
    participant K8s as Kubernetes

    Dev->>Git: Push manifests to infra repo
    Git-->>ArgoCD: Webhook notification
    ArgoCD->>Git: Pull desired state
    ArgoCD->>K8s: Apply diff (kubectl apply)
    K8s-->>ArgoCD: Sync status
    ArgoCD-->>Dev: Slack notification: Synced ✓
```

```yaml
# ArgoCD Application definition
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/infra-repo
    targetRevision: main
    path: apps/my-app/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true        # delete resources removed from Git
      selfHeal: true     # revert manual kubectl changes
    syncOptions:
      - CreateNamespace=true
```

### Observability: The Three Pillars

```yaml
# Prometheus scrape config for metrics
scrape_configs:
  - job_name: "my-app"
    static_configs:
      - targets: ["my-app-service:8080"]
    metrics_path: /metrics
    scheme: http
```

```bash
# Structured log format — parseable by log aggregators (Loki, ELK)
# Application should emit JSON logs
{
  "timestamp": "2025-11-01T14:23:01Z",
  "level": "error",
  "service": "checkout-api",
  "trace_id": "7f8a9b12-4c3d",
  "message": "Payment gateway timeout",
  "duration_ms": 5001,
  "user_id": "usr_abc123"
}
```

### Senior Checklist
- [ ] Deployment strategy documented: blue-green for zero-downtime, canary for risk-sensitive changes.
- [ ] Rollback tested quarterly: rollback must complete in < 5 minutes.
- [ ] Observability: every service emits structured logs, metrics (RED method), and traces.
- [ ] SLOs defined; alerting fires on error budget burn rate, not raw error counts.
- [ ] Incident runbooks exist for top 5 failure scenarios; reviewed after every incident.

---

# TEMPLATE 4 — `professional.md`

## {{TOPIC_NAME}} — Infrastructure Internals

### Overview
This section covers how CI/CD infrastructure works internally: the pipeline scheduling
engine, the GitOps reconciliation loop, artifact registry architecture, and pipeline
execution mechanics. Understanding these internals allows engineers to optimize build
systems, diagnose pipeline failures, and design self-service platforms for large
engineering organizations.

### CI/CD Pipeline Execution Internals

```mermaid
flowchart TD
    Trigger[Git Push / PR] --> Webhook[Webhook Receiver]
    Webhook --> Queue[Job Queue]
    Queue --> Scheduler[Scheduler]
    Scheduler --> Runner[Available Runner]
    Runner --> Executor[Job Executor]
    Executor --> Workspace[Workspace Setup]
    Workspace --> Steps[Execute Steps in Order]
    Steps --> Artifacts[Upload Artifacts]
    Artifacts --> Notify[Notify via Webhook/API]
    Notify --> Report[Status Check on PR]
```

```bash
# GitHub Actions runner internals:
# - Each job: isolated VM (hosted) or container (self-hosted).
# - Steps within a job share filesystem, env vars, process namespace.
# - Jobs do NOT share state unless artifacts are explicitly uploaded/downloaded.
# Parallelism: jobs run in parallel unless "needs:" declares a dependency.
jobs:
  lint:        # runs in parallel with test
    ...
  test:        # runs in parallel with lint
    ...
  build:
    needs: [lint, test]  # waits for both; inherits their outputs
```

### GitOps Reconciliation Loop

```mermaid
graph TD
    Git[Git Repository - Desired State] -->|Poll every 3 min / Webhook| Operator[GitOps Operator]
    Cluster[Kubernetes Cluster - Actual State] -->|Read| Operator
    Operator --> Diff{Diff: desired vs actual}
    Diff -->|Drift detected| Apply[Apply desired state]
    Diff -->|No drift| Idle[Stay idle]
    Apply --> Cluster
    Apply --> Event[Emit event / alert]
```

```bash
# ArgoCD reconciliation internals:
# 1. 3-way diff: Git manifest vs live object vs last-applied annotation.
# 2. Applies diff via server-side apply (kubectl apply --server-side).
# 3. Retry: exponential backoff, max 5 retries → OutOfSync.
# 4. Health: waits for Deployment rollout before marking Synced.
# ApplicationStatus.Sync.Status: Synced | OutOfSync | Unknown
# ApplicationStatus.Health.Status: Healthy | Degraded | Progressing | Missing
```

### Artifact Registry Architecture

```mermaid
graph LR
    Build[CI Build] -->|Push image| Registry[Container Registry]
    Registry -->|Replicate| RegionA[Region A Mirror]
    Registry -->|Replicate| RegionB[Region B Mirror]
    Scanner[Trivy / Snyk] -->|Scan on push| Registry
    Policy[OPA / Admission Controller] -->|Allow only scanned images| K8s[Kubernetes]
```

```bash
# Image promotion workflow — immutable tags, no mutable 'latest' in production
# Build: tag with SHA
docker build -t registry.io/app:sha-a1b2c3d .
docker push registry.io/app:sha-a1b2c3d

# Promote: copy (not rebuild) the SHA-tagged image to environment tags
# Using crane (Google's container registry tool)
crane copy registry.io/app:sha-a1b2c3d registry.io/app:staging-20251101
crane copy registry.io/app:sha-a1b2c3d registry.io/app:production-20251101

# Never push to 'latest' in production — mutable tags break reproducibility
# Image digest is the true immutable identifier:
# registry.io/app@sha256:abc123...
```

### Pipeline Scheduling — Parallelism and Resource Constraints

```yaml
# Self-hosted runner resource allocation
# Each runner has a label pool; jobs request runners by label
jobs:
  heavy-test:
    runs-on: [self-hosted, linux, high-memory]  # requires 32 GB RAM runner
  lint:
    runs-on: [self-hosted, linux, small]        # runs on 4 GB RAM runner

# Concurrency controls — prevent parallel deploys to same environment
concurrency:
  group: deploy-production
  cancel-in-progress: false  # queue instead of cancel; important for deploys
```

```bash
# Runner autoscaling (GitHub Actions: actions-runner-controller)
# HorizontalRunnerAutoscaler scales runner pods based on pending jobs
# Scale-up: pending job enters queue → new runner pod created in < 60 s
# Scale-down: runner idle for 10 min → pod deleted
# Benefit: near-zero cost during off-hours; unlimited burst capacity
```

### Dependency Caching Internals

```yaml
# Cache layer implementation — content-addressed storage
- name: Cache node_modules
  uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
# How it works: actions/cache checks S3-compatible object storage for the key.
# HIT: downloads tar.gz and extracts. MISS: restore-keys provides partial fallback.
# After job: archives path and uploads (only if key missed).
# Target: > 80% cache hit rate for dependency install steps.
```

---

# TEMPLATE 5 — `interview.md`

## {{TOPIC_NAME}} — Interview Questions

### Junior Interview Questions

**Q1: What is the difference between Continuous Integration and Continuous Deployment?**
> Continuous Integration: automatically build and test code on every commit to catch
> integration problems early. Continuous Deployment: automatically deploy every passing
> build to production without human approval. Continuous Delivery is CD but with a
> manual approval gate before production.

**Q2: Why should secrets never be hardcoded in pipeline YAML files?**
> YAML files are stored in version control — anyone with read access to the repository
> sees the secrets. Even after deletion, secrets remain in git history. Use a secrets
> manager (GitHub Secrets, HashiCorp Vault) and inject at runtime via environment
> variables.

**Q3: What is Docker and what problem does it solve?**
> Docker packages an application and its dependencies into a container — an isolated,
> reproducible runtime environment. It solves "works on my machine" by ensuring the
> same environment is used in development, CI, and production.

---

### Middle Interview Questions

**Q4: Explain blue-green deployment and its trade-offs.**
> Blue-green: maintain two identical production environments (blue = current, green = new).
> Deploy to green; test; switch the load balancer to send 100% traffic to green.
> Rollback is instant: switch the load balancer back to blue.
> Trade-off: requires double the infrastructure cost while both environments are running.
> Also: session data on blue is lost if not externalized (sticky sessions problem).

**Q5: What is GitOps and how does it differ from traditional CD?**
> GitOps uses Git as the single source of truth for infrastructure and deployment state.
> A GitOps operator (ArgoCD, Flux) continuously reconciles the cluster to match the
> Git repository. Traditional CD: pipeline pushes changes imperatively. GitOps: operator
> pulls and applies declaratively. Key advantage: Git history is the audit log; any
> drift from Git is automatically corrected.

**Q6: How does a canary deployment reduce deployment risk?**
> A canary gradually routes a small percentage of traffic (5–10%) to the new version.
> Automated analysis monitors error rate and latency. If metrics are healthy, the
> canary weight increases. If metrics degrade, the canary is rolled back. Only a small
> fraction of users experience any issues during the analysis period.

---

### Professional / Deep-Dive Questions

**Q7: How does the ArgoCD reconciliation loop work internally?**
> ArgoCD polls or receives webhook events when the Git repository changes. It fetches
> the desired state (manifests from Git) and compares with the live state (Kubernetes
> API objects). It performs a 3-way diff (Git vs live vs last-applied). If they differ,
> it applies the desired state via server-side apply. It then watches Kubernetes events
> to track rollout progress before marking the application Healthy.

**Q8: How would you design a self-service CI/CD platform for 50 teams with different tech stacks?**
> Core principles: (1) Opinionated base templates for common stacks (Node.js, Python,
> Java) with override capability. (2) Reusable workflow/step libraries (composite actions
> or reusable workflows). (3) Self-hosted runner autoscaling (actions-runner-controller
> on Kubernetes). (4) Centralized secrets management with team-scoped access (Vault +
> dynamic secrets). (5) Fitness functions: pipeline duration < 10 min target; enforced
> via dashboard and team SLO. (6) Dedicated platform team owns the framework; product
> teams own their pipelines.

---

# TEMPLATE 6 — `tasks.md`

## {{TOPIC_NAME}} — Practical Tasks

### Task 1 — Junior: Build a Basic CI Pipeline
**Goal**: Create a working GitHub Actions pipeline for a web application.

**Requirements**:
- Trigger on push to any branch and on pull request to `main`.
- Steps: checkout, install dependencies, run linting, run unit tests.
- Fail the pipeline on any test failure; show the test summary in the PR check.
- Cache `node_modules` or equivalent between runs.

**Acceptance Criteria**:
- [ ] Pipeline runs automatically on each push.
- [ ] A deliberately broken test causes the pipeline to fail (verified manually).
- [ ] Cache restores on the second run (verify via cache hit log message).
- [ ] No secrets hardcoded; any required tokens use `${{ secrets.* }}`.

---

### Task 2 — Middle: Containerized CD Pipeline
**Goal**: Extend the CI pipeline to build and push a Docker image, then deploy to a staging environment.

**Requirements**:
- Multi-stage `Dockerfile`: builder stage and production stage.
- Pipeline builds and pushes image tagged with the Git commit SHA.
- Deploy to a Kubernetes staging namespace via `kubectl set image`.
- Run a smoke test (HTTP health check) after deploy; fail the pipeline if it fails.

**Acceptance Criteria**:
- [ ] Production Docker image size < 150 MB (multi-stage build).
- [ ] Image tag is the commit SHA (not `latest`).
- [ ] Failed smoke test rolls back the deployment automatically.
- [ ] No build secrets in the final image (verify with `docker history app:prod`).

---

### Task 3 — Senior: GitOps with ArgoCD
**Goal**: Migrate an existing imperative deployment pipeline to GitOps with ArgoCD.

**Requirements**:
- Separate infrastructure repository from application code repository.
- ArgoCD `Application` resource deploys the app from the infra repo.
- Enable `selfHeal: true` and `prune: true`.
- Implement a promotion workflow: CI pipeline updates the image tag in the infra repo
  (opens a PR or commits directly to staging branch).
- Verify: manually changing a deployment in Kubernetes is reverted within 3 minutes.

**Acceptance Criteria**:
- [ ] Manual `kubectl edit` change reverted by ArgoCD automatically.
- [ ] Deployment history visible in ArgoCD UI with commit message and author.
- [ ] Production promotion requires a PR approval in the infra repo (branch protection).
- [ ] Rollback: reverting the infra repo commit triggers a rollback deploy.

---

### Task 4 — Professional: Pipeline Performance Optimization
**Goal**: Reduce average pipeline duration from 15 minutes to under 5 minutes.

**Requirements**:
- Baseline: measure current step durations using pipeline analytics.
- Identify top 3 time-consuming steps.
- Apply: parallelization of independent steps, caching, layer optimization.
- Implement a cache hit rate metric (logged as a pipeline step output).

**Acceptance Criteria**:
- [ ] Average pipeline duration <= 5 minutes (measured over 20 consecutive runs).
- [ ] Cache hit rate >= 80% for dependency install steps.
- [ ] Parallel jobs documented: dependency graph shows which steps can run concurrently.
- [ ] Before/after timing documented in a `PIPELINE_OPTIMIZATION.md` file.

---

# TEMPLATE 7 — `find-bug.md`

## {{TOPIC_NAME}} — Find the Bug

### Bug 1: Broken Pipeline — Missing Rollback

```yaml
# BUGGY PIPELINE
name: Deploy to Production

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy new version
        run: |
          kubectl set image deployment/app app=$NEW_IMAGE --namespace=production

      - name: Run smoke test
        run: |
          sleep 30
          curl -f https://api.example.com/health

      # BUG: If smoke test fails, the pipeline fails but the deployment is NOT rolled back.
      # The broken version remains live. Engineers must manually intervene.
      # The "sleep 30" is also fragile — readiness probe timing may be longer.
```

**What is wrong?**
The pipeline fails on a bad smoke test but leaves the broken deployment running in
production. There is no automated rollback step. Engineers wake up to an alert and
must manually run `kubectl rollout undo` under pressure.

**Fix:**
```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy new version
        run: |
          kubectl set image deployment/app app=$NEW_IMAGE --namespace=production
          # Wait for rollout to complete (uses readiness probes, not sleep)
          kubectl rollout status deployment/app --namespace=production --timeout=5m

      - name: Run smoke test
        id: smoke
        run: |
          curl -f https://api.example.com/health

      - name: Rollback on failure
        if: failure() && steps.smoke.outcome == 'failure'
        run: |
          echo "Smoke test failed — rolling back"
          kubectl rollout undo deployment/app --namespace=production
          kubectl rollout status deployment/app --namespace=production --timeout=5m
```

---

### Bug 2: Hardcoded Secrets in CI Config

```yaml
# BUGGY PIPELINE — DO NOT USE
name: Deploy

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS
        run: |
          # BUG: Secrets hardcoded in pipeline YAML
          # Visible to anyone with repository read access
          # Persisted in git history forever even after deletion
          export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
          export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

      - name: Deploy to S3
        run: |
          aws s3 sync ./dist s3://my-bucket/
```

**What is wrong?**
AWS credentials are hardcoded in the YAML file. Anyone with access to the repository
(including contributors, CI system logs, git clones) can see them. They are permanently
stored in git history. If the repository is ever made public, credentials are exposed.

**Fix:**
```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    # OPTION A: GitHub OIDC (best practice — no long-lived credentials at all)
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Configure AWS via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1
          # OIDC: GitHub issues a short-lived token; AWS trusts it
          # No static credentials stored anywhere

      # OPTION B: Use GitHub Secrets (if OIDC not available)
      - name: Configure AWS via secrets
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: aws s3 sync ./dist s3://my-bucket/
```

---

### Bug 3: Mutable Image Tags in Production

```yaml
# BUGGY DEPLOYMENT
# Kubernetes deployment manifest
spec:
  containers:
    - name: app
      image: registry.io/my-app:latest  # BUG: mutable tag
```

**What is wrong?**
The `latest` tag is mutable — it can point to different image layers at different times.
If a node restarts and pulls `latest`, it may get a different (newer or even broken) image
than the one originally deployed. This breaks reproducibility: two pods in the same
deployment may run different code if `latest` was updated mid-rollout. Rollback also
fails: `latest` before and after a bad deploy point to different images but with the same tag.

**Fix:**
```bash
# Pin to immutable digest
docker build -t registry.io/my-app:sha-$(git rev-parse --short HEAD) .
docker push registry.io/my-app:sha-$(git rev-parse --short HEAD)

# Kubernetes manifest uses SHA tag
spec:
  containers:
    - name: app
      image: registry.io/my-app:sha-a1b2c3d  # immutable
      # Or even more strictly: use digest
      # image: registry.io/my-app@sha256:abc123...
```

---

# TEMPLATE 8 — `optimize.md`

## {{TOPIC_NAME}} — Optimization Guide

### Optimization 1: Pipeline Duration Reduction

**Goal**: Reduce average CI pipeline from 15 minutes to under 5 minutes.

**Diagnostic**:
```bash
# GitHub Actions: use job summaries and timing annotations
# View per-step timing in the Actions UI
# Export metrics to Datadog/Grafana for trend analysis

# Step 1: measure (before any changes)
# Document each step's p50 and p95 duration in a spreadsheet
```

```yaml
# Parallelization — run independent jobs concurrently
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint

  unit-test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:unit

  type-check:
    runs-on: ubuntu-latest
    steps:
      - run: npx tsc --noEmit

  # These three run in PARALLEL — total time = max(lint, unit-test, type-check)
  # vs sequential: lint + unit-test + type-check

  build:
    needs: [lint, unit-test, type-check]  # waits for all three
    steps:
      - run: npm run build
```

**Expected improvement**: parallelizing lint/test/type-check cuts wall-clock time by
50–70% for most projects.

---

### Optimization 2: Cache Hit Rate Improvement

```yaml
# Layered caching strategy
- name: Restore npm cache
  uses: actions/cache@v4
  id: npm-cache
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-

# Report cache status
- name: Log cache outcome
  run: |
    if [ "${{ steps.npm-cache.outputs.cache-hit }}" == "true" ]; then
      echo "CACHE_HIT=true" >> $GITHUB_STEP_SUMMARY
    else
      echo "CACHE_HIT=false" >> $GITHUB_STEP_SUMMARY
    fi

# Docker layer caching — reuse unchanged layers
- name: Build with layer cache
  uses: docker/build-push-action@v5
  with:
    cache-from: type=gha   # GitHub Actions cache backend
    cache-to: type=gha,mode=max
    push: true
    tags: registry.io/app:${{ github.sha }}
```

**Metric to track**: Cache hit rate per week. Target: >= 80%. Low hit rate often indicates lockfiles changing more frequently than dependencies.

---

### Optimization 3: Parallel Test Execution

```bash
# Split tests across multiple runners using test sharding
# Jest example: run 4 parallel shards
# shard 1/4, 2/4, 3/4, 4/4 run simultaneously
```

```yaml
jobs:
  test:
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Run test shard ${{ matrix.shard }}/4
        run: npx jest --shard=${{ matrix.shard }}/4 --coverage
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-shard-${{ matrix.shard }}
          path: coverage/

  merge-coverage:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          pattern: coverage-shard-*
      - run: npx nyc merge coverage coverage/merged.json
```

**Expected improvement**: 4-shard parallelism reduces test duration by ~3.5× (Amdahl's law: some setup overhead is sequential).

### Optimization Summary Table
| Problem | Technique | Effort | Expected Gain | Metric |
|---------|-----------|--------|--------------|--------|
| Sequential jobs | Parallelize independent steps | Low | 50–70% faster | Pipeline duration |
| Slow dependency install | npm/pip cache with lock hash | Low | 2–5 min saved | Cache hit rate |
| Slow Docker build | Layer cache + multi-stage | Low | 3–10 min saved | Build step duration |
| Slow test suite | Test sharding across runners | Medium | 60–75% faster | Test step duration |
| Idle runners | Autoscaling runner pools | High | Cost reduction | Runner idle time |
| Large image size | Multi-stage Dockerfile | Low | Faster pulls | Image size MB |
---
---

# TEMPLATE 9 — `specification.md`

> **Focus:** Official documentation deep-dive — reference specs, configuration schemas, CLI reference, and version compatibility.
>
> **Source:** Always cite the official documentation with direct section links.
> - Docker: https://docs.docker.com/reference/
> - Kubernetes: https://kubernetes.io/docs/reference/
> - AWS: https://docs.aws.amazon.com/
> - Terraform: https://developer.hashicorp.com/terraform/docs
> - Linux: https://man7.org/linux/man-pages/ | https://kernel.org/doc/
> - Cloudflare: https://developers.cloudflare.com/docs/
> - DevOps: https://www.atlassian.com/devops | https://dora.dev/
> - MLOps: https://ml-ops.org/ | https://mlflow.org/docs/latest/

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Specification

> **Official Documentation Reference**
>
> Source: [{{TOOL_NAME}} Official Docs]({{DOCS_URL}}) — {{SECTION}}

---

## Table of Contents

1. [Docs Reference](#docs-reference)
2. [CLI / API Reference](#cli--api-reference)
3. [Configuration Schema](#configuration-schema)
4. [Core Rules & Constraints](#core-rules--constraints)
5. [Behavioral Specification](#behavioral-specification)
6. [Edge Cases from Official Docs](#edge-cases-from-official-docs)
7. [Version & Compatibility Matrix](#version--compatibility-matrix)
8. [Official Examples](#official-examples)
9. [Compliance Checklist](#compliance-checklist)
10. [Related Documentation](#related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [{{TOOL_NAME}} Documentation]({{DOCS_URL}}) |
| **Relevant Section** | {{SECTION_NAME}} — {{SECTION_TITLE}} |
| **Version** | {{TOOL_VERSION}} |
| **Direct URL** | {{DOCS_URL}}/{{PATH}} |

---

## 2. CLI / API Reference

> From: {{DOCS_URL}}/{{CLI_SECTION}}

### `{{COMMAND_OR_RESOURCE}}`

**Syntax:**
```
{{COMMAND_SYNTAX}}
```

| Flag / Option | Type | Required | Default | Description |
|---------------|------|----------|---------|-------------|
| `{{FLAG_1}}` | `{{TYPE_1}}` | ✅ | — | {{DESC_1}} |
| `{{FLAG_2}}` | `{{TYPE_2}}` | ❌ | `{{DEFAULT_2}}` | {{DESC_2}} |
| `{{FLAG_3}}` | `{{TYPE_3}}` | ❌ | `{{DEFAULT_3}}` | {{DESC_3}} |

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `{{CODE_N}}` | {{MEANING_N}} |

---

## 3. Configuration Schema

> From: {{DOCS_URL}}/{{CONFIG_SECTION}}

```yaml
# {{TOPIC_NAME}} configuration schema
{{CONFIG_SCHEMA_YAML}}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `{{FIELD_1}}` | `{{TYPE_1}}` | ✅ | — | {{DESC_1}} |
| `{{FIELD_2}}` | `{{TYPE_2}}` | ❌ | `{{DEFAULT_2}}` | {{DESC_2}} |

---

## 4. Core Rules & Constraints

### Rule 1: {{RULE_NAME}}

> *Docs: [{{DOCS_URL}}/{{SECTION}}]({{DOCS_URL}}/{{SECTION}}) — "{{DOC_QUOTE}}"*

{{RULE_EXPLANATION}}

```{{CODE_LANG}}
# ✅ Correct
{{VALID_EXAMPLE}}

# ❌ Incorrect
{{INVALID_EXAMPLE}}
```

### Rule 2: {{RULE_NAME}}

> *Docs: [{{DOCS_URL}}/{{SECTION}}]({{DOCS_URL}}/{{SECTION}})*

{{RULE_EXPLANATION}}

---

## 5. Behavioral Specification

### Normal Operation

{{NORMAL_OPERATION}}

### Resource Limits & Quotas

| Resource | Default Limit | Max | Notes |
|----------|--------------|-----|-------|
| {{RES_1}} | {{LIMIT_1}} | {{MAX_1}} | {{NOTES_1}} |
| {{RES_2}} | {{LIMIT_2}} | {{MAX_2}} | {{NOTES_2}} |

### Error / Failure Conditions

| Error Code | Condition | Resolution |
|-----------|-----------|------------|
| `{{ERROR_1}}` | {{COND_1}} | {{FIX_1}} |
| `{{ERROR_2}}` | {{COND_2}} | {{FIX_2}} |

---

## 6. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| {{EDGE_1}} | {{BEHAVIOR_1}} | [Docs]({{URL_1}}) |
| {{EDGE_2}} | {{BEHAVIOR_2}} | [Docs]({{URL_2}}) |
| {{EDGE_3}} | {{BEHAVIOR_3}} | [Docs]({{URL_3}}) |

---

## 7. Version & Compatibility Matrix

| Version | Change | Backward Compatible? | Notes |
|---------|--------|---------------------|-------|
| `{{VER_1}}` | {{CHANGE_1}} | {{COMPAT_1}} | {{NOTES_1}} |
| `{{VER_2}}` | {{CHANGE_2}} | {{COMPAT_2}} | {{NOTES_2}} |

---

## 8. Official Examples

### Example from Docs: {{EXAMPLE_TITLE}}

> Source: [{{DOCS_URL}}/{{ANCHOR}}]({{DOCS_URL}}/{{ANCHOR}})

```{{CODE_LANG}}
{{OFFICIAL_EXAMPLE_CODE}}
```

**Expected output:**

```
{{EXPECTED_OUTPUT}}
```

---

## 9. Compliance Checklist

- [ ] Follows official recommended configuration for {{TOPIC_NAME}}
- [ ] Uses supported version ({{TOOL_VERSION}}+)
- [ ] Handles all documented error/failure conditions
- [ ] Follows official security hardening guidelines
- [ ] Resource limits configured per official recommendations
- [ ] Monitoring/alerting set up per official guidance

---

## 10. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| {{RELATED_1}} | {{SECTION_1}} | [Link]({{URL_1}}) |
| {{RELATED_2}} | {{SECTION_2}} | [Link]({{URL_2}}) |
| {{RELATED_3}} | {{SECTION_3}} | [Link]({{URL_3}}) |

---

> **Content Rules for `specification.md`:**
> - Always link directly to the relevant doc section (not just the homepage)
> - Include official CLI/API reference tables with all flags and options
> - Document configuration schema with required/optional fields
> - Note deprecated commands and their replacements
> - Include official security hardening recommendations
> - Minimum 2 Core Rules, 3 Config fields, 3 Edge Cases, 2 Official Examples

</details>
