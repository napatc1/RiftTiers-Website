// The "Support" page: help/report/appeal tickets. Every ticket is mirrored
// to a Discord channel by the bot (see supabase/schema.sql's section 9) —
// this file never talks to Discord directly, only to Supabase.
let supportView = "list"; // "list" | "new" | "thread"
let supportActiveTicketId = null;
let supportChannel = null;

const SUPPORT_CATEGORIES = [
  { id: "help", label: "Help" },
  { id: "report", label: "Report a player" },
  { id: "appeal", label: "Appeal a tier" },
];

function supportCategoryLabel(id) {
  const c = SUPPORT_CATEGORIES.find((c) => c.id === id);
  return c ? c.label : id;
}

function renderSupportTab() {
  const title = document.getElementById("view-title");
  title.textContent = "Support";
  title.classList.remove("profile-mode");

  if (!currentProfile) {
    document.getElementById("leaderboard").innerHTML = `
      <div class="support-page">
        <p class="empty-state">Login with Discord above to open a support ticket.</p>
      </div>
    `;
    return;
  }

  if (supportView === "new") {
    renderNewTicketForm();
  } else if (supportView === "thread" && supportActiveTicketId) {
    renderTicketThread(supportActiveTicketId);
  } else {
    renderSupportList();
  }
}

async function fetchMyTickets() {
  // RLS already limits this to the caller's own tickets, or every ticket
  // if they're a moderator/owner — no extra filtering needed here.
  const { data } = await sb
    .from("support_tickets")
    .select("id, category, subject, status, created_at, player_id, players(username)")
    .order("created_at", { ascending: false });
  return data || [];
}

async function renderSupportList() {
  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="support-page">
      <div class="support-header-row">
        <h3 class="support-heading">${currentProfile.isModerator || currentProfile.isOwner ? "All Tickets" : "Your Tickets"}</h3>
        <button type="button" id="new-ticket-btn" class="auth-btn auth-btn-primary">New Ticket</button>
      </div>
      <div id="support-list-body"><p class="empty-state">Loading...</p></div>
    </div>
  `;
  document.getElementById("new-ticket-btn").onclick = () => {
    supportView = "new";
    renderSupportTab();
  };

  const tickets = await fetchMyTickets();
  const body = document.getElementById("support-list-body");
  if (tickets.length === 0) {
    body.innerHTML = `<p class="empty-state">No tickets yet.</p>`;
    return;
  }

  body.innerHTML = tickets
    .map(
      (t) => `
    <button type="button" class="support-ticket-row" data-ticket-id="${t.id}">
      <span class="support-ticket-status support-ticket-status-${t.status}">${t.status}</span>
      <span class="support-ticket-subject">${escapeHtml(t.subject)}</span>
      <span class="support-ticket-category">${supportCategoryLabel(t.category)}</span>
      ${t.players ? `<span class="support-ticket-player">${escapeHtml(t.players.username)}</span>` : ""}
    </button>`
    )
    .join("");

  body.querySelectorAll(".support-ticket-row").forEach((row) => {
    row.onclick = () => {
      supportActiveTicketId = Number(row.dataset.ticketId);
      supportView = "thread";
      renderSupportTab();
    };
  });
}

function renderNewTicketForm() {
  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="support-page">
      <button type="button" id="support-back-btn" class="back-btn">&larr; Back</button>
      <h3 class="support-heading">New Ticket</h3>
      <form id="new-ticket-form" class="support-form">
        <label class="support-form-label">Category</label>
        <select id="ticket-category" class="support-form-select">
          ${SUPPORT_CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}
        </select>
        <label class="support-form-label">Subject</label>
        <input type="text" id="ticket-subject" class="support-form-input" placeholder="Short summary" required />
        <label class="support-form-label">Details</label>
        <textarea id="ticket-message" class="support-form-textarea" rows="5" placeholder="Explain what's going on..." required></textarea>
        <button type="submit" class="auth-btn auth-btn-primary">Submit Ticket</button>
      </form>
    </div>
  `;
  document.getElementById("support-back-btn").onclick = () => {
    supportView = "list";
    renderSupportTab();
  };
  document.getElementById("new-ticket-form").onsubmit = async (e) => {
    e.preventDefault();
    const category = document.getElementById("ticket-category").value;
    const subject = document.getElementById("ticket-subject").value.trim();
    const message = document.getElementById("ticket-message").value.trim();
    if (!subject || !message) return;

    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const { data, error } = await sb.rpc("create_support_ticket", {
        p_category: category,
        p_subject: subject,
        p_message: message,
      });
      if (error) throw error;
      supportActiveTicketId = data;
      supportView = "thread";
      renderSupportTab();
    } catch (err) {
      alert(err.message || "Couldn't create that ticket.");
      submitBtn.disabled = false;
    }
  };
}

async function renderTicketThread(ticketId) {
  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="support-page">
      <button type="button" id="support-back-btn" class="back-btn">&larr; Back</button>
      <div id="support-thread-body"><p class="empty-state">Loading...</p></div>
    </div>
  `;
  document.getElementById("support-back-btn").onclick = () => {
    supportView = "list";
    supportActiveTicketId = null;
    renderSupportTab();
  };

  await loadAndRenderThreadBody(ticketId);
  subscribeSupportRealtime(ticketId);
}

async function loadAndRenderThreadBody(ticketId) {
  const body = document.getElementById("support-thread-body");
  if (!body) return;

  const [{ data: ticket }, { data: messages }] = await Promise.all([
    sb.from("support_tickets").select("id, category, subject, status, player_id, players(username)").eq("id", ticketId).single(),
    sb
      .from("support_messages")
      .select("id, author_player_id, author_label, source, content, created_at, players(username)")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
  ]);

  if (!ticket) {
    body.innerHTML = `<p class="empty-state">Ticket not found.</p>`;
    return;
  }

  const canClose = ticket.player_id === currentProfile.playerId || currentProfile.isModerator || currentProfile.isOwner;

  const messagesHtml = (messages || [])
    .map((m) => {
      const name = m.players ? m.players.username : m.author_label || (m.source === "discord" ? "Discord" : "Unknown");
      return `
        <div class="support-message support-message-${m.source}">
          <div class="support-message-author">${escapeHtml(name)} <span class="support-message-source">${m.source === "discord" ? "via Discord" : ""}</span></div>
          <div class="support-message-content">${escapeHtml(m.content)}</div>
        </div>
      `;
    })
    .join("");

  body.innerHTML = `
    <div class="support-thread-header">
      <h3 class="support-heading">${escapeHtml(ticket.subject)}</h3>
      <span class="support-ticket-status support-ticket-status-${ticket.status}">${ticket.status}</span>
      <span class="support-ticket-category">${supportCategoryLabel(ticket.category)}</span>
      ${canClose && ticket.status === "open" ? `<button type="button" id="close-ticket-btn" class="auth-btn">Close Ticket</button>` : ""}
    </div>
    <div class="support-thread-messages" id="support-thread-messages">
      ${messagesHtml || `<p class="empty-state">No messages yet.</p>`}
    </div>
    ${
      ticket.status === "open"
        ? `
      <form id="support-reply-form" class="support-reply-form">
        <input type="text" id="support-reply-input" class="support-form-input" placeholder="Type a reply..." />
        <button type="submit" class="auth-btn auth-btn-primary">Send</button>
      </form>`
        : `<p class="empty-state">This ticket is closed.</p>`
    }
  `;

  const messagesEl = document.getElementById("support-thread-messages");
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

  const closeBtn = document.getElementById("close-ticket-btn");
  if (closeBtn) {
    closeBtn.onclick = async () => {
      closeBtn.disabled = true;
      try {
        const { error } = await sb.rpc("close_support_ticket", { p_ticket_id: ticketId });
        if (error) throw error;
      } catch (err) {
        alert(err.message || "Couldn't close that ticket.");
      }
      loadAndRenderThreadBody(ticketId);
    };
  }

  const replyForm = document.getElementById("support-reply-form");
  if (replyForm) {
    replyForm.onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById("support-reply-input");
      const content = input.value.trim();
      if (!content) return;
      input.disabled = true;
      try {
        const { error } = await sb.rpc("send_support_message", { p_ticket_id: ticketId, p_content: content });
        if (error) throw error;
        input.value = "";
      } catch (err) {
        alert(err.message || "Couldn't send that message.");
      }
      input.disabled = false;
      loadAndRenderThreadBody(ticketId);
    };
  }
}

function subscribeSupportRealtime(ticketId) {
  if (supportChannel) {
    sb.removeChannel(supportChannel);
    supportChannel = null;
  }
  supportChannel = sb
    .channel(`support-ticket-${ticketId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_messages", filter: `ticket_id=eq.${ticketId}` },
      () => {
        if (currentPage === "support" && supportView === "thread" && supportActiveTicketId === ticketId) {
          loadAndRenderThreadBody(ticketId);
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_tickets", filter: `id=eq.${ticketId}` },
      () => {
        if (currentPage === "support" && supportView === "thread" && supportActiveTicketId === ticketId) {
          loadAndRenderThreadBody(ticketId);
        }
      }
    )
    .subscribe();
}
