# INSPECTOR.md — The Inspector System (Enforcement File)

**Portable quality-enforcement system. Copy this file into any project root (or load it as a skill). It is strict by design: it exists to force real production-grade quality, not to feel good.**

Version: 1.0 · Target gate: **OVERALL ≥ 9.0/10, no angle below 8.5, zero open CRITICAL/HIGH findings.**

---

## 0. THE THREE LAWS (non-negotiable)

1. **No self-approval.** No piece of work is DONE because its author says so. Every task is inspected by an INDEPENDENT Inspector (a separate agent/context with no stake in the work) before it may be marked DONE.
2. **No evidence, no score.** Every finding, every score, every DONE stamp must cite verifiable evidence: a file:line, a failing/passing command + its output, a recomputed metric, or a recorded live check. An unsupported claim is an opinion and MUST be discarded.
3. **The loop does not end because you are tired.** Work cycles Implement → Verify → Inspect → Fix → Re-inspect until the GATE (§5) is met or an angle is formally declared EXTERNALLY-CAPPED (§7) with its residual logged. "Too hard", "almost done", and "good enough" are not termination conditions.

---

## 1. ROLES

| Role | Who | Rules |
| --- | --- | --- |
| **Implementer** | The working agent/team | Builds, self-verifies (§6 ladder), fixes findings. May NEVER grade its own work or declare the gate met. |
| **Inspector** | A FRESH independent agent (new context, no shared memory of the work) | Adversarial by mandate: its job is to BREAK the work, find gaps, and grade brutally. Must follow §4 scoring anchors. May not skip angles for time; may time-box exploration but never the report. |
| **Owner (human)** | You | Answers decision questions, provides external resources (accounts, domains, legal), accepts EXTERNALLY-CAPPED declarations. |

**Independence rules:** the Inspector must not be the same context that wrote the code. It must be instructed to be adversarial ("your job is to find what is wrong, not to confirm what is right"). The Implementer may not write any part of the Inspector's report.

---

## 2. THE LOOP

```
PLAN ──▶ INSPECT PLAN ──▶ (revise) ──▶ IMPLEMENT ──▶ SELF-VERIFY ──▶ INSPECT
   ▲                                                              │
   └────────────── auto-generated next-phase tasks ◀── FIX/FILE ◀─┘
                                                                  │
                                                  GATE MET (§5) ──▶ DONE
```

- **Plans get inspected too.** A design/feature plan goes through one Inspector round (feasibility, policy, security, simplicity, missing pieces) BEFORE implementation. Cheapest place to catch a mistake.
- **Batching:** for multi-task phases, inspecting once per phase is acceptable ONLY if each task's acceptance criteria were independently verified during the phase and the phase report covers every task. Single large tasks get their own round.
- **Regression rule:** every new round must re-verify a sample of previously-passing items. Passing today by breaking yesterday is a CRITICAL finding.
- **Pacing:** tool calls are sequential, never burst; pause between heavy steps. If any rate-limit warning appears, STOP, wait, and reduce burst size. Applies to Inspectors too.

---

## 3. FINDINGS — severity definitions

| Severity | Definition | Examples |
| --- | --- | --- |
| **CRITICAL** | Data loss, security breach, broken core flow, policy violation, or anything that would earn a refund/1-star from a real user on day one | Race that loses user data; secret leaked to logs; the main button doesn't work on the primary platform |
| **HIGH** | Real defect or gap a production review would block on | Error path unhandled; accessibility blocker; misleading output; missing tests for a risky path |
| **MEDIUM** | Works, but wrong/fragile/inconsistent in ways that accumulate | Duplicated logic that will drift; sub-AA contrast; stale docs vs code; missing feedback on an action |
| **LOW** | Polish, microcopy, minor inefficiency | Verbose copy; dead variable; missing ellipsis clamp |
| **INFO** | Observation worth recording; no action required | Noted design trade-off; acceptable residual |

**Open CRITICAL or HIGH findings = automatic gate failure**, regardless of any score.

---

## 4. SCORING — the brutal rubric

### 4.1 The scale (behavioral anchors — grade the anchor, not the effort)

| Score | Anchor — "would this survive contact with production?" |
|---|---|
| **10** | Evidence-backed perfection. Would pass a top-tier external security/quality review with zero in-repo findings. Every claim has a test, metric, or live check. Nothing left that could be done in-repo. |
| **9** | Production-ready. Only items OUTSIDE the repo (legal, third-party accounts, human manual QA on real hardware) remain. All in-repo gaps closed and verified. You would ship this to paying customers under your own name today. |
| **8** | Strong. Only LOW-severity findings open. All HIGH/CLOSED. Ship-after-a-cleanup-pass. |
| **7** | Solid core, but MEDIUM issues are open (inconsistencies, gaps that accumulate). Needs a focused pass. |
| **6** | Functional, but HIGH issues exist or a whole quality dimension is thin (e.g., no error-path tests). |
| **5** | Happy path works; edges, failures, and polish are genuinely missing. Not production. **This is the DEFAULT starting score — every point above 5 must be earned with evidence, every point below 5 proven with a finding.** |
| **4** | Significant deficiencies in this dimension. |
| **≤3** | Broken, unsafe, or absent. |

**Anti-inflation rules:**
- Start every angle at 5.0. Move up only by citing evidence; move down by citing findings.
- A **10 is forbidden** while any in-repo improvement of that angle can be named — name it or justify why none exists.
- **If you would not pay for this product / sign your name on this release, it is not a 9.**
- Scores without evidence citations are INVALID — the report must be regenerated.
- At most ONE sentence of praise per report. The report's job is findings.

### 4.2 Standard angles (software product preset)

Grade ALL of these (add project-specific angles as needed; never drop below 8 angles):

1. **Security & Privacy** — authN/Z, secrets handling, injection, data-at-rest/in-transit, least privilege, threat model honesty
2. **Correctness & Functionality** — does it do what it claims, including error paths, concurrency, edge cases, data integrity
3. **Architecture & Code Quality** — separation, consistency, dead code, drift between docs and code
4. **Testing & QA** — coverage of RISK (not %), error paths, concurrency, property/fuzz where warranted, regression safety
5. **UX / UI / Design** — layout, states (loading/empty/error), feedback, copy, visual consistency (use DESIGN.md-style contract if present)
6. **Accessibility** — WCAG AA contrast (computed, not guessed), semantics, keyboard, screen reader, reduced motion
7. **Performance** — real bottlenecks at realistic scale, bundle/startup, memory, caching honesty
8. **Release & Distribution Readiness** — packaging, versioning, checklists, store/market/pipeline compliance
9. **Documentation** — accuracy vs code (drift is a finding), onboarding a new engineer, ADRs for decisions
10. **Maintainability & Robustness** — failure behavior under bad input/corruption/outage, observability, recovery

**Project-type presets:** CLI/library → swap 5/6 for "CLI ergonomics/API ergonomics"; data pipeline → add "Data correctness & idempotency"; anything with money → add "Money correctness" (double-charging, rounding, refunds).

---

## 5. THE GATE (termination condition)

The loop may stop ONLY when ALL of these hold:

- [ ] OVERALL ≥ **9.0** (mean of angles, computed to one decimal)
- [ ] No angle < **8.5**
- [ ] Zero open CRITICAL/HIGH findings
- [ ] Every angle's score cites evidence from the CURRENT round
- [ ] Regression sample from previous rounds still passes
- [ ] Every task row is DONE with evidence, or explicitly EXTERNALLY-CAPPED (§7)

Otherwise: the Inspector generates the next phase's task list (§8) and the loop continues.

---

## 6. VERIFICATION LADDER (what counts as evidence)

Weakest → strongest. The Inspector states which level each claim sits at:

1. "I read the code and it looks right" — **NOT evidence** (may support a finding's context only)
2. Typecheck / lint clean
3. Automated test suite green (name the count and files)
4. Specific new tests proving the specific behavior (name them)
5. Production build artifact produced and structurally checked
6. **Live check**: the real artifact running in the real target environment, driven end-to-end, with recorded output
7. External validation: store review approval, real user/hardware QA, third-party audit

Rule: **anything shippable must have level-6 evidence for its core flows** before the Release angle may exceed 8.

---

## 7. EXTERNALLY-CAPPED ANGLES (honest way off the treadmill)

Some angles cannot reach 9+ from inside the repo (store review, legal sign-off, real-device QA). To close such an angle:

- The Inspector must explicitly declare it `EXTERNALLY-CAPPED`, name the external dependency, and record the residual in the project's task ledger.
- The angle's score then grades **execution within repo control** — but the OVERALL still reports the capped angle's raw score with a `(capped: <dependency>)` tag.
- Silently dropping an angle, or capping something that IS achievable in-repo, is a CRITICAL process violation.

---

## 8. SELF-IMPROVEMENT MECHANISM (how the loop improves until the gate)

1. **Quality Ledger** — maintain `TASK_TRACKING.md` (or `QUALITY_LEDGER.md`) with: every task (ID, acceptance criteria, status, verification evidence), every Inspector round (date, scores per angle, overall, findings summary), and every EXTERNALLY-CAPPED item. Scores per angle over rounds = the improvement curve.
2. **Findings feed tasks** — every Inspector finding becomes a next-phase task with acceptance criteria and its own verification method. Nothing is "noted" without an owner.
3. **Regression sampling** — each round re-verifies ≥3 previously-passing items; failures are CRITICAL.
4. **Rubric amendment** — the scoring anchors may be tightened at any time; loosening them requires recording who/why/when in this file's changelog. (Anchors only ever ratchet up.)
5. **Checklist growth** — each round's "new issues introduced" section becomes standing checklist items for future rounds (e.g., "did async work hold the lock across network calls?").

---

## 9. INSPECTOR REPORT — required format

```
## Findings — numbered; SEVERITY; file:line; what; why it matters to a user; concrete fix
## New issues introduced this round — (or "none found") — catches fix-regressions
## DESIGN/STANDARD violations — where code contradicts the project's own written standards
## Test blind spots — what is untested that matters + the test you would write
## Scores — table: angle | score | one-line evidence-backed justification
## OVERALL — X/10
## Next phase — ordered tasks, each with acceptance criteria + verification method
## Verdict — GATE MET / CONTINUE (with the exact remaining list, split in-repo vs external)
```

---

## 10. HARD-FAIL TRIGGERS (instant gate failure, any score)

- A test was deleted, skipped, or its assertions weakened to make the suite pass
- A finding was closed without the acceptance criteria being met
- The Inspector's independence was violated (self-review, shared context)
- Evidence was fabricated, copied from a previous round, or not reproducible
- A CRITICAL/HIGH finding was reclassified to lower severity without new fix evidence
- Secrets, keys, or user data appear in code, logs, tests, or telemetry
- The score improved while the regression sample got worse

---

## 11. INSTANTIATION CHECKLIST (for a new project)

1. Copy this file to the project root.
2. Fill in: project type preset (§4.2), any extra angles, the project's verification ladder specifics (§6), and the target gate if stricter than 9.0.
3. Create the Quality Ledger with the task board.
4. Write the project's standard contracts the Inspector will audit against (e.g., DESIGN.md, SECURITY.md, COMPLIANCE.md) — an Inspector needs written standards, otherwise "inconsistent" means nothing.
5. Reference this file from AGENTS.md / CLAUDE.md / system prompt: *"All work follows INSPECTOR.md. The gate in §5 is the only definition of done."*

---

## CHANGELOG

- 1.0 — Extracted from the AI Keychain project system (3 Inspector rounds, 6.8 → 9.2 overall; UI/UX 5 → 9.4) and generalized. Gate set to 9.0/8.5 per owner requirement.
