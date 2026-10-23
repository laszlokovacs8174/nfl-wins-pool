# NFL Wins Pool

A live standings and draft-analysis site for our 5-person NFL wins pool. Each
owner drafted 6 NFL teams; whoever's teams total the most regular-season wins
wins the pool.
## Features

### Standings page (`index.html`)

- **Live standings** — owners ranked by total wins across their 6 teams.
- **Games remaining** per owner (17-game regular season).
- **Max potential wins** per owner — current wins plus every remaining game,
  minus any remaining games where two of the owner's own teams play each other
  (one of them is guaranteed to lose, so those can't both become wins).
- **Current-week matchups** for every team (home/away, live/final/time).
- **Cumulative-wins chart** — weekly progress line chart per owner.
- Auto-refreshes every 5 minutes (and when you re-focus the tab).

### Draft results page (`draft.html`)

- **Hindsight leaderboard** — each owner's actual win total vs. what they
  *could* have totaled if they'd drafted the best teams still available at
  each of their picks.
- **Pick-by-pick view** — every pick in snake-draft order, showing the team
  actually taken and the best available team on the board at that slot.
- Auto-refreshes every 5 minutes.

## Data sources

All data comes from ESPN's public site API, fetched directly by the browser:

- **Current-week scoreboard** — `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- **Per-team schedule** — `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{id}/schedule`

Current W-L records and the weekly cumulative-win progression are both derived
from the per-team schedule (completed games only). These endpoints send
permissive CORS headers, so the site works as a pure static site with no
server-side proxy.

Team logos come from ESPN's public CDN (`a.espncdn.com`).

## Configuration

Edit `teams.json` to change the owners, their drafted teams, and any undrafted
teams:

- `owners` — list of `{ name, teams }`. Each owner's `teams` array is in the
  order they were picked (used for the snake-draft view in `draft.js`).
- `undrafted` — teams nobody drafted; these are still eligible to appear as
  "best available" on the draft page.

Each team is `{ name, abbr, id }`, where `id` is the ESPN team id.

## Viewing it

### Live (GitHub Pages)

Once deployed, the site is available at:

**https://laszlokovacs8174.github.io/nfl-wins-pool/**

It's a pure static site — the browser fetches data directly from ESPN's public
API, so no server is needed.
### Locally

The site is fully static, but browsers can block cross-origin requests to
ESPN from a `file://` page, so serve it over HTTP. A tiny dependency-free
Python 3 server is included (it also proxies ESPN at `/espn/...` to sidestep
any CORS issues):

