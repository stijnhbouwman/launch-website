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
  let adminData = { players: [], bans: [], rooms: [], gameRooms: [], onlineCount: 0 };
  let selectedGame = "roulette";
  let selectedHistoryPlayer = null;
  let selectedChatRoom = "global";
  let selectedRoomTool = "";
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
    const searchText = (document.querySelector("#player-search")?.value || "").trim().toLowerCase();
    const gameFilter = document.querySelector("#player-game-filter")?.value || "";
    const visiblePlayers = players.filter((p) => {
      const roomLabel = p.isPrivate ? String(p.roomCode || "") : "global";
      const matchesSearch = !searchText || [p.name, p.id, roomLabel, p.game || "lobby"].some((value) => String(value).toLowerCase().includes(searchText));
      return matchesSearch && (!gameFilter || (p.game || "lobby") === gameFilter);
    });
    const bans = adminData.bans || [];
    const rooms = adminData.rooms || [];
    document.querySelector("#metric-online").textContent = adminData.onlineCount ?? players.length;
    document.querySelector("#metric-rooms").textContent = rooms.length;
    document.querySelector("#metric-bans").textContent = bans.length;
    const table = document.querySelector("#players-table");
    table.innerHTML = visiblePlayers.map((p) => {
      const room = p.isPrivate ? "Private · " + escapeHtml(p.roomCode) : "Global";
      return '<tr><td><strong>' + escapeHtml(p.name) + '</strong><small>' + escapeHtml(p.id) + '</small></td><td>' + room + '</td><td>' + escapeHtml(p.game || "lobby") + '</td><td>' + Number(p.chips).toLocaleString() + '</td><td><div class="admin-actions">' +
        '<button class="quiet-button" data-action="history" data-id="' + escapeHtml(p.id) + '">History</button>' +
        '<button class="quiet-button" data-action="grant" data-id="' + escapeHtml(p.id) + '">Grant chips</button>' +
        '<button class="quiet-button" data-action="take" data-id="' + escapeHtml(p.id) + '">Take chips</button>' +
        '<button class="quiet-button" data-action="reset" data-id="' + escapeHtml(p.id) + '">Reset chips</button>' +
        '<button class="quiet-button" data-action="mute" data-id="' + escapeHtml(p.id) + '">' + (p.muted ? "Unmute" : "Mute") + '</button>' +
        '<button class="quiet-button" data-action="disconnect" data-id="' + escapeHtml(p.id) + '">Disconnect</button>' +
        '<button class="quiet-button admin-danger" data-action="ban" data-id="' + escapeHtml(p.id) + '">Ban</button></div></td></tr>';
    }).join("");
    document.querySelector("#players-empty").hidden = visiblePlayers.length > 0;
    document.querySelector("#players-empty").textContent = players.length && !visiblePlayers.length ? "No players match these filters." : "No players are online.";
    document.querySelector("#rooms-list").innerHTML = rooms.length ? rooms.map((r) =>
      '<div class="admin-room-row"><div><strong>' + escapeHtml(r.code) + '</strong><small>' + r.players + ' online · Host: ' + escapeHtml(r.owner || "Unknown") + ' · ' + escapeHtml(r.game) + (r.running ? ' · round running' : '') + '</small></div><button class="quiet-button admin-danger" data-room-close="' + escapeHtml(r.code) + '"' + (r.running ? " disabled" : "") + '>Close room</button></div>'
    ).join("") : '<p class="admin-muted">No private rooms are currently open.</p>';
    document.querySelector("#bans-list").innerHTML = bans.map((b) =>
      '<div class="admin-ban-row"><div><strong>' + escapeHtml(b.name) + '</strong><small>Banned ' + new Date(b.bannedAt).toLocaleString() + '</small></div><button class="quiet-button" data-unban="' + escapeHtml(b.id) + '">Unban</button></div>'
    ).join("");
    document.querySelector("#bans-empty").hidden = bans.length > 0;
    renderPlayerLeaderboard();
    renderGameViewer();
    renderAdminTools();
  }

  function renderPlayerLeaderboard() {
    const top = (adminData.players || []).slice().sort((a, b) => (Number(b.chips) || 0) - (Number(a.chips) || 0)).slice(0, 5);
    document.querySelector("#player-leaderboard").innerHTML = top.length
      ? top.map((player, index) => '<div><span>' + (index + 1) + '. ' + escapeHtml(player.name) + '</span><strong>' + Number(player.chips || 0).toLocaleString() + ' chips</strong></div>').join("")
      : '<p class="admin-muted">No players are online.</p>';
  }

  function downloadPlayerReport() {
    const players = adminData.players || [];
    if (!players.length) return showToast("There are no online players to export.");
    const columns = ["name", "playerId", "room", "game", "chips", "muted"];
    const rows = players.map((p) => [p.name, p.id, p.isPrivate ? p.roomCode : "global", p.game || "lobby", p.chips, p.muted ? "yes" : "no"]);
    const csvCell = (value) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\\r\\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "golden-hour-online-players-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Player report exported.");
  }

  function renderAdminTools() {
    const pauseStatus = document.querySelector("#games-pause-status");
    const pauseButton = document.querySelector("#toggle-games-pause");
    pauseStatus.textContent = adminData.gamesPaused ? "New game actions are paused" : "Games are running";
    pauseButton.textContent = adminData.gamesPaused ? "Resume games" : "Pause new rounds";
    const chats = adminData.chats || [];
    const select = document.querySelector("#chat-room-select");
    const current = chats.some((room) => room.code === selectedChatRoom) ? selectedChatRoom : "global";
    selectedChatRoom = current;
    select.innerHTML = chats.map((room) => '<option value="' + escapeHtml(room.code) + '">' + (room.isPrivate ? "Private · " : "") + escapeHtml(room.code) + '</option>').join("");
    select.value = selectedChatRoom;
    const room = chats.find((item) => item.code === selectedChatRoom);
    const messages = room?.messages || [];
    document.querySelector("#admin-chat-messages").innerHTML = messages.length ? messages.slice().reverse().map((message) => '<article class="admin-chat-message"><div><strong>' + escapeHtml(message.name) + '</strong><time>' + new Date(message.timestamp).toLocaleString() + '</time></div><p>' + escapeHtml(message.text) + '</p><button class="quiet-button admin-danger" data-delete-chat="' + escapeHtml(message.id) + '" data-room="' + escapeHtml(selectedChatRoom) + '">Delete message</button></article>').join("") : '<p class="admin-muted">No messages in this room.</p>';
    const logs = adminData.adminLog || [];
    document.querySelector("#admin-activity-log").innerHTML = logs.length ? logs.map((entry) => '<article class="admin-log-row"><div><strong>' + escapeHtml(entry.action) + '</strong><small>' + new Date(entry.timestamp).toLocaleString() + ' · ' + escapeHtml(entry.admin) + (entry.targetName ? ' · ' + escapeHtml(entry.targetName) : "") + '</small>' + (entry.details ? '<p>' + escapeHtml(entry.details) + '</p>' : "") + '</div>' + (entry.undo && !entry.undone ? '<button class="quiet-button" data-undo="' + escapeHtml(entry.id) + '">Undo</button>' : (entry.undone ? '<span class="admin-muted">Undone</span>' : '')) + '</article>').join("") : '<p class="admin-muted">No admin actions recorded yet.</p>';
    const history = selectedHistoryPlayer ? logs.filter((entry) => entry.targetId === selectedHistoryPlayer) : [];
    const games = (adminData.playerHistory || []).find((item) => item.id === selectedHistoryPlayer)?.entries || [];
    const historyHost = document.querySelector("#player-history");
    const gameRows = games.map((entry) => '<article class="admin-log-row"><div><strong>' + escapeHtml(entry.game) + ' · ' + escapeHtml(entry.outcome) + '</strong><small>' + new Date(entry.timestamp).toLocaleString() + ' · Room ' + escapeHtml(entry.roomCode) + '</small><p>Wager: ' + Number(entry.wager).toLocaleString() + ' · Payout: ' + Number(entry.payout).toLocaleString() + ' · Net: ' + (entry.net > 0 ? '+' : '') + Number(entry.net).toLocaleString() + (entry.details ? ' · ' + escapeHtml(entry.details) : '') + '</p></div></article>').join("");
    const adminRows = history.map((entry) => '<article class="admin-log-row"><div><strong>Admin: ' + escapeHtml(entry.action) + '</strong><small>' + new Date(entry.timestamp).toLocaleString() + '</small>' + (entry.details ? '<p>' + escapeHtml(entry.details) + '</p>' : "") + '</div></article>').join("");
    historyHost.innerHTML = selectedHistoryPlayer ? (gameRows + adminRows || '<p class="admin-muted">No game or admin history recorded for this player yet.</p>') : '<p class="admin-muted">Select a player to view their history.</p>';
  }

  function renderGameViewer() {
    const host = document.querySelector("#game-view-results");
    const rooms = (adminData.gameRooms || []).filter((entry) => entry.game === selectedGame);
    const labels = { roulette: "Roulette", slots: "Slots", horses: "Horse racing", blackjack: "Blackjack", poker: "Poker" };
    if (!rooms.length) { host.innerHTML = '<p class="admin-muted">No ' + escapeHtml(labels[selectedGame]) + ' tables are currently active in any room.</p>'; return; }
    host.innerHTML = rooms.map((entry) => {
      const state = entry.state || {}, game = state[selectedGame] || {}, members = state.players || [];
      let details = "";
      if (selectedGame === "roulette") details = "Wheel: " + (game.spinning ? "Spinning" : "Waiting") + " · Bets: " + ((game.bets || []).length) + " · Last result: " + (game.lastResult ? game.lastResult.number + " (" + game.lastResult.color + ")" : "—") + "\n" + (game.bets || []).map((b) => b.name + ": " + b.selection + " · " + b.amount + " chips").join("\n");
      if (selectedGame === "slots") details = "Recent spins\n" + (game.history || []).slice(0, 8).map((x) => x.name + ": " + (x.symbols || []).join(" ") + " · wager " + x.amount + " · payout " + x.payout).join("\n");
      if (selectedGame === "horses") details = "Race: " + (game.phase || "waiting") + " · Winner: " + (game.winner || "—") + "\n" + (game.bets || []).map((b) => b.name + ": " + b.horse + " · " + b.amount + " chips").join("\n");
      if (selectedGame === "blackjack") details = "Round: " + (game.phase || "waiting") + " · Dealer score: " + (game.dealerScore ?? "hidden") + "\n" + (game.players || []).map((p) => p.name + ": " + (p.hand || []).map((c) => c.hidden ? "🂠" : (c.rank || "?") + (c.suit || "")).join(" ") + " · bet " + p.bet + " · " + p.status).join("\n");
      if (selectedGame === "poker") details = "Round: " + (game.phase || "waiting") + "\n" + (game.players || []).map((p) => p.name + ": " + (p.hand || []).map((c) => c.hidden ? "🂠" : (c.rank || "?") + (c.suit || "")).join(" ") + " · buy-in " + p.bet + (p.result ? " · " + p.result : "")).join("\n") + (game.lastResult ? "\nLast result: " + game.lastResult.winners.join(", ") + " · " + game.lastResult.hand : "");
      return '<article class="admin-game-room"><div class="admin-game-room-heading"><strong>' + escapeHtml(entry.code) + '</strong><span>' + members.length + ' online · ' + (entry.isPrivate ? 'Private room' : 'Global room') + '</span></div><p class="admin-muted">Players: ' + escapeHtml(members.map((p) => p.name + " (" + Number(p.chips).toLocaleString() + ")").join(", ") || "None") + '</p><pre>' + escapeHtml(details || "No round data yet.") + '</pre></article>';
    }).join("");
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
      } else if (message.type === "admin-room-cleanup-result") {
        showToast(message.count ? "Closed " + message.count + " empty private room(s)." : "No empty private rooms needed cleanup.");
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
  document.querySelector("#game-view-select").addEventListener("change", (event) => { selectedGame = event.target.value; renderGameViewer(); });
  document.querySelector("#admin-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    feedback.textContent = "";
    send({ type: "admin-login", username: document.querySelector("#admin-username").value.trim(), password: document.querySelector("#admin-password").value });
  });
  document.querySelector("#player-search").addEventListener("input", () => render());
  document.querySelector("#player-game-filter").addEventListener("change", () => render());
  document.querySelector("#export-players").addEventListener("click", () => { if (authenticated) downloadPlayerReport(); });
  document.querySelector("#copy-player-ids").addEventListener("click", async () => {
    if (!authenticated) return;
    const ids = (adminData.players || []).map((player) => player.id).filter(Boolean).join("\\n");
    if (!ids) return showToast("No online player IDs to copy.");
    try { await navigator.clipboard.writeText(ids); showToast("Copied " + (adminData.players || []).length + " player IDs."); }
    catch { showToast("Clipboard access is unavailable in this browser."); }
  });
  document.querySelector("#players-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !authenticated) return;
    const id = button.dataset.id;
    if (button.dataset.action === "history") { selectedHistoryPlayer = id; renderAdminTools(); return; }
    if (button.dataset.action === "grant" || button.dataset.action === "take") {
      const action = button.dataset.action;
      const targetName = adminData.players.find((item) => item.id === id)?.name || "this player";
      const amountText = prompt((action === "grant" ? "Grant how many chips to " : "Take how many chips from ") + targetName + "? (1–1,000,000)");
      if (amountText === null) return;
      const amount = Number(amountText.trim());
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) { showToast("Enter a whole number from 1 to 1,000,000."); return; }
      send({ type: "admin-adjust-chips", targetId: id, action, amount });
    }
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
  document.querySelector("#chat-room-select").addEventListener("change", (event) => { selectedChatRoom = event.target.value; renderAdminTools(); });
  document.querySelector("#admin-chat-messages").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-chat]");
    if (button && authenticated && confirm("Delete this chat message? You can undo it in the activity log.")) send({ type: "admin-delete-chat-message", roomCode: button.dataset.room, messageId: button.dataset.deleteChat });
  });
  document.querySelector("#admin-activity-log").addEventListener("click", (event) => {
    const button = event.target.closest("[data-undo]");
    if (button && authenticated && confirm("Reverse this admin change?")) send({ type: "admin-undo-action", logId: button.dataset.undo });
  });
  document.querySelector("#toggle-games-pause").addEventListener("click", () => {
    if (authenticated) send({ type: "admin-set-games-paused", paused: !adminData.gamesPaused });
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