// The "Verify" tab: a one-time IGN + region setup shown right after a
// player's first Discord login. The tab itself only exists while logged in
// and unverified — set_my_profile() filling in a region is what "verified"
// means here, and the tab vanishes the moment that succeeds.
const VERIFY_REGIONS = ["NA", "EU", "AS", "ME", "AU"];

function isVerified() {
  return !!(currentProfile && currentProfile.region);
}

// Shows/hides the Verify nav button based on login + verified state. Called
// after every auth change and after a successful verify. If the tab was the
// active page and just disappeared, bounce back to Home.
function updateVerifyTabVisibility() {
  const btn = document.getElementById("verify-tab-btn");
  const btnDrawer = document.getElementById("verify-tab-drawer-btn");
  if (!btn) return;
  const show = !!currentSession && !isVerified();
  btn.style.display = show ? "" : "none";
  if (btnDrawer) btnDrawer.style.display = show ? "" : "none";
  if (!show && currentPage === "verify") {
    setPage("home");
  }
}

function renderVerifyTab() {
  const title = document.getElementById("view-title");
  title.textContent = "Verify";
  title.classList.remove("profile-mode");

  const container = document.getElementById("leaderboard");

  if (!currentSession) {
    container.innerHTML = `
      <div class="verify-page">
        <p class="empty-state">Login with Discord above to verify your account.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="verify-page">
      <h3 class="verify-heading">Welcome! Set up your account</h3>
      <p class="verify-intro">Tell us your Minecraft IGN and region so testers and the leaderboard can find you. You only need to do this once.</p>
      <form id="verify-form" class="verify-form">
        <label class="verify-label">
          Minecraft IGN
          <input type="text" id="verify-ign" class="verify-input" placeholder="Your Minecraft username" value="${escapeHtml((currentProfile && currentProfile.username) || "")}" required />
        </label>
        <label class="verify-label">
          Platform
          <select id="verify-platform" class="verify-input">
            <option value="" disabled ${currentProfile && currentProfile.platform ? "" : "selected"}>Select a platform</option>
            <option value="cracked" ${currentProfile && currentProfile.platform === "cracked" ? "selected" : ""}>Cracked</option>
            <option value="premium" ${currentProfile && currentProfile.platform === "premium" ? "selected" : ""}>Premium</option>
            <option value="bedrock" ${currentProfile && currentProfile.platform === "bedrock" ? "selected" : ""}>Bedrock</option>
          </select>
        </label>
        <label class="verify-label">
          Region
          <select id="verify-region" class="verify-input">
            <option value="" disabled ${currentProfile && currentProfile.region ? "" : "selected"}>Select a region</option>
            ${VERIFY_REGIONS.map(
              (r) => `<option value="${r}" ${currentProfile && currentProfile.region === r ? "selected" : ""}>${r}</option>`
            ).join("")}
          </select>
        </label>
        <button type="submit" class="auth-btn auth-btn-primary">Verify</button>
        <p id="verify-error" class="verify-error"></p>
      </form>
    </div>
  `;

  document.getElementById("verify-form").onsubmit = async (e) => {
    e.preventDefault();
    const ign = document.getElementById("verify-ign").value.trim();
    const platform = document.getElementById("verify-platform").value;
    const region = document.getElementById("verify-region").value;
    const errorEl = document.getElementById("verify-error");
    errorEl.textContent = "";

    if (!ign) {
      errorEl.textContent = "Enter your Minecraft IGN.";
      return;
    }
    if (!platform) {
      errorEl.textContent = "Select a platform.";
      return;
    }
    if (!region) {
      errorEl.textContent = "Select a region.";
      return;
    }

    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const { error } = await sb.rpc("set_my_profile", {
        p_username: ign,
        p_platform: platform,
        p_region: region,
      });
      if (error) throw error;
      await refreshProfile();
      renderAuthUI();
      updateVerifyTabVisibility();
      setPage("home");
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't verify. Try again.";
      submitBtn.disabled = false;
    }
  };
}
