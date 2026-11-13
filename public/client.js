const content = document.querySelector("#content");
const socketUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`;
const playerKey = "golden-hour-player";
const nameKey = "golden-hour-name";
const avatarKey = "golden-hour-avatar";
const avatarColorKey = "golden-hour-avatar-color";
const loggedOutKey = "golden-hour-logged-out";
const roomKey = "golden-hour-room";
const characterDefaults = { body: "average", skin: "#c98f68", hair: "wavy", hairColor: "#30231f", eyes: "#33251f", outfit: "tailored", outfitColor: "#26352c", accessory: "none", freckles: "none", facialHair: "none" };
const characterChoices = {
  body: { slim: "Slim", average: "Average", broad: "Broad", petite: "Petite", athletic: "Athletic" },
  skin: { "#f7d9bd":"Porcelain", "#f2c9a5":"Fair", "#dfad82":"Light", "#c98f68":"Warm", "#b77b58":"Olive", "#9b6548":"Brown", "#7c503b":"Deep", "#603d30":"Rich" },
  hair: { pixie:"Pixie", short:"Short", bob:"Bob", swept:"Swept", wavy:"Wavy", long:"Long", curls:"Curly", braids:"Braids", ponytail:"Ponytail", shaved:"Shaved" },
  hairColor: { "#171717":"Black", "#30231f":"Espresso", "#60402f":"Dark brown", "#8a5634":"Chestnut", "#b86e3d":"Copper", "#a84c38":"Auburn", "#d4a64f":"Blonde", "#ead29a":"Honey", "#d8d4ca":"Silver", "#8d8ba8":"Lilac" },
  eyes: { "#33251f":"Brown", "#315b78":"Blue", "#47734d":"Green", "#6d8b8a":"Hazel", "#202020":"Dark", "#78618c":"Violet" },
  outfit: { tuxedo:"Tuxedo", tailored:"Tailored suit", shirt:"Open-collar shirt", dress:"Evening dress", jacket:"Leather jacket", hoodie:"Street hoodie", varsity:"Varsity jacket", cardigan:"Cardigan", royal:"Royal coat", vest:"Waistcoat" },
  outfitColor: { "#26352c":"Casino green", "#17191d":"Midnight", "#8b3038":"Burgundy", "#b18b4c":"Champagne", "#314c70":"Navy", "#e4d8c3":"Ivory", "#76518b":"Plum", "#b86b42":"Terracotta", "#557b78":"Sage", "#c77c91":"Rose" },
  accessory: { cape:"Full cape", wings:"Wings", backpack:"Backpack", crown:"Crown", glasses:"Glasses", shades:"Sunglasses", earrings:"Earrings", chain:"Gold chain", hat:"Fedora", beanie:"Beanie", headband:"Headband", necklace:"Pendant" },
  freckles: { none:"None", light:"Light freckles", many:"Freckles", beauty:"Beauty mark" },
  facialHair: { none:"Clean shaven", stubble:"Stubble", moustache:"Moustache", beard:"Full beard" }
};
let playerCharacter = (() => { try { const saved = JSON.parse(localStorage.getItem("golden-hour-character") || "{}"); const character = { ...characterDefaults, ...saved }; character.accessories = Array.isArray(saved.accessories) ? saved.accessories : (saved.accessory && saved.accessory !== "none" ? [saved.accessory] : []); return character; } catch { return { ...characterDefaults, accessories: [] }; } })();
const avatarOptions = ["🦊"];
const avatarColorOptions = ["#d6b46a"];
const queryRoomCode = new URLSearchParams(location.search).get("room") || "";
let requestedRoomCode = (queryRoomCode || localStorage.getItem(roomKey) || "").toUpperCase();
let playerId = localStorage.getItem(playerKey);
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem(playerKey, playerId);
}
let playerName = localStorage.getItem(nameKey) || "";
let playerAvatar = avatarOptions.includes(localStorage.getItem(avatarKey)) ? localStorage.getItem(avatarKey) : "🦊";
let playerAvatarColor = avatarColorOptions.includes(localStorage.getItem(avatarColorKey)) ? localStorage.getItem(avatarColorKey) : avatarColorOptions[0];
let loggedOut = localStorage.getItem(loggedOutKey) === "true";
let state = null;
let remoteCursors = [];
let lastCursorSentAt = 0;
let view = "lobby";
let selectedBet = "red";
let selectedAmount = 25;
let selectedHorse = "Comet";
const localGameCooldowns = { slots: 0, wheel: 0, plinko: 0 };
const animatedGameResults = { slots: null, wheel: null, plinko: null };
function gameCooldownActive(game) { return localGameCooldowns[game] > Date.now(); }
function triggerTimedGameAction(game, message) {
  if (gameCooldownActive(game)) return;
  const durations = { slots: 1300, wheel: 4300, plinko: 2400 };
  localGameCooldowns[game] = Date.now() + (durations[game] || 5000);
  send(message);
  render();
  window.setTimeout(() => {
    if (game === "plinko") {
      // Do not rerender the game board when the wager cooldown ends:
      // replacing the board DOM would interrupt the in-progress ball animation.
      const button = content.querySelector("#drop-plinko");
      if (button) {
        button.disabled = false;
        button.textContent = "Drop the ball ↘";
      }
    } else {
      render();
    }
  }, (durations[game] || 5000) + 50);
}
function shouldAnimateResult(game, timestamp) {
  if (!timestamp || Date.now() - timestamp > 6000 || animatedGameResults[game] === timestamp) return false;
  animatedGameResults[game] = timestamp;
  return true;
}
let socket;
let reconnectTimer;
let toastTimer;
let announcementTimer;
let joined = false;
let kickedFromRoom = false;
let adminAuthenticated = false;
let adminPanelOpen = false;
let adminPlayers = [];
function preserveFocusedField(renderCallback) {
  const active = document.activeElement;
  if (!active || !active.matches("input, textarea")) return renderCallback();
  const key = active.id ? { id: active.id } : active.dataset.adminPlayerId ? { adminPlayerId: active.dataset.adminPlayerId } : null;
  if (!key) return renderCallback();
  const saved = { value: active.value, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection };
  renderCallback();
  const selector = key.id ? "#" + CSS.escape(key.id) : '[data-admin-player-id="' + CSS.escape(key.adminPlayerId) + '"]';
  const replacement = document.querySelector(selector);
  if (replacement) {
    replacement.value = saved.value;
    replacement.focus({ preventScroll: true });
    if (saved.start !== null && saved.end !== null) replacement.setSelectionRange(saved.start, saved.end, saved.direction);
  }
}

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
    send({ type: "register", id: playerId, name: playerName, avatar: playerAvatar, avatarColor: playerAvatarColor, character: playerCharacter, roomCode: requestedRoomCode });
  });
  connection.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "cursors") {
      remoteCursors = Array.isArray(message.players) ? message.players : [];
      renderRemoteCursors();
    } else if (message.type === "state") {
      const previousRoom = state?.room;
      const previousRoomCode = previousRoom?.code;
      const previousGame = currentPlayer()?.currentGame || null;
      state = message.state;
      const updatedPlayer = currentPlayer();
      if (previousGame && !updatedPlayer?.currentGame) view = "lobby";
      if (previousRoomCode && previousRoomCode !== state.room.code) view = "lobby";
      if (previousRoom?.ended && previousRoom.code === state.room.code && !state.room.ended) {
        view = "lobby";
      }
      if (
        state.room.isPrivate &&
        state.room.selectedGame &&
        currentPlayer()?.currentGame === state.room.selectedGame &&
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
      renderRoomChat();
      render();
      if (previousRoomCode && previousRoomCode !== state.room.code) {
        if (kickedFromRoom) {
          kickedFromRoom = false;
          showToast("The host moved you to the global game.");
        } else {
          showToast(state.room.isPrivate
            ? `Joined private room ${state.room.code}. Share the invite link with friends.`
            : "You joined the global game.");
        }
      }
    } else if (message.type === "room-kicked") {
      kickedFromRoom = true;
    } else if (message.type === "admin-auth") {
      adminAuthenticated = Boolean(message.success);
      adminPlayers = [];
      document.querySelector("#admin-login-error").textContent = message.success ? "" : message.message;
      if (!message.success) showToast(message.message);
      renderAdminPanel();
    } else if (message.type === "admin-state") {
      adminAuthenticated = true;
      adminPlayers = message.players;
      renderAdminPanel();
    } else if (message.type === "admin-logged-out") {
      adminAuthenticated = false;
      adminPlayers = [];
      renderAdminPanel();
      showToast(message.message);
    } else if (message.type === "announcement") {
      showAnnouncement(message.text);
    } else if (message.type === "daily-global-bonus") {
      showToast(`Daily global bonus: +${message.amount.toLocaleString()} chips!`);
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
    adminAuthenticated = false;
    adminPlayers = [];
    renderAdminPanel();
    document.querySelector(".online-pulse")?.classList.add("offline");
    clearTimeout(reconnectTimer);
    if (loggedOut) {
      renderUsernamePicker();
    } else if (joined) {
      reconnectTimer = setTimeout(connect, 1500);
    } else {
      renderUsernamePicker("Could not connect to the table. Check your connection and try again.");
    }
  });
}

let characterRenderCount = 0;
function characterMarkup(character = playerCharacter, className = "character-art") {
  const c = { ...characterDefaults, ...character };
  const id = "ghchar" + (++characterRenderCount);
  const skin = c.skin, hair = c.hairColor, outfit = c.outfitColor;
  const accessories = Array.isArray(c.accessories) ? c.accessories : (c.accessory && c.accessory !== "none" ? [c.accessory] : []);
  const has = name => accessories.includes(name);
  const broad = c.body === "broad" || c.body === "athletic";
  const slim = c.body === "slim" || c.body === "petite";
  const l = broad ? 28 : slim ? 35 : 32, r = 100-l;
  const backHair = c.hair === "long"
    ? '<path d="M29 35Q25 12 50 11Q75 12 71 35L75 91Q70 104 63 95L64 43Q50 33 36 43L37 95Q30 104 25 91Z" fill="url(#'+id+'-hair)"/>'
    : c.hair === "bob"
    ? '<path d="M28 35Q24 11 50 11Q76 11 72 35L69 70Q64 82 59 68L60 42H40L41 68Q36 82 31 70Z" fill="url(#'+id+'-hair)"/>'
    : c.hair === "braids"
    ? '<path d="M30 31Q25 13 50 12Q75 13 70 31L75 88Q71 97 66 89L64 40Q50 32 36 40L34 89Q29 97 25 88Z" fill="url(#'+id+'-hair)"/>'
    : c.hair === "ponytail"
    ? '<path d="M66 25Q80 26 78 42Q77 53 68 58L65 49Z" fill="url(#'+id+'-hair)"/>'
    : "";
  const frontHair = c.hair === "shaved" ? "" :
    c.hair === "curls"
    ? '<path d="M28 36Q22 28 30 22Q28 12 39 16Q45 7 52 15Q63 8 66 19Q78 20 72 34Q66 31 61 34Q54 39 49 33Q40 39 35 33Z" fill="url(#'+id+'-hair)"/>'
    : c.hair === "pixie" || c.hair === "short"
    ? '<path d="M28 36Q25 13 50 12Q75 13 72 36Q64 27 56 29Q43 23 28 36Z" fill="url(#'+id+'-hair)"/>'
    : c.hair === "swept"
    ? '<path d="M27 37Q24 13 50 12Q75 12 73 34Q61 25 49 29Q39 31 27 37Z" fill="url(#'+id+'-hair)"/>'
    : '<path d="M28 36Q25 12 50 12Q75 12 72 36Q61 29 53 30Q41 25 28 36Z" fill="url(#'+id+'-hair)"/>';
  const clothes = {
    tuxedo: '<path d="M'+l+' 68Q50 60 '+r+' 68L72 112H28Z" fill="url(#'+id+'-cloth)"/><path d="M39 66L50 83L61 66L56 108L50 97L44 108Z" fill="#e9e2d4"/><path d="M50 83l4 7-4 7-4-7Z" fill="#c7a45e"/>',
    tailored: '<path d="M'+l+' 68Q50 60 '+r+' 68L72 112H28Z" fill="url(#'+id+'-cloth)"/><path d="M39 66L50 82L61 66L56 108L50 97L44 108Z" fill="#d8cfbb"/>',
    shirt: '<path d="M'+l+' 68Q50 61 '+r+' 68L70 112H30Z" fill="url(#'+id+'-cloth)"/><path d="M40 66L50 81L60 66L55 74L50 84L45 74Z" fill="#eee5d4"/>',
    dress: '<path d="M39 66Q50 62 61 66L76 119H24Z" fill="url(#'+id+'-cloth)"/>',
    jacket: '<path d="M'+l+' 68Q50 60 '+r+' 68L72 112H28Z" fill="url(#'+id+'-cloth)"/><path d="M38 66L50 84L62 66L57 110L50 98L43 110Z" fill="#20231f"/>',
    hoodie: '<path d="M'+l+' 68Q50 59 '+r+' 68L72 112H28Z" fill="url(#'+id+'-cloth)"/><path d="M39 65Q50 59 61 65L58 82Q50 89 42 82Z" fill="#20251f"/><path d="M44 82v13m12-13v13" stroke="#d8cdb8" stroke-opacity=".65" stroke-width="1.4"/>',
    varsity: '<path d="M'+l+' 68Q50 60 '+r+' 68L72 112H28Z" fill="url(#'+id+'-cloth)"/><path d="M50 67v44" stroke="#e6deca" stroke-width="2.5"/>',
    cardigan: '<path d="M'+l+' 68Q50 61 '+r+' 68L70 112H30Z" fill="url(#'+id+'-cloth)"/><path d="M40 66L50 82L60 66L55 110L50 98L45 110Z" fill="#d9cdb4"/>',
    royal: '<path d="M'+l+' 68Q50 58 '+r+' 68L77 119H23Z" fill="url(#'+id+'-cloth)" stroke="#c9a85f" stroke-width=".8"/><path d="M38 66L50 84L62 66L57 111L50 99L43 111Z" fill="#e6d8bb"/>',
    vest: '<path d="M'+l+' 68Q50 61 '+r+' 68L70 112H30Z" fill="url(#'+id+'-cloth)"/><path d="M40 66L50 81L60 66L56 110L50 98L44 110Z" fill="#d8cdb6"/>'
  };
  const backAccessories = [
    has("wings") ? '<path d="M34 69Q17 52 8 65Q10 92 35 104Q42 87 34 69ZM66 69Q83 52 92 65Q90 92 65 104Q58 87 66 69Z" fill="url(#'+id+'-addon)" stroke="#e7d6ad" stroke-width="1.1"/><path d="M13 68l18 29m56-29L69 97" stroke="#fff" stroke-opacity=".38" stroke-width="1.8"/>' : "",
    has("cape") ? '<path d="M35 67Q50 62 65 67L79 125Q50 137 21 125Z" fill="url(#'+id+'-addon)" stroke="#c8a45d" stroke-width="1.2"/>' : "",
    has("backpack") ? '<path d="M34 70Q50 64 66 70L71 108H29Z" fill="url(#'+id+'-addon)" stroke="#b99454"/><path d="M36 76v26m28-26v26" stroke="#e8d5a4" stroke-opacity=".55" stroke-width="2"/>' : ""
  ].join("");
  const arms = '<path d="M'+(l+3)+' 72Q'+(l-1)+' 78 '+(l+1)+' 101L'+(l+7)+' 104Q'+(l+11)+' 88 '+(l+12)+' 77ZM'+(r-3)+' 72Q'+(r+1)+' 78 '+(r-1)+' 101L'+(r-7)+' 104Q'+(r-11)+' 88 '+(r-12)+' 77Z" fill="url(#'+id+'-cloth)" stroke="#000" stroke-opacity=".08"/><path d="M'+(l+1)+' 99Q'+(l-1)+' 107 '+(l+7)+' 111L'+(l+12)+' 106L'+(l+8)+' 98ZM'+(r-1)+' 99Q'+(r+1)+' 107 '+(r-7)+' 111L'+(r-12)+' 106L'+(r-8)+' 98Z" fill="url(#'+id+'-skin)"/>';
  const legs = '<path d="M39 110L38 137Q43 140 48 137L49 111ZM51 111L52 137Q57 140 62 137L61 110Z" fill="url(#'+id+'-cloth)"/><path d="M35 134H49V140H34Q31 138 35 134ZM51 134H65V140H51Z" fill="#211e19"/>';
  const ears = '<path d="M29 37Q23 35 24 45Q25 53 31 54L34 49ZM71 37Q77 35 76 45Q75 53 69 54L66 49Z" fill="url(#'+id+'-skin)" stroke="#9a684d" stroke-opacity=".2"/>';
  const head = '<path d="M50 13C36 13 28 23 28 39c0 15 9 25 22 25s22-10 22-25C72 23 64 13 50 13Z" fill="url(#'+id+'-skin)" stroke="#553a2b" stroke-opacity=".18"/>';
  const face = '<path d="M38 36Q42 33 46 36M54 36Q58 33 62 36" fill="none" stroke="#51392d" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="42" cy="42" rx="3.1" ry="3.8" fill="#fff5e9"/><ellipse cx="58" cy="42" rx="3.1" ry="3.8" fill="#fff5e9"/><ellipse cx="42" cy="42" rx="1.8" ry="2.5" fill="'+c.eyes+'"/><ellipse cx="58" cy="42" rx="1.8" ry="2.5" fill="'+c.eyes+'"/><circle cx="42.6" cy="41.2" r=".8" fill="#fff"/><circle cx="58.6" cy="41.2" r=".8" fill="#fff"/><path d="M50 43l-2 5 3 1" fill="none" stroke="#8d604b" stroke-width="1.1"/><path d="M46 53Q50 56 54 53" fill="none" stroke="#995c54" stroke-width="1.5" stroke-linecap="round"/>';
  const freckles = c.freckles === "light" || c.freckles === "many"
    ? '<g fill="#8b5945" opacity=".65">'+Array.from({length:c.freckles === "many" ? 10 : 5},(_,i)=>'<circle cx="'+(36+(i%5)*3.5)+'" cy="'+(47+Math.floor(i/5)*3)+'" r=".75"/>').join("")+'</g>'
    : c.freckles === "beauty" ? '<circle cx="63" cy="48" r="1.2" fill="#684437"/>' : "";
  const facialHair = c.facialHair === "beard"
    ? '<path d="M31 49Q50 68 69 49L65 61Q50 75 35 61Z" fill="url(#'+id+'-hair)"/>'
    : c.facialHair === "moustache"
    ? '<path d="M40 51Q45 47 50 51Q55 47 60 51Q56 57 50 54Q44 57 40 51Z" fill="'+hair+'"/>'
    : c.facialHair === "stubble"
    ? '<path d="M35 55Q50 64 65 55" fill="none" stroke="'+hair+'" stroke-width="2.5" stroke-dasharray="1 2.5"/>' : "";
  const headwear = [
    has("hat") ? '<path d="M29 20Q50 3 71 20L74 29H26Z" fill="url(#'+id+'-addon)" stroke="#d6b66d"/><path d="M19 29Q50 25 81 29L78 34H22Z" fill="#28231b" stroke="#d6b66d"/>' : "",
    has("crown") ? '<path d="M30 23l4-12 10 9 6-14 7 14 10-9 4 12Z" fill="url(#'+id+'-addon)" stroke="#f1d88d"/><path d="M31 23h38v4H31Z" fill="#d4b15f"/>' : "",
    has("beanie") ? '<path d="M28 28Q30 8 50 8Q70 8 72 28Z" fill="url(#'+id+'-addon)" stroke="#d6b66d"/><path d="M28 27h44v5H28Z" fill="#c09b5d"/>' : "",
    has("headband") ? '<path d="M28 29Q50 18 72 29" fill="none" stroke="#c09b5d" stroke-width="4"/>' : ""
  ].join("");
  const faceAccessories = [
    has("glasses") ? '<g fill="none" stroke="#d9bd79" stroke-width="1.7"><rect x="32" y="37" width="16" height="11" rx="4"/><rect x="52" y="37" width="16" height="11" rx="4"/><path d="M48 41h4"/></g>' : "",
    has("shades") ? '<g fill="#17191d" stroke="#d9bd79" stroke-width="1.5"><rect x="32" y="37" width="16" height="11" rx="4"/><rect x="52" y="37" width="16" height="11" rx="4"/></g>' : "",
    has("earrings") ? '<g fill="url(#'+id+'-addon)" stroke="#f2d58c"><circle cx="27" cy="50" r="2.6"/><circle cx="73" cy="50" r="2.6"/></g>' : ""
  ].join("");
  const neckAccessories = [
    has("chain") ? '<path d="M39 65Q50 81 61 65" fill="none" stroke="#e4c16e" stroke-width="2.4"/>' : "",
    has("necklace") ? '<path d="M39 65Q50 82 61 65" fill="none" stroke="#e4c16e" stroke-width="2.4"/><path d="M50 74l3 4-3 4-3-4Z" fill="#d6af5a"/>' : ""
  ].join("");
  return '<svg class="'+className+'" viewBox="0 0 100 145" role="img" aria-label="Your custom character"><defs>'+
    '<linearGradient id="'+id+'-skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".42"/><stop offset=".38" stop-color="'+skin+'"/><stop offset="1" stop-color="#422719" stop-opacity=".42"/></linearGradient>'+
    '<linearGradient id="'+id+'-cloth" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".28"/><stop offset=".4" stop-color="'+outfit+'"/><stop offset="1" stop-color="#080b0a" stop-opacity=".55"/></linearGradient>'+
    '<linearGradient id="'+id+'-hair" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".3"/><stop offset=".32" stop-color="'+hair+'"/><stop offset="1" stop-color="#090807" stop-opacity=".5"/></linearGradient>'+
    '<linearGradient id="'+id+'-addon" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4d2" stop-opacity=".7"/><stop offset=".35" stop-color="#b68e4e"/><stop offset="1" stop-color="#342319"/></linearGradient></defs>'+
    '<ellipse cx="50" cy="140" rx="23" ry="3.5" fill="#000" opacity=".26"/>'+backAccessories+legs+backHair+
    '<path d="M44 57H56V70H44Z" fill="url(#'+id+'-skin)"/>'+
    '<path d="M'+l+' 70Q50 60 '+r+' 70L71 113Q50 120 29 113Z" fill="url(#'+id+'-cloth)"/>'+
    (clothes[c.outfit] || clothes.tailored)+arms+ears+head+face+freckles+facialHair+frontHair+headwear+faceAccessories+neckAccessories+
    '<path d="M34 22Q42 12 54 14" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2" stroke-linecap="round"/></svg>';
}
function characterOptionField(key, title) {
  const options = characterChoices[key];
  const isColor = key === "skin" || key === "hairColor" || key === "eyes" || key === "outfitColor";
  const multi = key === "accessory";
  return `<section class="creator-option-group"><h4>${title}${multi ? " · choose as many as you like" : ""}</h4><div class="creator-options ${isColor ? "creator-swatches" : ""}">${Object.entries(options).map(([value,label]) => {
    const selected = multi ? (playerCharacter.accessories || []).includes(value) : playerCharacter[key] === value;
    return `<button type="button" class="creator-option ${selected ? "selected" : ""}" ${multi ? "data-character-toggle" : "data-character-choice"}="${key}" data-value="${value}" title="${label}" aria-pressed="${selected}">${isColor ? `<i style="--swatch:${value}"></i><span>${label}</span>` : label}</button>`;
  }).join("")}</div></section>`;
}
function saveCharacter() {
  localStorage.setItem("golden-hour-character", JSON.stringify(playerCharacter));
  playerAvatar = "🎭";
  playerAvatarColor = playerCharacter.skin;
  localStorage.setItem(avatarKey, playerAvatar);
  localStorage.setItem(avatarColorKey, playerAvatarColor);
}
function renderCharacterCreator(message = "", fromJoin = false) {
  const screen = document.querySelector("#join-screen");
  const panels = {
    hair: characterOptionField("hair","Hairstyle") + characterOptionField("hairColor","Hair colour"),
    face: characterOptionField("skin","Skin tone") + characterOptionField("eyes","Eye colour") + characterOptionField("freckles","Face details") + characterOptionField("facialHair","Facial hair"),
    outfit: characterOptionField("outfit","Outfit") + characterOptionField("outfitColor","Outfit colour") + characterOptionField("body","Body shape"),
    extras: characterOptionField("accessory","Accessories")
  };
  screen.innerHTML = `
    <div class="character-creator-shell">
      <header class="creator-top"><button class="quiet-button" id="creator-back" type="button">← Back</button><div class="creator-brand">GOLDEN HOUR <span>CHARACTER STUDIO</span></div><span class="creator-step">BUILD YOUR LOOK</span></header>
      <div class="creator-layout">
        <section class="creator-preview-panel"><span class="eyebrow">LIVE PREVIEW</span><div class="creator-stage"><div class="creator-aura"></div>${characterMarkup(playerCharacter,"creator-character-art")}</div><h2 id="creator-preview-name">${escapeHtml(playerName || "Your character")}</h2><p>Your look goes with you to every table.</p><div class="creator-preview-caption">GOLDEN HOUR · CHARACTER STUDIO</div></section>
        <section class="creator-controls"><div class="creator-panel-heading"><span class="eyebrow">CHARACTER CUSTOMIZATION</span><h1>Create your character</h1><p>Choose a feature, then pick your style.</p></div>
          <label class="creator-field creator-name"><span>DISPLAY NAME</span><input class="chip-input" id="creator-username" maxlength="18" pattern="[A-Za-z0-9_]{1,18}" placeholder="Choose a name" value="${escapeHtml(playerName)}"></label>
          <nav class="creator-tabs" aria-label="Character categories">${[["hair","✦","Hair"],["face","◉","Face"],["outfit","♢","Outfit"],["extras","✧","Extras"]].map(([id,icon,label],i)=>`<button type="button" class="creator-tab ${i===0?"active":""}" data-creator-tab="${id}"><span>${icon}</span>${label}</button>`).join("")}</nav>
          <div class="creator-tab-content" id="creator-tab-content">${panels.hair}</div>
          <p class="creator-error" id="creator-error" role="alert">${escapeHtml(message)}</p>
          <button class="primary-button full-button" id="creator-save" type="button">${fromJoin ? "Save character & enter" : "Save character"} <span>→</span></button>
        </section>
      </div>
    </div>`;
  let activeTab = "hair";
  screen.querySelector("#creator-back").addEventListener("click", () => {
    if (fromJoin) renderUsernamePicker(message);
    else { document.body.classList.add("joined"); screen.innerHTML = ""; }
  });
  screen.querySelectorAll("[data-creator-tab]").forEach(button => button.addEventListener("click", () => {
    activeTab = button.dataset.creatorTab;
    screen.querySelectorAll("[data-creator-tab]").forEach(tab => tab.classList.toggle("active", tab === button));
    screen.querySelector("#creator-tab-content").innerHTML = panels[activeTab];
  }));
  screen.querySelector("#creator-tab-content").addEventListener("click", event => {
    const button = event.target.closest("[data-character-choice], [data-character-toggle]");
    if (!button) return;
    const key = button.dataset.characterChoice || button.dataset.characterToggle;
    const value = button.dataset.value;
    if (button.hasAttribute("data-character-toggle")) {
      const selected = new Set(playerCharacter.accessories || []);
      selected.has(value) ? selected.delete(value) : selected.add(value);
      playerCharacter.accessories = [...selected];
      playerCharacter.accessory = "none";
      screen.querySelectorAll("[data-character-toggle]").forEach(option => {
        const active = playerCharacter.accessories.includes(option.dataset.value);
        option.classList.toggle("selected", active);
        option.setAttribute("aria-pressed", String(active));
      });
    } else {
      playerCharacter[key] = value;
      screen.querySelectorAll(`[data-character-choice="${key}"]`).forEach(option => {
        const active = option === button;
        option.classList.toggle("selected", active);
        option.setAttribute("aria-pressed", String(active));
      });
    }
    screen.querySelector(".creator-stage").innerHTML = `<div class="creator-aura"></div>${characterMarkup(playerCharacter,"creator-character-art")}`;
  });
  screen.querySelector("#creator-username").addEventListener("input", event => {
    playerName = event.target.value;
    screen.querySelector("#creator-preview-name").textContent = playerName || "Your character";
  });
  screen.querySelector("#creator-save").addEventListener("click", () => {
    const candidate = screen.querySelector("#creator-username").value.trim();
    if (!/^[A-Za-z0-9_]{1,18}$/.test(candidate)) {
      screen.querySelector("#creator-error").textContent = "Choose a name with 1–18 letters, numbers or underscores.";
      return;
    }
    playerName = candidate;
    localStorage.setItem(nameKey, playerName);
    saveCharacter();
    if (joined && socket?.readyState === WebSocket.OPEN) {
      send({ type: "update-character", character: playerCharacter });
      document.body.classList.add("joined");
      screen.innerHTML = "";
      updateHeader();
      showToast("Character saved.");
    } else {
      loggedOut = false;
      localStorage.removeItem(loggedOutKey);
      if (socket) socket.close();
      connect();
    }
  });
}
function renderUsernamePicker(message = "") {
  const screen = document.querySelector("#join-screen");
  screen.innerHTML = `
    <div class="login-experience login-minimal"><section class="login-panel">
      <a class="brand join-brand" href="/" aria-label="Golden Hour"><span class="brand-mark">G<span>H</span></span><span class="brand-name">GOLDEN HOUR<small>THE SOCIAL CASINO</small></span></a>
      <div class="login-form-wrap"><span class="eyebrow login-eyebrow">WELCOME IN</span><h2>Pull up a chair.</h2>
        <p class="login-intro">Choose a name, then create a character that feels like you.</p>
        <form class="join-form" id="join-form"><label class="field-label" for="join-username">DISPLAY NAME</label>
          <div class="login-input-wrap"><input class="chip-input" id="join-username" name="username" type="text" minlength="1" maxlength="18" pattern="[A-Za-z0-9_]{1,18}" autocomplete="nickname" placeholder="Choose a name" value="${escapeHtml(playerName)}" required></div>
          <small class="join-hint">1–18 letters, numbers or underscores</small>
          <div class="creator-character-launch"><div>${characterMarkup(playerCharacter,"login-character-preview")}<span>YOUR CHARACTER</span></div><button class="secondary-button" id="open-character-creator" type="button">Create character →</button></div>
          <p class="join-error" id="join-error" role="alert">${escapeHtml(message)}</p>
          <button class="primary-button full-button join-submit" id="join-submit" type="submit"><span>Enter Golden Hour</span><span>→</span></button>
        </form><div class="login-perks"><span>1,000 free virtual chips</span><span>Play with friends in private rooms</span></div>
      </div><div class="login-panel-bottom"><span>JUST FOR FUN</span><span>VIRTUAL CHIPS · NO CASH VALUE</span></div>
    </section></div>`;
  screen.querySelector("#open-character-creator").addEventListener("click", () => {
    playerName = screen.querySelector("#join-username")?.value || playerName;
    renderCharacterCreator("", true);
  });
  screen.querySelector("#join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    playerName = String(new FormData(event.currentTarget).get("username")).trim();
    localStorage.setItem(nameKey, playerName);
    saveCharacter();
    loggedOut = false;
    localStorage.removeItem(loggedOutKey);
    const submit = screen.querySelector("#join-submit");
    submit.disabled = true;
    submit.querySelector("span:first-child").textContent = "Joining…";
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

function showAnnouncement(message) {
  const banner = document.querySelector("#announcement-banner");
  if (!banner) return showToast("📢 " + message);
  banner.textContent = "📢  " + message;
  banner.classList.add("visible");
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => banner.classList.remove("visible"), 7000);
}

function currentPlayer() {
  return state?.players.find((player) => player.id === playerId);
}

function playerLabel(id, name) {
  const player = state?.players.find((item) => item.id === id);
  return `${escapeHtml(player?.avatar || "🎭")} ${escapeHtml(name)}`;
}

function isAdminDisplayName() {
  return (currentPlayer()?.name ?? playerName).trim().toLocaleLowerCase() === "stijn";
}

function updateHeader() {
  const player = currentPlayer();
  const count = state?.players.length ?? 0;
  document.querySelector("#online-count").textContent = count;
  document.querySelector("#chip-count").textContent =
    (player?.chips ?? 1000).toLocaleString();
  document.querySelector("#profile-name").textContent = player?.name ?? playerName;
  const avatar = document.querySelector("#avatar");
  avatar.innerHTML = characterMarkup(player?.character || playerCharacter, "profile-character-art");
  avatar.style.backgroundColor = "transparent";
  document.querySelector("#crumb-current").textContent =
    view === "lobby" ? "OVERVIEW" : view.toUpperCase();
  document.querySelector("#admin-toggle").hidden = !isAdminDisplayName();
  if (!isAdminDisplayName()) {
    adminPanelOpen = false;
    adminAuthenticated = false;
    adminPlayers = [];
  }
  renderAdminPanel();
}

function renderAdminPanel() {
  preserveFocusedField(renderAdminPanelContent);
}

function renderAdminPanelContent() {
  const panel = document.querySelector("#admin-panel");
  if (!panel) return;
  panel.hidden = !isAdminDisplayName() || !adminPanelOpen;
  document.querySelector("#admin-login-form").hidden = adminAuthenticated;
  document.querySelector("#admin-player-list").hidden = !adminAuthenticated;
  document.querySelector("#admin-announcement-form").hidden = !adminAuthenticated;
  document.querySelector("#admin-tools").hidden = !adminAuthenticated;
  if (!adminAuthenticated) return;
  const playerRows = adminPlayers.map((player) => {
    const roomLabel = player.isPrivate ? "Private · " + escapeHtml(player.roomCode) : "Global";
    return "<tr><td>" + escapeHtml(player.name) + "</td><td>" + roomLabel +
      "</td><td>" + escapeHtml(player.game || "lobby") + "</td><td class=\"admin-balance\">" + player.chips.toLocaleString() +
      "</td><td><div class=\"admin-adjust\"><input class=\"chip-input\" data-admin-player-id=\"" + escapeHtml(player.id) + "\" type=\"number\" min=\"1\" max=\"1000000\" step=\"1\" value=\"100\" aria-label=\"Chip amount for " +
      escapeHtml(player.name) + "\"><button class=\"secondary-button\" type=\"button\" data-admin-action=\"grant\" data-player-id=\"" +
      escapeHtml(player.id) + "\">Grant</button><button class=\"quiet-button\" type=\"button\" data-admin-action=\"take\" data-player-id=\"" +
      escapeHtml(player.id) + "\">Take</button><button class=\"quiet-button\" type=\"button\" data-admin-action=\"kick\" data-player-id=\"" +
      escapeHtml(player.id) + "\">Move to global</button><button class=\"quiet-button\" type=\"button\" data-admin-action=\"mute\" data-player-id=\"" +
      escapeHtml(player.id) + "\">" + (player.muted ? "Unmute chat" : "Mute chat") + "</button></div></td></tr>";
  }).join("");
  document.querySelector("#admin-player-list").innerHTML = adminPlayers.length
    ? "<div class=\"admin-table-wrap\"><table class=\"admin-table\"><thead><tr><th>Player</th><th>Room</th><th>Game</th><th>Balance</th><th>Actions</th></tr></thead><tbody>" + playerRows + "</tbody></table></div>"
    : "<p class=\"activity-empty\">No players are online right now.</p>";
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
  const scoreboard = document.querySelector("#room-scoreboard");
  scoreboard.hidden = !room.isPrivate;
  if (room.isPrivate) {
    const isHost = room.ownerId === playerId;
    const list = document.querySelector("#room-scoreboard-list");
    list.innerHTML = room.members.map((member) => `<span class="room-balance"><strong>${escapeHtml(member.name)}${member.id === room.ownerId ? " · HOST" : ""}</strong><small>${member.chips.toLocaleString()} chips</small>${isHost && member.id !== playerId ? `<button class="quiet-button room-kick" type="button" data-kick="${escapeHtml(member.id)}" aria-label="Kick ${escapeHtml(member.name)} from the room">Kick</button>` : ""}</span>`).join("");
    list.querySelectorAll("[data-kick]").forEach((button) => {
      button.addEventListener("click", () => {
        if (window.confirm("Kick this player from the private room?")) {
          send({ type: "kick-player", playerId: button.dataset.kick });
        }
      });
    });
  }
  document.querySelector("#create-room").hidden = room.isPrivate;
  document.querySelector("#join-room-form").hidden = room.isPrivate;
  document.querySelector("#join-global").hidden = !room.isPrivate;
  document.querySelector("#room-invite").hidden = !room.isPrivate;
  document.querySelectorAll(".nav-link").forEach((button) => {
    const activeGame = currentPlayer()?.currentGame;
    const lockedGame = room.isPrivate && room.selectedGame;
    const waitingForHost = room.isPrivate && !lockedGame && room.ownerId !== playerId;
    button.disabled = Boolean(
      (activeGame && button.dataset.view !== "lobby" && button.dataset.view !== activeGame) ||
      (lockedGame && button.dataset.view !== "lobby" && button.dataset.view !== lockedGame) ||
      (waitingForHost && button.dataset.view !== "lobby")
    );
    button.title = waitingForHost && button.dataset.view !== "lobby"
      ? "Waiting for the host to choose a game."
      : activeGame && button.disabled ? "Press Quit game before switching games."
      : lockedGame && button.disabled ? `This room is locked to ${lockedGame}.` : "";
  });
  if (room.isPrivate) {
    document.querySelector("#room-invite-link").value =
      `${location.origin}/?room=${encodeURIComponent(room.code)}`;
  }
}
function roomReadiness(readyIds) {
  const members = state.room.members.filter((member) =>
    member.chips > 0 || readyIds.includes(member.id)
  );
  const ready = members.filter((member) => readyIds.includes(member.id)).length;
  return {
    ready,
    total: members.length,
    complete: members.length === 0 || ready === members.length,
  };
}

function canStartRoomGame() {
  return !state.room.isPrivate || state.room.ownerId === playerId;
}

function roomReadyToStart(readiness) {
  return !state.room.isPrivate || readiness.complete;
}

function setView(nextView) {
  const activeGame = currentPlayer()?.currentGame;
  if (activeGame && nextView !== "lobby" && nextView !== activeGame) {
    showToast("Press Quit game before switching to another game.");
    return;
  }
  if (
    state?.room.isPrivate &&
    !state.room.selectedGame &&
    state.room.ownerId !== playerId &&
    nextView !== "lobby"
  ) {
    showToast("Waiting for the host to choose a game for this room.");
    return;
  }
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
  if (view !== "lobby") send({ type: "cursor-move", game: view, x: 0.5, y: 0.12 });
  else send({ type: "cursor-hide" });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  updateHeader();
  render();
}

function renderGamePresence() {
  if (!state || view === "lobby" || state.room.ended) return;
  const players = state.players.filter((player) => player.currentGame === view);
  if (!players.some((player) => player.id === playerId)) {
    const me = currentPlayer();
    if (me) players.unshift(me);
  }
  const strip = document.createElement("div");
  strip.className = "game-player-presence";
  strip.innerHTML = `<div class="presence-heading"><span class="presence-live-dot"></span><span>AT THIS TABLE</span><strong>${players.length}</strong></div><div class="presence-players">${players.map((player) => `<span class="presence-player" title="${escapeHtml(player.name)}">${characterMarkup(player.character || characterDefaults,"presence-character-art")}<span>${escapeHtml(player.name)}</span></span>`).join("")}</div>`;
  content.insertBefore(strip, content.firstChild);
  const layer = document.createElement("div");
  layer.className = "remote-cursor-layer";
  layer.setAttribute("aria-hidden", "true");
  content.append(layer);
  renderRemoteCursors();
}

function renderRemoteCursors() {
  const layer = content.querySelector(".remote-cursor-layer");
  if (!layer) return;
  const active = remoteCursors.filter((cursor) => cursor.id !== playerId && cursor.game === view && Date.now() - cursor.updatedAt < 4000);
  layer.innerHTML = active.map((cursor) => `<div class="remote-player-cursor" style="left:${Math.max(0,Math.min(1,cursor.x))*100}%;top:${Math.max(0,Math.min(1,cursor.y))*100}%">${characterMarkup(cursor.character || characterDefaults,"remote-cursor-character-art")}<span class="remote-cursor-name">${escapeHtml(cursor.name)}</span></div>`).join("");
}

function render() {
  preserveFocusedField(renderContent);
}

function renderContent() {
  if (!state) {
    content.innerHTML = `<div class="hero"><div class="hero-copy"><span class="eyebrow">WELCOME TO GOLDEN HOUR</span><h1>Opening the lounge...</h1><p class="hero-subtitle">Connecting you to the live tables.</p></div></div>`;
    return;
  }
  if (state.room.isPrivate && state.room.ended) {
    renderPrivateRoomEnded();
    return;
  }
  if (view === "games") renderGameSelection();
  else if (view === "roulette") renderRoulette();
  else if (view === "blackjack") renderBlackjack();
  else if (view === "slots") renderSlots();
  else if (view === "horses") renderHorseRace();
  else if (view === "poker") renderPoker();
  else if (view === "wheel") renderWheelFortune();
  else if (view === "plinko") renderPlinko();
  else renderLobby();
  if (view !== "lobby" && !state.room.ended) renderGamePresence();
  if (!["lobby", "games"].includes(view) && !state.room.ended) {
    const exitBar = document.createElement("div");
    exitBar.className = "game-exit-bar";
    exitBar.innerHTML = `<span>Finished playing this table?</span><button class="secondary-button" id="quit-current-game" type="button">Exit to game selection</button>`;
    content.insertBefore(exitBar, content.firstChild);
    exitBar.querySelector("#quit-current-game").addEventListener("click", () => {
      send({ type: "quit-game", game: view });
      view = "games";
      send({ type: "cursor-hide" });
      updateHeader();
      render();
    });
  }
}

function renderGameSelection() {
  const allGames = ["roulette", "blackjack", "slots", "horses", "poker", "wheel", "plinko"];
  const available = state.room.isPrivate
    ? (state.room.selectedGame ? [state.room.selectedGame] : state.room.ownerId === playerId ? allGames : [])
    : allGames;
  const labels = {
    roulette: ["Roulette", "Place bets on the shared wheel."],
    blackjack: ["Blackjack", "Take a seat and play for 21."],
    slots: ["Slots", "Spin the reels for a prize."],
    horses: ["Horse race", "Pick a horse and watch the race."],
    poker: ["Poker", "Join the table for a hand."],
    wheel: ["Wheel of fortune", "Spin for a lucky multiplier."],
    plinko: ["Plinko", "Drop a chip through the peg board."]
  };
  content.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">GOLDEN HOUR · TABLE SELECT</span>
        <h1>Choose your next game.</h1>
        <p class="hero-subtitle">${state.room.isPrivate ? "You're still in your private room. Rejoin its table whenever you're ready." : "You're out of the last game. Pick any table when you're ready to play again."}</p>
      </div>
    </section>
    <div class="section-heading"><h2>Game selection</h2><p>${state.room.isPrivate ? "This room's game is selected by its host." : "Choose a table to continue."}</p></div>
    <div class="games-grid">
      ${available.map((game) => `<article class="game-card game-selection-card">
        <div class="game-card-content">
          <div class="game-card-head"><h3>${labels[game][0]}</h3><span class="table-live"><span></span> AVAILABLE</span></div>
          <p>${labels[game][1]}</p>
          <div class="game-card-footer"><span class="players-label">${state.room.isPrivate ? "Private room" : "Live table"}</span><button class="primary-button" data-rejoin-game="${game}">Enter game&nbsp; ↗</button></div>
        </div>
      </article>`).join("")}
    </div>`;
  content.querySelectorAll("[data-rejoin-game]").forEach((button) => {
    button.addEventListener("click", () => {
      const game = button.dataset.rejoinGame;
      if (state.room.isPrivate) {
        send({ type: state.room.selectedGame ? "rejoin-game" : "select-game", game });
      }
      setView(game);
    });
  });
}

function renderPrivateRoomEnded() {
  const votes = state.room.replayVotes;
  const voted = votes.includes(playerId);
  content.innerHTML = `
    <section class="room-ended">
      <span class="eyebrow">PRIVATE ROOM COMPLETE</span>
      <h1>${state.room.rankings?.length ? "Private room finished." : "Everyone is out of chips."}</h1>
      <p class="hero-subtitle">${state.room.rankings?.length ? "Final standings are below. Everyone can vote to start another game with 1,000 chips each, or leave the room." : "This game is over. Everyone can vote to start another game with 1,000 chips each, or leave the room and return to the global game."}</p>
      <div class="room-ended-balances">${state.room.members.map((member) =>
        `<div class="activity-row"><span>${escapeHtml(member.name)}</span><strong>${member.chips.toLocaleString()} chips</strong></div>`
      ).join("")}</div>
      ${state.room.rankings?.length ? `<div class="room-ended-balances">${state.room.rankings.map((entry) => `<div class="activity-row"><span>${entry.place === 1 ? "🥇" : entry.place === 2 ? "🥈" : entry.place === 3 ? "🥉" : "#" + entry.place} · ${escapeHtml(entry.name)} · ${escapeHtml(entry.reason || "")}</span><strong>${entry.place === 1 ? "1st place" : entry.place === 2 ? "2nd place" : entry.place === 3 ? "3rd place" : entry.place + "th place"}</strong></div>`).join("")}</div>` : ""}
      <p class="bet-progress">${votes.length} of ${state.room.members.length} players chose to play again.</p>
      <div class="room-ended-actions">
        <button class="primary-button" id="replay-room" ${voted ? "disabled" : ""}>${voted ? "Play again chosen ✓" : "Play again · 1,000 chips each"}</button>
        <button class="secondary-button" id="leave-private-room">Leave room</button>
      </div>
    </section>`;
  content.querySelector("#replay-room").addEventListener("click", () => {
    send({ type: "replay-room" });
  });
  content.querySelector("#leave-private-room").addEventListener("click", () => {
    send({ type: "join-room", roomCode: "global" });
  });
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
    <div class="section-heading"><h2>${state.room.isPrivate && state.room.selectedGame ? "Room game" : "Choose your table"}</h2><p>${state.room.isPrivate ? state.room.selectedGame ? `This private room is locked to ${state.room.selectedGame}.` : state.room.ownerId === playerId ? "Choose one game for everyone in this private room." : "Waiting for the host to choose a game." : "Live with players around the world"}</p></div>
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
        <div class="game-art wheel-fortune-art"><div class="fortune-preview">✦ 0.5× · 1× · 5× ✦</div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Wheel of Fortune</h3><span class="table-live"><span></span> PLAY ANYTIME</span></div><p>Spin for a prize of up to 5× your wager.</p><div class="game-card-footer"><span class="players-label"><strong>${state.wheelFortune.history.length}</strong> recent spins</span><button class="primary-button" data-go="wheel">Spin the wheel&nbsp; ↗</button></div></div>
      </article>
      <article class="game-card">
        <div class="game-art plinko-art"><div class="plinko-preview">• · • · • · •</div></div>
        <div class="game-card-content"><div class="game-card-head"><h3>Plinko</h3><span class="table-live"><span></span> PLAY ANYTIME</span></div><p>Drop a ball through the pegs and land in a slot worth up to 3×.</p><div class="game-card-footer"><span class="players-label"><strong>${state.plinko.history.length}</strong> recent drops</span><button class="primary-button" data-go="plinko">Play Plinko&nbsp; ↗</button></div></div>
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
    const activeGame = currentPlayer()?.currentGame;
    const lockedGame = state.room.isPrivate && state.room.selectedGame;
    const waitingForHost = state.room.isPrivate && !lockedGame && state.room.ownerId !== playerId;
    button.disabled = Boolean(waitingForHost || (activeGame && button.dataset.go !== activeGame) || (lockedGame && button.dataset.go !== lockedGame));
    button.title = waitingForHost
      ? "Waiting for the host to choose a game."
      : activeGame && button.disabled ? "Press Quit game before switching games."
      : button.disabled ? `This room is locked to ${lockedGame}.` : "";
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

function detectRoulettePocket(stage, ball, pocket, caption) {
  let started = null;
  let detected = false;
  const frame = now => {
    if (detected || !stage.isConnected || !ball.isConnected || !pocket.isConnected) return;
    if (started === null) started = now;
    const elapsed = now - started;
    const ballRect = ball.getBoundingClientRect();
    const pocketRect = pocket.getBoundingClientRect();
    const ballX = ballRect.left + ballRect.width / 2;
    const ballY = ballRect.top + ballRect.height / 2;
    const pocketX = pocketRect.left + pocketRect.width / 2;
    const pocketY = pocketRect.top + pocketRect.height / 2;
    const contactDistance = Math.hypot(ballX - pocketX, ballY - pocketY);
    // Only accept contact during the final settling pass, not while the ball
    // is racing past the same pocket during its earlier revolutions.
    if (elapsed >= 3200 && contactDistance <= (ballRect.width + pocketRect.width) / 2 + 2) {
      detected = true;
      stage.classList.add("pocket-detected");
      pocket.classList.add("landed");
      if (caption) caption.textContent = `Ball detected in pocket ${pocket.textContent.trim()}.`;
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderRoulette() {
  const roulette = state.roulette;
  const readiness = roomReadiness(roulette.readyIds);
  const alreadyBet = roulette.readyIds.includes(playerId);
  const result = roulette.lastResult;
  const wheelOrder = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const numbers = Array.from({ length: 37 }, (_, number) => number);
  const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const targetNumber = roulette.spinningResult?.number ?? result?.number;
  const targetPocket = targetNumber == null ? 0 : wheelOrder.indexOf(targetNumber);
  const rouletteRotation = 1440 - targetPocket * (360 / 37);
  const roulettePockets = wheelOrder.map((number, index) => {
    const angle = index * (360 / 37);
    const color = number === 0 ? "green" : reds.has(number) ? "red" : "black";
    return `<span class="roulette-pocket ${color}" data-roulette-pocket="${number}" style="--pocket-angle:${angle}deg">${number}</span>`;
  }).join("");
  content.innerHTML = `
    <span class="eyebrow">THE WHEEL ROOM</span><h1>Roulette</h1>
    <p class="hero-subtitle">One table, one wheel, and every player at the edge of their seat.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>The shared wheel</h2><small>${state.room.isPrivate ? `${readiness.ready} / ${readiness.total} players ready` : `${roulette.bets.length} bets placed`}</small></div>
        <div class="roulette-table">
          <div class="roulette-wheel-stage ${roulette.spinning ? "spinning" : ""}" style="--roulette-rotation:${rouletteRotation}deg;--roulette-ball-rotation:-1800deg">
            <div class="roulette-wheel" style="transform:rotate(${rouletteRotation}deg)"><div class="roulette-pocket-ring">${roulettePockets}</div><div class="roulette-wheel-center">GH</div></div>
            <div class="roulette-ball-orbit"><span class="roulette-ball"></span></div>
            <div class="roulette-result ${result?.color ?? ""}">${roulette.spinning ? "✳" : result?.number ?? "—"}</div>
          </div>
          <div class="result-caption">${roulette.spinning ? "The ball is rolling around the wheel…" : result ? `Last result · ${result.color}` : "Place the first bet"}</div>
          <div class="table-bets">${roulette.bets.length ? roulette.bets.map((bet) => `<span class="bet-pill">${escapeHtml(bet.name)} · ${escapeHtml(bet.selection)} · ${bet.amount}</span>`).join("") : `<span class="bet-pill">The table is open</span>`}</div>
        </div>
        <div class="number-board">${numbers.map((number) => `<button class="number-cell ${number === 0 ? "green-cell" : reds.has(number) ? "red-cell" : ""} ${selectedBet === String(number) ? "selected" : ""}" data-selection="${number}">${number}</button>`).join("")}</div>
        <div class="table-history">${roulette.history.map((item) => `<span class="history-chip ${item.color}">${item.number}</span>`).join("") || `<span class="activity-empty">Recent results appear here.</span>`}</div>
      </section>
      <aside class="control-panel">
        <h3>Place your bet</h3><p class="control-copy">Choose red, black, odd, even, or a number on the wheel. Zero is neither odd nor even.</p>
        <div class="bet-type-row"><button class="bet-type ${selectedBet === "red" ? "selected" : ""}" data-selection="red">Red · 2×</button><button class="bet-type ${selectedBet === "black" ? "selected" : ""}" data-selection="black">Black · 2×</button></div><div class="bet-type-row"><button class="bet-type ${selectedBet === "odd" ? "selected" : ""}" data-selection="odd">Odd · 2×</button><button class="bet-type ${selectedBet === "even" ? "selected" : ""}" data-selection="even">Even · 2×</button></div>
        <label class="field-label" for="roulette-amount">Your wager</label>
        <div class="amount-row"><input class="chip-input" id="roulette-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
        <button class="primary-button full-button" id="place-bet" ${roulette.spinning || alreadyBet ? "disabled" : ""}>${alreadyBet ? "Bet placed ✓" : `Place bet · ${selectedBet}`}</button>
        <button class="secondary-button full-button" id="spin-wheel" ${roulette.spinning || roulette.bets.length === 0 || !roomReadyToStart(readiness) || !canStartRoomGame() ? "disabled" : ""}>${roulette.spinning ? "Wheel spinning…" : roulette.bets.length === 0 ? "Place a bet to spin" : state.room.isPrivate && !readiness.complete ? "Waiting for all room bets…" : !canStartRoomGame() ? "Room host starts the game" : "Spin the wheel ↗"}</button>
        ${state.room.isPrivate ? `<p class="bet-progress">${readiness.ready} of ${readiness.total} room players have placed a bet.</p>` : ""}
        <div class="recent-bets"><h4>On the table</h4>${betList()}</div>
      </aside>
    </div>`;
  if (roulette.spinning && roulette.spinningResult) {
    const stage = content.querySelector(".roulette-wheel-stage");
    const ball = content.querySelector(".roulette-ball");
    const pocket = content.querySelector(`[data-roulette-pocket="${roulette.spinningResult.number}"]`);
    const caption = content.querySelector(".result-caption");
    if (stage && ball && pocket) detectRoulettePocket(stage, ball, pocket, caption);
  }
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
  let handTotal = seat.hand.reduce((sum, card) => sum + card.value, 0);
  let aces = seat.hand.filter((card) => card.rank === "A").length;
  while (handTotal > 21 && aces > 0) { handTotal -= 10; aces -= 1; }
  const totalReadout = seat.id === playerId ? `<div class="blackjack-hand-total">YOUR TOTAL <strong>${handTotal}</strong></div>` : "";
  return `<div class="seat-card ${seat.id === turnId ? "current-turn" : ""}"><div class="seat-name">${playerLabel(seat.id, seat.name)} · ${seat.bet} chips</div><div class="seat-cards">${seat.hand.map(cardMarkup).join("")}</div>${totalReadout}<div class="seat-status">${escapeHtml(status || "Waiting")}</div></div>`;
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
          <div class="amount-row"><input class="chip-input" id="blackjack-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="join-blackjack">Take a seat&nbsp; +</button>`}
          ${mySeat ? `<label class="field-label" for="blackjack-amount">Edit your wager</label><div class="amount-row"><input class="chip-input" id="blackjack-amount" type="number" min="1" max="${(currentPlayer()?.chips ?? 0) + mySeat.bet}" step="1" value="${selectedAmount}"></div><button class="secondary-button full-button" id="update-blackjack-bet">Update wager</button>` : ""}
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
  content.querySelector("#update-blackjack-bet")?.addEventListener("click", () => {
    send({ type: "update-blackjack-bet", amount: Number(content.querySelector("#blackjack-amount").value) });
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
  const animateSpin = shouldAnimateResult("slots", latest?.timestamp);
  const cooldown = gameCooldownActive("slots");
  content.innerHTML = `
    <span class="eyebrow">THE REEL ROOM</span><h1>Slots</h1>
    <p class="hero-subtitle">Spin three reels for a lucky match. Pair any symbols for 2×, three of a kind for 8×, or three sevens for 20×.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>Golden reels</h2><small>Single-player spins · shared results</small></div>
        <div class="slot-machine ${animateSpin ? "spinning" : ""}">
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
        <div class="amount-row"><input class="chip-input" id="slots-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
        <button class="primary-button full-button" id="spin-slots" ${cooldown ? "disabled" : ""}>${cooldown ? "Reels spinning…" : "Spin the reels&nbsp; ↗"}</button>
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
    triggerTimedGameAction("slots", { type: "slots-spin", amount: selectedAmount });
  });
}

function renderHorseRace() {
  const race = state.horseRace;
  const readiness = roomReadiness(race.readyIds);
  const horses = ["Comet", "Clover", "Sundown", "Goldrush"];
  const racing = race.phase === "racing";
  const raceTimes = race.raceTimes || {};
  const elapsed = racing && race.raceStartedAt ? Math.max(0, Date.now() - race.raceStartedAt) : 0;
  const myBet = race.bets.find((bet) => bet.playerId === playerId);
  content.innerHTML = `
    <span class="eyebrow">THE GRANDSTAND</span><h1>Horse race</h1>
    <p class="hero-subtitle">Pick a horse and watch one full lap around the circular track. The winner is revealed only at the finish. A winning bet pays 3×.</p>
    <div class="game-layout">
      <section class="table-panel">
        <div class="table-panel-top"><h2>Golden Hour Stakes</h2><small>${racing ? "One lap in progress" : "Open for bets"}</small></div>
        <div class="circular-race-track ${racing ? "racing" : ""}" aria-label="One lap circular horse race">
          <div class="race-finish-arch"><span>FINISH</span></div>
          <div class="race-inner"><span>GOLDEN HOUR</span><small>ONE LAP</small></div>
          ${horses.map((horse, index) => {
            const duration = Number(raceTimes[horse]) || 10000;
            const delay = racing ? -Math.min(elapsed, duration) : 0;
            const colors = ["#e5bd67", "#c6d6c3", "#e3a19b", "#c8b7e0"];
            return `<div class="circular-horse horse-lane-${index}" style="--race-duration:${duration}ms;--race-delay:${delay}ms;--horse-color:${colors[index]}"><span class="horse-runner">♞</span><small>${horse}</small></div>`;
          }).join("")}
        </div>
        <div class="race-message">${racing ? "And they’re off! One lap to the finish…" : race.winner ? `${escapeHtml(race.winner)} crossed the finish line first!` : "Choose your horse before the starting bell."}</div>
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
          <div class="amount-row"><input class="chip-input" id="horse-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="bet-horse" ${race.phase === "racing" ? "disabled" : ""}>Place bet on ${selectedHorse}&nbsp; · &nbsp;3×</button>` : ""}
        <button class="primary-button full-button" id="start-race" ${race.phase === "racing" || race.bets.length === 0 || !roomReadyToStart(readiness) || !canStartRoomGame() ? "disabled" : ""}>${race.phase === "racing" ? "Race in progress…" : race.bets.length === 0 ? "Place a bet to start" : state.room.isPrivate && !readiness.complete ? "Waiting for all room bets…" : !canStartRoomGame() ? "Room host starts the game" : "Start the race ↗"}</button>
        <div class="table-rules"><div class="rule-row"><span>Winning payout</span><strong>3×</strong></div><div class="rule-row"><span>Race distance</span><strong>1 lap</strong></div><div class="rule-row"><span>Horses</span><strong>4</strong></div></div>
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

let wheelRevealTimer = null;
let wheelPendingTimestamp = null;

function renderWheelFortune() {
  const history = state.wheelFortune.history || [];
  const latest = history[0];
  const newlyReceived = shouldAnimateResult("wheel", latest?.timestamp);
  if (newlyReceived && latest) {
    wheelPendingTimestamp = latest.timestamp;
    clearTimeout(wheelRevealTimer);
    const elapsed = Math.max(0, Date.now() - latest.timestamp);
    wheelRevealTimer = window.setTimeout(() => {
      if (wheelPendingTimestamp !== latest.timestamp) return;
      wheelPendingTimestamp = null;
      if (view === "wheel") renderWheelFortune();
    }, Math.max(0, 4200 - elapsed));
  }
  const elapsed = latest ? Math.max(0, Date.now() - latest.timestamp) : 0;
  const animateSpin = Boolean(latest && wheelPendingTimestamp === latest.timestamp && elapsed < 4200);
  const cooldown = gameCooldownActive("wheel");
  const wheelRotation = latest ? 1800 + (360 - (latest.segment * 36 + 18)) : 0;
  const segments = [0, 0.5, 1, 0, 0.75, 2, 1, 0, 1.5, 5];
  const visibleHistory = animateSpin ? history.slice(1, 10) : history.slice(0, 10);
  content.innerHTML = `<span class="eyebrow">THE PRIZE HALL</span><h1>Wheel of Fortune</h1><p class="hero-subtitle">One spin can turn your wager into up to 5 times the chips.</p><div class="game-layout"><section class="table-panel"><div class="table-panel-top"><h2>The golden prize wheel</h2><small>Server-drawn result · shared history</small></div><div class="fortune-stage"><div class="fortune-wheel ${animateSpin ? "spinning" : ""}" style="--wheel-rotation:${wheelRotation}deg;animation-delay:-${elapsed}ms;transform:rotate(${wheelRotation}deg)">${segments.map((m,i)=>{const angle=i*36+18;return `<span class="fortune-segment" style="left:50%;top:50%;transform:translate(-50%,-50%) rotate(${angle}deg) translateY(-80px) rotate(-${angle}deg)">${m}×</span>`;}).join("")}</div><div class="fortune-pointer">▼</div></div><div class="fortune-result">${animateSpin ? "The wheel is spinning…" : latest ? `${escapeHtml(latest.name)} · ${latest.multiplier}× · ${latest.payout.toLocaleString()} chips paid` : "The wheel is ready for its first spin."}</div><div class="recent-bets"><h4>Recent spins</h4>${visibleHistory.length ? `<div class="activity-list">${visibleHistory.map(item=>`<div class="activity-row"><span>${escapeHtml(item.name)} · ${item.multiplier}×</span><small>${item.payout ? `+${item.payout}` : `−${item.amount}`} chips</small></div>`).join("")}</div>` : animateSpin ? `<div class="activity-empty">Waiting for the result…</div>` : `<div class="activity-empty">No spins yet.</div>`}</div></section><aside class="control-panel"><h3>Spin for a prize</h3><p class="control-copy">The wager is deducted before each spin. All prizes are complimentary chips.</p><label class="field-label" for="wheel-amount">Your wager</label><div class="amount-row"><input class="chip-input" id="wheel-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10,25,50].map(a=>`<button class="preset ${selectedAmount===a?"selected":""}" data-amount="${a}">${a}</button>`).join("")}</div></div><button class="primary-button full-button" id="spin-fortune" ${cooldown ? "disabled" : ""}>${cooldown ? "Wheel spinning…" : "Spin the wheel ↗"}</button><div class="table-rules">${[0,0.5,0.75,1,1.5,2,5].map(m=>`<div class="rule-row"><span>${m}× prize</span><strong>${m===0?"No payout":`${m}× wager`}</strong></div>`).join("")}</div></aside></div>`;
  content.querySelectorAll("[data-amount]").forEach(button=>button.addEventListener("click",()=>{selectedAmount=Number(button.dataset.amount);renderWheelFortune();}));
  content.querySelector("#wheel-amount").addEventListener("input",event=>selectedAmount=Number(event.target.value));
  content.querySelector("#spin-fortune").addEventListener("click",()=>triggerTimedGameAction("wheel",{type:"wheel-fortune-spin",amount:selectedAmount}));
}

function plinkoDetectorRecognizesBall(detectors, detectableObject) {
  if (!detectableObject?.matches("[data-plinko-detectable]")) return null;
  const objectRect = detectableObject.getBoundingClientRect();
  const centerX = objectRect.left + objectRect.width / 2;
  const centerY = objectRect.top + objectRect.height / 2;
  const radius = Math.min(objectRect.width, objectRect.height) / 2;
  // Detect physical contact with a pocket, including contact across the
  // narrow visual gaps between adjacent pocket boxes.
  let contacted = null;
  let nearestDistance = Infinity;
  for (const detector of detectors) {
    if (!detector.matches("[data-plinko-detector]")) continue;
    const rect = detector.getBoundingClientRect();
    const closestX = Math.max(rect.left, Math.min(centerX, rect.right));
    const closestY = Math.max(rect.top, Math.min(centerY, rect.bottom));
    const distance = Math.hypot(centerX - closestX, centerY - closestY);
    if (distance <= radius && distance < nearestDistance) {
      contacted = detector;
      nearestDistance = distance;
    }
  }
  return contacted;
}

function animatePlinkoPhysics(board, ball, onComplete, path) {
  const boardRect = board.getBoundingClientRect();
  const startCenterY = boardRect.top + board.clientTop + 19;
  const slots = [...board.querySelectorAll(".plinko-slots [data-plinko-detector]")];
  const slotsRect = board.querySelector(".plinko-slots")?.getBoundingClientRect();
  const scaleX = (board.clientWidth - 24) / 0.96;
  const scaleY = slotsRect ? slotsRect.top + slotsRect.height / 2 - startCenterY : board.clientHeight - 30;
  const points = Array.isArray(path) && path.length > 1 ? path : [[0,0],[0,1]];
  const duration = (points.length - 1) * (1000 / 120);
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  let tailX = last[0], tailY = last[1];
  let tailVx = (last[0] - previous[0]) * 0.85;
  let tailVy = Math.max(0.0015, last[1] - previous[1]);
  let started = null;
  let previousFrame = null;
  let detected = false;
  ball.style.opacity = "1";
  ball.style.transform = "translate3d(0,0,0)";
  const frame = now => {
    if (detected) return;
    if (started === null) started = now;
    const elapsed = now - started;
    let nx, ny;
    if (elapsed <= duration) {
      const position = Math.min(points.length - 1, elapsed / (1000 / 120));
      const index = Math.min(points.length - 2, Math.floor(position));
      const mix = position - index;
      const a = points[index], b = points[index + 1];
      nx = a[0] + (b[0] - a[0]) * mix;
      ny = a[1] + (b[1] - a[1]) * mix;
    } else {
      // Continue the same momentum and gravity after the recorded samples;
      // the animation has no timer-based or path-end completion condition.
      const frameScale = previousFrame === null ? 1 : Math.min(2, (now - previousFrame) / (1000 / 60));
      tailVy += 0.00022 * frameScale;
      tailX += tailVx * frameScale;
      tailY += tailVy * frameScale;
      if (tailX < -0.48 || tailX > 0.48) {
        tailX = Math.max(-0.48, Math.min(0.48, tailX));
        tailVx *= -0.45;
      }
      tailVx *= Math.pow(0.985, frameScale);
      nx = tailX;
      ny = tailY;
    }
    previousFrame = now;
    ball.style.transform = `translate3d(${nx * scaleX}px,${Math.max(0, ny * scaleY)}px,0)`;
    const detectedBox = plinkoDetectorRecognizesBall(slots, ball);
    if (detectedBox) {
      detected = true;
      detectedBox.classList.add("landed");
      if (typeof onComplete === "function") onComplete(detectedBox);
      return;
    }
    if (elapsed >= 15000) {
      detected = true;
      if (typeof onComplete === "function") onComplete(null);
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function renderPlinko() {
  const history = state.plinko.history || [];
  const latest = history[0];
  const latestBatch = latest ? history.filter(item => item.timestamp === latest.timestamp).slice(0, 5) : [];
  const animateDrop = shouldAnimateResult("plinko", latest?.timestamp);
  const cooldown = gameCooldownActive("plinko");
  const multipliers = [3,1,0.75,0.5,0,0.5,0.75,1,3];
  content.innerHTML = `<span class="eyebrow">THE DROP ZONE</span><h1>Plinko</h1><p class="hero-subtitle">Drop a ball through the pegs for a prize of up to 3× your wager.</p><div class="game-layout"><section class="table-panel"><div class="table-panel-top"><h2>The Plinko board</h2><small>Randomized landing slot · shared history</small></div><div class="plinko-board ${animateDrop ? "dropping" : ""}" style="--plinko-shift:${latest ? (latest.slot - 4) * 22 : 0}px"><div class="plinko-peg-field">${Array.from({length:10},(_,row)=>{const count=row%2===0?10:9;return `<div class="plinko-peg-row">${Array.from({length:count},(_,col)=>`<i style="grid-column:${row%2===0?col*2+1:col*2+2}"></i>`).join("")}</div>`;}).join("")}</div>${latestBatch.map((item,index)=>`<div class="plinko-ball" data-plinko-ball="${index}" data-plinko-detectable="true" aria-hidden="true" style="left:calc(50% + ${(index-(latestBatch.length-1)/2)*9}px)"></div>`).join("")}<div class="plinko-slots">${multipliers.map((m,i)=>`<span data-plinko-detector="${i}" class="${latest?.slot===i?"landed":""}">${m}×</span>`).join("")}</div></div><div class="fortune-result">${latest ? `${escapeHtml(latest.name)} landed on ${latest.multiplier}× · ${latest.payout.toLocaleString()} chips paid` : "Drop the first ball to get started."}</div><div class="recent-bets"><h4>Recent drops</h4>${history.length ? `<div class="activity-list">${history.slice(0,10).map(item=>`<div class="activity-row"><span>${escapeHtml(item.name)} · ${item.multiplier}×</span><small>${item.payout ? `+${item.payout}` : `−${item.amount}`} chips</small></div>`).join("")}</div>` : `<div class="activity-empty">No balls dropped yet.</div>`}</div></section><aside class="control-panel"><h3>Drop your ball</h3><p class="control-copy">The landing slot is selected securely by the server. Multipliers are shown along the bottom.</p><label class="field-label" for="plinko-amount">Wager per ball</label><div class="amount-row"><input class="chip-input" id="plinko-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10,25,50].map(a=>`<button class="preset ${selectedAmount===a?"selected":""}" data-amount="${a}">${a}</button>`).join("")}</div></div><label class="field-label" for="plinko-count">Number of balls (1–5)</label><select class="chip-input" id="plinko-count">${[1,2,3,4,5].map(n=>`<option value="${n}">${n} ${n===1?"ball":"balls"}</option>`).join("")}</select><p class="control-copy">Total wager: <strong id="plinko-total">${selectedAmount.toLocaleString()} chips</strong></p><button class="primary-button full-button" id="drop-plinko" ${cooldown ? "disabled" : ""}>${cooldown ? "Balls dropping…" : "Drop balls ↘"}</button><div class="table-rules">${[0,0.5,0.75,1,3].map(m=>`<div class="rule-row"><span>${m}× slot</span><strong>${m===0?"No payout":`${m}× wager`}</strong></div>`).join("")}</div></aside></div>`;
  if (animateDrop && latest && latestBatch.length) {
    const board = content.querySelector(".plinko-board");
    const balls = [...content.querySelectorAll(".plinko-ball[data-plinko-ball]")];
    const result = content.querySelector(".fortune-result");
    if (board && balls.length) {
      const detectors = board.querySelectorAll(".plinko-slots [data-plinko-detector]");
      detectors.forEach(detector => detector.classList.remove("landed"));
      if (result) result.textContent = `${balls.length} ${balls.length===1?"ball":"balls"} dropping…`;
      let completed = 0, paid = 0, landed = 0;
      balls.forEach((ball,index)=>animatePlinkoPhysics(board,ball,detectedBox=>{
        completed++;
        if (detectedBox) { landed++; paid += latestBatch[index].payout; }
        if (completed === balls.length && result) result.textContent = `${escapeHtml(latest.name)} dropped ${balls.length} ${balls.length===1?"ball":"balls"} · ${landed} landed · ${paid.toLocaleString()} chips paid in total`;
      },latestBatch[index].path));
    }
  }
  content.querySelectorAll("[data-amount]").forEach(button=>button.addEventListener("click",()=>{selectedAmount=Number(button.dataset.amount);renderPlinko();}));
  content.querySelector("#plinko-amount").addEventListener("input",event=>{selectedAmount=Number(event.target.value);const count=Number(content.querySelector("#plinko-count").value);const total=content.querySelector("#plinko-total");if(total)total.textContent=`${(selectedAmount*count).toLocaleString()} chips`;});
  content.querySelector("#plinko-count").addEventListener("change",event=>{const total=content.querySelector("#plinko-total");if(total)total.textContent=`${(selectedAmount*Number(event.target.value)).toLocaleString()} chips`;});
  content.querySelector("#drop-plinko").addEventListener("click",()=>triggerTimedGameAction("plinko",{type:"plinko-drop",amount:selectedAmount,count:Number(content.querySelector("#plinko-count").value)}));
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
            <div class="cards-row poker-seats">${game.players.map((seat) => `<div class="seat-card"><div class="seat-name">${playerLabel(seat.id, seat.name)} · ${seat.bet} chips</div><div class="seat-cards">${seat.hand.map(cardMarkup).join("")}</div><div class="seat-status">${escapeHtml(seat.result || (game.phase === "playing" ? "Showdown…" : "Waiting"))}</div></div>`).join("")}</div></div>`
            : `<div class="waiting-message">Take a seat to join the next showdown.</div>`}
          ${game.lastResult ? `<div class="poker-result">${game.lastResult.winners.map(escapeHtml).join(", ")} won with ${escapeHtml(game.lastResult.hand)} · ${game.lastResult.pot.toLocaleString()} chips</div>` : ""}
        </div>
      </section>
      <aside class="control-panel">
        <h3>${game.phase === "playing" ? "Cards are dealt" : game.phase === "done" ? "Next showdown" : "Join the table"}</h3>
        <p class="control-copy">${game.phase === "playing" ? "The cards are being revealed. Your best five-card poker hand is ranked by the table." : "This friendly five-card showdown uses play chips only. The best hand takes the pot; ties split it."}</p>
        ${game.phase === "done" ? `
          <label class="field-label" for="poker-amount">Next round buy-in</label>
          <div class="amount-row"><input class="chip-input" id="poker-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="join-poker">Join the next round&nbsp; +</button>
        ` : game.phase === "waiting" ? `
          ${mySeat ? `<div class="seat-row"><span>You are in</span><small>${mySeat.bet} chips</small></div>` : `
          <label class="field-label" for="poker-amount">Buy-in</label>
          <div class="amount-row"><input class="chip-input" id="poker-amount" type="number" min="1" max="${currentPlayer()?.chips ?? 0}" step="1" value="${selectedAmount}"><div class="amount-presets">${[10, 25, 50].map((amount) => `<button class="preset ${selectedAmount === amount ? "selected" : ""}" data-amount="${amount}">${amount}</button>`).join("")}</div></div>
          <button class="secondary-button full-button" id="join-poker">Take a seat&nbsp; +</button>`}
          ${mySeat ? `<label class="field-label" for="poker-amount">Edit your buy-in</label><div class="amount-row"><input class="chip-input" id="poker-amount" type="number" min="1" max="${(currentPlayer()?.chips ?? 0) + mySeat.bet}" step="1" value="${selectedAmount}"></div><button class="secondary-button full-button" id="update-poker-bet">Update buy-in</button>` : ""}
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
  content.querySelector("#update-poker-bet")?.addEventListener("click", () => {
    send({ type: "update-poker-bet", amount: Number(content.querySelector("#poker-amount").value) });
  });
  content.querySelector("#start-poker")?.addEventListener("click", () => {
    send({ type: "start-poker" });
  });
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelector("#admin-toggle").addEventListener("click", () => {
  if (!isAdminDisplayName()) return;
  location.href = "/admin";
});
document.querySelector("#admin-close").addEventListener("click", () => {
  adminPanelOpen = false;
  send({ type: "admin-logout" });
  renderAdminPanel();
});
document.querySelector("#admin-login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isAdminDisplayName()) return;
  const usernameInput = document.querySelector("#admin-username");
  const passwordInput = document.querySelector("#admin-password");
  document.querySelector("#admin-login-error").textContent = "";
  send({ type: "admin-login", username: usernameInput.value.trim(), password: passwordInput.value });
  passwordInput.value = "";
});
document.querySelector("#admin-announcement-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isAdminDisplayName() || !adminAuthenticated) return;
  const input = document.querySelector("#admin-announcement");
  const text = input.value.trim();
  if (!text) return;
  send({ type: "admin-announcement", text });
  input.value = "";
});
document.querySelector("#admin-clear-chat").addEventListener("click", () => {
  if (!isAdminDisplayName() || !adminAuthenticated) return;
  if (window.confirm("Clear chat history in every room? This cannot be undone.")) {
    send({ type: "admin-clear-chat" });
  }
});
document.querySelector("#admin-player-list").addEventListener("click", (event) => {
  if (!isAdminDisplayName() || !adminAuthenticated) return;
  const button = event.target.closest("[data-admin-action]");
  if (!button) return;
  if (button.dataset.adminAction === "mute") {
    const target = adminPlayers.find((item) => item.id === button.dataset.playerId);
    if (!target) return;
    send({ type: "admin-set-mute", targetId: target.id, muted: !target.muted });
    return;
  }
  const amount = Number(button.closest(".admin-adjust").querySelector("input").value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
    showToast("Choose a chip amount from 1 to 1,000,000.");
    return;
  }
  if (button.dataset.adminAction === "kick") {
    if (window.confirm("Move this player to the global room?")) send({ type: "admin-kick-player", targetId: button.dataset.playerId });
    return;
  }
  send({ type: "admin-adjust-chips", action: button.dataset.adminAction, targetId: button.dataset.playerId, amount });
});

function renderRoomChat() {
  const panel = document.querySelector("#room-chat");
  if (!panel || !state?.room) return;
  panel.hidden = false;
  document.querySelector("#chat-title").textContent =
    state.room.isPrivate ? `Private room chat · ${state.room.code}` : "Global game chat";
  const list = document.querySelector("#chat-messages");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  const messages = state.room.chat || [];
  list.innerHTML = messages.length
    ? messages.map((item) => {
        const time = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `<article class="chat-message ${item.playerId === playerId ? "mine" : ""}">
          <div class="chat-message-meta"><strong>${playerLabel(item.playerId, item.name)}</strong><time>${time}</time></div>
          <p>${escapeHtml(item.text)}</p>
        </article>`;
      }).join("")
    : `<p class="chat-empty">No messages yet. Start the conversation.</p>`;
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

document.querySelector("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  send({ type: "chat-message", text });
  input.value = "";
  input.focus();
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
  if (window.confirm("Quit this private room and return to the global game?")) send({ type: "leave-room" });
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
document.querySelector("#log-off").addEventListener("click", () => {
  if (!window.confirm("Log off from Golden Hour? Your chips and character will be saved on this device.")) return;
  loggedOut = true;
  localStorage.setItem(loggedOutKey, "true");
  joined = false;
  state = null;
  adminAuthenticated = false;
  adminPlayers = [];
  adminPanelOpen = false;
  requestedRoomCode = "";
  localStorage.removeItem(roomKey);
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("room");
  history.replaceState(null, "", cleanUrl);
  document.body.classList.remove("joined");
  clearTimeout(reconnectTimer);
  if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  renderUsernamePicker();
});
document.querySelector("#edit-name").addEventListener("click", () => {
  const nextName = window.prompt("Choose a username:", playerName);
  if (nextName === null) return;
  playerName = nextName.trim().slice(0, 18);
  localStorage.setItem(nameKey, playerName);
  send({ type: "set-name", name: playerName });
});

content.addEventListener("pointermove", (event) => {
  if (!state || view === "lobby" || !socket || socket.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - lastCursorSentAt < 85) return;
  lastCursorSentAt = now;
  const rect = content.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  send({ type: "cursor-move", game: view, x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
});
content.addEventListener("pointerleave", () => {
  if (view !== "lobby") send({ type: "cursor-hide" });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && view !== "lobby") send({ type: "cursor-hide" });
});
window.setInterval(renderRemoteCursors, 1000);
document.querySelector("#customize-character").addEventListener("click", () => {
  document.body.classList.remove("joined");
  renderCharacterCreator("", false);
});

if (playerName && playerName.toLowerCase() !== "guest" && !loggedOut) connect();
else renderUsernamePicker();
