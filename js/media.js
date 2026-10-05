// Media role application page.
// Submits directly to the bot via a Supabase RPC so the bot can post the
// review embed in Discord — same pattern as tester/staff applications.

const MEDIA_CONTENT_TYPES = ["YouTube", "TikTok", "Twitch", "Twitter / X", "Instagram", "Other"];
const MEDIA_REGIONS = ["NA", "EU", "AS", "ME", "AU"];

let mediaView = "landing"; // "landing" | "form" | "submitted"

function renderMediaTab() {
  const title = document.getElementById("view-title");
  title.textContent = "Media";
  title.classList.remove("profile-mode");

  if (mediaView === "form") {
    renderMediaForm();
  } else if (mediaView === "submitted") {
    renderMediaSubmitted();
  } else {
    renderMediaLanding();
  }
}

function renderMediaLanding() {
  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="media-page">
      <section class="media-hero">
        <div class="media-hero-icon">🎬</div>
        <h2 class="media-hero-title">RyftTiers <span class="home-hero-accent">Media</span></h2>
        <p class="media-hero-sub">
          Create content about RyftTiers? Apply for the <strong>Media role</strong> and get
          early access to updates, a shoutout in our Discord, and direct contact with staff.
        </p>
        <button type="button" class="media-apply-btn" id="media-apply-btn">Apply for Media Role</button>
      </section>

      <section class="media-info-grid">
        <div class="media-info-card">
          <div class="media-info-icon">📣</div>
          <div class="media-info-title">Discord Recognition</div>
          <div class="media-info-body">Get a dedicated Media role and channel access in our Discord server.</div>
        </div>
        <div class="media-info-card">
          <div class="media-info-icon">🔔</div>
          <div class="media-info-title">Early Access</div>
          <div class="media-info-body">Hear about big updates before they go public — so your content is first.</div>
        </div>
        <div class="media-info-card">
          <div class="media-info-icon">🤝</div>
          <div class="media-info-title">Staff Contact</div>
          <div class="media-info-body">Direct line to management for collab ideas, interviews, or event coverage.</div>
        </div>
      </section>

      <section class="media-reqs">
        <h3>Requirements</h3>
        <ul>
          <li>Content must be related to Minecraft PvP (you don't have to post exclusively about RyftTiers).</li>
          <li>At least one public channel or profile with original content.</li>
          <li>Active — we check that your channel has posted within the last 3 months.</li>
          <li>No history of harassment or cheating on RyftTiers.</li>
        </ul>
        <p class="media-reqs-note">Applications are reviewed by staff within a few days. You'll be DM'd on Discord either way.</p>
      </section>
    </div>
  `;

  document.getElementById("media-apply-btn").onclick = () => {
    if (!currentSession) {
      alert("Log in with Discord first (top-right corner) before applying.");
      return;
    }
    mediaView = "form";
    renderMediaTab();
  };
}

function renderMediaForm() {
  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="media-page">
      <button type="button" class="back-btn" id="media-back-btn">&larr; Back</button>
      <h3 class="media-form-heading">Media Role Application</h3>
      <form id="media-apply-form" class="media-form" autocomplete="off">

        <label class="support-form-label" for="media-ign">Minecraft IGN</label>
        <input id="media-ign" class="support-form-input" type="text" placeholder="Your in-game name" required />

        <label class="support-form-label" for="media-region">Region</label>
        <select id="media-region" class="support-form-select" required>
          <option value="" disabled selected>Select your region</option>
          ${MEDIA_REGIONS.map(r => `<option value="${r}">${r}</option>`).join("")}
        </select>

        <label class="support-form-label" for="media-content-type">Main Platform</label>
        <select id="media-content-type" class="support-form-select" required>
          <option value="" disabled selected>Select a platform</option>
          ${MEDIA_CONTENT_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
        </select>

        <label class="support-form-label" for="media-channel-link">Channel / Profile Link</label>
        <input id="media-channel-link" class="support-form-input" type="text" placeholder="https://youtube.com/@yourchannel" required />

        <label class="support-form-label" for="media-follower-count">Follower / Subscriber Count</label>
        <input id="media-follower-count" class="support-form-input" type="text" placeholder="e.g. ~2,500 or 500" required />

        <label class="support-form-label" for="media-sample-videos">Sample Videos / Content Links</label>
        <textarea id="media-sample-videos" class="support-form-textarea" rows="3"
          placeholder="Paste 1–3 links to your best videos or posts, or describe your content." required></textarea>

        <label class="support-form-label" for="media-why">Why do you want the Media role?</label>
        <textarea id="media-why" class="support-form-textarea" rows="4"
          placeholder="Tell us about your content plans for RyftTiers..." required></textarea>

        <p id="media-form-error" class="settings-feedback error" style="display:none"></p>
        <button type="submit" class="media-apply-btn" id="media-submit-btn">Submit Application</button>
      </form>
    </div>
  `;

  document.getElementById("media-back-btn").onclick = () => {
    mediaView = "landing";
    renderMediaTab();
  };

  document.getElementById("media-apply-form").onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("media-form-error");
    errEl.style.display = "none";

    const ign          = document.getElementById("media-ign").value.trim();
    const region       = document.getElementById("media-region").value;
    const contentType  = document.getElementById("media-content-type").value;
    const channelLink  = document.getElementById("media-channel-link").value.trim();
    const followerCount = document.getElementById("media-follower-count").value.trim();
    const sampleVideos = document.getElementById("media-sample-videos").value.trim();
    const whyMedia     = document.getElementById("media-why").value.trim();

    if (!ign || !region || !contentType || !channelLink || !followerCount || !sampleVideos || !whyMedia) {
      errEl.textContent = "Please fill in all fields.";
      errEl.style.display = "";
      return;
    }

    const btn = document.getElementById("media-submit-btn");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    try {
      const { error } = await sb.rpc("submit_media_application", {
        p_ign: ign,
        p_region: region,
        p_content_type: contentType,
        p_channel_link: channelLink,
        p_follower_count: followerCount,
        p_sample_videos: sampleVideos,
        p_why_media: whyMedia,
      });
      if (error) throw error;
      mediaView = "submitted";
      renderMediaTab();
    } catch (err) {
      errEl.textContent = err.message || "Couldn't submit. Try again or ping staff in Discord.";
      errEl.style.display = "";
      btn.disabled = false;
      btn.textContent = "Submit Application";
    }
  };
}

function renderMediaSubmitted() {
  const container = document.getElementById("leaderboard");
  container.innerHTML = `
    <div class="media-page media-submitted">
      <div class="media-submitted-icon">✅</div>
      <h3 class="media-form-heading">Application Submitted!</h3>
      <p class="media-hero-sub">
        Staff will review your application and DM you on Discord within a few days.
        Thanks for your interest in the RyftTiers Media team!
      </p>
      <button type="button" class="media-apply-btn media-apply-btn-outline" id="media-home-btn">Back to Home</button>
    </div>
  `;
  document.getElementById("media-home-btn").onclick = () => {
    mediaView = "landing";
    setPage("home");
  };
}
