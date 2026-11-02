const content = document.querySelector("#content");
const socketUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`;
const playerKey = "golden-hour-player";
const nameKey = "golden-hour-name";
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
    send({ type: "register", id: playerId, name: playerName });
  });
  connection.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state = message.state;
      if (state.players.some((player) => player.id === playerId)) {
        joined = true;
        document.body.classList.add("joined");
      }
      updateHeader();
      render();
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

function setView(nextView) {
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
    <div class="section-heading"><h2>Choose your table</h2><p>Live with players around the world</p></div>
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
    </div>
    <div class="lower-grid">
      <section class="info-panel"><h3>Recent spins</h3>
        ${recent.length ? `<div class="table-history">${recent.map((result) => `<span class="history-chip ${result.color}">${result.number}</span>`).join("")}</div>` : `<div class="activity-empty">The wheel is ready for its first spin.</div>`}
      </section>
      <section class="info-panel"><h3>Your chips, your pace</h3><p class="chip-note">Everyone starts with 1,000 complimentary chips. Your balance is saved on this browser, and all games are for entertainment only—no real money is used.</p></section>
    </div>`;
  content.querySelectorAll("[data-go]").forEach((button) => {
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
  const result = roulette.lastResult;
  const numbers = Array.from({ length: 37 }, (_, number) => number);
  const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  content.innerHTML = `
    <span class="eyebrow">THE WHEEL ROOM</span><h1>Roulette</h1>
    <p class="hero-subtitle">One table, one wheel, and every player at the edge of their seat.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>The shared wheel</h2><small>${state.players.length} players online</small></div>
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
        <button class="primary-button full-button" id="place-bet" ${roulette.spinning ? "disabled" : ""}>Place bet&nbsp; · &nbsp;${selectedBet}</button>
        <button class="secondary-button full-button" id="spin-wheel" ${roulette.spinning || !roulette.bets.length ? "disabled" : ""}>${roulette.spinning ? "Wheel spinning…" : "Spin the wheel"}&nbsp; ↗</button>
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
          <button class="primary-button full-button" id="start-blackjack" ${game.players.length ? "" : "disabled"}>Deal the cards&nbsp; ↗</button>
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

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
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
