const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes

// All data comes from ESPN's public site API. The endpoints we use send
// permissive CORS headers, so this runs as a pure static site (GitHub Pages)
// with direct fetches — no server-side proxy required.
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

// Current-week scoreboard (all matchups).
const SCOREBOARD_URL = `${ESPN_BASE}/scoreboard`;
// Per-team season schedule (game-by-game results). We derive BOTH each team's
// current W-L record AND its weekly win progression from this single endpoint,
// which avoids the per-team record endpoint (that one lacks CORS headers).
const SCHEDULE_URL = (id) => `${ESPN_BASE}/teams/${id}/schedule`;

const REGULAR_SEASON_GAMES = 17; // games each NFL team plays in a season

// Public ESPN CDN logos keyed by lowercase team abbreviation (e.g. "sf").
const logoUrl = (abbr) =>
  abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` : "";

// Distinct colors per owner line in the chart.
const OWNER_COLORS = [
  "#3fa9f5", // blue
  "#f5c542", // gold
  "#3ddc84", // green
  "#ff6b6b", // red
  "#b98cf5", // purple
  "#ff9f43", // orange
];

const standingsEl = document.getElementById("standings");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const updatedEl = document.getElementById("updated");
const refreshBtn = document.getElementById("refreshBtn");

let pool = null; // loaded teams.json
let refreshTimer = null;

function setStatus(kind, text) {
  statusDot.className = "dot " + kind;
  statusText.textContent = text;
}

// Fetch all of this week's games and return:
//   { week, matchups: { <teamId>: { opponent, opponentAbbr, home, state, detail } } }
async function fetchScoreboard() {
  const res = await fetch(SCOREBOARD_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for scoreboard`);
  return parseScoreboard(await res.json());
}

function parseScoreboard(data) {
  const week = data?.week?.number ?? null;
  const matchups = {};
  for (const ev of data?.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const competitors = comp.competitors || [];
    if (competitors.length < 2) continue;
    const state = ev.status?.type?.state || "pre"; // pre | in | post
    const detail = ev.status?.type?.shortDetail || "";
    for (const me of competitors) {
      const opp = competitors.find((c) => c !== me);
      if (!opp) continue;
      matchups[me.team.id] = {
        opponent: opp.team.displayName || opp.team.name,
        opponentAbbr: opp.team.abbreviation || "",
        home: me.homeAway === "home",
        state,
        detail,
      };
    }
  }
  return { week, matchups };
}

// Fetch one team's schedule. Derives BOTH current W-L record and the weekly
// cumulative-win progression. Only COMPLETED games (state === "post") count;
// upcoming/live games are ignored.
async function fetchTeamSchedule(id) {
  const res = await fetch(SCHEDULE_URL(id), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for schedule ${id}`);
  const data = await res.json();

  const winsByWeek = {};
  let cumWins = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  const completed = [];

  for (const ev of data?.events || []) {
    const week = ev?.week?.number;
    if (!week) continue;
    const comp = ev.competitions?.[0];
    const state = comp?.status?.type?.state;
    if (state !== "post") continue; // ignore future / live games
    const me = (comp.competitors || []).find((c) => c.team?.id === id);
    if (!me) continue;
    // ESPN sets winner=false for BOTH sides of a tie, so detect ties by
    // comparing scores (a tie is a game where neither side won).
    const opp = (comp.competitors || []).find((c) => c !== me);
    const myScore = Number(me?.score?.value);
    const oppScore = Number(opp?.score?.value);
    const isTie =
      Number.isFinite(myScore) &&
      Number.isFinite(oppScore) &&
      myScore === oppScore;

    if (me.winner === true) {
      cumWins += 1;
      wins += 1;
    } else if (isTie) {
      ties += 1;
    } else {
      losses += 1;
    }
    completed.push({ week, cumWins });
  }

  // Build a week-by-week cumulative series up to the max completed week.
  let maxWeek = 0;
  for (const c of completed) if (c.week > maxWeek) maxWeek = c.week;
  const cumByWeek = {};
  for (const c of completed) cumByWeek[c.week] = c.cumWins;
  let running = 0;
  for (let w = 1; w <= maxWeek; w++) {
    if (cumByWeek[w] !== undefined) running = cumByWeek[w];
    winsByWeek[w] = running;
  }
  return { wins, losses, ties, winsByWeek, maxWeek };
}

async function loadPool() {
  const res = await fetch("teams.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load teams.json");
  return res.json();
}

async function loadAll() {
  statusDot.className = "dot loading";
  statusText.textContent = "Fetching live records…";
  refreshBtn.disabled = true;

  try {
    if (!pool) pool = await loadPool();

    // Fetch the current-week scoreboard and each team's schedule in parallel.
    // The schedule gives us BOTH the current record and the weekly progression.
    const allTeams = pool.owners.flatMap((o) => o.teams);
    const [scoreboard, schedules] = await Promise.all([
      // Scoreboard failure shouldn't break the standings; just hide matchups.
      fetchScoreboard().catch(() => ({ week: null, matchups: {} })),
      // Schedule failure for a team shouldn't break standings; zero it out.
      Promise.all(
        allTeams.map(async (t) => {
          try {
            const s = await fetchTeamSchedule(t.id);
            return { id: t.id, ...s, error: false };
          } catch (e) {
            return {
              id: t.id,
              wins: 0,
              losses: 0,
              ties: 0,
              winsByWeek: {},
              maxWeek: 0,
              error: true,
            };
          }
        })
      ),
    ]);
    const weeklyById = Object.fromEntries(schedules.map((s) => [s.id, s]));
    const matchups = scoreboard.matchups || {};

    // Build owner standings.
    const ownerRows = pool.owners.map((o) => {
      const teams = o.teams.map((t) => {
        const s = weeklyById[t.id] || { wins: 0, losses: 0, ties: 0 };
        const played = s.wins + s.losses + s.ties;
        const remaining = Math.max(0, REGULAR_SEASON_GAMES - played);
        return {
          ...t,
          wins: s.wins,
          losses: s.losses,
          ties: s.ties,
          remaining,
          matchup: matchups[t.id] || null,
          error: s.error,
        };
      });
      const wins = teams.reduce((s, t) => s + t.wins, 0);
      const losses = teams.reduce((s, t) => s + t.losses, 0);
      const ties = teams.reduce((s, t) => s + t.ties, 0);
      const gamesPlayed = teams.reduce(
        (s, t) => s + t.wins + t.losses + t.ties,
        0
      );
      const remaining = teams.reduce((s, t) => s + t.remaining, 0);
      const anyError = teams.some((t) => t.error);
      return {
        name: o.name,
        teams,
        wins,
        losses,
        ties,
        gamesPlayed,
        remaining,
        anyError,
      };
    });

    // Sort by wins desc, then by fewest losses as a soft tiebreak.
    ownerRows.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

    // Build weekly cumulative-win series per owner for the chart.
    const maxWeek = Math.max(0, ...schedules.map((w) => w.maxWeek || 0));
    const series = pool.owners.map((o, i) => {
      const values = [];
      // Track each team's last known cumulative value so owners who haven't
      // played a given (later) week carry their total forward — never drop.
      const lastKnown = {};
      for (const t of o.teams) lastKnown[t.id] = 0;
      for (let w = 0; w <= maxWeek; w++) {
        let total = 0;
        for (const t of o.teams) {
          const wt = weeklyById[t.id];
          const v = wt?.winsByWeek?.[w];
          if (v !== undefined) lastKnown[t.id] = v;
          total += lastKnown[t.id];
        }
        values.push(total);
      }
      return {
        name: o.name,
        color: OWNER_COLORS[i % OWNER_COLORS.length],
        values,
      };
    });

    renderChart(series, maxWeek);
    render(ownerRows, scoreboard.week);

    const hadError = schedules.some((r) => r.error);
    if (hadError) {
      setStatus("error", "Some teams failed to load (showing partial)");
    } else {
      setStatus("live", "Live · auto-refreshing");
    }
    updatedEl.textContent = "Last updated: " + new Date().toLocaleString();
  } catch (e) {
    console.error(e);
    showError(e);
  } finally {
    refreshBtn.disabled = false;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadAll, REFRESH_MS);
  }
}

function showError(e) {
  setStatus("error", "Could not load live data");
  standingsEl.innerHTML = `
    <div class="card" style="padding:24px;line-height:1.6">
      <strong>Couldn't fetch live records.</strong>
      <p style="color:var(--muted)">Details: ${escapeHtml(e && e.message ? e.message : String(e))}</p>
      <p style="color:var(--muted)">This can happen if ESPN's API is temporarily
      unavailable, or if you're offline. Try the "Refresh now" button below.</p>
    </div>`;
}

function recordClass(wins, losses) {
  if (wins > losses) return "winning";
  if (wins < losses) return "losing";
  return "even";
}

// Render a cumulative-wins line chart as inline SVG (no external libs).
// series: [{ name, color, values: [w0, w1, ... wMaxWeek] }]
function renderChart(series, maxWeek) {
  const chartEl = document.getElementById("chart");
  if (!chartEl) return;

  if (!maxWeek || maxWeek < 1 || !series.length) {
    chartEl.innerHTML =
      `<div class="chart-empty">No completed weeks yet — the chart appears once games are final.</div>`;
    return;
  }

  const W = 760;
  const H = 380;
  const M = { top: 20, right: 20, bottom: 40, left: 44 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  // Y-axis: 0 .. max cumulative wins (padded, rounded up to nearest 5).
  let maxY = 1;
  series.forEach((s) => s.values.forEach((v) => (maxY = Math.max(maxY, v))));
  maxY = Math.ceil(maxY / 5) * 5;

  const xOf = (week) =>
    M.left + (maxWeek === 0 ? 0 : (week / maxWeek) * innerW);
  const yOf = (v) => M.top + innerH - (v / maxY) * innerH;

  // Build SVG pieces.
  const parts = [];
  parts.push(
    `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`
  );

  // Horizontal gridlines + Y labels.
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const val = (maxY / ySteps) * i;
    const y = yOf(val);
    parts.push(
      `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${M.left - 8}" y="${y + 4}" text-anchor="end" class="axis-label">${Math.round(val)}</text>`
    );
  }

  // X labels (weeks) — show every week if few, else step.
  const weekStep = maxWeek > 12 ? 2 : 1;
  for (let wk = 0; wk <= maxWeek; wk++) {
    const x = xOf(wk);
    parts.push(
      `<text x="${x}" y="${H - M.bottom + 18}" text-anchor="middle" class="axis-label">${wk === 0 ? "Start" : "W" + wk}</text>`
    );
  }

  // Lines.
  series.forEach((s) => {
    const pts = s.values
      .map((v, w) => `${xOf(w).toFixed(1)},${yOf(v).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
    );
    // End dot at the final completed week.
    const lastW = maxWeek;
    const lastV = s.values[lastW] ?? 0;
    parts.push(
      `<circle cx="${xOf(lastW)}" cy="${yOf(lastV)}" r="3.5" fill="${s.color}"/>`
    );
  });

  parts.push(`</svg>`);

  // Legend (chips).
  const legend = series
    .map(
      (s) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`
    )
    .join("");

  // Per-week tooltip columns (absolute-positioned over the chart).
  const tooltipWeeks = [];
  for (let wk = 0; wk <= maxWeek; wk++) {
    const x = xOf(wk);
    const rows = series
      .map(
        (s) =>
          `<div class="tt-row"><span class="tt-swatch" style="background:${s.color}"></span><span class="tt-name">${escapeHtml(s.name)}</span><span class="tt-val">${s.values[wk] ?? 0}</span></div>`
      )
      .join("");
    tooltipWeeks.push(
      `<div class="tt-col" data-week="${wk}" style="left:${(x / W) * 100}%">` +
        `<div class="tt-box"><div class="tt-title">Week ${wk}</div>${rows}</div>` +
        `</div>`
    );
  }

  // Invisible hit areas per week (inside the main SVG for clean alignment).
  const hitAreas = [];
  for (let wk = 0; wk <= maxWeek; wk++) {
    const x = xOf(wk);
    const half = innerW / maxWeek / 2;
    hitAreas.push(
      `<rect class="hit" data-week="${wk}" x="${x - half}" y="${M.top}" width="${half * 2}" height="${innerH}" fill="transparent"/>`
    );
  }
  const svgOpenIdx = 1; // index of the opening <svg> string in parts
  // Insert hit rects just before </svg>.
  parts.splice(parts.length - 1, 0, hitAreas.join(""));

  chartEl.innerHTML =
    `<div class="chart-wrap">` +
    parts.join("") +
    `<div class="chart-tooltips">${tooltipWeeks.join("")}</div>` +
    `</div>` +
    `<div class="chart-legend">${legend}</div>`;

  wireChartHover(chartEl, maxWeek);
}

function wireChartHover(chartEl, maxWeek) {
  const wrap = chartEl.querySelector(".chart-wrap");
  const cols = [...chartEl.querySelectorAll(".tt-col")];
  const hits = chartEl.querySelectorAll("rect.hit");
  if (!wrap) return;

  const show = (wk) =>
    cols.forEach((c) =>
      c.classList.toggle("show", c.getAttribute("data-week") === wk)
    );

  hits.forEach((rect) => {
    rect.addEventListener("mouseenter", () =>
      show(rect.getAttribute("data-week"))
    );
  });
  wrap.addEventListener("mouseleave", () =>
    cols.forEach((c) => c.classList.remove("show"))
  );
  // Touch support.
  wrap.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (!t) return;
    const target = document.elementFromPoint(t.clientX, t.clientY);
    if (target && target.classList.contains("hit")) {
      show(target.getAttribute("data-week"));
    }
  });
}

function matchupText(m) {
  if (!m) return "";
  const opp = m.home ? `vs ${m.opponent}` : `@ ${m.opponent}`;
  return opp;
}

function matchupBadge(m) {
  if (!m) return "";
  // Final / in-progress / upcoming styling hint.
  if (m.state === "post") return `<span class="mbadge done">${escapeHtml(m.detail || "Final")}</span>`;
  if (m.state === "in") return `<span class="mbadge live">${escapeHtml(m.detail || "Live")}</span>`;
  return `<span class="mbadge">${escapeHtml(m.detail || "")}</span>`;
}

function render(rows, week) {
  standingsEl.innerHTML = "";

  // Small header line showing which week the matchups reflect.
  if (week != null) {
    const wk = document.createElement("div");
    wk.className = "week-note";
    wk.textContent = `Week ${week} matchups shown`;
    standingsEl.appendChild(wk);
  }

  rows.forEach((r, idx) => {
    const rank = idx + 1;
    const card = document.createElement("div");
    card.className = "card" + (idx === 0 ? " open" : "");

    const row = document.createElement("div");
    row.className = "row";
    const rankClass = rank <= 3 ? ` r${rank}` : "";
    // Compact strip of this owner's team logos, ordered by wins desc so it
    // reads as a quick visual summary.
    const logoStrip = [...r.teams]
      .sort((a, b) => b.wins - a.wins)
      .map(
        (t) =>
          `<img class="owner-logo" src="${logoUrl(t.abbr)}" alt="${escapeHtml(
            t.abbr || ""
          )}" title="${escapeHtml(t.name)}" loading="lazy" width="22" height="22" />`
      )
      .join("");
    row.innerHTML = `
      <div class="rank${rankClass}">${rank}</div>
      <div class="owner">
        <span class="owner-name">${escapeHtml(r.name)}</span>
        <span class="owner-remaining">${r.remaining} games left</span>
        <span class="owner-logos">${logoStrip}</span>
      </div>
      <div class="wins">${r.wins}<span class="lbl">wins</span></div>
      <div class="chevron">&#9654;</div>
    `;
    row.addEventListener("click", () => card.classList.toggle("open"));

    const teams = document.createElement("div");
    teams.className = "teams";
    // Sort a copy of teams by wins desc for display.
    [...r.teams]
      .sort((a, b) => b.wins - a.wins)
      .forEach((t) => {
        const tEl = document.createElement("div");
        tEl.className = "team";
        const rec = `${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}`;
        const m = t.matchup;
        const oppLine = m
          ? `<span class="team-opp">${escapeHtml(matchupText(m))} ${matchupBadge(m)}</span>`
          : `<span class="team-opp muted">No game this week / bye</span>`;
        const logo = t.abbr
          ? `<img class="team-logo" src="${logoUrl(t.abbr)}" alt="" loading="lazy" width="26" height="26" />`
          : "";
        tEl.innerHTML = `
          <div class="team-main">
            <span class="team-name-wrap">
              ${logo}
              <span class="team-name">${escapeHtml(t.name)}</span>
            </span>
            <span class="team-stats">
              <span class="rec ${recordClass(t.wins, t.losses)}">${rec}</span>
              <span class="t-remaining">${t.remaining} left</span>
            </span>
          </div>
          <div class="team-sub">${oppLine}</div>
        `;
        teams.appendChild(tEl);
      });

    card.appendChild(row);
    card.appendChild(teams);
    standingsEl.appendChild(card);
  });
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

// Pause auto-refresh when tab is hidden, resume when visible.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    clearTimeout(refreshTimer);
    loadAll();
  }
});

loadAll();
