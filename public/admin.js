(() => {
  const playerKey = "golden-hour-player";
  const nameKey = "golden-hour-name";
  const playerId = localStorage.getItem(playerKey);
  const playerName = localStorage.getItem(nameKey) || "";
  const socketUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/live";
  const loginCard = document.querySelector("#admin-login-card");
  const dashboard = document.querySelector("#admin-dashboard");
  const feedback = document.querySelector("#login-feedback");
  const connectionStatus = document.querySelector("#connection-status");
  let socket = null;
  let authenticated = false;
  let reconnectTimer = null;
  let adminData = { players: [], bans: [], rooms: [], onlineCount: 0 };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const send = (message) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else showToast("Connection lost. Reconnecting…");
  };
  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }
  function render() {
    const players = adminData.players || [];
    const bans = adminData.bans || [];
    const rooms = adminData.rooms || [];
    document.querySelector("#metric-online").textContent = adminData.onlineCount ?? players.length;
    document.querySelector("#metric-rooms").textContent = rooms.length;
    document.querySelector("#metric-bans").textContent = bans.length;
    const table = document.querySelector("#players-table");
    table.innerHTML = players.map((p) => {
      const room = p.isPrivate ? "Private · " + escapeHtml(p.roomCode) : "Global";
      return '<tr><td><strong>' + escapeHtml(p.name) + '</strong><small>' + escapeHtml(p.id) + '</small></td><td>' + room + '</td><td>' + escapeHtml(p.game || "lobby") + '</td><td>' + Number(p.chips).toLocaleString() + '</td><td><div class="admin-actions">' +
        '<button class="quiet-button" data-action="reset" data-id="' + escapeHtml(p.id) + '">Reset chips</button>' +
        '<button class="quiet-button" data-action="mute" data-id="' + escapeHtml(p.id) + '">' + (p.muted ? "Unmute" : "Mute") + '</button>' +
        '<button class="quiet-button" data-action="disconnect" data-id="' + escapeHtml(p.id) + '">Disconnect</button>' +
        '<button class="quiet-button admin-danger" data-action="ban" data-id="' + escapeHtml(p.id) + '">Ban</button></div></td></tr>';
    }).join("");
    document.querySelector("#players-empty").hidden = players.length > 0;
    document.querySelector("#rooms-list").innerHTML = rooms.length ? rooms.map((r) =>
      '<div class="admin-room-row"><div><strong>' + escapeHtml(r.code) + '</strong><small>' + r.players + ' online · ' + escapeHtml(r.game) + (r.running ? ' · round running' : '') + '</small></div><button class="quiet-button admin-danger" data-room-close="' + escapeHtml(r.code) + '"' + (r.running ? " disabled" : "") + '>Close room</button></div>'
    ).join("") : '<p class="admin-muted">No private rooms are currently open.</p>';
    document.querySelector("#bans-list").innerHTML = bans.map((b) =>
      '<div class="admin-ban-row"><div><strong>' + escapeHtml(b.name) + '</strong><small>Banned ' + new Date(b.bannedAt).toLocaleString() + '</small></div><button class="quiet-button" data-unban="' + escapeHtml(b.id) + '">Unban</button></div>'
    ).join("");
    document.querySelector("#bans-empty").hidden = bans.length > 0;
  }
  function lockDashboard(message) {
    authenticated = false;
    dashboard.hidden = true;
    loginCard.hidden = false;
    document.querySelector("#admin-password").value = "";
    if (message) feedback.textContent = message;
  }
  function connect() {
    clearTimeout(reconnectTimer);
    socket = new WebSocket(socketUrl);
    socket.addEventListener("open", () => {
      connectionStatus.textContent = "Connected";
      connectionStatus.style.color = "#a9d0ad";
      if (!playerId || playerName.trim().toLowerCase() !== "stijn") {
        lockDashboard("Access denied. Set your casino display name to stijn before opening the admin dashboard.");
        return;
      }
      send({ type: "register", id: playerId, name: playerName, roomCode: "global" });
    });
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "admin-auth") {
        if (message.success) {
          authenticated = true;
          feedback.textContent = "";
          loginCard.hidden = true;
          dashboard.hidden = false;
          showToast("Admin dashboard unlocked.");
        } else {
          lockDashboard(message.message);
        }
      } else if (message.type === "admin-state" && authenticated) {
        adminData = message;
        render();
      } else if (message.type === "admin-logged-out") {
        lockDashboard(message.message);
      } else if (message.type === "room-kicked") {
        showToast("A player was moved out of a closed room.");
      } else if (message.type === "error") {
        if (!authenticated) feedback.textContent = message.message;
        else showToast(message.message);
      }
    });
    socket.addEventListener("close", () => {
      connectionStatus.textContent = "Reconnecting";
      connectionStatus.style.color = "#e5a19a";
      lockDashboard("Connection interrupted. Reconnect and sign in again.");
      authenticated = false;
      reconnectTimer = setTimeout(connect, 1800);
    });
  }
  document.querySelector("#admin-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    feedback.textContent = "";
    send({ type: "admin-login", username: document.querySelector("#admin-username").value.trim(), password: document.querySelector("#admin-password").value });
  });
  document.querySelector("#players-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !authenticated) return;
    const id = button.dataset.id;
    if (button.dataset.action === "reset" && confirm("Reset this player's chip balance to 1,000?")) send({ type: "admin-reset-balance", targetId: id });
    if (button.dataset.action === "mute") {
      const p = adminData.players.find((item) => item.id === id);
      if (p) send({ type: "admin-set-mute", targetId: id, muted: !p.muted });
    }
    if (button.dataset.action === "disconnect" && confirm("Disconnect this player? They can reconnect unless banned.")) send({ type: "admin-disconnect-player", targetId: id });
    if (button.dataset.action === "ban" && confirm("Permanently ban this player account? You can unban them later.")) send({ type: "admin-ban-player", targetId: id });
  });
  document.querySelector("#rooms-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-room-close]");
    if (!button || button.disabled || !authenticated) return;
    if (confirm("Close private room " + button.dataset.roomClose + "? All players will return to the global lobby.")) send({ type: "admin-close-room", roomCode: button.dataset.roomClose });
  });
  document.querySelector("#bans-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-unban]");
    if (button && authenticated && confirm("Remove this ban?")) send({ type: "admin-unban-player", targetId: button.dataset.unban });
  });
  document.querySelector("#announcement-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#announcement-text");
    const text = input.value.trim();
    if (!text || !authenticated) return;
    send({ type: "admin-announcement", text });
    input.value = "";
    document.querySelector("#announcement-feedback").textContent = "Announcement sent.";
  });
  document.querySelector("#clear-chat").addEventListener("click", () => {
    if (authenticated && confirm("Clear chat history in every room? This cannot be undone.")) send({ type: "admin-clear-chat" });
  });
  document.querySelector("#lock-dashboard").addEventListener("click", () => {
    if (authenticated) send({ type: "admin-logout" });
    lockDashboard("Dashboard locked.");
  });
  if (playerName.trim().toLowerCase() !== "stijn") {
    lockDashboard("Access denied. Set your casino display name to stijn on the casino home page first.");
  }
  connect();
})();