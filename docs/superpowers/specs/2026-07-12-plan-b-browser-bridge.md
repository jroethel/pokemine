# Pokemine - Plan B: Browser Bridge Provider

Date: 2026-07-12
Status: captured direction, not scheduled. Build only if API costs ever matter.

## Idea

Instead of the paid Gemini API, generate images through the consumer Gemini web app (already covered by the Google Pro AI plan) by driving a Brave tab.
This is not a separate app.
It is a fourth image provider (`bridge`) behind the same `generate()` interface in Plan A.

## Contract (job queue via files)

The provider and the driver share a folder (can live in the Drive-synced `DATA_DIR`):

```
<DATA_DIR>/bridge-jobs/
  <job-id>.json     # { prompt, referencePng (path, optional), createdAt }
  <job-id>.png      # written by the driver when fulfilled
  <job-id>.error    # written by the driver on failure
```

`bridge.generate()` writes the job JSON, then polls for the PNG (timeout ~120s).
Any driver can fulfill jobs; the app never knows or cares which:

- An agent session (Claude Code with browser MCP until 2026-08-05, GLM 5.2 in the Claude Code harness after) watching the folder and puppeting gemini.google.com.
- A hand-rolled Brave extension: content script on gemini.google.com, local app posts jobs to it.
- A human doing it manually (works today, zero code).

## Assessment (why this is not Plan A)

| Factor      | API (Plan A)          | Bridge (Plan B)                            |
|-------------|-----------------------|--------------------------------------------|
| Cost        | ~$0.034/image         | "Free" quota, but agent tokens per image    |
| Latency     | 10-25s                | 45s+                                        |
| Reliability | API contract          | DOM scraping; breaks on Google UI changes   |
| ToS         | Clean                 | Automating consumer app violates Google ToS |
| Autonomy    | Runs unattended       | Needs a live driver whenever the kid plays  |

At realistic usage (~200 images/month) the API costs about $7/month.
The bridge trades that for fragility that fails mid-session on an excited kid.

## What Plan A already absorbed from this idea

- Google Drive-synced folder as the data directory (storage and backup).
- The `bridge` provider stub and job-folder contract above, so a future session can build a driver without touching the app.

## If built later, start with

1. The Brave extension driver (no agent tokens, survives Aug 5), not the agent driver.
2. Reference-image jobs: upload `referencePng` into the Gemini tab before prompting; consumer Gemini supports image-conditioned edits.
3. A visible "bridge driver connected" indicator in the app footer, so failures are diagnosed before generating, not after.
