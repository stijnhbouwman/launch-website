const content = document.querySelector("#content");
const socketUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`;
const playerKey = "golden-hour-player";
const nameKey = "golden-hour-name";
const roomKey = "golden-hour-room";
const queryRoomCode = new URLSearchParams(location.search).get("room") || "";
let requestedRoomCode = (queryRoomCode || localStorage.getItem(roomKey) || "").toUpperCase();
let playerId = localStorage.getItem(playerKey);
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem(playerKey, playerId);
}
let playerName = localStorage.getItem(nameKey) || "";
let state = null;
let view = "lobby";
let selectedBet = "red";
let selectedAmount = 25;
let selectedHorse = "Comet";
let socket;
let reconnectTimer;
let toastTimer;
let joined = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Reconnecting to the tables. Try again in a moment.");
    return;
  }
  socket.send(JSON.stringify(message));
}

function connect() {
  const connection = new WebSocket(socketUrl);
  socket = connection;
  connection.addEventListener("open", () => {
    document.querySelector(".online-pulse")?.classList.remove("offline");
    send({ type: "register", id: playerId, name: playerName, roomCode: requestedRoomCode });
  });
  connection.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      const previousRoomCode = state?.room.code;
      state = message.state;
      if (previousRoomCode && previousRoomCode !== state.room.code) view = "lobby";
      if (
        state.room.isPrivate &&
        state.room.selectedGame &&
        view !== "lobby" &&
        view !== state.room.selectedGame
      ) {
        view = state.room.selectedGame;
      }
      requestedRoomCode = state.room.isPrivate ? state.room.code : "";
      if (requestedRoomCode) localStorage.setItem(roomKey, requestedRoomCode);
      else localStorage.removeItem(roomKey);
      const inviteUrl = new URL(location.href);
      if (requestedRoomCode) inviteUrl.searchParams.set("room", requestedRoomCode);
      else inviteUrl.searchParams.delete("room");
      history.replaceState(null, "", inviteUrl);
      if (state.players.some((player) => player.id === playerId)) {
        joined = true;
        document.body.classList.add("joined");
      }
      updateHeader();
      updateRoomControls();
      render();
      if (previousRoomCode && previousRoomCode !== state.room.code) {
        showToast(state.room.isPrivate
          ? `Joined private room ${state.room.code}. Share the invite link with friends.`
          : "You joined the global game.");
      }
    } else if (message.type === "error") {
      if (!joined) {
        renderUsernamePicker(message.message);
      } else {
        playerName = currentPlayer()?.name ?? playerName;
        localStorage.setItem(nameKey, playerName);
        showToast(message.message);
        updateHeader();
      }
    }
  });
  connection.addEventListener("close", () => {
    if (socket !== connection) return;
    document.querySelector(".online-pulse")?.classList.add("offline");
    clearTimeout(reconnectTimer);
    if (joined) {
      reconnectTimer = setTimeout(connect, 1500);
    } else {
      renderUsernamePicker("Could not connect to the table. Check your connection and try again.");
    }
  });
}

function renderUsernamePicker(message = "") {
  const screen = document.querySelector("#join-screen");
  screen.innerHTML = `
    <section class="join-card">
      <a class="brand join-brand" href="#" aria-label="Golden Hour">
        <span class="brand-mark">G<span>H</span></span>
        <span class="brand-name">GOLDEN HOUR<small>THE SOCIAL CASINO</small></span>
      </a>
      <span class="eyebrow join-eyebrow">YOUR SEAT IS WAITING</span>
      <h1>Choose a username.</h1>
      <p class="join-description">Pick a name for the table and jump straight into the lounge. No account or password needed.</p>
      <form class="join-form" id="join-form">
        <label class="field-label" for="join-username">Display name</label>
        <input class="chip-input" id="join-username" name="username" type="text" minlength="1" maxlength="18" pattern="[A-Za-z0-9_]{1,18}" autocomplete="nickname" placeholder="e.g. GoldenAce" value="${escapeHtml(playerName)}" required>
        <small class="join-hint">1–18 letters, numbers, or underscores</small>
        <p class="join-error" id="join-error" role="alert">${escapeHtml(message)}</p>
        <button class="primary-button full-button join-submit" id="join-submit" type="submit">Join the lounge&nbsp; ↗</button>
      </form>
      <p class="join-footnote">Everyone starts with 1,000 complimentary chips. Play for fun—chips have no cash value.</p>
    </section>`;
  screen.querySelector("#join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    playerName = String(form.get("username")).trim();
    localStorage.setItem(nameKey, playerName);
    const submit = screen.querySelector("#join-submit");
    submit.disabled = true;
    submit.textContent = "Joining…";
    clearTimeout(reconnectTimer);
    if (socket) socket.close();
    connect();
  });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function currentPlayer() {
  return state?.players.find((player) => player.id === playerId);
}

function updateHeader() {
  const player = currentPlayer();
  const count = state?.players.length ?? 0;
  document.querySelector("#online-count").textContent = count;
  document.querySelector("#chip-count").textContent =
    (player?.chips ?? 1000).toLocaleString();
  document.querySelector("#profile-name").textContent = player?.name ?? playerName;
  document.querySelector("#avatar").textContent =
    (player?.name ?? (playerName || "G")).slice(0, 1).toUpperCase();
  document.querySelector("#crumb-current").textContent =
    view === "lobby" ? "OVERVIEW" : view.toUpperCase();
}

function updateRoomControls() {
  const controls = document.querySelector("#room-controls");
  if (!state?.room) {
    controls.hidden = true;
    return;
  }
  controls.hidden = false;
  const { room } = state;
  document.querySelector("#room-badge").textContent =
    room.isPrivate ? `PRIVATE · ${room.code}` : "GLOBAL GAME";
  document.querySelector("#room-members").textContent =
    `${room.members.length} ${room.members.length === 1 ? "player" : "players"} here`;
  document.querySelector("#create-room").hidden = room.isPrivate;
  document.querySelector("#join-room-form").hidden = room.isPrivate;
  document.querySelector("#join-global").hidden = !room.isPrivate;
  document.querySelector("#room-invite").hidden = !room.isPrivate;
  document.querySelectorAll(".nav-link").forEach((button) => {
    const lockedGame = room.isPrivate && room.selectedGame;
    button.disabled = Boolean(
      lockedGame &&
      button.dataset.view !== "lobby" &&
      button.dataset.view !== lockedGame
    );
    button.title = button.disabled ? `This room is locked to ${lockedGame}.` : "";
  });
  if (room.isPrivate) {
    document.querySelector("#room-invite-link").value =
      `${location.origin}/?room=${encodeURIComponent(room.code)}`;
  }
}

function roomReadiness(readyIds) {
  const members = state.room.members;
  const ready = members.filter((member) => readyIds.includes(member.id)).length;
  return {
    ready,
    total: members.length,
    complete: members.length > 0 && ready === members.length,
  };
}

function canStartRoomGame() {
  return !state.room.isPrivate || state.room.ownerId === playerId;
}

function roomReadyToStart(readiness) {
  return !state.room.isPrivate || readiness.complete;
}

function setView(nextView) {
  if (
    state?.room.isPrivate &&
    state.room.selectedGame &&
    nextView !== "lobby" &&
    nextView !== state.room.selectedGame
  ) {
    showToast(`This room is locked to ${state.room.selectedGame}.`);
    return;
  }
  if (state?.room.isPrivate && nextView !== "lobby" && !state.room.selectedGame) {
    send({ type: "select-game", game: nextView });
  }
  view = nextView;
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  updateHeader();
  render();
}

function render() {
  if (!state) {
    content.innerHTML = `<div class="hero"><div class="hero-copy"><span class="eyebrow">WELCOME TO GOLDEN HOUR</span><h1>Opening the lounge...</h1><p class="hero-subtitle">Connecting you to the live tables.</p></div></div>`;
    return;
  }
  if (view === "roulette") renderRoulette();
  else if (view === "blackjack") renderBlackjack();
  else if (view === "slots") renderSlots();
  else if (view === "horses") renderHorseRace();
  else if (view === "poker") renderPoker();
  else renderLobby();
}

function renderLobby() {
  const activePlayers = state.players;
  const recent = state.roulette.history.slice(0, 5);
  content.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">A SEAT IS WAITING FOR YOU</span>
        <h1>Good evening, ${escapeHtml(currentPlayer()?.name ?? playerName)}.</h1>
        <p class="hero-subtitle">Find your favorite table, bring a friend, and enjoy a little golden-hour luck. Your chips are ready.</p>
        <div class="hero-meta"><span><b>✳</b> ${(currentPlayer()?.chips ?? 1000).toLocaleString()} chips</span><span><b>♧</b> ${activePlayers.length} at the lounge</span></div>
      </div>
    </section>
    <div class="section-heading"><h2>${state.room.isPrivate && state.room.selectedGame ? "Room game" : "Choose your table"}</h2><p>${state.room.isPrivate ? state.room.selectedGame ? `This private room is locked to ${state.room.selectedGame}.` : "Choose one game for everyone in this private room. The choice cannot be changed." : "Live with players around the world"}</p></div>
    <div class="games-grid">
      <article class="game-card">
        <div class="game-art roulette-art"><div class="wheel"><div class="wheel-inner">✳</div></div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Roulette</h3><span class="table-live"><span></span> LIVE TABLE</span></div>
          <p>Place your bets on red, black, or a lucky number. Every player shares the same spinning wheel.</p>
          <div class="game-card-footer"><span class="players-label"><strong>${activePlayers.length}</strong> at the lounge</span><button class="primary-button" data-go="roulette">Join the table&nbsp; ↗</button></div>
        </div>
      </article>
      <article class="game-card">
        <div class="game-art blackjack-art"><div class="cards-art"><div class="playing-card red-card"><span>A ♥</span><span>A ♥</span></div><div class="playing-card black-card"><span>K ♠</span><span>K ♠</span></div></div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Blackjack</h3><span class="table-live"><span></span> LIVE TABLE</span></div>
          <p>Take a seat around the shared table. Play your hand, watch the dealer, and aim for 21.</p>
          <div class="game-card-footer"><span class="players-label"><strong>${state.blackjack.players.length}</strong> at the table</span><button class="primary-button" data-go="blackjack">Join the table&nbsp; ↗</button></div>
        </div>
      </article>
      <article class="game-card">
        <div class="game-art slots-art"><div class="slot-preview">7&nbsp; ✦&nbsp; 7</div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Slots</h3><span class="table-live"><span></span> PLAY ANYTIME</span></div>
          <p>Spin the reels for pairs and three-of-a-kind prizes. Your result and payout are shared live.</p>
          <div class="game-card-footer"><span class="players-label"><strong>${state.slots.history.length}</strong> recent spins</span><button class="primary-button" data-go="slots">Play slots&nbsp; ↗</button></div>
        </div>
      </article>
      <article class="game-card">
        <div class="game-art horses-art"><div class="horse-preview">♞ &nbsp; ♞ &nbsp; ♞ &nbsp; ♞</div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Horse race</h3><span class="table-live"><span></span> SHARED RACE</span></div>
          <p>Choose your horse, place a chip bet, and race together for a 3× payout.</p>
          <div class="game-card-footer"><span class="players-label"><strong>${state.horseRace.bets.length}</strong> bets this race</span><button class="primary-button" data-go="horses">Visit the track&nbsp; ↗</button></div>
        </div>
      </article>
      <article class="game-card">
        <div class="game-art poker-art"><div class="poker-preview">♣ &nbsp; ♠ &nbsp; ♥ &nbsp; ♦</div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Poker</h3><span class="table-live"><span></span> MULTIPLAYER</span></div>
          <p>Join a five-card showdown with friends. Best poker hand takes the pot; ties split it.</p>
          <div class="game-card-footer"><span class="players-label"><strong>${state.poker.players.length}</strong> at the table</span><button class="primary-button" data-go="poker">Join poker&nbsp; ↗</button></div>
        </div>
      </article>
    </div>
    <div class="lower-grid">
      <section class="info-panel"><h3>Recent spins</h3>
        ${recent.length ? `<div class="table-history">${recent.map((result) => `<span class="history-chip ${result.color}">${result.number}</span>`).join("")}</div>` : `<div class="activity-empty">The wheel is ready for its first spin.</div>`}
      </section>
      <section class="info-panel"><h3>Your chips, your pace</h3><p class="chip-note">Everyone starts with 1,000 complimentary chips. Your balance is saved on this browser, and all games are for entertainment only—no real money is used.</p></section>
    </div>`;
  content.querySelectorAll("[data-go]").forEach((button) => {
    const lockedGame = state.room.isPrivate && state.room.selectedGame;
    button.disabled = Boolean(lockedGame && button.dataset.go !== lockedGame);
    button.title = button.disabled ? `This room is locked to ${lockedGame}.` : "";
    button.addEventListener("click", () => setView(button.dataset.go));
  });
}

function betList() {
  const bets = state.roulette.bets;
  if (!bets.length) return `<div class="activity-empty">No bets on the table yet.</div>`;
  return `<div class="activity-list">${bets.slice(-7).reverse().map((bet) =>
    `<div class="activity-row"><span>${escapeHtml(bet.name)} · ${bet.selection}</span><small>${bet.amount} chips</small></div>`
  ).join("")}</div>`;
}

function renderRoulette() {
  const roulette = state.roulette;
  const readiness = roomReadiness(roulette.readyIds);
  const alreadyBet = roulette.readyIds.includes(playerId);
  const result = roulette.lastResult;
  const numbers = Array.from({ length: 37 }, (_, number) => number);
  const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  content.innerHTML = `
    <span class="eyebrow">THE WHEEL ROOM</span><h1>Roulette</h1>
    <p class="hero-subtitle">One table, one wheel, and every player at the edge of their seat.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>The shared wheel</h2><small>${state.room.isPrivate ? `${readiness.ready} / ${readiness.total} players ready` : `${roulette.bets.length} bets placed`}</small></div>
        <div class="roulette-table">
          <div class="roulette-result ${roulette.spinning ? "spinning" : result?.color ?? ""}">${roulette.spinning ? "✳" : result?.number ?? "—"}</div>
          <div class="result-caption">${roulette.spinning ? "The wheel is turning…" : result ? `Last result · ${result.color}` : "Place the first bet"}</div>
          <div class="table-bets">${roulette.bets.length ? roulette.bets.map((bet) => `<span class="bet-pill">${escapeHtml(bet.name)} · ${escapeHtml(bet.selection)} · ${bet.amount}</span>`).join("") : `<span class="bet-pill">The table is open</span>`}</div>
        </div>
        <div class="number-board">${numbers.map((number) => `<button class="number-cell ${number === 0 ? "green-cell" : reds.has(number) ? "red-cell" : ""} ${selectedBet === String(number) ? "selected" : ""}" data-selection="${number}">${number}</button>`).join("")}</div>
        <div class="table-history">${roulette.history.map((item) => `<span class="history-chip ${item.color}">${item.number}</span>`).join("") || `<span class="activity-empty">Recent results appear here.</span>`}</div>
      </section>
      <aside class="control-panel">
        <h3>Place your bet</h3><p class="control-copy">Choose a color or select a number on the wheel.</p>
        <div class="bet-type-row"><button class="bet-type ${selectedBet === "red" ? "selected" : ""}" data-selection="red">Red · 2×</button><button class="bet-type ${selectedBet === "black" ? "selected" : ""}" data-selection="black">Black · 2×</button></div>
        <label class="field-label" for="roulette-amount">Your wager</label>
        <div class="amount-row"><input class="chip-input" id="roulette-amount" type="number" min="1" max="500" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
        <button class="primary-button full-button" id="place-bet" ${roulette.spinning || alreadyBet ? "disabled" : ""}>${alreadyBet ? "Bet placed ✓" : `Place bet · ${selectedBet}`}</button>
        <button class="secondary-button full-button" id="spin-wheel" ${roulette.spinning || roulette.bets.length === 0 || !roomReadyToStart(readiness) || !canStartRoomGame() ? "disabled" : ""}>${roulette.spinning ? "Wheel spinning…" : roulette.bets.length === 0 ? "Place a bet to spin" : state.room.isPrivate && !readiness.complete ? "Waiting for all room bets…" : !canStartRoomGame() ? "Room host starts the game" : "Spin the wheel ↗"}</button>
        ${state.room.isPrivate ? `<p class="bet-progress">${readiness.ready} of ${readiness.total} room players have placed a bet.</p>` : ""}
        <div class="recent-bets"><h4>On the table</h4>${betList()}</div>
      </aside>
    </div>`;
  content.querySelectorAll("[data-selection]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedBet = button.dataset.selection;
      renderRoulette();
    });
  });
  content.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAmount = Number(button.dataset.amount);
      renderRoulette();
    });
  });
  content.querySelector("#roulette-amount").addEventListener("input", (event) => {
    selectedAmount = Number(event.target.value);
  });
  content.querySelector("#place-bet").addEventListener("click", () => {
    send({ type: "roulette-bet", selection: selectedBet, amount: selectedAmount });
  });
  content.querySelector("#spin-wheel").addEventListener("click", () => {
    send({ type: "roulette-spin" });
  });
}

function cardMarkup(card) {
  if (card.hidden) return `<div class="mini-card hidden-card"></div>`;
  const isRed = card.suit === "♥" || card.suit === "♦";
  return `<div class="mini-card ${isRed ? "red-suit" : ""}"><span>${card.rank} ${card.suit}</span><span>${card.suit}</span></div>`;
}

function playerHandMarkup(seat, turnId) {
  const status = seat.result || (seat.id === turnId ? "Your turn" : seat.status);
  return `<div class="seat-card ${seat.id === turnId ? "current-turn" : ""}"><div class="seat-name">${escapeHtml(seat.name)} · ${seat.bet} chips</div><div class="seat-cards">${seat.hand.map(cardMarkup).join("")}</div><div class="seat-status">${escapeHtml(status || "Waiting")}</div></div>`;
}

function renderBlackjack() {
  const game = state.blackjack;
  const readiness = roomReadiness(game.readyIds);
  const mySeat = game.players.find((seat) => seat.id === playerId);
  const myTurn = game.phase === "playing" && game.turnId === playerId;
  content.innerHTML = `
    <span class="eyebrow">THE CARD ROOM</span><h1>Blackjack</h1>
    <p class="hero-subtitle">Take a seat, make 21, and see how the whole table plays out.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>Shared blackjack table</h2><small>${game.phase === "playing" ? "Round in progress" : game.phase === "done" ? "Round complete" : "Waiting for players"}</small></div>
        <div class="blackjack-felt">
          ${game.phase === "waiting" ? `<div class="waiting-message">${game.players.length ? "The table is open. Start the round when everyone is ready." : "Take a seat to join the next round."}</div>` : ""}
          ${game.dealer.length ? `<div class="hand-area"><div class="hand-label"><span>DEALER</span><small>${game.dealerScore === null ? "?" : game.dealerScore}</small></div><div class="cards-row">${game.dealer.map(cardMarkup).join("")}</div></div>` : ""}
          ${game.players.length ? `<div class="hand-area"><div class="hand-label"><span>PLAYERS</span><small>${game.players.length} seated</small></div><div class="cards-row">${game.players.map((seat) => playerHandMarkup(seat, game.turnId)).join("")}</div></div>` : ""}
        </div>
      </section>
      <aside class="control-panel">
        <h3>${game.phase === "playing" ? (myTurn ? "Your hand" : "Table in play") : game.phase === "done" ? "Round results" : "Take a seat"}</h3>
        <p class="control-copy">${game.phase === "playing" ? (myTurn ? "Choose to hit or stand. The next player goes after you." : `${escapeHtml(game.players.find((seat) => seat.id === game.turnId)?.name ?? "A player")} is playing. Hang tight!`) : "Play chips only. Blackjack pays 3:2, a win pays 1:1, and a tie returns your bet."}</p>
        ${game.phase === "waiting" ? `
          ${mySeat ? `<div class="seat-row"><span>You are seated</span><small>${mySeat.bet} chips</small></div>` : `
          <label class="field-label" for="blackjack-amount">Your wager</label>
          <div class="amount-row"><input class="chip-input" id="blackjack-amount" type="number" min="1" max="500" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="join-blackjack">Take a seat&nbsp; +</button>`}
          <div class="recent-bets"><h4>Players ready</h4><div class="seat-list">${game.players.map((seat) => `<div class="seat-row"><span>${escapeHtml(seat.name)}</span><small>${seat.bet} chips</small></div>`).join("") || `<div class="activity-empty">No one has joined yet.</div>`}</div></div>
          ${state.room.isPrivate ? `<p class="bet-progress">${readiness.ready} of ${readiness.total} room players have placed a bet.</p>` : ""}
          <button class="primary-button full-button" id="start-blackjack" ${game.players.length === 0 || !roomReadyToStart(readiness) || !canStartRoomGame() ? "disabled" : ""}>${game.players.length === 0 ? "Take a seat first" : state.room.isPrivate && !readiness.complete ? "Waiting for all room bets…" : !canStartRoomGame() ? "Room host starts the game" : "Deal the cards ↗"}</button>
        ` : game.phase === "playing" ? `
          <div class="seat-row"><span>Your wager</span><small>${mySeat ? `${mySeat.bet} chips` : "Watching"}</small></div>
          <button class="primary-button full-button" id="hit" ${myTurn ? "" : "disabled"}>Hit&nbsp; +</button>
          <button class="secondary-button full-button" id="stand" ${myTurn ? "" : "disabled"}>Stand&nbsp; ✓</button>
        ` : `
          <div class="seat-list">${game.players.map((seat) => `<div class="seat-row"><span>${escapeHtml(seat.name)} · ${escapeHtml(seat.result || "Finished")}</span><small>${seat.bet} chips</small></div>`).join("")}</div>
          <button class="primary-button full-button" id="new-blackjack">Play another round&nbsp; ↗</button>
        `}
        <div class="table-rules"><div class="rule-row"><span>Dealer stands on</span><strong>17</strong></div><div class="rule-row"><span>Blackjack payout</span><strong>3:2</strong></div><div class="rule-row"><span>Minimum wager</span><strong>1 chip</strong></div></div>
      </aside>
    </div>`;
  content.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAmount = Number(button.dataset.amount);
      renderBlackjack();
    });
  });
  content.querySelector("#blackjack-amount")?.addEventListener("input", (event) => {
    selectedAmount = Number(event.target.value);
  });
  content.querySelector("#join-blackjack")?.addEventListener("click", () => {
    send({ type: "join-blackjack", amount: selectedAmount });
  });
  content.querySelector("#start-blackjack")?.addEventListener("click", () => {
    send({ type: "start-blackjack" });
  });
  content.querySelector("#hit")?.addEventListener("click", () => {
    send({ type: "blackjack-action", action: "hit" });
  });
  content.querySelector("#stand")?.addEventListener("click", () => {
    send({ type: "blackjack-action", action: "stand" });
  });
  content.querySelector("#new-blackjack")?.addEventListener("click", () => {
    send({ type: "join-blackjack", amount: selectedAmount });
  });
}

function renderSlots() {
  const history = state.slots.history;
  const latest = history.find((spin) => spin.playerId === playerId);
  content.innerHTML = `
    <span class="eyebrow">THE REEL ROOM</span><h1>Slots</h1>
    <p class="hero-subtitle">Spin three reels for a lucky match. Pair any symbols for 2×, three of a kind for 8×, or three sevens for 20×.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>Golden reels</h2><small>Single-player spins · shared results</small></div>
        <div class="slot-machine">
          <div class="slot-reels">${(latest?.symbols || ["✦", "♣", "7"]).map((symbol) => `<span>${symbol}</span>`).join("")}</div>
          <p>${latest ? `${latest.name === currentPlayer()?.name ? "Your" : `${escapeHtml(latest.name)}’s`} last spin · ${latest.payout ? `won ${latest.payout.toLocaleString()} chips` : "no match this time"}` : "Place a wager and spin the reels."}</p>
        </div>
        <div class="recent-bets"><h4>Recent spins</h4>
          ${history.length ? `<div class="activity-list">${history.slice(0, 8).map((spin) =>
            `<div class="activity-row"><span>${escapeHtml(spin.name)} · ${spin.symbols.join(" ")}</span><small>${spin.payout ? `+${spin.payout}` : `−${spin.amount}`} chips</small></div>`
          ).join("")}</div>` : `<div class="activity-empty">The reels are ready for their first spin.</div>`}
        </div>
      </section>
      <aside class="control-panel">
        <h3>Try your luck</h3><p class="control-copy">The wager is taken before the reels spin. All prizes are paid in complimentary chips.</p>
        <label class="field-label" for="slots-amount">Your wager</label>
        <div class="amount-row"><input class="chip-input" id="slots-amount" type="number" min="1" max="500" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
        <button class="primary-button full-button" id="spin-slots">Spin the reels&nbsp; ↗</button>
        <div class="table-rules"><div class="rule-row"><span>Any pair</span><strong>2×</strong></div><div class="rule-row"><span>Three of a kind</span><strong>8×</strong></div><div class="rule-row"><span>Three sevens</span><strong>20×</strong></div></div>
      </aside>
    </div>`;
  content.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAmount = Number(button.dataset.amount);
      renderSlots();
    });
  });
  content.querySelector("#slots-amount").addEventListener("input", (event) => {
    selectedAmount = Number(event.target.value);
  });
  content.querySelector("#spin-slots").addEventListener("click", () => {
    send({ type: "slots-spin", amount: selectedAmount });
  });
}

function renderHorseRace() {
  const race = state.horseRace;
  const readiness = roomReadiness(race.readyIds);
  const horses = ["Comet", "Clover", "Sundown", "Goldrush"];
  const myBet = race.bets.find((bet) => bet.playerId === playerId);
  content.innerHTML = `
    <span class="eyebrow">THE GRANDSTAND</span><h1>Horse race</h1>
    <p class="hero-subtitle">Pick a horse, join the shared track, and race your friends. A winning bet pays 3× its wager.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>Golden Hour Stakes</h2><small>${race.phase === "racing" ? "Race in progress" : "Open for bets"}</small></div>
        <div class="race-track ${race.phase === "racing" ? "racing" : ""}">
          ${horses.map((horse, index) => `<div class="race-lane"><span class="race-lane-name">${horse}</span><div class="track-line"><span class="horse-runner horse-${index}">♞</span><span class="finish-line"></span></div></div>`).join("")}
        </div>
        <div class="race-message">${race.phase === "racing" ? "And they’re off!" : race.winner ? `${escapeHtml(race.winner)} won the last race!` : "Choose your horse before the starting bell."}</div>
        ${state.room.isPrivate ? `<p class="bet-progress race-progress">${readiness.ready} of ${readiness.total} room players have placed a bet.</p>` : ""}
        <div class="recent-bets"><h4>On the track</h4>
          ${race.bets.length ? `<div class="activity-list">${race.bets.map((bet) =>
            `<div class="activity-row"><span>${escapeHtml(bet.name)} · ${escapeHtml(bet.horse)}</span><small>${bet.amount} chips</small></div>`
          ).join("")}</div>` : `<div class="activity-empty">No bets have been placed yet.</div>`}
        </div>
      </section>
      <aside class="control-panel">
        <h3>${myBet ? "Your race bet" : "Back a horse"}</h3>
        <p class="control-copy">${myBet ? `You backed ${escapeHtml(myBet.horse)} for ${myBet.amount} chips.` : "Place a bet on the shared race. Bets lock as soon as the race starts."}</p>
        ${!myBet ? `
          <div class="horse-options">${horses.map((horse) => `<button class="bet-type ${selectedHorse === horse ? "selected" : ""}" data-horse="${horse}" ${race.phase === "racing" ? "disabled" : ""}>${horse}</button>`).join("")}</div>
          <label class="field-label" for="horse-amount">Your wager</label>
          <div class="amount-row"><input class="chip-input" id="horse-amount" type="number" min="1" max="500" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="bet-horse" ${race.phase === "racing" ? "disabled" : ""}>Place bet on ${selectedHorse}&nbsp; · &nbsp;3×</button>` : ""}
        <button class="primary-button full-button" id="start-race" ${race.phase === "racing" || race.bets.length === 0 || !roomReadyToStart(readiness) || !canStartRoomGame() ? "disabled" : ""}>${race.phase === "racing" ? "Race in progress…" : race.bets.length === 0 ? "Place a bet to start" : state.room.isPrivate && !readiness.complete ? "Waiting for all room bets…" : !canStartRoomGame() ? "Room host starts the game" : "Start the race ↗"}</button>
        <div class="table-rules"><div class="rule-row"><span>Winning payout</span><strong>3×</strong></div><div class="rule-row"><span>Horses</span><strong>4</strong></div></div>
      </aside>
    </div>`;
  content.querySelectorAll("[data-horse]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedHorse = button.dataset.horse;
      renderHorseRace();
    });
  });
  content.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAmount = Number(button.dataset.amount);
      renderHorseRace();
    });
  });
  content.querySelector("#horse-amount")?.addEventListener("input", (event) => {
    selectedAmount = Number(event.target.value);
  });
  content.querySelector("#bet-horse")?.addEventListener("click", () => {
    send({ type: "horse-bet", horse: selectedHorse, amount: selectedAmount });
  });
  content.querySelector("#start-race").addEventListener("click", () => {
    send({ type: "horse-start" });
  });
}

function renderPoker() {
  const game = state.poker;
  const readiness = roomReadiness(game.readyIds);
  const mySeat = game.players.find((seat) => seat.id === playerId);
  content.innerHTML = `
    <span class="eyebrow">THE CARD ROOM</span><h1>Poker</h1>
    <p class="hero-subtitle">Five-card showdown with friends. Everyone buys in, the best poker hand wins the pot, and ties split it evenly.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>Five-card showdown</h2><small>${game.phase === "playing" ? "Cards dealt" : game.phase === "done" ? "Showdown complete" : "Waiting for players"}</small></div>
        <div class="blackjack-felt poker-felt">
          ${game.players.length ? `<div class="hand-area"><div class="hand-label"><span>PLAYERS · ${game.players.length} SEATED</span><small>${game.players.reduce((pot, seat) => pot + seat.bet, 0).toLocaleString()} chip pot</small></div>
            <div class="cards-row poker-seats">${game.players.map((seat) => `<div class="seat-card"><div class="seat-name">${escapeHtml(seat.name)} · ${seat.bet} chips</div><div class="seat-cards">${seat.hand.map(cardMarkup).join("")}</div><div class="seat-status">${escapeHtml(seat.result || (game.phase === "playing" ? "Showdown…" : "Waiting"))}</div></div>`).join("")}</div></div>`
            : `<div class="waiting-message">Take a seat to join the next showdown.</div>`}
          ${game.lastResult ? `<div class="poker-result">${game.lastResult.winners.map(escapeHtml).join(", ")} won with ${escapeHtml(game.lastResult.hand)} · ${game.lastResult.pot.toLocaleString()} chips</div>` : ""}
        </div>
      </section>
      <aside class="control-panel">
        <h3>${game.phase === "playing" ? "Cards are dealt" : game.phase === "done" ? "Next showdown" : "Join the table"}</h3>
        <p class="control-copy">${game.phase === "playing" ? "The cards are being revealed. Your best five-card poker hand is ranked by the table." : "This friendly five-card showdown uses play chips only. The best hand takes the pot; ties split it."}</p>
        ${game.phase === "done" ? `
          <label class="field-label" for="poker-amount">Next round buy-in</label>
          <div class="amount-row"><input class="chip-input" id="poker-amount" type="number" min="1" max="500" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="join-poker">Join the next round&nbsp; +</button>
        ` : game.phase === "waiting" ? `
          ${mySeat ? `<div class="seat-row"><span>You are in</span><small>${mySeat.bet} chips</small></div>` : `
          <label class="field-label" for="poker-amount">Buy-in</label>
          <div class="amount-row"><input class="chip-input" id="poker-amount" type="number" min="1" max="500" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="join-poker">Take a seat&nbsp; +</button>`}
          ${state.room.isPrivate ? `<p class="bet-progress">${readiness.ready} of ${readiness.total} room players have joined the round.</p>` : ""}
          <button class="primary-button full-button" id="start-poker" ${game.players.length < 2 || !roomReadyToStart(readiness) || !canStartRoomGame() ? "disabled" : ""}>${game.players.length < 2 ? "Waiting for another player…" : state.room.isPrivate && !readiness.complete ? "Waiting for everyone to join…" : !canStartRoomGame() ? "Room host starts the game" : "Deal the hands ↗"}</button>
          ${game.players.length < 2 ? `<div class="activity-empty">At least two players are needed to start.</div>` : ""}
        ` : `<div class="seat-row"><span>Round in progress</span><small>${game.players.length} players</small></div>`}
        <div class="table-rules"><div class="rule-row"><span>Hand size</span><strong>5 cards</strong></div><div class="rule-row"><span>Ties</span><strong>Split pot</strong></div><div class="rule-row"><span>Seats</span><strong>2+ players</strong></div></div>
      </aside>
    </div>`;
  content.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAmount = Number(button.dataset.amount);
      renderPoker();
    });
  });
  content.querySelector("#poker-amount")?.addEventListener("input", (event) => {
    selectedAmount = Number(event.target.value);
  });
  content.querySelector("#join-poker")?.addEventListener("click", () => {
    send({ type: "join-poker", amount: selectedAmount });
  });
  content.querySelector("#start-poker")?.addEventListener("click", () => {
    send({ type: "start-poker" });
  });
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelector("#create-room").addEventListener("click", () => {
  send({ type: "create-room" });
});
document.querySelector("#join-room-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const roomCode = document.querySelector("#room-code-input").value.trim();
  send({ type: "join-room", roomCode });
});
document.querySelector("#join-global").addEventListener("click", () => {
  send({ type: "join-room", roomCode: "global" });
});
document.querySelector("#copy-invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector("#room-invite-link").value);
    showToast("Private room invite link copied.");
  } catch (error) {
    console.error("Could not copy the private room invite link:", error);
    showToast("Copy failed. Select and copy the invite link instead.");
  }
});
document.querySelector("#edit-name").addEventListener("click", () => {
  const nextName = window.prompt("Choose a username:", playerName);
  if (nextName === null) return;
  playerName = nextName.trim().slice(0, 18);
  localStorage.setItem(nameKey, playerName);
  send({ type: "set-name", name: playerName });
});

if (playerName && playerName.toLowerCase() !== "guest") connect();
else renderUsernamePicker();
