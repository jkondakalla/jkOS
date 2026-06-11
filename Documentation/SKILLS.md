# Skills

A high-level map of the marketable engineering skills demonstrated across the
jkOS suite. Deliberately kept broad — each entry is a competency backed by real,
shippable work in this monorepo, not a padded tag list. Each skill names where in
the codebase it is exercised so claims are verifiable.

---

### Full-Stack Web Development — TypeScript / React / Node
End-to-end product work: typed React SPAs (Vite, React Router, Zustand) backed by
Node/Express services, sharing a typed contract layer. Multiple complete apps —
a portal (ORDECK), a scheduling/board app (BeigeBoard), and a learning app
(SylibOS) — built and maintained from data model to UI.

### API & Service Design — REST, SSE, multi-runtime
RESTful JSON APIs across both Node/Express and Python/FastAPI, including
server-sent-event streaming (live deploy logs, streamed AI tokens) and
same-origin proxy patterns for clean cookie/auth flows. Comfortable choosing the
right runtime per service rather than forcing one stack.

### Authentication & Application Security
A from-scratch single-sign-on system (jkAuth): RS256 asymmetric JWTs, httpOnly
cookies with correct `SameSite`/domain scoping, bcrypt password hashing, Google
OAuth2, rate limiting, and timing-safe login. Designed true environment isolation
(separate cookie names, issuers, and auth gates per environment) so a staging
session can never act as a production session — security reasoning, not just
plumbing.

### DevOps & Self-Hosted Infrastructure
Production-style operations on owned hardware: Docker + Compose across a reverse
proxy edge (nginx) terminating TLS for multiple subdomains, running on TrueNAS
SCALE (ZFS). Diagnosed and worked around real platform constraints — overlay-on-
ZFS build failures, POSIX-ACL permission models, and bind-mount inode pinning.

### Reverse Proxy, TLS & Networking
nginx as the single edge: subdomain + path routing, `auth_request` admin gating,
lazy/variable upstreams so the edge survives backends being down, Cloudflare
origin certificates, real-client-IP restoration, and Docker-network vs host-
network service topology (including Wake-on-LAN broadcast services).

### Monorepo Architecture & Tooling
A pnpm-workspace + Turborepo monorepo with shared packages for the auth client,
auth middleware, design tokens, and types — "reference, don't duplicate" enforced
through a real package boundary, with root-context Docker builds that consume the
shared libraries cleanly.

### CI/CD & Deployment Automation
A custom deployment controller (FastAPI) that performs git-based releases with
live streamed logs, environment promotion (staging → production from a single
tested commit), and admin-gated controls — environment-specific configuration
driven entirely by deploy-time env so the shared codebase stays release-safe.

### Design Systems & Frontend Craft
A cohesive, token-driven theming system (kraft-paper / CRT aesthetic) shared
across apps, with light/dark modes, user-customizable accents and effects, and
careful attention to texture, depth, and legibility — design as an engineered
system, not per-screen CSS.

### Data & Content Pipelines
An ingestion pipeline (SylibOS CourseProcessor) that turns MIT OpenCourseWare
exports into structured, followable lessons via a graceful fallback ladder
(structured parse → heuristic → AI), deterministic cross-reference linking, and a
derived concept-tree layer — practical data engineering and NLP-adjacent work.

### AI Integration
A local-LLM gateway (LazurOS) with streaming responses and a provider abstraction
(local Ollama / hosted models), integrated into apps behind a suite-wide control
surface — applied AI engineering with attention to cost, privacy, and user
control.
