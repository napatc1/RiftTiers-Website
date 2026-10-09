// The "Testing" page: Queues + Tests + Results + High Test subtabs, backed live by Supabase.
const DISCORD_GUILD_ID = "1555512928365576244"; // RyftTiers server ID

let testingSubtab = "queues"; // "queues" | "tests" | "results" | "hightest"
let testingGamemode = "vanilla";
let testingRegion = null; // the region tab currently being viewed
let testingChannel = null;

function gmLabel(id) {
  const gm = GAMEMODES.find((g) => g.id === id);
  return gm ? gm.label : id;
}

// Managers/moderators/owners can look at and manage any region's queue;
// everyone else (including ordinary testers) is locked to their own.
function isRegionStaff() {
  return !!(currentProfile && (currentProfile.isManager || currentProfile.isModerator || currentProfile.isOwner));
}

// Whichever region the panel should currently show: the region tab staff
// picked, or the player's own profile region for everyone else.
function effectiveTestingRegion() {
  if (isRegionStaff() && testingRegion) return testingRegion;
  return currentProfile ? currentProfile.region : null;
}

async function fetchQueueData(gamemode, region) {
  const key = `${gamemode}:${region}`;
  const [{ data: entries }, { data: testers }, { data: closedRow }] = await Promise.all([
    sb
      .from("queue_entries")
      .select("id, player_id, joined_at, region, players!queue_entries_player_id_fkey(username)")
      .eq("gamemode", key)
      .order("joined_at", { ascending: true }),
    sb
      .from("queue_testers")
      .select("player_id, players!queue_testers_player_id_fkey(username)")
      .eq("gamemode", key),
    sb.from("queue_closed").select("closed, locked").eq("gamemode", key).maybeSingle(),
  ]);
  return {
    entries: entries || [],
    testers: testers || [],
    closed: closedRow ? closedRow.closed : true,
    locked: closedRow ? closedRow.locked : false,
  };
}

async function fetchLiveTestsForTester() {
  if (!currentProfile) return [];
  let query = sb
    .from("live_tests")
    .select("id, gamemode, region, started_at, discord_ticket_channel_id, players!live_tests_player_id_fkey(username)");
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
        <button type="button" class="testing-subtab-btn ${testingSubtab === "tests" ? "active" : ""}" data-subtab="tests">Tests</button>
        <button type="button" class="testing-subtab-btn ${testingSubtab === "results" ? "active" : ""}" data-subtab="results">Results</button>
        <button type="button" class="testing-subtab-btn ${testingSubtab === "hightest" ? "active" : ""}" data-subtab="hightest">High Test</button>
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
  } else if (testingSubtab === "tests") {
    renderTestsSubtab();
  } else if (testingSubtab === "hightest") {
    renderHighTestSubtab();
  } else {
    renderResultsSubtab();
  }
  subscribeQueueRealtime();
}

async function renderQueuesSubtab() {
  const el = document.getElementById("testing-subtab-content");
  const region = effectiveTestingRegion();
  const regionTabsHtml = isRegionStaff()
    ? `
    <div class="testing-region-tabs">
      ${REGIONS.map(
        (r) => `
        <button type="button" class="testing-region-btn ${r === region ? "active" : ""}" data-region="${r}">${r}</button>`
      ).join("")}
    </div>`
    : "";

  el.innerHTML = `
    <div class="testing-gamemode-tabs">
      ${GAMEMODES.map(
        (gm) => `
        <button type="button" class="testing-gm-btn ${gm.id === testingGamemode ? "active" : ""}" data-gm="${gm.id}">
          ${gm.icon ? `<img src="${gm.icon}" class="testing-gm-icon" alt="" />` : ""}${gm.label}
        </button>`
      ).join("")}
    </div>
    ${regionTabsHtml}
    <div id="queue-panel" class="queue-panel"><p class="empty-state">Loading queue...</p></div>
  `;
  el.querySelectorAll(".testing-gm-btn").forEach((btn) => {
    btn.onclick = () => {
      testingGamemode = btn.dataset.gm;
      renderQueuesSubtab();
    };
  });
  el.querySelectorAll(".testing-region-btn").forEach((btn) => {
    btn.onclick = () => {
      testingRegion = btn.dataset.region;
      renderQueuesSubtab();
    };
  });

  await loadAndRenderQueuePanel();
}

async function loadAndRenderQueuePanel() {
  const panel = document.getElementById("queue-panel");
  if (!panel) return;
  const region = effectiveTestingRegion();
  if (!region) {
    panel.innerHTML = `<p class="empty-state">Set your region (Edit profile) to see your queue.</p>`;
    return;
  }
  const { entries, testers, closed, locked } = await fetchQueueData(testingGamemode, region);
  // Staff viewing a region other than their own can still manage that
  // queue, but server-side RPCs require them to pass it explicitly — a
  // normal tester/testee never needs this since they only ever see their
  // own region.
  const regionOverride = isRegionStaff() && region !== currentProfile.region ? region : undefined;

  const isLoggedIn = !!currentProfile;
  const isTester = isLoggedIn && currentProfile.isTester;
  const myPlayerId = isLoggedIn ? currentProfile.playerId : null;
  const myEntry = isLoggedIn ? entries.find((e) => e.player_id === myPlayerId) : null;
  // Testers can join/queue as a player too (same as Discord), and — like
  // Discord — they can join even while the queue is closed or locked, so
  // the restriction below only applies to non-testers.
  const joinBlocked = !isTester && (closed || locked) && !myEntry;
  const joinLabel = myEntry ? "Leave Queue" : closed ? "Queue Closed" : locked ? "Queue Locked" : "Join Queue";

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

  // Shared between testers and regular players — testers get this
  // alongside their own controls below, since a tester can queue up as a
  // player too (same as the Discord side).
  const joinLeaveButtonHtml = `
    <button type="button" id="join-leave-btn" class="auth-btn auth-btn-primary" ${joinBlocked ? "disabled" : ""}>
      ${joinLabel}
    </button>
  `;

  let actionsHtml = "";
  if (!isLoggedIn) {
    actionsHtml = `<p class="empty-state">Login with Discord to join the queue.</p>`;
  } else if (isTester) {
    actionsHtml = `
      <div class="queue-actions">
        <button type="button" id="toggle-closed-btn" class="auth-btn">${closed ? "Open Queue" : "Close Queue"}</button>
        <button type="button" id="claim-next-btn" class="auth-btn auth-btn-primary" ${entries.length === 0 ? "disabled" : ""}>Next / Pull</button>
        ${joinLeaveButtonHtml}
      </div>
    `;
  } else {
    actionsHtml = `
      <div class="queue-actions">
        ${joinLeaveButtonHtml}
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
      joinLeaveBtn.disabled = true;
      try {
        if (myEntry) {
          const { error } = await sb.rpc("leave_queue", { p_gamemode: testingGamemode, p_high: false });
          if (error) throw error;
        } else {
          // Region is no longer asked for — joining always uses the
          // player's own verified profile region, same as Discord.
          const { error } = await sb.rpc("join_queue", { p_gamemode: testingGamemode });
          if (error) throw error;
        }
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
        const opening = closed; // true if we're about to open it
        // Region is only passed when staff is managing a region other than
        // their own — a normal tester always manages their own region, which
        // the function derives server-side.
        const { error } = await sb.rpc("set_queue_closed", {
          p_gamemode: testingGamemode,
          p_closed: !closed,
          p_region: regionOverride,
          p_high: false,
        });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
        return;
      }
      // Auto-join as active tester when opening (best-effort, errors silenced).
      if (opening) {
        await sb.rpc("join_testing", { p_gamemode: testingGamemode });
      }
      await loadAndRenderQueuePanel();
    };
  }

  const claimNextBtn = document.getElementById("claim-next-btn");
  if (claimNextBtn) {
    claimNextBtn.onclick = async () => {
      claimNextBtn.disabled = true;
      try {
        const { error } = await sb.rpc("claim_next", {
          p_gamemode: testingGamemode,
          p_region: regionOverride,
          p_high: false,
        });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Something went wrong.");
      }
      await loadAndRenderQueuePanel();
    };
  }
}

// Which live test's chat panel is currently open (by live_test id).
let openTestChatId = null;
let testChatChannel = null;

// Which hightest ticket thread is currently open (by support_ticket id).
let openHighTestTicketId = null;
let highTestChannel = null;

async function loadHighTestTickets() {
  if (!currentProfile) return [];
  let q = sb
    .from("support_tickets")
    .select("id, subject, status, created_at")
    .eq("category", "hightest")
    .order("created_at", { ascending: false });
  if (!currentProfile.isModerator && !currentProfile.isOwner) {
    q = q.eq("player_id", currentProfile.playerId);
  }
  const { data } = await q;
  return data || [];
}

async function renderTestsSubtab() {
  const el = document.getElementById("testing-subtab-content");
  if (!el) return;

  if (!currentProfile) {
    el.innerHTML = `<p class="empty-state">Login with Discord to see active tests.</p>`;
    return;
  }

  el.innerHTML = `<p class="empty-state">Loading...</p>`;

  const [live, htTickets] = await Promise.all([
    currentProfile.isTester ? fetchLiveTestsForTester() : Promise.resolve([]),
    loadHighTestTickets(),
  ]);

  if (openTestChatId && !live.find((t) => t.id === openTestChatId)) openTestChatId = null;
  if (openHighTestTicketId && !htTickets.find((t) => t.id === openHighTestTicketId)) openHighTestTicketId = null;

  if (!currentProfile.isTester && htTickets.length === 0) {
    el.innerHTML = `<p class="empty-state">No high tier test requests yet.</p>`;
    return;
  }
  if (currentProfile.isTester && live.length === 0 && htTickets.length === 0) {
    el.innerHTML = `<p class="empty-state">No active tests right now.</p>`;
    return;
  }

  el.innerHTML = `<div class="tests-list" id="tests-list-inner"></div>`;
  const list = document.getElementById("tests-list-inner");

  // Live tests section (testers only)
  if (currentProfile.isTester && live.length > 0) {
    const heading = document.createElement("div");
    heading.className = "tests-section-heading";
    heading.textContent = "Active Tests";
    list.appendChild(heading);

    for (const t of live) {
      const wrap = document.createElement("div");
      wrap.className = "test-ticket-wrap";
      wrap.dataset.liveId = t.id;

      const isOpen = openTestChatId === t.id;
      wrap.innerHTML = `
        <div class="test-ticket-row${isOpen ? " test-ticket-row-open" : ""}">
          <img src="${headUrl(t.players.username, 32)}" class="result-row-head" alt="" />
          <div class="result-row-info">
            <div class="result-row-name">${escapeHtml(t.players.username)}${t.gamemode.includes("(high)") ? ` <span class="high-test-badge">High Test</span>` : ""}</div>
            <div class="result-row-gamemode">${escapeHtml(gmLabel(t.gamemode))} &bull; ${escapeHtml(t.region || "")}</div>
          </div>
          <span class="test-ticket-status">In Progress</span>
          ${t.discord_ticket_channel_id
            ? `<button type="button" class="open-ticket-btn" data-action="open-chat">Open Ticket</button>`
            : `<span class="test-ticket-discord test-ticket-pending">Creating channel…</span>`}
        </div>
        ${isOpen ? `<div class="test-chat-panel" id="chat-panel-${t.id}"></div>` : ""}
      `;

      const openBtn = wrap.querySelector("[data-action='open-chat']");
      if (openBtn) {
        openBtn.onclick = () => {
          openTestChatId = openTestChatId === t.id ? null : t.id;
          renderTestsSubtab();
        };
      }

      list.appendChild(wrap);
      if (isOpen) renderTestChatPanel(t.id);
    }
  }

  // High Test requests section
  if (htTickets.length > 0) {
    const heading = document.createElement("div");
    heading.className = "tests-section-heading";
    heading.textContent = "High Test Requests";
    list.appendChild(heading);

    for (const t of htTickets) {
      const isOpen = openHighTestTicketId === t.id;
      const date = new Date(t.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      const wrap = document.createElement("div");
      wrap.className = "test-ticket-wrap";

      wrap.innerHTML = `
        <div class="test-ticket-row${isOpen ? " test-ticket-row-open" : ""}">
          <div class="result-row-info">
            <div class="result-row-name">${escapeHtml(t.subject)}</div>
            <div class="result-row-gamemode">${date}</div>
          </div>
          <span class="support-ticket-status support-ticket-status-${t.status}">${t.status}</span>
          <button type="button" class="open-ticket-btn">${isOpen ? "Close" : "View Thread"}</button>
        </div>
        ${isOpen ? `<div class="test-chat-panel" id="hightest-panel-${t.id}"></div>` : ""}
      `;

      wrap.querySelector(".open-ticket-btn").onclick = () => {
        if (openHighTestTicketId === t.id) {
          openHighTestTicketId = null;
          if (highTestChannel) { sb.removeChannel(highTestChannel); highTestChannel = null; }
        } else {
          openHighTestTicketId = t.id;
        }
        renderTestsSubtab();
      };

      list.appendChild(wrap);

      if (isOpen) {
        const panel = document.getElementById(`hightest-panel-${t.id}`);
        if (panel) renderHighTestPanel(panel, t.id);
      }
    }
  }

  subscribeTestChatRealtime();
}

async function renderHighTestPanel(panelEl, ticketId) {
  panelEl.innerHTML = `<div class="test-chat-messages"><p class="test-chat-empty">Loading…</p></div>`;

  const [{ data: ticket }, { data: messages }] = await Promise.all([
    sb.from("support_tickets").select("id, subject, status").eq("id", ticketId).single(),
    sb.from("support_messages")
      .select("id, author_label, source, content, created_at, edited_at, players(username)")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
  ]);

  if (!ticket) {
    panelEl.innerHTML = `<p class="test-chat-empty">Ticket not found.</p>`;
    return;
  }

  renderHighTestMessages(panelEl, messages || []);

  if (ticket.status === "open") {
    if (!panelEl.querySelector(".test-chat-input-row")) {
      const row = document.createElement("div");
      row.className = "test-chat-input-row";
      row.innerHTML = `
        <input type="text" class="test-chat-input" placeholder="Type a reply…" maxlength="800" />
        <button type="button" class="test-chat-send-btn">Send</button>
      `;
      panelEl.appendChild(row);

      const input = row.querySelector(".test-chat-input");
      const btn = row.querySelector(".test-chat-send-btn");
      const send = async () => {
        const text = input.value.trim();
        if (!text) return;
        btn.disabled = true;
        input.disabled = true;
        try {
          const { error } = await sb.rpc("send_support_message", { p_ticket_id: ticketId, p_content: text });
          if (error) throw error;
          input.value = "";
        } catch (err) {
          alert(err.message || "Couldn't send.");
        }
        btn.disabled = false;
        input.disabled = false;
        input.focus();
      };
      btn.onclick = send;
      input.onkeydown = (e) => { if (e.key === "Enter") send(); };
    }
  } else {
    const closed = document.createElement("p");
    closed.className = "test-chat-empty";
    closed.textContent = "This ticket is closed.";
    panelEl.appendChild(closed);
  }

  subscribeHighTestRealtime(ticketId, panelEl);
}

function renderHighTestMessages(panelEl, msgs) {
  let box = panelEl.querySelector(".test-chat-messages");
  if (!box) {
    box = document.createElement("div");
    box.className = "test-chat-messages";
    panelEl.insertBefore(box, panelEl.querySelector(".test-chat-input-row"));
  }
  if (msgs.length === 0) {
    box.innerHTML = `<p class="test-chat-empty">No messages yet.</p>`;
    return;
  }
  box.innerHTML = msgs.map((m) => {
    const name = m.players ? m.players.username : m.author_label || (m.source === "discord" ? "Discord" : "Unknown");
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `<div class="test-chat-msg">
      <span class="test-chat-msg-label${m.source === "discord" ? " discord-label" : ""}">${escapeHtml(name)}:</span>
      ${escapeHtml(m.content)}<span class="test-chat-msg-time">${time}</span>
    </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}

function subscribeHighTestRealtime(ticketId, panelEl) {
  if (highTestChannel) { sb.removeChannel(highTestChannel); highTestChannel = null; }
  highTestChannel = sb
    .channel(`hightest-ticket-${ticketId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "support_messages", filter: `ticket_id=eq.${ticketId}` },
      async () => {
        if (openHighTestTicketId !== ticketId) return;
        const panel = document.getElementById(`hightest-panel-${ticketId}`);
        if (!panel) return;
        const { data: msgs } = await sb
          .from("support_messages")
          .select("id, author_label, source, content, created_at, edited_at, players(username)")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true });
        renderHighTestMessages(panel, msgs || []);
      }
    )
    .subscribe();
}

async function renderTestChatPanel(liveTestId) {
  const panel = document.getElementById(`chat-panel-${liveTestId}`);
  if (!panel) return;

  panel.innerHTML = `<div class="test-chat-messages"><p class="test-chat-empty">Loading messages…</p></div>`;

  const { data: msgs } = await sb
    .from("test_messages")
    .select("id, author_label, source, content, created_at")
    .eq("live_test_id", liveTestId)
    .order("created_at", { ascending: true });

  const chatMsgs = msgs || [];
  renderTestChatMessages(panel, chatMsgs);
  renderTestChatInput(panel, liveTestId);
}

function renderTestChatMessages(panel, msgs) {
  let box = panel.querySelector(".test-chat-messages");
  if (!box) {
    box = document.createElement("div");
    box.className = "test-chat-messages";
    panel.insertBefore(box, panel.querySelector(".test-chat-input-row"));
  }

  if (msgs.length === 0) {
    box.innerHTML = `<p class="test-chat-empty">No messages yet. Say something!</p>`;
    return;
  }

  box.innerHTML = msgs.map((m) => {
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const labelClass = m.source === "discord" ? "discord-label" : "";
    return `<div class="test-chat-msg">
      <span class="test-chat-msg-label ${labelClass}">${escapeHtml(m.author_label || (m.source === "discord" ? "Discord" : "Player"))}:</span>${escapeHtml(m.content)}<span class="test-chat-msg-time">${time}</span>
    </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}

function renderTestChatInput(panel, liveTestId) {
  if (panel.querySelector(".test-chat-input-row")) return; // already added
  const row = document.createElement("div");
  row.className = "test-chat-input-row";
  row.innerHTML = `
    <input type="text" class="test-chat-input" placeholder="Type a message…" maxlength="800" />
    <button type="button" class="test-chat-send-btn">Send</button>
  `;
  panel.appendChild(row);

  const input = row.querySelector(".test-chat-input");
  const btn = row.querySelector(".test-chat-send-btn");

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    input.disabled = true;
    try {
      const { error } = await sb.rpc("send_test_message", {
        p_live_test_id: liveTestId,
        p_content: text,
      });
      if (error) throw error;
      input.value = "";
    } catch (err) {
      alert(err.message || "Couldn't send message.");
    }
    btn.disabled = false;
    input.disabled = false;
    input.focus();
  };

  btn.onclick = send;
  input.onkeydown = (e) => { if (e.key === "Enter") send(); };
}

function subscribeTestChatRealtime() {
  if (testChatChannel) {
    sb.removeChannel(testChatChannel);
    testChatChannel = null;
  }
  testChatChannel = sb
    .channel("test-chat-updates")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "test_messages" }, async (payload) => {
      if (!openTestChatId) return;
      const row = payload.new;
      if (row.live_test_id !== openTestChatId) return;
      // Reload messages for this panel.
      const panel = document.getElementById(`chat-panel-${openTestChatId}`);
      if (!panel) return;
      const { data: msgs } = await sb
        .from("test_messages")
        .select("id, author_label, source, content, created_at")
        .eq("live_test_id", openTestChatId)
        .order("created_at", { ascending: true });
      renderTestChatMessages(panel, msgs || []);
    })
    .subscribe();
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

async function renderHighTestSubtab() {
  const el = document.getElementById("testing-subtab-content");
  if (!el) return;

  if (!currentProfile) {
    el.innerHTML = `<p class="empty-state">Login with Discord to request a high tier test.</p>`;
    return;
  }
  if (!currentProfile.username) {
    el.innerHTML = `<p class="empty-state">Verify your Minecraft account first (Verify tab).</p>`;
    return;
  }

  el.innerHTML = `<p class="empty-state">Loading...</p>`;

  const LT3_OR_BETTER = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3"];
  const { data: qualifyingTiers } = await sb
    .from("player_tiers")
    .select("tier")
    .eq("player_id", currentProfile.playerId)
    .in("tier", LT3_OR_BETTER)
    .limit(1);

  if (!qualifyingTiers || qualifyingTiers.length === 0) {
    el.innerHTML = `<p class="empty-state">You need to be <strong>LT3 or better</strong> in at least one gamemode to request a high tier test.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="apps-page">
      <h3 class="apps-form-heading" style="margin-bottom:8px">Request High Tier Test</h3>
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.9em">
        For players who are <strong>LT3 or better</strong>. Staff will set up your test from the ticket.
      </p>
      <div class="apps-profile-pill">
        <img src="${headUrl(currentProfile.username, 20)}" alt="" class="apps-profile-head" />
        <span><strong>${escapeHtml(currentProfile.username)}</strong>${currentProfile.region ? ` &bull; ${currentProfile.region}` : ""}</span>
      </div>
      <form id="hightest-form" class="apps-form" autocomplete="off">
        <label class="support-form-label" for="hightest-gamemode">Gamemode</label>
        <select id="hightest-gamemode" class="support-form-select" required>
          <option value="" disabled selected>Select a gamemode</option>
          ${GAMEMODES.map((gm) => `<option value="${gm.id}">${gm.label}</option>`).join("")}
        </select>
        <p id="hightest-error" class="settings-feedback error" style="display:none"></p>
        <button type="submit" class="apps-apply-btn apps-submit-btn" id="hightest-submit-btn" style="--app-color:var(--accent)">Request High Test</button>
      </form>
    </div>
  `;

  document.getElementById("hightest-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const gamemodeId = document.getElementById("hightest-gamemode").value;
    if (!gamemodeId) return;
    const errEl = document.getElementById("hightest-error");
    const btn = document.getElementById("hightest-submit-btn");
    errEl.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      const gm = GAMEMODES.find((g) => g.id === gamemodeId);
      const gmName = gm ? gm.label : gamemodeId;
      const { error } = await sb.rpc("create_support_ticket", {
        p_category: "hightest",
        p_subject: gmName,
        p_message: `High tier test request for ${gmName}. IGN: ${currentProfile.username}${currentProfile.region ? `, Region: ${currentProfile.region}` : ""}.`,
      });
      if (error) throw error;
      el.innerHTML = `
        <div class="apps-page">
          <div class="apps-submitted">
            <div class="apps-submitted-icon">✅</div>
            <h3 class="apps-form-heading">Request Submitted!</h3>
            <p class="apps-hero-sub">Staff will review your high tier test request and set up a ticket shortly.</p>
            <button type="button" class="apps-apply-btn" id="hightest-back-btn" style="--app-color:var(--accent)">Back</button>
          </div>
        </div>
      `;
      document.getElementById("hightest-back-btn").onclick = renderHighTestSubtab;
    } catch (err) {
      errEl.textContent = err.message || "Couldn't submit. Try again or contact staff.";
      errEl.style.display = "";
      btn.disabled = false;
      btn.textContent = "Request High Test";
    }
  };
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
      if (currentPage === "testing" && testingSubtab === "tests") renderTestsSubtab();
    })
    .subscribe();
}

// Called by supabase-client.js whenever login state changes.
function onAuthChanged() {
  const wasShowingVerify = document.getElementById("verify-tab-btn")?.style.display !== "none";
  updateVerifyTabVisibility();
  updateSettingsTabVisibility();
  const nowShowingVerify = document.getElementById("verify-tab-btn")?.style.display !== "none";
  // Just logged in and not verified yet — take them straight to the form.
  // Only navigate if init has already run; during init, the URL-derived page wins.
  if (!wasShowingVerify && nowShowingVerify && appInitDone) {
    setPage("verify");
  }

  if (currentPage === "testing") renderTestingTab();
  if (currentPage === "support") renderSupportTab();
}
