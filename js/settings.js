// Settings page: theme toggle + profile editing (username, platform, region).
// Theme is stored in localStorage and applied immediately on boot via the
// inline snippet at the bottom of this file.

const SETTINGS_REGIONS = ["NA", "EU", "AS", "ME", "AU"];
const SETTINGS_PLATFORMS = [
  { value: "premium", label: "Premium (Java)" },
  { value: "bedrock", label: "Bedrock" },
  { value: "cracked", label: "Cracked" },
];

// ---------- theme ----------

function getStoredTheme() {
  try { return localStorage.getItem("ryft-theme") || "transparent"; } catch { return "transparent"; }
}

function applyTheme(theme) {
  if (theme === "transparent") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme); // "dark" | "light" | "system"
  }
  try { localStorage.setItem("ryft-theme", theme); } catch {}
}

// Apply on load (also called from the inline <script> before body renders —
// but we re-apply here to stay in sync with the pill UI).
applyTheme(getStoredTheme());

// ---------- tab visibility ----------

function updateSettingsTabVisibility() {
  const btn = document.getElementById("settings-tab-btn");
  if (!btn) return;
  btn.style.display = !!currentSession ? "" : "none";
}

// ---------- render ----------

function renderSettingsPage() {
  const title = document.getElementById("view-title");
  title.textContent = "Settings";
  title.classList.remove("profile-mode");

  const container = document.getElementById("leaderboard");

  if (!currentSession) {
    container.innerHTML = `<p class="empty-state">Login with Discord to access settings.</p>`;
    return;
  }

  const currentTheme = getStoredTheme();
  const profile = currentProfile || {};
  const platform = profile.platform || "";

  container.innerHTML = `
    <div class="settings-page">

      <!-- Appearance -->
      <section class="settings-section">
        <p class="settings-section-title">Appearance</p>
        <div class="settings-field">
          <span class="settings-label">Theme</span>
          <div class="theme-toggle">
            <button type="button" class="theme-pill ${currentTheme === "transparent" ? "active" : ""}" data-theme="transparent">Transparent</button>
            <button type="button" class="theme-pill ${currentTheme === "dark" ? "active" : ""}" data-theme="dark">Dark</button>
            <button type="button" class="theme-pill ${currentTheme === "light" ? "active" : ""}" data-theme="light">Light</button>
            <button type="button" class="theme-pill ${currentTheme === "system" ? "active" : ""}" data-theme="system">System</button>
          </div>
        </div>
      </section>

      <!-- Profile -->
      <section class="settings-section">
        <p class="settings-section-title">Profile</p>

        <div class="settings-field">
          <label class="settings-label" for="settings-ign">Minecraft Username</label>
          <input id="settings-ign" class="settings-input" type="text"
            placeholder="Your Minecraft IGN"
            value="${escapeHtml(profile.username || "")}" />
        </div>

        <div class="settings-field">
          <label class="settings-label" for="settings-platform">Account Type</label>
          <select id="settings-platform" class="settings-input">
            <option value="" ${!platform ? "selected" : ""} disabled>Select a platform</option>
            ${SETTINGS_PLATFORMS.map(p =>
              `<option value="${p.value}" ${platform === p.value ? "selected" : ""}>${p.label}</option>`
            ).join("")}
          </select>
        </div>

        <div class="settings-field">
          <label class="settings-label" for="settings-region">Region</label>
          <select id="settings-region" class="settings-input">
            <option value="" ${!profile.region ? "selected" : ""} disabled>Select a region</option>
            ${SETTINGS_REGIONS.map(r =>
              `<option value="${r}" ${profile.region === r ? "selected" : ""}>${r}</option>`
            ).join("")}
          </select>
        </div>

        <button type="button" class="settings-save-btn" id="settings-save-btn">Save changes</button>
        <p class="settings-feedback" id="settings-feedback"></p>
      </section>

    </div>
  `;

  // Theme pills
  container.querySelectorAll(".theme-pill").forEach(pill => {
    pill.onclick = () => {
      const theme = pill.dataset.theme;
      applyTheme(theme);
      container.querySelectorAll(".theme-pill").forEach(p =>
        p.classList.toggle("active", p.dataset.theme === theme)
      );
    };
  });

  // Profile save
  document.getElementById("settings-save-btn").onclick = async () => {
    const ign = document.getElementById("settings-ign").value.trim();
    const platform = document.getElementById("settings-platform").value;
    const region = document.getElementById("settings-region").value;
    const feedback = document.getElementById("settings-feedback");
    const btn = document.getElementById("settings-save-btn");

    feedback.textContent = "";
    feedback.className = "settings-feedback";

    if (!ign) { feedback.textContent = "Enter your Minecraft username."; feedback.className = "settings-feedback error"; return; }
    if (!region) { feedback.textContent = "Select a region."; feedback.className = "settings-feedback error"; return; }

    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const { error } = await sb.rpc("set_my_profile", {
        p_username: ign,
        p_platform: platform || null,
        p_region: region,
      });
      if (error) throw error;
      await refreshProfile();
      renderAuthUI();
      updateVerifyTabVisibility();
      updateSettingsTabVisibility();
      feedback.textContent = "Saved!";
      feedback.className = "settings-feedback success";
    } catch (err) {
      feedback.textContent = err.message || "Couldn't save. Try again.";
      feedback.className = "settings-feedback error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  };
}
