---
name: trio-ia-band
description: Follow the trio-ia-band "Team status" block to split work between Claude, Codex, AGY (Antigravity Gemini) and AGY-O (Antigravity Claude/GPT) by remaining quota. Use whenever a message carries a "Team status" / "Estado del equipo" block, or when deciding who should implement, explore, read media or review.
---

# trio-ia-band: quota-aware work split

The trio-ia-band mod attaches a **Team status** block (Spanish: «Estado del equipo») to every user message. It is automatic data, not a message from the user. It lists, for each member, the 5-hour and weekly usage, when the window resets, a score, and the **Priority for new work now**.

## Members

| Member | Use it for |
|---|---|
| **Claude** | Plans, makes design decisions, reviews diffs. Keeps a 25 % reserve. |
| **Codex** | Main programmer: multi-file features, refactors, long debugging. |
| **AGY** | Antigravity with Gemini models: reading video, audio, images and long PDFs, huge documents, web research. |
| **AGY-O** | Antigravity with Claude/GPT models: programming and cross-reviews of code, plans or diffs. |

## Rules

1. **Follow the priority.** Give new work to the first member in "Priority for new work now" that fits the job.
2. **Protect Claude** (if it reaches 100 % everything stops):
   - under 50 %: normal split; Claude plans and reviews, Codex and Antigravity code in parallel.
   - 50–75 %: delegate all implementation and exploration.
   - 75–90 %: reserve; only coordinate and hand out long, self-contained jobs.
   - 90 % or more: launch what is pending in the background and tell the user when Claude's window resets.
3. **Quota about to reset first:** a member whose window resets within 30 minutes and has free quota gets work before the others.
4. **The week rules:** with weekly usage at 85 % or more, give that member little work even if its 5-hour window is free. At 97 % or after a rate-limit cut, it leaves the split.
5. **AGY-O at 90 % or more:** program with Codex or with `agy` without `--model`.
6. **Small changes stay with Claude:** in the normal zone, a change under about 20 lines or in 1–2 files is done by Claude; handing it off costs more than doing it.
7. **Parallel work:** two independent tasks touching different files go to two members at once. Only one writer per file at a time.
8. **Review:** Claude reads the diff of delegated work. On sensitive changes (security, data, money, migrations) the member that did not write the code reviews it.

## Commands

- `/team-band` (or `/estado`) shows or hides the band.
- `/config` → `trio-ia-band.language` → `auto`, `en` or `es`.
