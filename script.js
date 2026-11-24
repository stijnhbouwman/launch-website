const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".nav-links");
menuButton?.addEventListener("click", () => {
  const open = navigation.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});
navigation?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  navigation.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton?.setAttribute("aria-label", "Open navigation");
}));
document.querySelector("#year").textContent = new Date().getFullYear();

const guides = [
 {id:"mobility",title:"Moving around safely",tag:"Mobility and falls",keys:["fall","fell","falling","balance","unsteady","walking","walk","stairs","trip","mobility","wheelchair","cane","stick","fear of falling"],intro:"A safer home and the right support can make moving around feel more manageable.",steps:["Tell your doctor or healthcare professional about falls, dizziness, or changes in balance.","Ask whether a medication review or a falls-prevention assessment would be useful.","Keep walkways clear, improve lighting, and consider grab rails or other home adaptations.","Ask a trusted person or local older-person support service about help with shopping and transport."],note:"A fall followed by a head injury, severe pain, inability to get up, or sudden weakness needs urgent medical attention."},
 {id:"health",title:"Health and medicines",tag:"Health support",keys:["medicine","medication","pills","prescription","doctor","appointment","health","pain","symptom","hospital","treatment","dose","side effect","pharmacy"],intro:"A health professional or pharmacist can help explain treatment, medicines, and the next steps.",steps:["Write down what has changed, when it started, and any questions you want to ask.","Keep an up-to-date list of medicines and take it to appointments.","Ask your pharmacist or prescriber before changing or stopping a medicine.","If it helps, ask someone you trust to go with you or help arrange an appointment."],note:"This guide cannot diagnose symptoms or tell you what medicine or dose to take. Seek urgent care for sudden or severe symptoms."},
 {id:"connection",title:"Feeling connected",tag:"Social connection",keys:["lonely","loneliness","alone","isolated","friends","friend","meet people","company","bereaved","grief","sad","community","social"],intro:"Feeling lonely is common, and it is okay to ask for company or support. Small, regular connections can help.",steps:["Think of one person you might enjoy speaking with, and try a short call or message.","Look for local libraries, community centres, clubs, faith groups, or older-adult activities.","Ask a local council or community organisation whether they offer befriending or telephone check-ins.","If low mood or sadness is lasting or affecting daily life, speak with a healthcare professional."],note:"If you feel at risk of harming yourself or cannot stay safe, contact emergency or crisis support in your area now."},
 {id:"home",title:"Getting a little more help at home",tag:"Daily living",keys:["home","cleaning","clean","cook","cooking","shopping","shower","bath","dressing","care","caregiver","carer","housework","daily tasks","support at home"],intro:"You may be able to get practical help with everyday tasks, personal care, meals, or making your home easier to manage.",steps:["Write down the tasks that have become difficult and what kind of help would make a difference.","Ask your local council or social services department about a care-needs assessment and home support.","Ask a healthcare professional about occupational therapy or equipment that could make daily tasks safer.","If family or friends help you, talk together about a routine that feels manageable for everyone."],note:"The names of services and eligibility rules vary by location. Your local council or social services team is a good starting point."},
 {id:"money",title:"Money, bills and avoiding scams",tag:"Money and safety",keys:["money","bill","bills","rent","debt","pension","benefit","benefits","cost","costs","budget","bank","scam","fraud","stolen","payment","finance"],intro:"Independent advice can help you understand bills, check what support may be available, and protect yourself from fraud.",steps:["Gather the letters or bills you want help understanding, but keep account numbers and passwords private.","Contact the organisation using a phone number from an official statement or its verified website.","Ask a local advice charity, citizens advice service, or social worker about benefits and budgeting support.","Never share a one-time passcode, PIN, or password with someone who contacts you unexpectedly."],note:"If you think money has been stolen, contact your bank immediately using its official number. Report suspected fraud to the relevant authority in your country."},
 {id:"digital",title:"Technology and getting around",tag:"Everyday independence",keys:["phone","computer","internet","online","email","video call","technology","tablet","password","bus","train","transport","driving","drive","travel","journey"],intro:"A little patient, hands-on help can make technology and transport feel less daunting.",steps:["Ask a library, community centre, or local older-adult group whether it offers beginner digital skills sessions.","Ask a trusted person to show you one task at a time and write the steps down in large print.","Check whether your local transport authority offers accessible travel information or assisted travel schemes.","Be cautious of unexpected messages asking you to click a link, pay money, or share a password."],note:"Never give remote access to your device or banking details to an unexpected caller."}
];
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
  results.innerHTML = '<div class="no-results" role="status">Finding guidance in your language…</div>';
  results.scrollIntoView({behavior:"smooth",block:"nearest"});
  try {
    // The translation service detects the language while converting the query to English.
    const detectionResponse = await fetch("https://translate.astian.org/translate", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({q:query,source:"auto",target:"en",format:"text"})
    });
    if (!detectionResponse.ok) throw new Error("Translation service unavailable");
    const detected = await detectionResponse.json();
    const englishQuery = detected.translatedText;
    const language = detected.detectedLanguage?.language || "en";
    const ranked = guides.map(guide => {
      const haystack = englishQuery.toLowerCase();
      const score = guide.keys.reduce((total,key) => {
        const k = key.toLowerCase();
        return total + (haystack.includes(k) ? (k.includes(" ") ? 4 : 2) : 0);
      },0);
      return {...guide,score};
    }).filter(guide => guide.score > 0).sort((a,b) => b.score-a.score);
    const chosen = ranked.slice(0,3);
    if (!chosen.length) {
      let message = "We could not find a close match in our starter guide. Try a few simple words such as “lonely”, “fall”, “medication”, “bills”, or “help at home”. You can also speak with a trusted person or local support service.";
      if (language !== "en") message = await translateText(message,"en",language);
      results.innerHTML = '<div class="no-results"><h3>Let’s try a different way</h3><p>'+escapeHTML(message)+'</p></div>';
      results.scrollIntoView({behavior:"smooth",block:"nearest"});
      return;
    }
    const labels = await Promise.all(["Some places to start","Things you could try:","Keep in mind:"].map(label => translateText(label,"en",language)));
    const localized = await Promise.all(chosen.map(async guide => ({
      ...guide,
      title: await translateText(guide.title,"en",language),
      tag: await translateText(guide.tag,"en",language),
      intro: await translateText(guide.intro,"en",language),
      steps: await Promise.all(guide.steps.map(step=>translateText(step,"en",language))),
      note: await translateText(guide.note,"en",language)
    })));
    results.innerHTML = '<h3 class="result-heading">'+escapeHTML(labels[0])+'</h3>' + localized.map(guide =>
      '<article class="result-card"><span class="result-tag">'+escapeHTML(guide.tag)+'</span><h3>'+escapeHTML(guide.title)+'</h3><p>'+escapeHTML(guide.intro)+'</p><strong>'+escapeHTML(labels[1])+'</strong><ul>'+guide.steps.map(step=>'<li>'+escapeHTML(step)+'</li>').join("")+'</ul><p><strong>'+escapeHTML(labels[2])+'</strong> '+escapeHTML(guide.note)+'</p></article>'
    ).join("");
    results.scrollIntoView({behavior:"smooth",block:"nearest"});
  } catch (error) {
    results.innerHTML = '<div class="no-results"><h3>We could not translate this search right now</h3><p>Please try again in a moment, or write your concern in English. Your description is sent to a third-party translation service so it can be matched and translated; please do not include names, addresses, passwords, or other sensitive information.</p></div>';
  }
}
form.addEventListener("submit",event=>{
  event.preventDefault();
  const query=input.value.trim();
  if(query.length<3){results.innerHTML='<div class="no-results">Please write a little more so we can look for a useful topic.</div>';return;}
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