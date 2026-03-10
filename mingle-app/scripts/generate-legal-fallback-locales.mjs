#!/usr/bin/env node

// Run with:
//   node --experimental-strip-types scripts/generate-legal-fallback-locales.mjs

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generatedLocaleDictionaries } from "../src/i18n/dictionaries/generated.ts";

const ROOT = process.cwd();
const LEGAL_ROOT = path.join(ROOT, "public", "legal");
const LAST_UPDATED_DATE = "February 26, 2026";

const ALL_LOCALES = [
  { code: "ko", path: "ko", name: "Korean", lang: "ko", dir: "ltr" },
  { code: "en", path: "en", name: "English", lang: "en", dir: "ltr" },
  { code: "ja", path: "ja", name: "Japanese", lang: "ja", dir: "ltr" },
  { code: "zh-CN", path: "zh-cn", name: "Chinese (Simplified)", lang: "zh-CN", dir: "ltr" },
  { code: "zh-TW", path: "zh-tw", name: "Chinese (Traditional)", lang: "zh-TW", dir: "ltr" },
  { code: "fr", path: "fr", name: "French", lang: "fr", dir: "ltr" },
  { code: "de", path: "de", name: "German", lang: "de", dir: "ltr" },
  { code: "es", path: "es", name: "Spanish", lang: "es", dir: "ltr" },
  { code: "pt", path: "pt", name: "Portuguese", lang: "pt", dir: "ltr" },
  { code: "it", path: "it", name: "Italian", lang: "it", dir: "ltr" },
  { code: "ru", path: "ru", name: "Russian", lang: "ru", dir: "ltr" },
  { code: "ar", path: "ar", name: "Arabic", lang: "ar", dir: "rtl" },
  { code: "af", path: "af", name: "Afrikaans", lang: "af", dir: "ltr" },
  { code: "sq", path: "sq", name: "Albanian", lang: "sq", dir: "ltr" },
  { code: "az", path: "az", name: "Azerbaijani", lang: "az", dir: "ltr" },
  { code: "eu", path: "eu", name: "Basque", lang: "eu", dir: "ltr" },
  { code: "be", path: "be", name: "Belarusian", lang: "be", dir: "ltr" },
  { code: "bn", path: "bn", name: "Bengali", lang: "bn", dir: "ltr" },
  { code: "bs", path: "bs", name: "Bosnian", lang: "bs", dir: "ltr" },
  { code: "bg", path: "bg", name: "Bulgarian", lang: "bg", dir: "ltr" },
  { code: "ca", path: "ca", name: "Catalan", lang: "ca", dir: "ltr" },
  { code: "hr", path: "hr", name: "Croatian", lang: "hr", dir: "ltr" },
  { code: "cs", path: "cs", name: "Czech", lang: "cs", dir: "ltr" },
  { code: "da", path: "da", name: "Danish", lang: "da", dir: "ltr" },
  { code: "nl", path: "nl", name: "Dutch", lang: "nl", dir: "ltr" },
  { code: "et", path: "et", name: "Estonian", lang: "et", dir: "ltr" },
  { code: "fi", path: "fi", name: "Finnish", lang: "fi", dir: "ltr" },
  { code: "gl", path: "gl", name: "Galician", lang: "gl", dir: "ltr" },
  { code: "el", path: "el", name: "Greek", lang: "el", dir: "ltr" },
  { code: "gu", path: "gu", name: "Gujarati", lang: "gu", dir: "ltr" },
  { code: "he", path: "he", name: "Hebrew", lang: "he", dir: "rtl" },
  { code: "hi", path: "hi", name: "Hindi", lang: "hi", dir: "ltr" },
  { code: "hu", path: "hu", name: "Hungarian", lang: "hu", dir: "ltr" },
  { code: "id", path: "id", name: "Indonesian", lang: "id", dir: "ltr" },
  { code: "kn", path: "kn", name: "Kannada", lang: "kn", dir: "ltr" },
  { code: "kk", path: "kk", name: "Kazakh", lang: "kk", dir: "ltr" },
  { code: "th", path: "th", name: "Thai", lang: "th", dir: "ltr" },
  { code: "lv", path: "lv", name: "Latvian", lang: "lv", dir: "ltr" },
  { code: "lt", path: "lt", name: "Lithuanian", lang: "lt", dir: "ltr" },
  { code: "mk", path: "mk", name: "Macedonian", lang: "mk", dir: "ltr" },
  { code: "ms", path: "ms", name: "Malay", lang: "ms", dir: "ltr" },
  { code: "ml", path: "ml", name: "Malayalam", lang: "ml", dir: "ltr" },
  { code: "mr", path: "mr", name: "Marathi", lang: "mr", dir: "ltr" },
  { code: "no", path: "no", name: "Norwegian", lang: "no", dir: "ltr" },
  { code: "fa", path: "fa", name: "Persian", lang: "fa", dir: "rtl" },
  { code: "pl", path: "pl", name: "Polish", lang: "pl", dir: "ltr" },
  { code: "pa", path: "pa", name: "Punjabi", lang: "pa", dir: "ltr" },
  { code: "ro", path: "ro", name: "Romanian", lang: "ro", dir: "ltr" },
  { code: "sr", path: "sr", name: "Serbian", lang: "sr", dir: "ltr" },
  { code: "sk", path: "sk", name: "Slovak", lang: "sk", dir: "ltr" },
  { code: "sl", path: "sl", name: "Slovenian", lang: "sl", dir: "ltr" },
  { code: "sw", path: "sw", name: "Swahili", lang: "sw", dir: "ltr" },
  { code: "sv", path: "sv", name: "Swedish", lang: "sv", dir: "ltr" },
  { code: "tl", path: "tl", name: "Tagalog", lang: "tl", dir: "ltr" },
  { code: "ta", path: "ta", name: "Tamil", lang: "ta", dir: "ltr" },
  { code: "te", path: "te", name: "Telugu", lang: "te", dir: "ltr" },
  { code: "tr", path: "tr", name: "Turkish", lang: "tr", dir: "ltr" },
  { code: "uk", path: "uk", name: "Ukrainian", lang: "uk", dir: "ltr" },
  { code: "ur", path: "ur", name: "Urdu", lang: "ur", dir: "rtl" },
  { code: "vi", path: "vi", name: "Vietnamese", lang: "vi", dir: "ltr" },
  { code: "cy", path: "cy", name: "Welsh", lang: "cy", dir: "ltr" },
];

const FULL_TRANSLATION_CODES = new Set([
  "ko",
  "en",
  "ja",
  "zh-CN",
  "zh-TW",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
  "ar",
  "hi",
  "th",
  "vi",
]);

const FALLBACK_NOTICE_COPY = {
  af: "'n Volledig gelokaliseerde regsdokument word voorberei. Die gedetailleerde regstekst hieronder is tans in Engels beskikbaar. As u hulp nodig het om dit te verstaan, kontak legal@minglelabs.app.",
  sq: "Një version ligjor plotësisht i lokalizuar është duke u përgatitur. Teksti i plotë ligjor më poshtë ofrohet aktualisht në anglisht. Nëse keni nevojë për ndihmë për ta kuptuar, kontaktoni legal@minglelabs.app.",
  az: "Tam lokallaşdırılmış hüquqi versiya hazırlanır. Aşağıdakı ətraflı hüquqi mətn hazırda ingilis dilində təqdim olunur. Onu anlamaqda köməyə ehtiyacınız varsa, legal@minglelabs.app ilə əlaqə saxlayın.",
  eu: "Erabat lokalizatutako lege-bertsio bat prestatzen ari gara. Beheko lege-testu zehatza une honetan ingelesez dago. Hura ulertzeko laguntza behar baduzu, jarri harremanetan legal@minglelabs.app helbidearekin.",
  be: "Поўнасцю лакалізаваная юрыдычная версія рыхтуецца. Падрабязны юрыдычны тэкст ніжэй пакуль даступны англійскай мовай. Калі вам патрэбна дапамога з разуменнем, напішыце на legal@minglelabs.app.",
  bn: "একটি সম্পূর্ণ স্থানীয়কৃত আইনগত সংস্করণ প্রস্তুত করা হচ্ছে। নিচের বিস্তারিত আইনগত পাঠ্যটি বর্তমানে ইংরেজিতে দেওয়া আছে। এটি বুঝতে সাহায্য প্রয়োজন হলে legal@minglelabs.app এ যোগাযোগ করুন।",
  bs: "Potpuno lokalizovana pravna verzija se priprema. Detaljni pravni tekst u nastavku je trenutno dostupan na engleskom. Ako vam je potrebna pomoć da ga razumijete, kontaktirajte legal@minglelabs.app.",
  bg: "Подготвя се напълно локализирана правна версия. Подробният правен текст по-долу в момента е предоставен на английски. Ако имате нужда от помощ, за да го разберете, свържете се с legal@minglelabs.app.",
  ca: "S'està preparant una versió legal totalment localitzada. El text legal detallat següent es mostra actualment en anglès. Si necessiteu ajuda per entendre'l, contacteu amb legal@minglelabs.app.",
  hr: "Priprema se potpuno lokalizirana pravna verzija. Detaljni pravni tekst u nastavku trenutačno je dostupan na engleskom. Ako trebate pomoć da ga razumijete, javite se na legal@minglelabs.app.",
  cs: "Připravujeme plně lokalizovanou právní verzi. Podrobný právní text níže je zatím k dispozici v angličtině. Pokud potřebujete pomoc s porozuměním, kontaktujte legal@minglelabs.app.",
  da: "En fuldt lokaliseret juridisk version er under udarbejdelse. Den detaljerede juridiske tekst nedenfor er i øjeblikket tilgængelig på engelsk. Hvis du har brug for hjælp til at forstå den, kontakt legal@minglelabs.app.",
  nl: "Er wordt gewerkt aan een volledig gelokaliseerde juridische versie. De gedetailleerde juridische tekst hieronder is momenteel beschikbaar in het Engels. Als u hulp nodig heeft om deze te begrijpen, neem dan contact op met legal@minglelabs.app.",
  et: "Täielikult lokaliseeritud juriidiline versioon on ettevalmistamisel. Allpool olev üksikasjalik juriidiline tekst on praegu saadaval inglise keeles. Kui vajate selle mõistmisel abi, võtke ühendust aadressil legal@minglelabs.app.",
  fi: "Täysin lokalisoitua oikeudellista versiota valmistellaan. Alla oleva yksityiskohtainen oikeudellinen teksti on tällä hetkellä saatavilla englanniksi. Jos tarvitset apua sen ymmärtämisessä, ota yhteyttä osoitteeseen legal@minglelabs.app.",
  gl: "Estase preparando unha versión legal totalmente localizada. O texto legal detallado de abaixo está dispoñible polo de agora en inglés. Se precisa axuda para entendelo, contacte con legal@minglelabs.app.",
  el: "Ετοιμάζεται μια πλήρως μεταφρασμένη νομική έκδοση. Το αναλυτικό νομικό κείμενο παρακάτω παρέχεται προς το παρόν στα αγγλικά. Αν χρειάζεστε βοήθεια για να το κατανοήσετε, επικοινωνήστε με το legal@minglelabs.app.",
  gu: "પૂર્ણ રીતે સ્થાનિકીકૃત કાનૂની આવૃત્તિ તૈયાર થઈ રહી છે. નીચેનો વિગતવાર કાનૂની લખાણ હાલમાં અંગ્રેજીમાં આપવામાં આવ્યો છે. તેને સમજવામાં મદદ જોઈએ તો legal@minglelabs.app પર સંપર્ક કરો.",
  he: "גרסה משפטית מקומית מלאה נמצאת בהכנה. הטקסט המשפטי המפורט שלהלן זמין כרגע באנגלית. אם אתם צריכים עזרה בהבנתו, פנו אל legal@minglelabs.app.",
  hu: "Egy teljesen lokalizált jogi változat előkészítés alatt áll. Az alábbi részletes jogi szöveg jelenleg angolul érhető el. Ha segítségre van szüksége a megértéséhez, írjon a legal@minglelabs.app címre.",
  id: "Versi hukum yang sepenuhnya dilokalkan sedang disiapkan. Teks hukum terperinci di bawah ini saat ini tersedia dalam bahasa Inggris. Jika Anda memerlukan bantuan untuk memahaminya, hubungi legal@minglelabs.app.",
  kn: "ಪೂರ್ಣವಾಗಿ ಸ್ಥಳೀಕರಿಸಿದ ಕಾನೂನು ಆವೃತ್ತಿಯನ್ನು ತಯಾರಿಸಲಾಗುತ್ತಿದೆ. ಕೆಳಗಿನ ವಿವರವಾದ ಕಾನೂನು ಪಠ್ಯವು ಈಗ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಲಭ್ಯವಿದೆ. ಅದನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ಸಹಾಯ ಬೇಕಿದ್ದರೆ legal@minglelabs.app ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.",
  kk: "Толық жергіліктендірілген құқықтық нұсқа дайындалып жатыр. Төмендегі толық құқықтық мәтін әзірге ағылшын тілінде берілген. Оны түсінуге көмек қажет болса, legal@minglelabs.app мекенжайына жазыңыз.",
  lv: "Tiek gatavota pilnībā lokalizēta juridiskā versija. Zemāk esošais detalizētais juridiskais teksts pašlaik ir pieejams angļu valodā. Ja jums nepieciešama palīdzība tā izpratnē, sazinieties ar legal@minglelabs.app.",
  lt: "Rengiama visiškai lokalizuota teisinė versija. Toliau pateiktas išsamus teisinis tekstas šiuo metu pateikiamas anglų kalba. Jei reikia pagalbos jį suprasti, susisiekite su legal@minglelabs.app.",
  mk: "Се подготвува целосно локализирана правна верзија. Деталниот правен текст подолу моментално е достапен на англиски јазик. Ако ви треба помош за да го разберете, контактирајте со legal@minglelabs.app.",
  ms: "Versi undang-undang yang diterjemah sepenuhnya sedang disediakan. Teks undang-undang terperinci di bawah kini tersedia dalam bahasa Inggeris. Jika anda memerlukan bantuan untuk memahaminya, hubungi legal@minglelabs.app.",
  ml: "പൂർണ്ണമായി പ്രാദേശികവത്കരിച്ച നിയമ പതിപ്പ് തയ്യാറാകുകയാണ്. താഴെയുള്ള വിശദമായ നിയമ പാഠം ഇപ്പോൾ ഇംഗ്ലീഷിലാണ് നൽകിയിരിക്കുന്നത്. അത് മനസ്സിലാക്കാൻ സഹായം വേണമെങ്കിൽ legal@minglelabs.app ലേക്ക് ബന്ധപ്പെടുക.",
  mr: "पूर्णपणे स्थानिकीकृत कायदेशीर आवृत्ती तयार केली जात आहे. खालील सविस्तर कायदेशीर मजकूर सध्या इंग्रजीत उपलब्ध आहे. तो समजण्यासाठी मदत हवी असल्यास legal@minglelabs.app वर संपर्क साधा.",
  no: "En fullt lokalisert juridisk versjon er under utarbeidelse. Den detaljerte juridiske teksten nedenfor er foreløpig tilgjengelig på engelsk. Hvis du trenger hjelp til å forstå den, kontakt legal@minglelabs.app.",
  fa: "یک نسخه حقوقی کاملاً بومی‌سازی‌شده در حال آماده‌سازی است. متن حقوقی کامل زیر در حال حاضر به زبان انگلیسی ارائه می‌شود. اگر برای درک آن به کمک نیاز دارید، با legal@minglelabs.app تماس بگیرید.",
  pl: "Przygotowujemy w pełni zlokalizowaną wersję prawną. Szczegółowy tekst prawny poniżej jest obecnie dostępny w języku angielskim. Jeśli potrzebują Państwo pomocy w jego zrozumieniu, prosimy o kontakt pod adresem legal@minglelabs.app.",
  pa: "ਇੱਕ ਪੂਰੀ ਤਰ੍ਹਾਂ ਸਥਾਨਕੀਕ੍ਰਿਤ ਕਾਨੂੰਨੀ ਸੰਸਕਰਣ ਤਿਆਰ ਕੀਤਾ ਜਾ ਰਿਹਾ ਹੈ। ਹੇਠਾਂ ਦਿੱਤਾ ਵਿਸਤ੍ਰਿਤ ਕਾਨੂੰਨੀ ਲਿਖਤ ਇਸ ਵੇਲੇ ਅੰਗਰੇਜ਼ੀ ਵਿੱਚ ਉਪਲਬਧ ਹੈ। ਇਸ ਨੂੰ ਸਮਝਣ ਲਈ ਮਦਦ ਚਾਹੀਦੀ ਹੋਵੇ ਤਾਂ legal@minglelabs.app ਤੇ ਸੰਪਰਕ ਕਰੋ।",
  ro: "O versiune juridică complet localizată este în curs de pregătire. Textul juridic detaliat de mai jos este disponibil în prezent în limba engleză. Dacă aveți nevoie de ajutor pentru a-l înțelege, contactați legal@minglelabs.app.",
  sr: "Потпуно локализована правна верзија је у припреми. Детаљни правни текст испод је тренутно доступан на енглеском. Ако вам је потребна помоћ да га разумете, контактирајте legal@minglelabs.app.",
  sk: "Pripravuje sa plne lokalizovaná právna verzia. Podrobný právny text nižšie je zatiaľ k dispozícii v angličtine. Ak potrebujete pomoc s jeho porozumením, kontaktujte legal@minglelabs.app.",
  sl: "Pripravlja se popolnoma lokalizirana pravna različica. Podrobno pravno besedilo spodaj je trenutno na voljo v angleščini. Če potrebujete pomoč pri razumevanju, pišite na legal@minglelabs.app.",
  sw: "Toleo la kisheria lililotafsiriwa kikamilifu linaandaliwa. Maandishi ya kina ya kisheria hapa chini yanapatikana kwa sasa kwa Kiingereza. Ukihitaji msaada wa kuyaelewa, wasiliana na legal@minglelabs.app.",
  sv: "En fullt lokaliserad juridisk version håller på att tas fram. Den detaljerade juridiska texten nedan finns för närvarande på engelska. Om du behöver hjälp att förstå den, kontakta legal@minglelabs.app.",
  tl: "Inihahanda pa ang ganap na naka-localize na legal na bersyon. Ang detalyadong legal na teksto sa ibaba ay kasalukuyang ibinibigay sa Ingles. Kung kailangan ninyo ng tulong upang maunawaan ito, makipag-ugnayan sa legal@minglelabs.app.",
  ta: "முழுமையாக உள்ளூர்மயமாக்கப்பட்ட சட்ட பதிப்பு தயாராகி வருகிறது. கீழே உள்ள விரிவான சட்ட உரை தற்போது ஆங்கிலத்தில் வழங்கப்படுகிறது. அதை புரிந்துகொள்ள உதவி தேவைப்பட்டால் legal@minglelabs.app ஐ தொடர்புகொள்ளவும்.",
  te: "పూర్తిగా స్థానికీకరించిన న్యాయ సంచిక సిద్ధమవుతోంది. క్రింద ఉన్న సవివర న్యాయ పాఠ్యం ప్రస్తుతం ఆంగ్లంలో అందుబాటులో ఉంది. దాన్ని అర్థం చేసుకోవడానికి సహాయం అవసరమైతే legal@minglelabs.app ను సంప్రదించండి.",
  tr: "Tamamen yerelleştirilmiş bir hukuki sürüm hazırlanmaktadır. Aşağıdaki ayrıntılı hukuki metin şu anda İngilizce olarak sunulmaktadır. Bunu anlamak için yardıma ihtiyacınız varsa legal@minglelabs.app ile iletişime geçin.",
  uk: "Повністю локалізована юридична версія готується. Детальний юридичний текст нижче наразі доступний англійською мовою. Якщо вам потрібна допомога з його розумінням, зверніться на legal@minglelabs.app.",
  ur: "ایک مکمل طور پر مقامی زبان میں قانونی ورژن تیار کیا جا رہا ہے۔ نیچے دیا گیا تفصیلی قانونی متن فی الحال انگریزی میں دستیاب ہے۔ اگر اسے سمجھنے میں مدد چاہیے تو legal@minglelabs.app سے رابطہ کریں۔",
  cy: "Mae fersiwn gyfreithiol wedi'i lleoleiddio'n llawn yn cael ei pharatoi. Mae'r testun cyfreithiol manwl isod ar gael yn Saesneg ar hyn o bryd. Os oes angen help arnoch i'w ddeall, cysylltwch â legal@minglelabs.app.",
};

const privacyDoc = {
  key: "privacy",
  fileName: "privacy-policy.html",
  description: "How Mingle handles personal data for mobile and web services.",
  intro:
    'This Privacy Policy explains how Mingle Labs, Inc. ("Mingle," "we," "our," or "us") collects, uses, shares, and protects personal data when you use the Mingle mobile app, website, and related services (collectively, the "Service").',
  sections: [
    {
      heading: "1. Scope",
      paragraphs: [
        "This Policy applies to information processed for consumer Mingle accounts and usage. It does not apply to data we process solely on behalf of enterprise customers under separate contracts.",
      ],
    },
    {
      heading: "2. Information We Collect",
      list: [
        "Account Information: name, email address, sign-in provider details, account identifiers, and profile preferences.",
        "Translation and Voice Data: text you submit for translation, voice/audio input needed to provide speech recognition and translation, translated output, and language settings.",
        "Technical and Usage Data: device type, operating system, app version, IP address, request timestamps, crash logs, performance logs, and feature interaction events.",
        "Support Communications: messages and attachments you send to us when requesting help.",
      ],
    },
    {
      heading: "3. Audio Processing and Non-Retention",
      paragraphs: [
        "Mingle processes microphone audio in real time to provide speech recognition and translation. Raw audio is streamed for processing and is not stored by Mingle after the request is completed.",
        "Mingle does not keep a retained archive of raw voice recordings for model training. We may keep limited non-audio technical diagnostics (for example, error codes and timing metrics) for security, abuse prevention, and service reliability.",
      ],
    },
    {
      heading: "4. How We Use Personal Data",
      list: [
        "Provide, maintain, and improve real-time translation features.",
        "Authenticate users and secure user sessions.",
        "Detect abuse, fraud, and security incidents.",
        "Monitor reliability, debug failures, and improve service quality.",
        "Communicate product updates, support responses, and policy changes.",
        "Comply with legal obligations and enforce our Terms of Use.",
      ],
    },
    {
      heading: "5. Legal Bases (EEA/UK)",
      paragraphs: [
        "Where required by law, we rely on one or more legal bases: performance of a contract, legitimate interests (for security and service improvement), legal obligations, and consent (for specific optional processing where requested).",
      ],
    },
    {
      heading: "6. How We Share Information",
      paragraphs: ["We do not sell personal data. We may share data with:"],
      list: [
        "Service Providers: hosting, storage, authentication, customer support, analytics, crash reporting, and other infrastructure vendors that process data under contract.",
        "Soniox: audio stream and related context needed for speech-to-text processing.",
        "Inworld: text and language context needed for voice generation features and synthesized audio delivery.",
        "Google: account authentication and text-based service operations where used. Mingle does not send raw voice audio to Google for speech processing.",
        "Legal/Safety Requests: when required by law or necessary to protect rights, safety, and security.",
        "Corporate Transactions: in connection with merger, financing, acquisition, bankruptcy, or asset transfer.",
      ],
    },
    {
      heading: "7. International Data Transfers",
      paragraphs: [
        "Your data may be processed in countries other than your own. Where required, we use contractual and organizational safeguards designed to protect transferred data.",
      ],
    },
    {
      heading: "8. Retention",
      paragraphs: [
        "We keep personal data only as long as needed for the purposes described in this Policy, including to provide the Service, resolve disputes, maintain security, and meet legal requirements.",
        "For clarity, raw microphone audio used for real-time translation is not stored as a retained user-content archive.",
      ],
    },
    {
      heading: "9. Security",
      paragraphs: [
        "We use commercially reasonable technical and organizational safeguards, including access controls and encryption in transit. No method of transmission or storage is completely secure; therefore, absolute security cannot be guaranteed.",
      ],
    },
    {
      heading: "10. Your Rights and Choices",
      paragraphs: ["Depending on your location, you may have rights to:"],
      list: [
        "access, correct, or delete personal data;",
        "request a copy of data (data portability);",
        "restrict or object to certain processing; and",
        "withdraw consent where processing is based on consent.",
      ],
      tailParagraph:
        "You can submit requests by contacting us at legal@minglelabs.app.",
    },
    {
      heading: "11. Children",
      paragraphs: [
        "The Service is not directed to children under 13 (or the equivalent minimum age in your jurisdiction). If we learn we collected personal data from a child without valid permission, we will delete the data as required by law.",
      ],
    },
    {
      heading: "12. Third-Party Services",
      paragraphs: [
        "The Service may contain links or integrations to third-party services. Their privacy practices are governed by their own policies.",
      ],
    },
    {
      heading: "13. Changes to This Policy",
      paragraphs: [
        'We may update this Privacy Policy from time to time. We will post the updated version on this page and update the "Last updated" date.',
      ],
    },
    {
      heading: "14. Contact",
      paragraphs: [
        "Mingle Labs, Inc. (Republic of Korea)",
        "Email: legal@minglelabs.app",
        "Website: https://app.minglelabs.xyz",
      ],
    },
  ],
};

const termsDoc = {
  key: "terms",
  fileName: "terms-of-use.html",
  description: "Terms of Use for Mingle mobile and web translation services.",
  intro:
    'These Terms of Use ("Terms") govern your use of Mingle services provided by Mingle Labs, Inc. ("Mingle," "we," "our," or "us"), a company organized under the laws of the Republic of Korea. By using the Service, you agree to these Terms.',
  sections: [
    {
      heading: "1. Eligibility and Account",
      list: [
        "You must be at least 13 years old (or the minimum digital consent age in your jurisdiction) to use the Service.",
        "You must provide accurate account information and keep it up to date.",
        "You are responsible for all activity under your account credentials.",
        "You must not share credentials in a way that compromises account security.",
      ],
    },
    {
      heading: "2. Service Description",
      paragraphs: [
        "Mingle provides translation-related features, including text translation, speech processing, and conversation assistance. Service availability, features, and supported languages may change.",
      ],
    },
    {
      heading: "3. Acceptable Use",
      paragraphs: ["You agree not to:"],
      list: [
        "violate laws, regulations, or third-party rights;",
        "upload harmful, illegal, infringing, or abusive content;",
        "attempt to reverse engineer, disrupt, or bypass security controls;",
        "use automated means to scrape or overload the Service; or",
        "use the Service to create or distribute malware, fraud, or spam.",
      ],
    },
    {
      heading: "4. User Content and License",
      list: [
        "You retain ownership of content you submit, subject to rights needed to operate and improve the Service.",
        "You grant Mingle a non-exclusive, worldwide, royalty-free license to host, process, transmit, and display your content solely for providing and supporting the Service.",
        "You represent that you have rights to submit the content and that processing it does not violate law or third-party rights.",
      ],
    },
    {
      heading: "5. Fees, Subscriptions, and Billing",
      paragraphs: [
        "Some features may be paid. Pricing and billing terms will be shown before purchase. If subscriptions are offered, they may renew automatically unless canceled according to the terms presented at purchase.",
      ],
    },
    {
      heading: "6. Third-Party Services",
      paragraphs: [
        "The Service may rely on third-party providers (for example cloud infrastructure, speech processing, payment systems, analytics, or authentication). Their separate terms may apply.",
      ],
    },
    {
      heading: "7. Suspension and Termination",
      paragraphs: [
        "We may suspend or terminate access if you violate these Terms, create legal or security risk, or misuse the Service. You may stop using the Service at any time.",
      ],
    },
    {
      heading: "8. Disclaimers",
      paragraphs: [
        'The Service is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, Mingle disclaims all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.',
        "Translation output is generated by automated systems and may contain errors, omissions, or ambiguities. You must not rely on translation output as the sole basis for legal, medical, safety-critical, or other high-risk decisions where accuracy is essential.",
      ],
    },
    {
      heading: "9. Limitation of Liability",
      paragraphs: [
        "To the fullest extent permitted by law, Mingle and its affiliates will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or loss of data, revenue, profits, or business opportunities.",
      ],
    },
    {
      heading: "10. Indemnification",
      paragraphs: [
        "You agree to indemnify and hold harmless Mingle from claims, losses, liabilities, and expenses arising from your misuse of the Service, your content, or your breach of these Terms.",
      ],
    },
    {
      heading: "11. Apple App Store Terms (iOS)",
      paragraphs: [
        "If you use Mingle on iOS, Apple Inc. is not responsible for the Service and has no obligation to provide maintenance or support. Your use of the iOS app is also subject to applicable App Store terms, including the standard Apple EULA: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/.",
      ],
    },
    {
      heading: "12. Governing Law and Jurisdiction",
      paragraphs: [
        "These Terms are governed by the laws of the Republic of Korea, without regard to conflict-of-law principles.",
        "Unless mandatory law provides otherwise, disputes arising out of or in connection with these Terms will be subject to the exclusive jurisdiction of the courts located in Seoul, Republic of Korea.",
      ],
    },
    {
      heading: "13. Changes to Terms",
      paragraphs: [
        "We may update these Terms from time to time. The updated version will be posted on this page with a revised date.",
      ],
    },
    {
      heading: "14. Contact",
      paragraphs: [
        "Mingle Labs, Inc. (Republic of Korea)",
        "Email: legal@minglelabs.app",
        "Website: https://app.minglelabs.xyz",
      ],
    },
  ],
};

const docs = [privacyDoc, termsDoc];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function linkify(value) {
  let escaped = escapeHtml(value);
  escaped = escaped.replaceAll(
    "legal@minglelabs.app",
    '<a href="mailto:legal@minglelabs.app">legal@minglelabs.app</a>',
  );
  escaped = escaped.replaceAll(
    "https://app.minglelabs.xyz",
    '<a href="https://app.minglelabs.xyz">https://app.minglelabs.xyz</a>',
  );
  escaped = escaped.replaceAll(
    "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
    '<a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer">https://www.apple.com/legal/internet-services/itunes/dev/stdeula/</a>',
  );
  return escaped;
}

function buildLanguageNav(docFileName, currentLocalePath) {
  const items = ALL_LOCALES
    .map((locale) => {
      const active = locale.path === currentLocalePath ? ' aria-current="page"' : "";
      return `<a href="/legal/${locale.path}/${docFileName}"${active}>${escapeHtml(locale.name)}</a>`;
    })
    .join("");
  return `<nav class="lang-nav">${items}</nav>`;
}

function renderEnglishSections(doc) {
  return doc.sections.map((section) => {
    const paragraphs = (section.paragraphs ?? [])
      .map((paragraph) => `<p>${linkify(paragraph)}</p>`)
      .join("\n");
    const list = (section.list ?? []).length
      ? `<ul>\n${section.list.map((item) => `  <li>${linkify(item)}</li>`).join("\n")}\n</ul>`
      : "";
    const tail = section.tailParagraph ? `<p>${linkify(section.tailParagraph)}</p>` : "";
    return `<h2>${linkify(section.heading)}</h2>\n${paragraphs}\n${list}\n${tail}`;
  }).join("\n");
}

function renderFallbackDocumentHtml(doc, locale, text) {
  const relatedPath = doc.key === "privacy" ? "terms-of-use.html" : "privacy-policy.html";
  const relatedTitle = doc.key === "privacy" ? text.termsTitle : text.privacyTitle;
  const title = doc.key === "privacy" ? text.privacyTitle : text.termsTitle;
  const sectionHtml = renderEnglishSections(doc);

  return `<!doctype html>
<html lang="${escapeHtml(locale.lang)}" dir="${escapeHtml(locale.dir)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(doc.description)}" />
    <link rel="icon" href="/favicon.ico" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(doc.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Mingle" />
    <meta property="og:image" content="/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(doc.description)}" />
    <meta name="twitter:image" content="/og-image.png" />
    <style>
      :root {
        --bg: #f6f7fb;
        --surface: #ffffff;
        --text: #141a24;
        --muted: #5a6475;
        --line: #dfe4ee;
        --accent: #0d6efd;
        --notice-bg: #fdf3d6;
        --notice-line: #e9c97c;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: var(--text);
        background: linear-gradient(180deg, #eef3ff 0%, var(--bg) 160px, var(--bg) 100%);
        line-height: 1.6;
      }

      main {
        max-width: 940px;
        margin: 32px auto;
        padding: 0 16px;
      }

      article {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 28px 24px;
        box-shadow: 0 8px 30px rgba(15, 40, 85, 0.06);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 2rem;
        line-height: 1.2;
      }

      h2 {
        margin-top: 30px;
        margin-bottom: 8px;
        font-size: 1.18rem;
      }

      p, li { font-size: 1rem; }

      .meta {
        margin: 0;
        color: var(--muted);
      }

      .notice {
        margin: 16px 0 20px;
        padding: 14px 16px;
        border: 1px solid var(--notice-line);
        border-radius: 12px;
        background: var(--notice-bg);
      }

      .notice p {
        margin: 0;
      }

      ul { margin-top: 8px; }

      a { color: var(--accent); }

      .legal-links {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
      }

      .lang-nav {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }

      .lang-nav a {
        text-decoration: none;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 10px;
        color: var(--text);
        background: #fff;
        font-size: 0.88rem;
      }

      .lang-nav a[aria-current="page"] {
        background: #0d6efd;
        color: #fff;
        border-color: #0d6efd;
      }

      @media (max-width: 640px) {
        main { margin: 16px auto; }
        article {
          padding: 20px 16px;
          border-radius: 12px;
        }
        h1 { font-size: 1.7rem; }
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        ${buildLanguageNav(doc.fileName, locale.path)}
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">${escapeHtml(LAST_UPDATED_DATE)}</p>
        <div class="notice">
          <p>${linkify(text.notice)}</p>
        </div>
        <p>${linkify(doc.intro)}</p>
        ${sectionHtml}
        <p class="legal-links">
          <a href="/legal/${locale.path}/${relatedPath}">${escapeHtml(relatedTitle)}</a>
        </p>
      </article>
    </main>
  </body>
</html>`;
}

function renderIndexPage() {
  const rows = ALL_LOCALES.map((locale) => (
    `<tr><td>${escapeHtml(locale.name)}</td><td>${escapeHtml(locale.code)}</td><td><a href="/legal/${locale.path}/privacy-policy.html">Privacy Policy</a></td><td><a href="/legal/${locale.path}/terms-of-use.html">Terms of Use</a></td></tr>`
  )).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mingle Legal</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: #f6f8fd;
        color: #162033;
      }
      main {
        max-width: 960px;
        margin: 40px auto;
        padding: 0 16px 24px;
      }
      .card {
        background: #fff;
        border: 1px solid #dbe2ef;
        border-radius: 14px;
        padding: 24px;
      }
      h1 { margin-top: 0; }
      a { color: #0d6efd; }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border-bottom: 1px solid #e6ebf5;
        padding: 10px 8px;
        text-align: left;
        font-size: 0.95rem;
      }
      th { background: #f8faff; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Mingle Legal Documents</h1>
        <p>Supported language set (61 locales) for app legal pages.</p>
        <table>
          <thead>
            <tr><th>Language</th><th>Locale</th><th>Privacy</th><th>Terms</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

async function generate() {
  const fallbackLocales = ALL_LOCALES.filter((locale) => !FULL_TRANSLATION_CODES.has(locale.code));

  for (const locale of fallbackLocales) {
    const dictionary = generatedLocaleDictionaries[locale.code];
    if (!dictionary) {
      throw new Error(`Missing generated dictionary for locale ${locale.code}`);
    }

    const notice = FALLBACK_NOTICE_COPY[locale.code];
    if (!notice) {
      throw new Error(`Missing legal fallback notice copy for locale ${locale.code}`);
    }

    const text = {
      privacyTitle: dictionary.profile.privacyPolicyTitle,
      termsTitle: dictionary.profile.termsOfUseTitle,
      notice,
    };

    const localeDir = path.join(LEGAL_ROOT, locale.path);
    await mkdir(localeDir, { recursive: true });

    for (const doc of docs) {
      const html = renderFallbackDocumentHtml(doc, locale, text);
      await writeFile(path.join(localeDir, doc.fileName), html, "utf8");
    }
  }

  await writeFile(path.join(LEGAL_ROOT, "index.html"), renderIndexPage(), "utf8");
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
