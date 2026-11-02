/**
 * 応答ごとの CSP の nonce。16 byte (128 bit) を base64 にする (CSP Level 3「7.1. Nonce Reuse」の
 * "at least 128 bits"、`nonce-source` の文法の `base64-value`)
 */
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** HTML の応答に付ける CSP。ディレクティブごとの効き方は ADR-0051 */
export function contentSecurityPolicy(nonce: string): string {
  return `script-src 'nonce-${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
}
