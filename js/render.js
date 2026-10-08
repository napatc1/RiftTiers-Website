let PLAYERS = [];
let LIVE_TESTS = [];
let RESULTS_LOG = [];
let TESTER_PROFILES = [];   // [{username, region, isSeniorTester, isManager, isModerator, isOwner, count}]
let testerDataLoaded = false;

// page = "home" | "leaderboard" | "testers"
let currentPage = "home";
let appInitDone = false;

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
  applications: "Applications",
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
  // sync active state in the hamburger drawer too
  const drawer = document.getElementById("nav-drawer");
  if (drawer) {
    drawer.querySelectorAll(".page-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === page);
    });
  }
  if (!opts.skipUrlUpdate) updateUrlForPage(page);

  const filterNav = document.getElementById("filter-nav");
  filterNav.style.display = page === "leaderboard" ? "flex" : "none";

  // Reset leaderboard container styles that applications page overrides
  if (page !== "applications") {
    const lb = document.getElementById("leaderboard");
    lb.style.overflow = "";
    lb.style.background = "";
    lb.style.border = "";
    lb.style.borderRadius = "";
  }

  if (page === "home") {
    renderHome();
  } else if (page === "testers") {
    renderTesters();
  } else if (page === "testing") {
    renderTestingTab();
  } else if (page === "support") {
    renderSupportTab();
  } else if (page === "applications") {
    renderApplicationsTab();
  } else if (page === "verify") {
    renderVerifyTab();
  } else if (page === "settings") {
    renderSettingsPage();
  } else {
    setView(currentView.type === "player" ? previousListView : currentView);
  }

  renderLiveNowWidget();
  renderRecentTestsWidget();

  // hide the "TESTS" tab button on the home page (nothing to show there)
  const sideTab = document.getElementById("side-panel-tab");
  if (sideTab) sideTab.classList.toggle("hidden", page === "home");
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

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function announcementTagClass(tag) {
  const map = { Launch: "tag-launch", Feature: "tag-feature", Update: "tag-update", Fix: "tag-fix" };
  return map[tag] || "tag-update";
}

async function renderHome() {
  const title = document.getElementById("view-title");
  title.textContent = "Home";
  title.classList.remove("profile-mode");

  const container = document.getElementById("leaderboard");

  // --- Derive data from already-loaded globals ---

  // Gamemode player counts from PLAYERS (each player can have multiple gamemode tiers)
  const gamemodeCounts = new Map();
  GAMEMODES.forEach((gm) => gamemodeCounts.set(gm.id, 0));
  PLAYERS.forEach((p) => {
    Object.keys(p.tiers || {}).forEach((gmId) => {
      if (gamemodeCounts.has(gmId)) {
        gamemodeCounts.set(gmId, gamemodeCounts.get(gmId) + 1);
      }
    });
  });

  const totalPlayers = PLAYERS.length;

  // Active testers section from LIVE_TESTS
  const activeTesters = [];
  const seenTesters = new Set();
  LIVE_TESTS.forEach((t) => {
    (t.testerNames || []).forEach((name) => {
      if (!seenTesters.has(name)) {
        seenTesters.add(name);
        activeTesters.push({ name, gamemode: t.gamemode, testeeName: t.testeeName });
      }
    });
  });

  // All recent results
  const highResults = RESULTS_LOG.slice(0, 12);

  // --- Build gamemode cards HTML ---
  const gamemodeCardsHtml = GAMEMODES.map((gm) => {
    const count = gamemodeCounts.get(gm.id) || 0;
    return `
      <div class="home-gm-card">
        <div class="home-gm-icon-wrap">
          ${gm.icon ? `<img src="${gm.icon}" alt="${escapeHtml(gm.label)}" class="home-gm-icon" />` : `<span class="home-gm-icon-placeholder"></span>`}
        </div>
        <div class="home-gm-label">${escapeHtml(gm.label)}</div>
        <div class="home-gm-count">${count} Ranked</div>
      </div>
    `;
  }).join("");

  // --- Active testers HTML ---
  const activeTestersHtml = activeTesters.length === 0
    ? `<p class="empty-state">No active tests right now.</p>`
    : activeTesters.map((t) => {
        const gm = GAMEMODES.find((g) => g.id === t.gamemode) || { label: t.gamemode };
        return `
          <div class="home-tester-card">
            <img src="${headUrl(t.name, 32)}" alt="" class="home-tester-head" />
            <div class="home-tester-info">
              <div class="home-tester-name">${escapeHtml(t.name)}</div>
              <div class="home-tester-meta">Testing <strong>${escapeHtml(t.testeeName)}</strong> · ${escapeHtml(gm.label)}</div>
            </div>
            <span class="home-tester-live-dot"></span>
          </div>
        `;
      }).join("");

  // --- All recent results HTML ---
  const highResultsHtml = highResults.length === 0
    ? `<p class="empty-state">No results yet.</p>`
    : highResults.map((r) => {
        const gm = GAMEMODES.find((g) => g.id === r.gamemode) || { label: r.gamemode };
        const tc = tierColor(r.tier);
        return `
          <div class="home-ht-row" style="border-left-color:${tc}">
            <img src="${headUrl(r.testeeName, 32)}" alt="" class="home-ht-head" />
            <div class="home-ht-info">
              <span class="home-ht-name">${escapeHtml(r.testeeName)}</span>
              <span class="home-ht-gm">${escapeHtml(gm.label)}</span>
            </div>
            <span class="home-ht-tier" style="background:${tc}20;color:${tc};border:1px solid ${tc}50">${escapeHtml(r.tier)}</span>
            <span class="home-ht-time">${relativeTime(r.timestamp)}</span>
          </div>
        `;
      }).join("");

  // --- Render skeleton with live sections ---
  container.innerHTML = `
    <div class="home-overview">

      <!-- Hero Card -->
      <section class="home-hero-card">
        <div class="home-hero-label">COMBAT LEADERBOARD</div>
        <h1 class="home-hero-title">RyftTiers</h1>
        <p class="home-hero-sub">Skill-based tier rankings for Minecraft PvP — tested by real staff, updated live.</p>
        <div class="home-hero-actions">
          <button class="home-hero-cta" onclick="setPage('leaderboard')">View Rankings</button>
          <a class="home-hero-discord" href="https://discord.gg/ph7HykudFx" target="_blank" rel="noopener">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
            discord.gg/ph7HykudFx
          </a>
        </div>
        <div class="home-hero-stats-row">
          <div class="home-hero-stat">
            <span class="home-hero-stat-value">${totalPlayers.toLocaleString()}</span>
            <span class="home-hero-stat-label">Ranked</span>
          </div>
          <div class="home-hero-stat">
            <span class="home-hero-stat-value home-hero-stat-value--green">${activeTesters.length}</span>
            <span class="home-hero-stat-label">Live Tests</span>
          </div>
          <div class="home-hero-stat">
            <span class="home-hero-stat-value home-hero-stat-value--blue">${GAMEMODES.length}</span>
            <span class="home-hero-stat-label">Gamemodes</span>
          </div>
        </div>
      </section>

      <!-- Gamemode Cards -->
      <section class="home-section">
        <h3 class="home-section-heading">Gamemodes</h3>
        <div class="home-gm-grid">
          ${gamemodeCardsHtml}
        </div>
      </section>

      <!-- Active Testers -->
      <section class="home-section">
        <h3 class="home-section-heading">
          Active Testers
          ${activeTesters.length > 0 ? `<span class="home-section-badge home-section-badge--live">${activeTesters.length} Live</span>` : ""}
        </h3>
        <div class="home-testers-list">
          ${activeTestersHtml}
        </div>
      </section>

      <!-- Recent Results -->
      <section class="home-section">
        <h3 class="home-section-heading">
          Recent Results
          <span class="home-section-badge">Live</span>
        </h3>
        <div class="home-ht-list">
          ${highResultsHtml}
        </div>
      </section>

      <!-- Announcements -->
      <section class="home-section home-news-section">
        <h3 class="home-section-heading">News &amp; Updates</h3>
        <div class="home-news-list" id="home-news-list">
          <p class="empty-state">Loading…</p>
        </div>
      </section>

    </div>
  `;

  // Now load announcements and fill the news list
  try {
    const { data, error } = await sb
      .from("announcements")
      .select("id, title, body, tag, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    const newsList = document.getElementById("home-news-list");
    if (!newsList) return; // user navigated away

    if (error || !data || data.length === 0) {
      newsList.innerHTML = `<p class="empty-state">No announcements yet.</p>`;
      return;
    }

    function newsCardHtml(a) {
      return `
        <div class="news-card">
          <div class="news-card-header">
            <span class="news-tag ${announcementTagClass(a.tag)}">${escapeHtml(a.tag)}</span>
            <span class="news-time">${relativeTime(a.created_at)}</span>
          </div>
          <div class="news-card-title">${escapeHtml(a.title)}</div>
          <div class="news-card-body">${escapeHtml(a.body)}</div>
        </div>
      `;
    }

    const visible = data.slice(0, 3);
    const hidden  = data.slice(3);

    newsList.innerHTML =
      visible.map(newsCardHtml).join("") +
      (hidden.length > 0 ? `
        <div class="news-older" id="news-older" style="display:none">
          ${hidden.map(newsCardHtml).join("")}
        </div>
        <button class="news-show-more" id="news-show-more">
          Show ${hidden.length} older announcement${hidden.length !== 1 ? "s" : ""}
        </button>
      ` : "");

    const btn = document.getElementById("news-show-more");
    if (btn) {
      btn.onclick = () => {
        document.getElementById("news-older").style.display = "";
        btn.remove();
      };
    }
  } catch (err) {
    const newsList = document.getElementById("home-news-list");
    if (newsList) newsList.innerHTML = `<p class="empty-state">Couldn't load announcements.</p>`;
  }
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
  if (currentPage === "home") {
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
  if (currentPage === "home") {
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

async function loadTesterData() {
  if (testerDataLoaded) return;
  const [{ data: profiles }, { data: logs }] = await Promise.all([
    sb.from("profiles")
      .select("is_tester, is_senior_tester, is_manager, is_moderator, is_owner, players(username, region)")
      .eq("is_tester", true),
    sb.from("test_log").select("tester_names"),
  ]);

  const counts = new Map();
  (logs || []).forEach((r) => {
    (r.tester_names || []).forEach((name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });

  TESTER_PROFILES = (profiles || [])
    .filter((p) => p.players)
    .map((p) => ({
      username: p.players.username,
      region: p.players.region,
      isSeniorTester: !!p.is_senior_tester,
      isManager: !!p.is_manager,
      isModerator: !!p.is_moderator,
      isOwner: !!p.is_owner,
      count: counts.get(p.players.username) || 0,
    }));

  testerDataLoaded = true;
}

function testerRoleRank(p) {
  if (p.isOwner) return 4;
  if (p.isManager) return 3;
  if (p.isSeniorTester) return 2;
  return 1;
}

function testerRoleBadge(p) {
  if (p.isOwner) return `<span class="role-badge role-owner">Owner</span>`;
  if (p.isManager) return `<span class="role-badge role-manager">Manager</span>`;
  if (p.isSeniorTester) return `<span class="role-badge role-senior">Sr. Tester</span>`;
  return `<span class="role-badge role-tester">Tester</span>`;
}

// Testers tab: all active testers with roles and full test counts.
async function renderTesters() {
  const title = document.getElementById("view-title");
  title.textContent = "Testers";
  title.classList.remove("profile-mode");

  const container = document.getElementById("leaderboard");
  if (!testerDataLoaded) {
    container.innerHTML = `<p class="empty-state">Loading...</p>`;
  }

  await loadTesterData();

  let entries = [...TESTER_PROFILES].sort(
    (a, b) => b.count - a.count || testerRoleRank(b) - testerRoleRank(a)
  );

  if (testersSearchQuery) {
    entries = entries.filter((e) =>
      e.username.toLowerCase().includes(testersSearchQuery)
    );
  }

  const rowsHtml =
    entries.length === 0
      ? `<tr><td colspan="4"><p class="empty-state">${testersSearchQuery ? `No testers match "${escapeHtml(testersSearchQuery)}".` : "No testers yet."}</p></td></tr>`
      : entries
          .map(
            (p, i) => `
              <tr class="${i < 3 ? `rank-${i + 1}` : ""}">
                <td>${i + 1}</td>
                <td>
                  <span class="player-link">
                    <img src="${headUrl(p.username, 24)}" alt="" class="player-head" loading="lazy" />
                    <span>${escapeHtml(p.username)}</span>
                  </span>
                </td>
                <td>${testerRoleBadge(p)}</td>
                <td>${p.count}</td>
              </tr>
            `
          )
          .join("");

  container.innerHTML = `
    <input type="text" id="testers-search-input" placeholder="Search testers..." value="${escapeHtml(testersSearchQuery)}" class="testers-search" />
    <table>
      <thead>
        <tr><th>#</th><th>Tester</th><th>Role</th><th>Tests</th></tr>
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

function setupNavHamburger() {
  const hamburger = document.getElementById("nav-hamburger");
  const drawer = document.getElementById("nav-drawer");
  if (!hamburger || !drawer) return;

  hamburger.onclick = () => {
    const open = drawer.classList.toggle("open");
    hamburger.classList.toggle("open", open);
    hamburger.setAttribute("aria-expanded", open);
  };

  // close drawer when a tab is picked
  drawer.querySelectorAll(".page-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      drawer.classList.remove("open");
      hamburger.classList.remove("open");
      hamburger.setAttribute("aria-expanded", "false");
    });
  });

  // close on outside tap
  document.addEventListener("click", (e) => {
    if (!hamburger.contains(e.target) && !drawer.contains(e.target)) {
      drawer.classList.remove("open");
      hamburger.classList.remove("open");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });
}

async function init() {
  await refreshProfile();
  renderAuthUI();
  updateVerifyTabVisibility();
  updateSettingsTabVisibility();
  await Promise.all([loadPlayers(), loadLiveTests(), loadResultsLog()]);
  buildNav();
  setupSidePanel();
  setupNavHamburger();
  const urlPage = pageFromLocation();
  // Only auto-redirect to verify when the user landed at root ("/") — not
  // when they refreshed a specific page like /Testers.
  const startPage = (!isVerified() && currentSession && urlPage === "home") ? "verify" : urlPage;
  setPage(startPage, { skipUrlUpdate: true });
  appInitDone = true;
}

init();
