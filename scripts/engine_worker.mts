/** JSON-lines local RL environment using unmodified, pinned OpenFront engine. */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import readline from 'node:readline';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.OPENFRONT_SOURCE || path.join(project, 'vendor/openfrontio');
const req = createRequire(path.join(root, 'package.json'));
const schema = createRequire(import.meta.url)('../browser/schema7.cjs');
const upstream = (name: string) => import(pathToFileURL(req.resolve(name)).href);
const { PlayerInfo, PlayerType } = await upstream('@openfront/engine-api/game/GameTypes');
const { EngineConfig } = await upstream('@openfront/engine/configuration/EngineConfig');
const { SpawnExecution } = await upstream('@openfront/engine/execution/SpawnExecution');
const { AttackExecution } = await upstream('@openfront/engine/execution/AttackExecution');
const { setup } = await import(pathToFileURL(path.join(root, 'tests/util/Setup.ts')).href);
// Reserve stdout for protocol; upstream diagnostic messages go to stderr.
console.log = (...items) => {
  if (!String(items[0]).startsWith('[GameImpl] Constructor total:')) console.error(...items);
};
let config: any;
const worlds: any[] = [];
let episodes: number[] = [];
const fractions = [.2, .5, .8];
const actionsCount = 18;
const corners = [[20, 20], [79, 79], [20, 79], [79, 20]];

async function reset(index: number) {
  const episode = episodes[index]++;
  const game = await setup('plains', { bots: 0 }, [], undefined, EngineConfig, true);
  const rotation = ((config.seed + episode + index) % 4 + 4) % 4;
  let randomState = (config.seed ^ Math.imul(index + 1, 0x9e3779b9) ^ Math.imul(episode + 1, 0x85ebca6b)) >>> 0;
  function randomOffset() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return (randomState % 25) - 12;
  }
  const positions = corners.map(([x, y]) => [x + randomOffset(), y + randomOffset()]);
  const players = Array.from({ length: 4 }, (_, p) => {
    const info = new PlayerInfo(`RL-${p}`, PlayerType.Human, null, `p${p}`);
    const player = game.addPlayer(info);
    const [x, y] = positions[(p + rotation) % 4];
    game.addExecution(new SpawnExecution(`rl-${config.seed}-${index}-${episode}`, info, game.ref(x, y)));
    return player;
  });
  game.executeNextTick(); game.executeNextTick();
  if (players.some(p => p.numTilesOwned() === 0)) throw new Error('Spawn failed');
  worlds[index] = { game, players, step: 0, previousTroops: players.map(p => p.troops()),
    maxLand: players[0].numTilesOwned(), branches: [], ended: false };
}

function observation(w: any) {
  const { game, players } = w;
  const allX: any[] = [], allMask: any[] = [], allUtility: any[] = [];
  w.branches = [];
  for (let p = 0; p < 4; p++) {
    const me = players[p], home = Math.max(1, me.troops());
    const canAct = !w.ended && me.numTilesOwned() > 0 && me.outgoingAttacks().length === 0;
    const groups = new Map<string, any>();
    if (canAct) {
      for (const tile of me.borderTiles()) for (const neighbor of game.neighbors(tile)) {
        if (!game.isLand(neighbor)) continue;
        const target = game.owner(neighbor);
        if (target.id() !== me.id() && (!target.isPlayer() || me.canAttackPlayer(target))) groups.set(target.id(), target);
      }
    }
    const strongest = Math.max(0, ...Array.from(groups.values()).filter(q => q.isPlayer()).map(q => q.troops()));
    const incoming = me.incomingAttacks().reduce((sum, a) => sum + a.troops(), 0);
    const state = {
      home, troops: home, reserve: .25 * home, gold: Number(me.gold()),
      land: me.numTilesOwned(), maxLand: me.numTilesOwned(),
      gamePhase: Math.min(20, game.ticks() / 200), income: 0,
      enemyPressure: Math.min(1, strongest / home),
      activeWars: Array.from(groups.values()).filter(q => q.isPlayer()).length,
      frontCount: groups.size, allyPressure: 0, homeThreat: Math.min(1, incoming / home), nukeThreat: 0,
      recentLandTrend: 0,
      recentTroopTrend: Math.max(-1, Math.min(1, (home - w.previousTroops[p]) / Math.max(1, w.previousTroops[p]))),
    };
    const branches: any[] = Array.from({ length: actionsCount }, () => ({ kind: 'wait', ruleUtility: -1000 }));
    const mask = Array(actionsCount).fill(false); mask[0] = true;
    branches[0] = { kind: 'wait', ruleUtility: 10 + 35 * Math.max(0, Math.min(1, strongest / home - .5)),
      reserveAfter: home, expectedDefenseValue: Math.max(0, 1 - strongest / home / 2), cooldownReady: true };
    for (const target of groups.values()) for (let k = 0; k < 3; k++) {
      const fraction = fractions[k], cost = Math.floor(home * fraction);
      if (cost < 100) continue;
      const attack = target.isPlayer();
      const q = attack ? players.findIndex(player => player.id() === target.id()) : -1;
      if (attack && q < 0) continue;
      const j = attack ? 4 + 3 * q + k : 1 + k;
      const density = attack ? target.troops() / Math.max(1, target.numTilesOwned()) : 0;
      const possible = Math.min(6, cost / (70 + 1.2 * density));
      branches[j] = { kind: attack ? 'attack' : 'expand', targetId: target.id(), cost,
        troopCommitment: cost, reserveAfter: home - cost,
        ruleUtility: attack ? 30 + 12 * possible - 30 * fraction - 30 * Math.min(2, density / home)
                            : 65 + 6 * possible - 35 * fraction,
        targetStrength: attack ? Math.min(1, target.troops() / home) : 0,
        targetLand: possible / home, cooldownReady: true, targetReachable: true, isExpansion: !attack };
      mask[j] = true;
    }
    const utility = branches.map(b => b.ruleUtility);
    const top = Math.max(...utility.filter((_, i) => mask[i]));
    allX.push(branches.map(b => schema.features(state, b, { ruleTop1: top })));
    allMask.push(mask); allUtility.push(utility); w.branches.push({ branches, mask });
  }
  return { x: allX, mask: allMask, utility: allUtility };
}

function step(w: any, actions: number[]) {
  const { game, players } = w;
  const before = players[0].numTilesOwned() / 10000;
  if (!w.ended) {
    w.previousTroops = players.map(p => p.troops());
    for (let offset = 0; offset < 4; offset++) {
      const p = (offset + w.step) % 4;
      const { branches, mask } = w.branches[p], a = actions[p];
      if (!Number.isInteger(a) || a < 0 || a >= actionsCount) throw new Error('Invalid action');
      const b = branches[a], me = players[p];
      // Recheck live prerequisites rather than trusting the caller's mask.
      if (a && mask[a] && me.numTilesOwned() > 0 && me.outgoingAttacks().length === 0) {
        game.addExecution(new AttackExecution(b.cost, me, b.targetId));
      }
    }
    for (let t = 0; t < 20; t++) {
      game.executeNextTick();
      if (players[0].numTilesOwned() === 0 || players.filter(p => p.numTilesOwned() > 0).length <= 1) break;
    }
    w.step++;
  }
  const land = players.map(p => p.numTilesOwned());
  const alive = land.filter(n => n > 0).length;
  w.ended ||= !land[0] || alive <= 1 || w.step >= config.max_steps;
  const scores = players.map((p, i) => land[i] ? land[i] + .05 * p.troops() / Math.max(1, game.config().maxTroops(p)) : 0);
  const rank = scores.slice(1).reduce((sum, s) => sum + Math.sign(scores[0] - s), 0) / 3;
  const top = Math.max(...scores), ties = scores.filter(s => s === top).length;
  w.maxLand = Math.max(w.maxLand, land[0]);
  return { reward: .3 * (.99 * (w.ended ? 0 : land[0] / 10000) - before) + (w.ended ? rank : 0),
    done: w.ended, land, score: scores, winner: scores.indexOf(top),
    win_credit: scores[0] === top ? 1 / ties : 0, steps: w.step, max_land: w.maxLand,
    troops: players.map(p => p.troops()) };
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  try {
    const message = JSON.parse(line);
    let result: any = {};
    if (message.op === 'init') {
      config = message.config;
      if (config.players !== 4 || config.size !== 100) throw new Error('Engine backend currently requires 4 players and size=100 (plains map)');
      episodes = Array(config.envs).fill(0);
      for (let i = 0; i < config.envs; i++) await reset(i);
    } else if (message.op === 'reset') {
      for (const i of message.indices) await reset(i);
    } else if (message.op === 'step') {
      if (message.actions.length !== worlds.length) throw new Error('World count mismatch');
      result.transitions = worlds.map((w, i) => step(w, message.actions[i]));
    } else if (message.op === 'snapshot') {
      result.snapshots = worlds.map(w => ({
        width: w.game.width(), height: w.game.height(), ticks: w.game.ticks(), step: w.step,
        owner: Array.from({ length: w.game.width() * w.game.height() }, (_, tile) => {
          const target = w.game.owner(tile);
          return target.isPlayer() ? w.players.findIndex(p => p.id() === target.id()) : -1;
        }),
        players: w.players.map((p, i) => ({ id: i, land: p.numTilesOwned(), troops: p.troops(),
          gold: Number(p.gold()), outgoing: p.outgoingAttacks().length })),
      }));
    } else if (message.op === 'close') {
      break;
    } else throw new Error('Unknown operation');
    result.observations = worlds.map(observation);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error: any) {
    process.stdout.write(JSON.stringify({ error: String(error.stack || error) }) + '\n');
  }
}
