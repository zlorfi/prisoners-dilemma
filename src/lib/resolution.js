'use strict';

/**
 * Damage resolution for the Magic: The Gathering card "Prisoner's Dilemma".
 *
 * Card text:
 *   Each opponent secretly chooses silence or snitch, then the choices are
 *   revealed. If each opponent chose silence, Prisoner's Dilemma deals 4
 *   damage to each of them. If each opponent chose snitch, Prisoner's Dilemma
 *   deals 8 damage to each of them. Otherwise, Prisoner's Dilemma deals 12
 *   damage to each opponent who chose silence.
 *
 * Three branches, checked in the card's own order:
 *
 *   1. unanimous silence -> 4 to every opponent
 *   2. unanimous snitch  -> 8 to every opponent
 *   3. mixed             -> 12 to each opponent who chose SILENCE,
 *                           and nothing at all to the snitches
 *
 * The mixed branch is the whole point of the card: defecting is free only if
 * somebody else cooperates, so the table is pushed towards mutual betrayal
 * (8 each) or a very expensive show of trust.
 *
 * A single opponent is unanimous by definition and therefore always lands in
 * branch 1 or 2 — never the 12-damage branch.
 */

const DAMAGE = {
  ALL_SILENCE: 4,
  ALL_SNITCH: 8,
  BETRAYED_SILENCE: 12,
};

/**
 * @param {Array<{id?: number, display_name?: string, choice: string}>} votes
 * @returns {{
 *   outcome: 'none'|'all_silence'|'all_snitch'|'mixed',
 *   headline: string,
 *   explanation: string,
 *   silence: number,
 *   snitch: number,
 *   total: number,
 *   damage: { silence: number, snitch: number },
 *   totalDamage: number,
 *   players: Array<{ id?: number, name?: string, choice: string, damage: number }>
 * }}
 */
function resolve(votes) {
  const list = Array.isArray(votes) ? votes : [];
  const silence = list.filter((v) => v.choice === 'silence').length;
  const snitch = list.filter((v) => v.choice === 'snitch').length;
  const total = silence + snitch;

  let outcome;
  let perSilence;
  let perSnitch;
  let headline;
  let explanation;

  if (total === 0) {
    outcome = 'none';
    perSilence = 0;
    perSnitch = 0;
    headline = 'No opponents chose';
    explanation = 'Nobody submitted a choice, so the spell deals no damage.';
  } else if (snitch === 0) {
    outcome = 'all_silence';
    perSilence = DAMAGE.ALL_SILENCE;
    perSnitch = 0;
    headline = 'Everyone stayed silent';
    explanation =
      'Every opponent chose silence, so Prisoner\u2019s Dilemma deals 4 damage to each of them.';
  } else if (silence === 0) {
    outcome = 'all_snitch';
    perSilence = 0;
    perSnitch = DAMAGE.ALL_SNITCH;
    headline = 'Everyone snitched';
    explanation =
      'Every opponent chose snitch, so Prisoner\u2019s Dilemma deals 8 damage to each of them.';
  } else {
    outcome = 'mixed';
    perSilence = DAMAGE.BETRAYED_SILENCE;
    perSnitch = 0;
    headline = 'The silent were betrayed';
    explanation =
      'The choices were split, so Prisoner\u2019s Dilemma deals 12 damage to each opponent who chose silence. The snitches take none.';
  }

  const players = list.map((v) => ({
    id: v.id,
    name: v.display_name,
    choice: v.choice,
    damage: v.choice === 'silence' ? perSilence : perSnitch,
  }));

  return {
    outcome,
    headline,
    explanation,
    silence,
    snitch,
    total,
    damage: { silence: perSilence, snitch: perSnitch },
    totalDamage: silence * perSilence + snitch * perSnitch,
    players,
  };
}

module.exports = { resolve, DAMAGE };
