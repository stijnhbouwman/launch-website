const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".nav-links");
menuButton?.addEventListener("click", () => {
  const open = navigation.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Navigatie sluiten" : "Navigatie openen");
});
navigation?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  navigation.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton?.setAttribute("aria-label", "Navigatie openen");
}));
document.querySelector("#year").textContent = new Date().getFullYear();

const guides = [
 {id:"mobility",title:"Veilig bewegen",tag:"Bewegen en valpreventie",keys:["val","vallen","gevallen","evenwicht","balans","wankel","lopen","wandelen","trap","struikelen","mobiliteit","rolstoel","rollator","stok","valangst"],intro:"Met een veiligere woning en passende ondersteuning wordt bewegen vaak makkelijker.",steps:["Vertel uw huisarts of zorgverlener over valpartijen, duizeligheid of veranderingen in uw evenwicht.","Vraag of een controle van uw medicijnen of een valrisico-onderzoek zinvol is.","Houd looppaden vrij, zorg voor goede verlichting en overweeg steunbeugels of andere woningaanpassingen.","Vraag iemand die u vertrouwt of een lokale ouderenorganisatie om hulp bij boodschappen of vervoer."],note:"Na een val met hoofdletsel, hevige pijn, niet kunnen opstaan of plotselinge zwakte is dringend medische hulp nodig."},
 {id:"health",title:"Gezondheid en medicijnen",tag:"Gezondheid",keys:["medicijn","medicijnen","medicatie","pillen","recept","huisarts","dokter","afspraak","gezondheid","pijn","symptoom","ziekenhuis","behandeling","dosering","bijwerking","apotheek"],intro:"Een zorgverlener of apotheker kan uitleg geven over behandelingen, medicijnen en vervolgstappen.",steps:["Schrijf op wat er is veranderd, wanneer het begon en welke vragen u wilt stellen.","Houd een actuele lijst van uw medicijnen bij en neem die mee naar afspraken.","Overleg met uw apotheker of voorschrijver voordat u een medicijn verandert of ermee stopt.","Vraag eventueel iemand die u vertrouwt om mee te gaan of een afspraak te regelen."],note:"Deze gids kan geen diagnose stellen of adviseren welk medicijn of welke dosis u moet nemen. Zoek dringend medische hulp bij plotselinge of ernstige klachten."},
 {id:"connection",title:"Contact met anderen",tag:"Sociaal contact",keys:["eenzaam","eenzaamheid","alleen","geïsoleerd","vrienden","vriend","mensen ontmoeten","gezelschap","rouw","verdriet","somber","buurt","sociaal","contact"],intro:"Eenzaamheid komt vaak voor. Het is goed om gezelschap of steun te vragen. Regelmatig contact, hoe klein ook, kan helpen.",steps:["Denk aan iemand met wie u graag praat en stuur een bericht of bel even.","Informeer bij bibliotheken, buurthuizen, verenigingen, geloofsgemeenschappen of activiteiten voor ouderen in uw buurt.","Vraag bij uw gemeente of een lokale organisatie naar bezoekmaatjes of telefonische contactmomenten.","Praat met een zorgverlener als somberheid of verdriet lang aanhoudt of uw dagelijks leven beïnvloedt."],note:"Als u bang bent uzelf iets aan te doen of niet veilig bent, neem dan direct contact op met de hulpdiensten of crisishulp in uw omgeving."},
 {id:"home",title:"Extra hulp in huis",tag:"Dagelijks leven",keys:["thuis","schoonmaken","koken","boodschappen","douchen","bad","aankleden","zorg","mantelzorger","huishouden","dagelijkse taken","hulp in huis"],intro:"Misschien kunt u praktische hulp krijgen bij dagelijkse taken, persoonlijke verzorging, maaltijden of aanpassingen in huis.",steps:["Schrijf op welke taken moeilijker zijn geworden en welke hulp verschil zou maken.","Vraag uw gemeente of de sociale dienst naar een zorgbeoordeling en ondersteuning thuis.","Vraag een zorgverlener naar ergotherapie of hulpmiddelen die dagelijkse taken veiliger kunnen maken.","Bespreek met familie of vrienden die u helpen een routine die voor iedereen haalbaar is."],note:"De namen van diensten en voorwaarden verschillen per regio. Uw gemeente of sociale dienst is een goed startpunt."},
 {id:"money",title:"Geldzaken, rekeningen en oplichting",tag:"Geld en veiligheid",keys:["geld","rekening","rekeningen","huur","schuld","pensioen","uitkering","toeslag","kosten","budget","bank","oplichting","fraude","gestolen","betaling","financiën"],intro:"Onafhankelijk advies kan helpen rekeningen te begrijpen, beschikbare steun te vinden en fraude te voorkomen.",steps:["Verzamel brieven of rekeningen waarover u vragen hebt, maar houd rekeningnummers en wachtwoorden privé.","Neem contact op via het telefoonnummer op een officiële brief of de geverifieerde website.","Vraag een lokale adviesorganisatie of maatschappelijk werker naar toeslagen, uitkeringen en hulp bij budgetteren.","Deel nooit een eenmalige code, pincode of wachtwoord met iemand die onverwacht contact met u opneemt."],note:"Denkt u dat er geld is gestolen? Bel direct uw bank via het officiële nummer. Meld vermoedelijke fraude bij de bevoegde instantie in uw land."},
 {id:"digital",title:"Technologie en vervoer",tag:"Zelfstandig blijven",keys:["telefoon","computer","internet","online","e-mail","videobellen","technologie","tablet","wachtwoord","bus","trein","vervoer","rijden","reizen","reis"],intro:"Met rustige, praktische hulp worden technologie en vervoer vaak minder ingewikkeld.",steps:["Vraag bij een bibliotheek, buurthuis of ouderenorganisatie naar digitale cursussen voor beginners.","Vraag iemand die u vertrouwt om één handeling tegelijk uit te leggen en de stappen groot op te schrijven.","Kijk of uw vervoersbedrijf informatie biedt over toegankelijk reizen of reisbegeleiding.","Wees voorzichtig met onverwachte berichten waarin u op een link moet klikken, geld moet betalen of een wachtwoord moet delen."],note:"Geef een onverwachte beller nooit toegang op afstand tot uw apparaat of uw bankgegevens."}
];

const resourcesByTopic = {
 mobility:[
 {name:"VeiligheidNL – valpreventie",kind:"Informatie en oefeningen",description:"Praktische uitleg over vallen voorkomen en veilig bewegen.",url:"https://www.veiligheid.nl/themas/valpreventie"},
 {name:"Rijksoverheid – gezond en sterk ouder worden",kind:"Officiële informatie",description:"Lees over valrisico, trainingen en mogelijke vergoedingen.",url:"https://www.rijksoverheid.nl/themas/familie-zorg-en-gezondheid/gezondheid-en-preventie/gezond-en-sterk-ouder-worden"},
 {name:"Regelhulp – hulp voor ouderen",kind:"Hulp en voorzieningen",description:"Bekijk welke ondersteuning en hulpmiddelen mogelijk zijn.",url:"https://www.regelhulp.nl/onderwerpen/mijn-situatie/ouderen"}],
 health:[
 {name:"Apotheek.nl – ouderen en medicijngebruik",kind:"Medicijninformatie",description:"Uitleg over medicatie, bijwerkingen en hulp van de apotheker.",url:"https://www.apotheek.nl/zorg-van-de-apotheker/medicijngebruik-in-het-dagelijks-leven/ouderen-en-medicijngebruik"},
 {name:"Regelhulp – hulp bij medicijngebruik",kind:"Praktische zorg",description:"Bekijk welke hulp thuis mogelijk is bij het beheren en innemen van medicijnen.",url:"https://www.regelhulp.nl/onderwerpen/welke-soort/verzorging-verpleging-behandeling/medicijngebruik"},
 {name:"Thuisarts",kind:"Medische informatie",description:"Begrijpelijke informatie over klachten en wanneer u de huisarts belt.",url:"https://www.thuisarts.nl/"}],
 connection:[
 {name:"Thuisarts – eenzaamheid bij ouderen",kind:"Advies en hulp",description:"Mogelijkheden voor contact, activiteiten, een maatje en professionele steun.",url:"https://www.thuisarts.nl/eenzaamheid/ik-voel-me-eenzaam-informatie-voor-ouderen"},
 {name:"Eén tegen eenzaamheid – hulporganisaties",kind:"Activiteiten en organisaties",description:"Vind organisaties voor bezoek, activiteiten en sociaal contact.",url:"https://www.eentegeneenzaamheid.nl/wat-is-eenzaamheid/eenzaamheid-doorbreken/aanbod-hulporganisaties"},
 {name:"Ouderenfonds – Welkom Online",kind:"Gratis digitale cursus",description:"Leer onder meer internet gebruiken, beeldbellen en sociale media.",url:"https://www.ouderenfonds.nl/activiteiten/welkom-online/"}],
 home:[
 {name:"Regelhulp – hulp voor ouderen",kind:"Wegwijzer naar ondersteuning",description:"Overzicht van hulp in huis, thuiszorg, begeleiding en hulpmiddelen.",url:"https://www.regelhulp.nl/onderwerpen/mijn-situatie/ouderen"},
 {name:"Rijksoverheid – zorg en ondersteuning thuis",kind:"Officiële informatie",description:"Lees hoe u huishoudelijke hulp, thuiszorg en cliëntondersteuning regelt.",url:"https://www.rijksoverheid.nl/themas/familie-zorg-en-gezondheid/ouderezorg"},
 {name:"Ouderenadviseur",kind:"Persoonlijk advies",description:"Ontdek hoe u via uw gemeente advies krijgt over zelfstandig wonen.",url:"https://www.regelhulp.nl/onderwerpen/mijn-situatie/ouderen/ouderenadviseur"}],
 money:[
 {name:"Geldfit",kind:"Gratis en anoniem advies",description:"Krijg advies over geldzorgen en vind hulp die bij uw situatie past.",url:"https://geldfit.nl/"},
 {name:"Nibud",kind:"Stappenplannen en hulpmiddelen",description:"Werk aan overzicht in inkomsten, uitgaven en geldzaken.",url:"https://www.nibud.nl/"},
 {name:"Fraudehelpdesk",kind:"Hulp bij oplichting",description:"Lees wat u kunt doen bij fraude, phishing of verdachte berichten.",url:"https://www.fraudehelpdesk.nl/"},
 {name:"Regelhulp – hulp bij geldzaken",kind:"Hulp bij administratie en schulden",description:"Bekijk cursussen, vrijwilligershulp en ondersteuning via de gemeente.",url:"https://www.regelhulp.nl/onderwerpen/inkomen/hulp-bij-geldzaken"}],
 digital:[
 {name:"SeniorWeb – online cursussen",kind:"Online cursussen",description:"Oefen met e-mail, smartphone, tablet, internet en online veiligheid.",url:"https://www.seniorweb.nl/cursussen/online-cursussen"},
 {name:"SeniorWeb – leslocaties",kind:"Cursus en persoonlijke hulp",description:"Zoek een bibliotheek of leslocatie met workshops en begeleiding.",url:"https://www.seniorweb.nl/over-seniorweb/leslocaties"},
 {name:"Eenvoudig op Internet – hulp in de buurt",kind:"Cursussen en lokale hulp",description:"Zoek in uw gemeente hulp bij computer, internet, geld, reizen en zorg.",url:"https://www.eenvoudigopinternet.nl/nl/bij-jou-in-de-buurt/"},
 {name:"Oefenen.nl",kind:"Online oefenen",description:"Oefen stap voor stap met digitale vaardigheden en dagelijkse situaties.",url:"https://www.oefenen.nl/"}]
};
function resourceLinks(topic){
 const coursePhoto = topic === "digital"
  ? '<img class="resource-photo" src="https://storage.pubble.nl/fe5959ff/content/2020/1/9b3184c2-0d42-459b-8ab7-608c9553366c_thumb1440.jpg" alt="Ouderen krijgen in een bibliotheek hulp bij het leren werken met een computer" loading="lazy">'
  : "";
 return '<div class="resource-list"><h4>Websites en cursussen die hierbij kunnen helpen</h4>'+coursePhoto+
 resourcesByTopic[topic].map(item=>'<a class="resource-link" href="'+item.url+'" target="_blank" rel="noopener noreferrer"><strong>'+escapeHTML(item.name)+'</strong><span class="resource-kind">'+escapeHTML(item.kind)+'</span><span>'+escapeHTML(item.description)+'</span><span class="resource-cta">Bekijk website of cursus →</span></a>').join("")+
 '<p class="resource-disclaimer">Websites van externe organisaties. Cursusaanbod, kosten en beschikbaarheid kunnen veranderen. Controleer de voorwaarden bij de aanbieder.</p></div>';
}

const form = document.querySelector("#support-form");
const input = document.querySelector("#issue");
const results = document.querySelector("#results");
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
async function translateText(text, source, target) {
  if (!text || source === target) return text;
  const response = await fetch("https://translate.astian.org/translate", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({q:text, source, target, format:"text"})
  });
  if (!response.ok) throw new Error("Translation service unavailable");
  const data = await response.json();
  if (!data.translatedText) throw new Error("Translation unavailable");
  return data.translatedText;
}
async function showResults(query) {
  results.innerHTML = '<div class="no-results" role="status">We zoeken passende informatie…</div>';
  results.scrollIntoView({behavior:"smooth",block:"nearest"});

  // Translation is optional: if the external service is unavailable, search
  // the Dutch guide directly instead of blocking the user with an error.
  let dutchQuery = query;
  let language = "nl";
  let translatedSearch = false;
  try {
    const detected = await translateText(query, "auto", "nl");
    dutchQuery = detected;
    translatedSearch = true;
    // Language detection is returned by LibreTranslate alongside translatedText,
    // so fetch it separately only when the provider is available.
    const response = await fetch("https://translate.astian.org/detect", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({q:query})
    });
    if (response.ok) {
      const languages = await response.json();
      language = languages?.[0]?.language || "nl";
    }
  } catch (error) {
    dutchQuery = query;
    language = "nl";
  }

  const safeTranslate = async (value, source, target) => {
    if (source === target) return value;
    try { return await translateText(value, source, target); }
    catch (error) { return value; }
  };

  const haystack = dutchQuery.toLocaleLowerCase("nl");
  const ranked = guides.map(guide => {
    const score = guide.keys.reduce((total,key) => {
      const k = key.toLocaleLowerCase("nl");
      return total + (haystack.includes(k) ? (k.includes(" ") ? 4 : 2) : 0);
    },0);
    return {...guide,score};
  }).filter(guide => guide.score > 0).sort((a,b) => b.score-a.score);
  const chosen = ranked.slice(0,3);
  if (!chosen.length) {
    let message = "We kunnen geen passende tip vinden in onze startgids. Probeer Nederlandse zoekwoorden zoals vallen, medicijnen, eenzaamheid, hulp in huis, geld of vervoer.";
    message = await safeTranslate(message,"nl",language);
    results.innerHTML = '<div class="no-results"><h3>Laten we het anders proberen</h3><p>'+escapeHTML(message)+'</p></div>';
    results.scrollIntoView({behavior:"smooth",block:"nearest"});
    return;
  }

  const labels = await Promise.all(["Mogelijke startpunten","Dit kunt u proberen:","Goed om te weten:"].map(label => safeTranslate(label,"nl",language)));
  const localized = await Promise.all(chosen.map(async guide => ({
    ...guide,
    title: await safeTranslate(guide.title,"nl",language),
    tag: await safeTranslate(guide.tag,"nl",language),
    intro: await safeTranslate(guide.intro,"nl",language),
    steps: await Promise.all(guide.steps.map(step=>safeTranslate(step,"nl",language))),
    note: await safeTranslate(guide.note,"nl",language)
  })));
  const languageNote = language !== "nl" && !translatedSearch
    ? '<p class="translation-note">De vertaaldienst is tijdelijk niet beschikbaar. De resultaten worden daarom in het Nederlands getoond.</p>' : "";
  results.innerHTML = languageNote + '<h3 class="result-heading">'+escapeHTML(labels[0])+'</h3>' + localized.map(guide =>
    '<article class="result-card"><span class="result-tag">'+escapeHTML(guide.tag)+'</span><h3>'+escapeHTML(guide.title)+'</h3><p>'+escapeHTML(guide.intro)+'</p><strong>'+escapeHTML(labels[1])+'</strong><ul>'+guide.steps.map(step=>'<li>'+escapeHTML(step)+'</li>').join("")+'</ul><p><strong>'+escapeHTML(labels[2])+'</strong> '+escapeHTML(guide.note)+'</p>'+resourceLinks(guide.id)+'</article>'
  ).join("");
  results.scrollIntoView({behavior:"smooth",block:"nearest"});
}
form.addEventListener("submit",event=>{
  event.preventDefault();
  const query=input.value.trim();
  if(query.length<3){results.innerHTML='<div class="no-results">Schrijf iets meer, zodat we passende informatie kunnen zoeken.</div>';return;}
  showResults(query);
});
document.querySelectorAll("[data-prompt]").forEach(button=>button.addEventListener("click",()=>{
  input.value=button.dataset.prompt;
  input.focus();
  document.querySelector("#finder").scrollIntoView({behavior:"smooth"});
}));
document.querySelectorAll("[data-topic]").forEach(button=>button.addEventListener("click",()=>{
  const guide=guides.find(item=>item.id===button.dataset.topic);
  if(guide){input.value=guide.keys.slice(0,3).join(", ");showResults(input.value);}
  document.querySelector("#finder").scrollIntoView({behavior:"smooth"});
}));