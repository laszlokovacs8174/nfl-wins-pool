# NFL Wins Pool

A live standings page for our 5-person NFL wins pool. Each owner drafted 6 NFL
teams; whoever's teams total the most regular-season wins wins the pool.

## Features

- **Live standings** — owners ranked by total wins across their 6 teams.
- **Games remaining** per owner (17-game regular season).
- **Current-week matchups** for every team (home/away, live/final/time).
- **Cumulative-wins chart** — weekly progress line chart per owner.
- Auto-refreshes every 5 minutes (and when you re-focus the tab).

## Run locally

No dependencies required — just Python 3.

```bash
python3 server.py
```

Then open **http://localhost:8000**.

`server.py` serves the static files and proxies ESPN requests so the browser
isn't blocked by CORS.

## Data source

Records, matchups, and per-week results come from ESPN's public site API
(`site.api.espn.com`). It's unofficial and could change; if it does, the
parsing lives in a few small functions in `app.js`.

## Structure

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `styles.css` | Styling |
| `app.js` | Fetching, computation, standings + chart rendering |
| `teams.json` | The draft (owners → teams) |
| `server.py` | Local static server + CORS proxy |
