// Lightweight metadata only. No media URLs are resolved until the existing
// request/Host pipeline processes a song chosen by the guest.
const song = (id, title, artist, language, genres, era, energy = "medium", difficulty = "medium", aliases = []) =>
  Object.freeze({ id, title, artist, language, genres:Object.freeze(genres), era, energy, difficulty, aliases:Object.freeze(aliases) });

export const PLAN_B_SONGS = Object.freeze([
  song("es-vivir-mi-vida","Vivir Mi Vida","Marc Anthony","es",["salsa","party"],"2010s","high","medium"),
  song("es-la-vida-es-un-carnaval","La Vida Es un Carnaval","Celia Cruz","es",["salsa","classic"],"1990s","high","medium"),
  song("es-suavemente","Suavemente","Elvis Crespo","es",["merengue","party"],"1990s","high","medium"),
  song("es-bailando","Bailando","Enrique Iglesias","es",["latin-pop","party"],"2010s","high","easy"),
  song("es-burbujas-de-amor","Burbujas de Amor","Juan Luis Guerra","es",["bachata","romantic"],"1990s","medium","medium"),
  song("es-como-la-flor","Como La Flor","Selena","es",["tejano","classic"],"1990s","medium","easy"),
  song("es-colgando-en-tus-manos","Colgando en Tus Manos","Carlos Baute y Marta Sánchez","es",["pop","duet"],"2000s","medium","medium"),
  song("es-la-camisa-negra","La Camisa Negra","Juanes","es",["latin-pop","rock"],"2000s","high","easy"),
  song("es-rayando-el-sol","Rayando el Sol","Maná","es",["rock","classic"],"1990s","medium","easy"),
  song("es-me-rehuso","Me Rehúso","Danny Ocean","es",["latin-pop","romantic"],"2010s","medium","easy"),
  song("es-procura","Procura","Chichi Peralta","es",["merengue","party"],"1990s","high","medium"),
  song("es-obsesion","Obsesión","Aventura","es",["bachata","romantic"],"2000s","medium","easy"),
  song("es-despacito","Despacito","Luis Fonsi","es",["reggaeton","party"],"2010s","high","medium"),
  song("es-robarte-un-beso","Robarte un Beso","Carlos Vives y Sebastián Yatra","es",["latin-pop","romantic"],"2010s","high","easy"),
  song("es-creo-en-mi","Creo en Mí","Natalia Jiménez","es",["pop","power-ballad"],"2010s","high","hard"),
  song("es-corre","Corre","Jesse & Joy","es",["pop","ballad"],"2010s","medium","medium"),
  song("es-entra-en-mi-vida","Entra en Mi Vida","Sin Bandera","es",["pop","romantic"],"2000s","medium","medium"),
  song("es-que-agonia","Qué Agonía","Yuridia y Ángela Aguilar","es",["regional","duet"],"2020s","high","hard"),
  song("es-te-aviso-te-anuncio","Te Aviso, Te Anuncio","Shakira","es",["latin-pop","rock"],"2000s","high","medium"),
  song("es-eres","Eres","Café Tacvba","es",["rock","romantic"],"2000s","medium","easy"),

  song("en-dancing-queen","Dancing Queen","ABBA","en",["pop","disco","party"],"1970s","high","easy"),
  song("en-i-wanna-dance","I Wanna Dance with Somebody","Whitney Houston","en",["pop","party"],"1980s","high","hard"),
  song("en-dont-stop-believin","Don't Stop Believin'","Journey","en",["rock","classic"],"1980s","high","medium"),
  song("en-sweet-caroline","Sweet Caroline","Neil Diamond","en",["pop","singalong"],"1960s","medium","easy"),
  song("en-livin-on-a-prayer","Livin' on a Prayer","Bon Jovi","en",["rock","party"],"1980s","high","hard"),
  song("en-man-feel-like-woman","Man! I Feel Like a Woman!","Shania Twain","en",["country","party"],"1990s","high","easy"),
  song("en-i-want-it-that-way","I Want It That Way","Backstreet Boys","en",["pop","singalong"],"1990s","medium","easy"),
  song("en-valerie","Valerie","Amy Winehouse","en",["pop","soul"],"2000s","high","medium"),
  song("en-shallow","Shallow","Lady Gaga and Bradley Cooper","en",["pop","duet"],"2010s","high","hard"),
  song("en-flowers","Flowers","Miley Cyrus","en",["pop","party"],"2020s","medium","easy"),
  song("en-someone-like-you","Someone Like You","Adele","en",["pop","ballad"],"2010s","medium","medium"),
  song("en-perfect","Perfect","Ed Sheeran","en",["pop","romantic"],"2010s","medium","easy"),
  song("en-rolling-in-the-deep","Rolling in the Deep","Adele","en",["pop","soul"],"2010s","high","hard"),
  song("en-uptown-funk","Uptown Funk","Mark Ronson feat. Bruno Mars","en",["funk","party"],"2010s","high","medium"),
  song("en-cant-help-falling","Can't Help Falling in Love","Elvis Presley","en",["classic","romantic"],"1960s","low","easy"),
  song("en-zombie","Zombie","The Cranberries","en",["rock","classic"],"1990s","high","medium"),
  song("en-whats-up","What's Up?","4 Non Blondes","en",["rock","singalong"],"1990s","high","medium"),
  song("en-wonderwall","Wonderwall","Oasis","en",["rock","singalong"],"1990s","medium","easy"),
  song("en-i-will-survive","I Will Survive","Gloria Gaynor","en",["disco","classic"],"1970s","high","medium"),
  song("en-before-he-cheats","Before He Cheats","Carrie Underwood","en",["country","party"],"2000s","high","medium"),

  song("fr-je-veux","Je veux","Zaz","fr",["pop","jazz"],"2010s","high","medium"),
  song("fr-la-vie-en-rose","La Vie en rose","Édith Piaf","fr",["chanson","classic"],"1940s","low","medium"),
  song("fr-derniere-danse","Dernière danse","Indila","fr",["pop","ballad"],"2010s","medium","medium"),
  song("fr-alors-on-danse","Alors on danse","Stromae","fr",["pop","dance"],"2000s","high","easy"),
  song("fr-sous-le-vent","Sous le vent","Garou et Céline Dion","fr",["pop","duet"],"2000s","medium","hard"),
  song("fr-je-te-promets","Je te promets","Johnny Hallyday","fr",["rock","classic"],"1980s","medium","medium"),
  song("fr-champs-elysees","Les Champs-Élysées","Joe Dassin","fr",["chanson","singalong"],"1960s","high","easy"),
  song("fr-pour-que-tu-maimes","Pour que tu m'aimes encore","Céline Dion","fr",["pop","ballad"],"1990s","high","hard"),
  song("fr-papaoutai","Papaoutai","Stromae","fr",["pop","dance"],"2010s","high","medium"),
  song("fr-formidable","Formidable","Stromae","fr",["pop","chanson"],"2010s","medium","medium"),

  song("it-volare","Nel blu dipinto di blu (Volare)","Domenico Modugno","it",["pop","classic"],"1950s","high","medium",["Volare"]),
  song("it-sara-perche-ti-amo","Sarà perché ti amo","Ricchi e Poveri","it",["pop","party"],"1980s","high","easy"),
  song("it-litaliano","L'Italiano","Toto Cutugno","it",["pop","classic"],"1980s","medium","easy"),
  song("it-gloria","Gloria","Umberto Tozzi","it",["pop","classic"],"1970s","high","medium"),
  song("it-azzurro","Azzurro","Adriano Celentano","it",["pop","classic"],"1960s","medium","easy"),
  song("it-vivo-per-lei","Vivo per lei","Andrea Bocelli e Giorgia","it",["pop","duet"],"1990s","high","hard"),
  song("it-laura-non-ce","Laura non c'è","Nek","it",["pop","rock"],"1990s","medium","medium"),
  song("it-ti-amo","Ti amo","Umberto Tozzi","it",["pop","romantic"],"1970s","medium","medium"),
  song("it-la-solitudine","La solitudine","Laura Pausini","it",["pop","ballad"],"1990s","medium","hard"),
  song("it-con-te-partiro","Con te partirò","Andrea Bocelli","it",["classical-pop","ballad"],"1990s","high","hard"),

  song("de-99-luftballons","99 Luftballons","Nena","de",["pop","rock"],"1980s","high","easy"),
  song("de-atemlos","Atemlos durch die Nacht","Helene Fischer","de",["schlager","party"],"2010s","high","easy"),
  song("de-major-tom","Major Tom (völlig losgelöst)","Peter Schilling","de",["pop","new-wave"],"1980s","high","medium"),
  song("de-ein-kompliment","Ein Kompliment","Sportfreunde Stiller","de",["rock","singalong"],"2000s","medium","easy"),
  song("de-ueber-den-wolken","Uber den Wolken","Reinhard Mey","de",["folk","classic"],"1970s","low","easy",["Über den Wolken"]),
  song("de-griechischer-wein","Griechischer Wein","Udo Jürgens","de",["schlager","classic"],"1970s","medium","easy"),
  song("de-marmor-stein","Marmor, Stein und Eisen bricht","Drafi Deutscher","de",["schlager","singalong"],"1960s","high","easy"),
  song("de-tage-wie-diese","Tage wie diese","Die Toten Hosen","de",["rock","party"],"2010s","high","medium"),
  song("de-ich-war-noch-niemals","Ich war noch niemals in New York","Udo Jürgens","de",["schlager","classic"],"1980s","medium","medium"),
  song("de-hulapalu","Hulapalu","Andreas Gabalier","de",["party","folk-pop"],"2010s","high","easy"),

  song("ru-katyusha","Катюша","Народная","ru",["folk","classic"],"1930s","medium","easy",["Katyusha"]),
  song("ru-million-roses","Миллион алых роз","Алла Пугачёва","ru",["pop","classic"],"1980s","medium","medium"),
  song("ru-moscow-nights","Подмосковные вечера","Владимир Трошин","ru",["classic","ballad"],"1950s","low","easy"),
  song("ru-gruppa-krovi","Группа крови","Кино","ru",["rock","classic"],"1980s","medium","easy"),
  song("ru-white-roses","Белые розы","Ласковый май","ru",["pop","classic"],"1980s","medium","easy"),
  song("ru-star-called-sun","Звезда по имени Солнце","Кино","ru",["rock","classic"],"1980s","medium","easy"),
  song("ru-kukushka","Кукушка","Кино","ru",["rock","ballad"],"1990s","high","hard"),
  song("ru-oi-moroz","Ой, мороз, мороз","Народная","ru",["folk","classic"],"traditional","medium","easy"),
  song("ru-glass-vodka","Рюмка водки на столе","Григорий Лепс","ru",["pop","singalong"],"2000s","high","hard"),
  song("ru-nebo-slavyan","Небо славян","Алиса","ru",["rock"],"2000s","high","hard"),

  song("pt-ai-se-eu-te-pego","Ai Se Eu Te Pego","Michel Teló","pt",["sertanejo","party"],"2010s","high","easy"),
  song("pt-garota-de-ipanema","Garota de Ipanema","Tom Jobim e Vinicius de Moraes","pt",["bossa-nova","classic"],"1960s","low","medium"),
  song("pt-evidencias","Evidências","Chitãozinho & Xororó","pt",["sertanejo","singalong"],"1990s","high","medium"),
  song("pt-cheia-de-manias","Cheia de Manias","Raça Negra","pt",["pagode","party"],"1990s","high","easy"),
  song("pt-pais-tropical","País Tropical","Jorge Ben Jor","pt",["samba","party"],"1960s","high","easy"),
  song("pt-nao-quero-dinheiro","Não Quero Dinheiro","Tim Maia","pt",["soul","party"],"1970s","high","easy"),
  song("pt-sorte-grande","Sorte Grande","Ivete Sangalo","pt",["axe","party"],"2000s","high","medium"),
  song("pt-anna-julia","Anna Júlia","Los Hermanos","pt",["rock","singalong"],"1990s","high","easy"),
  song("pt-velha-infancia","Velha Infância","Tribalistas","pt",["pop","romantic"],"2000s","medium","easy"),
  song("pt-boa-sorte","Boa Sorte / Good Luck","Vanessa da Mata e Ben Harper","pt",["pop","duet"],"2000s","medium","medium"),

  song("hi-tum-hi-ho","Tum Hi Ho","Arijit Singh","hi",["bollywood","romantic"],"2010s","medium","hard",["तुम ही हो"]),
  song("hi-kal-ho-naa-ho","Kal Ho Naa Ho","Sonu Nigam","hi",["bollywood","ballad"],"2000s","medium","hard",["कल हो ना हो"]),
  song("hi-tujh-mein-rab","Tujh Mein Rab Dikhta Hai","Roop Kumar Rathod","hi",["bollywood","romantic"],"2000s","medium","medium",["तुझ में रब दिखता है"]),
  song("hi-badtameez-dil","Badtameez Dil","Benny Dayal","hi",["bollywood","party"],"2010s","high","hard",["बदतमीज़ दिल"]),
  song("hi-gallan-goodiyaan","Gallan Goodiyaan","Various Artists","hi",["bollywood","party","group"],"2010s","high","medium",["गल्लां गूडियां"]),
  song("hi-pehla-nasha","Pehla Nasha","Udit Narayan and Sadhana Sargam","hi",["bollywood","romantic","duet"],"1990s","medium","medium",["पहला नशा"]),
  song("hi-chaiyya-chaiyya","Chaiyya Chaiyya","Sukhwinder Singh and Sapna Awasthi","hi",["bollywood","party"],"1990s","high","medium",["छैया छैया"]),
  song("hi-kabira","Kabira","Tochi Raina and Rekha Bhardwaj","hi",["bollywood","folk"],"2010s","medium","medium",["कबीरा"]),
  song("hi-kesariya","Kesariya","Arijit Singh","hi",["bollywood","romantic"],"2020s","medium","medium",["केसरिया"]),
  song("hi-dil-chahta-hai","Dil Chahta Hai","Shankar Mahadevan","hi",["bollywood","party","group"],"2000s","high","medium",["दिल चाहता है"])
]);

export const PLAN_B_COUNTS = Object.freeze(Object.fromEntries(
  ["es","en","fr","it","de","ru","pt","hi"].map((language) => [language, PLAN_B_SONGS.filter((item) => item.language === language).length])
));

function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.max(0, Math.min(.999999999, random())) * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/**
 * @param {{language?:string,recentIds?:string[],limit?:number,filters?:{genre?:string,era?:string,energy?:string,difficulty?:string},random?:()=>number}} options
 */
export function selectPlanBSongs({ language, recentIds = [], limit = 6, filters = {}, random = Math.random } = {}) {
  const recent = new Set(Array.isArray(recentIds) ? recentIds : []);
  const matches = PLAN_B_SONGS.filter((item) => item.language === language)
    .filter((item) => !filters.genre || item.genres.includes(filters.genre))
    .filter((item) => !filters.era || item.era === filters.era)
    .filter((item) => !filters.energy || item.energy === filters.energy)
    .filter((item) => !filters.difficulty || item.difficulty === filters.difficulty);
  const fresh = matches.filter((item) => !recent.has(item.id));
  const target = Math.max(1, Math.min(12, Number(limit) || 6));
  const immediate = new Set(recentIds.slice(-Math.min(target,Math.max(0,matches.length-1))));
  const nonImmediate = matches.filter((item)=>!immediate.has(item.id));
  const pool = fresh.length >= Math.min(target, matches.length) ? fresh : nonImmediate.length >= Math.min(target,matches.length) ? nonImmediate : matches;
  return shuffled(pool, random).slice(0, target);
}

/** @param {string[]} previous @param {Array<string|{id?:string}>} selected @param {number} maximum */
export function rememberSuggested(previous, selected, maximum = 24) {
  const ids = [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(selected) ? selected : []).map((item) => typeof item === "string" ? item : item?.id)]
    .filter(Boolean);
  return [...new Set(ids.reverse())].reverse().slice(-Math.max(1, maximum));
}
