import * as THREE from 'three';
import { TERRACES, LANES, CLIMBS, climbSpec } from './favela.js';

/**
 * Navigation is a small hand-derived waypoint graph rather than a navmesh.
 * The map is deliberately built as terraces + three lanes + fixed climbs, so
 * the graph falls straight out of the layout: two nodes per lane per terrace
 * (downhill street edge, uphill edge) plus a bottom/top pair per staircase.
 *
 * ~60 nodes total, so a breadth-first search costs nothing and the AI never
 * needs to solve geometry - only "which stairs do I take next".
 */
export class NavGraph {
  constructor(collision) {
    this.nodes = [];
    this.adj = [];
    this._build(collision);
    this._cache = new Map();
    this._edgeCost = new Map();
  }

  _add(x, z, y, meta) {
    const i = this.nodes.length;
    this.nodes.push({ i, pos: new THREE.Vector3(x, y, z), ...meta });
    this.adj.push([]);
    return i;
  }

  _link(a, b) {
    if (a === b || a == null || b == null) return;
    if (!this.adj[a].includes(b)) this.adj[a].push(b);
    if (!this.adj[b].includes(a)) this.adj[b].push(a);
  }

  _build(collision) {
    const laneList = [LANES.west, LANES.mid, LANES.east];
    const ground = (x, z, yGuess) => collision.groundHeight(x, z, yGuess + 2.5, 0.5);

    // How far the longest flight leaving each terrace reaches back onto it.
    // Staging nodes have to sit beyond that, or they land halfway up a
    // staircase and agents ping-pong between them and the flight below.
    const maxRun = TERRACES.map((_, ti) => {
      let m = 0;
      for (const c of CLIMBS) if (c.to === ti + 1) m = Math.max(m, climbSpec(c).run);
      return m;
    });

    // ── terrace nodes: 'low' at the downhill street, 'deep' at the uphill end ──
    this.terraceNodes = [];
    for (let ti = 0; ti < TERRACES.length; ti++) {
      const t = TERRACES[ti];
      const lowZ = t.z1 - 4.5;
      const deepZ = Math.min(t.z1 - 2, Math.max(t.z0 + 3, t.z0 + maxRun[ti] + 3.5));
      const row = [];

      for (let li = 0; li < laneList.length; li++) {
        const lane = laneList[li];
        const low = this._add(lane.x, lowZ, ground(lane.x, lowZ, t.y), { t: ti, lane: li, kind: 'low' });
        const deep = this._add(lane.x, deepZ, ground(lane.x, deepZ, t.y), { t: ti, lane: li, kind: 'deep' });
        this._link(low, deep);
        row.push({ low, deep });
      }
      // lateral rotation along both ends of the terrace
      for (let li = 0; li < row.length - 1; li++) {
        this._link(row[li].low, row[li + 1].low);
        this._link(row[li].deep, row[li + 1].deep);
      }
      this.terraceNodes.push(row);
    }

    // ── climbs ──
    this.climbBottoms = TERRACES.map(() => []);
    for (const c of CLIMBS) {
      const upper = TERRACES[c.to];
      const lower = TERRACES[c.to - 1];
      const spec = climbSpec(c);

      const bz = upper.z1 + spec.run + 1.5;   // just off the foot of the flight
      const mz = upper.z1 + spec.run * 0.5;   // mid-flight, keeps agents on the steps
      const tz = upper.z1 - 3.0;              // landing on the upper terrace

      // The grand staircase has a solid spine down the middle, so it gets a
      // route either side of it rather than one straight through it.
      const offsets = spec.divider > 0 ? [-(spec.divider + 1.7), spec.divider + 1.7] : [0];
      const li = c.lane === 'west' ? 0 : c.lane === 'mid' ? 1 : 2;

      for (const ox of offsets) {
        const x = c.x + ox;
        const bottom = this._add(x, bz, ground(x, bz, lower.y), { t: c.to - 1, kind: 'climb-bottom', climb: true });
        const top = this._add(x, tz, ground(x, tz, upper.y), { t: c.to, kind: 'climb-top', climb: true });

        // Waypoints every ~3 m up the flight. Sparse ones let agents cut the
        // corner off the side of the steps and jam against the retaining wall.
        const segs = Math.max(3, Math.ceil(Math.abs(bz - tz) / 2.5));
        let prevNode = bottom;
        for (let k = 1; k < segs; k++) {
          const f = k / segs;
          const z = bz + (tz - bz) * f;
          const yGuess = lower.y + (upper.y - lower.y) * f + 1.5;
          const step = this._add(x, z, ground(x, z, yGuess), { t: c.to, kind: 'climb-mid', climb: true });
          this._link(prevNode, step);
          prevNode = step;
        }
        this._link(prevNode, top);

        // the foot hangs off the lower terrace's uphill staging nodes, the
        // landing off the upper terrace's downhill street
        for (let l = 0; l < 3; l++) {
          if (Math.abs(l - li) <= 1) this._link(bottom, this.terraceNodes[c.to - 1][l].deep);
        }
        this._link(top, this.terraceNodes[c.to][li].low);
        if (li > 0) this._link(top, this.terraceNodes[c.to][li - 1].low);
        if (li < 2) this._link(top, this.terraceNodes[c.to][li + 1].low);

        this.climbBottoms[c.to - 1].push(bottom);
      }
    }

    // let agents slide sideways along a terrace's uphill edge between flights
    for (const list of this.climbBottoms) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (this.nodes[list[i]].pos.distanceTo(this.nodes[list[j]].pos) < 34) {
            this._link(list[i], list[j]);
          }
        }
      }
    }

    this._relocateBlocked(collision);
  }

  /**
   * A procedurally infilled map will occasionally drop a house on a waypoint.
   * Nudge any node that ends up inside geometry out to the nearest standable
   * spot; drop it from the graph entirely if there isn't one.
   */
  _relocateBlocked(collision) {
    for (const n of this.nodes) {
      if (!collision.isBlocked(n.pos.x, n.pos.y, n.pos.z, 0.5, 1.7, 0.62)) continue;
      let fixed = false;
      for (let r = 1.5; r <= 6 && !fixed; r += 1.5) {
        for (let a = 0; a < 8 && !fixed; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const x = n.pos.x + Math.cos(ang) * r;
          const z = n.pos.z + Math.sin(ang) * r;
          const y = collision.groundHeight(x, z, n.pos.y + 1.2, 0.5);
          if (Math.abs(y - n.pos.y) > 1.6) continue;   // don't hop onto a roof
          if (collision.isBlocked(x, y, z, 0.5, 1.7, 0.62)) continue;
          n.pos.set(x, y, z);
          fixed = true;
        }
      }
      n.blocked = !fixed;
    }
  }

  /** Terrace index for a world Z. */
  static terraceOf(z) {
    for (let i = 0; i < TERRACES.length; i++) {
      if (z >= TERRACES[i].z0 && z <= TERRACES[i].z1) return i;
    }
    return z < TERRACES[TERRACES.length - 1].z0 ? TERRACES.length - 1 : 0;
  }

  /**
   * Closest usable node, optionally biased so it doesn't sit *behind* us
   * relative to where we're going. Without that bias an agent that has just
   * stepped off a staircase keeps snapping back to the node it came from and
   * never commits to a route.
   */
  nearest(pos, preferTerrace = null, toward = null) {
    let best = -1, bd = Infinity;
    const here = toward ? Math.hypot(pos.x - toward.x, pos.z - toward.z) : 0;
    for (const n of this.nodes) {
      if (n.blocked) continue;
      let d = n.pos.distanceTo(pos);
      if (preferTerrace != null && n.t !== preferTerrace) d *= 2.5;
      if (toward) {
        // pay for any ground the node gives up on the way to the goal
        const setback = Math.hypot(n.pos.x - toward.x, n.pos.z - toward.z) - here;
        if (setback > 0) d += setback * 1.4;
      }
      if (d < bd) { bd = d; best = n.i; }
    }
    return best;
  }

  /**
   * A* over real edge lengths. Hop-count search is not good enough here: from
   * the middle of the plaza a staircase two metres away and one forty metres
   * away are both "one edge", and agents end up sprinting across the map to
   * take the wrong stairs. Cached, since goals repeat constantly.
   */
  path(fromIdx, toIdx) {
    if (fromIdx === toIdx) return [toIdx];
    if (fromIdx < 0 || toIdx < 0) return null;
    const key = fromIdx * 4096 + toIdx;
    const hit = this._cache.get(key);
    if (hit !== undefined) return hit;

    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const fScore = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const goal = this.nodes[toIdx].pos;

    g[fromIdx] = 0;
    fScore[fromIdx] = this.nodes[fromIdx].pos.distanceTo(goal);
    const open = [fromIdx];

    while (open.length) {
      // small graph, so a linear scan beats maintaining a heap
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === toIdx) break;
      closed[cur] = 1;

      for (const nb of this.adj[cur]) {
        if (closed[nb]) continue;
        const tentative = g[cur] + this._cost(cur, nb);
        if (tentative >= g[nb]) continue;
        prev[nb] = cur;
        g[nb] = tentative;
        fScore[nb] = tentative + this.nodes[nb].pos.distanceTo(goal);
        if (!open.includes(nb)) open.push(nb);
      }
    }

    let out = null;
    if (prev[toIdx] !== -1 || fromIdx === toIdx) {
      out = [];
      for (let c = toIdx; c !== -1; c = prev[c]) out.push(c);
      out.reverse();
      if (out[0] !== fromIdx) out = null;   // unreachable
    }

    if (this._cache.size > 4000) this._cache.clear();
    this._cache.set(key, out);
    return out;
  }

  /** Edge cost: ground distance, with climbing priced a little higher. */
  _cost(a, b) {
    let c = this._edgeCost.get(a * 4096 + b);
    if (c === undefined) {
      const pa = this.nodes[a].pos, pb = this.nodes[b].pos;
      const flat = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      c = flat + Math.abs(pb.y - pa.y) * 1.6;
      this._edgeCost.set(a * 4096 + b, c);
    }
    return c;
  }
}
