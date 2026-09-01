/**
 * Session-stable browser headers for HTTP content fetching.
 *
 * Maintains a pool of real Chrome UA profiles. One profile is selected
 * per process lifetime (session-stable) to avoid fingerprint inconsistency
 * from the same IP.
 */

interface UAProfile {
  ua: string;
  secChUa: string;
  secChUaPlatform: string;
}

const UA_PROFILES: UAProfile[] = [
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="133", "Google Chrome";v="133", "Not?A_Brand";v="99"',
    secChUaPlatform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="132", "Google Chrome";v="132", "Not?A_Brand";v="99"',
    secChUaPlatform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="131", "Google Chrome";v="131", "Not?A_Brand";v="99"',
    secChUaPlatform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="133", "Google Chrome";v="133", "Not?A_Brand";v="99"',
    secChUaPlatform: '"Windows"',
  },
];

// Session-stable: pick once per process
const sessionProfile = UA_PROFILES[Math.floor(Math.random() * UA_PROFILES.length)];

/** Get the session-stable UA profile. */
export function getSessionProfile(): UAProfile {
  return sessionProfile;
}

/** Build realistic browser headers for HTTP content fetching. */
export function buildBrowserHeaders(): Record<string, string> {
  const p = sessionProfile;
  return {
    "User-Agent": p.ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "sec-ch-ua": p.secChUa,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": p.secChUaPlatform,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
}
