// The "Testing" page: Queues + Results subtabs, backed live by Supabase.
let testingSubtab = "queues"; // "queues" | "results"
let testingGamemode = "vanilla";
let testingChannel = null;

function gmLabel(id) {
  const gm = GAMEMODES.find((g) => g.id === id);
  return gm ? gm.label : id;
}

async function fetchQueueData(gamemode) {
  const [{ data: entries }, { data: testers }, { data: closedRow }] = await Promise.all([
    sb
      .from("queue_entries")
      .select("id, player_id, joined_at, region, players!queue_entries_player_id_fkey(username)")
      .eq("gamemode", gamemode)
      .order("joined_at", { ascending: true }),
    sb
      .from("queue_testers")
      .select("player_id, players!queue_testers_player_id_fkey(username)")
      .eq("gamemode", gamemode),
    sb.from("queue_closed").select("closed").eq("gamemode", gamemode).maybeSingle(),
  ]);
  return {
    entries: entries || [],
    testers: testers || [],
    closed: closedRow ? closedRow.closed : false,
  };
}

async function fetchLiveTestsForTester() {
  if (!currentProfile) return [];
  let query = sb
    .from("live_tests")
    .select("id, gamemode, started_at, players!live_tests_player_id_fkey(username)");
  if (!currentProfile.isManager) {
    query = query.eq("tester_id", currentProfile.playerId);
  }
  const { data } = await query.order("started_at", { ascending: true });
  return data || [];
}

function renderTestingTab() {
  const container = document.getElementById("leaderboard");
  const title = document.getElementById("view-title");
  title.textContent = "Testing";
  title.classList.remove("profile-mode");

  const profileBarHtml = currentProfile
    ? `<div class="testing-profile-bar">Playing as <strong>${escapeHtml(currentProfile.username || "unknown")}</strong> (${escapeHtml(currentProfile.region || "no region set")}) <button type="button" id="testing-edit-profile-btn" class="auth-btn-small">Edit</button></div>`
    : `<div class="testing-profile-bar">Login with Discord above to join the queue or submit results.</div>`;

  container.innerHTML = `
    <div class="testing-page">
      ${profileBarHtml}
      <div class="testing-subtabs">
        <button type="button" class="testing-subtab-btn ${testingSubtab === "queues" ? "active" : ""}" data-subtab="queues">Queues</button>
        <button type="button" class="testing-subtab-btn ${testingSubtab === "results" ? "active" : ""}" data-subtab="results">Results</button>
      </div>
      <div id="testing-subtab-content"></div>
    </div>
  `;

  const editBtn = document.getElementById("testing-edit-profile-btn");
  if (editBtn) editBtn.onclick = editMyProfile;

  container.querySelectorAll(".testing-subtab-btn").forEach((btn) => {
    btn.onclick = () => {
      testingSubtab = btn.dataset.subtab;
      renderTestingTab();
    };
  });

  if (testingSubtab === "queues") {
    renderQueuesSubtab();
  } else {
    renderResultsSubtab();
  }
  subscribeQueueRealtime();
}

async function renderQueuesSubtab() {
  const el = document.getElementById("testing-subtab-content");
  el.innerHTML = `
    <div class="testing-gamemode-tabs">
      ${GAMEMODES.map(
        (gm) => `
        <button type="button" class="testing-gm-btn ${gm.id === testingGamemode ? "active" : ""}" data-gm="${gm.id}">
          ${gm.icon ? `<img src="${gm.icon}" class="testing-gm-icon" alt="" />` : ""}${gm.label}
        </button>`
      ).join("")}
    </div>
    <div id="queue-panel" class="queue-panel"><p class="empty-state">Loading queue...</p></div>
  `;
  el.querySelectorAll(".testing-gm-btn").forEach((btn) => {
    btn.onclick = () => {
      testingGamemode = btn.dataset.gm;
      renderQueuesSubtab();
    };
  });

  await loadAndRenderQueuePanel();
}

async function loadAndRenderQueuePanel() {
  const panel = document.getElementById("queue-panel");
  if (!panel) return;
  const { entries, testers, closed } = await fetchQueueData(testingGamemode);

  const isLoggedIn = !!currentProfile;
  const isTester = isLoggedIn && currentProfile.isTester;
  const myPlayerId = isLoggedIn ? currentProfile.playerId : null;

  const queueRows =
    entries.length === 0
      ? `<p class="empty-state">No one in queue.</p>`
      : entries
          .map(
            (e, i) => `
        <div class="queue-row">
          <span class="queue-row-rank">${i + 1}</span>
          <img src="${headUrl(e.players.username, 24)}" class="queue-row-head" alt="" />
          <span class="queue-row-name">${escapeHtml(e.players.username)}</span>
          <span class="queue-row-region">${escapeHtml(e.region)}</span>
        </div>`
          )
          .join("");

  const testerRows =
    testers.length === 0
      ? `<p class="empty-state">No testers active.</p>`
      : testers.map((t) => `<span class="queue-tester-chip">${escapeHtml(t.players.username)}</span>`).join("");

  let actionsHtml = "";
  if (!isLoggedIn) {
    actionsHtml = `<p class="empty-state">Login with Discord to join the queue.</p>`;
  } else if (isTester) {
    const amTesting = testers.some((t) => t.player_id === myPlayerId);
    actionsHtml = `
      <div class="queue-actions">
        <button type="button" id="toggle-testing-btn" class="auth-btn">${amTesting ? "Stop Testing" : "Start Testing"}</button>
        <button type="button" id="toggle-closed-btn" class="auth-btn">${closed ? "Open Queue" : "Close Queue"}</button>
        <button type="button" id="claim-next-btn" class="auth-btn auth-btn-primary" ${entries.length === 0 ? "disabled" : ""}>Claim Next</button>
      </div>
    `;
  } else {
    const myEntry = entries.find((e) => e.player_id === myPlayerId);
    actionsHtml = `
      <div class="queue-actions">
        <button type="button" id="join-leave-btn" class="auth-btn auth-btn-primary" ${closed && !myEntry ? "disabled" : ""}>
          ${myEntry ? "Leave Queue" : closed ? "Queue Closed" : "Join Queue"}
        </button>
      </div>
    `;
  }

  panel.innerHTML = `
    ${closed ? `<div class="queue-closed-banner">Queue is closed</div>` : ""}
    <div class="queue-columns">
      <div class="queue-column">
        <div class="queue-column-header">Queue (${entries.length})</div>
        ${queueRows}
      </div>
      <div class="queue-column queue-column-narrow">
        <div class="queue-column-header">Testers Online</div>
        <div class="queue-tester-chips">${testerRows}</div>
      </div>
    </div>
    ${actionsHtml}
  `;

  const joinLeaveBtn = document.getElementById("join-leave-btn");
  if (joinLeaveBtn) {
    joinLeaveBtn.onclick = async () => {
      const myEntry = entries.find((e) => e.player_id === myPlayerId);
      joinLeaveBtn.disabled = true;
      try {
        if (myEntry) {
          const { error } = await sb.rpc("leave_queue", { p_gamemode: testingGamemode });
          if (error) throw error;
        } else {
          const region = prompt("Your region? (NA, EU, AS, ME, AU)", currentProfile.region || "NA");
          if (!region) {
            joinLeaveBtn.disabled = false;
            return;
          }
          const { error } = await sb.rpc("join_queue", {
            p_gamemode: testingGamemode,
            p_region: region.trim().toUpperCase(),
          });
          if (error) throw error;
        }
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      await loadAndRenderQueuePanel();
    };
  }

  const toggleTestingBtn = document.getElementById("toggle-testing-btn");
  if (toggleTestingBtn) {
    toggleTestingBtn.onclick = async () => {
      const amTesting = testers.some((t) => t.player_id === myPlayerId);
      toggleTestingBtn.disabled = true;
      try {
        const { error } = amTesting
          ? await sb.rpc("leave_testing", { p_gamemode: testingGamemode })
          : await sb.rpc("join_testing", { p_gamemode: testingGamemode });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      await loadAndRenderQueuePanel();
    };
  }

  const toggleClosedBtn = document.getElementById("toggle-closed-btn");
  if (toggleClosedBtn) {
    toggleClosedBtn.onclick = async () => {
      toggleClosedBtn.disabled = true;
      try {
        const { error } = await sb.rpc("set_queue_closed", {
          p_gamemode: testingGamemode,
          p_closed: !closed,
        });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      await loadAndRenderQueuePanel();
    };
  }

  const claimNextBtn = document.getElementById("claim-next-btn");
  if (claimNextBtn) {
    claimNextBtn.onclick = async () => {
      claimNextBtn.disabled = true;
      try {
        const { error } = await sb.rpc("claim_next", { p_gamemode: testingGamemode });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      await loadAndRenderQueuePanel();
    };
  }
}

async function renderResultsSubtab() {
  const el = document.getElementById("testing-subtab-content");
  if (!el) return;

  if (!currentProfile) {
    el.innerHTML = `<p class="empty-state">Login with Discord to see this.</p>`;
    return;
  }
  if (!currentProfile.isTester) {
    el.innerHTML = `<p class="empty-state">Only testers can submit results here. Check the Leaderboard tab for standings.</p>`;
    return;
  }

  el.innerHTML = `<p class="empty-state">Loading...</p>`;
  const live = await fetchLiveTestsForTester();

  if (live.length === 0) {
    el.innerHTML = `<p class="empty-state">No active tests. Claim someone from the Queues tab to get started.</p>`;
    return;
  }

  el.innerHTML = live
    .map(
      (t) => `
    <div class="result-row" data-live-id="${t.id}">
      <img src="${headUrl(t.players.username, 32)}" class="result-row-head" alt="" />
      <div class="result-row-info">
        <div class="result-row-name">${escapeHtml(t.players.username)}</div>
        <div class="result-row-gamemode">${escapeHtml(gmLabel(t.gamemode))}</div>
      </div>
      <select class="result-tier-select">
        <option value="">Select tier</option>
        ${TIER_ORDER.map((tier) => `<option value="${tier}">${tier}</option>`).join("")}
      </select>
      <button type="button" class="auth-btn auth-btn-primary result-submit-btn">Submit</button>
      <button type="button" class="auth-btn result-cancel-btn">Cancel</button>
    </div>`
    )
    .join("");

  el.querySelectorAll(".result-row").forEach((row) => {
    const liveId = Number(row.dataset.liveId);
    row.querySelector(".result-submit-btn").onclick = async () => {
      const tier = row.querySelector(".result-tier-select").value;
      if (!tier) {
        alert("Pick a tier first.");
        return;
      }
      try {
        const { error } = await sb.rpc("submit_result", { p_live_test_id: liveId, p_tier: tier });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      renderResultsSubtab();
    };
    row.querySelector(".result-cancel-btn").onclick = async () => {
      try {
        const { error } = await sb.rpc("cancel_live_test", { p_live_test_id: liveId });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      renderResultsSubtab();
    };
  });
}

function subscribeQueueRealtime() {
  if (testingChannel) {
    sb.removeChannel(testingChannel);
    testingChannel = null;
  }
  testingChannel = sb
    .channel("queue-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => {
      if (currentPage === "testing" && testingSubtab === "queues") loadAndRenderQueuePanel();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_testers" }, () => {
      if (currentPage === "testing" && testingSubtab === "queues") loadAndRenderQueuePanel();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_closed" }, () => {
      if (currentPage === "testing" && testingSubtab === "queues") loadAndRenderQueuePanel();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_tests" }, () => {
      if (currentPage === "testing" && testingSubtab === "results") renderResultsSubtab();
    })
    .subscribe();
}

// Called by supabase-client.js whenever login state changes.
function onAuthChanged() {
  const wasShowingVerify = document.getElementById("verify-tab-btn")?.style.display !== "none";
  updateVerifyTabVisibility();
  const nowShowingVerify = document.getElementById("verify-tab-btn")?.style.display !== "none";
  // Just logged in and not verified yet — take them straight to the form.
  if (!wasShowingVerify && nowShowingVerify) {
    setPage("verify");
  }

  if (currentPage === "testing") renderTestingTab();
  if (currentPage === "support") renderSupportTab();
}
