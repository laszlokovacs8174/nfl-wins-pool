# NFL Wins Pool

A live standings page for our 5-person NFL wins pool. Each owner drafted 6 NFL
teams; whoever's teams total the most regular-season wins wins the pool.

## Features

- **Live standings** — owners ranked by total wins across their 6 teams.
- **Games remaining** per owner (17-game regular season).
- **Current-week matchups** for every team (home/away, live/final/time).
- **Cumulative-wins chart** — weekly progress line chart per owner.
- Auto-refreshes every 5 minutes (and when you re-focus the tab).

## Viewing it

### Live (GitHub Pages)

Once deployed, the site is available at:

**https://laszlokovacs8174.github.io/nfl-wins-pool/**

It's a pure static site — the browser fetches data directly from ESPN's public
API (those endpoints send permissive CORS headers), so no server is needed.
### Locally

No dependencies required — just Python 3.


