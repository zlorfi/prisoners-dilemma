'use strict';

const crypto = require('node:crypto');

/**
 * Crockford-style base32 without I, L, O, U — avoids 0/O and 1/l confusion
 * when somebody has to read the link off a slide and type it on a phone.
 */
const ALPHABET = '23456789abcdefghjkmnpqrstvwxyz';
const SLUG_LENGTH = 8;

/**
 * ~30^8 = 6.5e11 possibilities. Short enough to type, far too large to guess,
 * especially with the rate limiting in front of it.
 */
function generateSlug(length = SLUG_LENGTH) {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length; i += 1) {
    // Rejection sampling keeps the distribution uniform across the alphabet.
    const byte = bytes[i % bytes.length];
    if (byte >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

function isValidSlug(slug) {
  return (
    typeof slug === 'string' &&
    slug.length >= 4 &&
    slug.length <= 24 &&
    [...slug].every((c) => ALPHABET.includes(c))
  );
}

module.exports = { generateSlug, isValidSlug, SLUG_LENGTH };
