// The scripted bot plays the real game rules without cheats to check pacing and that progression is achievable.
import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createBot } from '../src/dev/bot';
import { updateQuests } from '../src/sim/quests';

describe('balance', () => {
  it('a straightforward strategy reaches 村, 町 and 都市 within an hour without cheats', () => {
    const w = new World();
    const bot = createBot(w);
    for (let t = 0; t < 60 * 60 * 10; t++) {
      w.tick();
      updateQuests(w);
      bot.afterTick();
    }
    const { timeline } = bot;
    console.log(timeline.join('\n'));
    console.log('quests done:', [...w.questsDone].join(','));
    const at = (m: number) => timeline.find((l) => l.includes(`MILESTONE ${m}`));
    expect(at(1)).toBeTruthy();
    expect(at(2)).toBeTruthy();
    expect(at(3)).toBeTruthy();
    expect(parseFloat(at(1)!)).toBeGreaterThan(0.5); // not instant
    expect(w.questsDone.size).toBeGreaterThanOrEqual(15);
  }, 120000);
});
