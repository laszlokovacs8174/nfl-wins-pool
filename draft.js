// Draft results page: actual draft vs. best-available (hindsight) draft.

const REFRESH_MS = 5 * 60 * 1000;

// Same CORS-friendly endpoint the standings page uses. We derive current W-L
// from each team's schedule (completed games only).
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SCHEDULE_URL = (id) => `${ESPN_BASE}/teams/${id}/schedule`;

const ROUNDS = 6; // 6 picks per owner

// Public ESPN CDN logos keyed by lowercase team abbreviation (e.g. "sf").
const logoUrl = (abbr) =>
  abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` : "";

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
const summaryEl = document.getElementById("hindsightSummary");
const tableEl = document.getElementById("draftTable");

let refreshTimer = null;

function setStatus(kind, text) {
  statusDot.className = "dot " + kind;
  statusText.textContent = text;
}

async function fetchRecord(id) {
  const res = await fetch(SCHEDULE_URL(id), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for team ${id}`);
  const data = await res.json();
  let wins = 0;
  let losses = 0;
  for (const ev of data?.events || []) {
    const comp = ev.competitions?.[0];
    if (comp?.status?.type?.state !== "post") continue;
    const me = (comp.competitors || []).find((c) => c.team?.id === id);
    if (!me) continue;
    if (me.winner === true) wins += 1;
    else losses += 1;
  }
  return { wins, losses, ties: 0 };
}

async function loadPool() {
  const res = await fetch("teams.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load teams.json");
  return res.json();
}

// Build the linear pick order for a SNAKE draft.
//
// teams.json lists each owner with their 6 teams in the order they were
// picked (teams[0] = that owner's 1st-round pick, teams[1] = 2nd-round pick,
// etc.). Under a snake draft the owner order ALTERNATES each round:
//   Round 1: Phil -> Ken -> Rick -> Matt -> Juan
//   Round 2: Juan -> Matt -> Rick -> Ken -> Phil   (reversed)
//   Round 3: Phil -> ... (forward again), and so on.
// So on odd-numbered rounds (round index r = 1, 3, 5 ...) we reverse owners.
function buildPickOrder(pool) {
  const owners = pool.owners;
  const picks = [];
  for (let r = 0; r < ROUNDS; r++) {
    const order =
      r % 2 === 0 ? owners : [...owners].reverse();
    for (let i = 0; i < order.length; i++) {
      const owner = order[i];
      const team = owner.teams[r];
      if (team) {
        picks.push({ round: r + 1, owner: owner.name, team });
      }
    }
  }
  return picks;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function loadAll() {
  setStatus("loading", "Fetching records…");
  refreshBtn.disabled = true;
  try {
    const pool = await loadPool();

    // Fetch records for all teams in parallel.
    const allTeams = pool.owners.flatMap((o) => o.teams);
    const recArr = await Promise.all(
      allTeams.map(async (t) => {
        try {
          return { id: t.id, ...(await fetchRecord(t.id)), error: false };
        } catch (e) {
          return { id: t.id, wins: 0, losses: 0, ties: 0, error: true };
        }
      })
    );
    const recById = Object.fromEntries(recArr.map((r) => [r.id, r]));
    const hadError = recArr.some((r) => r.error);

    // Annotate every team with its record.
    const pickOrder = buildPickOrder(pool).map((p) => {
      const rec = recById[p.team.id] || { wins: 0, losses: 0 };
      return { ...p, wins: rec.wins, losses: rec.losses };
    });

    // ---- Hindsight: best available at each pick ----
    // Pool of all teams, sorted best-first by wins (tiebreak: fewer losses).
    const poolTeams = allTeams.map((t) => {
      const rec = recById[t.id] || { wins: 0, losses: 0 };
      return { ...t, wins: rec.wins, losses: rec.losses };
    });
    poolTeams.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

    const remaining = [...poolTeams];
    const hindsightPicks = pickOrder.map((p) => {
      // Best available = first team still remaining.
      const bestIdx = 0;
      const best = remaining.splice(bestIdx, 1)[0];
      return { ...p, best };
    });

    // ---- Per-owner totals: actual vs hindsight ----
    const ownerStats = pool.owners.map((o) => {
      const actualWins = o.teams.reduce(
        (s, t) => s + (recById[t.id]?.wins || 0),
        0
      );
      const hindsightWins = hindsightPicks
        .filter((p) => p.owner === o.name)
        .reduce((s, p) => s + (p.best?.wins || 0), 0);
      return {
        name: o.name,
        color: OWNER_COLORS[o.name] || "#888",
        actualWins,
        hindsightWins,
      };
    });

    renderSummary(ownerStats);
    renderTable(hindsightPicks);

    setStatus(
      hadError ? "error" : "live",
      hadError ? "Some teams failed to load (partial)" : "Live · auto-refreshing"
    );
    updatedEl.textContent = "Last updated: " + new Date().toLocaleString();
  } catch (e) {
    console.error(e);
    setStatus("error", "Could not load data");
    summaryEl.innerHTML = `<div class="chart-empty">Couldn't load data: ${escapeHtml(
      e.message || String(e)
    )}</div>`;
  } finally {
    refreshBtn.disabled = false;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadAll, REFRESH_MS);
  }
}

function renderSummary(stats) {
  // Sort by hindsight wins desc for the leaderboard.
  const ranked = [...stats].sort((a, b) => b.hindsightWins - a.hindsightWins);
  const maxWins = Math.max(
    1,
    ...ranked.map((s) => Math.max(s.actualWins, s.hindsightWins))
  );

  summaryEl.innerHTML = ranked
    .map((s, i) => {
      const actualPct = (s.actualWins / maxWins) * 100;
      const bestPct = (s.hindsightWins / maxWins) * 100;
      const delta = s.hindsightWins - s.actualWins;
      const deltaStr =
        delta === 0 ? "even" : delta > 0 ? `+${delta} possible` : `${delta}`;
      return `
        <div class="hs-row">
          <div class="hs-rank">${i + 1}</div>
          <div class="hs-name" style="border-color:${s.color}">
            <span class="hs-dot" style="background:${s.color}"></span>
            ${escapeHtml(s.name)}
          </div>
          <div class="hs-bars">
            <div class="hs-bar-track">
              <div class="hs-bar actual" style="width:${actualPct}%"></div>
              <span class="hs-bar-label">actual ${s.actualWins}</span>
            </div>
            <div class="hs-bar-track">
              <div class="hs-bar best" style="width:${bestPct}%;background:${s.color}"></div>
              <span class="hs-bar-label">best ${s.hindsightWins}</span>
            </div>
          </div>
          <div class="hs-delta">${deltaStr}</div>
        </div>`;
    })
    .join("");
}

function renderTable(picks) {
  const logoImg = (abbr, cls) =>
    abbr
      ? `<img class="${cls}" src="${logoUrl(abbr)}" alt="" loading="lazy" width="22" height="22" />`
      : "";

  const rows = picks
    .map((p) => {
      const same = p.best && p.best.id === p.team.id;
      const actualRec = `${p.wins}-${p.losses}`;
      const bestRec = p.best ? `${p.best.wins}-${p.best.losses}` : "—";
      return `
        <tr class="${same ? "match" : ""}">
          <td class="pick-num">R${p.round}</td>
          <td class="pick-owner">
            <span class="hs-dot" style="background:${OWNER_COLORS[p.owner] || "#888"}"></span>
            ${escapeHtml(p.owner)}
          </td>
          <td class="team-cell">
            <span class="team-cell-inner">
              ${logoImg(p.team.abbr, "pick-logo")}
              <span>${escapeHtml(p.team.name)} <span class="rec-mini">${actualRec}</span></span>
            </span>
          </td>
          <td class="best-cell team-cell">
            <span class="team-cell-inner">
              ${p.best ? logoImg(p.best.abbr, "pick-logo") : ""}
              <span>${p.best ? escapeHtml(p.best.name) : "—"}
                <span class="rec-mini">${bestRec}</span>
                ${same ? '<span class="same-tag">kept</span>' : ""}
              </span>
            </span>
          </td>
        </tr>`;
    })
    .join("");

  tableEl.innerHTML = `
    <table class="draft-table">
      <thead>
        <tr>
          <th>Pick</th>
          <th>Owner</th>
          <th>Actual pick</th>
          <th>Best available (hindsight)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
