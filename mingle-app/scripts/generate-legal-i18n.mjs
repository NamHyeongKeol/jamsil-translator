#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const LEGAL_ROOT = path.join(ROOT, "public", "legal");
const LAST_UPDATED_DATE = "February 26, 2026";

const locales = [
  { code: "en", path: "en", name: "English", lang: "en", dir: "ltr" },
  { code: "ko", path: "ko", name: "Korean", lang: "ko", dir: "ltr" },
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
  { code: "hi", path: "hi", name: "Hindi", lang: "hi", dir: "ltr" },
  { code: "th", path: "th", name: "Thai", lang: "th", dir: "ltr" },
  { code: "vi", path: "vi", name: "Vietnamese", lang: "vi", dir: "ltr" },
];

const privacyDoc = {
  key: "privacy",
  fileName: "privacy-policy.html",
  title: "Mingle Privacy Policy",
  description: "Privacy Policy for Mingle mobile and web services.",
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
      heading: "3. How We Use Personal Data",
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
      heading: "4. Legal Bases (EEA/UK)",
      paragraphs: [
        "Where required by law, we rely on one or more legal bases: performance of a contract, legitimate interests (for security and service improvement), legal obligations, and consent (for specific optional processing where requested).",
      ],
    },
    {
      heading: "5. How We Share Information",
      paragraphs: ["We do not sell personal data. We may share data with:"],
      list: [
        "Service Providers: hosting, analytics, storage, authentication, customer support, and infrastructure vendors that process data under contract.",
        "Legal/Safety Requests: when required by law or necessary to protect rights, safety, and security.",
        "Corporate Transactions: in connection with merger, financing, acquisition, bankruptcy, or asset transfer.",
      ],
    },
    {
      heading: "6. International Data Transfers",
      paragraphs: [
        "Your data may be processed in countries other than your own. Where required, we use contractual and organizational safeguards designed to protect transferred data.",
      ],
    },
    {
      heading: "7. Retention",
      paragraphs: [
        "We keep data only as long as needed for the purposes described in this Policy, including to provide the Service, resolve disputes, maintain security, and meet legal requirements.",
      ],
    },
    {
      heading: "8. Security",
      paragraphs: [
        "We use commercially reasonable technical and organizational safeguards, including access controls and encryption in transit. No method of transmission or storage is completely secure; therefore, absolute security cannot be guaranteed.",
      ],
    },
    {
      heading: "9. Your Rights and Choices",
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
      heading: "10. Children",
      paragraphs: [
        "The Service is not directed to children under 13 (or the equivalent minimum age in your jurisdiction). If we learn we collected personal data from a child without valid permission, we will delete the data as required by law.",
      ],
    },
    {
      heading: "11. Third-Party Services",
      paragraphs: [
        "The Service may contain links or integrations to third-party services. Their privacy practices are governed by their own policies.",
      ],
    },
    {
      heading: "12. Changes to This Policy",
      paragraphs: [
        'We may update this Privacy Policy from time to time. We will post the updated version on this page and update the "Last updated" date.',
      ],
    },
    {
      heading: "13. Contact",
      paragraphs: [
        "Mingle Labs, Inc.",
        "Email: legal@minglelabs.app",
        "Website: https://mingle-app-xi.vercel.app",
      ],
    },
  ],
  relatedLabel: "Related document:",
  relatedLinkText: "Mingle Terms of Use",
};

const termsDoc = {
  key: "terms",
  fileName: "terms-of-use.html",
  title: "Mingle Terms of Use",
  description: "Terms of Use for Mingle mobile and web services.",
  intro:
    'These Terms of Use ("Terms") govern your use of Mingle services provided by Mingle Labs, Inc. ("Mingle," "we," "our," or "us"). By using the Service, you agree to these Terms.',
  sections: [
    {
      heading: "1. Eligibility and Account",
      list: [
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
      heading: "12. Governing Law",
      paragraphs: [
        "These Terms are governed by applicable law in the jurisdiction where Mingle Labs, Inc. is incorporated, unless mandatory consumer protection law requires otherwise.",
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
        "Mingle Labs, Inc.",
        "Email: legal@minglelabs.app",
        "Website: https://mingle-app-xi.vercel.app",
      ],
    },
  ],
  relatedLabel: "Related document:",
  relatedLinkText: "Mingle Privacy Policy",
};

const docs = [privacyDoc, termsDoc];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function linkify(value) {
  const escaped = escapeHtml(value);
  if (escaped === "Email: legal@minglelabs.app") {
    return 'Email: <a href="mailto:legal@minglelabs.app">legal@minglelabs.app</a>';
  }
  if (escaped === "Website: https://mingle-app-xi.vercel.app") {
    return 'Website: <a href="https://mingle-app-xi.vercel.app">https://mingle-app-xi.vercel.app</a>';
  }
  if (escaped.includes("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")) {
    return escaped.replace(
      "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
      '<a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer">https://www.apple.com/legal/internet-services/itunes/dev/stdeula/</a>',
    );
  }
  return escaped;
}

function buildLanguageNav(docFileName, currentLocalePath) {
  const items = locales
    .map((locale) => {
      const active = locale.path === currentLocalePath ? " aria-current=\"page\"" : "";
      return `<a href="/legal/${locale.path}/${docFileName}"${active}>${escapeHtml(locale.name)}</a>`;
    })
    .join("");
  return `<nav class="lang-nav">${items}</nav>`;
}

function renderDocumentHtml(doc, locale, textMap) {
  const relatedHref =
    doc.key === "privacy"
      ? `/legal/${locale.path}/terms-of-use.html`
      : `/legal/${locale.path}/privacy-policy.html`;

  const sectionHtml = doc.sections
    .map((section, idx) => {
      const headingKey = `${doc.key}.section.${idx}.heading`;
      const paragraphKeys =
        section.paragraphs?.map((_, pIdx) => `${doc.key}.section.${idx}.p.${pIdx}`) ?? [];
      const listKeys =
        section.list?.map((_, lIdx) => `${doc.key}.section.${idx}.li.${lIdx}`) ?? [];
      const tailKey =
        section.tailParagraph != null
          ? `${doc.key}.section.${idx}.tail`
          : null;

      const paragraphs = paragraphKeys
        .map((key) => `<p>${linkify(textMap.get(key))}</p>`)
        .join("\n");

      const list = listKeys.length
        ? `<ul>\n${listKeys
            .map((key) => `  <li>${linkify(textMap.get(key))}</li>`)
            .join("\n")}\n</ul>`
        : "";

      const tail = tailKey ? `<p>${linkify(textMap.get(tailKey))}</p>` : "";

      return `<h2>${linkify(textMap.get(headingKey))}</h2>\n${paragraphs}\n${list}\n${tail}`;
    })
    .join("\n");

  const title = textMap.get(`${doc.key}.title`);
  const description = textMap.get(`${doc.key}.description`);
  const intro = textMap.get(`${doc.key}.intro`);
  const lastUpdated = textMap.get("meta.lastUpdated");
  const relatedLabel = textMap.get(`${doc.key}.relatedLabel`);
  const relatedLinkText = textMap.get(`${doc.key}.relatedLinkText`);

  return `<!doctype html>
<html lang="${escapeHtml(locale.lang)}" dir="${escapeHtml(locale.dir)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <style>
      :root {
        --bg: #f6f7fb;
        --surface: #ffffff;
        --text: #141a24;
        --muted: #5a6475;
        --line: #dfe4ee;
        --accent: #0d6efd;
      }

      * {
        box-sizing: border-box;
      }

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

      p,
      li {
        font-size: 1rem;
      }

      .meta {
        margin: 0;
        color: var(--muted);
      }

      ul {
        margin-top: 8px;
      }

      a {
        color: var(--accent);
      }

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
        main {
          margin: 16px auto;
        }

        article {
          padding: 20px 16px;
          border-radius: 12px;
        }

        h1 {
          font-size: 1.7rem;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        ${buildLanguageNav(doc.fileName, locale.path)}
        <h1>${linkify(title)}</h1>
        <p class="meta"><strong>${escapeHtml(lastUpdated)}</strong> ${escapeHtml(LAST_UPDATED_DATE)}</p>
        <p>${linkify(intro)}</p>
        ${sectionHtml}
        <p class="legal-links">
          ${escapeHtml(relatedLabel)}
          <a href="${relatedHref}">${escapeHtml(relatedLinkText)}</a>
        </p>
      </article>
    </main>
  </body>
</html>`;
}

function renderIndexPage() {
  const rows = locales
    .map(
      (locale) =>
        `<tr><td>${escapeHtml(locale.name)}</td><td>${escapeHtml(locale.code)}</td><td><a href="/legal/${locale.path}/privacy-policy.html">Privacy Policy</a></td><td><a href="/legal/${locale.path}/terms-of-use.html">Terms of Use</a></td></tr>`,
    )
    .join("\n");

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

      h1 {
        margin-top: 0;
      }

      a {
        color: #0d6efd;
      }

      table {
        border-collapse: collapse;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid #e6ebf5;
        padding: 10px 8px;
        text-align: left;
        font-size: 0.95rem;
      }

      th {
        background: #f8faff;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Mingle Legal Documents</h1>
        <p>Supported language set (15 locales) for App Store and user trust pages.</p>
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

function collectSegments() {
  const segments = [];
  const add = (key, value) => segments.push({ key, value });

  add("meta.lastUpdated", "Last updated:");
  for (const doc of docs) {
    add(`${doc.key}.title`, doc.title);
    add(`${doc.key}.description`, doc.description);
    add(`${doc.key}.intro`, doc.intro);
    add(`${doc.key}.relatedLabel`, doc.relatedLabel);
    add(`${doc.key}.relatedLinkText`, doc.relatedLinkText);
    doc.sections.forEach((section, sIdx) => {
      add(`${doc.key}.section.${sIdx}.heading`, section.heading);
      (section.paragraphs ?? []).forEach((p, pIdx) =>
        add(`${doc.key}.section.${sIdx}.p.${pIdx}`, p),
      );
      (section.list ?? []).forEach((li, lIdx) =>
        add(`${doc.key}.section.${sIdx}.li.${lIdx}`, li),
      );
      if (section.tailParagraph) {
        add(`${doc.key}.section.${sIdx}.tail`, section.tailParagraph);
      }
    });
  }

  return segments;
}

function flattenTranslatedBody(rawText, expectedCount) {
  const markerRe = /\[\[\[SEG_(\d+)\]\]\]/g;
  const markers = [...rawText.matchAll(markerRe)];
  if (markers.length !== expectedCount) {
    return null;
  }
  const result = new Map();
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const index = Number(current[1]);
    const start = (current.index ?? 0) + current[0].length;
    const end = next ? next.index ?? rawText.length : rawText.length;
    result.set(index, rawText.slice(start, end).trim());
  }
  return result;
}

async function translateSegments(targetLocale, segments) {
  if (targetLocale === "en") {
    return new Map(segments.map((segment) => [segment.key, segment.value]));
  }

  const body = segments
    .map((segment, index) => `[[[SEG_${index}]]]\n${segment.value}`)
    .join("\n");

  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=en&tl=${encodeURIComponent(targetLocale)}` +
    `&dt=t&q=${encodeURIComponent(body)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Translation request failed for ${targetLocale}: ${response.status}`);
  }

  const payload = await response.json();
  const translated = payload?.[0]?.map((item) => item?.[0] ?? "").join("") ?? "";
  const indexMap = flattenTranslatedBody(translated, segments.length);
  if (!indexMap) {
    throw new Error(`Could not parse translated payload for ${targetLocale}`);
  }

  const output = new Map();
  segments.forEach((segment, index) => {
    output.set(segment.key, indexMap.get(index) ?? segment.value);
  });
  return output;
}

async function generate() {
  const segments = collectSegments();
  const renderedByLocale = new Map();

  for (const locale of locales) {
    const textMap = await translateSegments(locale.code, segments);
    const localeDir = path.join(LEGAL_ROOT, locale.path);
    await mkdir(localeDir, { recursive: true });

    const renderedDocs = new Map();
    for (const doc of docs) {
      const html = renderDocumentHtml(doc, locale, textMap);
      await writeFile(path.join(localeDir, doc.fileName), html, "utf8");
      renderedDocs.set(doc.fileName, html);
    }
    renderedByLocale.set(locale.path, renderedDocs);
  }

  // Keep existing root URLs stable for App Store metadata with full EN content.
  const englishDocs = renderedByLocale.get("en");
  if (!englishDocs) {
    throw new Error("English legal docs were not generated");
  }
  await writeFile(path.join(LEGAL_ROOT, "privacy-policy.html"), englishDocs.get("privacy-policy.html"), "utf8");
  await writeFile(path.join(LEGAL_ROOT, "terms-of-use.html"), englishDocs.get("terms-of-use.html"), "utf8");
  await writeFile(path.join(LEGAL_ROOT, "index.html"), renderIndexPage(), "utf8");
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
