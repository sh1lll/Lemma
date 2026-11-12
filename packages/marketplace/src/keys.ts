/**
 * Public keys the app trusts for the marketplace index (raw Ed25519, base64), by key id.
 * The matching private key is never in the repo: see PUBLISHING.md ("Signing key").
 * To rotate: add the new key, ship an app update, then sign with the new key; remove the old one later.
 */
export const TRUSTED_KEYS: Record<string, string> = {
  'lemma-0aad8ebfcc50': 'CTTwC3IE0hiQXQqf7LKXozyOybayFAeOj+4iXHzaV5Q=',
};
