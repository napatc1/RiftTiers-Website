// Supabase project config. The anon key is safe to expose client-side —
// Row Level Security on the database is what actually protects writes,
// the key itself grants nothing on its own.
const SUPABASE_URL = "https://flifswwrhevzjwwhqitc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaWZzd3dyaGV2emp3d2hxaXRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MjcwOTUsImV4cCI6MjEwNjUwMzA5NX0.DaCk-tXyVMPWtfNz9_sq0BIlY2wWYtXT3Epbg_JdiBQ";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentSession = null;
// { playerId, username, region, isTester, isManager } or null when logged out
let currentProfile = null;

async function refreshProfile() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  currentSession = session;

  if (!session) {
    currentProfile = null;
    return;
  }

  const { data, error } = await sb
    .from("profiles")
    .select(
      "player_id, discord_username, is_tester, is_senior_tester, is_manager, is_moderator, is_owner, players(username, region, platform)"
    )
    .eq("id", session.user.id)
    .single();

  if (error || !data) {
    currentProfile = null;
    return;
  }

  currentProfile = {
    playerId: data.player_id,
    username: (data.players && data.players.username) || data.discord_username,
    region: data.players ? data.players.region : null,
    platform: data.players ? data.players.platform : null,
    isTester: !!data.is_tester,
    isSeniorTester: !!data.is_senior_tester,
    isManager: !!data.is_manager,
    isModerator: !!data.is_moderator,
    isOwner: !!data.is_owner,
  };
}

async function loginWithDiscord() {
  await sb.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.origin + "/" },
  });
}

async function logoutOfDiscord() {
  await sb.auth.signOut();
  currentSession = null;
  currentProfile = null;
  renderAuthUI();
  if (typeof onAuthChanged === "function") onAuthChanged();
}

function editMyProfile() {
  // Navigate to the settings page instead of using browser prompts.
  if (typeof setPage === "function") setPage("settings");
}

function renderAuthUI() {
  const el = document.getElementById("auth-widget");
  const mob = document.getElementById("auth-widget-mobile");

  function fill(container, idSuffix) {
    if (!container) return;
    if (currentSession && currentProfile) {
      container.innerHTML = `
        <button type="button" id="edit-profile-btn${idSuffix}" class="auth-username-btn">
          <img src="${headUrl(currentProfile.username || "Player", 20)}" alt="" class="auth-username-head" />
          ${escapeHtml(currentProfile.username || "Player")}
        </button>
        <button type="button" id="logout-btn${idSuffix}" class="auth-btn">Logout</button>
      `;
      document.getElementById("edit-profile-btn" + idSuffix).onclick = editMyProfile;
      document.getElementById("logout-btn" + idSuffix).onclick = logoutOfDiscord;
    } else if (currentSession) {
      container.innerHTML = `<span class="auth-username-btn">Loading...</span>`;
    } else {
      container.innerHTML = `<button type="button" id="login-btn${idSuffix}" class="auth-btn auth-btn-primary">Login with Discord</button>`;
      document.getElementById("login-btn" + idSuffix).onclick = loginWithDiscord;
    }
  }

  fill(el, "");
  fill(mob, "-mob");
}

sb.auth.onAuthStateChange(async (_event, session) => {
  currentSession = session;
  await refreshProfile();
  renderAuthUI();
  if (typeof onAuthChanged === "function") onAuthChanged();
});
