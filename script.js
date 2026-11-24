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
const topicFromLink = new URLSearchParams(window.location.search).get("topic");
const topicPrompts = {
  mobility:"Ik wil veiliger bewegen en ben bang om te vallen.",
  health:"Ik heb vragen over mijn gezondheid of medicijnen.",
  connection:"Ik voel me alleen en wil meer contact met anderen.",
  home:"Ik heb hulp nodig bij dagelijkse taken in huis.",
  money:"Ik maak me zorgen over rekeningen of geldzaken.",
  digital:"Ik wil hulp bij digitale vaardigheden of vervoer."
};
if (input && topicPrompts[topicFromLink]) input.value = topicPrompts[topicFromLink];

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
if (form && input && results) {
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

}

// KindPath concrete action plans: turn a broad topic match into a usable next step.
const actionPlans = {
 mobility:{
  urgency:"Bij een recente val met mogelijk hoofdletsel, ernstige pijn, niet kunnen opstaan of plotselinge uitval: bel 112. Bij twijfel over letsel: bel vandaag de huisarts of huisartsenpost.",
  today:["Zet losse kleedjes, snoeren en spullen uit de looproute. Zorg dat de route naar toilet en slaapkamer goed verlicht is.","Draag stevige schoenen met een gesloten hiel; loop niet op sokken over gladde vloeren.","Noteer wanneer u bijna viel of viel: waar, waardoor, duizeligheid, schoeisel en eventuele klachten."],
  arrange:["Bel uw huisartspraktijk en vraag om een afspraak vanwege valangst, evenwichtsproblemen of een val. Vraag of een valrisicobeoordeling en medicatiecheck passend zijn.","Vraag de fysiotherapeut of huisarts naar een erkende valpreventieve beweeginterventie in uw buurt.","Neem contact op met het Wmo-loket van uw gemeente als u een woningaanpassing, hulpmiddel of ondersteuning nodig heeft."],
  prepare:["Een lijst van uw medicijnen (ook middelen zonder recept).","Een korte beschrijving van valmomenten, duizeligheid en plekken in huis waar u onzeker bent.","Iemand die mee kan naar de afspraak, als u dat prettig vindt."],
  say:"Ik ben de laatste tijd onzeker met lopen / ik ben gevallen. Ik wil graag laten beoordelen waardoor dat komt en wat ik kan doen om veilig te blijven bewegen. Kunt u met mij een valrisicobeoordeling bespreken?",
  fallback:"Lukt het niet om de huisarts te bereiken? Bel opnieuw tijdens openingstijden en vraag naar de assistente. Buiten openingstijden belt u de huisartsenpost bij klachten die niet kunnen wachten. Voor woningaanpassingen kunt u rechtstreeks het Wmo-loket van uw gemeente benaderen."
 },
 health:{
  urgency:"Bij levensbedreigende klachten zoals ernstige benauwdheid, pijn op de borst of verschijnselen van een beroerte: bel 112. Bij snel verergerende of urgente klachten: huisarts of huisartsenpost.",
  today:["Schrijf uw klacht op: wanneer begonnen, waar last van, hoe vaak, wat maakt het beter of erger?","Maak een lijst van alle medicijnen, vitamines en zelfzorgmiddelen. Verander of stop medicatie niet op eigen initiatief.","Bel de huisartspraktijk als klachten nieuw zijn, aanhouden of u zich zorgen maakt; vraag of u dezelfde dag beoordeeld moet worden."],
  arrange:["Vraag uw apotheek om een medicatiegesprek als u meerdere medicijnen gebruikt, bijwerkingen vermoedt of innemen lastig vindt.","Vraag uw huisarts om uitleg in gewone taal: wat is het doel, wat zijn mogelijke bijwerkingen en wanneer moet u terugbellen?","Vraag om een medicatieoverzicht en laat wijzigingen controleren door arts of apotheker."],
  prepare:["Medicijndoosjes of een actueel medicatieoverzicht.","Uw vragen op papier en het moment waarop de klachten begonnen.","Eventueel een vertrouwd persoon om mee te luisteren."],
  say:"Ik maak me zorgen over [klacht / medicijn]. Het begon op [moment]. Ik gebruik [medicijn(en)]. Kunt u uitleggen wat een verstandige volgende stap is en wanneer ik opnieuw contact moet opnemen?",
  fallback:"Krijgt u geen gehoor en kunnen de klachten niet wachten? Neem contact op met de huisartsenpost. Bij een levensbedreigende situatie belt u 112. Voor uitleg over gebruik of bijwerkingen kunt u ook uw eigen apotheek bellen."
 },
 connection:{
  urgency:"Als u zich niet veilig voelt of denkt aan zelfdoding: blijf er niet alleen mee. Bel 112 bij direct gevaar; in Nederland kunt u 113 of 0800-0113 bellen of chatten via 113.nl.",
  today:["Kies één laagdrempelig contact: bel iemand, stuur een kort bericht of maak een afspraak voor koffie. Een klein contactmoment telt ook.","Ga deze week naar een vaste plek waar u mensen vaker tegenkomt, zoals de bibliotheek, het buurthuis, een wandelgroep of vereniging.","Vertel één persoon eerlijk: 'Ik merk dat ik me vaak alleen voel en zou graag wat vaker contact hebben.'"],
  arrange:["Bel het welzijnswerk of sociaal wijkteam van uw gemeente en vraag naar een ouderenadviseur, maatjesproject of ontmoetingsgroep.","Vraag de bibliotheek of het buurthuis naar vaste activiteiten, vervoer en eventuele begeleiding bij de eerste keer.","Als verdriet, angst of somberheid blijft aanhouden: maak een afspraak met uw huisarts en vertel ook hoe het uw slaap en dagelijks leven beïnvloedt."],
  prepare:["Bedenk welk contact bij u past: één-op-één, groep, telefonisch, buiten wandelen of thuis bezoek.","Noteer dagen en tijden waarop u meestal gezelschap mist.","Vraag eventueel iemand om de eerste keer met u mee te gaan."],
  say:"Ik heb de laatste tijd weinig contact en voel me vaak alleen. Ik wil graag mensen ontmoeten, maar weet niet goed waar ik moet beginnen. Welke ontmoetingsactiviteiten of maatjesprojecten zijn er in mijn buurt?",
  fallback:"Weet u niet welk loket u moet hebben? Bel het algemene nummer van uw gemeente en vraag naar welzijnswerk of het sociaal wijkteam. Vraag expliciet om iemand die met u de eerste stap kan regelen."
 },
 home:{
  urgency:"Als u thuis direct gevaar loopt, essentiële zorg niet krijgt of uzelf niet veilig kunt verzorgen, bel uw huisarts of gemeente voor urgente ondersteuning; bij direct levensgevaar 112.",
  today:["Maak twee lijstjes: wat lukt niet meer (bijvoorbeeld douchen, koken, schoonmaken) en wat zou meteen helpen.","Vraag iemand die u vertrouwt om tijdelijk één concrete taak over te nemen, zoals boodschappen of een maaltijd.","Voorkom onveilige situaties: gebruik geen stoel als trapje en vraag hulp bij zwaar of gevaarlijk werk."],
  arrange:["Bel het Wmo-loket van uw gemeente en vraag om een gesprek over huishoudelijke hulp, begeleiding, dagbesteding of woningaanpassingen.","Vraag naar onafhankelijke cliëntondersteuning. Deze persoon kan gratis helpen uw vraag voor te bereiden en de aanvraag te begrijpen.","Bespreek persoonlijke verzorging of verpleging met uw huisarts of wijkverpleegkundige; wijkverpleging loopt doorgaans via de zorgverzekeraar."],
  prepare:["Welke taken lukken niet, hoe vaak is hulp nodig en sinds wanneer?","Wat doet u zelf nog en wat doet een mantelzorger al?","Welke oplossing zou voor u het meeste verschil maken?"],
  say:"Ik woon thuis en merk dat [taak] niet meer goed lukt. Ik wil graag zo zelfstandig mogelijk blijven wonen. Kunt u een Wmo-gesprek of een passende beoordeling met mij regelen?",
  fallback:"Vraag de gemeente om uw melding te registreren en uit te leggen wat de vervolgstappen en termijnen zijn. Als u het niet eens bent met een besluit, vraag om een schriftelijke uitleg en hulp van onafhankelijke cliëntondersteuning."
 },
 money:{
  urgency:"Bij een verdachte betaling of vermoeden dat iemand toegang heeft tot uw bankrekening: bel direct de fraudehelpdesk van uw bank via het nummer op uw bankpas of de officiële bankwebsite. Deel geen codes.",
  today:["Open geen links uit onverwachte sms'jes, e-mails of WhatsApp-berichten en maak geen geld over op verzoek van een onbekende beller.","Leg ongeopende brieven en rekeningen op één plek. Noteer de uiterste betaaldatum; negeer aanmaningen niet.","Bel bij een onterechte of onduidelijke rekening de organisatie via een zelf opgezocht officieel telefoonnummer."],
  arrange:["Maak gratis een afspraak bij Geldfit (geldfit.nl) of bel uw gemeente en vraag naar schuldhulpverlening of sociaal raadslieden.","Vraag bij de gemeente naar hulp met toeslagen, minimaregelingen, betalingsregelingen en het ordenen van administratie.","Bij een incasso of deurwaardersbrief: vraag direct om specificatie en advies; beloof geen betaling die u niet kunt nakomen."],
  prepare:["Brieven, bedragen en uiterste data; scherm BSN, rekeningnummers en andere gevoelige gegevens af als u iets deelt.","Een overzicht van inkomsten en vaste lasten, voor zover beschikbaar.","Noteer wie u al hebt gesproken en welke afspraken zijn gemaakt."],
  say:"Ik heb moeite met het overzicht van mijn rekeningen / ik kan een rekening niet betalen. Ik wil voorkomen dat het erger wordt. Kunt u mij verbinden met schuldhulpverlening of sociaal raadslieden?",
  fallback:"Reageert een schuldeiser niet? Neem contact op met de gemeentelijke schuldhulpverlening en bewaar kopieën van uw berichten. Bij bankfraude belt u uw bank direct; bij phishing kunt u advies vragen aan de Fraudehelpdesk."
 },
 digital:{
  urgency:"Heeft iemand u gevraagd een programma te installeren, een code te delen of geld over te maken? Stop het contact. Bel uw bank via het officiële nummer als bankgegevens gedeeld zijn.",
  today:["Klik niet op onverwachte links en geef nooit uw wachtwoord, pincode of verificatiecode door, ook niet aan iemand die zegt van de bank of overheid te zijn.","Vraag een vertrouwd persoon om één handeling tegelijk met u te oefenen. Schrijf de stappen groot en duidelijk op.","Voor vervoer: noteer vertrekpunt, bestemming en gewenste aankomsttijd; controleer de reis samen via de officiële vervoerder."],
  arrange:["Zoek via SeniorWeb (seniorweb.nl) een leslocatie of lidmaatschap met telefonische hulp; bibliotheken bieden vaak gratis digitale inloopspreekuren.","Vraag de bibliotheek naar het Informatiepunt Digitale Overheid (IDO) voor hulp bij DigiD, toeslagen, zorg en overheidswebsites.","Voor reizen met bus of trein: vraag de vervoerder naar reisassistentie, toegankelijkheid en telefonisch boeken."],
  prepare:["Neem uw eigen apparaat en oplader mee naar een les of inloopspreekuur.","Schrijf op wat u wilt leren en welke foutmelding u ziet. Neem nooit uw wachtwoorden op papier mee.","Vraag vooraf of de hulp gratis is en of u een afspraak nodig hebt."],
  say:"Ik wil graag leren hoe ik [handeling] veilig kan doen. Kunt u mij dit rustig stap voor stap laten zien, zodat ik het later zelf kan herhalen?",
  fallback:"Lukt het online niet? Ga naar de bibliotheek en vraag bij de balie naar het Informatiepunt Digitale Overheid of een SeniorWeb-leslocatie. Geef uw apparaat niet onbeheerd mee en laat niemand op afstand meekijken tenzij u die persoon zelf hebt gekozen en vertrouwt."
 }
};
function chooseGuide(query){
 const text = query.toLocaleLowerCase("nl");
 const ranked = guides.map(g => {
  let score = 0;
  for(const key of g.keys){const k=key.toLocaleLowerCase("nl");if(text.includes(k)) score += k.includes(" ") ? 5 : 2;}
  const extra = {
   mobility:["struikel","onvast","duizelig","rollator","traplopen","bang om te vallen"],
   health:["bijwerking","pijn","dokters","recept","dosering","medicatie"],
   connection:["niemand","bezoek","maatje","rouw","partner overleden","contact missen"],
   home:["schoonmaak","wassen","verzorging","mantelzorg","huishoudelijke","traplift"],
   money:["belasting","belastingbrief","incasso","deurwaarder","phishing","pinpas","betalingsregeling"],
   digital:["digi d","digid","whatsapp","smartphone","computerles","inloggen","ov-chipkaart"]
  }[g.id] || [];
  for(const k of extra) if(text.includes(k)) score+=4;
  return {...g,score};
 }).sort((a,b)=>b.score-a.score);
 return ranked[0]?.score>0 ? ranked.filter(g=>g.score>0 && g.score>=ranked[0].score*0.45).slice(0,2) : [];
}
function renderActionPlan(guide){
 const p=actionPlans[guide.id];
 const list=(items)=>items.map(x=>'<li>'+escapeHTML(x)+'</li>').join("");
 return '<section class="action-plan"><div class="action-plan-head"><span class="result-tag">Persoonlijk stappenplan</span><h4>Wat u nu concreet kunt doen</h4><p>'+escapeHTML(guide.intro)+'</p></div>'+
 '<div class="action-columns"><div><h5>Vandaag of morgen</h5><ol>'+list(p.today)+'</ol></div><div><h5>Hulp daadwerkelijk regelen</h5><ol>'+list(p.arrange)+'</ol></div></div>'+
 '<div class="action-subsection"><h5>Leg dit alvast klaar</h5><ul>'+list(p.prepare)+'</ul></div>'+
 '<div class="call-script"><span>Voorbeeld: zo kunt u het zeggen</span><p>“'+escapeHTML(p.say)+'”</p><button type="button" class="copy-script" data-copy="'+escapeHTML(p.say)+'">Kopieer voorbeeldtekst</button></div>'+
 '<div class="fallback-step"><h5>Komt u niet verder?</h5><p>'+escapeHTML(p.fallback)+'</p></div>'+
 '<div class="urgency-note"><strong>Wanneer sneller handelen?</strong><p>'+escapeHTML(p.urgency)+'</p></div></section>';
}
async function showResults(query){
 results.innerHTML='<div class="no-results" role="status">Uw situatie wordt gekoppeld aan een concreet stappenplan…</div>';
 results.scrollIntoView({behavior:"smooth",block:"nearest"});
 const chosen=chooseGuide(query);
 if(!chosen.length){
  results.innerHTML='<div class="no-results"><h3>Ik wil u gerichter op weg helpen</h3><p>Ik herken nog niet goed welk soort hulp nodig is. Beschrijf in één extra zin wat er precies misgaat en wat u graag opgelost wilt hebben. Bijvoorbeeld: “Ik kan mijn huur niet betalen en heb volgende week een aanmaning” of “Ik durf niet meer alleen te douchen omdat ik bang ben om te vallen.”</p><p><strong>U hoeft geen naam, adres, BSN, rekeningnummer of medische documenten te delen.</strong></p></div>';
  return;
 }
 results.innerHTML='<h3 class="result-heading">Uw concrete route naar een oplossing</h3><p class="results-intro">We hebben uw beschrijving gekoppeld aan '+(chosen.length===1?'een passend onderwerp.':'de twee onderwerpen die het meest lijken te passen.')+' Begin bij stap 1. U hoeft niet alles tegelijk te regelen.</p>'+chosen.map(g=>'<article class="result-card detailed-result"><span class="result-tag">'+escapeHTML(g.tag)+'</span><h3>'+escapeHTML(g.title)+'</h3>'+renderActionPlan(g)+resourceLinks(g.id)+'</article>').join("");
 results.querySelectorAll("[data-copy]").forEach(button=>button.addEventListener("click",async()=>{
  const value=button.dataset.copy;
  try{await navigator.clipboard.writeText(value);button.textContent="Tekst gekopieerd";}
  catch(error){button.textContent="Selecteer de voorbeeldtekst om te kopiëren";}
 }));
 results.scrollIntoView({behavior:"smooth",block:"start"});
}
