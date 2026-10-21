import { it } from 'vitest';
import { World } from '../../src/sim/world';
it('map', () => {
  const w = new World();
  let s = '    ' + Array.from({length: w.W}, (_, x) => (x % 10)).join('') + '\n';
  for (let y = 0; y < w.H; y++) {
    let row = String(y).padStart(3) + ' ';
    for (let x = 0; x < w.W; x++) {
      const i = w.idx(x, y);
      const e = w.tileEnt[i] ? w.entities.get(w.tileEnt[i])!.type[0].toUpperCase() : '';
      const h = w.terrain.height[i];
      const g = w.terrain.ground[i];
      row += e || (h < 0 ? '~' : w.terrain.tree[i] ? 'T' : g === 2 ? 'R' : g === 3 ? 'O' : String(h));
    }
    s += row + '\n';
  }
  console.log(s);
});
