// Weekly scoreboard page: shows this week's games with each team's pool owner.
// Data comes from the same CORS-friendly ESPN scoreboard endpoint the standings
// page uses. Supports browsing to other weeks via prev/next controls.

const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SCOREBOARD_URL = (week, seasonType) => {
  const params = new URLSearchParams();
  if (week != null) params.set("week", week);
  if (seasonType != null) params.set("seasontype", seasonType);
  const qs = params.toString();
  return `${ESPN_BASE}/scoreboard${qs ? "?" + qs : ""}`;
};

const logoUrl = (abbr) =>
  abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` : "";

// Keep in sync with draft.js owner colors.
const OWNER_COLORS = {
  Phil: "#3fa9f5",
  Ken: "#f5c542",
  Rick: "#3ddc84",
  Matt: "#ff6b6b",
  Juan: "#b98cf5",
};

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const updatedEl = document.getElementById("updated");
const refreshBtn = document.getElementById("refreshBtn");
const boardEl = document.getElementById("scoreboard");
const weekTitleEl = document.getElementById("weekTitle");

let pool = null; // loaded teams.json
let ownerByTeamId = {}; // teamId -> owner name
let teamById = {}; // teamId -> { name, abbr, id, owner }
let refreshTimer = null;

// Currently displayed week + season type. When both are null we simply show
// ESPN's "current" scoreboard (its default). After the first load we pin the
// exact week/season type so the prev/next controls can navigate.
let viewWeek = null;
let viewSeasonType = null;

function setStatus(kind, text) {
  statusDot.className = "dot " + kind;
  statusText.textContent = text;
}

async function loadPool() {
  const res = await fetch("teams.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load teams.json");
  return res.json();
}

function buildTeamLookup(pool) {
  const map = {};
  for (const o of pool.owners) {
    for (const t of o.teams) map[t.id] = { ...t, owner: o.name };
  }
  return map;
}

async function fetchScoreboard(week, seasonType) {
  const res = await fetch(SCOREBOARD_URL(week, seasonType), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for scoreboard`);
  return res.json();
}

// Extract a normalized list of games from the raw ESPN payload.
function parseGames(data) {
  const games = [];
  for (const ev of data?.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const competitors = comp.competitors || [];
    if (competitors.length < 2) continue;

    const statusType = ev.status?.type || comp.status?.type || {};
    const state = statusType.state || "pre"; // pre | in | post
    const detail = statusType.shortDetail || statusType.detail || "";
    const clock = ev.status?.displayClock || "";
    const period = ev.status?.period || 0;

    const sides = competitors.map((c) => {
      const rec = (c.records || []).find((r) => r.type === "total" || r.name === "overall");
      return {
        id: c.team?.id,
        abbr: c.team?.abbreviation || "",
        name: c.team?.displayName || c.team?.name || "",
        short: c.team?.shortDisplayName || c.team?.name || "",
        home: c.homeAway === "home",
        winner: c.winner === true,
        score: c.score, // may be a string like "30" or an object; normalized below
        record: rec?.summary || "",
      };
    });

    const home = sides.find((s) => s.home) || sides[0];
    const away = sides.find((s) => !s.home) || sides[1];

    games.push({
      name: ev.name || `${away.abbr} @ ${home.abbr}`,
      shortName: ev.shortName || "",
      state,
      detail,
      clock,
      period,
      home,
      away,
      venue: comp.venue?.fullName || "",
      broadcast: (comp.broadcasts || [])
        .map((b) => (b.names || []).join("/"))
        .filter(Boolean)
        .join(", "),
    });
  }
  return games;
}

function scoreValue(score) {
  // ESPN sometimes gives a string ("30"), sometimes an object ({ value }).
  if (score == null) return null;
  if (typeof score === "object") return score.value != null ? score.value : null;
  return score;
}

function formatScore(score) {
  const v = scoreValue(score);
  return v == null || v === "" ? "–" : String(v);
}

function stateLabel(game) {
  if (game.state === "post") return game.detail || "Final";
  if (game.state === "in") {
    // Prefer the descriptive detail (e.g. "Q3 4:12"); fall back to clock.
    if (game.detail) return game.detail;
    if (game.clock) return game.clock;
    return "Live";
  }
  return game.detail || "Scheduled";
}

function teamRow(side, game) {
  const owner = ownerByTeamId[side.id] || "";
  const cls = [];
  if (game.state === "post" && side.winner) cls.push("winner");
  if (game.state === "post" && !side.winner) cls.push("loser");
  const ownerChip = owner
    ? `<span class="sb-owner"${ownerColorStyle(owner)}>${escapeHtml(owner)}</span>`
    : `<span class="sb-owner sb-owner-none">undrafted</span>`;
  const score = game.state === "pre" ? "" : formatScore(side.score);
  return `
    <div class="sb-team ${cls.join(" ")}">
      <img class="sb-logo" src="${logoUrl(side.abbr)}" alt="${escapeHtml(side.abbr || "")}" loading="lazy" width="32" height="32" />
      <span class="sb-team-info">
        <span class="sb-team-line">
          <span class="sb-team-name">${escapeHtml(side.short || side.name)}</span>
          <span class="sb-record">${escapeHtml(side.record || "")}</span>
        </span>
        <span class="sb-team-meta">${ownerChip}</span>
      </span>
      <span class="sb-score">${score}</span>
    </div>`;
}

function ownerColorStyle(owner) {
  const color = OWNER_COLORS[owner];
  return color ? ` style="border-color:${color};color:${color}"` : "";
}

function gameCard(game) {
  const stateClass =
    game.state === "in" ? "sb-live" : game.state === "post" ? "sb-final" : "sb-pre";
  // Build the footer meta WITHOUT duplicating the kickoff time (which is the
  // status label for scheduled games). Only venue + broadcast go down here.
  const footer = [];
  if (game.venue) footer.push(game.venue);
  if (game.broadcast) footer.push(game.broadcast);
  return `
    <div class="sb-game ${stateClass}">
      <div class="sb-status ${game.state}">
        <span class="sb-state-label">${escapeHtml(stateLabel(game))}</span>
      </div>
      <div class="sb-teams">
        ${teamRow(game.away, game)}
        <div class="sb-divider"><span>at</span></div>
        ${teamRow(game.home, game)}
      </div>
      ${footer.length ? `<div class="sb-meta">${footer.map(escapeHtml).join(" · ")}</div>` : ""}
    </div>`;
}

// Determine which pool teams (owners') are on a bye: not playing this week.
// Returns entries sorted by owner, then team name.
function computeByes(games) {
  const playing = new Set();
  for (const g of games) {
    if (g.away?.id != null) playing.add(g.away.id);
    if (g.home?.id != null) playing.add(g.home.id);
  }
  const byes = [];
  for (const id of Object.keys(teamById)) {
    if (playing.has(id)) continue;
    const t = teamById[id];
    if (!t.owner) continue; // ignore undrafted teams for the bye list
    byes.push({ id, name: t.name, abbr: t.abbr, owner: t.owner });
  }
  byes.sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
  return byes;
}

function byeCard(b) {
  const ownerChip = `<span class="sb-owner"${ownerColorStyle(b.owner)}>${escapeHtml(b.owner)}</span>`;
  return `
    <div class="sb-bye">
      <img class="sb-logo" src="${logoUrl(b.abbr)}" alt="${escapeHtml(b.abbr || "")}" loading="lazy" width="28" height="28" />
      <span class="sb-bye-info">
        <span class="sb-team-name">${escapeHtml(b.name)}</span>
        <span class="sb-team-meta">${ownerChip}</span>
      </span>
    </div>`;
}

function byeSection(byes) {
  if (!byes.length) return "";
  return `
    <section class="sb-bye-section">
      <h3 class="section-title sb-bye-title">On bye this week
        <span class="sb-bye-count">${byes.length}</span>
      </h3>
      <div class="sb-byes">${byes.map(byeCard).join("")}</div>
    </section>`;
}

function render(games, byes, week, seasonType) {
  if (week != null) {
    const prefix = seasonType && seasonType !== 2 ? "Preseason/Postseason · " : "";
    weekTitleEl.textContent = `${prefix}Week ${week} scoreboard`;
  } else {
    weekTitleEl.textContent = "Scoreboard";
  }

  const gamesHtml = games.length
    ? games.map(gameCard).join("")
    : `<div class="chart-empty">No games for this week.</div>`;
  boardEl.innerHTML = gamesHtml + byeSection(byes);
}

async function loadAll() {
  setStatus("loading", "Fetching scoreboard…");
  refreshBtn.disabled = true;
  try {
    if (!pool) {
      pool = await loadPool();
      teamById = buildTeamLookup(pool);
      ownerByTeamId = {};
      for (const id of Object.keys(teamById)) ownerByTeamId[id] = teamById[id].owner;
    }

    const data = await fetchScoreboard(viewWeek, viewSeasonType);
    const games = parseGames(data);
    const byes = computeByes(games);

    // Pin to ESPN's resolved week/season type on first load so prev/next work.
    if (viewWeek == null && data?.week?.number != null) {
      viewWeek = data.week.number;
    }
    if (viewSeasonType == null && data?.season?.type != null) {
      viewSeasonType = data.season.type;
    }

    render(games, byes, data?.week?.number ?? viewWeek, data?.season?.type ?? viewSeasonType);
    renderWeekControls(data);

    setStatus("live", "Live · auto-refreshing");
    updatedEl.textContent = "Last updated: " + new Date().toLocaleString();
  } catch (e) {
    console.error(e);
    setStatus("error", "Could not load scoreboard");
    boardEl.innerHTML = `
      <div class="card" style="padding:24px;line-height:1.6">
        <strong>Couldn't fetch the scoreboard.</strong>
        <p style="color:var(--muted)">Details: ${escapeHtml(e && e.message ? e.message : String(e))}</p>
        <p style="color:var(--muted)">This can happen if ESPN's API is temporarily
        unavailable, or if you're offline. Try "Refresh now" below.</p>
      </div>`;
  } finally {
    refreshBtn.disabled = false;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadAll, REFRESH_MS);
  }
}

function renderWeekControls(data) {
  const prevWeek = document.getElementById("prevWeek");
  const nextWeek = document.getElementById("nextWeek");
  if (!prevWeek || !nextWeek) return;
  // Enable nav within the 1..18 regular-season range.
  prevWeek.disabled = viewWeek == null || viewWeek <= 1;
  nextWeek.disabled = viewWeek == null || viewWeek >= 18;
  prevWeek.onclick = () => {
    if (viewWeek > 1) {
      viewWeek -= 1;
      clearTimeout(refreshTimer);
      loadAll();
    }
  };
  nextWeek.onclick = () => {
    viewWeek += 1;
    clearTimeout(refreshTimer);
    loadAll();
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

refreshBtn.addEventListener("click", () => {
  clearTimeout(refreshTimer);
  loadAll();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    clearTimeout(refreshTimer);
    loadAll();
  }
});

loadAll();
