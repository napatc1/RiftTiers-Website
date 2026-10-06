// Applications tab — Staff, Tester, and Media role applications.
// IGN and region are pulled from the user's verified profile (currentProfile),
// so the forms don't ask for them. Submits via Supabase RPCs; the bot picks
// up new rows via Realtime and posts a review embed in Discord.

const APP_CONTENT_TYPES = ["YouTube", "TikTok", "Twitch", "Twitter / X", "Instagram", "Other"];

// Which card is expanded into a form: null | "staff" | "tester" | "media"
let appActiveForm = null;
// Per-type submission state: null | "submitting" | "submitted"
let appSubmitState = {};

function setAppContainer() {
  const c = document.getElementById("leaderboard");
  c.style.overflow = "visible";
  c.style.background = "none";
  c.style.border = "none";
  c.style.borderRadius = "0";
  return c;
}

function renderApplicationsTab() {
  const title = document.getElementById("view-title");
  title.textContent = "Applications";
  title.classList.remove("profile-mode");

  if (appActiveForm) {
    renderApplicationForm(appActiveForm);
  } else {
    renderApplicationsLanding();
  }
}

// ── Landing: three cards ──────────────────────────────────────────────────────

function renderApplicationsLanding() {
  const c = setAppContainer();

  const cards = [
    {
      type: "tester",
      icon: "🎯",
      title: "Tester",
      color: "var(--accent)",
      desc: "Think you have what it takes to tier players? Apply to join the RyftTiers testing team.",
      perks: ["Test players across all gamemodes", "Exclusive Tester role & channels", "Shape the tier list"],
    },
    {
      type: "staff",
      icon: "🛡️",
      title: "Staff",
      color: "#a78bfa",
      desc: "Want to help moderate and grow the RyftTiers community? Apply to join the staff team.",
      perks: ["Moderate the Discord server", "Handle support tickets & appeals", "Work directly with management"],
    },
    {
      type: "media",
      icon: "🎬",
      title: "Media",
      color: "#f59e0b",
      desc: "Create content about RyftTiers? Apply for the Media role and get early access + recognition.",
      perks: ["Early access to updates", "Dedicated Media role & channel", "Direct line to staff"],
    },
  ];

  c.innerHTML = `
    <div class="apps-page">
      <div class="apps-hero">
        <h2 class="apps-hero-title">RyftTiers <span class="home-hero-accent">Applications</span></h2>
        <p class="apps-hero-sub">Apply for a role in the RyftTiers community. All applications are reviewed by staff and you'll be DM'd on Discord.</p>
      </div>
      <div class="apps-cards">
        ${cards.map(card => `
          <div class="apps-card" data-type="${card.type}">
            <div class="apps-card-icon" style="color:${card.color}">${card.icon}</div>
            <div class="apps-card-title">${card.title}</div>
            <p class="apps-card-desc">${card.desc}</p>
            <ul class="apps-card-perks">
              ${card.perks.map(p => `<li>${p}</li>`).join("")}
            </ul>
            <button type="button" class="apps-apply-btn" data-type="${card.type}" style="--app-color:${card.color}">
              Apply for ${card.title}
            </button>
          </div>
        `).join("")}
      </div>
      <p class="apps-note">You must be logged in with Discord and have your Minecraft account verified to apply.</p>
    </div>
  `;

  c.querySelectorAll(".apps-apply-btn").forEach(btn => {
    btn.onclick = () => {
      if (!currentSession) {
        alert("Log in with Discord first (top-right corner).");
        return;
      }
      if (!currentProfile || !currentProfile.username) {
        alert("Verify your Minecraft account first (Verify tab).");
        return;
      }
      appActiveForm = btn.dataset.type;
      appSubmitState[appActiveForm] = null;
      renderApplicationsTab();
    };
  });
}

// ── Form renderer (shared shell) ──────────────────────────────────────────────

function renderApplicationForm(type) {
  const c = setAppContainer();

  const meta = {
    tester: { icon: "🎯", title: "Tester Application", color: "var(--accent)" },
    staff:  { icon: "🛡️", title: "Staff Application",  color: "#a78bfa" },
    media:  { icon: "🎬", title: "Media Application",  color: "#f59e0b" },
  }[type];

  if (appSubmitState[type] === "submitted") {
    c.innerHTML = `
      <div class="apps-page">
        <div class="apps-submitted">
          <div class="apps-submitted-icon">✅</div>
          <h3 class="apps-form-heading">Application Submitted!</h3>
          <p class="apps-hero-sub">Staff will review your ${meta.title.replace(" Application", "")} application and DM you on Discord within a few days.</p>
          <button type="button" class="apps-apply-btn" id="apps-back-landing" style="--app-color:var(--accent)">Back to Applications</button>
        </div>
      </div>
    `;
    document.getElementById("apps-back-landing").onclick = () => {
      appActiveForm = null;
      renderApplicationsTab();
    };
    return;
  }

  const formFields = buildFormFields(type);

  c.innerHTML = `
    <div class="apps-page">
      <button type="button" class="back-btn" id="apps-back-btn">&larr; Back</button>
      <div class="apps-form-header">
        <span class="apps-form-icon" style="color:${meta.color}">${meta.icon}</span>
        <h3 class="apps-form-heading">${meta.title}</h3>
      </div>
      <div class="apps-profile-pill">
        <img src="${headUrl(currentProfile.username, 20)}" alt="" class="apps-profile-head" />
        <span><strong>${escapeHtml(currentProfile.username)}</strong>${currentProfile.region ? ` &bull; ${currentProfile.region}` : ""}</span>
      </div>
      <form id="app-form" class="apps-form" autocomplete="off">
        ${formFields}
        <p id="app-form-error" class="settings-feedback error" style="display:none"></p>
        <button type="submit" class="apps-apply-btn apps-submit-btn" id="app-submit-btn" style="--app-color:${meta.color}">Submit Application</button>
      </form>
    </div>
  `;

  document.getElementById("apps-back-btn").onclick = () => {
    appActiveForm = null;
    renderApplicationsTab();
  };

  document.getElementById("app-form").onsubmit = (e) => handleAppSubmit(e, type);
}

function buildFormFields(type) {
  if (type === "tester") {
    return `
      <label class="support-form-label" for="app-experience">PvP / Testing Experience</label>
      <textarea id="app-experience" class="support-form-textarea" rows="4"
        placeholder="Describe your PvP background, gamemodes you play, any previous testing experience..." required></textarea>

      <label class="support-form-label" for="app-availability">Availability</label>
      <textarea id="app-availability" class="support-form-textarea" rows="3"
        placeholder="Days, times, and your timezone (e.g. weekdays after 5pm EST)..." required></textarea>
    `;
  }

  if (type === "staff") {
    return `
      <label class="support-form-label" for="app-why">Why do you want to be staff?</label>
      <textarea id="app-why" class="support-form-textarea" rows="4"
        placeholder="Tell us why you want to join the team and what you'd contribute..." required></textarea>

      <label class="support-form-label" for="app-experience">Previous Experience</label>
      <textarea id="app-experience" class="support-form-textarea" rows="3"
        placeholder="Any moderation, admin, or community experience..." ></textarea>

      <label class="support-form-label" for="app-availability">Availability</label>
      <textarea id="app-availability" class="support-form-textarea" rows="2"
        placeholder="Days, times, and your timezone..." required></textarea>
    `;
  }

  if (type === "media") {
    return `
      <label class="support-form-label" for="app-content-type">Main Platform</label>
      <select id="app-content-type" class="support-form-select" required>
        <option value="" disabled selected>Select a platform</option>
        ${APP_CONTENT_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
      </select>

      <label class="support-form-label" for="app-channel-link">Channel / Profile Link</label>
      <input id="app-channel-link" class="support-form-input" type="text"
        placeholder="https://youtube.com/@yourchannel" required />

      <label class="support-form-label" for="app-follower-count">Follower / Subscriber Count</label>
      <input id="app-follower-count" class="support-form-input" type="text"
        placeholder="e.g. ~2,500 or 500" required />

      <label class="support-form-label" for="app-why">Why do you want the Media role?</label>
      <textarea id="app-why" class="support-form-textarea" rows="4"
        placeholder="Tell us about your content plans for RyftTiers..." required></textarea>
    `;
  }

  return "";
}

// ── Submit handlers ───────────────────────────────────────────────────────────

async function handleAppSubmit(e, type) {
  e.preventDefault();
  const errEl = document.getElementById("app-form-error");
  const btn   = document.getElementById("app-submit-btn");
  errEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    if (type === "tester") {
      const experience   = document.getElementById("app-experience").value.trim();
      const availability = document.getElementById("app-availability").value.trim();
      if (!experience || !availability) throw new Error("Please fill in all fields.");
      const { error } = await sb.rpc("submit_tester_application", {
        p_experience: experience,
        p_availability: availability,
      });
      if (error) throw error;

    } else if (type === "staff") {
      const why          = document.getElementById("app-why").value.trim();
      const experience   = document.getElementById("app-experience").value.trim();
      const availability = document.getElementById("app-availability").value.trim();
      if (!why || !availability) throw new Error("Please fill in all required fields.");
      const { error } = await sb.rpc("submit_staff_application", {
        p_why: why,
        p_experience: experience,
        p_availability: availability,
      });
      if (error) throw error;

    } else if (type === "media") {
      const contentType   = document.getElementById("app-content-type").value;
      const channelLink   = document.getElementById("app-channel-link").value.trim();
      const followerCount = document.getElementById("app-follower-count").value.trim();
      const why           = document.getElementById("app-why").value.trim();
      if (!contentType || !channelLink || !followerCount || !why) throw new Error("Please fill in all fields.");
      const { error } = await sb.rpc("submit_media_application", {
        p_content_type:   contentType,
        p_channel_link:   channelLink,
        p_follower_count: followerCount,
        p_why_media:      why,
      });
      if (error) throw error;
    }

    appSubmitState[type] = "submitted";
    renderApplicationsTab();

  } catch (err) {
    errEl.textContent = err.message || "Couldn't submit. Try again or ping staff in Discord.";
    errEl.style.display = "";
    btn.disabled = false;
    btn.textContent = "Submit Application";
  }
}
