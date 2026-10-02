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
    .select("player_id, discord_username, is_tester, is_manager, players(username, region)")
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
    isTester: !!data.is_tester,
    isManager: !!data.is_manager,
  };
}

async function loginWithDiscord() {
  await sb.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.href },
  });
}

async function logoutOfDiscord() {
  await sb.auth.signOut();
  currentSession = null;
  currentProfile = null;
  renderAuthUI();
  if (typeof onAuthChanged === "function") onAuthChanged();
}

async function editMyProfile() {
  const username = prompt("Your Minecraft username:", currentProfile.username || "");
  if (username === null) return;
  const region = prompt("Your region (NA, EU, AS, ME, AU):", currentProfile.region || "NA");
  if (region === null) return;
  try {
    const { error } = await sb.rpc("set_my_profile", {
      p_username: username.trim() || null,
      p_platform: null,
      p_region: region.trim().toUpperCase() || null,
    });
    if (error) throw error;
  } catch (err) {
    alert(err.message || "Couldn't update your profile.");
  }
  await refreshProfile();
  renderAuthUI();
  if (typeof onAuthChanged === "function") onAuthChanged();
}

function renderAuthUI() {
  const el = document.getElementById("auth-widget");
  if (!el) return;

  if (currentSession && currentProfile) {
    el.innerHTML = `
      <button type="button" id="edit-profile-btn" class="auth-username-btn">${escapeHtml(currentProfile.username || "Player")}</button>
      <button type="button" id="logout-btn" class="auth-btn">Logout</button>
    `;
    document.getElementById("edit-profile-btn").onclick = editMyProfile;
    document.getElementById("logout-btn").onclick = logoutOfDiscord;
  } else if (currentSession) {
    el.innerHTML = `<span class="auth-username-btn">Loading...</span>`;
  } else {
    el.innerHTML = `<button type="button" id="login-btn" class="auth-btn auth-btn-primary">Login with Discord</button>`;
    document.getElementById("login-btn").onclick = loginWithDiscord;
  }
}

sb.auth.onAuthStateChange(async (_event, session) => {
  currentSession = session;
  await refreshProfile();
  renderAuthUI();
  if (typeof onAuthChanged === "function") onAuthChanged();
});
