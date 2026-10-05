let PLAYERS = [];
let LIVE_TESTS = [];
let RESULTS_LOG = [];

// page = "home" | "leaderboard" | "testers"
let currentPage = "home";

// view = { type: "overall" } | { type: "gamemode", value: "vanilla" } | { type: "player", value: "Frostbyte" }
// Region and tier are independent multi-select filters layered on top of
// whichever view is active, not separate views themselves.
let currentView = { type: "overall" };
let previousListView = { type: "overall" }; // remembered so the profile's Back button returns here
let searchQuery = "";
let selectedRegions = new Set(); // empty = no filter, show every region
let selectedTiers = new Set(); // empty = no filter, show every tier
let testersSearchQuery = "";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function headUrl(name, size) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;
}

// All data now lives in Supabase (see supabase-client.js for the client
// and supabase/schema.sql in the bot repo for the tables). Public reads are
// allowed by Row Level Security; writes only happen through the RPC
// functions called from testing.js, gated by who's logged in.

async function loadPlayers() {
  const [{ data: players }, { data: tiers }] = await Promise.all([
    sb.from("players").select("id, username, region"),
    sb.from("player_tiers").select("player_id, gamemode, tier"),
  ]);

  const tiersByPlayer = new Map();
  (tiers || []).forEach((t) => {
    if (!tiersByPlayer.has(t.player_id)) tiersByPlayer.set(t.player_id, {});
    tiersByPlayer.get(t.player_id)[t.gamemode] = t.tier;
  });

  PLAYERS = (players || []).map((p) => ({
    name: p.username,
    region: p.region || "NA",
    tiers: tiersByPlayer.get(p.id) || {},
  }));
}

async function loadLiveTests() {
  const { data } = await sb
    .from("live_tests")
    .select("gamemode, tester_names, players!live_tests_player_id_fkey(username)");
  LIVE_TESTS = (data || []).map((t) => ({
    testeeName: t.players.username,
    gamemode: t.gamemode,
    testerNames: t.tester_names || [],
    tier: null,
  }));
}

async function loadResultsLog() {
  const { data } = await sb
    .from("test_log")
    .select("gamemode, tier, tester_names, created_at, players!test_log_player_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(200);

  RESULTS_LOG = (data || []).map((r) => ({
    testeeName: r.players ? r.players.username : "Unknown",
    gamemode: r.gamemode,
    tier: r.tier,
    testerNames: r.tester_names || [],
    timestamp: new Date(r.created_at).getTime(),
  }));
}

// Builds a checkbox-style dropdown menu. onToggle(value, nowChecked) fires
// per click; the caller decides how that affects filtering/rendering.
function buildCheckboxMenu(menuEl, options, selectedSet, onToggle) {
  menuEl.innerHTML = "";
  options.forEach(({ value, label }) => {
    const item = document.createElement("label");
    item.className = "custom-select-checkbox-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedSet.has(value);
    checkbox.onchange = () => onToggle(value, checkbox.checked);
    item.appendChild(checkbox);
    item.appendChild(document.createTextNode(label));
    menuEl.appendChild(item);
  });
}

function updateFilterTriggerLabel(triggerId, baseLabel, selectedSet) {
  const trigger = document.getElementById(triggerId);
  const text = selectedSet.size > 0 ? `${baseLabel} (${selectedSet.size})` : baseLabel;
  trigger.innerHTML = `${text} <span class="custom-select-arrow"></span>`;
}

function buildNav() {
  // Top-level page tabs: Home / Leaderboard / Testers
  document.querySelectorAll(".page-tab").forEach((btn) => {
    btn.onclick = () => setPage(btn.dataset.page);
  });

  const nav = document.getElementById("nav-tabs");
  nav.innerHTML = "";

  // Overall tab (the only fixed nav tab now — region/tier are filters, and
  // a gamemode is picked from its own dropdown below).
  const overallBtn = document.createElement("button");
  overallBtn.textContent = "Overall";
  overallBtn.className = "tab-btn active";
  overallBtn.onclick = () => setView({ type: "overall" });
  nav.appendChild(overallBtn);

  // Generic open/close wiring shared by all three dropdowns.
  function wireDropdown(dropdownId, triggerId) {
    const dropdown = document.getElementById(dropdownId);
    const trigger = document.getElementById(triggerId);
    trigger.onclick = (e) => {
      e.stopPropagation();
      const wasOpen = dropdown.classList.contains("open");
      document.querySelectorAll(".custom-select.open").forEach((d) => d.classList.remove("open"));
      if (!wasOpen) dropdown.classList.add("open");
    };
  }
  document.addEventListener("click", () => {
    document.querySelectorAll(".custom-select.open").forEach((d) => d.classList.remove("open"));
  });

  // Region filter (multi-select checkboxes)
  wireDropdown("region-dropdown", "region-trigger");
  buildCheckboxMenu(
    document.getElementById("region-menu"),
    REGIONS.map((r) => ({ value: r, label: r })),
    selectedRegions,
    (value, checked) => {
      if (checked) selectedRegions.add(value);
      else selectedRegions.delete(value);
      updateFilterTriggerLabel("region-trigger", "Region", selectedRegions);
      render();
    }
  );
  updateFilterTriggerLabel("region-trigger", "Region", selectedRegions);

  // Tier filter (multi-select checkboxes)
  wireDropdown("tier-dropdown", "tier-trigger");
  buildCheckboxMenu(
    document.getElementById("tier-menu"),
    TIER_ORDER.map((t) => ({ value: t, label: t })),
    selectedTiers,
    (value, checked) => {
      if (checked) selectedTiers.add(value);
      else selectedTiers.delete(value);
      updateFilterTriggerLabel("tier-trigger", "Tier", selectedTiers);
      render();
    }
  );
  updateFilterTriggerLabel("tier-trigger", "Tier", selectedTiers);

  // Gamemode dropdown (single-select — switches the view, not a filter)
  wireDropdown("gamemode-dropdown", "gamemode-trigger");
  const gamemodeDropdown = document.getElementById("gamemode-dropdown");
  const gamemodeMenu = document.getElementById("gamemode-menu");
  gamemodeMenu.innerHTML = "";
  GAMEMODES.forEach((gm) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select-item";
    item.textContent = gm.label;
    item.dataset.gamemode = gm.id;
    item.onclick = () => {
      gamemodeDropdown.classList.remove("open");
      setView({ type: "gamemode", value: gm.id });
    };
    gamemodeMenu.appendChild(item);
  });

  // Search box: filters whatever view is currently showing, doesn't change it
  const searchInput = document.getElementById("search-input");
  searchInput.value = "";
  searchInput.oninput = () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    render();
  };
}

function setView(view) {
  if (view.type !== "player") {
    previousListView = view;
  }
  currentView = view;

  // Highlight Overall vs a gamemode. Skipped on the profile view, which
  // isn't one of the nav tabs.
  const gamemodeTrigger = document.getElementById("gamemode-trigger");
  if (view.type !== "player") {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", view.type === "overall" && btn.textContent === "Overall");
    });

    document.querySelectorAll("#gamemode-menu .custom-select-item").forEach((item) => {
      item.classList.toggle("active", view.type === "gamemode" && item.dataset.gamemode === view.value);
    });

    if (view.type === "gamemode") {
      const gm = GAMEMODES.find((g) => g.id === view.value);
      gamemodeTrigger.innerHTML = `${gm.label} <span class="custom-select-arrow"></span>`;
    } else {
      gamemodeTrigger.innerHTML = `Gamemode <span class="custom-select-arrow"></span>`;
    }
  }

  render();
}

function render() {
  const title = document.getElementById("view-title");
  let rows, columns;

  if (currentView.type === "player") {
    renderProfile(currentView.value);
    return;
  }

  if (currentView.type === "overall") {
    title.textContent = "Overall Rankings";
    rows = getOverallLeaderboard(PLAYERS);
    columns = "score";
  } else {
    const gm = GAMEMODES.find((g) => g.id === currentView.value);
    title.innerHTML = gm.icon
      ? `<img src="${gm.icon}" alt="" class="title-icon" /> ${gm.label} Rankings`
      : `${gm.label} Rankings`;
    rows = getGamemodeLeaderboard(PLAYERS, currentView.value);
    columns = "tier";
  }

  if (selectedRegions.size > 0) {
    rows = rows.filter((p) => selectedRegions.has(p.region));
  }

  if (selectedTiers.size > 0) {
    rows = rows.filter((p) =>
      currentView.type === "gamemode"
        ? selectedTiers.has(p.tiers[currentView.value])
        : Object.values(p.tiers).some((t) => selectedTiers.has(t))
    );
  }

  if (searchQuery) {
    rows = rows.filter((p) => p.name.toLowerCase().includes(searchQuery));
  }

  renderTable(rows, columns);
}

function renderTable(players, columns) {
  const container = document.getElementById("leaderboard");
  container.innerHTML = "";

  const title = document.getElementById("view-title");
  title.classList.remove("profile-mode");

  const showTiers = columns === "score";

  const table = document.createElement("table");
  if (showTiers) table.classList.add("with-tiers");
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>#</th>
      <th>Player</th>
      <th>Region</th>
      <th>${columns === "score" ? "Score" : "Tier"}</th>
      ${showTiers ? "<th>Tiers</th>" : ""}
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  players.forEach((player, i) => {
    const rank = i + 1;
    const tr = document.createElement("tr");
    if (rank <= 3) tr.classList.add(`rank-${rank}`);

    const value =
      columns === "score"
        ? overallScore(player)
        : player.tiers[currentView.value];

    const safeName = escapeHtml(player.name);

    const tierBadges = showTiers
      ? GAMEMODES.filter((gm) => player.tiers[gm.id])
          .map((gm) => {
            const tier = player.tiers[gm.id];
            return `
              <div class="mini-tier-item" title="${gm.label}: ${tier}">
                <span class="mini-tier-badge">
                  ${gm.icon ? `<img src="${gm.icon}" alt="" class="mini-tier-icon" />` : ""}
                </span>
                <span class="mini-tier-label" style="color:${tierColor(tier)}">${tier}</span>
              </div>
            `;
          })
          .join("")
      : "";

    tr.innerHTML = `
      <td>${rank}</td>
      <td>
        <button class="player-link" data-player="${safeName}">
          <img src="${headUrl(player.name, 24)}" alt="" class="player-head" loading="lazy" />
          <span>${safeName}</span>
        </button>
      </td>
      <td>${player.region}</td>
      <td>${value}</td>
      ${showTiers ? `<td><div class="mini-tier-row">${tierBadges}</div></td>` : ""}
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.appendChild(table);

  container.querySelectorAll(".player-link").forEach((btn) => {
    btn.onclick = () => setView({ type: "player", value: btn.dataset.player });
  });
}

// Warm colors for HT tiers (rank 1 = brightest gold), cool colors for LT
// tiers (rank 1 = brightest cyan), getting duller as the tier drops.
function tierColor(tier) {
  const isHT = tier.startsWith("HT");
  const rank = parseInt(tier.slice(2), 10) - 1; // 0-4
  const warm = ["#ffd700", "#ffb84d", "#ff9800", "#ff7043", "#e64a19"];
  const cool = ["#4fc3f7", "#42a5f5", "#5c6bc0", "#7e57c2", "#8e24aa"];
  return (isHT ? warm : cool)[rank] || "#999";
}

function renderProfile(playerName) {
  const player = PLAYERS.find(
    (p) => p.name.toLowerCase() === playerName.toLowerCase()
  );
  const container = document.getElementById("leaderboard");
  const title = document.getElementById("view-title");
  title.classList.add("profile-mode");
  title.innerHTML = `<button id="back-btn" class="back-btn">&larr; Back</button>`;
  document.getElementById("back-btn").onclick = () => setView(previousListView);

  if (!player) {
    container.innerHTML = `<p class="empty-state">Player not found.</p>`;
    return;
  }

  const score = overallScore(player);
  const tierIcons = GAMEMODES.filter((gm) => player.tiers[gm.id])
    .map((gm) => {
      const tier = player.tiers[gm.id];
      return `
        <div class="profile-tier-item" title="${gm.label}">
          <div class="profile-tier-icon-box">
            ${gm.icon ? `<img src="${gm.icon}" alt="${gm.label}" class="gamemode-icon" />` : ""}
          </div>
          <span class="profile-tier-label" style="color:${tierColor(tier)}">${tier}</span>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="profile-card">
      <img src="${headUrl(player.name, 96)}" alt="" class="profile-head" />
      <div class="profile-info">
        <h2 class="profile-name">${escapeHtml(player.name)}</h2>
        <div class="profile-meta">
          <span class="profile-score">${score} overall</span>
        </div>
      </div>
    </div>
    <div class="profile-details">
      <div class="profile-detail-col">
        <div class="detail-label">Region</div>
        <div class="profile-region-badge">${player.region}</div>
      </div>
      <div class="profile-detail-col profile-detail-col-grow">
        <div class="detail-label">Tiers</div>
        <div class="profile-tier-icons">
          ${tierIcons || `<p class="empty-state">No tiers recorded yet.</p>`}
        </div>
      </div>
    </div>
  `;
}

// ---------- URL routing ----------
// Clean paths like /Testing for each tab. Cloudflare Pages serves the site
// from the root, so paths are just /Home, /Testing, etc. 404.html + the
// inline script in index.html's <head> handle direct hits and refreshes.
const SITE_BASE_PATH = "/";
const PAGE_PATH_NAMES = {
  home: "Home",
  leaderboard: "Leaderboard",
  testers: "Testers",
  testing: "Testing",
  support: "Support",
  verify: "Verify",
};

function pageFromLocation() {
  let path = window.location.pathname;
  path = path.replace(/^\/+|\/+$/g, "");
  if (!path) return "home";
  const seg = path.split("/")[0].toLowerCase();
  const match = Object.keys(PAGE_PATH_NAMES).find(
    (p) => PAGE_PATH_NAMES[p].toLowerCase() === seg
  );
  return match || "home";
}

function updateUrlForPage(page) {
  const seg = PAGE_PATH_NAMES[page] !== undefined ? PAGE_PATH_NAMES[page] : "";
  const url = "/" + seg;
  if (window.location.pathname !== url) {
    history.pushState({ page }, "", url);
  }
}

window.addEventListener("popstate", () => {
  setPage(pageFromLocation(), { skipUrlUpdate: true });
});

function setPage(page, opts) {
  opts = opts || {};
  currentPage = page;
  document.querySelectorAll(".page-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  if (!opts.skipUrlUpdate) updateUrlForPage(page);

  const filterNav = document.getElementById("filter-nav");
  filterNav.style.display = page === "leaderboard" ? "flex" : "none";

  if (page === "home") {
    renderHome();
  } else if (page === "testers") {
    renderTesters();
  } else if (page === "testing") {
    renderTestingTab();
  } else if (page === "support") {
    renderSupportTab();
  } else if (page === "verify") {
    renderVerifyTab();
  } else if (page === "settings") {
    renderSettingsPage();
  } else {
    setView(currentView.type === "player" ? previousListView : currentView);
  }

  renderLiveNowWidget();
  renderRecentTestsWidget();
}

// One row of a "who tested who" list: testee head+name, gamemode icon,
// tier badge, a divider, then the tester(s) head+name.
function testRowHtml(testeeName, gamemode, tier, testerNames) {
  const gm = GAMEMODES.find((g) => g.id === gamemode) || { label: gamemode, icon: null };
  const testersHtml = (testerNames || [])
    .map(
      (t) => `
        <span class="test-row-tester">
          <img src="${headUrl(t, 20)}" alt="" class="test-row-tester-head" />
          ${escapeHtml(t)}
        </span>
      `
    )
    .join("");

  return `
    <div class="test-row">
      <div class="test-row-testee">
        <img src="${headUrl(testeeName, 24)}" alt="" class="test-row-head" />
        <span>${escapeHtml(testeeName)}</span>
      </div>
      <div class="test-row-gamemode">
        ${gm.icon ? `<img src="${gm.icon}" alt="" class="test-row-gm-icon" />` : ""}
        ${tier ? `<span class="mini-tier-label" style="color:${tierColor(tier)}">${tier}</span>` : ""}
      </div>
      <span class="test-row-divider">|</span>
      <div class="test-row-testers">${testersHtml}</div>
    </div>
  `;
}

function renderHome() {
  const title = document.getElementById("view-title");
  title.textContent = "Home";
  title.classList.remove("profile-mode");

  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="home-overview">
      <section class="home-section home-hero">
        <h2 class="home-hero-title">Welcome to <span class="home-hero-accent">RyftTiers</span></h2>
        <p class="home-hero-sub">Skill-based tier rankings for Minecraft PvP — tested by real staff, updated live.</p>
      </section>

      <section class="home-section">
        <h3>How It Works</h3>
        <ol class="home-steps">
          <li>Link your Minecraft account on the <strong>Verify</strong> tab or run <code>/verify</code> in Discord.</li>
          <li>Go to the <strong>Testing</strong> tab (or your gamemode's Discord channel) and click <strong>Join Queue</strong>.</li>
          <li>A tester will pull you into a private ticket when it's your turn.</li>
          <li>Play your test — the tester judges your skill live.</li>
          <li>Your tier is submitted and shows up on the <strong>Leaderboard</strong> instantly.</li>
        </ol>
      </section>

      <section class="home-section">
        <h3>Rules</h3>
        <ul class="home-rules">
          <li>Respect testers and other players at all times.</li>
          <li>No cheats, hacked clients, or bug exploits during a test.</li>
          <li>Don't leave mid-test without a real reason — testers volunteer their time.</li>
          <li>A cooldown applies after each test before you can re-queue for the same gamemode.</li>
          <li>Tier decisions are final unless a manager reviews and overturns them.</li>
        </ul>
      </section>

      <section class="home-section">
        <h3>What's Where</h3>
        <ul class="home-rules">
          <li><strong>Leaderboard</strong> — full rankings filtered by gamemode, region, and tier.</li>
          <li><strong>Testers</strong> — the staff doing the testing and their stats.</li>
          <li><strong>Testing</strong> — join the queue, track your position, and chat in your test ticket.</li>
          <li><strong>Support</strong> — open a ticket if you have an issue or question.</li>
          <li>The bottom-left widget shows <strong>live tests</strong> happening right now and recent results.</li>
        </ul>
      </section>
    </div>
  `;
}

// Small fixed widget in the bottom-left showing tests happening right now.
// Shown on every page (not just Home) since it's meant to always be visible.
// Compact row for the bottom-left widgets: head, name + gamemode stacked,
// optionally a tier badge pulled to the right (only for completed tests).
function liveNowRowHtml(entry) {
  const gm = GAMEMODES.find((g) => g.id === entry.gamemode) || { label: entry.gamemode };
  return `
    <div class="live-row">
      <img src="${headUrl(entry.testeeName, 32)}" alt="" class="live-row-head" />
      <div class="live-row-info">
        <div class="live-row-name">${escapeHtml(entry.testeeName)}</div>
        <div class="live-row-gamemode">${escapeHtml(gm.label)}</div>
      </div>
      ${entry.tier ? `<span class="live-row-tier" style="color:${tierColor(entry.tier)}">${entry.tier}</span>` : ""}
    </div>
  `;
}

function renderLiveNowWidget() {
  const widget = document.getElementById("live-now-widget");
  if (currentPage !== "home") {
    widget.innerHTML = "";
    widget.classList.remove("visible");
    return;
  }
  widget.classList.add("visible");
  const rowsHtml =
    LIVE_TESTS.length === 0
      ? `<p class="empty-state widget-empty-state">No one's currently testing.</p>`
      : LIVE_TESTS.map(liveNowRowHtml).join("");
  widget.innerHTML = `
    <div class="live-now-header">
      <span class="live-now-title">Active Tickets</span>
      <span class="live-now-count">${LIVE_TESTS.length}</span>
    </div>
    <div class="live-now-rows">
      ${rowsHtml}
    </div>
  `;
}

// Bottom-left widget showing every completed test from the last 48 hours.
function renderRecentTestsWidget() {
  const widget = document.getElementById("recent-tests-widget");
  if (currentPage !== "home") {
    widget.innerHTML = "";
    widget.classList.remove("visible");
    return;
  }

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = RESULTS_LOG.filter((r) => r.timestamp >= cutoff).sort(
    (a, b) => b.timestamp - a.timestamp
  );

  widget.classList.add("visible");
  const rowsHtml =
    recent.length === 0
      ? `<p class="empty-state widget-empty-state">No tests in the last 48 hours.</p>`
      : recent.map(liveNowRowHtml).join("");

  widget.innerHTML = `
    <div class="live-now-header">
      <span class="live-now-title recent-tests-title">Recent Tests</span>
      <span class="live-now-count recent-tests-badge">48H</span>
    </div>
    <div class="live-now-rows">
      ${rowsHtml}
    </div>
  `;
}

// Testers tab: aggregate the results log into a per-tester test count.
function renderTesters() {
  const title = document.getElementById("view-title");
  title.textContent = "Testers";
  title.classList.remove("profile-mode");

  const counts = new Map(); // testerName -> count
  RESULTS_LOG.forEach((r) => {
    (r.testerNames || []).forEach((name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });

  let sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (testersSearchQuery) {
    sorted = sorted.filter(([name]) => name.toLowerCase().includes(testersSearchQuery));
  }

  const container = document.getElementById("leaderboard");

  if (counts.size === 0) {
    container.innerHTML = `<p class="empty-state">No completed tests logged yet.</p>`;
    return;
  }

  const rowsHtml =
    sorted.length === 0
      ? `<tr><td colspan="3"><p class="empty-state">No testers match "${escapeHtml(testersSearchQuery)}".</p></td></tr>`
      : sorted
          .map(
            ([name, count], i) => `
              <tr class="${i < 3 ? `rank-${i + 1}` : ""}">
                <td>${i + 1}</td>
                <td>
                  <span class="player-link">
                    <img src="${headUrl(name, 24)}" alt="" class="player-head" loading="lazy" />
                    <span>${escapeHtml(name)}</span>
                  </span>
                </td>
                <td>${count}</td>
              </tr>
            `
          )
          .join("");

  container.innerHTML = `
    <input type="text" id="testers-search-input" placeholder="Search testers..." value="${escapeHtml(testersSearchQuery)}" class="testers-search" />
    <table>
      <thead>
        <tr><th>#</th><th>Tester</th><th>Tests Done</th></tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  const searchInput = document.getElementById("testers-search-input");
  searchInput.oninput = () => {
    testersSearchQuery = searchInput.value.trim().toLowerCase();
    renderTesters();
  };
  if (testersSearchQuery) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }
}

function setupSidePanel() {
  const panel = document.getElementById("side-panel");
  const tab = document.getElementById("side-panel-tab");
  const closeBtn = document.getElementById("side-panel-close");

  tab.onclick = () => {
    panel.classList.add("open");
    tab.classList.add("hidden");
  };
  closeBtn.onclick = () => {
    panel.classList.remove("open");
    tab.classList.remove("hidden");
  };
}

async function init() {
  await refreshProfile();
  renderAuthUI();
  updateVerifyTabVisibility();
  updateSettingsTabVisibility();
  await Promise.all([loadPlayers(), loadLiveTests(), loadResultsLog()]);
  buildNav();
  setupSidePanel();
  setPage(!isVerified() && currentSession ? "verify" : pageFromLocation(), { skipUrlUpdate: true });
}

init();
