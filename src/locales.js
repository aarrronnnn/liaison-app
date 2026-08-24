'use strict';
/* ============================================================
   Contexte de soiree — deux axes independants.

   Le pays dit ce que la salle reconnait : un refrain qui fait
   hurler une salle a Madrid ne dit rien a Berlin. Le type
   d'evenement dit comment la soiree se deroule : un mariage et
   un club n'ont ni la meme courbe, ni les memes moments obliges.

   Les deux se combinent. 12 pays x 8 evenements = 96 contextes,
   sans avoir a ecrire 96 listes a la main.
   ============================================================ */

const NO_OPINION = 0.9;   // un axe qui ne connait pas un genre ne doit pas l'ecraser

/* ---------------- axe 1 : le pays ---------------- */
const COUNTRIES = [
  { id: 'fr', label: 'France', flag: '\u{1F1EB}\u{1F1F7}',
    dna: { 'french touch':92,'house':86,'variete':78,'rap fr':80,'disco':74,'tech house':76,
           'techno':70,'pop':70,'funk':66,'afro':58,'rnb':56,'zouk':44,'reggaeton':40 },
    langBias: { fr:1.0, en:0.92, es:0.5 },
    decades: { '2020':1.0,'2010':0.92,'2000':0.8,'1990':0.72,'1980':0.66,'1970':0.5 },
    avoid: ['country', 'schlager'],
    tips: "Un refrain en francais rattrape une salle plus vite que n'importe quel drop." },

  { id: 'be', label: 'Belgique', flag: '\u{1F1E7}\u{1F1EA}',
    dna: { 'house':84,'techno':78,'new beat':70,'variete':66,'rap fr':66,'disco':72,'pop':72,
           'tech house':76,'french touch':74,'eurodance':60,'funk':62 },
    langBias: { fr:0.95, en:0.95, nl:0.7 },
    decades: { '2020':1.0,'2010':0.9,'2000':0.82,'1990':0.8,'1980':0.7 },
    avoid: ['country'],
    tips: "Public bilingue : alterner FR et EN evite de perdre la moitie de la salle." },

  { id: 'ch', label: 'Suisse', flag: '\u{1F1E8}\u{1F1ED}',
    dna: { 'house':84,'tech house':78,'pop':76,'variete':60,'disco':70,'techno':66,'rnb':58,
           'french touch':66,'deep house':74,'funk':60 },
    langBias: { fr:0.8, en:1.0, de:0.8, it:0.5 },
    decades: { '2020':1.0,'2010':0.92,'2000':0.8,'1990':0.7,'1980':0.62 },
    avoid: [],
    tips: "Salles souvent multilingues : l'anglais est le terrain neutre." },

  { id: 'uk', label: 'Royaume-Uni', flag: '\u{1F1EC}\u{1F1E7}',
    dna: { 'uk garage':92,'house':86,'drum and bass':82,'grime':70,'bassline':74,'disco':70,
           'pop':76,'techno':68,'jungle':66,'rnb':64,'afroswing':66,'britpop':62 },
    langBias: { en:1.0, fr:0.35 },
    decades: { '2020':1.0,'2010':0.9,'2000':0.85,'1990':0.85,'1980':0.7 },
    avoid: ['variete', 'schlager'],
    tips: "Le garage et la jungle passent partout, meme en mariage. Les tempos montent vite." },

  { id: 'us', label: 'États-Unis', flag: '\u{1F1FA}\u{1F1F8}',
    dna: { 'hip-hop':92,'rnb':86,'pop':84,'country':70,'house':70,'motown':74,'funk':72,
           'trap':78,'disco':70,'rock':66,'edm':72,'gospel':52 },
    langBias: { en:1.0, es:0.55, fr:0.2 },
    decades: { '2020':1.0,'2010':0.95,'2000':0.9,'1990':0.85,'1980':0.78,'1970':0.7 },
    avoid: ['variete', 'eurodance'],
    tips: "Le hip-hop et la Motown font le pont entre les generations. La country n'est pas un gag." },

  { id: 'es', label: 'Espagne', flag: '\u{1F1EA}\u{1F1F8}',
    dna: { 'reggaeton':92,'latin pop':88,'flamenco pop':76,'house':78,'tech house':74,
           'rumba':70,'pop':76,'salsa':66,'techno':64,'dembow':74,'rap es':66 },
    langBias: { es:1.0, en:0.85, fr:0.3 },
    decades: { '2020':1.0,'2010':0.9,'2000':0.85,'1990':0.8,'1980':0.7 },
    avoid: ['schlager'],
    tips: "Tout part beaucoup plus tard. Le pic reel est souvent apres 3 h." },

  { id: 'it', label: 'Italie', flag: '\u{1F1EE}\u{1F1F9}',
    dna: { 'italo disco':88,'house':82,'pop it':84,'tech house':78,'latin pop':66,'disco':78,
           'techno':66,'rap it':70,'funk':64,'eurodance':62 },
    langBias: { it:1.0, en:0.9, es:0.6 },
    decades: { '2020':1.0,'2010':0.9,'2000':0.85,'1990':0.85,'1980':0.85 },
    avoid: ['country'],
    tips: "L'italo des annees 80 n'est pas nostalgique ici : elle est encore jouee au premier degre." },

  { id: 'de', label: 'Allemagne', flag: '\u{1F1E9}\u{1F1EA}',
    dna: { 'techno':94,'minimal':82,'house':80,'trance':70,'hard techno':76,'tech house':78,
           'schlager':52,'pop':60,'rap de':66,'electro':74 },
    langBias: { de:0.8, en:1.0 },
    decades: { '2020':1.0,'2010':0.9,'2000':0.75,'1990':0.8,'1980':0.6 },
    avoid: ['variete', 'country'],
    tips: "Les sets sont longs et lineaires. Un vocal trop connu casse la transe plus qu'il ne l'aide." },

  { id: 'nl', label: 'Pays-Bas', flag: '\u{1F1F3}\u{1F1F1}',
    dna: { 'house':86,'tech house':82,'techno':76,'hardstyle':70,'edm':76,'disco':70,'pop':72,
           'afro house':68,'trance':68,'rap nl':58 },
    langBias: { nl:0.75, en:1.0 },
    decades: { '2020':1.0,'2010':0.95,'2000':0.8,'1990':0.72,'1980':0.62 },
    avoid: ['country'],
    tips: "Public tres habitue aux gros festivals : les breaks longs sont acceptes." },

  { id: 'pt', label: 'Portugal', flag: '\u{1F1F5}\u{1F1F9}',
    dna: { 'kizomba':78,'afro house':84,'house':80,'latin pop':74,'pop pt':76,'reggaeton':76,
           'funana':62,'tech house':72,'rap pt':66,'disco':66 },
    langBias: { pt:1.0, en:0.85, es:0.7 },
    decades: { '2020':1.0,'2010':0.9,'2000':0.82,'1990':0.75,'1980':0.65 },
    avoid: ['schlager', 'country'],
    tips: "L'afro house lusophone tient toute une nuit sans que la salle decroche." },

  { id: 'br', label: 'Brésil', flag: '\u{1F1E7}\u{1F1F7}',
    dna: { 'funk carioca':90,'pagode':80,'sertanejo':82,'latin pop':78,'house':70,'samba':74,
           'baile':84,'rap br':70,'axe':68,'reggaeton':70 },
    langBias: { pt:1.0, en:0.7, es:0.6 },
    decades: { '2020':1.0,'2010':0.92,'2000':0.85,'1990':0.78,'1980':0.7 },
    avoid: ['schlager', 'country'],
    tips: "Le sertanejo n'est pas un genre de repli : c'est souvent le pic de la soiree." },

  { id: 'ca', label: 'Canada', flag: '\u{1F1E8}\u{1F1E6}',
    dna: { 'hip-hop':84,'pop':84,'house':76,'rnb':78,'variete':56,'rap fr':58,'country':60,
           'edm':72,'disco':68,'rock':66 },
    langBias: { en:1.0, fr:0.75 },
    decades: { '2020':1.0,'2010':0.95,'2000':0.88,'1990':0.82,'1980':0.72 },
    avoid: [],
    tips: "Au Quebec, un titre francophone connu vaut deux tubes internationaux." }
];

/* ---------------- axe 2 : le type d'evenement ---------------- */
const EVENTS = [
  { id: 'club', label: 'Club', short: 'club',
    hours: ['23h','00h','01h','02h','03h','04h','05h','06h'],
    arc: [5,6,7,8,9,10,8,6],
    dna: { 'house':92,'techno':88,'tech house':92,'club':94,'edit':78,'disco':60,'afro house':70,
           'uk garage':74,'trance':62,'variete':10,'slow':4,'pop':38,'hip-hop':46,
           'rnb':32,'reggaeton':52,'latin pop':40,'minimal':72,'drum and bass':62,'funk':48 },
    moments: [
      { at: 0, label: 'Ouverture', brief: 'Deep et groove, la salle se remplit. Rien de connu.' },
      { at: 4, label: 'Pic', brief: 'Le gros du set, energie 9-10, pas de variete.' },
      { at: 6, label: 'Descente', brief: 'On relache pour garder les derniers.' }
    ],
    avoid: ['variete', 'slow', 'mariage'],
    tips: "Un edit maison passe mieux qu'un original trop identifie." },

  { id: 'mariage', label: 'Mariage', short: 'mariage',
    hours: ['19h','20h','21h','22h','23h','00h','01h','02h','03h'],
    arc: [3,3,4,6,8,9,9,7,5],
    dna: { 'hymne':94,'disco':86,'pop':84,'funk':76,'variete':82,'slow':64,'motown':78,
           'rnb':66,'house':56,'club':42,'techno':8,'trap':22,
           'hip-hop':54,'reggaeton':58,'latin pop':62,'rock':58,'eurodance':60,'minimal':6,'uk garage':30 },
    moments: [
      { at: 0, label: "Vin d'honneur", brief: 'Jazz, bossa, soul douce. On parle par-dessus.' },
      { at: 2, label: 'Dîner', brief: 'Volume bas, rien de dansant, aucun refrain connu.' },
      { at: 4, label: 'Ouverture de bal', brief: 'Le slow des maries, puis on enchaine vite.' },
      { at: 6, label: 'Pic', brief: 'Hymnes, toutes generations, personne ne s\'assoit.' },
      { at: 8, label: 'Fin de nuit', brief: 'Les 20 derniers, plus club.' }
    ],
    avoid: ['drill', 'hard techno', 'explicit'],
    tips: "Trois generations dans la salle : un titre par decennie toutes les quatre pistes." },

  { id: 'anniversaire', label: 'Anniversaire', short: 'anniv',
    hours: ['21h','22h','23h','00h','01h','02h','03h'],
    arc: [4,5,7,8,9,9,7],
    dna: { 'pop':86,'hip-hop':80,'disco':78,'hymne':82,'rnb':74,'house':70,'funk':70,
           'club':64,'variete':60,'techno':30,
           'reggaeton':70,'latin pop':66,'trap':62,'minimal':18,'slow':30 },
    moments: [
      { at: 0, label: 'Arrivees', brief: 'Ambiance, volume moyen, on laisse parler.' },
      { at: 2, label: 'Ca part', brief: 'Premiers refrains connus, tout le monde debout.' },
      { at: 4, label: 'Pic', brief: 'Hymnes et gros singalongs.' },
      { at: 6, label: 'Fin', brief: 'On descend doucement.' }
    ],
    avoid: ['hard techno'],
    tips: "Demander trois titres a la personne fetee et les placer au pic : effet garanti." },

  { id: 'privee', label: 'Soirée privée', short: 'privee',
    hours: ['21h','22h','23h','00h','01h','02h','03h','04h'],
    arc: [4,5,6,7,8,9,8,6],
    dna: { 'house':84,'disco':82,'funk':78,'hip-hop':72,'pop':70,'tech house':70,'afro house':68,
           'rnb':66,'club':70,'variete':40,
           'reggaeton':64,'latin pop':60,'minimal':46,'slow':20,'hymne':60 },
    moments: [
      { at: 0, label: 'Debut', brief: 'Disco et funk, ca met a l\'aise sans forcer.' },
      { at: 4, label: 'Coeur de soiree', brief: 'House et titres qui rassemblent.' },
      { at: 7, label: 'Fin', brief: 'Plus deep, pour ceux qui restent.' }
    ],
    avoid: ['hard techno'],
    tips: "Salon ou jardin : la basse porte mal, privilegier des morceaux qui tiennent en medium." },

  { id: 'corporate', label: 'Cocktail / entreprise', short: 'corporate',
    hours: ['18h','19h','20h','21h','22h','23h'],
    arc: [3,4,5,6,7,7],
    dna: { 'nu disco':84,'deep house':82,'funk':78,'jazz':70,'soul':76,'pop':66,'disco':74,
           'bossa':66,'house':70,'club':38,'trap':12,'techno':10,
           'hip-hop':34,'rnb':56,'reggaeton':30,'latin pop':44,'minimal':40,'hymne':30,'slow':40 },
    moments: [
      { at: 0, label: 'Accueil', brief: 'Jazz, soul, bossa. Le fond, pas le devant.' },
      { at: 2, label: 'Discours', brief: 'Coupure ou volume tres bas.' },
      { at: 3, label: 'Cocktail', brief: 'Nu disco et deep, on peut bouger sans danser.' },
      { at: 5, label: 'Bascule', brief: 'Si la salle veut danser : disco puis house.' }
    ],
    avoid: ['explicit', 'drill', 'hard techno'],
    tips: "Aucun texte explicite : c'est le seul contexte ou une parole rate tout." },

  { id: 'festival', label: 'Festival / plein air', short: 'festival',
    hours: ['16h','17h','18h','19h','20h','21h','22h','23h'],
    arc: [6,7,8,9,9,10,9,8],
    dna: { 'house':88,'tech house':88,'techno':84,'edm':78,'afro house':78,'disco':66,
           'club':86,'trance':70,'edit':76,'slow':2,
           'hip-hop':58,'reggaeton':60,'latin pop':50,'minimal':62,'hymne':52,'pop':52 },
    moments: [
      { at: 0, label: 'Jour', brief: 'Groove lisible, la foule circule.' },
      { at: 3, label: 'Coucher de soleil', brief: 'Le creneau qui marque : melodique et large.' },
      { at: 5, label: 'Pic', brief: 'Plein regime, pas de creux.' }
    ],
    avoid: ['variete', 'slow'],
    tips: "En plein air les aigus se perdent : les morceaux trop fins passent inapercus." },

  { id: 'bar', label: 'Bar / restaurant', short: 'bar',
    hours: ['19h','20h','21h','22h','23h','00h'],
    arc: [3,4,5,6,7,7],
    dna: { 'nu disco':82,'deep house':80,'soul':80,'funk':78,'jazz':72,'bossa':70,'disco':74,
           'rnb':66,'pop':60,'club':34,'techno':8,
           'hip-hop':40,'reggaeton':36,'latin pop':52,'minimal':46,'hymne':24,'slow':46 },
    moments: [
      { at: 0, label: 'Service', brief: 'On accompagne, on ne prend pas la place.' },
      { at: 3, label: 'Apres le service', brief: 'On monte, les tables se vident.' },
      { at: 5, label: 'Fin', brief: 'Presque club, si le lieu le permet.' }
    ],
    avoid: ['hard techno', 'drill'],
    tips: "Le volume decide de tout : au-dessus d'un certain seuil, les gens partent." },

  { id: 'after', label: 'After', short: 'after',
    hours: ['05h','06h','07h','08h','09h','10h'],
    arc: [7,7,8,8,7,6],
    dna: { 'minimal':88,'deep house':86,'techno':80,'dub techno':78,'tech house':76,
           'progressive':74,'club':70,'hymne':6,'variete':2,'pop':10,
           'hip-hop':6,'reggaeton':6,'latin pop':6,'uk garage':40,'funk':10,'disco':20,'edit':40 },
    moments: [
      { at: 0, label: 'Reprise', brief: 'Hypnotique, on ne relance pas trop vite.' },
      { at: 2, label: 'Plateau', brief: 'On tient le meme niveau tres longtemps.' },
      { at: 4, label: 'Sortie', brief: 'On adoucit sans casser.' }
    ],
    avoid: ['hymne', 'variete', 'pop'],
    tips: "Personne ne veut de surprise a 7 h : la continuite vaut mieux que les pics." }
];

/* ---------------- composition des deux axes ---------------- */
const LEGACY = { wedding: 'mariage', fiesta: 'privee', party: 'privee' };

const byCountry = id => COUNTRIES.find(c => c.id === id) || COUNTRIES[0];
const byEvent = id => EVENTS.find(e => e.id === LEGACY[id] || e.id === id) || EVENTS[0];

/**
 * Un genre doit fonctionner sur les DEUX axes pour remonter :
 * moyenne geometrique. Le techno allemand reste haut en club,
 * retombe en mariage ; la variete francaise fait l'inverse.
 */
function compose(countryId, eventId) {
  const c = byCountry(countryId), e = byEvent(eventId);
  const dna = {};
  for (const k of new Set(Object.keys(c.dna).concat(Object.keys(e.dna)))) {
    const cv = c.dna[k], ev = e.dna[k];
    /* Les deux axes se prononcent : il faut que ca marche des deux cotes.
       Un seul se prononce : on garde son avis, a peine attenue — sinon le
       funk carioca d'un anniversaire bresilien se ferait doubler par la
       house, presente partout et donc jamais discriminante. */
    dna[k] = cv != null && ev != null ? Math.round(Math.sqrt(cv * ev))
           : Math.round((cv != null ? cv : ev) * NO_OPINION);
  }
  const avoid = Array.from(new Set(c.avoid.concat(e.avoid)));
  for (const k of avoid) if (dna[k] != null) dna[k] = Math.min(dna[k], 8);

  return {
    id: c.id + '-' + e.id,
    country: c.id, event: e.id,
    label: c.label + ' — ' + e.label,
    short: c.id.toUpperCase() + ' ' + e.short,
    flag: c.flag,
    hours: e.hours, arc: e.arc, moments: e.moments,
    dna: dna, avoid: avoid,
    langBias: c.langBias, decades: c.decades,
    tips: e.tips + ' ' + c.tips
  };
}

/** Accepte "fr-club", "us-wedding" (ancien), ou rien. */
function byId(id) {
  const s = String(id || 'fr-club');
  const i = s.indexOf('-');
  return i < 0 ? compose(s, 'club') : compose(s.slice(0, i), s.slice(i + 1));
}

/** Les combinaisons les plus courantes, pour un acces direct. */
const PACKS = ['fr-club', 'fr-mariage', 'us-mariage', 'uk-club', 'es-privee', 'de-club'].map(byId);

function blendDNA(pack, guestDNA, weight) {
  weight = weight == null ? 0.5 : weight;      // 0 = pack seul, 1 = invites seuls
  const out = {};
  for (const k of Object.keys(pack.dna)) out[k] = pack.dna[k] * (1 - weight);
  for (const k of Object.keys(guestDNA || {})) out[k] = (out[k] || 0) + guestDNA[k] * weight;
  return out;
}

module.exports = { COUNTRIES, EVENTS, PACKS, compose, byId, blendDNA };
