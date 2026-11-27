# Changelog

## 1.4.0 (2026-11-27)
- Model rows show localized states in priority order. A model cut off from the work split (a 5-hour or weekly window at 97 % or more, or an active rate limit) dims the row and displays no quota; Claude's coordination reserve does not. An active Claude session or a running subagent turns the corresponding row green and displays working. Available models keep their normal colors. Background Codex and Gemini bridges count toward the member executing their work.

## 1.3.0 (2026-11-27)
- Antigravity now shows two quota rows, AGY for Gemini and AGY-O for Claude and GPT. Each row shows its last used model and aligned 5-hour and weekly limits. Wide layouts list the models that share each quota.
- Turn scoring includes AGY-O and suggests using Codex or Gemini when either AGY-O window reaches 90 %.

## 1.2.0 (2026-11-26)
- English by default; the band adapts to the user's language (Claude Code `language` setting, `LANG`, Windows culture). `language` option: `auto`, `en`, `es`.
- `/team-band` command (`/estado` kept as the Spanish alias).
- README in English, with `README.es.md` in Spanish.

## 1.1.0 (2026-11-26)
- **Turn** row and "Team status" block with the quota-aware split (Claude reserve, quota about to reset, weekly brake).
- One line per background subagent, with model, task and `(via …)` bridge to Gemini or Codex.
- The **Active** row no longer disappears with several subagents: when space runs out, it hides memory.

## 1.0.0
- Claude, Codex and Gemini band with 5-hour and weekly limits, 80 % / 95 % warnings and a toggle command.
