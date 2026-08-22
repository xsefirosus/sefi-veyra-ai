# Human checkpoint ready - Phase 3 Quiet Glass (step 18)

Branch claude/meeting-transcription-ai-app-k8t8hy HEAD 2376dc6 (agent-half verification gate).

Automated gate PASSED all 8 agent-checkable Done Criteria (state/phase3-quietglass-verify.md):
- npm test 332 passed / 0 failed (baseline 221)
- data-theme light/dark scopes verified via grep
- persona parsing research verified (mammoth/unpdf pure-JS)
- persona pipeline via real fixtures proven (not mocked)
- overlay opacity/stealth pure-logic + IPC plumbing proven, win32 screenshots PENDING with caveat
- VEYRA_TEST_SUGGESTIONS seam via real SUGGESTION_EVENT_CHANNEL proven via unit/integration (win32 CDP screenshots PENDING)
- No CaptureSession/wlk-server/context-parser/transcript-reducer regressions

Per plan, step 18 human half CANNOT be delegated and remains [ ] in state/plan-veyra-phase3-quietglass.md.
Plan is NOT complete without your record here, regardless of automated green.

Please do the live call scenario and append observations below, then tell agent Start listening is ready so it can mark step 18 [x]:

1. Upload real resume file (.pdf or .docx) through Settings - Your background (uses new PersonaPanel picker via window.api.pickFile to parse-document to persona:save). Upload real job description in JD textarea, add additional-context files via Add a file dashed accent button. Restart app and confirm they reload from veyra-persona.json under userData.

2. Press Start listening, speak, confirm transcript tail still works under new Quiet Glass overlay (translucent glass oklch 100 percent 0 0 / 0.7 blur 6px rounded card, not old dark bar) and Growing overlay states feel right: Listening (tail), Generating (partial delta growing height + drafting micro-copy), Ready (Copy/Regenerate in red accent). Confirm persona ingestion has not broken transcription.

3. Drag opacity slider in Visibility card (Faint/Full) and confirm overlay BrowserWindow measurably dims (setOpacity). Toggle stealth mode on/off and confirm overlay collapses to faint wash (oklch 100 percent 0 0 / 0.22, text 24 percent /0.7, no chrome) vs full glass chrome, in both light and dark themes.

4. Toggle theme light/dark via sun/moon pill switch in header and confirm both render legibly (red accent in both themes, pill buttons 9999px).

When done, write date + what you saw + PASS/FAIL per item below, and agent will mark step 18 complete and push.

---
Date:
Observer:
1. Persona upload + restart persistence:
2. Live transcript under Quiet Glass + Growing states:
3. Opacity slider + stealth mode (light + dark):
4. Theme toggle light/dark legibility:

Overall: PASS / FAIL
Notes:
