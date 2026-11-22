/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Adapted from BrowserQuest server/js/formulas.js. The campus adapter
 * injects seeded randomness and uses typed arguments.
 */
export function damage(weaponLevel: number, armorLevel: number, random: (exclusive: number) => number) {
  const dealt = weaponLevel * (5 + random(6));
  const absorbed = armorLevel * (1 + random(3));
  const net = dealt - absorbed;
  return net <= 0 ? random(4) : net;
}

