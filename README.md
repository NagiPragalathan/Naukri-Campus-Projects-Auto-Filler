# Naukri Campus – Projects Auto Filler

Chrome (MV3) extension that bulk-fills the **Projects** section of your Naukri Campus profile
(`naukri.com/mnjuser/profile`) from a JSON list. It drives the site's real UI — clicks **Add**,
fills the modal, picks the month/year dropdowns, resolves key skills through the suggestor,
and clicks **Save** — so all of Naukri's own validation still applies.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Pin the extension

## Use

1. Open your profile: `https://www.naukri.com/mnjuser/profile` → **View & Edit** tab
2. Click the extension icon. The pill at the top should read **profile page ready**
3. The 5 projects are pre-loaded — edit the JSON if you want, then **Start filling**
4. Watch the log in the popup or the on-page overlay (bottom-right). **Stop** halts after the current field

Don't switch tabs or interact with the page while it runs — the modal needs focus.

## JSON shape

```json
{
  "project_name": "Kalinga University Website Backend",   // <= 100 chars
  "duration": "Jun 2024 to Dec 2024",                     // parsed into 4 dropdowns
  "description": "…",                                     // 10–1000 chars
  "key_skills": "Python, Django, REST APIs",              // string or array
  "project_url": "https://kalingauniversity.ac.in/"       // optional
}
```

Instead of `duration` you may pass explicit fields:
`start_month`, `start_year`, `end_month`, `end_year` (month as `Jan` / `January` / `1`).

## What it does under the hood

| Step | Selector it drives | Notes |
|---|---|---|
| Open modal | `.projectsDetails .add-more` | waits for `#projectsDetails_Modal` to become visible |
| Name | `input[id^="title"]` | native value setter + `input`/`change`/`blur` so MNJ validation fires |
| Duration | `input[name$="_start_month"]` … | clicks the `.ddInput`, waits for `.dropdownPrimary` to populate, clicks the matching option; falls back to writing the visible input **and** its hidden `…Id` twin |
| Description | `textarea[id^="details"]` | trimmed to 1000, char counter updates |
| Key skills | `#keySkillSugg` | see **How a skill gets added** below |
| URL | `input[id^="url"]` | optional |
| Save | `#submit-btn` | waits for `disabled` to clear; if it never does, reports the `.erLbl` messages and moves on |

Element ids are indexed by Naukri (`title1`, `title2`, …), so everything is matched by
prefix/suffix **inside the open modal** rather than by hard-coded index.

## How a skill gets added

The suggestor is debounced and network-backed, so it is treated as slow and unreliable:

1. Type the skill one character at a time — `keydown` → `keypress` → `InputEvent(insertText)` → `keyup`
   (70 ms apart), so the site's own key handlers fire exactly as they would for a human.
2. Wait `settleDelay` (700 ms) for the debounce, **then** poll up to **Skill suggestor wait**
   (default 9 s) for options. Only options whose text starts with what was typed count — leftover
   suggestions from the previous skill are ignored instead of being clicked by mistake.
3. Still nothing? Backspace the last character and retype it to re-arm the debounce, then wait
   another 60 % of the window.
4. Options found → click exact match, else prefix match, else the first relevant one, and confirm a
   chip actually appeared. If the picked label differs from what you typed
   (`REST APIs` → `Rest Api`) the log says so.
5. **No suggestion at all → click out of the field.** Blur + `focusout` + a click on the skills
   label; Naukri commits the typed text into a chip on its own. Verified by chip count.
6. Still no chip → press Enter. Still nothing → clear the field, log the skill as skipped, and carry
   on. A rejected skill never blocks the project from saving.

Bump **Skill suggestor wait** to 15 s and **Speed** to *Safe / slow* if suggestions are still
missed — *Safe / slow* now doubles every timeout, not just the pauses.

## Behaviour notes

- **Skip existing** (on by default) compares each `project_name` against the cards already on
  the profile using word-overlap, so `Remo College AI Chatbot - RAG Admissions Assistant`
  matches the existing `Remo College AI Chatbot (RAG-based Admissions Assistant)` and is skipped.
  Uncheck it to add duplicates anyway.
- A skill the suggestor refuses (no dropdown match, free text rejected) is logged and skipped —
  the project is still saved.
- A project that fails closes the modal and the run continues with the next one; the summary
  line at the end reports added / skipped / failed.
- **Speed**: use *Safe / slow* if the suggestor or dropdowns lag on your connection.

## Files

- `manifest.json` — MV3 manifest, `https://*.naukri.com/*`
- `content.js` — the automation engine + on-page overlay
- `popup.html` / `popup.css` / `popup.js` — control panel
- `default-data.js` — the 5 projects preloaded into the popup
- `projects.json` — same data as a standalone file
